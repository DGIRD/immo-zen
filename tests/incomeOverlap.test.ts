import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Expense, Lease, Payment } from '../src/data/types.ts';
import { coveredIncomeIds, incomeDuplicates, leaseAt, leaseIncomeIndex } from '../src/domain/incomeOverlap.ts';
import { expenseTotals, propertyRentalSummary } from '../src/domain/rental.ts';
import { fiscalSummary } from '../src/domain/fiscal.ts';
import { bilanFacts } from '../src/domain/bilan.ts';
import { buildImportRows, parseDelimited, rentRoute, rowStatus, toLeasePayment, type RentContext } from '../src/domain/importing.ts';
import { data, exp, none, rentData } from './fixtures/lmnp.ts';

// ANO-013 : un loyer saisi sur le bail ET importé d'un relevé n'est compté qu'une fois.

const lease = (o: Partial<Lease> = {}) => ({ id: 'l1', property_id: 'p1', start_date: '2024-03-01', end_date: null, ...o } as unknown as Lease);
const pay = (paid_on: string, amount = 900, o: Partial<Payment> = {}) => ({ id: `pay-${paid_on}-${amount}`, lease_id: 'l1', amount, paid_on, ...o } as unknown as Payment);
const income = (d: string, amount = 900, o: Partial<Expense> = {}) => exp('loyer', amount, d, { nature: 'tresorerie', ...o });

test('recette importée le même mois qu’un paiement saisi : déjà comptée', () => {
  const e = income('2025-03-04');
  assert.ok(coveredIncomeIds([e], [lease()], [pay('2025-03-05')]).has(e.id));
});

test('même montant à quelques jours près, à cheval sur deux mois : déjà comptée', () => {
  const e = income('2025-03-30');
  assert.ok(coveredIncomeIds([e], [lease()], [pay('2025-04-02')]).has(e.id), 'virement du 30/03 saisi le 02/04');
  const far = income('2025-03-20');
  assert.ok(!coveredIncomeIds([far], [lease()], [pay('2025-04-02')]).has(far.id), 'au-delà de 7 jours et autre mois : comptée');
});

test('mois de rattachement du paiement pris en compte', () => {
  const e = income('2025-03-28', 900);
  assert.ok(coveredIncomeIds([e], [lease()], [pay('2025-04-10', 850, { period_month: '2025-03-01' })]).has(e.id));
});

test('rien ne se perd : mois sans paiement saisi, bien sans bail, dépense non payée', () => {
  const e = income('2025-05-04');
  assert.equal(coveredIncomeIds([e], [lease()], [pay('2025-03-05')]).size, 0, 'mois sans paiement');
  const other = income('2025-03-04', 900, { property_id: 'p2' });
  assert.equal(coveredIncomeIds([other], [lease()], [pay('2025-03-05')]).size, 0, 'bien sans bail');
  const charge = exp('copropriete', 900, '2025-03-04');
  assert.equal(coveredIncomeIds([charge], [lease()], [pay('2025-03-05')]).size, 0, 'une dépense n’est jamais une recette');
});

test('totaux de Dépenses : recettes déjà dans les loyers mises à part', () => {
  const a = income('2025-03-04'), b = income('2025-05-04', 500), c = exp('copropriete', 300, '2025-03-10');
  const covered = coveredIncomeIds([a, b, c], [lease()], [pay('2025-03-05')]);
  const t = expenseTotals([a, b, c], covered);
  assert.equal(t.income, 500);
  assert.equal(t.incomeCovered, 900);
  assert.equal(t.total, 300);
  assert.equal(expenseTotals([a, b, c]).income, 1400, 'sans ensemble fourni : comportement inchangé');
});

test('fiche du bien : encaissements et cash-flow sans double comptage', () => {
  const rd = rentData();
  const dup = rd.payments.filter((p) => p.paid_on.startsWith('2025')).map((p) => income(p.paid_on, p.amount));
  const extra = income('2025-12-20', 150, { label: 'CAF hors bail' });
  const d = { leases: [lease()], leaseTenants: [], tenants: [], ...rd, expenses: [...dup, extra] };
  const s = propertyRentalSummary('p1', 2025, '2025-12-31', d);
  // 12 × 900 saisis ; doublons ignorés ; 150 du 20/12 : décembre a un paiement → déjà compté (règle par mois)
  assert.equal(s.received, 10800);
});

