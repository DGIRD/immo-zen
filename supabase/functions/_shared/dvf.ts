/**
 * Estimation d'un bien à partir des ventes publiques « Demandes de valeurs foncières » géolocalisées
 * (DVF, DGFiP / Etalab, Licence Ouverte 2.0) : un fichier CSV par commune et par année.
 * Méthode : ventes d'un seul logement du même type (appartement ou maison), les plus proches
 * (rayon élargi jusqu'à obtenir assez de ventes), pondérées et corrigées de l'évolution des prix et
 * de l'effet de la surface ; quartiles pondérés du prix au m² appliqués à la surface (détail : `estimate`).
 * Module partagé entre l'application (navigateur) et la fonction serveur « dvf ».
 */

export const DVF_BASE = 'https://files.data.gouv.fr/geo-dvf/latest/csv';
export type DvfType = 'Appartement' | 'Maison';

export interface DvfSale {
  id: string;
  date: string;
  value: number;
  type: DvfType;
  surface: number;
  rooms: number | null;
  lat: number | null;
  lon: number | null;
  address: string;
}

export interface DvfComparable extends DvfSale {
  perM2: number;
  distance: number | null;
  /** Prix au m² ramené à aujourd'hui et à la surface du bien estimé. */
  adjPerM2?: number;
  /** Poids de la vente dans l'estimation (la vente la plus représentative pèse 1). */
  weight?: number;
}

export interface DvfConfidence { score: 1 | 2 | 3 | 4 | 5; label: string; reasons: string[] }

export interface DvfEstimate {
  low: number;
  median: number;
  high: number;
  perM2: { p25: number; median: number; p75: number };
  count: number;
  /** Rayon retenu en mètres ; null = toute la commune (adresse non localisée ou trop peu de ventes). */
  radius: number | null;
  from: string;
  to: string;
  comparables: DvfComparable[];
  source: string;
  /** Indice de confiance (1 à 5) et ce qui le fait baisser. */
  confidence?: DvfConfidence;
  /** Corrections tirées des ventes de la commune : évolution annuelle des prix, effet de la surface, échantillon effectif. */
  method?: { trendPerYear: number; sizeElasticity: number; effective: number };
}

/** Département du fichier : 2 caractères, 3 pour l'outre-mer (97x), 2A/2B pour la Corse. */
export function departmentOf(citycode: string): string {
  return citycode.startsWith('97') ? citycode.slice(0, 3) : citycode.slice(0, 2);
}
export function dvfUrl(year: number, citycode: string): string {
  return `${DVF_BASE}/${year}/communes/${departmentOf(citycode)}/${citycode}.csv`;
}
/** Années à consulter : les quatre dernières publiées (l'année en cours n'est publiée qu'en partie, plus tard). */
export function dvfYears(today: string): number[] {
  const y = Number(today.slice(0, 4));
  return [y - 1, y - 2, y - 3, y - 4];
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Ventes d'un seul logement (appartement ou maison) d'un fichier communal DVF. */
export function salesFromCsv(text: string): DvfSale[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = splitCsvLine(lines[0]!);
  const ix = (n: string) => head.indexOf(n);
  const I = {
    id: ix('id_mutation'), date: ix('date_mutation'), nature: ix('nature_mutation'), value: ix('valeur_fonciere'),
    num: ix('adresse_numero'), voie: ix('adresse_nom_voie'), cp: ix('code_postal'), commune: ix('nom_commune'),
    type: ix('type_local'), surface: ix('surface_reelle_bati'), rooms: ix('nombre_pieces_principales'), lon: ix('longitude'), lat: ix('latitude'),
  };
  if (I.id < 0 || I.value < 0 || I.type < 0) throw new Error('Format DVF inattendu.');
  const byId = new Map<string, { nature: string; value: number; date: string; dwellings: string[][] }>();
  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line);
    const id = c[I.id]!;
    let m = byId.get(id);
    if (!m) { m = { nature: c[I.nature] ?? '', value: Number(c[I.value]), date: c[I.date] ?? '', dwellings: [] }; byId.set(id, m); }
    const t = c[I.type];
    if (t === 'Appartement' || t === 'Maison') m.dwellings.push(c);
  }
  const out: DvfSale[] = [];
  for (const [id, m] of byId) {
    if (m.nature !== 'Vente' || !(m.value > 0) || m.dwellings.length !== 1) continue;
    const c = m.dwellings[0]!;
    const surface = Number(c[I.surface]);
    if (!(surface >= 9)) continue;
    const lat = Number(c[I.lat]), lon = Number(c[I.lon]);
    out.push({
      id, date: m.date, value: m.value, type: c[I.type] as DvfType, surface,
      rooms: Number(c[I.rooms]) || null, lat: Number.isFinite(lat) && c[I.lat] ? lat : null, lon: Number.isFinite(lon) && c[I.lon] ? lon : null,
      address: [c[I.num], c[I.voie], c[I.cp], c[I.commune]].filter(Boolean).join(' '),
    });
  }
  return out;
}

