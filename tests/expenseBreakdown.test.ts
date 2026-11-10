import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breakdown, inCategory, MAX_NAMED, namedCategories, OTHERS, othersLabels } from '../src/domain/expenseBreakdown.ts';
import { exp } from './fixtures/lmnp.ts';

const ALL = [
  exp('credit', 9000, '2025-01-10'), exp('credit', 9000, '2024-01-10'),
  exp('copropriete', 1200, '2025-02-10'), exp('taxe_fonciere', 900, '2025-10-15'),
  exp('assurance', 150, '2025-03-01'), exp('entretien', 400, '2025-04-01'),
  exp('assurance_credit', 300, '2025-05-01'), exp('frais_bancaires', 60, '2025-06-01'),
  exp('mobilier', 800, '2025-07-01'), exp('frais_credit', 50, '2024-07-01'),
  exp('autre', 40, '2025-08-01'),
  exp('loyer', 900, '2025-01-05', { nature: 'tresorerie' }),
];

test('sept catégories nommées au plus, les plus lourdes sur toutes les dépenses, recettes exclues', () => {
  const named = namedCategories(ALL);
  assert.equal(named.length, MAX_NAMED);
  assert.ok(!named.includes('loyer'));
  assert.ok(!named.includes('autre') && !named.includes('frais_credit') && !named.includes('frais_bancaires'), named.join(','));
  assert.deepEqual(namedCategories([...ALL].reverse()), named, 'ordre (donc couleurs) indépendant de l’ordre des lignes');
});

test('parts : montants, pourcentages, « Autres » en dernier, couleurs stables quand le filtre change', () => {
  const named = namedCategories(ALL);
  const y2025 = ALL.filter((e) => e.expense_date.startsWith('2025'));
  const s = breakdown(y2025, named);
  assert.equal(s[0]!.key, 'credit');
  assert.equal(s[0]!.amount, 9000);
  assert.equal(s.at(-1)!.key, OTHERS);
  assert.equal(s.at(-1)!.amount, 100, 'frais bancaires + divers');
  assert.ok(Math.abs(s.reduce((a, x) => a + x.share, 0) - 1) < 1e-9);
  assert.ok(!s.some((x) => x.key === 'loyer'));
  // la couleur (slot) d'une catégorie ne dépend pas des lignes affichées
  const s2 = breakdown(y2025.filter((e) => e.category !== 'credit'), named);
  assert.equal(s2.find((x) => x.key === 'copropriete')!.slot, s.find((x) => x.key === 'copropriete')!.slot);
  assert.deepEqual(othersLabels(y2025, named).sort(), ['Autres dépenses', 'Frais bancaires / financiers'].sort());
});

test('filtre : une catégorie, « Autres », ou tout', () => {
  const named = namedCategories(ALL);
  assert.equal(ALL.filter((e) => inCategory(e, '', named)).length, ALL.length);
  assert.deepEqual(ALL.filter((e) => inCategory(e, 'credit', named)).map((e) => e.amount), [9000, 9000]);
  const others = ALL.filter((e) => inCategory(e, OTHERS, named));
  assert.deepEqual(others.map((e) => e.category).sort(), ['autre', 'frais_bancaires', 'frais_credit']);
});
