import type { Expense, Lease, Payment } from '../data/types.ts';

/**
 * Loyers comptés une seule fois (ANO-013).
 *
 * Un loyer peut être enregistré deux fois : comme paiement sur le bail (Loyers et paiements)
 * et comme recette « Loyer » importée d'un relevé (Dépenses). Règle : pour un bien loué, les
 * loyers viennent de Loyers et paiements. Une recette importée est « déjà comptée » quand le
 * bail du bien a un paiement le même mois, ou un paiement du même montant à quelques jours
 * près (virement reçu en fin de mois, saisi au début du suivant). Sinon elle reste comptée :
 * rien ne se perd pour un mois sans paiement saisi, ni pour un bien sans bail.
 */

/** Écart toléré entre la date du relevé et celle du paiement saisi, pour un même montant. */
export const MATCH_DAYS = 7;

const ym = (d: string) => d.slice(0, 7);
const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
const sameAmount = (a: number, b: number) => Math.abs(a - b) < 0.005;
export const incomeDate = (e: Pick<Expense, 'paid_on' | 'expense_date'>) => e.paid_on ?? e.expense_date;

type LeaseRef = Pick<Lease, 'id' | 'property_id' | 'start_date' | 'end_date'>;
type PaymentRef = Pick<Payment, 'id' | 'lease_id' | 'amount' | 'paid_on'> & { period_month?: string | null };

export interface LeaseIncomeIndex {
  /** Biens ayant au moins un bail. */
  leased: Set<string>;
  /** « bien|AAAA-MM » ayant au moins un paiement (date du paiement ou mois de rattachement). */
  months: Set<string>;
  /** Paiements par bien. */
  byProperty: Map<string, PaymentRef[]>;
}

export function leaseIncomeIndex(leases: LeaseRef[], payments: PaymentRef[]): LeaseIncomeIndex {
  const propOf = new Map(leases.map((l) => [l.id, l.property_id]));
  const months = new Set<string>();
  const byProperty = new Map<string, PaymentRef[]>();
  for (const p of payments) {
    const prop = propOf.get(p.lease_id);
    if (!prop) continue;
    months.add(`${prop}|${ym(p.paid_on)}`);
    if (p.period_month) months.add(`${prop}|${ym(p.period_month)}`);
    byProperty.set(prop, [...(byProperty.get(prop) ?? []), p]);
  }
  return { leased: new Set(leases.map((l) => l.property_id)), months, byProperty };
}

/** Paiement saisi du même montant, à MATCH_DAYS jours près, sur un bail du bien. */
export function matchingPayment(idx: LeaseIncomeIndex, propertyId: string, date: string, amount: number): PaymentRef | null {
  let best: PaymentRef | null = null;
  for (const p of idx.byProperty.get(propertyId) ?? []) {
    if (!sameAmount(p.amount, amount) || days(p.paid_on, date) > MATCH_DAYS) continue;
    if (!best || days(p.paid_on, date) < days(best.paid_on, date)) best = p;
  }
  return best;
}

/** Paiements du bien rattachés à ce mois (date du paiement ou mois de rattachement). */
export function paymentsInMonth(idx: LeaseIncomeIndex, propertyId: string, month: string): PaymentRef[] {
  return (idx.byProperty.get(propertyId) ?? []).filter((p) => ym(p.paid_on) === month || (!!p.period_month && ym(p.period_month) === month));
}

/** La recette importée est-elle déjà comptée par un paiement saisi sur le bail ? */
export function isCoveredIncome(e: Pick<Expense, 'category' | 'payment_status' | 'property_id' | 'amount' | 'paid_on' | 'expense_date'>, idx: LeaseIncomeIndex): boolean {
  if (e.category !== 'loyer' || e.payment_status !== 'paye' || !idx.leased.has(e.property_id)) return false;
  const d = incomeDate(e);
  return idx.months.has(`${e.property_id}|${ym(d)}`) || !!matchingPayment(idx, e.property_id, d, e.amount);
}

/** Identifiants des recettes importées déjà comptées dans Loyers et paiements. */
export function coveredIncomeIds(expenses: Expense[], leases: LeaseRef[], payments: PaymentRef[]): Set<string> {
  const idx = leaseIncomeIndex(leases, payments);
  return new Set(expenses.filter((e) => isCoveredIncome(e, idx)).map((e) => e.id));
}

/** Bail du bien en cours à cette date (à défaut, le dernier commencé avant). */
export function leaseAt<L extends LeaseRef>(leases: L[], propertyId: string, date: string): L | null {
  const own = leases.filter((l) => l.property_id === propertyId && l.start_date <= date).sort((a, b) => b.start_date.localeCompare(a.start_date));
  return own.find((l) => !l.end_date || l.end_date >= date) ?? own[0] ?? null;
}

/** Recette importée en double d'un paiement saisi (nettoyage, volet 3). */
export interface IncomeDuplicate {
  expense: Expense;
  /** Paiement du même montant à quelques jours près ; null si seul le mois coïncide. */
  payment: PaymentRef | null;
  /** Même montant : suppression proposée par défaut. */
  identical: boolean;
}

export function incomeDuplicates(expenses: Expense[], leases: LeaseRef[], payments: PaymentRef[]): IncomeDuplicate[] {
  const idx = leaseIncomeIndex(leases, payments);
  const out: IncomeDuplicate[] = [];
  for (const e of expenses) {
    if (!isCoveredIncome(e, idx)) continue;
    const payment = matchingPayment(idx, e.property_id, incomeDate(e), e.amount);
    // même montant que le total saisi du mois : doublon aussi (loyer payé en plusieurs virements)
    const monthTotal = paymentsInMonth(idx, e.property_id, ym(incomeDate(e))).reduce((a, p) => a + p.amount, 0);
    out.push({ expense: e, payment, identical: !!payment || sameAmount(monthTotal, e.amount) });
  }
  return out.sort((a, b) => incomeDate(a.expense).localeCompare(incomeDate(b.expense)));
}
