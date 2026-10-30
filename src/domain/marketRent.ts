/**
 * Loyer de marché d'un bien : fourchette bas / central / haut, d'après la « Carte des loyers »
 * (ANIL, ministère chargé du Logement, data.gouv.fr), et plafond légal dans les territoires où
 * le niveau des loyers est encadré (loyer de référence majoré fixé par arrêté préfectoral).
 * Fonctions pures, sans dépendance à l'interface : testées dans tests/marketRent.test.ts.
 * Règles : docs/LOYERS-ET-TAUX.md.
 */
import type { PropertyType } from '../data/types.ts';

/** Fichiers de la Carte des loyers : un par segment de marché. */
export type RentSegment = 'appart' | 'appart_t1t2' | 'appart_t3plus' | 'maison';
export const RENT_SEGMENTS: RentSegment[] = ['appart', 'appart_t1t2', 'appart_t3plus', 'maison'];
export const SEGMENT_LABELS: Record<RentSegment, string> = {
  appart: 'Appartements (tous)', appart_t1t2: 'Appartements 1 et 2 pièces', appart_t3plus: 'Appartements 3 pièces et plus', maison: 'Maisons',
};
/** Surface du bien type de chaque segment (guide d'utilisation, millésime 2025). */
export const REFERENCE_SURFACE: Record<RentSegment, number> = { appart: 52, appart_t1t2: 37, appart_t3plus: 72, maison: 92 };
export const SOURCE_MENTION = 'Estimations ANIL, à partir des données du Groupe SeLoger et de leboncoin';

/** Coefficient appliqué par défaut à un bien meublé (les indicateurs portent sur des locations vides). */
export const DEFAULT_FURNISHED_COEF = 1.15;
/** Fourchette jugée trop large au-delà de cet écart (haut − bas) rapporté au loyer central. Réglable par l'administrateur. */
export const DEFAULT_WIDE_THRESHOLD = 0.6;
/** Écart de surface au bien type au-delà duquel la fiabilité est abaissée d'un cran. */
const SURFACE_GAP = 0.5;

export interface RentIndicator {
  vintage: number;
  segment: RentSegment;
  insee: string;
  libgeo: string | null;
  /** €/m²/mois, charges comprises, bien non meublé. */
  low: number;
  mid: number;
  high: number;
  level: 'commune' | 'epci' | 'maille';
  r2: number | null;
  nb_obs_commune: number | null;
  nb_obs_maille: number | null;
}

/** Plafond d'encadrement : une ligne de l'arrêté préfectoral (€/m²/mois hors charges). */
export interface RentCap {
  territory: string;
  insee: string;
  zone: string;
  /** Nombre de pièces ; 4 = 4 pièces et plus. */
  rooms: number;
  /** Années de construction couvertes (bornes incluses, null = ouverte). */
  year_min: number | null;
  year_max: number | null;
  furnished: boolean;
  ref: number;
  max: number;
  min: number;
  valid_from: string;
  valid_to: string | null;
}

/** Fin de l'expérimentation de l'encadrement (loi ELAN, art. 140, prolongée par la loi 3DS), sauf nouvelle loi. */
export const ENCADREMENT_END = '2026-11-23';

/**
 * Communes dont le niveau des loyers est encadré (état au 29/10/2026), pour signaler une commune
 * encadrée dont les plafonds n'ont pas encore été chargés. La table des plafonds fait foi ;
 * le Pays basque (24 communes) et Grenoble-Alpes Métropole (21 communes, dont 8 en partie) n'y sont connus que par elle.
 */
