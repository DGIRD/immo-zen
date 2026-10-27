// Mise en cohérence paiements / échéances / quittances, mois par mois : le paiement fait foi.
// Chaque paiement règle le loyer du mois de sa date ; la quittance du mois reprend la somme des
// paiements reçus ce mois-là. Fonctions pures, utilisées par l'écran et par les tests.
import type { Allocation, Lease, Payment, Receipt, RentCharge } from '../data/types.ts';
import { chargeTotal, chargeViews, paymentSourcePlan, sourceReallocation, type SourceMonth } from './rental.ts';
import { round2 } from './simulator.ts';

export type CoherenceKind =
  /** payé moins que l'échéance : l'échéance peut être ramenée au montant payé */
  | 'baisse'
  /** payé plus que l'échéance : l'échéance peut être portée au montant payé */
  | 'hausse'
  /** payé exactement l'échéance */
  | 'egal'
  /** mois échu sans aucun paiement */
  | 'vide';

export interface CoherenceChoice { align?: boolean; cancel?: boolean; issue?: boolean }

export interface CoherenceRow {
  m: SourceMonth;
  kind: CoherenceKind;
  align: boolean;
  cancel: boolean;
  /** Montant dû après l'opération. */
  target: number;
  /** Réglé sur l'échéance après l'opération. */
  paidAfter: number;
  /** Quittance possible après l'opération (mois intégralement réglé, sans quittance). */
  canIssue: boolean;
  issue: boolean;
}

export interface Coherence {
  rows: CoherenceRow[];
  /** Mois déjà quittancés, non modifiés. */
  frozen: number;
  orphans: Payment[];
  plan: ReturnType<typeof sourceReallocation>;
  cancels: RentCharge[];
  /** Échéances à quittancer, du mois le plus ancien au plus récent. */
  issues: string[];
  /** Avance restant au crédit du locataire après l'opération. */
  advance: number;
  /** Quelque chose change (répartition, montants, annulations ou quittances). */
  needed: boolean;
  /** Actions proposées par défaut (pour le compteur du bouton). */
  suggested: number;
}

type Data = { charges: RentCharge[]; payments: Payment[]; allocations: Allocation[]; receipts: Pick<Receipt, 'charge_id' | 'kind' | 'cancelled_at' | 'extra_lines'>[] };

export function coherence(lease: Pick<Lease, 'id' | 'rent_hc' | 'charges_amount'>, d: Data, today: string, choices: Record<string, CoherenceChoice> = {}): Coherence {
  const src = paymentSourcePlan(lease.id, d.charges, d.payments, d.allocations, d.receipts, today);
  const normal = round2(lease.rent_hc + lease.charges_amount);
  const live = src.months.filter((m) => !m.frozen);
  const base = live.map((m) => {
    const kind: CoherenceKind = m.received === 0 ? 'vide' : m.received < m.total ? 'baisse' : m.received > m.total ? 'hausse' : 'egal';
    const c = choices[m.charge.id] ?? {};
    // mois échu payé moins : aligné par défaut ; payé plus : seulement s'il ne dépasse pas le loyer du bail
    // (au-delà, doublon ou rattrapage possible : à cocher soi-même)
    const alignDefault = m.past && (kind === 'baisse' || (kind === 'hausse' && m.received <= normal));
    const align = (kind === 'baisse' || kind === 'hausse') && (c.align ?? alignDefault);
    const cancel = kind === 'vide' && m.past && (c.cancel ?? false);
    return { m, kind, align, cancel, target: align ? m.received : m.total };
  });
  const targets = new Map(base.filter((r) => r.align).map((r) => [r.m.charge.id, r.target]));
  const cancels = base.filter((r) => r.cancel).map((r) => r.m.charge);
  const cancelled = new Set(cancels.map((c) => c.id));
  const plan = sourceReallocation(lease.id, d.charges.filter((c) => !cancelled.has(c.id)), d.payments, d.allocations, d.receipts, targets);
  const removed = new Set(plan.remove.map((a) => a.id));
  const after = [...d.allocations.filter((a) => !removed.has(a.id)), ...plan.add.map((a, i) => ({ id: `n${i}`, user_id: '', created_at: '', ...a }) as Allocation)];
  const upd = new Map(plan.updates.map((u) => [u.charge.id, u]));
  const charges = d.charges.filter((c) => c.lease_id === lease.id && !cancelled.has(c.id)).map((c) => (upd.has(c.id) ? { ...c, ...upd.get(c.id)! } : c));
  const views = new Map(chargeViews(charges, after, today).map((v) => [v.charge.id, v]));
  const rows: CoherenceRow[] = base.map((r) => {
    const v = views.get(r.m.charge.id);
    const paidAfter = v?.paid ?? 0;
    const target = v ? chargeTotal(v.charge) : r.target;
    const canIssue = !r.cancel && target > 0 && paidAfter >= target;
    const issue = canIssue && (choices[r.m.charge.id]?.issue ?? true);
    return { ...r, target, paidAfter, canIssue, issue };
  }).filter((r) => r.kind !== 'vide' || r.m.past || r.m.paidNow > 0);
  const issues = rows.filter((r) => r.issue).sort((a, b) => a.m.charge.period_start.localeCompare(b.m.charge.period_start)).map((r) => r.m.charge.id);
  const key = (xs: { payment_id: string; charge_id: string; amount: number }[]) => xs.map((a) => `${a.payment_id}|${a.charge_id}|${round2(a.amount)}`).sort().join(';');
  const realloc = key(plan.remove) !== key(plan.add);
  const allocatedTotal = round2(after.filter((a) => d.payments.some((p) => p.id === a.payment_id && p.lease_id === lease.id)).reduce((s, a) => s + a.amount, 0));
  const advance = round2(d.payments.filter((p) => p.lease_id === lease.id).reduce((s, p) => s + p.amount, 0) - allocatedTotal);
  const suggested = rows.filter((r) => r.align || r.issue).length;
  return { rows, frozen: src.months.length - live.length, orphans: src.orphans, plan, cancels, issues, advance, needed: realloc || plan.updates.length > 0 || cancels.length > 0 || issues.length > 0, suggested };
}
