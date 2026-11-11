import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Expense, Property } from '../src/data/types.ts';
import { fiscalSummary, type FiscalData, type Liasse2033B } from '../src/domain/fiscal.ts';
import { amount, encodeLatin9, escape, invalidLatin9, segment } from '../src/domain/edi/edifact.ts';
/** Paramètres d'amortissement d'avant le 11/11/2026 (terrain 15 %, bâti 30 ans, meubles 7 ans), sur lesquels ces cas sont chiffrés. */
const LEGACY = { land_pct: 15, building_years: 30, furniture_years: 7, works_years: 10 };

import {
  bilan2033A, buildInterchange, campaignFor, checkRequest, dataCode, encodeInterchange, interchangeRef, liasseItems, validSiren, type TdfcRequest,
} from '../src/domain/edi/tdfc.ts';

// ------------------------------------------------------------------ syntaxe EDIFACT

test('échappement des caractères de service et typographie', () => {
  assert.equal(escape("l'école : 1+1 ?"), "l?'école ?: 1?+1 ??");
  assert.equal(escape('l’été – 2026'), "l?'été - 2026");
});

test('segment : données vides finales supprimées, composites tronqués', () => {
  assert.equal(segment('MOA', ['ZZZ', '0', undefined, undefined, '62']), "MOA+ZZZ:0:::62'");
  assert.equal(segment('MOA', ['ZZZ', '1250', undefined, undefined, undefined]), "MOA+ZZZ:1250'");
  assert.equal(segment('CCI', undefined, undefined, ['TBX', 'LIS', '211']), "CCI+++TBX:LIS:211'");
  assert.equal(segment('NAD', 'MR', undefined, undefined, ['DGI_EDI_TDFC']), "NAD+MR+++DGI_EDI_TDFC'");
});

test('montants : euros entiers par troncature, zéro significatif 62, négatif 65', () => {
  assert.deepEqual(amount(1234.99), { value: '1234' });
  assert.deepEqual(amount(0.4), { value: '0', status: '62' });
  assert.deepEqual(amount(-1500.7), { value: '1500', status: '65' });
});

test('ISO 8859-15 : € codé A4, caractères hors table détectés', () => {
  assert.deepEqual([...encodeLatin9('é€')], [0xe9, 0xa4]);
  assert.deepEqual(invalidLatin9('Zoë œ ✓ ½'), ['✓', '½']); // ½ (BD en Latin-1) est remplacé par œ en ISO 8859-15
  assert.throws(() => encodeLatin9('✓'));
});

// ------------------------------------------------------------------ données TDFC

test('code donnée IND sur 25 caractères', () => {
  const code = dataCode({ form: '2033B', code: 'BC', label: '', value: { seg: 'MOA', amount: 1 } }, '26');
  assert.equal(code, '2033B     2600000000BCMOA');
  assert.equal(code.length, 25);
  assert.equal(dataCode({ form: 'F-IDENTIF', code: 'DA', label: '', value: { seg: 'CUX', currency: 'EUR' } }, '26'), 'F-IDENTIF 2600000000DACUX');
});

test('campagne : exercice clos en 2025 → campagne 2026 ; 2026 non encore intégrée', () => {
  assert.equal(campaignFor('2025-12-31')?.millesime, '26');
  assert.equal(campaignFor('2026-12-31'), null);
});

test('SIREN : clé de Luhn', () => {
  assert.ok(validSiren('732829320'));
  assert.ok(!validSiren('732829321'));
  assert.ok(!validSiren('12345'));
});

test('référence d’interchange : agrément + année + quantième + séquence (n14)', () => {
  assert.equal(interchangeRef('7500101', new Date('2026-04-15T10:30:00Z'), 7), '75001016105007');
});

// ------------------------------------------------------------------ liasse réelle calculée par l'application

const prop: Property = {
  id: 'p1', user_id: 'u', version: 1, created_at: '', updated_at: '', title: 'T2 meublé', status: 'acquis', status_before_archive: null, occupation_status: 'loue',
  property_type: 'appartement', address: null, zip: null, city: null, surface: 40, rooms: 2, dpe: null, listing_url: null, asking_price: null, offer_price: null,
  works_budget: null, estimated_rent: 900, charges_provision: 100, agency_id: null, agent_id: null, next_action: null, follow_up_date: null, visit_at: null,
  comments: null, vigilance: [], ownership_mode: 'nom_propre', tax_regime: 'reel_bic', acquired_at: '2024-01-01', acquisition_cost: 200000,
  acquisition_snapshot: null, primary_scenario_id: null, legacy_simulation_id: null, legacy_ref: null,
} as Property;
let n = 0;
const exp = (category: Expense['category'], amt: number, d = '2025-03-01', o: Partial<Expense> = {}): Expense => ({
  id: `e${++n}`, user_id: 'u', version: 1, created_at: '', updated_at: '', property_id: 'p1', expense_date: d, supplier: null, label: null, amount: amt, category,
  nature: 'charge', recoverable_amount: 0, payment_status: 'paye', paid_on: d, document_id: null, notes: null, ...o,
} as Expense);
const data: FiscalData = {
  properties: [prop], leases: [], charges: [], payments: [], allocations: [],
  expenses: [exp('loyer', 12000), exp('copropriete', 1200), exp('taxe_fonciere', 900), exp('mobilier', 3000, '2025-02-01', { nature: 'immobilisation' })],
};

