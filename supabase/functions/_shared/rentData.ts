/**
 * Données de marché, partagées entre l'application (src/domain/marketRent.ts) et les fonctions serveur :
 * types, lecture des fichiers de la Carte des loyers et du modèle de plafonds d'encadrement.
 * Fonctions pures, sans dépendance : testées dans tests/marketRent.test.ts.
 */

export type RentSegment = 'appart' | 'appart_t1t2' | 'appart_t3plus' | 'maison';

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
  const iInsee = col('insee_c', 'insee', 'code_insee'), iLib = col('libgeo'), iMid = col('loypredm2'), iLow = col('lwr.ipm2', 'lwr_ipm2', 'lwr'), iHigh = col('upr.ipm2', 'upr_ipm2', 'upr');
  const iType = col('typpred', 'pred_type', 'typ_pred'), iR2 = col('r2_adj', 'r2'), iCom = col('nbobs_com'), iMail = col('nbobs_mail');
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

