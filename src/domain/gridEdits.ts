/**
 * Modification en grille de Loyers et paiements : une seule description des effets d'une ligne modifiée,
 * utilisée à la fois pour l'aperçu en direct (simulation en mémoire) et pour l'enregistrement (écritures en base).
 *
 * Une ligne modifiée devient une liste d'opérations (`planLineEdit`) calculée à partir des données à jour :
 * documents annulés, sommes dues modifiées, paiements créés, modifiés ou supprimés. Le statut « Réglé » ajoute
 * le paiement manquant calculé APRÈS la remise en conformité du bail (reports à jour), ce qui évite de régler
 * deux fois un reste dû déjà soldé par une ligne précédente de la même saisie.
 *
 * Les lignes sont toujours traitées du mois le plus ancien au plus récent, bail par bail (`sortEdits`).
 */
import type { Allocation, Lease, Payment, Receipt, RentCharge } from '../data/types.ts';
import { ledgerPlan, ledgerRows, type LedgerPlan, type LedgerRow, type LedgerSettings } from './ledger.ts';
import { round2 } from './simulator.ts';

export type GridValue = string | number | null;
export interface LineEdit { key: string; lease_id: string; month: string; values: Record<string, GridValue> }

/** Données de gestion locative nécessaires au calcul des lignes. */
export interface LedgerData { leases: Lease[]; charges: RentCharge[]; payments: Payment[]; allocations: Allocation[]; receipts: Receipt[] }

export type GridOp =
  | { op: 'cancelReceipt'; id: string; reason: string; lease_id: string; month: string; kind: Receipt['kind'] }
  | { op: 'updateCharge'; id: string; patch: Partial<RentCharge> }
  | { op: 'insertCharge'; row: Pick<RentCharge, 'lease_id' | 'kind' | 'period_start' | 'period_end' | 'due_date' | 'rent_amount' | 'charges_amount' | 'label'> }
  | { op: 'removeCharge'; id: string }
  | { op: 'updatePayment'; id: string; patch: Partial<Payment> }
  | { op: 'insertPayment'; row: Pick<Payment, 'lease_id' | 'amount' | 'paid_on' | 'period_month' | 'method' | 'source' | 'date_defaulted'> }
  | { op: 'removePayment'; id: string }
  | { op: 'removePaymentAllocations'; paymentId: string };

/** Ordre de traitement : bail par bail, du mois le plus ancien au plus récent. */
export const sortEdits = <E extends { lease_id: string; month: string }>(list: E[]): E[] =>
  [...list].sort((a, b) => a.lease_id.localeCompare(b.lease_id) || a.month.localeCompare(b.month));

/** Erreur de saisie détectée à la préparation d'une ligne (affichée telle quelle). */
export class GridEditError extends Error {}

const now = () => new Date().toISOString();
const monthLabelShort = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

/** Documents valables couvrant une somme réglée par ce paiement. */
export function receiptsCovering(p: Pick<Payment, 'id'>, d: Pick<LedgerData, 'allocations' | 'receipts'>): Receipt[] {
  const ids = new Set(d.allocations.filter((a) => a.payment_id === p.id).map((a) => a.charge_id));
  return d.receipts.filter((r) => !r.cancelled_at && (ids.has(r.charge_id) || (r.extra_lines ?? []).some((x) => ids.has(x.charge_id))));
}

/** Ligne affichée d'un bail et d'un mois, calculée sur les données fournies. */
export function rowOf(d: LedgerData, settings: LedgerSettings, today: string, lease_id: string, month: string): LedgerRow | null {
  return ledgerRows(d, settings, today).find((r) => r.lease_id === lease_id && r.month === month) ?? null;
}

/**
 * Opérations d'une ligne modifiée, sur des données à jour (reports des mois précédents déjà recalculés).
 * Le paiement complémentaire du statut « Réglé » est calculé par simulation, après les autres opérations.
 */
