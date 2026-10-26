import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pdfLib from 'pdf-lib';
import type { Allocation, Expense, Lease, Payment, RentCharge } from '../src/data/types.ts';
import {
  autoAllocate, chargeStatus, chargeViews, checkAllocation, daysInMonth, eur, expenseTotals, leaseLedger, leaseState, planCharges,
  propertyRentalSummary, renderTemplate, DEFAULT_REMINDER_TEMPLATES,
} from '../src/domain/rental.ts';
import { buildReceiptPdf, pdfSafe, receiptLines, type ReceiptData } from '../supabase/functions/_shared/receiptPdf.ts';

const base = { user_id: 'u', version: 1, created_at: '', updated_at: '' };
const lease = (o: Partial<Lease> = {}): Lease => ({
  ...base, id: 'L1', property_id: 'P1', label: null, furnished: false, start_date: '2026-01-15', end_date: null, rent_hc: 900, charges_amount: 60,
  charges_mode: 'provision', deposit_amount: 900, payment_day: 5, landlord_name: 'A', landlord_address: null, owner_confirmation_email: false,
  receipt_auto_send: false, reminder_enabled: false, reminder_delay_days: 10, notes: null, ...o,
});
const charge = (id: string, start: string, due: string, rent: number, ch = 0, o: Partial<RentCharge> = {}): RentCharge => ({
  ...base, id, lease_id: 'L1', kind: 'loyer', period_start: start, period_end: start, due_date: due, rent_amount: rent, charges_amount: ch, label: null, cancelled_at: null, ...o,
});
const pay = (id: string, amount: number, date = '2026-02-01'): Payment => ({
  ...base, id, lease_id: 'L1', amount, paid_on: date, date_defaulted: false, method: 'virement', reference: null, comment: null, source: 'saisie',
});
const alloc = (payment_id: string, charge_id: string, amount: number): Allocation => ({ id: `${payment_id}-${charge_id}`, user_id: 'u', payment_id, charge_id, amount, created_at: '' });

test('échéancier : mêmes résultats que la fonction SQL (prorata, jour de paiement)', () => {
  const p = planCharges(lease(), '2026-03-31');
  assert.equal(p.length, 3);
  assert.deepEqual(p[0], { period_start: '2026-01-15', period_end: '2026-01-31', due_date: '2026-01-15', rent_amount: 493.55, charges_amount: 32.9 });
  assert.deepEqual(p[1], { period_start: '2026-02-01', period_end: '2026-02-28', due_date: '2026-02-05', rent_amount: 900, charges_amount: 60 });
});

test('échéancier : bail terminé en cours de mois, année bissextile, bail futur', () => {
  const p = planCharges(lease({ start_date: '2028-02-01', end_date: '2028-02-10', payment_day: 15 }), '2028-12-31');
  assert.equal(p.length, 1);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(p[0]!.rent_amount, Math.round(900 * 10 / 29 * 100) / 100);
  assert.equal(p[0]!.due_date, '2028-02-10', 'échéance ramenée à la fin du bail');
  assert.equal(planCharges(lease({ start_date: '2027-01-01' }), '2026-12-31').length, 0);
  const year = planCharges(lease({ start_date: '2026-11-01' }), '2027-02-15');
  assert.deepEqual(year.map((c) => c.period_start), ['2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01'], 'passage d’année');
});

test('état du bail', () => {
  assert.equal(leaseState(lease(), '2026-01-01'), 'a_venir');
  assert.equal(leaseState(lease(), '2026-06-01'), 'actif');
  assert.equal(leaseState(lease({ end_date: '2026-05-31' }), '2026-06-01'), 'termine');
});

test('statuts des échéances : payée, partielle, impayée, à venir, annulée', () => {
  const c = charge('C', '2026-02-01', '2026-02-05', 900, 60);
  assert.equal(chargeStatus(c, 960, '2026-03-01'), 'payee');
  assert.equal(chargeStatus(c, 100, '2026-03-01'), 'partielle');
  assert.equal(chargeStatus(c, 0, '2026-03-01'), 'impayee');
  assert.equal(chargeStatus(c, 0, '2026-02-01'), 'a_venir');
  assert.equal(chargeStatus({ ...c, cancelled_at: 'x' }, 0, '2026-03-01'), 'annulee');
});

