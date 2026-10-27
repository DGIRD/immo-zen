import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_INPUTS, userDefaults, amortize, autoProvisionMonthly, autoRecoverableAnnual, normalizeInputs, round2, simulate, type SimulationInputs, type SimulationResult } from '../src/domain/simulator.ts';

function run(over: Partial<SimulationInputs>): SimulationResult {
  const out = simulate({ ...DEFAULT_INPUTS, rentMode: 'manuel', ...over });
  if (!out.ok) throw new Error('Erreurs inattendues : ' + JSON.stringify(out.errors));
  return out.result;
}
const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));

test('valeurs par défaut demandées', () => {
  assert.equal(DEFAULT_INPUTS.notaryRate, 7.5);
  assert.equal(DEFAULT_INPUTS.agencyFees, 10000);
  assert.equal(DEFAULT_INPUTS.interestRate, 3.5);
  assert.equal(DEFAULT_INPUTS.loanYears, 20);
  assert.equal(DEFAULT_INPUTS.insuranceRate, 0.3);
  assert.equal(DEFAULT_INPUTS.pnoAnnual, 99);
});

test('mensualité de référence : 200 000 € à 3,5 % sur 20 ans = 1 159,92 €', () => {
  const rows = amortize(200000, 3.5, 240, 0);
  assert.equal(rows.length, 240);
  assert.equal(rows[0]!.payment, 1159.92);
  assert.equal(rows[0]!.interest, 583.33);
  assert.equal(rows.at(-1)!.balance, 0);
  assert.equal(sum(rows.map((r) => r.principal)), 200000, 'le capital remboursé égale exactement le capital emprunté');
  const last = rows.at(-1)!;
  assert.ok(Math.abs(last.payment - 1159.92) < 1, 'la dernière échéance n’est ajustée que de quelques centimes');
});

test('cas complet : coût total, frais de notaire 7,5 % du prix proposé, emprunt', () => {
  const r = run({ price: 200000, works: 10000, furniture: 2000, guaranteeFees: 1500, dossierFees: 500, downPayment: 30000 });
  assert.equal(r.notaryFees, 15000);
  assert.equal(r.totalCost, 200000 + 10000 + 15000 + 10000 + 2000 + 2000);
  assert.equal(r.loanAmount, 239000 - 30000);
  assert.equal(r.equity, 30000);
  assert.equal(r.monthlyInsurance, round2((209000 * 0.003) / 12));
  assert.equal(r.monthlyPaymentWithInsurance, round2(r.monthlyPayment + r.monthlyInsurance));
  assert.equal(r.financingCost, round2(r.totalInterest + r.totalInsurance + 2000));
  assert.equal(r.totalInsurance, round2(r.monthlyInsurance * 240));
});

test('frais déjà inclus : prix honoraires inclus → notaire calculé hors honoraires, pas de double comptage', () => {
  const horsHonoraires = run({ priceMode: 'hors_honoraires', price: 200000, agencyFees: 10000 });
  const inclus = run({ priceMode: 'honoraires_inclus', price: 210000, agencyFees: 10000 });
  assert.equal(inclus.netPrice, 200000);
  assert.equal(inclus.notaryFees, 15000);
  assert.equal(inclus.totalCost, horsHonoraires.totalCost);
});

test('frais de notaire saisis en montant', () => {
  const r = run({ price: 100000, notaryMode: 'amount', notaryAmount: 8123.45, agencyFees: 0 });
  assert.equal(r.notaryFees, 8123.45);
  assert.equal(r.totalCost, 108123.45);
});

test('taux nul : mensualité = capital / nombre de mois, aucun intérêt', () => {
  const r = run({ price: 120000, agencyFees: 0, notaryMode: 'amount', notaryAmount: 0, interestRate: 0, insuranceRate: 0, loanYears: 10 });
  assert.equal(r.loanAmount, 120000);
  assert.equal(r.monthlyPayment, 1000);
  assert.equal(r.totalInterest, 0);
  assert.equal(r.amortization.at(-1)!.balance, 0);
});

test('absence de crédit : tout est financé par apport, aucun remboursement', () => {
  const r = run({ price: 150000, useLoan: false, monthlyRent: 800 });
  assert.equal(r.loanAmount, 0);
  assert.equal(r.equity, r.totalCost);
  assert.equal(r.amortization.length, 0);
  assert.equal(r.monthlyPaymentWithInsurance, 0);
  assert.equal(r.cashflowMonthlyYear1, round2(r.annualNetOperatingIncome / 12));
});

