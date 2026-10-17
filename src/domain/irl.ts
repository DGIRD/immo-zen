/**
 * Révision annuelle du loyer selon l'indice de référence des loyers (IRL, INSEE, France métropolitaine).
 * Nouveau loyer = loyer actuel × IRL du trimestre de référence de l'année de révision / IRL du même trimestre un an plus tôt.
 * Règles : une révision par an au plus, si le bail la prévoit ; non rétroactive (s'applique à la date de la demande
 * si elle est faite après la date anniversaire, et le droit se perd au bout d'un an) ; interdite pour un logement
 * classé F ou G au DPE (gel des loyers depuis le 24 août 2022 en métropole).
 * Source des valeurs : INSEE (Informations rapides, dernière publication du 15 octobre 2026). Une valeur absente se saisit à la main.
 */
import type { Lease } from '../data/types.ts';
import { round2 } from './simulator.ts';

export const IRL_VALUES: Record<string, number> = {
  '2019-T1': 129.38, '2019-T2': 129.72, '2019-T3': 129.99, '2019-T4': 130.26,
  '2020-T1': 130.57, '2020-T2': 130.57, '2020-T3': 130.59, '2020-T4': 130.52,
  '2021-T1': 130.69, '2021-T2': 131.12, '2021-T3': 131.67, '2021-T4': 132.62,
  '2022-T1': 133.93, '2022-T2': 135.84, '2022-T3': 136.27, '2022-T4': 137.26,
  '2023-T1': 138.61, '2023-T2': 140.59, '2023-T3': 141.03, '2023-T4': 142.06,
  '2024-T1': 143.46, '2024-T2': 145.17, '2024-T3': 144.51, '2024-T4': 144.64,
  '2025-T1': 145.47, '2025-T2': 146.68, '2025-T3': 145.77, '2025-T4': 145.78,
  '2026-T1': 146.60, '2026-T2': 148.37, '2026-T3': 148.06,
};
export const IRL_LAST_PUBLISHED = '2026-T3';

export const irlLabel = (key: string) => key.replace(/^(\d{4})-T(\d)$/, '$2e trimestre $1').replace(/^1e/, '1er');
export const irlKey = (year: number, quarter: number) => `${year}-T${quarter}`;
export const parseIrlKey = (key: string | null | undefined) => {
  const m = /^(\d{4})-T([1-4])$/.exec(key ?? '');
  return m ? { year: Number(m[1]), quarter: Number(m[2]) } : null;
};
/** Trimestres connus, du plus récent au plus ancien. */
export const IRL_KEYS = Object.keys(IRL_VALUES).sort().reverse();

/** Dernier IRL publié à une date donnée (publication environ 15 jours après la fin du trimestre). */
export function latestPublishedAt(isoDate: string): string | null {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  // T1 publié mi-avril, T2 mi-juillet, T3 mi-octobre, T4 mi-janvier de l'année suivante
  const pubs = IRL_KEYS.map((k) => {
    const p = parseIrlKey(k)!;
    const pubMonth = p.quarter * 3 + 1;
    const py = pubMonth > 12 ? p.year + 1 : p.year;
    return { k, pub: `${py}-${String(((pubMonth - 1) % 12) + 1).padStart(2, '0')}-15` };
  });
  const day = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return pubs.find((p) => p.pub <= day)?.k ?? null;
}

const addYears = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y + n, m, 0)).getUTCDate();
  return `${y + n}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
};

export type RevisionBlock = 'desactivee' | 'indice_base' | 'dpe' | 'pas_encore' | 'termine' | 'indice_inconnu';
export interface RevisionPlan {
  /** Date anniversaire de la révision en cours (anniversaire du bail). */
  anniversary: string;
  /** Date d'effet proposée (anniversaire, ou date du jour si la demande est tardive : pas de rétroactivité). */
  effective: string;
  late: boolean;
  oldKey: string | null;
  oldValue: number | null;
  newKey: string | null;
  newValue: number | null;
  currentRent: number;
  newRent: number | null;
  increasePct: number | null;
  block: RevisionBlock | null;
  message: string | null;
}

/** Année du dernier IRL publié pour le trimestre q à une date donnée. */
export function lastPublishedYear(quarter: number, isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const md = m * 100 + d;
  if (quarter < 4) return md >= (3 * quarter + 1) * 100 + 15 ? y : y - 1;
  return md >= 115 ? y - 1 : y - 2;
}

type RevisableLease = Pick<Lease, 'start_date' | 'end_date' | 'rent_hc'> & {
  irl_enabled?: boolean | null; irl_base_label?: string | null; irl_base_value?: number | null; last_revision_on?: string | null;
};

/**
 * Révision possible à la date du jour. L'augmentation suit la variation annuelle de l'IRL du trimestre
 * de référence (dernier publié à la date anniversaire, comparé au même trimestre un an plus tôt).
 */
export function revisionPlan(l: RevisableLease, today: string, dpe?: string | null, manualNewValue?: number | null, manualOldValue?: number | null): RevisionPlan {
  // première date anniversaire du bail postérieure à la dernière révision ; une année non réclamée est perdue
  const after = l.last_revision_on ?? l.start_date;
  let anniversary = addYears(l.start_date, 1);
  while (anniversary <= after) anniversary = addYears(anniversary, 1);
  while (addYears(anniversary, 1) <= today) anniversary = addYears(anniversary, 1);
  const late = anniversary < today;
  const effective = late ? today : anniversary;
  const base = parseIrlKey(l.irl_base_label);
  const newYear = base ? lastPublishedYear(base.quarter, anniversary) : null;
  const newKey = base && newYear ? irlKey(newYear, base.quarter) : null;
  const oldKey = base && newYear ? irlKey(newYear - 1, base.quarter) : null;
  const newValue = manualNewValue ?? (newKey ? IRL_VALUES[newKey] ?? null : null);
  const oldValue = manualOldValue ?? (oldKey ? IRL_VALUES[oldKey] ?? (oldKey === l.irl_base_label ? l.irl_base_value ?? null : null) : null);
  const newRent = oldValue && newValue ? round2(l.rent_hc * newValue / oldValue) : null;
  const plan: RevisionPlan = {
    anniversary, effective, late, oldKey, oldValue, newKey, newValue, currentRent: l.rent_hc, newRent,
    increasePct: newRent !== null && l.rent_hc ? round2((newRent / l.rent_hc - 1) * 100) : null, block: null, message: null,
  };
  const block = (b: RevisionBlock, m: string) => ({ ...plan, block: b, message: m });
  if (!l.irl_enabled) return block('desactivee', 'La révision annuelle n’est pas prévue dans ce bail (à activer dans la fiche du bail).');
  if (l.end_date && l.end_date < today) return block('termine', 'Bail terminé.');
  if (dpe === 'F' || dpe === 'G') return block('dpe', `Logement classé ${dpe} au DPE : la révision du loyer est interdite (gel des loyers des passoires thermiques depuis le 24 août 2022).`);
  if (!base) return block('indice_base', 'Indiquez dans le bail le trimestre de l’IRL de référence (celui figurant au bail).');
  if (anniversary > today) return block('pas_encore', `Prochaine révision possible à partir du ${anniversary.split('-').reverse().join('/')}.`);
  if (!newValue || !oldValue) return block('indice_inconnu', `Indice ${!newValue ? irlLabel(newKey!) : irlLabel(oldKey!)} inconnu : saisissez sa valeur (publiée par l’INSEE).`);
  return plan;
}