export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000, r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}
const round = (x: number, step: number) => Math.round(x / step) * step;

export const MIN_SALES = 8;

/** Pente de la régression linéaire de y sur x (0 si x ne varie pas). */
function slope(xs: number[], ys: number[]): number {
  const n = xs.length, mx = xs.reduce((s, x) => s + x, 0) / n, my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i]! - mx) * (ys[i]! - my); sxx += (xs[i]! - mx) ** 2; }
  return sxx > 0 ? sxy / sxx : 0;
}

/** Quantile pondéré : chaque valeur occupe une part de la distribution égale à son poids. */
export function weightedQuantile(items: { v: number; w: number }[], q: number): number {
  const sorted = [...items].sort((a, b) => a.v - b.v);
  const total = sorted.reduce((s, x) => s + x.w, 0);
  // position de chaque valeur : milieu de sa part de poids ; interpolation linéaire entre deux positions
  let acc = 0;
  const pos = sorted.map((x) => { const p = (acc + x.w / 2) / total; acc += x.w; return p; });
  if (q <= pos[0]!) return sorted[0]!.v;
  for (let i = 1; i < sorted.length; i++) {
    if (q <= pos[i]!) {
      const t = (q - pos[i - 1]!) / (pos[i]! - pos[i - 1]!);
      return sorted[i - 1]!.v + (sorted[i]!.v - sorted[i - 1]!.v) * t;
    }
  }
  return sorted.at(-1)!.v;
}

const yearsBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (365.25 * 864e5);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function tukey<T>(xs: T[], v: (x: T) => number): T[] {
  if (xs.length < 4) return xs;
  const sorted = xs.map(v).sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25), q3 = quantile(sorted, 0.75), iqr = q3 - q1;
  return xs.filter((x) => v(x) >= q1 - 1.5 * iqr && v(x) <= q3 + 1.5 * iqr);
}

/**
 * Estimation par comparaison pondérée :
 * 1. ventes du même type, prix au m² plausibles ;
 * 2. corrections apprises sur les ventes de la commune (valeurs extrêmes écartées, au moins 30 ventes) :
 *    évolution annuelle des prix (bornée à ±10 % par an) pour ramener chaque vente à aujourd'hui, et effet
 *    de la surface sur le prix au m² (élasticité bornée entre −0,35 et 0) pour la ramener à la surface du bien ;
 * 3. ventes de surface comparable les plus proches (rayon élargi jusqu'à en avoir assez), valeurs extrêmes écartées ;
 * 4. poids de chaque vente selon la distance (même immeuble : poids doublé), l'ancienneté, l'écart de surface et de pièces ;
 * 5. quartiles pondérés du prix au m² corrigé × surface, et indice de confiance.
 */
