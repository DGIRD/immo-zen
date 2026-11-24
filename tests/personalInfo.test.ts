import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { bankDossierDoc } from '../src/domain/bankDossier.ts';
import { buildBankDossierPdf } from '../src/domain/bankDossierPdf.ts';
import type { PatrimonyLine } from '../src/domain/patrimony.ts';
import { activeOtherLoans, ageOn, borrowerFromProfile, borrowerNames, fullAddress, householdIncome, missingFields, sanitizeInfo, situationText, type PersonalInfo } from '../src/domain/personalInfo.ts';

import { DEFAULT_INPUTS, simulate } from '../src/domain/simulator.ts';

const today = '2026-11-24';
const info: PersonalInfo = {
  borrower: { first_name: 'Alex', last_name: 'Exemple', birth_date: '1987-12-01', profession: 'Ingénieur', employer: 'Société A', contract: 'cdi', since: '2014-09-01', income: 3800 },
  co_borrower: { first_name: 'Sam', last_name: 'Exemple', birth_date: '1989-03-10', profession: 'Infirmière', contract: 'fonctionnaire', since: '2012-01-01', income: 2600 },
  family: 'marie', children: 2, address: '1 rue de la Paix', zip: '94120', city: 'Fontenay-sous-Bois', phone: '06 00 00 00 00',
  housing: 'proprietaire', other_income: 300, other_income_label: 'Allocations familiales', savings: 60000,
  other_loans: [
    { id: 'a', kind: 'auto', label: 'Voiture', lender: 'Banque B', monthly: 250, remaining: 9000, end_date: '2029-06-30' },
    { id: 'b', kind: 'consommation', monthly: 120, remaining: 0, end_date: '2025-12-31' },
  ],
};
const line = (o: Partial<PatrimonyLine>): PatrimonyLine => ({ id: 'x', title: 'Bien', city: null, usage: 'locatif', value: 200000, valueSource: 'mediane', remaining: 100000, remainingSource: 'calcul', monthlyLoan: 900, monthlyRent: 800, ...o });

test('identité, âge, adresse, situation', () => {
  assert.equal(borrowerNames(info), 'Alex et Sam Exemple');
  assert.equal(borrowerNames({ borrower: { first_name: 'Alex', last_name: 'Exemple' }, co_borrower: { first_name: 'Sam', last_name: 'Autre' } }), 'Alex Exemple et Sam Autre');
  assert.equal(borrowerNames({ borrower: { first_name: 'Alex', last_name: 'Exemple' } }), 'Alex Exemple');
  assert.equal(ageOn('1987-12-01', today), 38);
  assert.equal(ageOn('1987-11-24', today), 39);
  assert.equal(ageOn(null, today), null);
  assert.equal(fullAddress(info), '1 rue de la Paix, 94120 Fontenay-sous-Bois');
  assert.equal(situationText(info), 'Marié(e), 2 enfants à charge · CDI depuis 2014 et fonctionnaire ou agent statutaire depuis 2012');
  assert.equal(householdIncome(info), 6700);
  assert.deepEqual(activeOtherLoans(info, today).map((l) => l.id), ['a'], 'crédit terminé exclu');
  assert.deepEqual(missingFields(info), []);
  assert.deepEqual(missingFields({}), ['nom et prénom', 'date de naissance', 'situation professionnelle', 'revenus', 'adresse', 'situation familiale', 'épargne']);
});

test('emprunteur du dossier banque : crédits des biens + autres crédits, loyers, épargne après apport', () => {
  const b = borrowerFromProfile(info, { patrimony: [line({}), line({ usage: 'residence_principale', monthlyLoan: 1200, monthlyRent: 0, remaining: 200000 })], equity: 25000, today });
  assert.equal(b.names, 'Alex et Sam Exemple');
  assert.equal(b.income, 6700);
  assert.equal(b.currentLoans, 900 + 1200 + 250);
  assert.equal(b.currentRents, 800);
  assert.equal(b.savingsAfter, 35000);
  assert.equal(b.savings, 60000);
  assert.equal(b.people?.length, 2);
  assert.equal(b.people?.[0]?.age, 38);
  assert.match(b.people?.[0]?.job ?? '', /Ingénieur chez Société A/);
  assert.equal(b.loans?.length, 2);
  assert.equal(b.loans?.[0]?.remaining, 300000);
  assert.match(b.loans?.[1]?.label ?? '', /Voiture — Banque B/);
  assert.equal(b.housing, 'Propriétaire');
  assert.match(b.contact ?? '', /06 00/);
  // profil vide : rien d'inventé
  const vide = borrowerFromProfile({}, { patrimony: [], equity: 0, today });
  assert.equal(vide.names, undefined); assert.equal(vide.income, null); assert.equal(vide.currentLoans, null); assert.equal(vide.savingsAfter, null);
});