test('fiscalité : loyers comptés une fois, avertissement explicite', () => {
  const rd = rentData();
  const dup = rd.payments.filter((p) => p.paid_on.startsWith('2025')).map((p) => income(p.paid_on, p.amount));
  const base = fiscalSummary(2025, data(), none);
  const both = fiscalSummary(2025, data({ expenses: [...data().expenses, ...dup] }), none);
  const y0 = base.amounts.get('p1')!, y1 = both.amounts.get('p1')!;
  assert.equal(y1.rentsHC, y0.rentsHC, 'loyers hors charges inchangés');
  assert.equal(y1.chargesCollected, y0.chargesCollected);
  assert.equal(y1.importedIncome, 0);
  assert.ok(y1.warnings.some((w) => /comptées une seule fois/.test(w)), y1.warnings.join(' | '));
  assert.ok(!y1.warnings.some((w) => /comptés deux fois/.test(w)));
});

test('bilan : retraits de l’exploitant sans les recettes en double', () => {
  const rd = rentData();
  const dup = rd.payments.filter((p) => p.paid_on.startsWith('2025')).map((p) => income(p.paid_on, p.amount));
  const a = bilanFacts(2025, data(), ['p1'], none);
  const b = bilanFacts(2025, data({ expenses: [...data().expenses, ...dup] }), ['p1'], none);
  assert.equal(b.exploitant.withdrawals, a.exploitant.withdrawals);
  assert.ok(!b.exploitant.withdrawalsDetail.some((l) => /relevés/.test(l.label)));
});

test('nettoyage : doublons listés, montants identiques cochés par défaut', () => {
  const same = income('2025-03-05'), split = income('2025-04-06', 900), differs = income('2025-05-06', 700), alone = income('2025-06-06');
  const payments = [pay('2025-03-05'), pay('2025-04-02', 400), pay('2025-04-20', 500), pay('2025-05-03', 900)];
  const list = incomeDuplicates([alone, differs, split, same], [lease()], payments);
  assert.deepEqual(list.map((x) => x.expense.id), [same.id, split.id, differs.id], 'triés par date, juin sans paiement exclu');
  assert.equal(list[0]!.identical, true);
  assert.equal(list[0]!.payment?.paid_on, '2025-03-05');
  assert.equal(list[1]!.identical, true, 'loyer payé en deux virements : total du mois identique');
  assert.equal(list[1]!.payment, null);
  assert.equal(list[2]!.identical, false, 'même mois, montant différent : à vérifier');
});

test('bail en cours à une date', () => {
  const ls = [lease({ id: 'a', start_date: '2023-01-01', end_date: '2024-06-30' }), lease({ id: 'b', start_date: '2024-07-15' })];
  assert.equal(leaseAt(ls, 'p1', '2024-03-01')?.id, 'a');
  assert.equal(leaseAt(ls, 'p1', '2024-08-01')?.id, 'b');
  assert.equal(leaseAt(ls, 'p1', '2024-07-05')?.id, 'a', 'entre deux baux : le dernier commencé');
  assert.equal(leaseAt(ls, 'p1', '2022-12-01'), null);
  assert.equal(leaseAt(ls, 'p2', '2024-08-01'), null);
});

// ---------- import de relevé (volet 2) ----------
const SAMPLE = [
  'Date\tLibellé\tMontant\tCatégorie\tAppartement',
  '05/03/2025\tVIR LOYER MARS\t900\tLoyer\tT2',
  '05/04/2025\tVIR LOYER AVRIL\t900\tLoyer\tT2',
  '06/05/2025\tVIR LOYER MAI\t900\tLoyer\tT2',
  '10/05/2025\tSYNDIC\t-200\tCharges de copropriété (dont travaux)\tT2',
  '05/04/2025\tVIR LOYER STUDIO\t500\tLoyer\tStudio',
].join('\n');
const PROPS = [{ id: 'p1', title: 'T2', address: null, zip: null, city: null }, { id: 'p2', title: 'Studio', address: null, zip: null, city: null }];
const ctx = (payments: Payment[], o: Partial<RentContext> = {}): RentContext => ({ idx: leaseIncomeIndex([lease()], payments), leases: [lease()], paymentRefs: new Set(), ...o });

