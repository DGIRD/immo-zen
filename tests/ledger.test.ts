/**
 * Loyers et paiements, tableau unique : règles de l'expression de besoin du 29/10/2026.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Allocation, Lease, Payment, Receipt, RentCharge } from '../src/data/types.ts';
import { addMonths, emptyPlan, ledgerPlan, ledgerRows, ledgerSettings, monthQuittance, paymentMonth, reportLabel, type LedgerPlan, type LedgerSettings } from '../src/domain/ledger.ts';
import { chargeViews, planCharges } from '../src/domain/rental.ts';

const T = '2026-01-01T00:00:00Z';
let seq = 0;
const id = (p: string) => `${p}${++seq}`;

interface Db { leases: Lease[]; charges: RentCharge[]; payments: Payment[]; allocations: Allocation[]; receipts: Receipt[] }

function lease(p: Partial<Lease> = {}): Lease {
  return {
    id: 'L1', user_id: 'u', version: 1, created_at: T, updated_at: T, property_id: 'P1', label: null, furnished: false,
    start_date: '2026-07-01', end_date: null, rent_hc: 900, charges_amount: 100, charges_mode: 'provision', deposit_amount: 900, payment_day: 5,
    landlord_name: null, landlord_address: null, owner_confirmation_email: false, receipt_auto_send: false, reminder_enabled: false, reminder_delay_days: 10, notes: null, ...p,
  } as Lease;
}
function db(l: Lease, today: string): Db {
  const charges = planCharges(l, today).map((c) => ({ id: id('c'), user_id: 'u', version: 1, created_at: T, updated_at: T, lease_id: l.id, kind: 'loyer', label: null, cancelled_at: null, ...c }) as RentCharge);
  return { leases: [l], charges, payments: [], allocations: [], receipts: [] };
}
function pay(d: Db, amount: number, paid_on: string, extra: Partial<Payment> = {}): Payment {
  const p = { id: id('p'), user_id: 'u', version: 1, created_at: `${paid_on}T10:00:00Z`, updated_at: T, lease_id: 'L1', amount, paid_on, date_defaulted: false, method: 'virement', reference: null, comment: null, source: 'import', ...extra } as Payment;
  d.payments.push(p);
  return p;
}
const loyerOf = (d: Db, month: string) => d.charges.find((c) => c.kind === 'loyer' && c.period_start.startsWith(month))!;

/** Applique un plan comme le ferait le dépôt (ordre : affectations retirées, sommes supprimées, créées, modifiées, affectations créées). */
function apply(d: Db, plan: LedgerPlan) {
  const del = new Set(plan.deleteAllocations.map((a) => a.id));
  d.allocations = d.allocations.filter((a) => !del.has(a.id));
  const delC = new Set(plan.deleteCharges.map((c) => c.id));
  d.charges = d.charges.filter((c) => !delC.has(c.id));
  for (const c of d.charges) if (c.carried_to && delC.has(c.carried_to)) c.carried_to = null;
  const map = new Map<string, string>();
  for (const pc of plan.createCharges) {
    const cid = id('r');
    map.set(pc.key, cid);
    d.charges.push({ id: cid, user_id: 'u', version: 1, created_at: T, updated_at: T, label: null, cancelled_at: null, ...pc.row, carried_to: null } as RentCharge);
  }
  const ref = (r: string | null | undefined) => (r && r.startsWith('new:') ? map.get(r)! : r ?? null);
  for (const pc of plan.createCharges) if (pc.row.carried_to) d.charges.find((c) => c.id === map.get(pc.key))!.carried_to = ref(pc.row.carried_to);
  for (const u of plan.updateCharges) {
    const c = d.charges.find((x) => x.id === u.charge.id)!;
    Object.assign(c, u.patch);
    if ('carried_to' in u.patch) c.carried_to = ref(u.patch.carried_to);
  }
  for (const a of plan.createAllocations) {
    const charge = ref(a.charge)!;
    const c = d.charges.find((x) => x.id === charge)!;
    const s = d.allocations.filter((x) => x.charge_id === charge).reduce((t, x) => t + x.amount, 0) + a.amount;
    assert.ok(s <= c.rent_amount + c.charges_amount + 0.001, 'affectation au-delà du montant dû');
    d.allocations.push({ id: id('a'), user_id: 'u', payment_id: a.payment_id, charge_id: charge, amount: a.amount, created_at: T });
  }
}
const S: LedgerSettings = ledgerSettings({});
function sync(d: Db, today: string, s: LedgerSettings = S, restoreCancelled = false) {
  const input = () => ({ lease: d.leases[0]!, charges: d.charges, payments: d.payments, allocations: d.allocations, receipts: d.receipts, settings: s, today, restoreCancelled });
  apply(d, ledgerPlan(input()));
  // idempotent : une seconde passe n'écrit rien
  const again = ledgerPlan(input());
  assert.ok(emptyPlan(again), `seconde passe non vide : ${JSON.stringify(again)}`);
}
const rows = (d: Db, today: string, s: LedgerSettings = S) => ledgerRows(d, s, today);
const row = (d: Db, today: string, month: string, s: LedgerSettings = S) => rows(d, today, s).find((r) => r.month === month)!;

