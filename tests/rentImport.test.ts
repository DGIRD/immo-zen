import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSuggestions } from '../src/domain/address.ts';
import { parseDelimited } from '../src/domain/importing.ts';
import { buildRentImportRows, matchMethod, planAllocations, rentRowStatus, toPayment } from '../src/domain/rentImport.ts';
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

test('import de loyers : répartition chronologique sur les échéances dues, excédent en avance', () => {
  const v = (id: string, due: string, remaining: number) => ({ charge: { id, due_date: due, cancelled_at: null }, remaining }) as never;
  const plans = planAllocations([{ key: 'a', amount: 900 }, { key: 'b', amount: 900 }], [v('c1', '2026-01-05', 750), v('c2', '2026-02-05', 750)]);
  assert.deepEqual(plans.get('a'), [{ charge_id: 'c1', amount: 750 }, { charge_id: 'c2', amount: 150 }]);
  assert.deepEqual(plans.get('b'), [{ charge_id: 'c2', amount: 600 }], 'le reste (300 €) demeure en avance');
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