export const ENCADRED_INSEE: Record<string, string> = {
  ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`751${String(i + 1).padStart(2, '0')}`, 'Paris'])),
  75056: 'Paris',
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`6938${i + 1}`, 'Lyon et Villeurbanne'])),
  69123: 'Lyon et Villeurbanne', 69266: 'Lyon et Villeurbanne',
  59350: 'Lille, Hellemmes, Lomme',
  34172: 'Montpellier', 33063: 'Bordeaux',
  93006: 'Est Ensemble', 93008: 'Est Ensemble', 93010: 'Est Ensemble', 93045: 'Est Ensemble', 93048: 'Est Ensemble',
  93053: 'Est Ensemble', 93055: 'Est Ensemble', 93061: 'Est Ensemble', 93063: 'Est Ensemble',
  93001: 'Plaine Commune', 93027: 'Plaine Commune', 93031: 'Plaine Commune', 93039: 'Plaine Commune', 93059: 'Plaine Commune',
  93066: 'Plaine Commune', 93070: 'Plaine Commune', 93072: 'Plaine Commune', 93079: 'Plaine Commune',
};

// --------------------------------------------------------------------------- segment et commune

/** Segment de la Carte des loyers pour un bien (null : type non couvert). */
export function segmentFor(type: PropertyType | null | undefined, rooms: number | null | undefined): RentSegment | null {
  if (type === 'maison') return 'maison';
  if (type !== 'appartement') return null;
  if (!rooms || rooms < 1) return 'appart';
  return rooms <= 2 ? 'appart_t1t2' : 'appart_t3plus';
}

/** Paris, Lyon, Marseille : code d'arrondissement d'après le code postal, si le code de la commune entière est donné. */
export function arrondissementCode(citycode: string, zip: string | null | undefined): string | null {
  const z = (zip ?? '').trim();
  if (!/^\d{5}$/.test(z)) return null;
  const n = Number(z.slice(3));
  if (citycode === '75056' && z.startsWith('750') && n >= 1 && n <= 20) return `751${z.slice(3)}`;
  if (citycode === '75056' && z === '75116') return '75116';
  if (citycode === '69123' && z.startsWith('6900') && n >= 1 && n <= 9) return `6938${n}`;
  if (citycode === '13055' && z.startsWith('130') && n >= 1 && n <= 16) return `132${z.slice(3)}`;
  return null;
}

/**
 * Indicateur retenu : dernier millésime, segment demandé, sinon appartements tous types (repli signalé).
 */
export function pickIndicator(list: RentIndicator[], segment: RentSegment): { indicator: RentIndicator; fallback: boolean } | null {
  if (!list.length) return null;
  const vintage = Math.max(...list.map((r) => r.vintage));
  const cur = list.filter((r) => r.vintage === vintage);
  const exact = cur.find((r) => r.segment === segment);
  if (exact) return { indicator: exact, fallback: false };
  if (segment !== 'maison') {
    const all = cur.find((r) => r.segment === 'appart');
    if (all) return { indicator: all, fallback: true };
  }
  return null;
}

// --------------------------------------------------------------------------- plafonds d'encadrement

export function capsInForce(caps: RentCap[], today: string): RentCap[] {
  return caps.filter((c) => c.valid_from <= today && (!c.valid_to || today <= c.valid_to));
}

export function zonesFor(caps: RentCap[]): string[] {
  return [...new Set(caps.map((c) => c.zone))].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
}

export type CapStatus = 'ok' | 'none' | 'expired' | 'zone_needed' | 'rooms_needed' | 'year_needed' | 'not_found' | 'hors_zone';
export const CAP_STATUS_LABELS: Record<CapStatus, string> = {
  ok: 'Plafond légal appliqué',
  none: 'Commune sans encadrement du niveau des loyers',
  expired: 'Plafonds d’encadrement expirés : loyer haut de la Carte des loyers',
  zone_needed: 'Commune encadrée : choisissez la zone d’encadrement du logement',
  rooms_needed: 'Commune encadrée : renseignez le nombre de pièces pour trouver le plafond',
  year_needed: 'Commune encadrée : renseignez l’année de construction pour trouver le plafond',
  not_found: 'Commune encadrée : aucun plafond pour ces caractéristiques',
  hors_zone: 'Logement déclaré hors de la zone encadrée',
};
/** Zone choisie quand le logement est hors du périmètre encadré d'une commune partiellement couverte. */
export const HORS_ZONE = '__hors_zone__';