function liasse(): Liasse2033B {
  const s = fiscalSummary(2025, data, () => LEGACY);
  assert.ok(s.reelBic, 'liasse LMNP au réel calculée');
  return s.reelBic.liasse;
}

const request = (o: Partial<TdfcRequest> = {}): TdfcRequest => ({
  partner: {
    agrement: '9400101', name: 'IMMO-ZEN', address: { street: '1 avenue de Paris', zip: '94300', city: 'Vincennes' },
    transfer: { mode: 'T', alias: 'IMMOZEN1' }, software: { editor: 'IMMO-ZEN', program: 'Immo-Zen', version: '1.0' }, attestation: 'TEST',
  },
  declarant: { siren: '732829320', rof: 'BIC1', name: "Jean L'Hôte", address: { street: '12 rue des Lilas', zip: '94120', city: 'Fontenay-sous-Bois' }, naf: '6820A' },
  period: { start: '2025-01-01', end: '2025-12-31' },
  liasse: liasse(), test: true, preparedAt: new Date('2026-04-15T10:30:00Z'), sequence: 1, documentRef: 'LMNP2025-1', ...o,
});

test('liasse : 2033-B repris de la liasse calculée, 2031 et néants', () => {
  const r = request();
  const items = liasseItems(r);
  const get = (form: string, code: string) => items.find((i) => i.form === form && i.code === code);
  const moa = (form: string, code: string) => { const v = get(form, code)?.value; return v?.seg === 'MOA' ? v.amount : undefined; };
  const l = r.liasse;
  assert.equal(moa('2033B', 'BC'), l.lines.find((x) => x.code === '218')!.amount);
  assert.equal(moa('2033B', 'BV'), l.lines.find((x) => x.code === '264')!.amount);
  if (l.fiscalResult >= 0) { assert.equal(moa('2031', 'CA'), l.fiscalResult); assert.equal(get('2031', 'CB'), undefined); }
  else assert.equal(moa('2031', 'CB'), -l.fiscalResult);
  for (const [f, c] of [['2033D', 'PF'], ['2033E', 'DB'], ['2033F', 'GS'], ['2033G', 'GS']]) assert.ok(get(f!, c!), `${f} néant`);
  // 2033-C : le meuble acheté en 2025 est une augmentation de l'exercice
  assert.equal(moa('2033C', 'BH'), 3000);
  assert.equal(moa('2033C', 'DK'), (moa('2033C', 'AK') ?? 0) + 3000);
});