test('import : loyer déjà saisi non importé, loyer manquant en paiement du bail, bien sans bail à créer d’abord', () => {
  const { rows } = buildImportRows(parseDelimited(SAMPLE), PROPS);
  const c = ctx([pay('2025-03-05'), pay('2025-05-02', 450)]);
  const st = rows.map((r) => rowStatus(r, new Set(), c));
  assert.equal(st[0]!.status, 'deja');
  assert.match(st[0]!.message, /Déjà saisi dans Loyers \(paiement du 05\/03\/2025\)/);
  assert.deepEqual(st[1], { status: 'ok', message: 'Paiement du bail' });
  assert.equal(st[2]!.status, 'signe', 'mai : 450 € déjà reçus, montant différent → à vérifier');
  assert.match(st[2]!.message.replace(/[\u202f\u00a0]/g, " "), /450,00 €/);
  assert.deepEqual(st[3], { status: 'ok', message: 'Dépense' });
  assert.equal(st[4]!.status, 'signe', 'studio sans bail : pas de recette dans Dépenses, bail à créer');
  assert.match(st[4]!.message, /Aucun bail à cette date/);
  assert.deepEqual(rentRoute(rows[4]!, c), { kind: 'sans_bail' });
  assert.deepEqual(rentRoute(rows[1]!, c), { kind: 'paiement', leaseId: 'l1' });
  assert.equal(rentRoute(rows[3]!, c), null);
});

test('import : relevé réimporté → déjà importée', () => {
  const { rows } = buildImportRows(parseDelimited(SAMPLE), PROPS);
  assert.equal(rowStatus(rows[1]!, new Set(), ctx([], { paymentRefs: new Set([rows[1]!.ref]) })).status, 'doublon');
  assert.deepEqual(rowStatus(rows[1]!, new Set()), { status: 'ok', message: 'Recette' }, 'sans contexte : comportement d’origine');
});

test('import : paiement du bail construit depuis la ligne du relevé', () => {
  const { rows } = buildImportRows(parseDelimited(SAMPLE), PROPS);
  const p = toLeasePayment(rows[1]!, 'l1');
  assert.equal(p.lease_id, 'l1');
  assert.equal(p.amount, 900);
  assert.equal(p.paid_on, '2025-04-05');
  assert.equal(p.period_month, '2025-04-01');
  assert.equal(p.source, 'import');
  assert.equal(p.method, 'virement');
  assert.equal(p.reference, 'VIR LOYER AVRIL');
  assert.equal(p.import_ref, rows[1]!.ref);
});

test('import : loyer payé en plusieurs virements saisis (même total sur le mois) → déjà saisi', () => {
  const { rows } = buildImportRows(parseDelimited(SAMPLE), PROPS);
  const c = ctx([pay('2025-04-01', 400), pay('2025-04-15', 500, { period_month: '2025-04-01' })]);
  assert.equal(rowStatus(rows[1]!, new Set(), c).status, 'deja');
  const byPeriod = ctx([pay('2025-06-02', 900, { period_month: '2025-04-01' })]);
  assert.equal(rowStatus(rows[1]!, new Set(), byPeriod).status, 'deja', 'paiement saisi plus tard, rattaché à avril');
});

test('Dépenses : la catégorie « Loyer » n’est plus proposée à la saisie', async () => {
  const { MAIN_EXPENSE_CATEGORIES, OTHER_EXPENSE_CATEGORIES } = await import('../src/domain/rental.ts');
  assert.ok(![...MAIN_EXPENSE_CATEGORIES, ...OTHER_EXPENSE_CATEGORIES].includes('loyer'));
});