export interface CapQuery { zone: string | null; rooms: number | null; year: number | null; furnished: boolean; today: string }

/** Plafond applicable au logement, ou la raison pour laquelle il n'est pas déterminé. */
export function findCap(caps: RentCap[], q: CapQuery): { cap: RentCap | null; status: CapStatus; zones: string[] } {
  if (!caps.length) return { cap: null, status: 'none', zones: [] };
  const live = capsInForce(caps, q.today);
  if (!live.length) return { cap: null, status: caps.some((c) => c.valid_from > q.today) ? 'none' : 'expired', zones: [] };
  const zones = zonesFor(live);
  if (q.zone === HORS_ZONE) return { cap: null, status: 'hors_zone', zones };
  const zone = zones.length === 1 ? zones[0]! : q.zone && zones.includes(q.zone) ? q.zone : null;
  if (!zone) return { cap: null, status: 'zone_needed', zones };
  if (!q.rooms || q.rooms < 1) return { cap: null, status: 'rooms_needed', zones };
  const rooms = Math.min(4, Math.round(q.rooms));
  const sameKind = live.filter((c) => c.zone === zone && c.rooms === rooms && c.furnished === q.furnished);
  if (!sameKind.length) return { cap: null, status: 'not_found', zones };
  const periods = new Set(sameKind.map((c) => `${c.year_min}-${c.year_max}`));
  if (periods.size > 1 && !q.year) return { cap: null, status: 'year_needed', zones };
  const cap = sameKind.find((c) => periods.size === 1 || ((c.year_min === null || q.year! >= c.year_min) && (c.year_max === null || q.year! <= c.year_max)));
  return cap ? { cap, status: 'ok', zones } : { cap: null, status: 'not_found', zones };
}

// --------------------------------------------------------------------------- calcul de la fourchette

export type Reliability = 'bonne' | 'moyenne' | 'faible';
export const RELIABILITY_LABELS: Record<Reliability, string> = { bonne: 'Bonne', moyenne: 'Moyenne', faible: 'Faible' };

export interface MarketRentInput {
  indicator: RentIndicator;
  fallback?: boolean;
  surface: number;
  furnished?: boolean;
  /** Coefficient meublé (1,15 par défaut). */
  furnishedCoef?: number | null;
  /** Charges mensuelles du bien (provision ou charges annuelles / 12) ; null : inconnues. */
  chargesMonthly?: number | null;
  cap?: RentCap | null;
  wideThreshold?: number;
}

export interface MarketRent {
  segment: RentSegment;
  vintage: number;
  insee: string;
  libgeo: string | null;
  level: RentIndicator['level'];
  fallback: boolean;
  surface: number;
  coef: number;
  /** €/mois charges comprises, après coefficient meublé et plafond. */
  low: number;
  mid: number;
  high: number;
  /** Haut de marché (Carte des loyers) avant plafond, €/mois CC. */
  marketHigh: number;
  /** €/mois hors charges ; null si les charges du bien sont inconnues. */
  hc: { low: number; mid: number; high: number } | null;
  charges: number | null;
  /** Plafond légal (loyer de référence majoré × surface), €/mois hors charges. */
  capHc: number | null;
  capTerritory: string | null;
  capped: boolean;
  reliability: Reliability;
  reasons: string[];
}

const r0 = (x: number) => Math.round(x);

