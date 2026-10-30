import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bracketFor, currentBenchmarks, estimateTaeg, latestUsury, proposedRate, quarterOf, rateScenarios, remainingYears, renegotiation, USURY_2026_Q4,
  usuryFor, usuryStatus, type RateBenchmark,
} from '../src/domain/loanRates.ts';

const bench = (on: string, rates: [number, number][], source = 'Administrateur'): RateBenchmark[] => rates.map(([years, rate]) => ({ effective_on: on, years, rate, source }));
const list = [...bench('2026-09-01', [[15, 3.2], [20, 3.4], [25, 3.5]]), ...bench('2026-10-01', [[10, 3.2], [15, 3.4], [20, 3.55], [25, 3.7]])];

test('taux : tranches d’usure selon la durée', () => {
  assert.equal(bracketFor(7), 'moins_10');
  assert.equal(bracketFor(10), '10_20');
  assert.equal(bracketFor(19), '10_20');
  assert.equal(bracketFor(20), '20_plus');
  assert.equal(bracketFor(22), '20_plus');
  assert.deepEqual(quarterOf('2026-10-30'), { quarter: '2026-Q4', from: '2026-10-01', to: '2026-12-31' });
  assert.deepEqual(quarterOf('2027-02-10'), { quarter: '2027-Q1', from: '2027-01-01', to: '2027-03-31' });
});

test('taux : barème en vigueur et interpolation (critère 22 ans → 3,61 %)', () => {
  assert.equal(currentBenchmarks(list, '2026-10-30')!.on, '2026-10-01');
  assert.equal(currentBenchmarks(list, '2026-09-15')!.on, '2026-09-01');
  assert.equal(currentBenchmarks(list, '2026-08-01'), null);
  const p = proposedRate(list, 22, '2026-10-30')!;
  assert.equal(p.rate, 3.61);
  assert.equal(p.interpolated, true);
  assert.equal(p.stale, false);
  assert.equal(proposedRate(list, 20, '2026-10-30')!.rate, 3.55);
  const far = proposedRate(list, 30, '2026-10-30')!;
  assert.equal(far.rate, 3.7);
  assert.equal(far.extrapolated, true);
  // plus de 45 jours sans mise à jour : à vérifier
  assert.equal(proposedRate(list, 20, '2026-11-20')!.stale, true);
});

test('taux : usure du 4e trimestre 2026 (Banque de France)', () => {
  assert.equal(usuryFor(USURY_2026_Q4, 'particulier', 22, '2026-10-30')!.usury, 5.4);
  assert.equal(usuryFor(USURY_2026_Q4, 'particulier', 15, '2026-10-30')!.usury, 4.68);
  assert.equal(usuryFor(USURY_2026_Q4, 'personne_morale', 25, '2026-10-30')!.usury, 5.83);
  // trimestre suivant non chargé : pas de valeur périmée
  assert.equal(usuryFor(USURY_2026_Q4, 'particulier', 22, '2027-01-02'), null);
  assert.equal(latestUsury(USURY_2026_Q4, 'particulier', '20_plus')!.quarter, '2026-Q4');
});

test('taux : TAEG estimé (assurance et frais compris)', () => {
  const base = { amount: 200000, rate: 3.5, years: 20, insuranceRate: 0, fees: 0 };
  // sans frais ni assurance : TAEG = taux actuariel du taux nominal mensuel
  assert.equal(estimateTaeg(base), 3.56);
  const withIns = estimateTaeg({ ...base, insuranceRate: 0.3 })!;
  const withAll = estimateTaeg({ ...base, insuranceRate: 0.3, fees: 3000 })!;
  assert.ok(withIns > 3.56 && withAll > withIns);
  assert.ok(withAll > 3.9 && withAll < 4.3, String(withAll));
  assert.equal(estimateTaeg({ ...base, rate: 0 }), 0);
  assert.equal(estimateTaeg({ ...base, amount: 0 }), null);
  assert.equal(usuryStatus(withAll, 5.4), 'ok');
  assert.equal(usuryStatus(5.3, 5.4), 'proche');
  assert.equal(usuryStatus(5.5, 5.4), 'depasse');
});

test('taux : scénarios, durée restante, renégociation', () => {
  assert.deepEqual(rateScenarios(3.55).map((s) => s.rate), [3.25, 3.55, 3.85]);
  assert.equal(remainingYears(25, '2020-01-05', '2026-10-30'), 19);
  assert.equal(remainingYears(5, '2018-01-05', '2026-10-30'), 0);
  assert.deepEqual(renegotiation(4.6, 3.55), { gap: 1.05, worth: true });
  assert.deepEqual(renegotiation(3.9, 3.55), { gap: 0.35, worth: false });
  assert.equal(renegotiation(null, 3.55), null);
});
