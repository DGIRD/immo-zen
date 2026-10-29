import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Expense, Payment, Receipt, RentCharge } from '../src/data/types.ts';
import { chargeDuplicates, expenseDuplicates, findDuplicates, paymentDuplicates, sameExpense, samePayment } from '../src/domain/duplicates.ts';
import { ledgerRows, ledgerSettings, monthQuittance } from '../src/domain/ledger.ts';

const base = { user_id: 'u1', version: 1, updated_at: '2026-10-01T00:00:00Z' };
const pay = (id: string, o: Partial<Payment>): Payment => ({ ...base, id, created_at: `2026-10-01T00:00:0${id.length}Z`, lease_id: 'l1', amount: 750, paid_on: '2026-10-05',
  date_defaulted: false, method: 'virement', reference: null, comment: null, source: 'saisie', ...o });
const exp = (id: string, o: Partial<Expense>): Expense => ({ ...base, id, created_at: '2026-10-01T00:00:00Z', property_id: 'p1', expense_date: '2026-03-10', amount: 120,
  category: 'copropriete', nature: 'charge', recoverable_amount: 0, payment_status: 'paye', paid_on: '2026-03-10', supplier: null, label: null, document_id: null, notes: null, ...o } as Expense);
const charge = (id: string, o: Partial<RentCharge>): RentCharge => ({ ...base, id, created_at: '2026-10-01T00:00:00Z', lease_id: 'l1', kind: 'loyer', period_start: '2026-09-01',
  period_end: '2026-09-30', due_date: '2026-09-05', rent_amount: 700, charges_amount: 50, label: null, cancelled_at: null, ...o });

test('paiements : même bail, même montant, dates proches = doublon ; références différentes = deux paiements', () => {
  const rows = [pay('a', {}), pay('bb', { paid_on: '2026-10-07' }), pay('ccc', { paid_on: '2026-11-05' }), pay('dddd', { lease_id: 'l2' })];
  const d = paymentDuplicates(rows);
  assert.deepEqual([...d.ids].sort(), ['a', 'bb']);
  assert.deepEqual(d.extra.map((p) => p.id), ['bb'], 'la première saisie est conservée');
  assert.equal(samePayment(pay('x', { reference: 'VIR 1' }), pay('y', { reference: 'VIR 2' })), false);
  assert.equal(samePayment(pay('x', { reference: 'VIR 1' }), pay('y', { reference: null })), true);
  assert.equal(findDuplicates({ lease_id: 'l1', amount: 750, paid_on: '2026-10-04', reference: null }, rows, samePayment).length, 2);
});

test('dépenses : même jour et même montant, ou même catégorie à quelques jours ; libellés différents écartés', () => {
  const rows = [exp('a', {}), exp('b', { category: 'assurance' }), exp('c', { expense_date: '2026-03-12' }), exp('d', { expense_date: '2026-04-10' }), exp('e', { label: 'Appel T1' }), exp('f', { label: 'Appel T2', expense_date: '2026-03-11' })];
  const d = expenseDuplicates(rows);
  assert.ok(d.ids.has('a') && d.ids.has('b') && d.ids.has('c'));
  assert.ok(!d.ids.has('d'), 'un mois plus tard : charge récurrente, pas un doublon');
  assert.equal(sameExpense(exp('e', { label: 'Appel T1' }), exp('f', { label: 'Appel T2' })), false);
  assert.equal(sameExpense(exp('x', { category: 'assurance', expense_date: '2026-03-12' }), exp('y', {})), false, 'autre catégorie, autre jour');
});

test('échéances : deux loyers sur des périodes qui se chevauchent ; échéances annulées ignorées', () => {
  const rows = [charge('a', {}), charge('b', { period_start: '2026-09-15' }), charge('c', { period_start: '2026-10-01', period_end: '2026-10-31' }),
    charge('d', { cancelled_at: '2026-10-02T00:00:00Z' }), charge('e', { kind: 'regularisation', period_start: '2026-09-05', period_end: '2026-09-05', rent_amount: 0, charges_amount: 80 }),
    charge('f', { kind: 'regularisation', period_start: '2026-09-06', period_end: '2026-09-06', due_date: '2026-09-06', rent_amount: 0, charges_amount: 80 })];
  const d = chargeDuplicates(rows);
  assert.deepEqual([...d.ids].sort(), ['a', 'b', 'e', 'f']);
});

test('quittances à émettre : mois réglés sans quittance, rappel repris sur la ligne du mois où il est exigé', () => {
  const charges = [charge('m8', { period_start: '2026-08-01', period_end: '2026-08-31', due_date: '2026-08-05' }), charge('m9', {}),
    charge('m10', { period_start: '2026-10-01', period_end: '2026-10-31', due_date: '2026-10-05' }),
    charge('r', { kind: 'regularisation', label: 'Rappel 2025', period_start: '2025-01-01', period_end: '2025-12-31', due_date: '2026-09-10', rent_amount: 0, charges_amount: 60 })];
  const allocations = ['m8', 'm9', 'r'].map((id, i) => ({ id: `a${i}`, user_id: 'u1', payment_id: 'p', charge_id: id, amount: charges.find((c) => c.id === id)!.rent_amount + charges.find((c) => c.id === id)!.charges_amount, created_at: '' }));
  const receipts = [{ id: 'q', kind: 'quittance', charge_id: 'm8', cancelled_at: null, extra_lines: [] } as unknown as Receipt];
  const rows = ledgerRows({ charges, payments: [], allocations, receipts, leases: [{ id: 'l1', start_date: '2026-08-01', end_date: null }] }, ledgerSettings({}), '2026-10-20');
  const todo = rows.filter((r) => monthQuittance(r, allocations, receipts));
  assert.deepEqual(todo.map((r) => r.month), ['2026-09'], 'août déjà quittancé, octobre non réglé');
  const sep = rows.find((r) => r.month === '2026-09')!;
  assert.equal(sep.other, 60, 'le rappel figure dans « Autre somme due » de septembre');
  assert.deepEqual(monthQuittance(sep, allocations, receipts)!.extras, ['r']);
});