export function planLineEdit(d: LedgerData, edit: LineEdit, settings: LedgerSettings, today: string): GridOp[] {
  const row = rowOf(d, settings, today, edit.lease_id, edit.month);
  const name = `la ligne de ${monthLabelShort(edit.month)}`;
  if (!row?.loyer) throw new GridEditError(`${name[0]!.toUpperCase()}${name.slice(1)} n’existe plus : rechargez la page.`);
  const values = edit.values;
  const loyer = row.loyer;
  const ops: GridOp[] = [];

  // documents du mois (et ceux couvrant ses paiements) : annulés, réémis ensuite si le mois le permet encore
  const ids = new Set([loyer.id, ...row.others.map((c) => c.id), ...(row.report ? [row.report.id] : [])]);
  const docs = new Map<string, Receipt>();
  for (const r of d.receipts) if (!r.cancelled_at && (ids.has(r.charge_id) || (r.extra_lines ?? []).some((x) => ids.has(x.charge_id)))) docs.set(r.id, r);
  for (const p of row.payments) for (const r of receiptsCovering(p, d)) docs.set(r.id, r);
  for (const r of docs.values()) ops.push({ op: 'cancelReceipt', id: r.id, reason: 'Ligne modifiée dans la grille', lease_id: r.lease_id, month: r.period_start.slice(0, 7), kind: r.kind });

  // loyer, charges, échéance, réception
  const lp: Partial<RentCharge> = {};
  if ('due_date' in values) lp.due_date = String(values.due_date);
  if ('rent' in values) lp.rent_amount = round2(Number(values.rent ?? 0));
  if ('charges' in values) lp.charges_amount = round2(Number(values.charges ?? 0));
  if ('received' in values) lp.received_at = values.received === 'oui' ? now() : null;
  if (Object.keys(lp).length) ops.push({ op: 'updateCharge', id: loyer.id, patch: lp });

  // autre somme due (une seule par mois) : modifiée, créée ou retirée
  if ('other' in values || 'other_label' in values) {
    const o = row.others.length === 1 ? row.others[0]! : undefined;
    const amount = round2(Number(values.other ?? (o ? o.rent_amount + o.charges_amount : 0)));
    const text = 'other_label' in values ? (String(values.other_label ?? '').trim() || null) : o?.label ?? null;
    if (o) {
      if (amount === 0 && !d.allocations.some((a) => a.charge_id === o.id)) ops.push({ op: 'removeCharge', id: o.id });
      else ops.push({ op: 'updateCharge', id: o.id, patch: o.kind === 'regularisation' ? { rent_amount: 0, charges_amount: amount, label: text } : { rent_amount: amount, charges_amount: 0, label: text } });
    } else if (amount > 0) {
      ops.push({ op: 'insertCharge', row: { lease_id: loyer.lease_id, kind: 'autre', period_start: loyer.period_start, period_end: loyer.period_end, due_date: loyer.due_date,
        rent_amount: amount, charges_amount: 0, label: text ?? `Autre somme due ${monthLabelShort(edit.month)}` } });
    }
  }

  const status = 'status' in values ? String(values.status) : null;
  const sorted = [...row.payments].sort((a, b) => a.paid_on.localeCompare(b.paid_on) || a.created_at.localeCompare(b.created_at));
  if (status === 'impayee') {
    // « Impayé » : les paiements du mois sont supprimés
    for (const p of sorted) ops.push({ op: 'removePayment', id: p.id });
  } else if (sorted.length > 1 && 'paid_on' in values && values.paid_on) {
    // plusieurs paiements : la date de règlement est celle du dernier paiement du mois
    const last = sorted.at(-1)!;
    if (last.paid_on !== values.paid_on) ops.push({ op: 'updatePayment', id: last.id, patch: { paid_on: String(values.paid_on), period_month: `${edit.month}-01`, date_defaulted: false } });
  }
  // réglé et date de règlement (un seul paiement dans le mois) : paiement modifié, créé ou supprimé
  if (status !== 'impayee' && ('paid' in values || 'paid_on' in values) && sorted.length <= 1) {
    const p = sorted[0];
    const amount = round2(Number(values.paid ?? (p?.amount ?? 0)));
    const dueDate = String(values.due_date ?? loyer.due_date);
    const when = String(values.paid_on ?? p?.paid_on ?? (dueDate <= today ? dueDate : today));
    if (p) {
      ops.push({ op: 'removePaymentAllocations', paymentId: p.id });
      if (amount <= 0) ops.push({ op: 'removePayment', id: p.id });
      else ops.push({ op: 'updatePayment', id: p.id, patch: { amount, paid_on: when, period_month: `${edit.month}-01`, date_defaulted: false } });
    } else if (amount > 0) {
      ops.push({ op: 'insertPayment', row: { lease_id: loyer.lease_id, amount, paid_on: when, period_month: `${edit.month}-01`, method: 'virement', source: 'saisie', date_defaulted: false } });
    }
  }
  // « Réglé » : paiement du montant manquant, calculé après remise en conformité (reports à jour)
  if (status === 'reglee') {
    const sim = simulateLedger(applyOps(d, ops), [loyer.lease_id], settings, today);
    const r = rowOf(sim, settings, today, edit.lease_id, edit.month);
    const missing = r ? round2(r.due - (r.paid + r.advanceIn - r.advanceOut)) : 0;
    const dueDate = String(values.due_date ?? loyer.due_date);
    const when = String(values.paid_on ?? (dueDate <= today ? dueDate : today));
    if (missing > 0) ops.push({ op: 'insertPayment', row: { lease_id: loyer.lease_id, amount: missing, paid_on: when, period_month: `${edit.month}-01`, method: 'virement', source: 'saisie', date_defaulted: false } });
    if (settings.receivedMode === 'confirmation' && !('received' in values) && !loyer.received_at) ops.push({ op: 'updateCharge', id: loyer.id, patch: { received_at: now() } });
  }
  // « Annulé » : la ligne n'est plus due (réactivable depuis le tableau)
  if (status === 'annulee') ops.push({ op: 'updateCharge', id: loyer.id, patch: { cancelled_at: now(), cancel_reason: 'Annulé depuis la grille' } });
  return ops;
}

