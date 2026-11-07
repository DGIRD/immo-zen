import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoTdfc, declarantErrors, tdfcVisible, TDFC_OPEN, TdfcUnavailable, type TdfcDeclarant } from '../src/data/tdfc.ts';
import { RepoError } from '../src/data/repo.ts';
import { data } from './fixtures/lmnp.ts';

function memory(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
const valid: TdfcDeclarant = { siren: '079555934', rof: 'BIC1', name: 'MONSIEUR 01', address: { street: '252 RUE ALPHANUMERIQUE', zip: '44001', city: 'NANTES' }, home: null, naf: '6820A', activity: null };
const snap = () => ({ ...data(), deposits: data().deposits ?? [], taxInputs: {} });

test('identité fiscale : contrôles de saisie', () => {
  assert.deepEqual(declarantErrors(valid), {});
  const e = declarantErrors({ ...valid, siren: '123456789', rof: 'BIC01', name: '', address: { street: '', zip: '9412', city: '' }, naf: '68.20', home: { street: '', zip: '', city: '' } });
  assert.equal(e.siren, 'SIREN invalide (clé de contrôle).');
  assert.match(e.rof!, /sans zéro initial/);
  for (const k of ['name', 'street', 'zip', 'city', 'naf', 'homeStreet', 'homeZip', 'homeCity'] as const) assert.ok(e[k], k);
  assert.equal(declarantErrors({ ...valid, siren: '12345' }).siren, 'Le SIREN compte 9 chiffres.');
  assert.equal(declarantErrors({ ...valid, name: 'x'.repeat(36) }).name, '35 caractères au plus.');
});

test('démonstration : identité enregistrée normalisée, saisie invalide refusée', async () => {
  const api = createDemoTdfc(memory());
  await assert.rejects(api.saveDeclarant({ ...valid, siren: '123456789' }), RepoError);
  await api.saveDeclarant({ ...valid, siren: '079 555 934', rof: 'bic1', naf: '6820a', address: { ...valid.address, complement: '  ' } });
  const d = await api.declarant();
  assert.equal(d?.siren, '079555934');
  assert.equal(d?.rof, 'BIC1');
  assert.equal(d?.naf, '6820A');
  assert.equal(d?.address.complement, undefined);
});

test('démonstration : mandat signé, un seul en vigueur, révocation conservée', async () => {
  const api = createDemoTdfc(memory());
  await api.signMandate();
  await assert.rejects(api.signMandate(), /déjà en vigueur/);
  await api.revokeMandate();
  await api.signMandate();
  const m = await api.mandates();
  assert.equal(m.length, 2);
  assert.equal(m.filter((x) => !x.revoked_at).length, 1);
  assert.ok(m.some((x) => x.revoked_at), 'mandat révoqué conservé');
});

test('démonstration : aperçu local ; blocages d’Immo-Zen séparés de ceux de l’abonné', async () => {
  const api = createDemoTdfc(memory());
  const before = await api.preview(2025, snap());
  assert.ok(before.preview.checks.some((c) => c.message.startsWith('Identité fiscale du déclarant') && c.scope !== 'partenaire'));
  await api.saveDeclarant(valid);
  const { preview, test: isTest } = await api.preview(2025, snap());
  assert.equal(isTest, true);
  const userBlocking = preview.checks.filter((c) => c.level === 'bloquant' && c.scope !== 'partenaire');
  const partner = preview.checks.filter((c) => c.scope === 'partenaire');
  assert.deepEqual(userBlocking, [], JSON.stringify(userBlocking));
  assert.ok(partner.some((c) => c.message.includes('Accréditation')), 'habilitation d’Immo-Zen non terminée');
  assert.ok(partner.some((c) => c.message.includes('agrément')));
  assert.ok(preview.items.some((i) => i.form === '2033A'));
  assert.equal(preview.summary.turnover, 10800);
});

test('démonstration : préparation signée indisponible, message explicite', async () => {
  const api = createDemoTdfc(memory());
  await assert.rejects(api.prepare(2025), (e: Error) => e instanceof TdfcUnavailable && /service en ligne/.test(e.message));
  assert.deepEqual(await api.submissions(), []);
});

test('aperçu : nature des données pour l’affichage (montant, date, texte)', async () => {
  const api = createDemoTdfc(memory());
  await api.saveDeclarant(valid);
  const { preview } = await api.preview(2025, snap());
  const get = (form: string, code: string) => preview.items.find((i) => i.form === form && i.code === code)!;
  assert.equal(get('2033B', 'BC').kind, 'montant');
  assert.equal(get('F-IDENTIF', 'CA').kind, 'date');
  assert.equal(get('F-IDENTIF', 'CA').value, '20250101');
  assert.equal(get('F-IDENTIF', 'CC').kind, 'texte', 'durée en mois');
  assert.equal(get('F-IDENTIF', 'AA').kind, 'texte');
  assert.ok(preview.items.filter((i) => i.kind === 'montant').some((i) => i.value.startsWith('-')), 'montant négatif conservé avec son signe');
});

test('service fermé : écran visible seulement avec l’aperçu activé', () => {
  assert.equal(TDFC_OPEN, false);
  const m = memory();
  assert.equal(tdfcVisible(m), false);
  m.setItem('iz-tdfc-preview', '1');
  assert.equal(tdfcVisible(m), true);
  assert.equal(tdfcVisible(undefined), false);
});