export function estimate(sales: DvfSale[], target: { type: DvfType; surface: number; rooms?: number | null; lat?: number | null; lon?: number | null; today?: string }): DvfEstimate | null {
  if (!(target.surface > 0)) return null;
  const located = target.lat != null && target.lon != null;
  let pool: DvfComparable[] = sales.filter((s) => s.type === target.type).map((s) => ({
    ...s, perM2: s.value / s.surface,
    distance: located && s.lat != null && s.lon != null ? distanceM(target.lat!, target.lon!, s.lat, s.lon) : null,
  })).filter((s) => s.perM2 >= 300 && s.perM2 <= 40000);
  if (pool.length < 3) return null;
  const today = target.today ?? pool.map((s) => s.date).sort().at(-1)!;

  const all = tukey(pool, (s) => s.perM2);
  let trend = 0, elasticity = 0;
  if (all.length >= 30) {
    const ages = all.map((s) => yearsBetween(s.date, today));
    // le prix au m² baisse quand l'ancienneté de la vente augmente si le marché monte : trend = −pente
    if (Math.max(...ages) - Math.min(...ages) >= 1) trend = clamp(-slope(ages, all.map((s) => Math.log(s.perM2))), -0.1, 0.1);
    const lnToday = all.map((s, i) => Math.log(s.perM2) + trend * ages[i]!);
    elasticity = clamp(slope(all.map((s) => Math.log(s.surface)), lnToday), -0.35, 0);
  }
  pool = pool.map((s) => ({ ...s, adjPerM2: s.perM2 * Math.exp(trend * Math.max(0, yearsBetween(s.date, today))) * (target.surface / s.surface) ** elasticity }));

  // surfaces comparables (de moitié à double), si l'échantillon le permet
  const similar = pool.filter((s) => s.surface >= target.surface * 0.5 && s.surface <= target.surface * 2);
  if (similar.length >= MIN_SALES) pool = similar;
  let radius: number | null = null;
  if (located) {
    for (const r of [300, 500, 800, 1200, 2000]) {
      const near = pool.filter((s) => s.distance !== null && s.distance <= r);
      if (near.length >= MIN_SALES * 2 || (r === 2000 && near.length >= MIN_SALES)) { pool = near; radius = r; break; }
    }
  }
  if (pool.length < 3) return null;
  pool = tukey(pool, (s) => s.adjPerM2!);

  const scale = Math.max(150, (radius ?? 1000) * 0.6);
  for (const s of pool) {
    const wd = s.distance === null ? 1 : Math.exp(-((s.distance / scale) ** 2)) * (s.distance < 20 ? 2 : 1);
    const wt = Math.exp(-Math.max(0, yearsBetween(s.date, today)) / 2);
    const ws = Math.exp(-Math.abs(Math.log(s.surface / target.surface)) / 0.4);
    const dr = target.rooms && s.rooms ? Math.abs(Math.min(s.rooms, 5) - Math.min(target.rooms, 5)) : null;
    const wr = dr === null || dr === 0 ? 1 : dr === 1 ? 0.6 : 0.3;
    s.weight = wd * wt * ws * wr;
  }
  const maxW = Math.max(...pool.map((s) => s.weight!));
  for (const s of pool) s.weight = Math.max(0.001, Math.round((s.weight! / maxW) * 1000) / 1000);
  const items = pool.map((s) => ({ v: s.adjPerM2!, w: s.weight! }));
  const p25 = weightedQuantile(items, 0.25), med = weightedQuantile(items, 0.5), p75 = weightedQuantile(items, 0.75);
  const sw = items.reduce((t, x) => t + x.w, 0), sw2 = items.reduce((t, x) => t + x.w * x.w, 0);
  const effective = Math.round(((sw * sw) / sw2) * 10) / 10;

  const dates = pool.map((s) => s.date).sort();
  const comparables = [...pool].sort((a, b) => b.weight! - a.weight! || b.date.localeCompare(a.date)).slice(0, 10)
    .map((c) => ({ ...c, adjPerM2: Math.round(c.adjPerM2!) }));
  return {
    low: round(p25 * target.surface, 1000), median: round(med * target.surface, 1000), high: round(p75 * target.surface, 1000),
    perM2: { p25: Math.round(p25), median: Math.round(med), p75: Math.round(p75) },
    count: pool.length, radius, from: dates[0]!, to: dates.at(-1)!, comparables,
    source: `DVF ${dates[0]!.slice(0, 4)}–${dates.at(-1)!.slice(0, 4)}, ${pool.length} ventes ${target.type === 'Maison' ? 'de maisons' : "d'appartements"} ${radius ? `à moins de ${radius} m` : 'dans la commune'}`,
    confidence: confidenceOf({ effective, dispersion: (p75 - p25) / med, radius, located, lastSale: dates.at(-1)!, today }),
    method: { trendPerYear: Math.round(trend * 1000) / 1000, sizeElasticity: Math.round(elasticity * 1000) / 1000, effective },
  };
}

const CONFIDENCE_LABELS = ['', 'Très faible', 'Faible', 'Moyenne', 'Bonne', 'Très bonne'] as const;

/** Indice de confiance : nombre de ventes vraiment comparables, écart entre elles, distance, fraîcheur. */
export function confidenceOf(c: { effective: number; dispersion: number; radius: number | null; located: boolean; lastSale: string; today: string }): DvfConfidence {
  let score = 5;
  const reasons: string[] = [];
  if (c.effective < 6) { score -= 2; reasons.push('Peu de ventes vraiment comparables.'); }
  else if (c.effective < 12) { score -= 1; reasons.push('Nombre de ventes comparables limité.'); }
  if (c.dispersion > 0.35) { score -= 2; reasons.push('Prix au m² très dispersés dans le secteur.'); }
  else if (c.dispersion > 0.22) { score -= 1; reasons.push('Prix au m² assez dispersés dans le secteur.'); }
  if (!c.located) { score -= 1; reasons.push('Adresse non localisée au numéro : ventes de toute la commune.'); }
  else if (c.radius === null || c.radius >= 1200) { score -= 1; reasons.push('Ventes comparables éloignées du bien.'); }
  if (yearsBetween(c.lastSale, c.today) > 1.5) { score -= 1; reasons.push('Pas de vente comparable récente.'); }
  const s = clamp(score, 1, 5) as DvfConfidence['score'];
  return { score: s, label: CONFIDENCE_LABELS[s], reasons };
}

/** Téléchargement des fichiers communaux (les années absentes sont ignorées). */
export async function loadSales(citycode: string, years: number[], fetchImpl: typeof fetch = fetch): Promise<DvfSale[]> {
  const parts = await Promise.all(years.map(async (y) => {
    const res = await fetchImpl(dvfUrl(y, citycode));
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`DVF ${y} : ${res.status}`);
    return salesFromCsv(await res.text());
  }));
  return parts.flat();
}
