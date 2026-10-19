import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EMPTY_SNAPSHOT, type Snapshot } from '../src/data/repo.ts';
import { demoPlan, planUsage, planViolation, TIERS, UNLIMITED_PLAN } from '../src/domain/plans.ts';

const prop = (id: string, status: string) => ({ id, status }) as unknown as Snapshot['properties'][number];
const snap = (over: Partial<Snapshot>): Snapshot => ({ ...EMPTY_SNAPSHOT, ...over });
const decouverte = demoPlan('decouverte', true);
const essentiel = demoPlan('essentiel', true);

test('formules : limites identiques à la base (migration plan_tiers)', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261018000500_formules.sql', import.meta.url), 'utf8');
  const num = (v: string) => (v === 'null' ? null : Number(v));
  for (const t of TIERS) {
    const m = sql.match(new RegExp(`\\('${t.code}',\\s*'[^']+',\\s*\\d+,\\s*(\\w+),\\s*(\\w+),\\s*(\\w+),\\s*(\\w+),\\s*(\\w+),\\s*(\\w+),\\s*(\\w+),\\s*(\\w+),\\s*(\\w+)\\)`));
    assert.ok(m, `ligne ${t.code} trouvée`);
    const [, owned, prospects, scenarios, storage, contacts, automations, consolidated, fiscal, sharing] = m!;
    assert.deepEqual(t.limits, { owned: num(owned!), prospects: num(prospects!), scenarios: num(scenarios!), storage_mb: num(storage!) }, t.code);
    assert.deepEqual(t.features, { contacts: contacts === 'true', automations: automations === 'true', consolidated: consolidated === 'true', fiscal: fiscal === 'true', sharing: sharing === 'true' }, t.code);
  }
  for (const [code, cents] of [['essentiel_mensuel', 990], ['essentiel_annuel', 9900], ['patrimoine_mensuel', 1990], ['patrimoine_annuel', 19900], ['pro_mensuel', 3990], ['pro_annuel', 39900], ['pack_fiscal', 4900]] as const) {
    assert.match(sql, new RegExp(`'${code}',\\s*'[^']+',\\s*${cents},`), `prix affiché ${code}`);
  }
  assert.equal(TIERS.find((t) => t.code === 'patrimoine')!.annual, 199);
});

test('lancement ou migration absente : aucune limite', () => {
  const data = snap({ properties: Array.from({ length: 20 }, (_, i) => prop(`p${i}`, 'acquis')) });
  assert.equal(planViolation(UNLIMITED_PLAN, data, { table: 'properties', rows: [{ status: 'acquis' }] }), null);
  assert.equal(planViolation(demoPlan('decouverte', false), data, { table: 'properties', rows: [{ status: 'acquis' }] }), null, 'limites non appliquées');
  assert.equal(planViolation(null, data, { table: 'pro_contacts', rows: [{ name: 'A' }] }), null);
});

test('Découverte : biens détenus et prospection', () => {
  const data = snap({ properties: [prop('a', 'acquis'), ...['b', 'c', 'd', 'e'].map((id) => prop(id, 'repere')), prop('z', 'abandonne')] });
  assert.match(planViolation(decouverte, data, { table: 'properties', rows: [{ status: 'acquis' }] })!, /1 bien détenu au plus/);
  assert.match(planViolation(decouverte, data, { table: 'properties', current: data.properties[1]!, patch: { status: 'acquis' } })!, /1 bien détenu/, 'passage à Acquis');
  assert.equal(planViolation(decouverte, data, { table: 'properties', rows: [{ status: 'repere' }] }), null, '5e bien en prospection');
  assert.match(planViolation(decouverte, data, { table: 'properties', rows: [{ status: 'repere' }, { status: 'visite' }] })!, /5 biens en prospection/, 'import de 2 biens');
  assert.equal(planViolation(decouverte, data, { table: 'properties', current: data.properties[0]!, patch: { title: 'Renommé' } }), null, 'bien existant modifiable');
  assert.equal(planViolation(decouverte, data, { table: 'properties', current: data.properties[1]!, patch: { status: 'visite' } }), null, 'changement de statut dans la prospection');
  assert.equal(planViolation(essentiel, data, { table: 'properties', rows: [{ status: 'acquis' }] }), null, 'Essentiel : 2e bien détenu');
});

test('Découverte : scénarios, contacts, documents, automatisations', () => {
  const data = snap({
    scenarios: [{ id: 's1', property_id: 'p', archived_at: null }, { id: 's2', property_id: 'p', archived_at: null }, { id: 's3', property_id: 'p', archived_at: '2026-01-01' }] as unknown as Snapshot['scenarios'],
    documents: [{ id: 'd', size_bytes: 100 * 1048576 - 10 }] as unknown as Snapshot['documents'],
    leases: [{ id: 'l', receipt_auto_send: true }] as unknown as Snapshot['leases'],
  });
  assert.match(planViolation(decouverte, data, { table: 'scenarios', rows: [{ property_id: 'p' }] })!, /2 scénarios/);
  assert.equal(planViolation(decouverte, data, { table: 'scenarios', rows: [{ property_id: null }] }), null, 'simulation sans bien');
  assert.match(planViolation(decouverte, data, { table: 'scenarios', current: data.scenarios[2]!, patch: { archived_at: null } })!, /2 scénarios/, 'désarchivage');
  assert.match(planViolation(decouverte, data, { table: 'pro_contacts', rows: [{ name: 'Agence' }] })!, /contacts immobiliers/);
  assert.equal(planViolation(essentiel, data, { table: 'pro_contacts', rows: [{ name: 'Agence' }] }), null);
  assert.equal(planViolation(decouverte, data, { table: 'documents', rows: [{ size_bytes: 10 }] }), null, 'exactement 100 Mo');
  assert.match(planViolation(decouverte, data, { table: 'documents', rows: [{ size_bytes: 11 }] })!, /100 Mo/);
  assert.match(planViolation(decouverte, data, { table: 'leases', rows: [{ owner_confirmation_email: true }] })!, /automatique/);
  assert.equal(planViolation(decouverte, data, { table: 'leases', rows: [{ owner_confirmation_email: false }] }), null);
  assert.equal(planViolation(decouverte, data, { table: 'leases', current: data.leases[0]!, patch: { rent_hc: 700 } }), null, 'bail déjà automatisé modifiable');
  assert.match(planViolation(decouverte, data, { table: 'reminders', rows: [{ subject: 'x' }] })!, /relances/);
  assert.deepEqual(planUsage(data), { owned: 0, prospects: 0, storage_bytes: 100 * 1048576 - 10 });
});
