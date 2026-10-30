/**
 * Taux de crédit immobilier selon la durée :
 * - barème de taux nominaux hors assurance (10, 15, 20, 25 ans…), mis à jour par l'administrateur
 *   (ou par une source sous licence) ; une durée intermédiaire est interpolée ;
 * - taux effectifs moyens et taux d'usure publiés chaque trimestre par la Banque de France,
 *   par tranche de durée (particuliers et personnes morales, dont les SCI) ;
 * - TAEG estimé d'un financement, comparé au taux d'usure.
 * Fonctions pures : testées dans tests/loanRates.test.ts. Règles : docs/LOYERS-ET-TAUX.md.
 */

export type Borrower = 'particulier' | 'personne_morale';
export type UsuryBracket = 'moins_10' | '10_20' | '20_plus' | 'variable' | 'relais';
export const BRACKET_LABELS: Record<UsuryBracket, string> = {
  moins_10: 'Taux fixe, moins de 10 ans', '10_20': 'Taux fixe, 10 à moins de 20 ans', '20_plus': 'Taux fixe, 20 ans et plus',
  variable: 'Taux variable', relais: 'Prêt relais',
};
export const BORROWER_LABELS: Record<Borrower, string> = { particulier: 'Particulier', personne_morale: 'Personne morale (SCI)' };

export interface RateBenchmark { effective_on: string; years: number; rate: number; source: string }
export interface UsuryRate {
  quarter: string; borrower: Borrower; bracket: UsuryBracket;
  /** Taux effectif moyen pratiqué au trimestre précédent (TAEG, %). */
  average: number | null;
  /** Taux d'usure (TAEG maximum légal, %). */
  usury: number;
  valid_from: string; valid_to: string;
}

/** Barème périmé au-delà de ce nombre de jours sans mise à jour. */
export const STALE_DAYS = 45;
/** Écart de taux au-delà duquel une renégociation mérite d'être étudiée (points). */
export const DEFAULT_RENEGOTIATION_GAP = 0.7;
/** Écart appliqué aux scénarios de taux bas et haut (points). */
export const RATE_SCENARIO_STEP = 0.3;

/**
 * Taux d'usure en vigueur du 1er octobre au 31 décembre 2026 (Banque de France, Taux d'usure 2026-Q4,
 * mis en ligne le 28/09/2026 ; taux effectifs moyens du 3e trimestre 2026).
 */
export const USURY_2026_Q4: UsuryRate[] = ([
  ['particulier', 'moins_10', 3.07, 4.09], ['particulier', '10_20', 3.51, 4.68], ['particulier', '20_plus', 4.05, 5.40],
  ['particulier', 'variable', 4.14, 5.52], ['particulier', 'relais', 4.87, 6.49],
  ['personne_morale', 'moins_10', 4.47, 5.96], ['personne_morale', '10_20', 4.45, 5.93], ['personne_morale', '20_plus', 4.37, 5.83],
] as const).map(([borrower, bracket, average, usury]) => ({ quarter: '2026-Q4', borrower, bracket, average, usury, valid_from: '2026-10-01', valid_to: '2026-12-31' }));

export function bracketFor(years: number): 'moins_10' | '10_20' | '20_plus' {
  return years < 10 ? 'moins_10' : years < 20 ? '10_20' : '20_plus';
}

/** Trimestre civil d'une date et ses bornes. */
export function quarterOf(day: string): { quarter: string; from: string; to: string } {
  const y = Number(day.slice(0, 4)), q = Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1;
  const m1 = (q - 1) * 3 + 1, m3 = m1 + 2;
  const last = new Date(Date.UTC(y, m3, 0)).getUTCDate();
  const p = (n: number) => String(n).padStart(2, '0');
  return { quarter: `${y}-Q${q}`, from: `${y}-${p(m1)}-01`, to: `${y}-${p(m3)}-${p(last)}` };
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Barème en vigueur : la date d'effet la plus récente, au plus tard aujourd'hui. */
export function currentBenchmarks(list: RateBenchmark[], today: string): { on: string; rows: RateBenchmark[] } | null {
  const dates = [...new Set(list.filter((b) => b.effective_on <= today).map((b) => b.effective_on))].sort();
  const on = dates.at(-1);
  if (!on) return null;
  return { on, rows: list.filter((b) => b.effective_on === on).sort((a, b) => a.years - b.years) };
}

export interface ProposedRate { rate: number; on: string; source: string; stale: boolean; interpolated: boolean; extrapolated: boolean }

/** Taux nominal proposé pour une durée : interpolation linéaire entre les deux durées voisines du barème. */
export function proposedRate(list: RateBenchmark[], years: number, today: string): ProposedRate | null {
  const cur = currentBenchmarks(list, today);
  if (!cur || !(years > 0)) return null;
  const rows = cur.rows;
  const stale = daysBetween(cur.on, today) > STALE_DAYS;
  const base = { on: cur.on, source: rows[0]!.source, stale };
  const exact = rows.find((r) => r.years === years);
  if (exact) return { ...base, rate: exact.rate, source: exact.source, interpolated: false, extrapolated: false };
  const below = [...rows].reverse().find((r) => r.years < years), above = rows.find((r) => r.years > years);
  if (below && above) {
    const t = (years - below.years) / (above.years - below.years);
    return { ...base, rate: Math.round((below.rate + t * (above.rate - below.rate)) * 100) / 100, interpolated: true, extrapolated: false };
  }
  // hors du barème : taux de la durée la plus proche, signalé
  const nearest = (below ?? above)!;
  return { ...base, rate: nearest.rate, source: nearest.source, interpolated: false, extrapolated: true };
}

/** Taux d'usure applicable à la date, pour l'emprunteur et la durée (taux fixe). */
export function usuryFor(list: UsuryRate[], borrower: Borrower, years: number, today: string, bracket: UsuryBracket = bracketFor(years)): UsuryRate | null {
  return list.find((u) => u.borrower === borrower && u.bracket === bracket && u.valid_from <= today && today <= u.valid_to) ?? null;
}

/** Dernier taux d'usure connu, même échu (pour signaler « Plafond non à jour »). */
export function latestUsury(list: UsuryRate[], borrower: Borrower, bracket: UsuryBracket): UsuryRate | null {
  return list.filter((u) => u.borrower === borrower && u.bracket === bracket).sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0] ?? null;
}

