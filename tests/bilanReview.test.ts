import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BilanCorrection, TaxPropertyInputs } from '../src/data/types.ts';
import { activeCorrection, reviewBilan } from '../src/domain/bilanReview.ts';
import { checkRequest, type TdfcRequest } from '../src/domain/edi/tdfc.ts';
import { fiscalSummary } from '../src/domain/fiscal.ts';
import { data, none, prop, rentData } from './fixtures/lmnp.ts';

const review = (d = data(), foyer: TaxPropertyInputs = {}, inputs: (pid: string, y: number) => TaxPropertyInputs = none) =>
  reviewBilan(2025, d, [prop], fiscalSummary(2025, d, inputs).reelBic!.liasse, inputs, foyer);
const line = (r: ReturnType<typeof review>, side: 'actif' | 'passif', label: RegExp) => r[side].find((l) => label.test(l.label))!;
const corr = (field: BilanCorrection['field'], amount: number, at: string, o: Partial<BilanCorrection> = {}): BilanCorrection =>
  ({ id: `${field}-${at}`, field, amount, reason: 'motif', at, revoked_at: null, ...o });

test('relecture : origine de chaque ligne, actif = passif, compte suivi sans écart', () => {
  const r = review();
  assert.equal(r.gapMessage.level, 'ok');
  assert.equal(line(r, 'actif', /^Disponibilités/).origin, 'convention');
  assert.equal(line(r, 'actif', /^Immobilisations corporelles/).origin, 'liasse');
  assert.equal(line(r, 'passif', /^Capital individuel/).origin, 'historique');
  assert.equal(line(r, 'passif', /^Emprunts/).origin, 'calcul');
  assert.equal(line(r, 'passif', /^Dépôts/).amount, 800);
  const total = (side: 'actif' | 'passif', code: string) => r[side].find((l) => l.code === code)!.amount;
  assert.equal(total('actif', 'CR'), total('passif', 'FS'));
  const fa = line(r, 'passif', /^Capital individuel/);
  assert.ok(fa.detail!.some((x) => x.label === 'Ouverture'), 'détail du compte de l’exploitant');
});

test('capital restant dû de la banque : origine « Banque »', () => {
  const r = review(data(), {}, (_, y) => (y === 2025 ? { loan_remaining_bank: 139000 } : {}));
  const fl = line(r, 'passif', /^Emprunts/);
  assert.equal(fl.origin, 'banque');
  assert.equal(fl.amount, 139000);
});

test('trésorerie saisie : origine « Saisi », reprise du bilan N-1', () => {
  const r = review(data(), { bilan_cash: 1500, bilan_opening_equity: 50000 });
  assert.equal(line(r, 'actif', /^Disponibilités/).origin, 'saisie');
  assert.equal(line(r, 'actif', /^Disponibilités/).amount, 1500);
  assert.equal(line(r, 'passif', /^Capital individuel/).origin, 'bilan_n-1');
});

test('corrections : la plus récente non annulée s’applique, l’historique est conservé', () => {
  const list = [corr('receivables', 300, '2026-03-01T10:00:00Z'), corr('receivables', 450, '2026-03-02T10:00:00Z'), corr('receivables', 999, '2026-03-03T10:00:00Z', { revoked_at: '2026-03-04T10:00:00Z' })];
  assert.equal(activeCorrection(list, 'receivables')?.amount, 450);
  const r = review(data(rentData(['2025-12'])), { bilan_corrections: list });
  const aj = line(r, 'actif', /^Créances/);
  assert.equal(aj.amount, 450);
  assert.equal(aj.origin, 'correction');
  assert.equal(aj.computed, 900);
  assert.equal(r.corrections.length, 3, 'corrections annulées conservées');
  assert.equal(r.gapMessage.level, 'avertissement', 'créance corrigée : écart toujours expliqué');
});

test('correction des dépôts : expliquée comme correction manuelle, non bloquante à l’envoi', () => {
  const r = review(data(), { bilan_corrections: [corr('depositsHeld', 500, '2026-03-01T10:00:00Z')] });
  assert.equal(line(r, 'passif', /^Dépôts/).amount, 500);
  assert.equal(r.bilan.gapExplained.manual, 300);
  assert.ok(Math.abs(r.bilan.gapExplained.other) < 1);
  assert.equal(r.gapMessage.level, 'avertissement');
  const req = {
    partner: { agrement: '9400101', name: 'X', address: { street: '1 rue A', zip: '94300', city: 'V' }, transfer: { mode: 'T', alias: 'ABCDEFGH' }, software: { editor: 'E', program: 'P', version: '1' }, attestation: 'A' },
    declarant: { siren: '079555934', rof: 'BIC1', name: 'M', address: { street: '1 rue B', zip: '44001', city: 'N' } }, period: { start: '2025-01-01', end: '2025-12-31' },
    liasse: fiscalSummary(2025, data(), none).reelBic!.liasse, balance: r.balance, test: true, preparedAt: new Date('2026-04-15T10:00:00Z'), sequence: 1, documentRef: 'R',
  } as TdfcRequest;
  const gap = checkRequest(req).find((c) => c.message.startsWith('2033-A : écart'));
  assert.equal(gap?.level, 'avertissement');
  assert.match(gap!.message, /corrections manuelles 300/);
});
