/**
 * Mise à jour automatique des données de marché (fonction serveur « marche », chaque nuit) :
 * - Carte des loyers (data.gouv.fr) : nouveau millésime ou fichier republié ;
 * - taux d'usure (page trimestrielle publique de la Banque de France) : trimestre en cours et suivant ;
 * - plafonds d'encadrement de Paris (données ouvertes de la Ville de Paris) : nouvelle année.
 * Le 1er du mois, un e-mail rappelle à l'administrateur ce qui reste à saisir (barème des taux, arrêtés).
 * Dépendances injectées (réseau, base) : testé dans tests/marketSync.test.ts avec des réponses simulées.
 */
import { parseRentIndicatorsCsv, segmentFromFileName, type RentCap, type RentIndicator, type RentSegment } from './rentData.ts';

export type UsuryBracket = 'moins_10' | '10_20' | '20_plus' | 'variable' | 'relais';
export interface UsuryRow { quarter: string; borrower: 'particulier' | 'personne_morale'; bracket: UsuryBracket; average: number | null; usury: number; valid_from: string; valid_to: string }

export const DATAGOUV_DATASETS = 'https://www.data.gouv.fr/api/1/datasets/';
export const carteSlug = (year: number) => `carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-${year}`;
export const usuryPageUrl = (quarter: string) => `https://www.banque-france.fr/fr/statistiques/taux-et-cours/taux-dusure-${quarter.slice(0, 4)}-q${quarter.slice(-1)}`;
export const parisCapsUrl = (year: number) =>
  `https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/logement-encadrement-des-loyers/exports/json?refine=${encodeURIComponent(`annee:${year}`)}`;
export const USER_AGENT = 'Immo-Zen (donnees de marche ; contact@immo-zen.fr)';
/** En dessous, un fichier est jugé incomplet : rien n'est remplacé. */
const MIN_COMMUNES = 1000;
const MIN_PARIS_CAPS = 500;

// --------------------------------------------------------------------------- dates

