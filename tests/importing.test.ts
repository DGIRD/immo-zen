import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildImportRows, matchCategory, parseAmount, parseDate, parseDelimited, parseXlsx, rowStatus, toExpense, likelyDuplicates } from '../src/domain/importing.ts';
import { toXlsx } from '../src/domain/exporting.ts';

const SAMPLE = [
  'Date\tLibellé\tCompte du mouvement\t Montant(EUROS) \tCatégorie\tCommentaires\tAppartement',
  '27/04/2023\tVIREMENT INSTANTANE A SYNDICAT 8 RUELLE 18672 Paiement charges \tCompte La banque postal\t-319,35 € \tCharges de copropriété (dont travaux)\t\t8 passage ruelle, 75018 Paris',
  '13/06/2023\tPRELEVEMENT DE SDC 8 PASSAGE RUE REF : 4921406 Sld Chg 01/01/202 /12/20 Sld Chg 01/01/2022-31/12/2022\tCompte La banque postal\t-535,43 € \tCharges de copropriété (dont travaux)\t\t8 passage ruelle, 75018 Paris',
  '24/11/2023\tVIREMENT INSTANTANE A O REAL\tCompte La banque postal\t-639,08 € \tCharges de copropriété (dont travaux)\t\t8 passage ruelle, 75018 Paris',
  '15/01/2024\tVIREMENT INSTANTANE A O REAL\tCompte La banque postal\t-335,33 € \tCharges de copropriété (dont travaux)\t\t8 passage ruelle, 75018 Paris',
  '08/04/2024\tVIREMENT INSTANTANE A O REAL Virement Charge T2 2024 - 1.079. 4500.00005.01\tCompte La banque postal\t-335,33 € \tCharges de copropriété (dont travaux)\t\t8 passage ruelle, 75018 Paris',
  '05/05/2024\tVIR LOYER MAI DUPONT\tCompte La banque postal\t850,00 € \tLoyer\t\t8 passage ruelle, 75018 Paris',
].join('\n');
const PROPS = [
  { id: 'p1', title: 'T2 Ruelle', address: '8 passage ruelle', zip: '75018', city: 'Paris' },
  { id: 'p2', title: 'Studio Lyon', address: '3 rue de la Paix', zip: '69002', city: 'Lyon' },
];

test('montants et dates au format français', () => {
  assert.equal(parseAmount('-319,35 € '), -319.35);
  assert.equal(parseAmount('1 234,56'), 1234.56);
  assert.equal(parseAmount('1,234.56'), 1234.56);
  assert.equal(parseAmount('(12,00)'), -12);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseDate('27/04/2023'), '2023-04-27');
  assert.equal(parseDate('27/04/23'), '2023-04-27');
  assert.equal(parseDate(45043), '2023-04-27', 'date Excel');
  assert.equal(parseDate('31/02/2024'), null);
});

test('catégories : libellés de la liste, variantes d’écriture', () => {
  assert.equal(matchCategory('Charges de copropriété (dont travaux)'), 'copropriete');
  assert.equal(matchCategory('Entretien, petit travaux amortissable'), 'entretien_amortissable');
  assert.equal(matchCategory('Entretien, petit travaux non amortissable'), 'entretien');
  assert.equal(matchCategory('Taxe foncière '), 'taxe_fonciere');
  assert.equal(matchCategory('Frais Bancaire / Financier'), 'frais_bancaires');
  assert.equal(matchCategory('Assurance crédit'), 'assurance_credit');
  assert.equal(matchCategory('Frais crédit'), 'frais_credit');
  assert.equal(matchCategory('Crédit'), 'credit');
  assert.equal(matchCategory('Assurance'), 'assurance');
  assert.equal(matchCategory('Meuble'), 'mobilier');
  assert.equal(matchCategory('Loyer'), 'loyer');
  assert.equal(matchCategory('Inconnue'), null);
});

