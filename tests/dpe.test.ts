import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dpeAlerts } from '../src/domain/property.ts';

test('vigilance DPE : calendrier des interdictions et gel des loyers', () => {
  assert.match(dpeAlerts('F', '2026-10-20')[0]!, /à partir du 1er janvier 2028/);
  assert.match(dpeAlerts('F', '2028-02-01')[0]!, /depuis le 1er janvier 2028/);
  assert.ok(dpeAlerts('f', '2026-10-20').some((a) => a.startsWith('Loyer gelé')), 'gel F, minuscules acceptées');
  assert.match(dpeAlerts('G', '2026-10-20')[0]!, /depuis le 1er janvier 2025/);
  assert.equal(dpeAlerts('E', '2026-10-20').length, 1);
  assert.deepEqual(dpeAlerts('D', '2026-10-20'), []);
  assert.deepEqual(dpeAlerts(null, '2026-10-20'), []);
});
