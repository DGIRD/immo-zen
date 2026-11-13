import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { bankDossierDoc, debtRatio } from '../src/domain/bankDossier.ts';
import { buildDocPdf } from '../src/domain/docPdf.ts';
import { DEFAULT_INPUTS, simulate } from '../src/domain/simulator.ts';

const inputs = { ...DEFAULT_INPUTS, askingPrice: 250000, price: 240000, surface: 60, monthlyRent: 1200, rentMode: 'manuel' as const, downPayment: 30000, interestRate: 3.5, loanYears: 20, insuranceRate: 0.3 };

test('taux d’endettement : loyers retenus à 70 %, mensualités assurance comprise', () => {
  const d = debtRatio({ income: 5000, currentLoans: 900, currentRents: 1000 }, 1300, 1200)!;
  assert.equal(d.incomeRetained, 5000 + 0.7 * 2200);
  assert.equal(d.debt, 2200);
  assert.equal(d.after, Math.round((2200 / 6540) * 10000) / 100);
  assert.equal(d.before, Math.round((900 / 5700) * 10000) / 100);
  assert.equal(debtRatio({}, 1300, 1200), null, 'sans revenus, pas de calcul');
});

test('dossier de financement : sections, plan de financement équilibré, PDF généré', async () => {
  const out = simulate(inputs);
  assert.ok(out.ok);
  const r = out.result;
  const doc = bankDossierDoc({ property: { title: 'T3 Vincennes', city: 'Vincennes', zip: '94300', property_type: 'appartement', rooms: 3, dpe: 'C', furnished: true },
    inputs, result: r, borrower: { names: 'David Girardeau', income: 5000, currentLoans: 900 }, editedOn: '2026-11-13' });
  const titles = doc.sections.map((s) => s.title);
  assert.deepEqual(titles, ['Synthèse du projet', 'Emprunteur', 'Le bien', 'Plan de financement', 'Prêt demandé', 'Rentabilité locative (année pleine, avant impôt)', 'Tableau d’amortissement annuel', 'Avertissement']);
  const plan = doc.sections.find((s) => s.title === 'Plan de financement')!;
  const tables = plan.blocks.filter((b) => b.t === 'table') as { rows: string[][] }[];
  assert.equal(tables[0]!.rows.at(-1)![1], tables[1]!.rows.at(-1)![1], 'emplois = ressources');
  const sans = bankDossierDoc({ property: { title: 'T3' }, inputs, result: r, editedOn: '2026-11-13', withSchedule: false });
  assert.ok(!sans.sections.some((s) => s.title === 'Emprunteur' || s.title.startsWith('Tableau')));
  const bytes = await buildDocPdf({ PDFDocument, StandardFonts, rgb } as never, doc);
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 2);
});
