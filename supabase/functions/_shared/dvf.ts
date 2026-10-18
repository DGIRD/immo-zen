/**
 * Estimation d'un bien à partir des ventes publiques « Demandes de valeurs foncières » géolocalisées
 * (DVF, DGFiP / Etalab, Licence Ouverte 2.0) : un fichier CSV par commune et par année.
 * Méthode : ventes d'un seul logement du même type (appartement ou maison), les plus proches
 * (rayon élargi jusqu'à obtenir assez de ventes), surfaces comparables ; prix au m² aux 1er quartile,
 * médiane et 3e quartile, appliqués à la surface du bien. Valeurs non indexées sur l'évolution des prix.
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

export interface DvfComparable extends DvfSale { perM2: number; distance: number | null }

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
}

/** Département du fichier : 2 caractères, 3 pour l'outre-mer (97x), 2A/2B pour la Corse. */
export function departmentOf(citycode: string): string {
  return citycode.startsWith('97') ? citycode.slice(0, 3) : citycode.slice(0, 2);
}
export function dvfUrl(year: number, citycode: string): string {
  return `${DVF_BASE}/${year}/communes/${departmentOf(citycode)}/${citycode}.csv`;
}
/** Années à consulter : les trois dernières publiées (l'année en cours n'est publiée qu'en partie, plus tard). */
export function dvfYears(today: string): number[] {
  const y = Number(today.slice(0, 4));
  return [y - 1, y - 2, y - 3];
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

export function estimate(sales: DvfSale[], target: { type: DvfType; surface: number; lat?: number | null; lon?: number | null }): DvfEstimate | null {
  if (!(target.surface > 0)) return null;
  let pool: DvfComparable[] = sales.filter((s) => s.type === target.type).map((s) => ({
    ...s, perM2: s.value / s.surface,
    distance: target.lat != null && target.lon != null && s.lat != null && s.lon != null ? distanceM(target.lat, target.lon, s.lat, s.lon) : null,
  })).filter((s) => s.perM2 >= 300 && s.perM2 <= 40000);
  // surfaces comparables (de moitié à double), si l'échantillon le permet
  const similar = pool.filter((s) => s.surface >= target.surface * 0.5 && s.surface <= target.surface * 2);
  if (similar.length >= MIN_SALES) pool = similar;
  let radius: number | null = null;
  if (target.lat != null && target.lon != null) {
    for (const r of [300, 500, 800, 1200, 2000]) {
      const near = pool.filter((s) => s.distance !== null && s.distance <= r);
      if (near.length >= MIN_SALES * 2 || (r === 2000 && near.length >= MIN_SALES)) { pool = near; radius = r; break; }
    }
  }
  if (pool.length < 3) return null;
  // écart des valeurs extrêmes (règle de Tukey)
  let prices = pool.map((s) => s.perM2).sort((a, b) => a - b);
  const q1 = quantile(prices, 0.25), q3 = quantile(prices, 0.75), iqr = q3 - q1;
  pool = pool.filter((s) => s.perM2 >= q1 - 1.5 * iqr && s.perM2 <= q3 + 1.5 * iqr);
  prices = pool.map((s) => s.perM2).sort((a, b) => a - b);
  const p25 = quantile(prices, 0.25), med = quantile(prices, 0.5), p75 = quantile(prices, 0.75);
  const dates = pool.map((s) => s.date).sort();
  const comparables = [...pool].sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0) || b.date.localeCompare(a.date)).slice(0, 10);
  return {
    low: round(p25 * target.surface, 1000), median: round(med * target.surface, 1000), high: round(p75 * target.surface, 1000),
    perM2: { p25: Math.round(p25), median: Math.round(med), p75: Math.round(p75) },
    count: pool.length, radius, from: dates[0]!, to: dates.at(-1)!, comparables,
    source: `DVF ${dates[0]!.slice(0, 4)}–${dates.at(-1)!.slice(0, 4)}, ${pool.length} ventes ${target.type === 'Maison' ? 'de maisons' : "d'appartements"} ${radius ? `à moins de ${radius} m` : 'dans la commune'}`,
  };
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
