import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HELP_TOPICS, searchHelp } from '../supabase/functions/_shared/help.ts';

const cases: [string, string, string?][] = [
  ['Comment importer mes loyers depuis Excel ?', 'import-loyers', 'loyers'],
  ['Comment réviser le loyer avec l’IRL ?', 'revision'],
  ['Pourquoi je ne vois pas les amortissements ?', 'amortissements', 'fiscal'],
  ['Comment créer un bail ?', 'baux'],
  ['Quelles cases remplir pour ma déclaration ?', 'fiscal'],
  ['Comment supprimer plusieurs dépenses ?', 'depenses', 'depenses'],
  ['Comment ajouter un bien en prospection ?', 'prospection'],
  ['Ajouter un rappel de charges sur une quittance', 'quittances'],
  ['Comment renseigner mon crédit ?', 'mes-biens', 'biens'],
  ['Comment importer mon relevé bancaire ?', 'import-depenses', 'depenses'],
  ['Par où commencer ?', 'demarrer', 'dashboard'],
  ['code postal automatique', 'adresses'],
  ['Comment est calculé le cash-flow ?', 'simulateur', 'simulateur'],
];

test('aide : chaque question type trouve le bon sujet en premier', () => {
  for (const [q, id, page] of cases) assert.equal(searchHelp(q, page)[0]?.id, id, q);
});

test('aide : question hors sujet sans réponse inventée, questions proposées valides', () => {
  assert.equal(searchHelp('recette de la tarte aux pommes').length, 0);
  for (const t of HELP_TOPICS) for (const q of t.questions ?? []) assert.ok(searchHelp(q, t.pages[0]).length > 0, `question proposée sans réponse : ${q}`);
});
