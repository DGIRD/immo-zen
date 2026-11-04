import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Allocation, DepositMovement, Expense, Lease, Payment, Property, RentCharge, TaxPropertyInputs } from '../src/data/types.ts';
import { bilanFacts, type BilanData } from '../src/domain/bilan.ts';
import { fiscalSummary, loanBalance } from '../src/domain/fiscal.ts';
import { balanceFromFacts, bilan2033A, checkRequest, type TdfcRequest } from '../src/domain/edi/tdfc.ts';

const prop = {
  id: 'p1', title: 'T2', status: 'acquis', tax_regime: 'reel_bic', ownership_mode: 'nom_propre', acquired_at: '2024-01-01', acquisition_cost: 200000,
  loan_amount: 150000, loan_rate: 3, loan_years: 20, loan_start_date: '2024-02-05', vigilance: [], acquisition_snapshot: null,
} as unknown as Property;
const lease = { id: 'l1', property_id: 'p1', label: 'Bail 1', start_date: '2024-03-01', end_date: null, rent_hc: 800, charges_amount: 100, deposit_amount: 800 } as unknown as Lease;

/** Échéances mensuelles de mars 2024 à décembre 2025, payées le 5 du mois sauf celles indiquées. */
function rentData(unpaid: string[] = []) {
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
const exp = (category: Expense['category'], amount: number, d: string, o: Partial<Expense> = {}) =>
  ({ id: `e${++n}`, property_id: 'p1', expense_date: d, paid_on: d, amount, category, nature: 'charge', recoverable_amount: 0, payment_status: 'paye', ...o } as unknown as Expense);
const deposits: DepositMovement[] = [{ id: 'd1', lease_id: 'l1', kind: 'encaissement', amount: 800, occurred_on: '2024-03-01' } as unknown as DepositMovement];
const expenses = [
  exp('copropriete', 1200, '2024-06-01'), exp('taxe_fonciere', 900, '2024-10-15'), exp('mobilier', 4000, '2024-02-20', { nature: 'immobilisation' }),
  exp('copropriete', 1250, '2025-06-01'), exp('taxe_fonciere', 950, '2025-10-15'), exp('assurance', 180, '2025-01-10'),
];
const data = (o: Partial<BilanData> = {}): BilanData => ({ properties: [prop], leases: [lease], ...rentData(), expenses, deposits, ...o });
const none = () => ({} as TaxPropertyInputs);

function bilan(d: BilanData, inputs: (pid: string, y: number) => TaxPropertyInputs = none, b = {}) {
  const facts = bilanFacts(2025, d, ['p1'], inputs, b);
  const liasse = fiscalSummary(2025, d, inputs).reelBic!.liasse;
  return { facts, liasse, bil: bilan2033A(liasse, { start: '2025-01-01', end: '2025-12-31' }, balanceFromFacts(facts)) };
}

test('données complètes sans impayé : le bilan s’équilibre de lui-même avec le compte de l’exploitant suivi', () => {
  const { facts, bil } = bilan(data());
  assert.equal(facts.receivables, 0);
  assert.equal(facts.payables, 0);
  assert.equal(facts.depositsHeld, 800);
  assert.equal(facts.exploitant.source, 'historique');
  assert.ok(facts.exploitant.opening > 0, `ouverture : ${facts.exploitant.opening}`);
  assert.ok(Math.abs(bil.gap) < 0.05, `écart ${bil.gap} € (exploitant suivi ${bil.tracked}, équilibre ${bil.capital})`);
  assert.equal(bil.assetsNet, bil.liabilities);
});

test('loyer de décembre impayé : créance au bilan, écart expliqué par l’impayé', () => {
  const { facts, bil } = bilan(data(rentData(['2025-12'])));
  assert.equal(facts.receivables, 900);
  assert.equal(facts.receivablesDetail[0]?.amount, 900);
  assert.ok(Math.abs(bil.gap - 900) < 0.05, `écart ${bil.gap}`);
  assert.ok(Math.abs(bil.gapExplained.other) < 0.05);
});

test('paiement de décembre reçu en janvier : créance au 31/12 malgré l’affectation ultérieure', () => {
  const r = rentData(['2025-12']);
  r.payments.push({ id: 'late', lease_id: 'l1', amount: 900, paid_on: '2026-01-04' } as unknown as Payment);
  r.allocations.push({ id: 'alate', payment_id: 'late', charge_id: 'c202512', amount: 900 } as unknown as Allocation);
  assert.equal(bilan(data(r)).facts.receivables, 900);
});

test('dépense engagée non payée : charge à payer au passif, écart expliqué', () => {
  const { facts, bil } = bilan(data({ expenses: [...expenses, exp('entretien', 300, '2025-12-20', { payment_status: 'a_payer', paid_on: null })] }));
  assert.equal(facts.payables, 300);
  assert.ok(Math.abs(bil.gap + 300) < 0.05, `écart ${bil.gap}`);
  assert.ok(Math.abs(bil.gapExplained.other) < 0.05);
});

test('capital restant dû de la banque prioritaire, écart signalé et expliqué', () => {
  const computed = loanBalance(prop, 2025).remaining;
  const inputs = (_: string, y: number) => (y === 2025 ? { loan_remaining_bank: computed - 2000 } : {});
  const { facts, liasse, bil } = bilan(data(), inputs);
  assert.equal(liasse.loans.remaining, round(computed - 2000));
  assert.equal(facts.loans.bankGap, -2000);
  assert.ok(facts.warnings.some((w) => w.includes('différent du calcul')));
  assert.ok(Math.abs(bil.gap - 2000) < 0.05 && Math.abs(bil.gapExplained.other) < 0.05, `écart ${bil.gap}`);
  assert.ok(liasse.loans.beyondOneYear < liasse.loans.remaining);
});

test('reprise du bilan N-1 déposé ailleurs : ouverture saisie', () => {
  const { facts } = bilan(data(), none, { openingEquity: 12345 });
  assert.equal(facts.exploitant.source, 'bilan_n-1');
  assert.equal(facts.exploitant.opening, 12345);
});

test('dépôt prévu au bail sans encaissement : avertissement', () => {
  const { facts } = bilan(data({ deposits: [] }));
  assert.equal(facts.depositsHeld, 0);
  assert.ok(facts.warnings.some((w) => w.includes('aucun encaissement')));
});

test('contrôles : écart non expliqué bloquant, écart expliqué en avertissement', () => {
  const base = { partner: { agrement: '9400101', name: 'X', address: { street: '1 rue A', zip: '94300', city: 'V' }, transfer: { mode: 'T', alias: 'ABCDEFGH' }, software: { editor: 'E', program: 'P', version: '1' }, attestation: 'A' },
    declarant: { siren: '079555934', rof: 'BIC1', name: 'M', address: { street: '1 rue B', zip: '44001', city: 'N' } }, period: { start: '2025-01-01', end: '2025-12-31' },
    test: true, preparedAt: new Date('2026-04-15T10:00:00Z'), sequence: 1, documentRef: 'R' } as const;
  const { facts, liasse } = bilan(data(rentData(['2025-12'])));
  const msgs = (bal: object) => checkRequest({ ...base, liasse, balance: bal } as TdfcRequest).filter((c) => c.message.startsWith('2033-A : écart'));
  const explained = msgs(balanceFromFacts(facts));
  assert.equal(explained[0]?.level, 'avertissement');
  assert.match(explained[0]!.message, /loyers impayés au 31\/12 900/);
  const unexplained = msgs({ ...balanceFromFacts(facts), exploitant: facts.exploitant.closing - 5000 });
  assert.equal(unexplained[0]?.level, 'bloquant');
});

function round(v: number) { return Math.round(v * 100) / 100; }