export function computeMarketRent(i: MarketRentInput): MarketRent {
  const ind = i.indicator;
  const coef = i.furnished ? (i.furnishedCoef && i.furnishedCoef > 0 ? i.furnishedCoef : DEFAULT_FURNISHED_COEF) : 1;
  const s = i.surface;
  const charges = i.chargesMonthly != null && i.chargesMonthly >= 0 ? i.chargesMonthly : null;
  let low = r0(ind.low * s * coef), mid = r0(ind.mid * s * coef), high = r0(ind.high * s * coef);
  const marketHigh = high;
  let capHc: number | null = null, capped = false;
  if (i.cap) {
    // le plafond légal devient le loyer haut ; les autres valeurs ne le dépassent jamais
    capHc = r0(i.cap.max * s);
    const capCc = capHc + (charges ?? 0);
    high = capCc;
    mid = Math.min(mid, capCc);
    low = Math.min(low, capCc);
    capped = true;
  }
  const hc = charges === null ? null : {
    low: Math.max(0, low - charges), mid: Math.max(0, mid - charges),
    high: capHc !== null ? capHc : Math.max(0, high - charges),
  };

  // fiabilité (guide d'utilisation de la Carte des loyers)
  const reasons: string[] = [];
  const wide = (ind.high - ind.low) / ind.mid > (i.wideThreshold ?? DEFAULT_WIDE_THRESHOLD);
  const lowR2 = ind.r2 !== null && ind.r2 < 0.5;
  const fewObs = ind.nb_obs_commune !== null && ind.nb_obs_commune < 30;
  let rank: 0 | 1 | 2 = 0;
  if (lowR2) reasons.push('Modèle peu ajusté aux loyers observés (R² inférieur à 0,5).');
  if (fewObs) reasons.push(`Moins de 30 annonces dans la commune (${ind.nb_obs_commune}).`);
  if (wide) reasons.push(`Fourchette très large : l’écart entre haut et bas dépasse ${Math.round((i.wideThreshold ?? DEFAULT_WIDE_THRESHOLD) * 100)} % du loyer central.`);
  if (lowR2 || fewObs || wide) rank = 2;
  else if (ind.level !== 'commune' || ind.r2 === null || ind.nb_obs_commune === null) rank = 1;
  if (ind.level === 'epci') reasons.push('Estimation à l’échelle de l’intercommunalité, faute d’annonces suffisantes dans la commune.');
  if (ind.level === 'maille') reasons.push('Estimation sur un regroupement de communes voisines comparables, faute d’annonces suffisantes dans la commune.');
  const ref = REFERENCE_SURFACE[ind.segment];
  if (Math.abs(s - ref) / ref > SURFACE_GAP) {
    rank = Math.min(2, rank + 1) as 0 | 1 | 2;
    reasons.push(s < ref
      ? `Petite surface (${ref} m² pour le bien type) : le loyer au m² réel est souvent plus haut.`
      : `Grande surface (${ref} m² pour le bien type) : le loyer au m² réel est souvent plus bas.`);
  }
  if (i.fallback) {
    rank = Math.min(2, rank + 1) as 0 | 1 | 2;
    reasons.push('Indicateur des appartements tous types utilisé : pas de donnée pour cette taille de logement dans la commune.');
  }
  return {
    segment: ind.segment, vintage: ind.vintage, insee: ind.insee, libgeo: ind.libgeo, level: ind.level, fallback: !!i.fallback,
    surface: s, coef, low, mid, high, marketHigh, hc, charges, capHc, capTerritory: i.cap?.territory ?? null, capped,
    reliability: (['bonne', 'moyenne', 'faible'] as const)[rank], reasons,
  };
}

/** Situation du loyer saisi (hors charges) par rapport à la fourchette. */
export type RentPosition = 'dessous' | 'dans' | 'dessus' | 'plafond';
export function rentPosition(rentHc: number | null | undefined, mr: MarketRent): { position: RentPosition; gapPct: number } | null {
  if (!rentHc || rentHc <= 0) return null;
  if (mr.capHc !== null && rentHc > mr.capHc) return { position: 'plafond', gapPct: pctGap(rentHc, mr.capHc) };
  const lo = mr.hc ? mr.hc.low : mr.low, hi = mr.hc ? mr.hc.high : mr.high;
  if (rentHc < lo) return { position: 'dessous', gapPct: pctGap(rentHc, lo) };
  if (rentHc > hi) return { position: 'dessus', gapPct: pctGap(rentHc, hi) };
  return { position: 'dans', gapPct: 0 };
}
const pctGap = (v: number, ref: number) => Math.round(((v - ref) / ref) * 1000) / 10;

