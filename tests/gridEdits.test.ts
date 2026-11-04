/**
 * Modification en grille de Loyers et paiements : aperçu en direct et enregistrement dans l'ordre des mois.
 * Cas d'origine (04/11/2026) : septembre partiel reporté sur octobre ; septembre et octobre passés en « Réglé »
 * dans la même saisie créaient un second paiement du reste dû déjà soldé.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Lease, Payment, RentCharge } from '../src/data/types.ts';
import { createDemoRepo } from '../src/data/demoRepo.ts';
import { todayParis } from '../src/domain/format.ts';
import { applyOps, planLineEdit, previewEdits, simulateLedger, sortEdits, type LedgerData, type LineEdit } from '../src/domain/gridEdits.ts';
import { addMonths, ledgerRows, ledgerSettings } from '../src/domain/ledger.ts';
import { planCharges } from '../src/domain/rental.ts';
import { saveLedgerGrid } from '../src/pages/rental/gridSave.ts';
import { syncLedgerWith } from '../src/pages/rental/ledgerSync.ts';

const today = todayParis();
const cur = today.slice(0, 7);
const m1 = addMonths(cur, -3), m2 = addMonths(cur, -2), m3 = addMonths(cur, -1);
const settings = ledgerSettings(null);
const T = '2026-01-01T00:00:00Z';

function memStorage(): Storage {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, clear: () => m.clear(), getItem: (k) => m.get(k) ?? null, key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); }, setItem: (k, v) => { m.set(k, String(v)); } };
}

/** Bail de 1 000 € CC commencé il y a trois mois ; premier mois réglé 500 €. */
function memoryData(): LedgerData {
  const lease = { id: 'L1', user_id: 'u', version: 1, created_at: T, updated_at: T, property_id: 'P1', label: null, furnished: false, start_date: `${m1}-01`, end_date: null,
    rent_hc: 900, charges_amount: 100, charges_mode: 'provision', deposit_amount: 900, payment_day: 5 } as unknown as Lease;
  let n = 0;
  const charges = planCharges(lease, today).map((c) => ({ id: `c${++n}`, user_id: 'u', version: 1, created_at: T, updated_at: T, lease_id: 'L1', kind: 'loyer', label: null, cancelled_at: null, ...c }) as RentCharge);
  const payments = [{ id: 'p1', user_id: 'u', version: 1, created_at: T, updated_at: T, lease_id: 'L1', amount: 500, paid_on: `${m1}-05`, date_defaulted: false, method: 'virement', reference: null, comment: null, source: 'saisie' } as Payment];
  return simulateLedger({ leases: [lease], charges, payments, allocations: [], receipts: [] }, ['L1'], settings, today);
}
const edit = (month: string, values: LineEdit['values']): LineEdit => ({ key: `L1|${month}`, lease_id: 'L1', month, values });
const paidTotal = (d: Pick<LedgerData, 'payments'>) => d.payments.reduce((t, p) => t + p.amount, 0);

test('ordre de traitement : bail par bail, mois croissants', () => {
  const list = sortEdits([edit(m3, {}), edit(m1, {}), { ...edit(m2, {}), lease_id: 'L0', key: `L0|${m2}` }]);
  assert.deepEqual(list.map((e) => e.key), [`L0|${m2}`, `L1|${m1}`, `L1|${m3}`]);
});

test('point de départ : le reste dû du premier mois est reporté sur le suivant', () => {
  const d = memoryData();
  const rows = ledgerRows(d, settings, today);
  const r1 = rows.find((r) => r.month === m1)!, r2 = rows.find((r) => r.month === m2)!;
  assert.equal(r1.status, 'reportee');
  assert.equal(r2.carryIn, 500);
  assert.equal(r2.due, 1500);
});

test('aperçu : deux mois passés en « Réglé » dans la même saisie, sans double paiement du reste dû', () => {
  const d = memoryData();
  // saisie dans l'ordre d'affichage (mois récent d'abord) : l'aperçu traite quand même les mois dans l'ordre
  const prev = previewEdits(d, [edit(m2, { status: 'reglee' }), edit(m1, { status: 'reglee' })], settings, today);
  const r1 = prev.get(`L1|${m1}`)!, r2 = prev.get(`L1|${m2}`)!;
  assert.equal(r1.status, 'reglee');
  assert.equal(r2.status, 'reglee');
  assert.equal(r2.carryIn, 0, 'le report du premier mois disparaît, il est soldé');
  assert.equal(r2.due, 1000);
  assert.equal(r2.gap, 0, 'aucun trop-perçu fictif');
  assert.equal(r1.paid + r2.paid, 2000);
});

