import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Expense, Property } from '../src/data/types.ts';
import { fiscalSummary, foncierBoxes, loanYear, reelBic, type FiscalData, type Foncier2044 } from '../src/domain/fiscal.ts';

const prop = (o: Partial<Property>): Property => ({
  id: 'p1', user_id: 'u', version: 1, created_at: '', updated_at: '', title: 'T2', status: 'acquis', status_before_archive: null, occupation_status: 'loue',
  property_type: 'appartement', address: null, zip: null, city: null, surface: 40, rooms: 2, dpe: null, listing_url: null, asking_price: null, offer_price: null,
  works_budget: null, estimated_rent: 900, charges_provision: 100, agency_id: null, agent_id: null, next_action: null, follow_up_date: null, visit_at: null,
  comments: null, vigilance: [], ownership_mode: 'nom_propre', tax_regime: 'reel_foncier', acquired_at: '2023-01-01', acquisition_cost: 200000,
  acquisition_snapshot: null, primary_scenario_id: null, legacy_simulation_id: null, legacy_ref: null, ...o,
});
let n = 0;
const exp = (category: Expense['category'], amount: number, d = '2025-03-01', o: Partial<Expense> = {}): Expense => ({
  id: `e${++n}`, user_id: 'u', version: 1, created_at: '', updated_at: '', property_id: 'p1', expense_date: d, supplier: null, label: null, amount, category,
  nature: 'charge', recoverable_amount: 0, payment_status: 'paye', paid_on: d, document_id: null, notes: null, ...o,
});
const data = (p: Property, expenses: Expense[]): FiscalData => ({ properties: [p], leases: [], charges: [], payments: [], allocations: [], expenses });

test('intérêts de l’année d’après le crédit du bien', () => {
  const y = loanYear(prop({ loan_amount: 200000, loan_rate: 3.5, loan_years: 20, loan_start_date: '2025-01-05', loan_insurance_monthly: 40 }), 2025)!;
  assert.equal(y.months, 12);
  assert.ok(y.interest > 6800 && y.interest < 7000, `intérêts 1re année ≈ 6 900 € : ${y.interest}`);
  assert.equal(y.insurance, 480);
});

test('2044 : loyers importés (hors charges), lignes de charges, intérêts, forfait 20 €', () => {
  const p = prop({ loan_amount: 100000, loan_rate: 3, loan_years: 20, loan_start_date: '2024-01-10', loan_insurance_monthly: 20 });
  const s = fiscalSummary(2025, data(p, [
    exp('loyer', 12000), exp('copropriete', 1200), exp('taxe_fonciere', 900, '2025-10-15', { recoverable_amount: 150 }),
    exp('assurance', 120), exp('entretien', 300), exp('entretien_amortissable', 700), exp('mobilier', 400), exp('frais_bancaires', 60),
    exp('credit', 6000), exp('copropriete', 999, '2024-06-01'),
  ]), () => ({ regularisation: 200 }));
  const l = Object.fromEntries(s.reelFoncier!.perProperty[0]!.lines.map((x) => [x.code, x.amount]));
  assert.equal(l['211'], 10800, 'loyer CC 12 000 → hors charges 900/1000');
  assert.equal(l['222'], 20);
  assert.equal(l['223'], 120);
  assert.equal(l['224'], 1000);
  assert.equal(l['227'], 750, 'taxe d’ordures ménagères exclue');
  assert.equal(l['229'], 1200, 'seules les provisions payées en 2025');
  assert.equal(l['230'], 200);
  assert.equal(l['240'], 20 + 120 + 1000 + 750 + 1200 - 200);
  const loan = loanYear(p, 2025)!;
  assert.equal(l['250'], Math.round((loan.interest + 240) * 100) / 100, 'intérêts du tableau + assurance, jamais la mensualité');
  assert.ok(s.reelFoncier!.perProperty[0]!.notDeductible.some((x) => x.label.startsWith('Meubles')));
  assert.equal(s.reelFoncier!.boxes.box4BA, l['263']);
});