/** Loyers au m² hors charges à reprendre dans le simulateur (fourchette basse et haute). */
export function simulatorRentM2(mr: MarketRent): { low: number; high: number } {
  const lo = mr.hc ? mr.hc.low : mr.low, hi = mr.hc ? mr.hc.high : mr.high;
  const r2 = (x: number) => Math.round((x / mr.surface) * 100) / 100;
  return { low: r2(lo), high: r2(hi) };
}

/** Fourchette enregistrée avec le bien (photographie : un nouveau millésime ne la change pas sans action). */
export interface MarketRentSnapshot {
  low: number; mid: number; high: number;
  hc: { low: number; mid: number; high: number } | null;
  cap_hc: number | null;
  cap_territory: string | null;
  vintage: number | null;
  segment: RentSegment | null;
  level: RentIndicator['level'] | null;
  reliability: Reliability | null;
  reasons: string[];
  coef: number;
  surface: number;
  source: 'auto' | 'manuel';
  on: string;
  /** Caractéristiques ayant servi au calcul : un changement relance le calcul automatique. */
  key?: string;
  cap_status?: CapStatus;
}

export function snapshotOf(mr: MarketRent, on: string): MarketRentSnapshot {
  return {
    low: mr.low, mid: mr.mid, high: mr.high, hc: mr.hc, cap_hc: mr.capHc, cap_territory: mr.capTerritory, vintage: mr.vintage, segment: mr.segment,
    level: mr.level, reliability: mr.reliability, reasons: mr.reasons, coef: mr.coef, surface: mr.surface, source: 'auto', on,
  };
}

// --------------------------------------------------------------------------- lecture des fichiers

/** Segment d'après le nom d'un fichier de la Carte des loyers (pred-app12-…, pred-app3-…, pred-mai-…, pred-app-…). */
export function segmentFromFileName(name: string): RentSegment | null {
  const n = name.toLowerCase();
  if (/app[-_ ]?12|t1[-_ ]?t2|1[-_ ]?2[-_ ]?pi/.test(n)) return 'appart_t1t2';
  if (/app[-_ ]?3|t3|3[-_ ]?pi/.test(n)) return 'appart_t3plus';
  if (/mai|maison/.test(n)) return 'maison';
  if (/app/.test(n)) return 'appart';
  return null;
}

