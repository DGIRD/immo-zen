// Détection des doublons probables : paiements, échéances, dépenses.
// Une règle commune : même bail (ou bien), même montant, dates proches ; deux libellés ou références
// renseignés et différents écartent le doublon (ex. deux virements distincts le même jour).
import type { Expense, Payment, RentCharge } from '../data/types.ts';

/** Écart maximal, en jours, entre deux dates pour parler de doublon probable. */
export const DUPLICATE_DAYS = 3;

const day = (d: string) => Math.round(Date.parse(`${d.slice(0, 10)}T00:00:00Z`) / 86_400_000);
const near = (a: string, b: string, days = DUPLICATE_DAYS) => Math.abs(day(a) - day(b)) <= days;
const norm = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const cents = (n: number | null | undefined) => Math.round((n ?? 0) * 100);
/** Deux textes renseignés et différents : ce ne sont pas les mêmes opérations. */
const distinct = (a: string | null | undefined, b: string | null | undefined) => !!norm(a) && !!norm(b) && norm(a) !== norm(b);

type PaymentLike = Pick<Payment, 'lease_id' | 'amount' | 'paid_on' | 'reference'> & { id?: string };
export function samePayment(a: PaymentLike, b: PaymentLike): boolean {
  return a.lease_id === b.lease_id && cents(a.amount) === cents(b.amount) && near(a.paid_on, b.paid_on) && !distinct(a.reference, b.reference);
}

type ExpenseLike = Pick<Expense, 'property_id' | 'amount' | 'expense_date' | 'category' | 'label' | 'supplier'> & { id?: string };
export function sameExpense(a: ExpenseLike, b: ExpenseLike): boolean {
  if (a.property_id !== b.property_id || cents(a.amount) !== cents(b.amount)) return false;
  if (distinct(a.label, b.label) || distinct(a.supplier, b.supplier)) return false;
  // même jour : doublon quelle que soit la catégorie ; quelques jours d'écart : même catégorie
  return a.expense_date === b.expense_date || (a.category === b.category && near(a.expense_date, b.expense_date));
}

type ChargeLike = Pick<RentCharge, 'lease_id' | 'kind' | 'period_start' | 'period_end' | 'due_date' | 'rent_amount' | 'charges_amount' | 'label' | 'cancelled_at'> & { id?: string };
export function sameCharge(a: ChargeLike, b: ChargeLike): boolean {
  if (a.cancelled_at || b.cancelled_at || a.lease_id !== b.lease_id || a.kind !== b.kind) return false;
  // deux loyers sur des périodes qui se chevauchent
  if (a.kind === 'loyer') return a.period_start <= b.period_end && b.period_start <= a.period_end;
  // autres sommes dues : même montant, même échéance (à quelques jours près), libellés compatibles
  return cents(a.rent_amount + a.charges_amount) === cents(b.rent_amount + b.charges_amount) && near(a.due_date, b.due_date) && !distinct(a.label, b.label);
}

/** Lignes existantes qui feraient doublon avec une nouvelle saisie (la ligne elle-même exclue). */
export function findDuplicates<T extends { id: string }, C extends { id?: string }>(candidate: C, rows: T[], same: (a: C, b: T) => boolean): T[] {
  return rows.filter((r) => r.id !== candidate.id && same(candidate, r));
}

/**
 * Groupes de doublons probables : pour chaque groupe, la ligne conservée (la plus ancienne saisie)
 * puis les lignes en trop. `ids` contient toutes les lignes concernées, `extra` seulement les lignes en trop.
 */
export function duplicateGroups<T extends { id: string; created_at?: string }>(rows: T[], same: (a: T, b: T) => boolean, bucket: (r: T) => string) {
  const byBucket = new Map<string, T[]>();
  for (const r of rows) { const k = bucket(r); byBucket.set(k, [...(byBucket.get(k) ?? []), r]); }
  const groups: T[][] = [];
  for (const list of byBucket.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id));
    const seen = new Set<string>();
    for (const r of sorted) {
      if (seen.has(r.id)) continue;
      const g = [r, ...sorted.filter((x) => x.id !== r.id && !seen.has(x.id) && same(r, x))];
      if (g.length > 1) { g.forEach((x) => seen.add(x.id)); groups.push(g); }
    }
  }
  return {
    groups,
    ids: new Set(groups.flat().map((r) => r.id)),
    extra: groups.flatMap((g) => g.slice(1)),
  };
}

export const paymentDuplicates = (rows: Payment[]) => duplicateGroups(rows, samePayment, (p) => `${p.lease_id}|${cents(p.amount)}`);
export const expenseDuplicates = (rows: Expense[]) => duplicateGroups(rows, sameExpense, (e) => `${e.property_id}|${cents(e.amount)}`);
export const chargeDuplicates = (rows: RentCharge[]) => duplicateGroups(rows.filter((c) => !c.cancelled_at), sameCharge, (c) => `${c.lease_id}|${c.kind}`);