test('aperçu : un montant réglé saisi recalcule total, écart, statut et le report du mois suivant', () => {
  const d = memoryData();
  const prev = previewEdits(d, [edit(m2, { paid: 1200 })], settings, today);
  const r2 = prev.get(`L1|${m2}`)!, r3 = prev.get(`L1|${m3}`)!;
  assert.equal(r2.due, 1500);
  assert.equal(r2.paid, 1200);
  assert.equal(r2.status, 'reportee');
  assert.equal(r3.carryIn, 300, 'reste dû du mois modifié reporté sur le suivant');
  // données d'origine inchangées
  assert.equal(paidTotal(d), 500);
});

test('aperçu : loyer modifié, total dû recalculé (reports des mois impayés compris)', () => {
  const r3 = previewEdits(memoryData(), [edit(m3, { rent: 950 })], settings, today).get(`L1|${m3}`)!;
  assert.equal(r3.rent + r3.charges, 1050);
  assert.equal(r3.carryIn, 1500, 'reste dû des deux mois précédents');
  assert.equal(r3.due, 2550);
});

test('origine du défaut : traiter le mois récent avant l’ancien, sans recalcul entre les deux, règle deux fois le reste dû', () => {
  let d = memoryData();
  // ancien comportement : chaque ligne calculée sur l'état d'avant la saisie, mois récent d'abord
  d = applyOps(d, planLineEdit(d, edit(m2, { status: 'reglee' }), settings, today));
  d = applyOps(d, planLineEdit(d, edit(m1, { status: 'reglee' }), settings, today));
  assert.equal(paidTotal(d), 2500, '500 € payés en trop : le défaut est bien reproduit');
});

async function demoLease() {
  const repo = createDemoRepo(memStorage());
  const prop = await repo.insert('properties', { title: 'T2 test', status: 'acquis' } as never);
  const lease = await repo.insert('leases', { property_id: prop.id, start_date: `${m1}-01`, rent_hc: 900, charges_amount: 100, charges_mode: 'provision',
    deposit_amount: 900, payment_day: 5, furnished: false } as never) as Lease;
  await repo.generateCharges(lease.id);
  await repo.insert('payments', { lease_id: lease.id, amount: 500, paid_on: `${m1}-05`, method: 'virement', source: 'saisie', date_defaulted: false });
  await syncLedgerWith(repo, { leaseIds: [lease.id] });
  return { repo, lease };
}

test('enregistrement : mois traités dans l’ordre, reports recalculés entre deux lignes (pas de second paiement)', async () => {
  const { repo, lease } = await demoLease();
  const e = (month: string, values: LineEdit['values']): LineEdit => ({ key: `${lease.id}|${month}`, lease_id: lease.id, month, values });
  const res = await saveLedgerGrid(repo, [e(m2, { status: 'reglee' }), e(m1, { status: 'reglee' })], today);
  assert.equal(res.failed, null);
  assert.deepEqual(res.saved, [`${lease.id}|${m1}`, `${lease.id}|${m2}`]);
  const snap = await repo.loadAll();
  assert.equal(paidTotal(snap), 2000, 'deux mois de 1 000 € : 2 000 € réglés, pas 2 500 €');
  const rows = ledgerRows(snap, settings, today);
  for (const m of [m1, m2]) assert.equal(rows.find((r) => r.month === m)!.status, 'reglee');
  assert.equal(rows.find((r) => r.month === m2)!.gap, 0);
});

test('enregistrement : une ligne en erreur n’empêche pas le recalcul des lignes déjà enregistrées, les suivantes restent à faire', async () => {
  const { repo, lease } = await demoLease();
  const e = (month: string, values: LineEdit['values']): LineEdit => ({ key: `${lease.id}|${month}`, lease_id: lease.id, month, values });
  // ligne du deuxième mois supprimée entre-temps (autre appareil) : sa modification échoue
  const gone = (await repo.loadAll()).charges.find((c) => c.lease_id === lease.id && c.kind === 'loyer' && c.period_start.startsWith(m2))!;
  await repo.remove('rent_charges', gone.id);
  const res = await saveLedgerGrid(repo, [e(m3, { paid: 1000 }), e(m2, { paid: 10 }), e(m1, { paid: 1000 })], today);
  assert.equal(res.saved.length, 1);
  assert.ok(res.failed && /n’existe plus/.test(res.failed.message));
  const rows = ledgerRows(await repo.loadAll(), settings, today);
  assert.equal(rows.find((r) => r.month === m1)!.status, 'reglee');
  assert.equal(rows.find((r) => r.month === m1)!.carriedOut, 0, 'plus de reste dû reporté après recalcul');
  assert.equal(rows.find((r) => r.month === m3)!.paid, 0, 'ligne suivante non tentée');
});
