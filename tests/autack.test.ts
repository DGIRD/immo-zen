import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { autackGroup, parseAccreditation, signedBlock } from '../src/domain/edi/autack.ts';
import { buildInterchange, checkRequest, secureInterchange, type TdfcRequest } from '../src/domain/edi/tdfc.ts';
import type { Liasse2033B } from '../src/domain/fiscal.ts';
import { accreditationMatchesKey, loadPrivateKey, rawRsaSigner, recoverBlock } from '../supabase/functions/_shared/tdfcSigner.ts';

const fx = (f: string) => readFileSync(new URL(`./fixtures/tdfc/${f}`, import.meta.url));
const accreditation = fx('partenaire_fictif_accreditation.txt').toString('latin1').trim();
const partnerKey = loadPrivateKey(fx('partenaire_fictif_cles.pem').toString(), 'clespedi2048');

test('procédé DGFiP : SHA-256 du groupe + horodatage, signature PKCS#1 v1.5 vérifiée par la clé publique DGFiP', async () => {
  const group = fx('dgfip_groupe_signe.txt');
  // l'UNG du groupe est daté 140414:1116 → horodatage 201404141116
  const block = await signedBlock(group, '201404141116');
  const recovered = recoverBlock(fx('dgfip_cle_publique_pedi.pem').toString(), fx('dgfip_signature.hex').toString().trim());
  assert.deepEqual(Buffer.from(recovered), Buffer.from(block));
  assert.equal(Buffer.from(block.subarray(0, 32)).toString('hex'), createHash('sha256').update(group).digest('hex'));
});

test('accréditation : décodage et correspondance avec la clé du partenaire fictif', () => {
  const a = parseAccreditation(accreditation);
  assert.equal(a.siretExtended, '079555421000190000000001');
  assert.equal(a.device, 'ABCDEFABCDEF');
  assert.equal(a.dgfipSignature.length, 512);
  assert.ok(accreditationMatchesKey(accreditation, partnerKey));
  assert.throws(() => parseAccreditation('ABC'), /1368/);
});

const liasse: Liasse2033B = {
  lines: [
    { code: '218', label: '', amount: 12000 }, { code: '232', label: '', amount: 12000 }, { code: '242', label: '', amount: 1200 },
    { code: '244', label: '', amount: 900 }, { code: '254', label: '', amount: 6000 }, { code: '264', label: '', amount: 8100 },
    { code: '270', label: '', amount: 3900 }, { code: '294', label: '', amount: 0 }, { code: '310', label: '', amount: 3900 },
    { code: '318', label: '', amount: 0 }, { code: '352', label: '', amount: 3900 },
  ],
  deferredUsed: 0, fiscalResult: 3900, deferredAfter: 0,
  assets: [{ label: 'Bâti', gross: 170000, cumulated: 6000, kind: 'bati', start: '2025-01-01', dotation: 6000 }],
  loans: { remaining: 0, beyondOneYear: 0 },
};
const request: TdfcRequest = {
  partner: {
    agrement: '4400101', name: 'PARTENAIRE FICTIF', address: { street: '1 rue de Test', zip: '44000', city: 'Nantes' },
    transfer: { mode: 'T', alias: 'FICTIF01' }, software: { editor: 'IMMO-ZEN', program: 'Immo-Zen', version: '0.1' }, attestation: 'TEST', accreditation,
  },
  declarant: { siren: '079555934', rof: 'BIC1', name: 'MONSIEUR 01', address: { street: '252 RUE ALPHANUMERIQUE', zip: '44001', city: 'NANTES CHANTIERS' } },
  period: { start: '2025-01-01', end: '2025-12-31' }, liasse, test: true,
  preparedAt: new Date('2026-04-15T09:05:00Z'), sequence: 1, documentRef: 'TEST-1', balance: { cash: 0, depositsHeld: 0 },
};

test('interchange sécurisé : deux groupes, AUTACK conforme au GUM, signature vérifiable', async () => {
  const m = buildInterchange(request);
  assert.equal(m.stamp.signature, '202604151105', 'heure de Paris (UTC+2 en avril)');
  const s = await secureInterchange(m, accreditation, rawRsaSigner(partnerKey));
  const segs = s.text.split(/(?<!\?)'/).filter(Boolean);
  const at = (prefix: string) => segs.filter((x) => x.startsWith(prefix));
  assert.equal(at('UNG+').length, 2);
  assert.equal(at('UNG+AUTACK')[0], 'UNG+AUTACK+DF4:ZZ1+EDI_TDFC+260415:1105+2+UN+4:1:FA1301');
  assert.ok(segs.includes('UNH+00001+AUTACK:4:1:UN:FA1301'));
  assert.ok(segs.includes('USH+1+1+3+1+2+2'));
  assert.ok(segs.includes('USC++++ZZ1+2'));
  assert.ok(segs.includes(`USR+1:${accreditation}`));
  assert.ok(segs.includes('USB+1++4400101:ZZ1+DGI_EDI_TDFC'));
  assert.ok(segs.includes('USX++++1'));
  assert.ok(segs.includes(`USY+1+1:${s.signatureHex}`));
  assert.ok(segs.includes('UNT+9+00001'));
  assert.equal(segs.at(-2), 'UNE+1+2');
  assert.equal(segs.at(-1), `UNZ+2+${m.reference}`);
  assert.equal(s.signatureHex.length, 512);
  // la DGFiP retrouve le bloc signé avec la clé publique de l'accréditation
  const recovered = recoverBlock(parseAccreditation(accreditation).publicKeySpki, s.signatureHex);
  assert.deepEqual(Buffer.from(recovered), Buffer.from(await signedBlock(Buffer.from(m.group, 'latin1'), m.stamp.signature)));
  // le groupe INFENT signé est transmis tel quel, octet pour octet
  assert.ok(s.text.includes(m.group));
});

test('toute modification du groupe après signature invalide la vérification', async () => {
  const m = buildInterchange(request);
  const s = await secureInterchange(m, accreditation, rawRsaSigner(partnerKey));
  const altered = m.group.replace('MOA+ZZZ:12000', 'MOA+ZZZ:12001');
  const recovered = recoverBlock(parseAccreditation(accreditation).publicKeySpki, s.signatureHex);
  assert.notDeepEqual(Buffer.from(recovered), Buffer.from(await signedBlock(Buffer.from(altered, 'latin1'), m.stamp.signature)));
});

test('AUTACK réel : DF1', () => {
  const g = autackGroup({ test: false, agrement: '4400101', accreditation: parseAccreditation(accreditation), signatureHex: 'AB'.repeat(256), yymmdd: '260415', hhmm: '1105' });
  assert.match(g, /^UNG\+AUTACK\+DF1:ZZ1\+/);
});

test('contrôles : accréditation absente ou invalide bloquante ; présente, plus aucun blocage', () => {
  const block = (r: TdfcRequest) => checkRequest(r).filter((c) => c.level === 'bloquant').map((c) => c.message);
  assert.deepEqual(block(request), []);
  assert.ok(block({ ...request, partner: { ...request.partner, accreditation: undefined } }).some((m) => m.includes('Accréditation DGFiP absente')));
  assert.ok(block({ ...request, partner: { ...request.partner, accreditation: '00' } }).some((m) => m.includes('1368')));
});

test('clé refusée si elle ne fait pas 2048 bits', () => {
  assert.throws(() => loadPrivateKey('pas une clé'), /./);
});
