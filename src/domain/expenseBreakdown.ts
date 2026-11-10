import type { Expense, ExpenseCategory } from '../data/types.ts';
import { EXPENSE_CATEGORY_LABELS, isIncome, MAIN_EXPENSE_CATEGORIES, OTHER_EXPENSE_CATEGORIES } from './rental.ts';
import { round2 } from './simulator.ts';

/**
 * Répartition des dépenses par catégorie (camembert de Dépenses).
 * Sept catégories nommées au plus, le reste regroupé dans « Autres ». Les catégories nommées et leur
 * couleur sont fixées sur l'ensemble des dépenses (toutes années, tous biens) : changer de filtre ne
 * repeint jamais une part.
 */

export const OTHERS = '@autres' as const;
export type BreakdownKey = ExpenseCategory | typeof OTHERS;
export const MAX_NAMED = 7;

const ORDER = [...MAIN_EXPENSE_CATEGORIES, ...OTHER_EXPENSE_CATEGORIES];

/** Catégories ayant leur propre part (et leur couleur, dans cet ordre) : les plus lourdes sur l'ensemble des dépenses. */
export function namedCategories(all: Expense[]): ExpenseCategory[] {
  const sum = new Map<ExpenseCategory, number>();
  for (const e of all) if (!isIncome(e)) sum.set(e.category, (sum.get(e.category) ?? 0) + e.amount);
  return [...sum.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1] || ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]))
    .slice(0, MAX_NAMED)
    .map(([k]) => k)
    // couleur attribuée dans un ordre stable (celui des catégories), pas selon le rang
    .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
}

export interface Slice { key: BreakdownKey; label: string; amount: number; share: number; count: number; slot: number }

/** Parts du camembert pour les dépenses affichées (recettes exclues), de la plus grosse à la plus petite, « Autres » en dernier. */
export function breakdown(rows: Expense[], named: ExpenseCategory[]): Slice[] {
  const acc = new Map<BreakdownKey, { amount: number; count: number }>();
  for (const e of rows) {
    if (isIncome(e) || e.amount <= 0) continue;
    const k: BreakdownKey = named.includes(e.category) ? e.category : OTHERS;
    const a = acc.get(k) ?? { amount: 0, count: 0 };
    acc.set(k, { amount: a.amount + e.amount, count: a.count + 1 });
  }
  const total = [...acc.values()].reduce((s, a) => s + a.amount, 0);
  return [...acc.entries()]
    .map(([key, a]) => ({ key, label: key === OTHERS ? 'Autres' : EXPENSE_CATEGORY_LABELS[key], amount: round2(a.amount), share: total ? a.amount / total : 0, count: a.count, slot: key === OTHERS ? -1 : named.indexOf(key) }))
    .sort((a, b) => (a.key === OTHERS ? 1 : b.key === OTHERS ? -1 : b.amount - a.amount));
}

/** La dépense correspond-elle au filtre de catégorie (une catégorie, « Autres » ou tout) ? */
export function inCategory(e: Expense, filter: '' | BreakdownKey, named: ExpenseCategory[]): boolean {
  if (!filter) return true;
  if (filter === OTHERS) return !isIncome(e) && !named.includes(e.category);
  return e.category === filter;
}

/** Libellés des catégories regroupées dans « Autres » pour ces dépenses. */
export function othersLabels(rows: Expense[], named: ExpenseCategory[]): string[] {
  return [...new Set(rows.filter((e) => !isIncome(e) && !named.includes(e.category)).map((e) => EXPENSE_CATEGORY_LABELS[e.category]))];
}
