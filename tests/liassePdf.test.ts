import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import * as lib from 'pdf-lib';
import type { Expense, Property } from '../src/data/types.ts';
import { fiscalSummary, type FiscalData } from '../src/domain/fiscal.ts';
import { buildDocPdf, type TableBlock } from '../src/domain/docPdf.ts';
import { cerfaData, eur, liasseDoc } from '../src/domain/liassePdf.ts';
import { amount } from '../src/domain/cerfaPdf.ts';

const prop = (id: string, title: string, o: Partial<Property> = {}): Property => ({
  id, user_id: 'u', version: 1, created_at: '', updated_at: '', title, status: 'acquis', status_before_archive: null, occupation_status: 'loue',
  property_type: 'appartement', address: '8 passage Ruelle', zip: '75018', city: 'Paris', surface: 40, rooms: 2, dpe: null, listing_url: null, asking_price: null, offer_price: null,
  works_budget: null, estimated_rent: 900, charges_provision: 100, agency_id: null, agent_id: null, next_action: null, follow_up_date: null, visit_at: null,
  comments: null, vigilance: [], ownership_mode: 'nom_propre', tax_regime: 'reel_bic', acquired_at: '2025-01-01', acquisition_cost: null,
  acquisition_snapshot: null, primary_scenario_id: null, legacy_simulation_id: null, legacy_ref: null, ...o,
});
let n = 0;
const exp = (pid: string, category: Expense['category'], amount: number, d = '2025-03-01', o: Partial<Expense> = {}): Expense => ({
  id: `e${++n}`, user_id: 'u', version: 1, created_at: '', updated_at: '', property_id: pid, expense_date: d, supplier: null, label: null, amount, category,
  nature: 'charge', recoverable_amount: 0, payment_status: 'paye', paid_on: d, document_id: null, notes: null, ...o,
});

// les trois biens de la liasse 2025 (résultats avant amortissement 4 267, 4 820 et −3 731 €)
const props = [prop('a', 'F3 Paris 18'), prop('b', 'F3 Vincennes', { address: '29 rue Crébillon', zip: '94300', city: 'Vincennes' }), prop('c', 'F3 Paris 19', { address: '39 rue de Crimée', zip: '75019', city: 'Paris', acquired_at: '2025-08-27', acquisition_cost: 200000 })];
const d: FiscalData = { properties: props, leases: [], charges: [], payments: [], allocations: [], expenses: [
  exp('a', 'loyer', 10000, '2025-03-01', { nature: 'tresorerie' }), exp('a', 'copropriete', 5733), exp('a', 'mobilier', 7508, '2025-01-01', { amortization_years: 1, label: 'Meubles' }),
  exp('b', 'loyer', 10000, '2025-03-01', { nature: 'tresorerie' }), exp('b', 'copropriete', 5180), exp('b', 'mobilier', 9853, '2025-01-01', { amortization_years: 1, label: 'Cuisine' }),
  exp('c', 'loyer', 1000, '2025-09-01', { nature: 'tresorerie' }), exp('c', 'taxe_fonciere', 4731, '2025-10-15'),
] };

