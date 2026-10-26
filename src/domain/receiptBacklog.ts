// Mise en cohérence des quittances avec les paiements déjà reçus :
// toutes les échéances de loyer intégralement réglées sans quittance, avec les rappels de charges
// réglés à reprendre sur l'une d'elles.
import type { Receipt } from '../data/types.ts';
import type { ChargeView } from './rental.ts';

export interface BacklogItem {
  /** Échéance de loyer à quittancer. */
  view: ChargeView;
  /** Rappels de charges (sommes dues réglées) repris sur cette quittance. */
  extras: ChargeView[];
}

export interface ReceiptBacklog {
  items: BacklogItem[];
  /** Rappels réglés sans loyer à quittancer sur le même bail : à reprendre sur une prochaine quittance. */
  orphans: ChargeView[];
  total: number;
}

/** Une échéance (loyer ou rappel) figure-t-elle déjà sur une quittance valable ? */
export function quittancedIds(receipts: Receipt[]): Set<string> {
  const ids = new Set<string>();
  for (const r of receipts) {
    if (r.kind !== 'quittance' || r.cancelled_at) continue;
    ids.add(r.charge_id);
    for (const x of r.extra_lines ?? []) ids.add(x.charge_id);
  }
  return ids;
}

export function receiptBacklog(views: ChargeView[], receipts: Receipt[], leaseId?: string): ReceiptBacklog {
  const done = quittancedIds(receipts);
  const todo = views.filter((v) => !v.charge.cancelled_at && v.status === 'payee' && v.total > 0 && !done.has(v.charge.id) && (!leaseId || v.charge.lease_id === leaseId));
  const loyers = todo.filter((v) => v.charge.kind === 'loyer').sort((a, b) => a.charge.period_start.localeCompare(b.charge.period_start));
  const items: BacklogItem[] = loyers.map((view) => ({ view, extras: [] }));
  const orphans: ChargeView[] = [];
  for (const x of todo.filter((v) => v.charge.kind !== 'loyer').sort((a, b) => a.charge.due_date.localeCompare(b.charge.due_date))) {
    const same = items.filter((i) => i.view.charge.lease_id === x.charge.lease_id);
    // quittance du mois où le rappel est exigible, sinon la suivante, sinon la plus récente
    const target = same.find((i) => i.view.charge.period_end >= x.charge.due_date) ?? same[same.length - 1];
    if (target) target.extras.push(x); else orphans.push(x);
  }
  const total = Math.round(items.reduce((s, i) => s + i.view.total + i.extras.reduce((t, e) => t + e.total, 0), 0) * 100) / 100;
  return { items, orphans, total };
}