/** Trimestre civil d'une date et ses bornes. */
export function quarterOf(day: string): { quarter: string; from: string; to: string } {
  const y = Number(day.slice(0, 4)), q = Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1;
  const m1 = (q - 1) * 3 + 1, m3 = m1 + 2;
  const last = new Date(Date.UTC(y, m3, 0)).getUTCDate();
  const p = (n: number) => String(n).padStart(2, '0');
  return { quarter: `${y}-Q${q}`, from: `${y}-${p(m1)}-01`, to: `${y}-${p(m3)}-${p(last)}` };
}
export function nextQuarter(day: string): ReturnType<typeof quarterOf> {
  const end = quarterOf(day).to;
  return quarterOf(new Date(Date.parse(`${end}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10));
}
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Texte d'un fichier : UTF-8, sinon Windows-1252 (fichiers publiés en Latin-1). */
export function decodeText(buf: ArrayBuffer): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }
}

// --------------------------------------------------------------------------- taux d'usure (page de la Banque de France)

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', ccedil: 'ç', Eacute: 'É', rsquo: '’' };
function cellText(html: string): string {
  return html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n] ?? m).replace(/\s+/g, ' ').trim();
}
const pctFr = (v: string | undefined): number | null => {
  const m = /(\d{1,2})[,.](\d{1,2})/.exec(v ?? '');
  return m ? Number(`${m[1]}.${m[2]}`) : null;
};

/**
 * Taux d'usure d'une page trimestrielle de la Banque de France (tableau « Taux d'usure et taux effectifs moyens pratiqués »).
 * Crédits immobiliers aux particuliers (5 catégories) et prêts aux personnes morales sans activité commerciale (3 tranches à taux fixe).
 * Lève une erreur si le tableau est introuvable ou incomplet : rien n'est enregistré.
 */
export function parseUsuryPage(html: string, quarter: string): UsuryRow[] {
  const { from, to } = quarterOf(`${quarter.slice(0, 4)}-${String((Number(quarter.slice(-1)) - 1) * 3 + 1).padStart(2, '0')}-01`);
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => [...m[1]!.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => cellText(c[1]!)));
  let section: 'conso' | 'immo' | 'pm' | 'pro' | null = null;
  const out: UsuryRow[] = [];
  for (const cells of rows) {
    const label = (cells[0] ?? '').toLowerCase();
    if (/cr[ée]dits de tr[ée]sorerie/.test(label)) { section = 'conso'; continue; }
    if (/cr[ée]dits immobiliers/.test(label)) { section = 'immo'; continue; }
    if (/personnes morales n.ayant pas d.activit/.test(label)) { section = 'pm'; continue; }
    if (/personnes physiques agissant/.test(label)) { section = 'pro'; continue; }
    if (section !== 'immo' && section !== 'pm') continue;
    const average = pctFr(cells[1]), usury = pctFr(cells[2]);
    if (usury === null) continue;
    let bracket: UsuryBracket | null = null;
    if (/relais/.test(label)) bracket = 'relais';
    else if (/taux variable/.test(label)) bracket = section === 'immo' ? 'variable' : null;
    else if (/20 ans et plus/.test(label)) bracket = '20_plus';
    else if (/10 ans et moins de 20 ans/.test(label)) bracket = '10_20';
    else if (/inf[ée]rieure à 10 ans|2 ans et moins de 10 ans/.test(label)) bracket = 'moins_10';
    if (!bracket) continue;
    const borrower = section === 'immo' ? 'particulier' : 'personne_morale';
    if (out.some((r) => r.borrower === borrower && r.bracket === bracket)) continue;
    out.push({ quarter, borrower, bracket, average, usury, valid_from: from, valid_to: to });
  }
  const immo = out.filter((r) => r.borrower === 'particulier').length, pm = out.filter((r) => r.borrower === 'personne_morale').length;
  if (immo < 5 || pm < 3) throw new Error(`Page des taux d’usure ${quarter} : tableau incomplet ou format modifié (${immo}/5 catégories immobilières, ${pm}/3 personnes morales).`);
  if (out.some((r) => r.usury < 0.5 || r.usury > 30)) throw new Error(`Page des taux d’usure ${quarter} : valeurs hors limites.`);
  return out;
}

// --------------------------------------------------------------------------- plafonds de Paris (données ouvertes de la Ville)

type Rec = Record<string, unknown>;
const field = (r: Rec, ...names: string[]): unknown => {
  for (const n of names) {
    const k = Object.keys(r).find((x) => x.toLowerCase() === n);
    if (k !== undefined && r[k] !== null && r[k] !== '') return r[k];
  }
  return undefined;
};
const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const n = Number(v.replace(',', '.').trim());
  return Number.isFinite(n) ? n : null;
};

/** Période de construction de la Ville de Paris → années (bornes incluses). */
export function parisPeriod(epoque: string): [number | null, number | null] | null {
  const e = epoque.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/avant\s*1946/.test(e)) return [null, 1945];
  if (/1946\D+1970/.test(e)) return [1946, 1970];
  if (/1971\D+1990/.test(e)) return [1971, 1990];
  if (/apres\s*1990/.test(e)) return [1991, null];
  return null;
}

/** Code INSEE de l'arrondissement d'un quartier administratif (code à 7 chiffres 751AAQQ, ou numéro de quartier 1 à 80). */
export function parisInsee(r: Rec): string {
  const c = String(field(r, 'c_quinsee', 'code_quartier_insee') ?? '');
  if (/^751\d{4}$/.test(c)) return `751${c.slice(3, 5)}`;
  const q = num(field(r, 'id_quartier', 'c_qu', 'num_quartier'));
  if (q && q >= 1 && q <= 80) return `751${String(Math.ceil(q / 4)).padStart(2, '0')}`;
  const a = num(field(r, 'c_ar', 'arrondissement', 'num_arrondissement'));
  if (a && a >= 1 && a <= 20) return `751${String(a).padStart(2, '0')}`;
  return '75056';
}

/**
 * Plafonds de Paris d'une année (valables du 1er juillet au 30 juin suivant, et au plus tard à la fin de l'encadrement).
 * Une « zone » = un quartier administratif (le secteur de référence en dépend), rangé sous son arrondissement.
 */
export function parseParisCaps(records: Rec[], year: number, encadrementEnd: string | null): RentCap[] {
  const end = `${year + 1}-06-30`;
  const validTo = encadrementEnd && encadrementEnd < end ? encadrementEnd : end;
  const out: RentCap[] = [];
  for (const r of records) {
    const rooms = num(field(r, 'piece', 'pieces', 'nombre_de_pieces'));
    const period = parisPeriod(String(field(r, 'epoque', 'epoque_construction') ?? ''));
    const ref = num(field(r, 'ref', 'loyer_reference')), max = num(field(r, 'max', 'loyer_reference_majore')), min = num(field(r, 'min', 'loyer_reference_minore'));
    const meuble = String(field(r, 'meuble_txt', 'meuble', 'type_location') ?? '').toLowerCase();
    const quartier = String(field(r, 'nom_quartier', 'nom_qua', 'l_qu', 'quartier') ?? '').trim();
    const secteur = field(r, 'id_zone', 'secteur');
    if (!rooms || !period || !ref || !max || !min || !(min <= ref && ref <= max)) continue;
    out.push({
      territory: 'Paris', insee: parisInsee(r), zone: (quartier || (secteur !== undefined ? `Secteur ${secteur}` : 'Unique')).slice(0, 100),
      rooms: Math.min(4, Math.max(1, Math.round(rooms))), year_min: period[0], year_max: period[1],
      furnished: /meubl/.test(meuble) && !/non/.test(meuble),
      ref, max, min, valid_from: `${year}-07-01`, valid_to: validTo,
    });
  }
  return out;
}

// --------------------------------------------------------------------------- orchestration

export interface SyncState { [source: string]: { version: string } }
export interface MarketStatus {
  benchmarkOn: string | null;
  usuryQuarters: string[];
  vintages: number[];
  caps: { territory: string; valid_from: string; valid_to: string | null }[];
  encadrementEnd: string | null;
}

export interface SyncDeps {
  fetch: typeof fetch;
  today: string;
  /** Temps écoulé (ms) : au-delà du budget, le chargement reprend la nuit suivante. */
  elapsed: () => number;
  budgetMs: number;
  db: {
    state(): Promise<SyncState>;
    setState(source: string, version: string, details: Record<string, unknown>): Promise<void>;
    status(): Promise<MarketStatus>;
    replaceIndicators(vintage: number, segment: RentSegment, rows: RentIndicator[]): Promise<number>;
    insertUsury(rows: UsuryRow[]): Promise<void>;
    replaceCaps(territory: string, rows: RentCap[]): Promise<number>;
    queueReminder(subject: string, body: string, dedupe: string): Promise<boolean>;
  };
}

export interface SyncResult { loaded: string[]; pending: string[]; errors: string[]; reminder: boolean }

const get = (deps: SyncDeps, url: string, accept = '*/*') => deps.fetch(url, { headers: { 'user-agent': USER_AGENT, accept }, redirect: 'follow' });

async function syncCarte(deps: SyncDeps, state: SyncState, res: SyncResult) {
  const year = Number(deps.today.slice(0, 4));
  for (const y of [year, year - 1]) {
    const r = await get(deps, `${DATAGOUV_DATASETS}${carteSlug(y)}/`, 'application/json');
    if (r.status === 404) continue;
    if (!r.ok) throw new Error(`Carte des loyers ${y} : data.gouv.fr indisponible (HTTP ${r.status}).`);
    const ds = await r.json() as { resources?: { title?: string; url?: string; format?: string; last_modified?: string; checksum?: { value?: string } | null }[] };
    const files = (ds.resources ?? []).filter((x) => /csv/i.test(x.format ?? '') || /\.csv(\?|$)/i.test(x.url ?? ''));
    let found = 0;
    for (const f of files) {
      const segment = segmentFromFileName(`${f.title ?? ''} ${(f.url ?? '').split('/').pop() ?? ''}`);
      if (!segment || !f.url) continue;
      found++;
      const key = `carte:${y}:${segment}`;
      const version = f.checksum?.value || f.last_modified || f.url;
      if (state[key]?.version === version) continue;
      if (deps.elapsed() > deps.budgetMs) { res.pending.push(`Carte des loyers ${y} (${segment})`); continue; }
      const file = await get(deps, f.url, 'text/csv,*/*');
      if (!file.ok) throw new Error(`Carte des loyers ${y} (${segment}) : téléchargement impossible (HTTP ${file.status}).`);
      const rows = parseRentIndicatorsCsv(decodeText(await file.arrayBuffer()), segment, y);
      if (rows.length < MIN_COMMUNES) throw new Error(`Carte des loyers ${y} (${segment}) : ${rows.length} communes lues seulement, fichier incomplet ou format modifié.`);
      const n = await deps.db.replaceIndicators(y, segment, rows);
      await deps.db.setState(key, version, { communes: n, fichier: f.title ?? null });
      res.loaded.push(`Carte des loyers ${y} (${segment}) : ${n} communes`);
    }
    if (found) return; // millésime le plus récent trouvé
  }
}

async function syncUsury(deps: SyncDeps, status: MarketStatus, res: SyncResult) {
  const have = new Set(status.usuryQuarters);
  for (const q of [quarterOf(deps.today).quarter, nextQuarter(deps.today).quarter]) {
    if (have.has(q)) continue;
    const r = await get(deps, usuryPageUrl(q), 'text/html');
    if (r.status === 404) continue; // pas encore publié (publication à la fin du trimestre précédent)
    if (!r.ok) throw new Error(`Taux d’usure ${q} : site de la Banque de France indisponible (HTTP ${r.status}).`);
    const rows = parseUsuryPage(await r.text(), q);
    await deps.db.insertUsury(rows);
    await deps.db.setState(`usure:${q}`, q, { lignes: rows.length });
    res.loaded.push(`Taux d’usure ${q.replace('-Q', ', trimestre ')}`);
  }
}

async function syncParis(deps: SyncDeps, state: SyncState, status: MarketStatus, res: SyncResult) {
  const y = Number(deps.today.slice(0, 4));
  const candidates = deps.today >= `${y}-07-01` ? [y, y - 1] : [y - 1];
  for (const year of candidates) {
    const key = `paris:${year}`;
    if (state[key]) return; // année déjà chargée (la plus récente disponible)
    if (deps.elapsed() > deps.budgetMs) { res.pending.push(`Plafonds de Paris ${year}`); return; }
    const r = await get(deps, parisCapsUrl(year), 'application/json');
    if (!r.ok) throw new Error(`Plafonds de Paris ${year} : données ouvertes de la Ville indisponibles (HTTP ${r.status}).`);
    const records = await r.json() as Rec[];
    if (!Array.isArray(records) || records.length === 0) continue; // année pas encore publiée
    const caps = parseParisCaps(records, year, status.encadrementEnd);
    if (caps.length < MIN_PARIS_CAPS) throw new Error(`Plafonds de Paris ${year} : ${caps.length} plafonds lus sur ${records.length} lignes, format modifié.`);
    const n = await deps.db.replaceCaps('Paris', caps);
    await deps.db.setState(key, String(year), { plafonds: n });
    res.loaded.push(`Plafonds de Paris ${year} : ${n} plafonds`);
    return;
  }
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const frDate = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

/** Ce que l'administrateur doit saisir ou vérifier ce mois-ci (lignes de l'e-mail du 1er du mois). */
export function reminderLines(status: MarketStatus, today: string): string[] {
  const lines: string[] = [];
  const month = today.slice(0, 7);
  lines.push(status.benchmarkOn && status.benchmarkOn.slice(0, 7) === month
    ? `Barème des taux : déjà saisi pour ce mois (${frDate(status.benchmarkOn)}).`
    : `Barème des taux à 10, 15, 20 et 25 ans : à saisir pour ${MONTHS[Number(today.slice(5, 7)) - 1]}${status.benchmarkOn ? ` (dernier barème : ${frDate(status.benchmarkOn)})` : ' (aucun barème enregistré)'}.`);
  const q = quarterOf(today).quarter;
  if (!status.usuryQuarters.includes(q)) lines.push(`Taux d’usure du trimestre en cours (${q.replace('-Q', ', trimestre ')}) non chargés automatiquement : à saisir d’après la Banque de France.`);
  const year = Number(today.slice(0, 4));
  if (!status.vintages.length) lines.push('Carte des loyers : aucun millésime chargé (le chargement automatique n’a pas abouti).');
  else if (Math.max(...status.vintages) < year - 1) lines.push(`Carte des loyers : dernier millésime ${Math.max(...status.vintages)}, plus récent attendu (publication en décembre).`);
  const soon = addDays(today, 45);
  const byTerritory = new Map<string, { from: string; to: string | null }>();
  for (const c of status.caps) {
    const t = byTerritory.get(c.territory);
    if (!t || c.valid_from > t.from) byTerritory.set(c.territory, { from: c.valid_from, to: c.valid_to });
  }
  for (const [t, v] of byTerritory) {
    if (t === 'Paris') continue; // automatique
    if (v.to && v.to < today) lines.push(`Plafonds de ${t} : expirés depuis le ${frDate(v.to)}. Chargez le nouvel arrêté ou prolongez la validité.`);
    else if (v.to && v.to <= soon) lines.push(`Plafonds de ${t} : valables jusqu’au ${frDate(v.to)}. Vérifiez le nouvel arrêté ou la prolongation de l’encadrement.`);
    else if (v.from <= addDays(today, -365)) lines.push(`Plafonds de ${t} : arrêté du ${frDate(v.from)}, probablement renouvelé depuis. Vérifiez le site de la préfecture.`);
  }
  if (!byTerritory.size || [...byTerritory.keys()].every((t) => t === 'Paris')) lines.push('Plafonds des territoires encadrés hors Paris : aucun chargé (Lille, Plaine Commune, Est Ensemble, Lyon et Villeurbanne, Montpellier, Bordeaux, Pays basque, Grenoble-Alpes Métropole).');
  if (status.encadrementEnd && status.encadrementEnd >= today && status.encadrementEnd <= soon) {
    lines.push(`Fin de l’encadrement des loyers prévue le ${frDate(status.encadrementEnd)} sauf nouvelle loi : en cas de prolongation, mettez à jour la date dans Administration → Données de marché → Réglages.`);
  }
  return lines;
}

/** Exécution complète : chaque source est indépendante (l'échec de l'une n'empêche pas les autres). */
export async function syncMarket(deps: SyncDeps): Promise<SyncResult> {
  const res: SyncResult = { loaded: [], pending: [], errors: [], reminder: false };
  const state = await deps.db.state();
  let status = await deps.db.status();
  for (const [name, run] of [
    ['usure', () => syncUsury(deps, status, res)],
    ['paris', () => syncParis(deps, state, status, res)],
    ['carte', () => syncCarte(deps, state, res)],
  ] as const) {
    try { await run(); } catch (e) { res.errors.push(e instanceof Error ? e.message : String(e)); void name; }
  }
  if (deps.today.slice(8, 10) === '01') {
    status = await deps.db.status();
    const lines = reminderLines(status, deps.today);
    const done = res.loaded.length ? ['', 'Chargé automatiquement cette nuit :', ...res.loaded.map((l) => `- ${l}`)] : [];
    const failed = res.errors.length ? ['', 'Échecs du chargement automatique :', ...res.errors.map((l) => `- ${l}`)] : [];
    res.reminder = await deps.db.queueReminder(
      `Immo-Zen – données de marché à mettre à jour (${MONTHS[Number(deps.today.slice(5, 7)) - 1]} ${deps.today.slice(0, 4)})`,
      ['Bonjour,', '', 'Rappel mensuel des données de marché d’Immo-Zen :', '', ...lines.map((l) => `- ${l}`), ...done, ...failed, '',
        'Saisie : Administration → Données de marché ({{APP_URL}}#/admin).',
        'La Carte des loyers, les taux d’usure et les plafonds de Paris sont vérifiés et chargés automatiquement chaque nuit.'].join('\n'),
      `marche:rappel:${deps.today.slice(0, 7)}`,
    );
  }
  return res;
}
