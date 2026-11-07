import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseAccreditation } from '../src/domain/edi/autack.ts';
import { loadPrivateKey, rawRsaSigner, recoverBlock } from '../supabase/functions/_shared/tdfcSigner.ts';
import { partnerFromEnv, prepare, preview, type DeclarantRow, type TdfcSnapshot } from '../supabase/functions/tdfc/core.ts';
import { data } from './fixtures/lmnp.ts';

const fx = (f: string) => readFileSync(new URL(`./fixtures/tdfc/${f}`, import.meta.url));
const accreditation = fx('partenaire_fictif_accreditation.txt').toString('latin1').trim();
const key = loadPrivateKey(fx('partenaire_fictif_cles.pem').toString(), 'clespedi2048');
const crypto = { signer: rawRsaSigner(key), recover: recoverBlock };

const env: Record<string, string> = {
  TDFC_AGREMENT: '4400101', TDFC_TRANSFER_ALIAS: 'FICTIF01', TDFC_ATTESTATION: 'ESSAI', TDFC_ACCREDITATION: accreditation,
  TDFC_PRIVATE_KEY: 'présente', TDFC_PARTNER_NAME: 'IMMO-ZEN', TDFC_PARTNER_ADDRESS: JSON.stringify({ street: '1 avenue de Paris', zip: '94300', city: 'Vincennes' }),
};
const cfg = partnerFromEnv((k) => env[k]);
const snap = (): TdfcSnapshot => ({ ...data(), deposits: data().deposits ?? [], taxInputs: {} });
const declarant: DeclarantRow = {
  siren: '079555934', rof: 'BIC1', name: 'MONSIEUR 01', address: { street: '252 RUE ALPHANUMERIQUE', zip: '44001', city: 'NANTES CHANTIERS' }, home: null, naf: '6820A', activity: null,
};
const now = new Date('2026-04-15T09:05:00Z');
function counter() {
  const used: string[] = [];
  return { used, next: async (day: string) => { used.push(day); return used.length; } };
}

test('configuration : mode test par défaut, secrets manquants signalés', () => {
  assert.equal(cfg.test, true);
  assert.deepEqual(cfg.errors, []);
  const empty = partnerFromEnv(() => undefined);
  assert.ok(empty.errors.some((e) => e.includes('TDFC_ACCREDITATION')));
  assert.ok(empty.errors.some((e) => e.includes('TDFC_PRIVATE_KEY')));
  assert.equal(partnerFromEnv((k) => (k === 'TDFC_MODE' ? 'reel' : env[k])).test, false);
  assert.ok(partnerFromEnv((k) => (k === 'TDFC_MODE' ? 'prod' : env[k])).errors.some((e) => e.includes('TDFC_MODE')));
});

test('aperçu : données transmises et contrôles, sans numéro ni signature', () => {
  const p = preview(2025, snap(), declarant, cfg, now);
  assert.equal(p.blocking, false, JSON.stringify(p.checks.filter((c) => c.level === 'bloquant')));
  assert.ok(p.items.some((i) => i.form === '2033A' && i.code === 'FS'));
  assert.ok(p.items.some((i) => i.form === 'F-IDENTIF' && i.code === 'AA' && i.value.includes('079555934')));
  assert.equal(p.summary.properties, 1);
  assert.equal(p.summary.turnover, 10800);
});

test('aperçu sans identité fiscale : bloquant', () => {
  const p = preview(2025, snap(), null, cfg, now);
  assert.ok(p.blocking);
  assert.ok(p.checks.some((c) => c.message.startsWith('Identité fiscale du déclarant')));
});

test('préparation : interchange signé, vérifié, numéroté au jour de Paris', async () => {
  const seq = counter();
  const r = await prepare(2025, snap(), declarant, cfg, now, seq.next, crypto, '0f3a6c2e-1111-4222-8333-944455556666');
  assert.ok(r.ok, r.ok ? '' : JSON.stringify(r.checks));
  if (!r.ok) return;
  const p = r.prepared;
  assert.deepEqual(seq.used, ['2026-04-15']);
  assert.equal(p.reference, '44001016105001');
  assert.equal(p.documentRef, 'IZ2025-0F3A6C2E1111');
  assert.equal(p.test, true);
  const text = Buffer.from(p.bytes).toString('latin1');
  assert.ok(text.startsWith("UNA:+,? 'UNB+UNOL:3+4400101:146:TFICTIF01+DGI_EDI_TDFC+260415:1105+44001016105001"));
  assert.ok(text.endsWith(`UNZ+2+${p.reference}'`));
  assert.match(text, /UNG\+AUTACK\+DF4:ZZ1/);
  assert.match(p.sha256, /^[0-9a-f]{64}$/);
  assert.equal(p.signatureHex.length, 512);
  // la DGFiP vérifie avec la clé publique de l'accréditation
  const block = recoverBlock(parseAccreditation(accreditation).publicKeySpki, p.signatureHex);
  assert.equal(Buffer.from(block.subarray(32)).toString('latin1'), '202604151105');
});

test('préparation refusée sur contrôle bloquant : aucun numéro consommé', async () => {
  const seq = counter();
  const r = await prepare(2025, snap(), { ...declarant, siren: '123456789' }, cfg, now, seq.next, crypto, 'x');
  assert.equal(r.ok, false);
  assert.deepEqual(seq.used, []);
  if (!r.ok) assert.ok(r.checks.some((c) => c.message.startsWith('SIREN')));
});

test('clé privée sans rapport avec l’accréditation : signature rejetée avant archivage', async () => {
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  await assert.rejects(prepare(2025, snap(), declarant, cfg, now, counter().next, { signer: rawRsaSigner(other), recover: recoverBlock }, 'x'), /ne correspondent pas/);
});

test('fichier regroupé pour le déploiement : autonome et identique au code source', async () => {
  execFileSync(process.execPath, ['scripts/build-functions.mjs'], { cwd: new URL('..', import.meta.url) });
  const bundlePath = new URL('../supabase/functions/tdfc/core.bundle.js', import.meta.url);
  const src = readFileSync(bundlePath, 'utf8');
  assert.ok(!/^\s*import\s/m.test(src), 'aucun import externe');
  const b = await import(bundlePath.href) as typeof import('../supabase/functions/tdfc/core.ts');
  const r1 = await prepare(2025, snap(), declarant, cfg, now, async () => 1, crypto, 'id');
  const r2 = await b.prepare(2025, snap(), declarant, b.partnerFromEnv((k) => env[k]), now, async () => 1, crypto, 'id');
  assert.ok(r1.ok && r2.ok);
  if (r1.ok && r2.ok) assert.equal(r2.prepared.sha256, r1.prepared.sha256);
});
