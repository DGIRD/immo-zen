import type { Allocation, DepositMovement, Expense, Lease, Payment, Property, RentCharge, TaxPropertyInputs } from '../../src/data/types.ts';
import type { BilanData } from '../../src/domain/bilan.ts';

/** Meublé acheté en 2024 avec crédit, bail depuis mars 2024, dépôt encaissé. */
export const prop = {
  id: 'p1', title: 'T2', status: 'acquis', tax_regime: 'reel_bic', ownership_mode: 'nom_propre', acquired_at: '2024-01-01', acquisition_cost: 200000,
  loan_amount: 150000, loan_rate: 3, loan_years: 20, loan_start_date: '2024-02-05', vigilance: [], acquisition_snapshot: null,
} as unknown as Property;
export const lease = { id: 'l1', property_id: 'p1', label: 'Bail 1', start_date: '2024-03-01', end_date: null, rent_hc: 800, charges_amount: 100, deposit_amount: 800 } as unknown as Lease;

/** Échéances mensuelles de mars 2024 à décembre 2025, payées le 5 du mois sauf celles indiquées. */
export function rentData(unpaid: string[] = []) {
  const charges: RentCharge[] = [], payments: Payment[] = [], allocations: Allocation[] = [];
  for (let y = 2024; y <= 2025; y++) for (let m = y === 2024 ? 3 : 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0'), id = `c${y}${mm}`;
    charges.push({ id, lease_id: 'l1', kind: 'loyer', period_start: `${y}-${mm}-01`, period_end: `${y}-${mm}-28`, due_date: `${y}-${mm}-01`, rent_amount: 800, charges_amount: 100, cancelled_at: null } as unknown as RentCharge);
    if (unpaid.includes(`${y}-${mm}`)) continue;
    payments.push({ id: `p${id}`, lease_id: 'l1', amount: 900, paid_on: `${y}-${mm}-05` } as unknown as Payment);
    allocations.push({ id: `a${id}`, payment_id: `p${id}`, charge_id: id, amount: 900 } as unknown as Allocation);
  }
  return { charges, payments, allocations };
}
let n = 0;
export const exp = (category: Expense['category'], amount: number, d: string, o: Partial<Expense> = {}) =>
  ({ id: `e${++n}`, property_id: 'p1', expense_date: d, paid_on: d, amount, category, nature: 'charge', recoverable_amount: 0, payment_status: 'paye', ...o } as unknown as Expense);
export const deposits: DepositMovement[] = [{ id: 'd1', lease_id: 'l1', kind: 'encaissement', amount: 800, occurred_on: '2024-03-01' } as unknown as DepositMovement];
export const expenses = [
  exp('copropriete', 1200, '2024-06-01'), exp('taxe_fonciere', 900, '2024-10-15'), exp('mobilier', 4000, '2024-02-20', { nature: 'immobilisation' }),
  exp('copropriete', 1250, '2025-06-01'), exp('taxe_fonciere', 950, '2025-10-15'), exp('assurance', 180, '2025-01-10'),
];
export const data = (o: Partial<BilanData> = {}): BilanData => ({ properties: [prop], leases: [lease], ...rentData(), expenses, deposits, ...o });
export const none = () => ({} as TaxPropertyInputs);