test('mois et libellés', () => {
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(reportLabel('2026-08', '2026-08'), 'Reste dû 08/2026');
  assert.equal(reportLabel('2026-08', '2026-09'), 'Reste dû 08/2026 à 09/2026');
  assert.equal(paymentMonth({ paid_on: '2026-11-03', period_month: '2026-10-01' }), '2026-10');
});

test('une ligne par mois : chaque paiement règle le mois de sa date', () => {
  const today = '2026-10-15';
  const d = db(lease(), today);
  for (const m of ['07', '08', '09', '10']) pay(d, 1000, `2026-${m}-04`);
  sync(d, today);
  const rs = rows(d, today);
  assert.equal(rs.length, 4);
  assert.ok(rs.every((r) => r.status === 'reglee' && r.paid === 1000 && r.due === 1000 && r.gap === 0 && r.received === 'oui'));
  assert.ok(!d.charges.some((c) => c.kind === 'report'));
});

test('plusieurs paiements du même mois additionnés (colocation, loyer en deux fois)', () => {
  const today = '2026-07-20';
  const d = db(lease(), today);
  pay(d, 400, '2026-07-02'); pay(d, 600, '2026-07-09');
  sync(d, today);
  const r = row(d, today, '2026-07');
  assert.equal(r.paid, 1000);
  assert.equal(r.status, 'reglee');
  assert.equal(r.payments.length, 2);
});

test('reste dû reporté dans « Autre somme due » du mois suivant, compté une seule fois', () => {
  const today = '2026-09-10';
  const d = db(lease(), today);
  pay(d, 1000, '2026-07-04'); pay(d, 600, '2026-08-04');
  sync(d, today);
  const aug = row(d, today, '2026-08');
  const sep = row(d, today, '2026-09');
  assert.equal(aug.status, 'reportee');
  assert.equal(aug.carriedOut, 400);
  assert.equal(sep.carryIn, 400);
  assert.equal(sep.report!.label, 'Reste dû 08/2026');
  assert.equal(sep.due, 1400);
  // la dette n'apparaît qu'une fois : la somme d'origine ne compte plus
  const debt = chargeViews(d.charges, d.allocations, today).reduce((s, v) => s + v.remaining, 0);
  assert.equal(debt, 1400);
});

test('le paiement du mois suivant règle d’abord le reste dû reporté', () => {
  const today = '2026-10-10';
  const d = db(lease(), today);
  pay(d, 1000, '2026-07-04'); pay(d, 600, '2026-08-04'); pay(d, 1400, '2026-09-04'); pay(d, 1000, '2026-10-04');
  sync(d, today);
  assert.equal(row(d, today, '2026-09').status, 'reglee');
  assert.equal(row(d, today, '2026-10').carryIn, 0);
  const q = monthQuittance(row(d, today, '2026-09'), d.allocations, d.receipts);
  assert.ok(q, 'quittance de septembre possible');
  assert.equal(q!.extras.length, 1, 'le reste dû d’août figure en ligne distincte');
});

