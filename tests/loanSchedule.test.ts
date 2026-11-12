import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amortize } from '../src/domain/simulator.ts';
import { buildSchedule, cellsToLines, parseAmount, parseDate, parseTable, pdfItemsToLines, scheduleRemaining, scheduleYears, tokenizeText } from '../src/domain/loanSchedule.ts';
import { fiscalSummary, loanYear, yearAmounts, type FiscalData } from '../src/domain/fiscal.ts';
import type { Property } from '../src/data/types.ts';

const fr = (v: number) => v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const fdate = (iso: string) => iso.split('-').reverse().join('/');
function due(start: string, i: number) {
  const [y, m, d] = start.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1 + i, d));
  return t.toISOString().slice(0, 10);
}
/** Tableau type d'une banque : n°, date, échéance, intérêts, capital amorti, assurance, capital restant dû. */
function bankTable(amount: number, rate: number, months: number, start: string, ins: number) {
  let bal = amount;
  return amortize(amount, rate, months, 0).map((r, i) => {
    bal = Math.round((bal - r.principal) * 100) / 100;
    return { n: i + 1, date: due(start, i), payment: Math.round((r.interest + r.principal + ins) * 100) / 100, interest: Math.round(r.interest * 100) / 100, principal: Math.round(r.principal * 100) / 100, ins, bal: Math.max(0, bal) };
  });
}

test('montants et dates à la française', () => {
  assert.equal(parseAmount('1 234,56'), 1234.56);
  assert.equal(parseAmount('1.234,56'), 1234.56);
  assert.equal(parseAmount('914,76 €'), 914.76);
  assert.equal(parseAmount('170 139,00'), 170139);
  assert.equal(parseAmount('2023'), null);
  assert.equal(parseAmount('3,180'), null);
  assert.equal(parseDate('15/04/2023'), '2023-04-15');
  assert.equal(parseDate('15/04/23'), '2023-04-15');
  assert.equal(parseDate('2023-04-15'), '2023-04-15');
  assert.equal(parseDate('04/2023'), '2023-04-01');
});

test('texte copié d’un PDF : colonnes reconnues sans en-tête, totaux par année', () => {
  const t = bankTable(170139, 2.66, 240, '2023-04-15', 4.61);
  const text = ['TABLEAU D’AMORTISSEMENT', ...t.map((r) => `${r.n} ${fdate(r.date)} ${fr(r.payment)} ${fr(r.interest)} ${fr(r.principal)} ${fr(r.ins)} ${fr(r.bal)}`)].join('\n');
  const parsed = parseTable(tokenizeText(text));
  assert.equal(parsed.rows.length, 240);
  assert.deepEqual(parsed.roles, ['payment', 'interest', 'principal', 'insurance', 'remaining']);
  const { schedule } = buildSchedule(parsed, parsed.roles, null, 'test');
  const years = scheduleYears(schedule);
  const y23 = years.find((y) => y.year === 2023)!;
  assert.equal(y23.count, 9);
  assert.ok(Math.abs(y23.interest - 3351.14) < 0.5, `intérêts 2023 : ${y23.interest}`);
  assert.equal(y23.insurance, 41.49);
  assert.equal(scheduleRemaining(schedule, 2023), t[8]!.bal);
});

test('CSV avec en-têtes dans un autre ordre', () => {
  const t = bankTable(100000, 3, 120, '2024-01-10', 0);
  const csv = ['Date;Capital restant dû;Intérêts;Amortissement;Mensualité', ...t.map((r) => `${fdate(r.date)};${fr(r.bal)};${fr(r.interest)};${fr(r.principal)};${fr(r.payment)}`)].join('\n');
  const parsed = parseTable(tokenizeText(csv));
  assert.deepEqual(parsed.roles, ['remaining', 'interest', 'principal', 'payment']);
  const { schedule } = buildSchedule(parsed, parsed.roles, null);
  assert.equal(scheduleYears(schedule)[0]!.interest, Math.round(t.slice(0, 12).reduce((a, r) => a + r.interest, 0) * 100) / 100);
});

test('classeur Excel : dates en numéro de série, montants numériques, case d’assurance vide', () => {
  const t = bankTable(50000, 2, 24, '2025-03-05', 10);
  const serial = (iso: string) => Math.round((Date.parse(iso) - Date.UTC(1899, 11, 30)) / 86400000);
  const rows = [['Échéance', 'Date', 'Intérêts', 'Capital', 'Assurance', 'Restant dû'], ...t.map((r, i) => [r.n, serial(r.date), r.interest, r.principal, i === 0 ? null : r.ins, r.bal])];
  const parsed = parseTable(cellsToLines(rows));
  assert.deepEqual(parsed.roles, ['interest', 'principal', 'insurance', 'remaining']);
  const { schedule } = buildSchedule(parsed, parsed.roles, null);
  assert.equal(schedule!.rows[0]!.date, '2025-03-05');
  assert.equal(schedule!.rows[0]!.insurance, 0);
  assert.equal(schedule!.rows[1]!.insurance, 10);
});