test('déficit foncier : 4BC plafonné à 10 700 €, intérêts reportés en 4BB', () => {
  const f = (r215: number, r240: number, r250: number) => ({ propertyId: 'x', lines: [], r215, r240, r250, r263: r215 - r240 - r250, notDeductible: [] }) as Foncier2044;
  const a = foncierBoxes([f(10000, 15000, 3000)]); // intérêts < recettes
  assert.equal(a.box4BC, 8000);
  assert.equal(a.box4BB, 0);
  const b = foncierBoxes([f(10000, 25000, 3000)]);
  assert.equal(b.box4BC, 10700);
  assert.equal(b.box4BB, 18000 - 10700);
  const c = foncierBoxes([f(5000, 4000, 8000)]); // intérêts > recettes
  assert.equal(c.box4BC, 4000);
  assert.equal(c.box4BB, 3000);
  assert.equal(foncierBoxes([f(10000, 2000, 1000)]).box4BA, 7000);
});

test('micro-foncier 4BE et micro-BIC 5ND, seuils signalés', () => {
  const mf = fiscalSummary(2025, data(prop({ tax_regime: 'micro_foncier', charges_provision: 0, estimated_rent: 0 }), [exp('loyer', 16000)]), () => ({}));
  assert.equal(mf.microFoncier!.box4BE, 16000);
  assert.ok(mf.microFoncier!.warnings.some((w) => w.includes('15000')));
  const mb = fiscalSummary(2025, data(prop({ tax_regime: 'micro_bic' }), [exp('loyer', 12000)]), () => ({}));
  assert.equal(mb.microBic!.box5ND, 12000, 'recettes charges comprises');
  assert.equal(mb.microBic!.taxable, 6000);
});

test('LMNP réel : amortissement limité au résultat, excédent reporté', () => {
  const p = prop({ tax_regime: 'reel_bic', acquired_at: '2024-01-01', acquisition_cost: 300000 });
  const d = data(p, [exp('loyer', 10000, '2024-06-01'), exp('copropriete', 2000, '2024-06-01'), exp('loyer', 12000), exp('copropriete', 2000), exp('mobilier', 7000, '2025-01-01')]);
  const r24 = reelBic(p, 2024, d, () => ({}));
  assert.equal(r24.resultBeforeDepreciation, 8000);
  assert.equal(r24.depreciationYear, 8500, '300 000 × 85 % / 30');
  assert.equal(r24.depreciationDeducted, 8000);
  assert.equal(r24.box5NA, 0);
  assert.equal(r24.deferredAfter, 500);
  const r25 = reelBic(p, 2025, d, () => ({}));
  assert.equal(r25.deferredBefore, 500);
  assert.equal(r25.depreciationYear, 8500 + 1000);
  assert.equal(r25.box5NA, 0);
  assert.equal(r25.deferredAfter, 8500 + 1000 + 500 - 10000);
  assert.equal(r25.box5NY, 0, 'l’amortissement ne crée jamais de déficit');
});

test('amortissement : durée personnalisée sur la dépense, cumul et reste, pas de double déduction en LMNP', async () => {
  const { depreciationItems, reelBic } = await import('../src/domain/fiscal.ts');
  const p = prop({ tax_regime: 'reel_bic', acquired_at: '2024-01-01', acquisition_cost: 300000 });
  const d = data(p, [
    exp('loyer', 20000), exp('entretien', 5000, '2025-01-01', { amortization_years: 5, label: 'Cuisine' }),
    exp('mobilier', 3500, '2024-01-01', { label: 'Canapé' }), exp('entretien', 400),
  ]);
  const { items } = depreciationItems(p, 2025, d, {}, false);
  const cuisine = items.find((i) => i.label.includes('Cuisine'))!;
  assert.equal(cuisine.years, 5);
  assert.equal(cuisine.amount, 1000);
  const canape = items.find((i) => i.label.includes('Canapé'))!;
  assert.equal(canape.years, 7, 'durée par défaut des meubles');
  assert.equal(canape.cumulated, 1000, 'deux années de 500 €');
  assert.equal(canape.remaining, 2500);
  const r = reelBic(p, 2025, d, () => ({}));
  assert.equal(r.charges.find((c) => c.label.startsWith('Entretien'))!.amount, 400, 'la cuisine amortie n’est pas aussi déduite en charge');
  assert.equal(r.depreciationYear, 8500 + 1000 + 500);
});
