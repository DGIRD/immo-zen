/**
 * Bilan patrimonial immobilier : chaque bien détenu (locatif, résidence principale ou secondaire) avec sa valeur
 * estimée (prix médian de l'estimation, à défaut le milieu de la fourchette, à défaut le coût d'acquisition),
 * le capital restant dû de son crédit et le patrimoine net (valeur − capital restant dû).
 */
import type { Property, PropertyUsage } from '../data/types.ts';
import { loanInfo } from './property.ts';
import { round2 } from './simulator.ts';

export interface PatrimonyLine {
  id: string;
  title: string;
  city: string | null;
  usage: PropertyUsage;
  value: number | null;
  /** D'où vient la valeur : estimation (médiane), milieu de fourchette, coût d'acquisition. */
  valueSource: 'mediane' | 'fourchette' | 'achat' | null;
  remaining: number;
  /** Capital restant dû calculé à la date du jour, ou montant initial faute de date de début. */
  remainingSource: 'calcul' | 'initial' | null;
  monthlyLoan: number;
  monthlyRent: number;
}

export interface PatrimonyTotals { value: number; remaining: number; net: number; monthlyLoan: number; monthlyRent: number; count: number; missingValue: number; ltv: number | null }

export function propertyValue(p: Pick<Property, 'estimate_median' | 'estimate_low' | 'estimate_high' | 'acquisition_cost'>): { value: number | null; source: PatrimonyLine['valueSource'] } {
  if (p.estimate_median != null && p.estimate_median > 0) return { value: p.estimate_median, source: 'mediane' };
  if (p.estimate_low != null && p.estimate_high != null) return { value: Math.round((p.estimate_low + p.estimate_high) / 2), source: 'fourchette' };
  if (p.acquisition_cost != null && p.acquisition_cost > 0) return { value: p.acquisition_cost, source: 'achat' };
  return { value: null, source: null };
}

export function patrimonyLines(properties: Property[], today: string): PatrimonyLine[] {
  const order: Record<PropertyUsage, number> = { residence_principale: 0, residence_secondaire: 1, locatif: 2 };
  return properties
    .filter((p) => p.status === 'acquis')
    .map((p): PatrimonyLine => {
      const usage = p.usage ?? 'locatif';
      const { value, source } = propertyValue(p);
      const loan = loanInfo(p, today);
      let remaining = 0;
      let remainingSource: PatrimonyLine['remainingSource'] = null;
      if (loan && !loan.finished) {
        if (loan.remaining != null) { remaining = loan.remaining; remainingSource = 'calcul'; }
        else if (p.loan_amount) { remaining = p.loan_amount; remainingSource = 'initial'; }
      }
      return {
        id: p.id, title: p.title, city: p.city, usage, value, valueSource: source,
        remaining: round2(remaining), remainingSource,
        monthlyLoan: loan?.monthlyTotal ?? 0,
        monthlyRent: usage === 'locatif' && p.occupation_status !== 'vacant' ? (p.estimated_rent ?? 0) : 0,
      };
    })
    .sort((a, b) => order[a.usage] - order[b.usage] || (b.value ?? 0) - (a.value ?? 0));
}

export function patrimonyTotals(lines: PatrimonyLine[]): PatrimonyTotals {
  const value = lines.reduce((s, l) => s + (l.value ?? 0), 0);
  const remaining = lines.reduce((s, l) => s + l.remaining, 0);
  return {
    value: round2(value), remaining: round2(remaining), net: round2(value - remaining),
    monthlyLoan: round2(lines.reduce((s, l) => s + l.monthlyLoan, 0)),
    monthlyRent: round2(lines.reduce((s, l) => s + l.monthlyRent, 0)),
    count: lines.length, missingValue: lines.filter((l) => l.value == null).length,
    ltv: value > 0 ? round2((remaining / value) * 100) : null,
  };
}