test('relevé collé depuis Excel : lignes, logement reconnu, recette, anti-doublon', () => {
  const { rows, error } = buildImportRows(parseDelimited(SAMPLE), PROPS);
  assert.equal(error, undefined);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.map((r) => r.signed), [-319.35, -535.43, -639.08, -335.33, -335.33, 850]);
  assert.ok(rows.every((r) => r.propertyId === 'p1'));
  assert.equal(rows[0]!.category, 'copropriete');
  assert.notEqual(rows[3]!.ref, rows[4]!.ref, 'même montant, autre date : lignes distinctes');
  const st = rows.map((r) => rowStatus(r, new Set()).status);
  assert.deepEqual(st, ['ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
  const e = toExpense(rows[0]!);
  assert.equal(e.amount, 319.35);
  assert.equal(e.expense_date, '2023-04-27');
  assert.equal(e.account, 'Compte La banque postal');
  assert.equal(toExpense(rows[5]!).category, 'loyer');
  // réimport du même relevé : tout est reconnu comme déjà importé
  const again = buildImportRows(parseDelimited(SAMPLE), PROPS).rows;
  assert.ok(again.every((r) => rowStatus(r, new Set(rows.map((x) => x.ref))).status === 'doublon'));
});

test('deux mouvements identiques le même jour restent deux lignes', () => {
  const twice = SAMPLE.split('\n').slice(0, 2).concat(SAMPLE.split('\n')[1]!).join('\n');
  const { rows } = buildImportRows(parseDelimited(twice), PROPS);
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0]!.ref, rows[1]!.ref);
});

test('montant crédité hors loyer non importé par défaut ; logement inconnu à choisir', () => {
  const t = 'Date;Montant;Catégorie;Appartement\n01/02/2024;120,00;Assurance;8 passage ruelle 75018 Paris\n01/02/2024;-50;Assurance;Maison inconnue';
  const { rows } = buildImportRows(parseDelimited(t), PROPS);
  assert.equal(rowStatus(rows[0]!, new Set()).status, 'signe');
  assert.equal(rows[1]!.propertyId, null);
  assert.equal(rowStatus(rows[1]!, new Set()).message, 'Logement à choisir');
});

test('classeur .xlsx : en-têtes, dates Excel et montants numériques', async () => {
  const blob = await toXlsx([{ name: 'Relevé', rows: [{ d: '2023-04-27', l: 'SDC', m: -319.35, c: 'Charges de copropriété (dont travaux)', a: 'T2 Ruelle' }], columns: [
    { label: 'Date', value: (r: any) => r.d, kind: 'date' }, { label: 'Libellé', value: (r: any) => r.l },
    { label: 'Montant (EUROS)', value: (r: any) => r.m, kind: 'money' }, { label: 'Catégorie', value: (r: any) => r.c }, { label: 'Appartement', value: (r: any) => r.a },
  ] }]);
  const cells = await parseXlsx(new Uint8Array(await blob.arrayBuffer()));
  const { rows } = buildImportRows(cells, PROPS);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.date, '2023-04-27');
  assert.equal(rows[0]!.signed, -319.35);
  assert.equal(rows[0]!.propertyId, 'p1', 'titre du bien reconnu');
});

test('doublons probables : ligne répétée dans le fichier, dépense semblable déjà saisie à 3 jours près', () => {
  const text = SAMPLE + '\n' + SAMPLE.split('\n')[1]; // la 1re ligne de données répétée en fin de fichier
  const { rows } = buildImportRows(parseDelimited(text), PROPS);
  const existing = [
    { property_id: 'p1', expense_date: '2024-01-17', amount: 335.33, label: 'Charges T1 saisies à la main', import_ref: null }, // 2 jours après la ligne du 15/01
    { property_id: 'p2', expense_date: '2023-11-24', amount: 639.08, label: 'Autre logement', import_ref: null }, // autre logement : ignorée
    { property_id: 'p1', expense_date: '2023-06-30', amount: 535.43, label: 'Trop loin', import_ref: null }, // 17 jours d'écart
  ];
  const d = likelyDuplicates(rows, existing);
  const lines = [...d.keys()].map((i) => rows[i]!.line);
  assert.deepEqual(lines.sort((a, b) => a - b), [5, 8]);
  assert.match(d.get(rows.findIndex((r) => r.line === 8))!, /Ligne identique plus haut dans le fichier \(ligne 2\)/);
  assert.match(d.get(rows.findIndex((r) => r.line === 5))!, /déjà enregistrée le 17\/01\/2024/);
  // le loyer n'est pas concerné (contrôle propre dans Loyers et paiements) ; deux lignes distinctes de même montant non plus
  assert.equal(likelyDuplicates(rows.slice(0, 6), []).size, 0);
});