export interface TaegInput {
  amount: number;
  /** Taux nominal annuel (%). */
  rate: number;
  years: number;
  /** Assurance emprunteur, % du capital initial par an. */
  insuranceRate: number;
  /** Frais de dossier, de garantie et de courtage payés au départ (€). */
  fees: number;
}

/**
 * TAEG estimé (%), taux actuariel annuel (1 + i)^12 − 1, i solution de :
 * capital − frais = Σ (mensualité + assurance) / (1 + i)^k. Prêt amortissable à échéances constantes, sans différé.
 */
export function estimateTaeg(t: TaegInput): number | null {
  const n = Math.round(t.years * 12);
  if (!(t.amount > 0) || n <= 0 || t.rate < 0 || t.insuranceRate < 0 || t.fees < 0 || t.fees >= t.amount) return null;
  const m = t.rate / 100 / 12;
  const payment = m === 0 ? t.amount / n : (t.amount * m) / (1 - (1 + m) ** -n);
  const flow = payment + (t.amount * t.insuranceRate) / 100 / 12;
  const net = t.amount - t.fees;
  const pv = (i: number) => (i === 0 ? flow * n : (flow * (1 - (1 + i) ** -n)) / i);
  let lo = 0, hi = 0.05;
  if (pv(lo) <= net) return 0;
  while (pv(hi) > net && hi < 1) hi *= 2;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > net) lo = mid; else hi = mid;
  }
  return Math.round(((1 + (lo + hi) / 2) ** 12 - 1) * 10000) / 100;
}

export type UsuryStatus = 'ok' | 'proche' | 'depasse';
/** « proche » : moins de 0,25 point sous le plafond. */
export function usuryStatus(taeg: number, usury: number): UsuryStatus {
  return taeg > usury ? 'depasse' : usury - taeg < 0.25 ? 'proche' : 'ok';
}

/** Taux bas, de référence et haut pour une comparaison de scénarios. */
export function rateScenarios(reference: number, step = RATE_SCENARIO_STEP): { label: string; rate: number }[] {
  const r = (x: number) => Math.max(0, Math.round(x * 100) / 100);
  return [{ label: 'Taux bas', rate: r(reference - step) }, { label: 'Taux de référence', rate: r(reference) }, { label: 'Taux haut', rate: r(reference + step) }];
}

/** Durée restante d'un crédit (années, arrondie au supérieur), d'après sa première échéance. */
export function remainingYears(years: number | null | undefined, start: string | null | undefined, today: string): number | null {
  if (!years || !start) return null;
  const months = (Number(today.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + (Number(today.slice(5, 7)) - Number(start.slice(5, 7)));
  const left = years * 12 - Math.max(0, months);
  return left <= 0 ? 0 : Math.ceil(left / 12);
}

/** Écart entre le taux d'un crédit en cours et le barème de sa durée restante ; renégociation à étudier au-delà du seuil. */
export function renegotiation(currentRate: number | null | undefined, market: number | null | undefined, threshold = DEFAULT_RENEGOTIATION_GAP): { gap: number; worth: boolean } | null {
  if (currentRate == null || market == null) return null;
  const gap = Math.round((currentRate - market) * 100) / 100;
  return { gap, worth: gap >= threshold };
}

/** Valeurs par défaut du TAEG estimé quand la simulation ne précise pas les frais. */
export const TAEG_DEFAULTS = { insuranceRate: 0.3, dossierFees: 1000, guaranteeShare: 0.01 };