/** Découpe une ligne CSV (séparateur donné, guillemets doublés). */
export function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function sepOf(header: string): string {
  const counts = [';', ',', '\t'].map((s) => [s, header.split(s).length] as const).sort((a, b) => b[1] - a[1]);
  return counts[0]![0];
}
const numFr = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const t = v.replace(/\s/g, '').replace(',', '.');
  if (!t || /^(na|nan|null)$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const norm = (h: string) => h.replace(/^﻿/, '').trim().toLowerCase().replace(/[\s_]+/g, '_');

/** Lignes d'un fichier de la Carte des loyers ; lève une erreur lisible si le format n'est pas reconnu. */
export function parseRentIndicatorsCsv(text: string, segment: RentSegment, vintage: number): RentIndicator[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = sepOf(lines[0]!);
  const head = splitCsvLine(lines[0]!, sep).map(norm);
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const iInsee = col('insee_c', 'insee', 'code_insee'), iLib = col('libgeo'), iMid = col('loypredm2'), iLow = col('lwr.ipm2'), iHigh = col('upr.ipm2');
  const iType = col('typpred'), iR2 = col('r2_adj', 'r2'), iCom = col('nbobs_com'), iMail = col('nbobs_mail');
  if (iInsee < 0 || iMid < 0 || iLow < 0 || iHigh < 0) {
    throw new Error('Format non reconnu : colonnes INSEE_C, loypredm2, lwr.IPm2 et upr.IPm2 attendues (fichier de la Carte des loyers).');
  }
  const out: RentIndicator[] = [];
  for (const l of lines.slice(1)) {
    const v = splitCsvLine(l, sep);
    const insee = (v[iInsee] ?? '').toUpperCase().padStart(5, '0');
    const mid = numFr(v[iMid]), low = numFr(v[iLow]), high = numFr(v[iHigh]);
    if (!/^[0-9AB]{5}$/.test(insee) || !mid || !low || !high || mid <= 0 || low <= 0 || high < low) continue;
    const t = (v[iType] ?? '').toLowerCase();
    out.push({
      vintage, segment, insee, libgeo: iLib >= 0 ? (v[iLib] || null) : null,
      low: Math.round(low * 100) / 100, mid: Math.round(mid * 100) / 100, high: Math.round(high * 100) / 100,
      level: t.startsWith('comm') || t.startsWith('arr') ? 'commune' : t.startsWith('epci') ? 'epci' : 'maille',
      r2: iR2 >= 0 ? numFr(v[iR2]) : null,
      nb_obs_commune: iCom >= 0 ? (numFr(v[iCom]) === null ? null : Math.round(numFr(v[iCom])!)) : null,
      nb_obs_maille: iMail >= 0 ? (numFr(v[iMail]) === null ? null : Math.round(numFr(v[iMail])!)) : null,
    });
  }
  return out;
}

/** En-tête du modèle de fichier des plafonds d'encadrement (docs/modeles/plafonds-encadrement.csv). */
export const CAPS_HEADER = 'territoire;code_insee;zone;pieces;annee_min;annee_max;meuble;loyer_reference;loyer_majore;loyer_minore;debut;fin';

/** Lit le fichier des plafonds ; `defaultEnd` complète une fin de validité vide. Erreurs avec numéro de ligne. */
export function parseRentCapsCsv(text: string, defaultEnd: string | null = ENCADREMENT_END): RentCap[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = sepOf(lines[0]!);
  const head = splitCsvLine(lines[0]!, sep).map(norm);
  const need = ['territoire', 'code_insee', 'zone', 'pieces', 'annee_min', 'annee_max', 'meuble', 'loyer_reference', 'loyer_majore', 'loyer_minore', 'debut', 'fin'];
  const missing = need.filter((n) => !head.includes(n));
  if (missing.length) throw new Error(`Colonnes manquantes : ${missing.join(', ')}. En-tête attendu : ${CAPS_HEADER}`);
  const at = (v: string[], n: string) => v[head.indexOf(n)] ?? '';
  const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  const out: RentCap[] = [];
  lines.slice(1).forEach((l, k) => {
    const v = splitCsvLine(l, sep);
    const line = k + 2;
    const insee = at(v, 'code_insee').toUpperCase().padStart(5, '0');
    const rooms = numFr(at(v, 'pieces'));
    const ref = numFr(at(v, 'loyer_reference')), max = numFr(at(v, 'loyer_majore')), min = numFr(at(v, 'loyer_minore'));
    const from = at(v, 'debut'), to = at(v, 'fin') || defaultEnd || '';
    const meuble = at(v, 'meuble').toLowerCase();
    if (!at(v, 'territoire')) throw new Error(`Ligne ${line} : territoire manquant.`);
    if (!/^[0-9AB]{5}$/.test(insee)) throw new Error(`Ligne ${line} : code INSEE invalide.`);
    if (!rooms || rooms < 1 || rooms > 4) throw new Error(`Ligne ${line} : nombre de pièces de 1 à 4 (4 = 4 et plus).`);
    if (!ref || !max || !min || !(min <= ref && ref <= max)) throw new Error(`Ligne ${line} : loyers minoré ≤ référence ≤ majoré attendus.`);
    if (!isDate(from) || (to && !isDate(to)) || (to && to < from)) throw new Error(`Ligne ${line} : dates AAAA-MM-JJ attendues (début ≤ fin).`);
    out.push({
      territory: at(v, 'territoire'), insee, zone: at(v, 'zone') || 'Unique', rooms: Math.round(rooms),
      year_min: numFr(at(v, 'annee_min')), year_max: numFr(at(v, 'annee_max')),
      furnished: ['1', 'oui', 'true', 'meuble', 'meublé', 'o'].includes(meuble),
      ref, max, min, valid_from: from, valid_to: to || null,
    });
  });
  return out;
}