test('PDF : tableau des emprunteurs et des crédits en cours', async () => {
  const inputs = { ...DEFAULT_INPUTS, askingPrice: 200000, price: 200000, surface: 50, monthlyRent: 900, rentMode: 'manuel' as const, downPayment: 25000 };
  const out = simulate(inputs); assert.ok(out.ok);
  const borrower = borrowerFromProfile(info, { patrimony: [line({})], equity: out.result.equity, today });
  const doc = bankDossierDoc({ property: { title: 'T2' }, inputs, result: out.result, borrower, editedOn: today });
  const s = doc.sections.find((x) => x.title === 'Emprunteurs')!;
  assert.ok(s, 'section au pluriel avec co-emprunteur');
  const tables = s.blocks.filter((x) => x.t === 'table') as { head: string[]; rows: string[][] }[];
  assert.equal(tables[0]!.head[0], 'Emprunteur');
  assert.equal(tables[0]!.rows.length, 2);
  const credits = tables.find((t) => t.head[0] === 'Crédits en cours')!;
  assert.equal(credits.rows.length, 3, '2 crédits + total');
  const pdf = await PDFDocument.load(await buildBankDossierPdf({ PDFDocument, StandardFonts, rgb } as never, doc));
  assert.ok(pdf.getPageCount() >= 2);
  // épargne au bilan patrimonial : aujourd'hui et après l'apport, patrimoine total
  const avecBilan = bankDossierDoc({ property: { title: 'T2' }, inputs, result: out.result, borrower, editedOn: today, patrimony: [line({})] });
  const synth = (avecBilan.sections.find((x) => x.title === 'Bilan patrimonial immobilier')!.blocks.filter((x) => x.t === 'table')[1] as { rows: string[][] }).rows;
  const ep = synth.find((r) => r[0] === 'Épargne disponible')!;
  assert.equal(ep[1]!.replace(/\D/g, ''), '60000');
  assert.equal(ep[2]!.replace(/\D/g, ''), String(Math.max(0, Math.round(60000 - out.result.equity))));
  const tot = synth.find((r) => r[0]!.startsWith('Patrimoine total'))!;
  assert.equal(tot[1]!.replace(/\D/g, ''), String(100000 + 60000));
});

test('nettoyage avant enregistrement', () => {
  const s = sanitizeInfo({ borrower: { income: Number.NaN, birth_date: '' }, savings: Number.NaN, housing: 'proprietaire', housing_rent: 900,
    other_loans: [{ id: '1', kind: 'auto' }, { id: '2', kind: 'auto', monthly: 100, end_date: '' }] });
  assert.equal(s.borrower?.income, null); assert.equal(s.borrower?.birth_date, null);
  assert.equal(s.savings, null); assert.equal(s.housing_rent, null, 'loyer ignoré si propriétaire');
  assert.deepEqual(s.other_loans?.map((l) => l.id), ['2']); assert.equal(s.other_loans?.[0]?.end_date, null);
});

test('part des loyers retenue paramétrable', async () => {
  const { debtRatio } = await import('../src/domain/bankDossier.ts');
  const base = { income: 4000, currentLoans: 1000, currentRents: 1000 };
  const r70 = debtRatio(base, 500, 1000)!;
  assert.equal(r70.incomeRetained, 4000 + 0.7 * 2000);
  const r80 = debtRatio({ ...base, rentWeight: 80 }, 500, 1000)!;
  assert.equal(r80.incomeRetained, 4000 + 0.8 * 2000);
  assert.equal(debtRatio({ ...base, rentWeight: 250 }, 500, 1000)!.incomeRetained, 5400, 'valeur aberrante : 70 %');
  const b = borrowerFromProfile({ ...info, rent_weight: 60 }, { patrimony: [], equity: 0, today });
  assert.equal(b.rentWeight, 60);
  assert.equal(sanitizeInfo({ rent_weight: 120 }).rent_weight, null);
  const inputs = { ...DEFAULT_INPUTS, askingPrice: 200000, price: 200000, surface: 50, monthlyRent: 900, rentMode: 'manuel' as const, downPayment: 25000 };
  const out = simulate(inputs); assert.ok(out.ok);
  const doc = bankDossierDoc({ property: { title: 'T2' }, inputs, result: out.result, borrower: { ...base, rentWeight: 80 }, editedOn: today });
  assert.match(JSON.stringify(doc.sections), /loyers à 80 %/);
  assert.match(JSON.stringify(doc.sections), /pratique courante : 70 %/);
});