test('solde : calculé depuis les échéances et paiements ; trop-perçu et avance', () => {
  const charges = [charge('J', '2026-01-01', '2026-01-05', 500), charge('F', '2026-02-01', '2026-02-05', 500), charge('X', '2026-03-01', '2026-03-05', 500, 0, { cancelled_at: 'x' })];
  const payments = [pay('p1', 300), pay('p2', 900)];
  const allocations = [alloc('p1', 'J', 300), alloc('p2', 'J', 200), alloc('p2', 'F', 500)];
  const l = leaseLedger(charges, payments, allocations, '2026-03-10');
  assert.equal(l.due, 1000, 'échéance annulée exclue');
  assert.equal(l.received, 1200);
  assert.equal(l.balance, 200, 'trop-perçu de 200 €');
  assert.equal(l.unallocated, 200);
  assert.equal(l.overdue, 0);
  const debt = leaseLedger(charges, [pay('p1', 300)], [alloc('p1', 'J', 300)], '2026-03-10');
  assert.equal(debt.balance, -700);
  assert.equal(debt.overdue, 700);
});

test('répartition automatique : de la plus ancienne échéance à la plus récente, reste en avance', () => {
  const views = chargeViews([charge('F', '2026-02-01', '2026-02-05', 500), charge('J', '2026-01-01', '2026-01-05', 500)], [alloc('p0', 'J', 450)], '2026-03-01');
  const plan = autoAllocate(700, views);
  assert.deepEqual(plan.allocations, [{ charge_id: 'J', amount: 50 }, { charge_id: 'F', amount: 500 }]);
  assert.equal(plan.remainder, 150);
});

test('répartition manuelle : refus des dépassements', () => {
  const views = chargeViews([charge('J', '2026-01-01', '2026-01-05', 500)], [], '2026-03-01');
  assert.equal(checkAllocation(600, [{ charge_id: 'J', amount: 500 }], views), null);
  assert.match(checkAllocation(600, [{ charge_id: 'J', amount: 550 }], views)!, /dépasse le reste dû/);
  assert.match(checkAllocation(100, [{ charge_id: 'J', amount: 200 }], views)!, /dépasse le reste dû|dépasse le montant/);
  assert.match(checkAllocation(0, [], views)!, /positif/);
});

test('synthèse par bien : encaissements, dépenses payées, cash-flow réel de l’année', () => {
  const expenses: Expense[] = [
    { ...base, id: 'e1', property_id: 'P1', expense_date: '2026-02-01', supplier: null, label: null, amount: 1200, category: 'taxe_fonciere', nature: 'charge', recoverable_amount: 150, payment_status: 'paye', paid_on: '2026-02-01', document_id: null, notes: null },
    { ...base, id: 'e2', property_id: 'P1', expense_date: '2026-02-01', supplier: null, label: null, amount: 500, category: 'travaux', nature: 'immobilisation', recoverable_amount: 0, payment_status: 'a_payer', paid_on: null, document_id: null, notes: null },
    { ...base, id: 'e3', property_id: 'P1', expense_date: '2025-12-01', supplier: null, label: null, amount: 99, category: 'autre', nature: 'charge', recoverable_amount: 0, payment_status: 'paye', paid_on: '2025-12-01', document_id: null, notes: null },
  ];
  const s = propertyRentalSummary('P1', 2026, '2026-03-10', {
    leases: [lease()], leaseTenants: [{ lease_id: 'L1', tenant_id: 't', user_id: 'u', left_on: null, created_at: '' }],
    tenants: [{ ...base, id: 't', first_name: 'Léa', last_name: 'Martin', email: null, phone: null, notes: null, archived_at: null }],
    charges: [charge('J', '2026-01-01', '2026-01-05', 960)], payments: [pay('p1', 960)], allocations: [alloc('p1', 'J', 960)], expenses,
  });
  assert.equal(s.tenantNames, 'Léa Martin');
  assert.equal(s.received, 960);
  assert.equal(s.expensesPaid, 1200, 'dépense à payer et dépense d’une autre année exclues');
  assert.equal(s.cashflow, -240);
  const t = expenseTotals(expenses);
  assert.equal(t.byNature.immobilisation, 500);
  assert.equal(t.recoverable, 150);
  assert.equal(t.toPay, 500);
});