// ---------- Simulation en mémoire ----------
let simSeq = 0;
const simId = (p: string) => `sim:${p}:${++simSeq}`;
const SIM_TIME = '9999-12-31T00:00:00Z';

/** Applique des opérations sur une copie des données (aperçu). */
export function applyOps(d: LedgerData, ops: GridOp[]): LedgerData {
  let charges = [...d.charges], payments = [...d.payments], allocations = [...d.allocations], receipts = [...d.receipts];
  for (const o of ops) {
    switch (o.op) {
      case 'cancelReceipt': receipts = receipts.map((r) => (r.id === o.id ? { ...r, cancelled_at: now() } : r)); break;
      case 'updateCharge': charges = charges.map((c) => (c.id === o.id ? { ...c, ...o.patch } : c)); break;
      case 'insertCharge': charges.push({ id: simId('c'), user_id: '', version: 1, created_at: SIM_TIME, updated_at: SIM_TIME, cancelled_at: null, ...o.row } as RentCharge); break;
      case 'removeCharge': charges = charges.filter((c) => c.id !== o.id); allocations = allocations.filter((a) => a.charge_id !== o.id); break;
      case 'updatePayment': payments = payments.map((p) => (p.id === o.id ? { ...p, ...o.patch } : p)); break;
      case 'insertPayment': payments.push({ id: simId('p'), user_id: '', version: 1, created_at: SIM_TIME, updated_at: SIM_TIME, reference: null, comment: null, ...o.row } as Payment); break;
      case 'removePayment': payments = payments.filter((p) => p.id !== o.id); allocations = allocations.filter((a) => a.payment_id !== o.id); break;
      case 'removePaymentAllocations': allocations = allocations.filter((a) => a.payment_id !== o.paymentId); break;
    }
  }
  return { ...d, charges, payments, allocations, receipts };
}

/** Applique un plan de remise en conformité en mémoire (même effet que applyLedgerPlan en base). */
function applyPlanInMemory(d: LedgerData, plan: LedgerPlan): LedgerData {
  const delA = new Set(plan.deleteAllocations.map((a) => a.id));
  const delC = new Set(plan.deleteCharges.map((c) => c.id));
  let allocations = d.allocations.filter((a) => !delA.has(a.id));
  let charges = d.charges.filter((c) => !delC.has(c.id));
  const ids = new Map<string, string>();
  for (const x of plan.createCharges) ids.set(x.key, simId(`r:${x.row.lease_id}`));
  const ref = (r: string | null | undefined) => (r && r.startsWith('new:') ? ids.get(r) ?? null : r ?? null);
  for (const x of plan.createCharges) {
    charges.push({ ...(x.row as RentCharge), id: ids.get(x.key)!, user_id: '', version: 1, created_at: SIM_TIME, updated_at: SIM_TIME, carried_to: ref(x.row.carried_to) });
  }
  const patches = new Map(plan.updateCharges.map((u) => [u.charge.id, u.patch]));
  charges = charges.map((c) => {
    const p = patches.get(c.id);
    if (!p) return c;
    return { ...c, ...p, ...('carried_to' in p ? { carried_to: ref(p.carried_to) } : {}) } as RentCharge;
  });
  allocations = [...allocations, ...plan.createAllocations.map((a) => ({ id: simId('a'), user_id: '', payment_id: a.payment_id, charge_id: ref(a.charge)!, amount: a.amount, created_at: SIM_TIME }) as Allocation)];
  return { ...d, charges, allocations };
}

/** Remise en conformité simulée des baux indiqués (deux passes, comme en base). */
export function simulateLedger(d: LedgerData, leaseIds: string[], settings: LedgerSettings, today: string): LedgerData {
  let cur = d;
  for (let pass = 0; pass < 2; pass++) {
    let changed = false;
    for (const lease of cur.leases.filter((l) => leaseIds.includes(l.id))) {
      const plan = ledgerPlan({ lease, charges: cur.charges, payments: cur.payments, allocations: cur.allocations, receipts: cur.receipts, settings, today });
      if (plan.deleteAllocations.length || plan.deleteCharges.length || plan.createCharges.length || plan.updateCharges.length || plan.createAllocations.length) {
        cur = applyPlanInMemory(cur, plan);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return cur;
}

/**
 * Aperçu en direct : lignes recalculées comme après l'enregistrement de toutes les modifications
 * (dans l'ordre chronologique). Une ligne dont la saisie est invalide est ignorée.
 */
export function previewEdits(d: LedgerData, edits: LineEdit[], settings: LedgerSettings, today: string): Map<string, LedgerRow> {
  let cur = d;
  const leases = new Set<string>();
  for (const e of sortEdits(edits)) {
    try {
      cur = simulateLedger(applyOps(cur, planLineEdit(cur, e, settings, today)), [e.lease_id], settings, today);
      leases.add(e.lease_id);
    } catch { /* ligne introuvable : ignorée dans l'aperçu */ }
  }
  const out = new Map<string, LedgerRow>();
  if (!leases.size) return out;
  for (const r of ledgerRows(cur, settings, today)) if (leases.has(r.lease_id)) out.set(r.key, r);
  return out;
}