test('apport élevé : supérieur au coût total → emprunt nul et avertissement', () => {
  const r = run({ price: 100000, downPayment: 500000 });
  assert.equal(r.loanAmount, 0);
  assert.equal(r.unusedDownPayment, 500000 - r.totalCost);
  assert.ok(r.warnings.some((w) => w.includes('apport')));
  assert.equal(r.totalInsurance, 0);
});

test('valeurs invalides : négatives, texte, durée nulle, part récupérable excessive', () => {
  const bad = simulate(normalizeInputs({ price: -1, interestRate: 'abc', loanYears: 0, coproChargesAnnual: 100, coproRecoverableAnnual: 200 }));
  assert.equal(bad.ok, false);
  if (bad.ok) return;
  const fields = bad.errors.map((e) => e.field);
  assert.ok(fields.includes('price'));
  assert.ok(fields.includes('interestRate'));
  const bad2 = simulate(normalizeInputs({ loanYears: 0 }));
  assert.ok(!bad2.ok && bad2.errors.some((e) => e.field === 'loanYears'));
  const bad3 = simulate(normalizeInputs({ coproChargesAnnual: 100, coproRecoverableAnnual: 200 }));
  assert.ok(!bad3.ok && bad3.errors.some((e) => e.field === 'coproRecoverableAnnual'));
  const bad4 = simulate(normalizeInputs({ priceMode: 'honoraires_inclus', price: 5000, agencyFees: 10000 }));
  assert.ok(!bad4.ok && bad4.errors.some((e) => e.field === 'agencyFees'));
});

test('normalisation : nombres saisis à la française et valeurs manquantes', () => {
  const i = normalizeInputs({ price: '215 000,50', works: '' });
  assert.equal(i.price, 215000.5);
  assert.equal(i.works, 0);
  assert.equal(i.loanYears, 20);
});

test('le remboursement du capital n’est pas une charge : il réduit le cash-flow mais pas le revenu net d’exploitation', () => {
  const r = run({ price: 200000, monthlyRent: 1000, pnoAnnual: 150, propertyTaxAnnual: 1000, propertyTaxRecoverableAnnual: 200, coproChargesAnnual: 1200, coproRecoverableAnnual: 800, vacancyAnnual: 500 });
  assert.equal(r.annualOwnerCharges, 150 + 800 + 400);
  assert.equal(r.annualNetOperatingIncome, 12000 - 500 - 1350);
  assert.ok(!r.ownerChargesDetail.some((c) => /capital/i.test(c.label)));
  assert.equal(r.cashflowAnnualYear1, round2(r.annualNetOperatingIncome - r.year1DebtService));
  assert.ok(r.year1PrincipalRepaid > 0);
  assert.equal(round2(r.grossYield * r.totalCost / 100), 12000);
});

test('différé partiel : intérêts seuls pendant le différé, puis amortissement sur la durée restante', () => {
  const rows = amortize(100000, 3, 240, 0, 'partiel', 12);
  assert.equal(rows.length, 240);
  assert.equal(rows[0]!.payment, 250);
  assert.equal(rows[11]!.balance, 100000);
  const r = 0.03 / 12;
  assert.equal(rows[12]!.payment, round2((100000 * r) / (1 - Math.pow(1 + r, -228))));
  assert.equal(rows.at(-1)!.balance, 0);
});

test('différé total : intérêts capitalisés, aucune échéance de crédit pendant le différé', () => {
  const rows = amortize(100000, 3, 240, 25, 'total', 6);
  assert.equal(rows[0]!.payment, 0);
  assert.equal(rows[0]!.capitalized, 250);
  assert.ok(rows[5]!.balance > 100000);
  assert.equal(rows[5]!.insurance, 25, 'l’assurance reste due pendant le différé');
  assert.equal(sum(rows.map((x) => x.principal)), rows[5]!.balance);
  assert.equal(rows.at(-1)!.balance, 0);
});

test('différé plus long que le prêt refusé', () => {
  const out = simulate({ ...DEFAULT_INPUTS, price: 100000, loanYears: 1, deferralType: 'partiel', deferralMonths: 12 });
  assert.ok(!out.ok && out.errors.some((e) => e.field === 'deferralMonths'));
});