test('liasse LMNP : sections, reports 2042-C-PRO, récapitulatif, suivi 39 C et formulaires', async () => {
  const s = fiscalSummary(2025, d, () => ({}));
  const doc = liasseDoc({ year: 2025, reel: s.reelBic!, properties: props, bilan: null, declarant: { name: 'LOCATION GIRARDEAU', siren: '951680511' }, editedOn: '2026-11-10' });
  const titles = doc.sections.map((x) => x.title);
  for (const t of ['Synthèse de l\'exercice 2025', 'Reports sur votre déclaration de revenus 2026 (2042-C-PRO)', 'Résultat de l\'activité LMNP', 'Récapitulatif du résultat comptable',
    'Suivi des amortissements excédentaires reportables par bien', 'Détail des immobilisations']) assert.ok(titles.includes(t), `section manquante : ${t}`);
  const table = (title: string) => doc.sections.find((x) => x.title === title)!.blocks.find((b) => b.t === 'table') as TableBlock;
  const reports = table('Reports sur votre déclaration de revenus 2026 (2042-C-PRO)');
  assert.deepEqual(reports.rows.map((r) => [r[0], r[2]]), [['5NA', eur(0)], ['5NY', eur(0)]]);
  const recap = table('Récapitulatif du résultat comptable');
  assert.ok(recap.head.includes('Amortissement'));
  assert.equal(recap.rows.at(-1)![0], 'Total global');
  const suivi = table('Suivi des amortissements excédentaires reportables par bien');
  assert.equal(suivi.rows.at(-1)![4], eur(s.reelBic!.liasse.deferredAfter));
  // formulaires, case par case
  const f = cerfaData({ year: 2025, reel: s.reelBic!, properties: props, bilan: null, declarant: { name: 'LOCATION GIRARDEAU', siren: '951680511' }, editedOn: '2026-11-10' });
  assert.equal(f.a, null, 'sans bilan relu, pas de 2033-A');
  assert.equal(f.b['218'], 21000);
  assert.equal(f.b['314'], -s.reelBic!.liasse.lines.find((x) => x.code === '310')!.amount, 'perte comptable reportée col. 2');
  assert.equal(f.b['318'], s.reelBic!.liasse.deferredAfter);
  assert.equal(f.b['352'], 0); assert.equal(f.b['370'], 0);
  assert.equal(f.c['426'], 40000, 'terrain du F3 Paris 19 (20 %)');
  assert.equal(f.c['432'], 160000, 'construction acquise dans l’exercice');
  assert.equal(f.c['572'], f.c['522']! + f.c['562']!);
  assert.equal(f.result, 0);
  assert.equal(amount(773762), '773 762'); assert.equal(amount(-15166), '-15 166'); assert.equal(amount(0), ''); assert.equal(amount(0, true), '0');
  const bytes = await buildDocPdf(lib as never, doc);
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), '%PDF-');
  const pdf = await lib.PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 7, `${pdf.getPageCount()} pages`);
  if (process.env.LIASSE_OUT) await writeFile(process.env.LIASSE_OUT, bytes);
});

test('liasse : sans amortissement, la colonne disparaît du récapitulatif', () => {
  const d2: FiscalData = { ...d, expenses: d.expenses.filter((e) => e.category !== 'mobilier'), properties: props.map((p) => ({ ...p, acquisition_cost: null })) };
  const s = fiscalSummary(2025, d2, () => ({}));
  const doc = liasseDoc({ year: 2025, reel: s.reelBic!, properties: d2.properties, bilan: null, editedOn: '2026-11-10' });
  const recap = doc.sections.find((x) => x.title === 'Récapitulatif du résultat comptable')!.blocks[0] as TableBlock;
  assert.ok(!recap.head.includes('Amortissement'));
  assert.equal(doc.sections.find((x) => x.title.startsWith('Suivi des amortissements excédentaires')), undefined);
});

test('liasse : imprimés officiels 2031-SD et 2033-SD remplis case par case', async () => {
  const s = fiscalSummary(2025, d, () => ({}));
  const cerfa = { f2031: new Uint8Array(await readFile('public/cerfa/2031-sd_5396.pdf')), f2033: new Uint8Array(await readFile('public/cerfa/2033-sd_5394.pdf')) };
  const bilan = { immoGross: 217361, immoDep: 19333, immoNet: 198028, receivables: 0, cash: 4200, currentTotal: 4200, assetsGross: 221561, assetsDep: 19333, assetsNet: 202228,
    capital: 215000, result: -13977, equity: 201023, loans: 0, otherDebts: 1205, debts: 1205, liabilities: 202228, loansBeyondOneYear: 0, acquisitions: 217361, tracked: null, gap: 0,
    gapExplained: { receivables: 0, payables: 0, loanBank: 0, manual: 0, other: 0 } };
  const doc = liasseDoc({ year: 2025, reel: s.reelBic!, properties: props, bilan, declarant: { name: 'LOCATION GIRARDEAU', siren: '951680511', address: '8 passage Ruelle 75018 Paris', home: '10 rue Coli 94120 Fontenay-sous-Bois' }, editedOn: '2026-11-10', cerfa });
  const bytes = await buildDocPdf(lib as never, doc);
  const pdf = await lib.PDFDocument.load(bytes);
  const body = (await lib.PDFDocument.load(await buildDocPdf(lib as never, { ...doc, extraPages: undefined }))).getPageCount();
  assert.equal(pdf.getPageCount(), body + 1 + 7, '2031 page 1 + 2033-A à G');
  if (process.env.LIASSE_CERFA_OUT) await writeFile(process.env.LIASSE_CERFA_OUT, bytes);
});