test('PDF : morceaux positionnés, échéances sans date datées depuis la première échéance', () => {
  const t = bankTable(230000, 3.18, 240, '2025-09-10', 13.77).slice(0, 30);
  const item = (str: string, xRight: number, y: number) => ({ str, transform: [1, 0, 0, 1, xRight - str.length * 4, y], width: str.length * 4 });
  const page = [
    item('N°', 40, 760), item('Échéance', 140, 760), item('Intérêts', 220, 760), item('Capital', 300, 760), item('Assurance', 380, 760), item('Capital restant dû', 480, 760),
    ...t.flatMap((r, i) => [item(String(r.n), 40, 740 - i * 12), item(fr(r.payment), 140, 740 - i * 12), item(fr(r.interest), 220, 740 - i * 12), item(fr(r.principal), 300, 740 - i * 12), item(fr(r.ins), 380, 740 - i * 12), item(fr(r.bal), 480, 740 - i * 12)]),
  ];
  const parsed = parseTable(pdfItemsToLines([page]));
  assert.deepEqual(parsed.roles, ['payment', 'interest', 'principal', 'insurance', 'remaining']);
  assert.equal(buildSchedule(parsed, parsed.roles, null).errors.length, 1, 'date de première échéance exigée');
  const { schedule } = buildSchedule(parsed, parsed.roles, '2025-09-10');
  assert.equal(schedule!.rows[3]!.date, '2025-12-10');
  assert.equal(scheduleYears(schedule)[0]!.count, 4);
});

const base = { id: 'p', user_id: 'u', title: 'Bien', status: 'acquis', tax_regime: 'reel_bic', version: 1, created_at: '', updated_at: '' } as unknown as Property;
const empty: FiscalData = { properties: [], leases: [], charges: [], payments: [], allocations: [], expenses: [] };

test('le tableau importé prime sur l’échéancier calculé ; la saisie de l’année prime sur tout', () => {
  const p: Property = { ...base, acquired_at: '2025-08-27', loan_amount: 230000, loan_rate: 3.18, loan_years: 20, loan_start_date: '2025-09-10', loan_insurance_monthly: 13.77,
    loan_schedule: { imported_at: '', rows: [
      { date: '2025-08-11', payment: 841.22, interest: 841.22, principal: 0, insurance: 0, remaining: 230000 },
      { date: '2025-09-10', payment: 1296.4, interest: 609.5, principal: 686.9, insurance: 0, remaining: 229313.1 },
      { date: '2026-01-10', payment: 1296.4, interest: 600, principal: 696.4, insurance: 0, remaining: 228616.7 },
    ] } };
  assert.deepEqual(loanYear(p, 2025), { interest: 1450.72, insurance: 0, principal: 686.9, months: 2, source: 'tableau' });
  assert.equal(loanYear(p, 2024), null, 'rien avant l’acquisition');
  const a = yearAmounts(p, 2025, { ...empty, properties: [p] });
  assert.equal(a.interest, 1450.72);
  assert.equal(a.interestSource, 'tableau');
  const typed = yearAmounts(p, 2025, { ...empty, properties: [p] }, { loan_interest: 2260, loan_insurance: 30 });
  assert.equal(typed.interest, 2260);
  assert.equal(typed.loanInsurance, 30);
  assert.equal(typed.interestSource, 'saisie');
  assert.equal(typed.interestComputed, 1450.72);
});

test('un bien acheté plus tard n’entre pas dans l’activité des années précédentes (prêt mal daté)', () => {
  const p18: Property = { ...base, id: 'a', acquired_at: '2023-03-31', acquisition_cost: 100000 };
  // date de première échéance erronée, un an avant l'achat
  const p19: Property = { ...base, id: 'b', acquired_at: '2025-08-27', acquisition_cost: 200000, loan_amount: 230000, loan_rate: 3.18, loan_years: 20, loan_start_date: '2024-09-10' };
  const d: FiscalData = { ...empty, properties: [p18, p19] };
  const s24 = fiscalSummary(2024, d, () => ({}));
  assert.deepEqual(s24.reelBic!.perProperty.map((r) => r.propertyId), ['a']);
  const s25 = fiscalSummary(2025, d, () => ({}));
  const r19 = s25.reelBic!.perProperty.find((r) => r.propertyId === 'b')!;
  assert.equal(r19.deferredBefore, 0);
});

test('frais de garantie et assurance emprunteur en charges financières (ligne 294)', () => {
  const p: Property = { ...base, acquired_at: '2024-01-01', acquisition_cost: 100000 };
  const exp = (category: string, amount: number) => ({ id: category, property_id: 'p', expense_date: '2024-03-01', paid_on: '2024-03-01', payment_status: 'paye', amount, category, recoverable_amount: 0, label: category }) as never;
  const d: FiscalData = { ...empty, properties: [p], expenses: [exp('frais_credit', 2000), exp('assurance_credit', 100), exp('interets', 1500), exp('copropriete', 800)] };
  const s = fiscalSummary(2024, d, () => ({}));
  const r = s.reelBic!.perProperty[0]!;
  assert.equal(r.chargesTotal, 800);
  assert.equal(r.interest, 3600);
  const l = Object.fromEntries(s.reelBic!.liasse.lines.map((x) => [x.code, x.amount]));
  assert.equal(l['242'], 800);
  assert.equal(l['294'], 3600);
});