test('arrondis au centime', () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(-1.005), -1.01);
  assert.equal(round2(0.1 + 0.2), 0.3);
});

test('négociation : prix de présentation FAI comparé au prix proposé FAI, en montant et en %', () => {
  const horsHonoraires = run({ askingPrice: 230000, price: 205000, agencyFees: 10000 });
  assert.equal(horsHonoraires.offerFai, 215000);
  assert.equal(horsHonoraires.negotiationAmount, 15000);
  assert.equal(round2(horsHonoraires.negotiationPct!), 6.52);
  const inclus = run({ priceMode: 'honoraires_inclus', askingPrice: 230000, price: 215000, agencyFees: 10000 });
  assert.equal(inclus.negotiationAmount, 15000);
  assert.equal(run({ price: 200000 }).negotiationAmount, null, 'sans prix de présentation, pas de négociation');
  assert.ok(run({ askingPrice: 100000, price: 120000, agencyFees: 0 }).warnings.some((w) => w.includes('dépasse')));
});

test('loyer : surface × prix au m² bas ou haut, loyer charges comprises', () => {
  const base = { surface: 42, rentM2Low: 22, rentM2High: 26.5, monthlyRent: 999, chargesProvisionMonthly: 60, price: 200000 };
  const bas = run({ ...base, rentMode: 'bas' });
  assert.equal(bas.monthlyRent, 924);
  assert.equal(bas.annualRent, 11088);
  assert.equal(bas.monthlyRentWithCharges, 984);
  assert.equal(run({ ...base, rentMode: 'haut' }).monthlyRent, 1113);
  assert.equal(run({ ...base, rentMode: 'manuel' }).monthlyRent, 999, 'saisie libre conservée');
  const bad = simulate({ ...DEFAULT_INPUTS, ...base, rentMode: 'bas', rentM2Low: 30, rentM2High: 20 });
  assert.ok(!bad.ok && bad.errors.some((e) => e.field === 'rentM2High'));
});

test('charges de copropriété : 80 % récupérables, arrondis à l’euro supérieur', () => {
  assert.equal(autoRecoverableAnnual(1200), 960);
  assert.equal(autoRecoverableAnnual(1001), 801, '800,80 arrondi à 801');
  assert.equal(autoProvisionMonthly(1200), 80);
  assert.equal(autoProvisionMonthly(1000), 67, '66,67 arrondi à 67');
  assert.equal(autoProvisionMonthly(0), 0);
});

test('anciens scénarios : loyer saisi conservé, fourchette de l’ancienne version reprise', () => {
  const i = normalizeInputs({ monthlyRent: 850, legacy: { rentM2Low: 20, rentM2High: 24 } } as never);
  assert.equal(i.rentMode, 'manuel');
  assert.equal(i.monthlyRent, 850);
  assert.equal(i.rentM2Low, 20);
  assert.equal(normalizeInputs({}).rentMode, 'bas', 'nouvelle simulation : loyer calculé au m²');
});

test('valeurs par défaut de l’utilisateur : PNO à 99 € sauf choix enregistré depuis son ajout', () => {
  assert.equal(userDefaults({ notaryRate: 8, pnoAnnual: 0 }).pnoAnnual, 99, 'ancien enregistrement : 0 € ignoré');
  assert.equal(userDefaults({ notaryRate: 8 }).notaryRate, 8);
  assert.equal(userDefaults({ pnoAnnual: 120, _v: 2 }).pnoAnnual, 120);
  assert.equal(userDefaults({ price: 5, _v: 2 }).price, 0, 'seuls les champs réglables sont repris');
});

test('prospection : pas de cash-flow tant que le loyer au m² n’est pas renseigné', async () => {
  const { simulate, simulatedCashflow, DEFAULT_INPUTS } = await import('../src/domain/simulator.ts');
  const base = { ...DEFAULT_INPUTS, price: 150000, surface: 30, pnoAnnual: 120, propertyTaxAnnual: 700 };
  const empty = simulate({ ...base, rentMode: 'bas', rentM2Low: 0 });
  assert.ok(empty.ok);
  assert.equal(simulatedCashflow(empty.result), null, 'charges seules : simulation non lancée');
  const filled = simulate({ ...base, rentMode: 'bas', rentM2Low: 25 });
  assert.ok(filled.ok);
  assert.equal(simulatedCashflow(filled.result), filled.result.cashflowMonthlyYear1);
});