test('interchange : en-tête, compteurs et références cohérents', () => {
  const m = buildInterchange(request());
  const segs = m.interchange.split(/(?<!\?)'/).filter(Boolean);
  assert.equal(segs[0], 'UNA:+,? ');
  assert.equal(segs[1], 'UNB+UNOL:3+9400101:146:TIMMOZEN1+DGI_EDI_TDFC+260415:1230+94001016105001+++++PED-DGI-IN-TD2601+1');
  assert.equal(segs[2], 'UNG+INFENT+DF4:146+EDI_TDFC+260415:1230+1+UN+D:00B:FD2601');
  assert.equal(segs[3], 'UNH+00001+INFENT:D:00B:UN:FD2601');
  assert.ok(segs.includes('BGM+IDF:71:211+INFENTLMNP2025-1'));
  assert.ok(segs.includes('RFF+AUN:Immo-Zen::1.0'));
  assert.ok(segs.includes('NAD+ZZZ+732829320:100:ZZZ++Jean L?\'Hôte+12 rue des Lilas+Fontenay-sous-Bois++94120'));
  assert.ok(segs.includes('CUX+3:EUR'));
  // UNT : nombre de segments de UNH à UNT inclus
  const unh = segs.findIndex((s) => s.startsWith('UNH+')), unt = segs.findIndex((s) => s.startsWith('UNT+'));
  assert.equal(segs[unt], `UNT+${unt - unh + 1}+00001`);
  assert.equal(segs.at(-2), 'UNE+1+1');
  assert.equal(segs.at(-1), `UNZ+1+${m.reference}`);
  // SEQ numérotés de 1 à n, un IND par donnée
  const seqs = segs.filter((s) => s.startsWith('SEQ++')).map((s) => Number(s.slice(5)));
  assert.deepEqual(seqs, m.items.map((_, i) => i + 1));
  assert.equal(segs.filter((s) => s.startsWith('IND++')).length, m.items.length);
  assert.ok(encodeInterchange(m).length > 0);
});

test('réel : pas d’indicateur de test, application DF1', () => {
  const m = buildInterchange(request({ test: false }));
  assert.match(m.interchange, /PED-DGI-IN-TD2601'UNG\+INFENT\+DF1:146/);
});

test('contrôles : bloquants sur SIREN, ROF, agrément, campagne, 2033-A et accréditation', () => {
  const ok = checkRequest(request());
  assert.deepEqual(ok.filter((c) => c.level === 'bloquant').map((c) => c.message.slice(0, 6)), ['Accréd']);
  const bad = checkRequest(request({
    declarant: { siren: '123456789', rof: 'BIC01', name: 'X', address: { street: '', zip: '9412', city: 'Fontenay' } },
    partner: { ...request().partner, agrement: '' }, period: { start: '2026-01-01', end: '2026-12-31' },
  })).map((c) => c.message);
  for (const s of ['SIREN', 'obligation fiscale', 'agrément', 'campagne 2027', 'voie manquante', 'code postal']) assert.ok(bad.some((m) => m.includes(s)), s);
});

test('exercice non intégré : génération refusée', () => {
  assert.throws(() => buildInterchange(request({ period: { start: '2026-01-01', end: '2026-12-31' } })), /non intégré/);
});

test('population fictive DGFiP (BIC IR RS) : SIREN et ROF acceptés', () => {
  const declarant = { siren: '079555934', rof: 'BIC1', name: 'MONSIEUR 01', address: { street: '252 RUE ALPHANUMERIQUE', zip: '44001', city: 'NANTES CHANTIERS' } };
  assert.ok(validSiren(declarant.siren));
  const checks = checkRequest(request({ declarant })).filter((c) => c.level === 'bloquant').map((c) => c.message.slice(0, 6));
  assert.deepEqual(checks, ['Accréd']);
});

test('2033-A : bilan équilibré par le compte de l’exploitant, terrain et emprunt repris', () => {
  const loanProp = { ...prop, loan_amount: 150000, loan_rate: 3, loan_years: 20, loan_start_date: '2024-02-05' } as Property;
  const s = fiscalSummary(2025, { ...data, properties: [loanProp] }, () => LEGACY);
  const l = s.reelBic!.liasse;
  const terrain = l.assets.find((a) => a.kind === 'terrain');
  assert.equal(terrain?.gross, 30000, 'terrain = 15 % de 200 000 €');
  assert.ok(l.loans.remaining > 130000 && l.loans.remaining < 150000, `capital restant dû fin 2025 : ${l.loans.remaining}`);
  assert.ok(l.loans.beyondOneYear < l.loans.remaining);
  const b = bilan2033A(l, { start: '2025-01-01', end: '2025-12-31' }, { cash: 2500, depositsHeld: 900 });
  assert.equal(b.immoGross, 30000 + 170000 + 3000);
  assert.equal(b.assetsNet, b.liabilities);
  assert.equal(b.equity, b.capital + b.result);
  assert.equal(b.otherDebts, 900);
  assert.equal(b.acquisitions, 3000, 'seul le meuble est acquis en 2025');
  const r = request({ liasse: l, balance: { cash: 2500, depositsHeld: 900 } });
  const items = liasseItems(r);
  const moa = (code: string) => { const v = items.find((i) => i.form === '2033A' && i.code === code)?.value; return v?.seg === 'MOA' ? v.amount : undefined; };
  assert.equal(moa('CR'), moa('FS'));
  assert.equal(moa('FL'), l.loans.remaining);
  assert.equal(moa('AM'), 2500);
  const c = (code: string) => { const v = items.find((i) => i.form === '2033C' && i.code === code)?.value; return v?.seg === 'MOA' ? v.amount : undefined; };
  assert.equal(c('DC'), 30000, '2033-C : terrains');
  assert.deepEqual(checkRequest(r).filter((x) => x.level === 'bloquant').map((x) => x.message.slice(0, 6)), ['Accréd']);
});
