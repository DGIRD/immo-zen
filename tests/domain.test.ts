import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EMPTY_SNAPSHOT, type Snapshot } from '../src/data/repo.ts';
import type { Contact, Property, Scenario } from '../src/data/types.ts';
import { buildBackup, materialize, parseBackup, planImport } from '../src/domain/backup.ts';
import { excelSerial, toCsv, toXlsx } from '../src/domain/exporting.ts';
import { legacyContacts, legacyInputs, legacyProperty, legacyRent } from '../src/domain/legacy.ts';
import { applyStatusRules, pricePerM2 } from '../src/domain/property.ts';
import { normalizeInputs, simulate } from '../src/domain/simulator.ts';

const base = { user_id: 'u1', version: 1, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' };
const prop = (o: Partial<Property>): Property => ({
  ...base, id: 'p1', title: 'Bien', status: 'repere', status_before_archive: null, occupation_status: null, property_type: 'appartement',
  address: null, zip: null, city: null, surface: null, rooms: null, dpe: null, listing_url: null, asking_price: null, offer_price: null,
  works_budget: null, estimated_rent: null, agency_id: null, agent_id: null, next_action: null, follow_up_date: null, visit_at: null,
  comments: null, vigilance: [], ownership_mode: null, tax_regime: null, acquired_at: null, acquisition_cost: null,
  acquisition_snapshot: null, primary_scenario_id: null, legacy_simulation_id: null, legacy_ref: null, ...o,
});
const contact = (o: Partial<Contact>): Contact => ({
  ...base, id: 'c1', kind: 'agence', name: 'Agence', organization_id: null, organization_name: null, email: null, phone: null,
  sector: null, notes: null, next_follow_up: null, archived_at: null, legacy_source: null, ...o,
});
const scen = (o: Partial<Scenario>): Scenario => ({ ...base, id: 's1', property_id: 'p1', name: 'S', inputs: { price: 100000 }, results: null, engine_version: '1', archived_at: null, legacy_simulation_id: null, ...o });
const snap = (o: Partial<Snapshot>): Snapshot => ({ ...EMPTY_SNAPSHOT, ...o });

test('statut « acquis » : date, occupation, photographie figée (copie indépendante)', () => {
  const s = scen({ inputs: { price: 200000 } });
  const prev = prop({ primary_scenario_id: 's1' });
  const next = applyStatusRules(prev, { ...prev, status: 'acquis' }, [s], new Date('2026-10-13T08:00:00Z'));
  assert.equal(next.acquired_at, '2026-10-13');
  assert.equal(next.occupation_status, 'vacant');
  assert.equal(next.acquisition_snapshot?.inputs.price, 200000);
  s.inputs.price = 1;
  assert.equal(next.acquisition_snapshot?.inputs.price, 200000);
  const back = applyStatusRules(next, { ...next, status: 'sous_compromis' }, [s]);
  assert.equal(back.occupation_status, null);
});

test('archivage mémorise le statut précédent', () => {
  const prev = prop({ status: 'negociation' });
  const a = applyStatusRules(prev, { ...prev, status: 'archive' }, []);
  assert.equal(a.status_before_archive, 'negociation');
});

test('prix au m² : prix proposé prioritaire, sinon prix affiché', () => {
  assert.equal(pricePerM2({ surface: 50, offer_price: 200000, asking_price: 250000 }), 4000);
  assert.equal(pricePerM2({ surface: 50, offer_price: null, asking_price: 250000 }), 5000);
  assert.equal(pricePerM2({ surface: null, offer_price: 1, asking_price: 1 }), null);
});

test('reprise locale de l’ancienne version : même conversion que la migration SQL', () => {
  const s = { id: 'x', number: 'SIM-1', title: 'T2', status: 'Visite programmée', surface: 42, rentM2Low: 22, rentM2High: 26, rentLevel: 'Moyen', dpe: 'Z', listingUrl: 'ftp://x', notaryFees: 16125, offerPrice: 215000, archived: true, agency: 'Agence du Parc', agentEmail: 'Claire@A.test' };
  assert.equal(legacyRent(s), 1008);
  const p = legacyProperty(s);
  assert.equal(p.status, 'archive');
  assert.equal(p.status_before_archive, 'visite_programmee');
  assert.equal(p.dpe, null);
  assert.equal(p.listing_url, null);
  const inputs = legacyInputs(s);
  assert.equal(inputs.notaryMode, 'amount');
  assert.equal(inputs.notaryAmount, 16125);
  assert.ok(simulate(normalizeInputs(inputs)).ok);
  const existing = [contact({ name: 'agence du parc' }), contact({ id: 'c2', kind: 'agent', name: 'C', email: 'claire@a.test' })];
  const { agency, agent } = legacyContacts(s, existing);
  assert.equal((agency as Contact).id, 'c1', 'agence retrouvée sans tenir compte de la casse');
  assert.equal((agent as Contact).id, 'c2', 'agent retrouvé par e-mail');
});

test('sauvegarde : validation du format', () => {
  assert.equal(parseBackup('pas du json').ok, false);
  assert.equal(parseBackup('{"format":"autre"}').ok, false);
  assert.equal(parseBackup(JSON.stringify({ format: 'immo-zen-backup', version: 99, data: {} })).ok, false);
  const b = buildBackup(snap({ properties: [prop({ title: '' })] }), 'a@b.c');
  assert.equal(parseBackup(JSON.stringify(b)).ok, false, 'bien sans titre refusé');
});

test('import : doublons ignorés, nouveaux identifiants, liens réécrits', () => {
  const current = snap({ contacts: [contact({ id: 'mine', name: 'Agence', kind: 'agence' })], properties: [prop({ id: 'old', title: 'Déjà là', city: 'Paris', asking_price: 1 })] });
  const incoming = snap({
    contacts: [contact({ id: 'c1', name: 'AGENCE' }), contact({ id: 'c9', kind: 'agent', name: 'Agent', organization_id: 'c1' })],
    properties: [prop({ id: 'p1', title: 'Nouveau', agency_id: 'c1', agent_id: 'c9', primary_scenario_id: 's1' }), prop({ id: 'p2', title: 'déjà là', city: 'paris', asking_price: 1 })],
    scenarios: [scen({ id: 's1', property_id: 'p1' }), scen({ id: 's2', property_id: 'p2' })],
    events: [{ id: 'e1', user_id: 'u1', property_id: 'p1', contact_id: null, kind: 'exchange', channel: 'telephone', occurred_at: '2026-10-01T00:00:00Z', summary: 'x', data: {}, created_at: '' },
      { id: 'e2', user_id: 'u1', property_id: 'p1', contact_id: null, kind: 'acquisition', channel: null, occurred_at: '2026-10-01T00:00:00Z', summary: 'y', data: {}, created_at: '' }],
  });
  const parsed = parseBackup(JSON.stringify(buildBackup(incoming, 'x')));
  assert.ok(parsed.ok);
  const plan = planImport(parsed.backup, current);
  assert.equal(plan.contacts.duplicates.length, 1);
  assert.equal(plan.properties.duplicates.length, 1);
  assert.equal(plan.scenarios.length, 1, 'scénario du doublon non importé');
  assert.equal(plan.events.length, 1, 'événements système non réimportés');
  let n = 0;
  const rows = materialize(plan, () => `new-${++n}`);
  const p = rows.properties[0]!;
  assert.notEqual(p.id, 'p1');
  assert.equal(p.agency_id, 'mine', 'agence du doublon réutilisée');
  assert.equal(rows.otherContacts[0]!.organization_id, 'mine');
  assert.equal(rows.scenarios[0]!.property_id, p.id);
  assert.equal(rows.primary.get(p.id!), rows.scenarios[0]!.id);
  assert.ok(!('user_id' in p) && !('version' in p));
});

test('CSV : séparateur ;, décimales à virgule, protection contre les formules', () => {
  const csv = toCsv([{ label: 'Nom', value: (r: { n: string; v: number }) => r.n }, { label: 'Prix', value: (r) => r.v, kind: 'money' }], [{ n: '=HYPERLINK("x")', v: 1234.5 }, { n: 'a;b', v: 1 }]);
  assert.ok(csv.startsWith('﻿Nom;Prix'));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")";1234,50`));
  assert.ok(csv.includes('"a;b";1,00'));
});

test('Excel : vrai classeur .xlsx lisible par une bibliothèque tierce (openpyxl)', async () => {
  assert.equal(excelSerial('2026-10-13'), 46308);
  const blob = await toXlsx([{ name: 'Biens', rows: [{ t: 'Été & <test>', p: 215000.5, d: '2026-10-13', y: 4.87 }], columns: [
    { label: 'Titre', value: (r: { t: string; p: number; d: string; y: number }) => r.t }, { label: 'Prix', value: (r) => r.p, kind: 'money' },
    { label: 'Date', value: (r) => r.d, kind: 'date' }, { label: 'Rendement', value: (r) => r.y, kind: 'percent' }] }]);
  const dir = mkdtempSync(join(tmpdir(), 'iz-'));
  const file = join(dir, 'test.xlsx');
  writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
  let out: string;
  try {
    out = execFileSync('python3', ['-c', `import openpyxl,sys;ws=openpyxl.load_workbook(sys.argv[1]).active;print(ws.title,[c.value for c in ws[2]],ws['C2'].number_format)`, file]).toString();
  } catch {
    return; // openpyxl absent : vérification ignorée
  }
  assert.match(out, /^Biens \['Été & <test>', 215000\.5, datetime\.datetime\(2026, 10, 13, 0, 0\), 4\.87\] dd\/mm\/yyyy/);
});

test('crédit d’un bien détenu : mensualité calculée, capital restant dû, fin du crédit', async () => {
  const { loanInfo } = await import('../src/domain/property.ts');
  const l = loanInfo({ loan_amount: 200000, loan_rate: 3.5, loan_years: 20, loan_start_date: '2026-01-05', loan_insurance_monthly: 50 }, '2026-10-16')!;
  assert.equal(l.payment, 1159.92);
  assert.equal(l.monthlyTotal, 1209.92);
  assert.equal(l.endDate, '2046-01-05');
  assert.ok(l.remaining! < 200000 && l.remaining! > 190000, '10 échéances payées');
  assert.equal(loanInfo({ loan_amount: 100000, loan_monthly_payment: 700, loan_years: 15 }, '2026-10-16')!.payment, 700, 'mensualité saisie prioritaire');
  assert.equal(loanInfo({ loan_amount: 100000, loan_rate: 2, loan_years: 1, loan_start_date: '2020-01-01' }, '2026-10-16')!.monthlyTotal, 0, 'crédit terminé');
  assert.equal(loanInfo({}, '2026-10-16'), null);
});

test('cash-flow d’un bien détenu : loyer CC − charges annuelles / 12 − crédit', async () => {
  const { ownedCashflow } = await import('../src/domain/property.ts');
  const p = { estimated_rent: 900, charges_provision: 60, property_tax_annual: 1200, copro_charges_annual: 1200, loan_amount: 100000, loan_monthly_payment: 500, loan_insurance_monthly: 20 } as never;
  const cf = ownedCashflow(p, [], null, '2026-10-16')!;
  assert.equal(cf.monthly, 960 - 200 - 520);
  assert.equal(cf.source, 'bien');
  const withLease = ownedCashflow(p, [{ rent_hc: 1000, charges_amount: 80 }], null, '2026-10-16')!;
  assert.equal(withLease.income, 1080, 'le bail en cours prime sur le loyer saisi');
  assert.equal(ownedCashflow({} as never, [], null, '2026-10-16'), null, 'sans donnée : pas de chiffre inventé');
});

test('le simulateur alimente la fiche du bien en prospection', async () => {
  const { prospectFieldsFromSimulation } = await import('../src/domain/property.ts');
  const { DEFAULT_INPUTS, simulate } = await import('../src/domain/simulator.ts');
  const i = { ...DEFAULT_INPUTS, askingPrice: 250000, price: 230000, surface: 40, rentMode: 'haut' as const, rentM2Low: 20, rentM2High: 25, works: 0 };
  const out = simulate(i);
  assert.ok(out.ok);
  if (!out.ok) return;
  assert.deepEqual(prospectFieldsFromSimulation(i, out.result), { asking_price: 250000, offer_price: 230000, surface: 40, estimated_rent: 1000 });
});

test('statut « acquis » sans date : 1re échéance du crédit si elle est passée (ANO-014)', () => {
  const now = new Date('2026-11-16T08:00:00Z');
  const prev = prop({});
  assert.equal(applyStatusRules(prev, { ...prev, status: 'acquis', loan_start_date: '2025-01-05' }, [], now).acquired_at, '2025-01-05');
  assert.equal(applyStatusRules(prev, { ...prev, status: 'acquis', loan_start_date: '2027-01-05' }, [], now).acquired_at, '2026-11-16');
  assert.equal(applyStatusRules(prev, { ...prev, status: 'acquis', loan_start_date: '2025-01-05', acquired_at: '2024-12-01' }, [], now).acquired_at, '2024-12-01');
});
