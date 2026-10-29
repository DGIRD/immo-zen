import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSuggestions } from '../src/domain/address.ts';
import { parseDelimited } from '../src/domain/importing.ts';
import { buildRentImportRows, importMonths, matchMethod, rentRowStatus, toPayment } from '../src/domain/rentImport.ts';
import { ledgerRows, ledgerSettings } from '../src/domain/ledger.ts';
import { receiptLines } from '../supabase/functions/_shared/receiptPdf.ts';

const L = (id: string, property_id: string, start_date = '2025-01-01', end_date: string | null = null) => ({ id, property_id, start_date, end_date, label: null }) as never;
const ctx = {
  leases: [L('l1', 'p1'), L('l2', 'p2')],
  properties: [{ id: 'p1', title: 'T2 Ruelle', address: '8 passage Ruelle', zip: '75018', city: 'Paris', status: 'acquis' }, { id: 'p2', title: 'Studio Lyon', address: '3 rue de la Paix', zip: '69002', city: 'Lyon', status: 'acquis' }] as never[],
  links: [{ lease_id: 'l1', tenant_id: 't1', left_on: null }, { lease_id: 'l2', tenant_id: 't2', left_on: null }] as never[],
  tenants: [{ id: 't1', first_name: 'Léa', last_name: 'Martin' }, { id: 't2', first_name: 'Hugo', last_name: 'Bernard' }] as never[],
};

test('import de loyers : bail retrouvé par locataire ou par adresse, moyens de paiement, anti-doublon', () => {
  const text = 'Date\tMontant\tLocataire\tAppartement\tMoyen\tRéférence\n05/01/2026\t850,00 €\tLéa Martin\t\tVirement\tVIR LOYER JANV\n05/01/2026\t620\t\t3 rue de la Paix 69002 Lyon\tChèque\t\n06/01/2026\t-20\tLéa Martin\t\t\t\n07/01/2026\t500\tInconnu\t\t\t';
  const { rows, error } = buildRentImportRows(parseDelimited(text), ctx);
  assert.equal(error, undefined);
  assert.deepEqual(rows.map((r) => r.leaseId), ['l1', 'l2', 'l1', null]);
  assert.deepEqual(rows.map((r) => rentRowStatus(r, new Set()).status), ['ok', 'ok', 'signe', 'incomplet']);
  assert.equal(rows[1]!.method, 'cheque');
  const p = toPayment(rows[0]!);
  assert.equal(p.amount, 850);
  assert.equal(p.source, 'import');
  assert.equal(rentRowStatus(rows[0]!, new Set([rows[0]!.ref])).status, 'doublon');
  assert.equal(matchMethod('Prélèvement SEPA'), 'prelevement');
  assert.equal(matchMethod('CAF'), 'caf');
});

test('import de loyers : paiements additionnés par mois, mois déplacé, excédent et quittance proposés', () => {
  const c = (id: string, start: string, total: number) => ({ id, lease_id: 'l1', kind: 'loyer', period_start: start, period_end: start, due_date: start, rent_amount: total, charges_amount: 0, cancelled_at: null }) as never;
  const ledger = ledgerRows({ charges: [c('c9', '2026-09-01', 900), c('c10', '2026-10-01', 900)], payments: [], allocations: [], receipts: [], leases: [{ id: 'l1', start_date: '2026-09-01', end_date: null }] }, ledgerSettings({}), '2026-10-27');
  const row = (ref: string, date: string, amount: number, month: string | null = null) => ({ line: 2, date, amount, rawTenant: null, rawProperty: null, leaseId: 'l1', method: 'virement', reference: null, comment: null, month, ref, errors: [] }) as never;
  const ms = importMonths([row('1', '2026-09-04', 600), row('2', '2026-09-20', 300), row('3', '2026-10-06', 1000), row('4', '2026-11-02', 50, '2026-10')], ledger);
  assert.deepEqual(ms.map((m) => [m.month, m.received, m.count, m.after, m.over, m.settles]), [['2026-09', 900, 2, 900, 0, true], ['2026-10', 1050, 2, 1050, 150, true]]);
  // le paiement du 2 novembre, déplacé sur octobre, y est rattaché
  assert.equal(toPayment(row('4', '2026-11-02', 50, '2026-10')).period_month, '2026-10-01');
  assert.equal(toPayment(row('1', '2026-09-04', 600)).period_month, '2026-09-01');
  const partial = importMonths([row('5', '2026-09-05', 800)], ledger);
  assert.deepEqual([partial[0]!.after, partial[0]!.settles], [800, false]);
});

test('adresses : suggestions de la Base Adresse Nationale', () => {
  const s = parseSuggestions({ features: [
    { properties: { label: '8 Passage Ruelle 75018 Paris', name: '8 Passage Ruelle', postcode: '75018', city: 'Paris', type: 'housenumber' } },
    { properties: { label: 'Montreuil', name: 'Montreuil', postcode: '93100', city: 'Montreuil', type: 'municipality' } },
    { properties: { label: 'incomplet' } },
  ] });
  assert.equal(s.length, 2);
  assert.deepEqual(s[0], { label: '8 Passage Ruelle 75018 Paris', address: '8 Passage Ruelle', zip: '75018', city: 'Paris' });
  assert.equal(s[1]!.address, '', 'une commune seule ne remplit pas la rue');
});

test('quittance : rappel de charges sur une ligne distincte et dans le total', () => {
  const l = receiptLines({ kind: 'quittance', number: 'Q-2026-0001', issued_on: '2026-03-06', period_start: '2026-03-01', period_end: '2026-03-31',
    rent_amount: 700, charges_amount: 50, paid_amount: 870, payments: [], tenant_names: 'Léa Martin', landlord_name: 'D. G.', landlord_address: null,
    property_address: null, extra_lines: [{ label: 'Rappel de charges 2025', amount: 120 }] });
  assert.deepEqual(l.detail.map(([k]) => k), ['Loyer hors charges', 'Provision pour charges', 'Rappel de charges 2025', 'Total réglé']);
  assert.match(l.detail.at(-1)![1], /870,00/);
  assert.match(l.statement, /rappel de charges \(Rappel de charges 2025\)/);
});
