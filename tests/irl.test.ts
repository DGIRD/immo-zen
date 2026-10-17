import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IRL_VALUES, lastPublishedYear, latestPublishedAt, revisionPlan } from '../src/domain/irl.ts';

const lease = { start_date: '2024-03-01', end_date: null, rent_hc: 800, irl_enabled: true, irl_base_label: '2023-T4', irl_base_value: 142.06, last_revision_on: null };

test('IRL : valeurs INSEE et dernier indice publié', () => {
  assert.equal(IRL_VALUES['2026-T3'], 148.06);
  assert.equal(latestPublishedAt('2026-10-17'), '2026-T3');
  assert.equal(latestPublishedAt('2026-10-14'), '2026-T2');
  assert.equal(lastPublishedYear(4, '2025-03-01'), 2024);
  assert.equal(lastPublishedYear(2, '2025-06-30'), 2024);
  assert.equal(lastPublishedYear(2, '2025-07-20'), 2025);
});

test('première révision à la date anniversaire : variation annuelle du même trimestre', () => {
  const p = revisionPlan(lease, '2025-03-01');
  assert.equal(p.block, null);
  assert.equal(p.anniversary, '2025-03-01');
  assert.equal(p.newKey, '2024-T4');
  assert.equal(p.oldKey, '2023-T4');
  assert.equal(p.newRent, Math.round(800 * 144.64 / 142.06 * 100) / 100);
  assert.equal(p.late, false);
});

test('révision tardive : pas de rétroactivité, année non réclamée perdue', () => {
  const p = revisionPlan(lease, '2026-10-17');
  assert.equal(p.anniversary, '2026-03-01', 'la révision de 2025 non réclamée est perdue');
  assert.equal(p.effective, '2026-10-17', 'effet à la date de la demande');
  assert.equal(p.newKey, '2025-T4');
  assert.equal(p.oldKey, '2024-T4', 'seule la variation de la dernière année s’applique');
});

test('une fois par an, gel DPE F/G, bail sans clause', () => {
  const done = revisionPlan({ ...lease, last_revision_on: '2026-03-01', rent_hc: 806.53 }, '2026-10-17');
  assert.equal(done.block, 'pas_encore');
  assert.equal(done.anniversary, '2027-03-01');
  assert.equal(revisionPlan(lease, '2025-03-01', 'G').block, 'dpe');
  assert.equal(revisionPlan({ ...lease, irl_enabled: false }, '2025-03-01').block, 'desactivee');
  const unknown = revisionPlan({ ...lease, start_date: '2027-03-01', irl_base_label: '2026-T4' }, '2028-03-01');
  assert.equal(unknown.block, 'indice_inconnu');
  assert.equal(revisionPlan({ ...lease, start_date: '2027-03-01', irl_base_label: '2026-T4' }, '2028-03-01', null, 150, 149).newRent, Math.round(800 * 150 / 149 * 100) / 100, 'valeurs saisies à la main');
});