test('report en cascade : le cumul passe au mois suivant', () => {
  const today = '2026-10-10';
  const d = db(lease(), today);
  pay(d, 1000, '2026-07-04'); pay(d, 600, '2026-08-04');
  sync(d, today);
  const oct = row(d, today, '2026-10');
  assert.equal(oct.carryIn, 1400);
  assert.equal(oct.report!.label, 'Reste dû 08/2026 à 09/2026');
  assert.equal(row(d, today, '2026-09').status, 'reportee');
  assert.equal(chargeViews(d.charges, d.allocations, today).reduce((s, v) => s + v.remaining, 0), 2400);
});

test('dernier mois du bail : le reste dû reste sur sa ligne', () => {
  const today = '2026-10-10';
  const d = db(lease({ end_date: '2026-09-30' }), today);
  pay(d, 1000, '2026-07-04'); pay(d, 1000, '2026-08-04'); pay(d, 700, '2026-09-04');
  sync(d, today);
  const sep = row(d, today, '2026-09');
  assert.equal(sep.status, 'partielle');
  assert.equal(sep.gap, -300);
  assert.ok(!d.charges.some((c) => c.kind === 'report'));
});

test('mois en cours partiel : pas encore reporté', () => {
  const today = '2026-08-20';
  const d = db(lease(), today);
  pay(d, 1000, '2026-07-04'); pay(d, 500, '2026-08-04');
  sync(d, today);
  assert.equal(row(d, today, '2026-08').status, 'partielle');
  assert.ok(!d.charges.some((c) => c.kind === 'report'));
});

test('trop-perçu : reste sur sa ligne, à qualifier ; avance déduite du mois suivant si choisie', () => {
  const today = '2026-08-20';
  const d = db(lease(), today);
  pay(d, 1200, '2026-07-04');
  sync(d, today);
  let jul = row(d, today, '2026-07');
  assert.equal(jul.gap, 200);
  assert.ok(jul.excessToQualify);
  assert.equal(row(d, today, '2026-08').allocated, 0);
  loyerOf(d, '2026-07').excess_mode = 'avance';
  sync(d, today);
  jul = row(d, today, '2026-07');
  assert.equal(jul.advanceOut, 200);
  assert.equal(jul.gap, 0);
  assert.ok(!jul.excessToQualify);
  const aug = row(d, today, '2026-08');
  assert.equal(aug.advanceIn, 200);
  assert.equal(aug.allocated, 200);
});

test('paiement déplacé vers un autre mois dans l’aperçu (virement du 3 novembre pour octobre)', () => {
  const today = '2026-11-10';
  const d = db(lease({ start_date: '2026-10-01' }), today);
  pay(d, 1000, '2026-11-03', { period_month: '2026-10-01' });
  sync(d, today);
  assert.equal(row(d, today, '2026-10').status, 'reglee');
  assert.equal(row(d, today, '2026-11').paid, 0);
});

test('paiement reçu plus tard pour un mois reporté : le report disparaît', () => {
  const today = '2026-09-10';
  const d = db(lease(), today);
  pay(d, 1000, '2026-07-04'); pay(d, 600, '2026-08-04');
  sync(d, today);
  assert.equal(row(d, today, '2026-09').carryIn, 400);
  pay(d, 400, '2026-09-02', { period_month: '2026-08-01' });
  sync(d, today);
  assert.equal(row(d, today, '2026-08').status, 'reglee');
  assert.equal(row(d, today, '2026-09').carryIn, 0);
  assert.ok(!d.charges.some((c) => c.kind === 'report'));
  assert.ok(!d.charges.some((c) => c.carried_to));
});

test('une somme quittancée n’est jamais modifiée', () => {
  const today = '2026-08-20';
  const d = db(lease(), today);
  pay(d, 1000, '2026-07-04');
  sync(d, today);
  const jul = loyerOf(d, '2026-07');
  d.receipts.push({ id: 'q1', charge_id: jul.id, kind: 'quittance', cancelled_at: null, extra_lines: [] } as unknown as Receipt);
  // le paiement est déplacé : la quittance fige sa répartition
  d.payments[0]!.period_month = '2026-08-01';
  const plan = ledgerPlan({ lease: d.leases[0]!, charges: d.charges, payments: d.payments, allocations: d.allocations, receipts: d.receipts, settings: S, today });
  assert.ok(emptyPlan(plan));
});