test('relances : modèle rendu sans pénalité ni mention juridique', () => {
  const body = renderTemplate(DEFAULT_REMINDER_TEMPLATES[0].body, { locataires: 'Léa Martin', montant: 1234.5, bien: 'Studio', periodes: ['03/2026'], bailleur: 'Alice' });
  assert.match(body, /1 234,50 €/);
  assert.match(body, /Léa Martin/);
  assert.doesNotMatch(body, /\{/);
  for (const t of DEFAULT_REMINDER_TEMPLATES) assert.doesNotMatch(t.body, /pénalit|intérêts de retard|huissier|commandement|mise en demeure/i);
  assert.equal(eur(-5), '-5,00');
});

const receipt: ReceiptData = {
  kind: 'quittance', number: 'Q-2026-0001', issued_on: '2026-02-05', period_start: '2026-01-15', period_end: '2026-01-31',
  rent_amount: 493.55, charges_amount: 32.9, paid_amount: 526.45, payments: [{ date: '2026-01-20', amount: 500, method: 'virement' }, { date: '2026-02-03', amount: 26.45, method: 'cheque' }],
  tenant_names: 'Hugo Bernard, Léa Martin', landlord_name: 'Alice Propriétaire', landlord_address: '1 rue de l’Exemple, 69001 Lyon', property_address: '12 rue des Lilas 69003 Lyon',
};

test('quittance : mentions, montants et période', () => {
  const L = receiptLines(receipt);
  assert.equal(L.title, 'Quittance de loyer');
  assert.match(L.statement, /526,45 €/);
  assert.match(L.statement, /du 15\/01\/2026 au 31\/01\/2026/);
  assert.match(L.statement, /donne quittance/);
  assert.deepEqual(L.payments, ['20/01/2026 : 500,00 € par virement', '03/02/2026 : 26,45 € par chèque']);
  const R = receiptLines({ ...receipt, kind: 'recu', paid_amount: 500 });
  assert.match(R.statement, /ne vaut pas quittance/);
  assert.match(R.statement, /Il reste dû 26,45 €/);
  assert.equal(pdfSafe('a b – c’d'), "a b - c'd");
});

test('quittance : PDF valide d’une page, relisible', async () => {
  const bytes = await buildReceiptPdf(pdfLib, receipt);
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), '%PDF-');
  const doc = await pdfLib.PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 1);
  assert.equal(doc.getTitle(), 'Quittance de loyer Q-2026-0001');
  const recu = await buildReceiptPdf(pdfLib, { ...receipt, kind: 'recu', paid_amount: 500, tenant_names: 'Nom très long '.repeat(20) });
  assert.equal((await pdfLib.PDFDocument.load(recu)).getPageCount(), 1);
});

test('date de début : contrôle de l’année et échéances à supprimer', async () => {
  const { leaseStartIssue, pastChargeCount, startChangeImpact } = await import('../src/domain/rental.ts');
  assert.match(leaseStartIssue('0090-03-01', '2026-10-26')!, /improbable/);
  assert.match(leaseStartIssue('2031-01-01', '2026-10-26')!, /futur/);
  assert.equal(leaseStartIssue('2024-03-15', '2026-10-26'), null);
  assert.equal(pastChargeCount(lease({ start_date: '1990-03-01' }), '2024-06-30'), 412);
  const l = lease({ start_date: '1990-03-01' });
  const cs = [charge('a', '1990-03-01', '1990-03-05', 900), charge('b', '2024-03-01', '2024-03-05', 900), charge('c', '2024-04-01', '2024-04-05', 900)];
  const imp = startChangeImpact(l, '2024-03-15', cs, [], []);
  assert.deepEqual(imp.remove.map((c) => c.id), ['a', 'b']);
  assert.equal(imp.blocked.length, 0);
  const blocked = startChangeImpact(l, '2024-03-15', cs, [{ id: 'x', user_id: 'u', payment_id: 'p', charge_id: 'a', amount: 50, created_at: '' } as Allocation], [{ charge_id: 'b', cancelled_at: null }]);
  assert.deepEqual(blocked.blocked.map((c) => c.id), ['a', 'b']);
  // la date recule : le premier mois incomplet est recalculé
  const l2 = lease({ start_date: '2024-03-15' });
  assert.deepEqual(startChangeImpact(l2, '2024-03-01', [charge('m', '2024-03-15', '2024-03-15', 493.55), charge('n', '2024-04-01', '2024-04-05', 900)], [], []).remove.map((c) => c.id), ['m']);
});