test('point de départ choisi : lignes antérieures supprimées, paiements hors période signalés', () => {
  const today = '2026-10-10';
  const d = db(lease(), today);
  pay(d, 1000, '2026-07-04'); pay(d, 1000, '2026-09-04');
  sync(d, today);
  const s = ledgerSettings({ ledger_start_mode: 'date', ledger_start_date: '2026-09-01' });
  sync(d, today, s);
  assert.deepEqual(d.charges.filter((c) => c.kind === 'loyer').map((c) => c.period_start.slice(0, 7)), ['2026-09', '2026-10']);
  assert.equal(rows(d, today, s).find((r) => r.month === '2026-07')!.status, 'hors_periode');
  // pas de report vers une ligne inexistante
  assert.equal(row(d, today, '2026-10', s).carryIn, 0);
});

test('reprise : loyers annulés sans motif rétablis', () => {
  const today = '2026-09-10';
  const d = db(lease(), today);
  loyerOf(d, '2026-08').cancelled_at = T;
  pay(d, 1000, '2026-07-04'); pay(d, 1000, '2026-08-04');
  sync(d, today, S, true);
  assert.equal(loyerOf(d, '2026-08').cancelled_at, null);
  assert.equal(row(d, today, '2026-08').status, 'reglee');
});

test('colonne « Reçu » en mode confirmation', () => {
  const today = '2026-07-20';
  const d = db(lease(), today);
  pay(d, 1000, '2026-07-04');
  sync(d, today);
  const s = ledgerSettings({ received_mode: 'confirmation' });
  let r = row(d, today, '2026-07', s);
  assert.equal(r.received, 'non');
  assert.ok(r.toConfirm);
  loyerOf(d, '2026-07').received_at = T;
  r = row(d, today, '2026-07', s);
  assert.equal(r.received, 'oui');
  assert.ok(!r.toConfirm);
});

test('cas réel : bail 09/2024, paiements importés à partir de 09/2025', () => {
  const today = '2026-10-27';
  const d = db(lease({ start_date: '2024-09-01', rent_hc: 865.18, charges_amount: 100 }), today);
  for (let m = '2025-09'; m <= '2026-10'; m = addMonths(m, 1)) pay(d, 958.81, `${m}-05`);
  sync(d, today, S, true);
  const rs = rows(d, today);
  // les mois sans paiement (09/2024 à 08/2025) se cumulent jusqu'au premier mois payé, puis le reste dû suit chaque mois
  const oct = rs.find((r) => r.month === '2026-10')!;
  assert.ok(oct.carryIn > 0);
  const total = rs.reduce((s, r) => s + (r.loyer ? r.rent + r.charges : 0), 0);
  const paid = rs.reduce((s, r) => s + r.paid, 0);
  const debt = chargeViews(d.charges, d.allocations, today).reduce((s, v) => s + v.remaining, 0);
  assert.equal(Math.round(debt * 100), Math.round((total - paid) * 100), 'dette = dû − payé, comptée une fois');
  assert.equal(d.charges.filter((c) => c.kind === 'report').length, rs.filter((r) => r.month > '2024-09').length);
});

test('quittance : « Reste dû MM/AAAA réglé » sur une ligne distincte, sans le qualifier de rappel de charges', async () => {
  const { receiptLines } = await import('../supabase/functions/_shared/receiptPdf.ts');
  const l = receiptLines({ kind: 'quittance', number: 'Q-2026-0002', issued_on: '2026-09-06', period_start: '2026-09-01', period_end: '2026-09-30',
    rent_amount: 900, charges_amount: 100, paid_amount: 1400, payments: [], tenant_names: 'Léa Martin', landlord_name: 'D. G.', landlord_address: null,
    property_address: null, extra_lines: [{ label: 'Reste dû 08/2026 réglé', amount: 400 }] });
  assert.deepEqual(l.detail.map(([k]) => k), ['Loyer hors charges', 'Provision pour charges', 'Reste dû 08/2026 réglé', 'Total réglé']);
  assert.match(l.statement, /reste dû des mois précédents \(Reste dû 08\/2026 réglé\)/);
  assert.doesNotMatch(l.statement, /rappel de charges/);
});
