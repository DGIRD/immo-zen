/**
 * Loyers et paiements : un seul tableau, une ligne par bail et par mois.
 * Expression de besoin du 29/10/2026 ; colonnes serveur : supabase/migrations/20261029000100_loyers_tableau_unique.sql.
 *
 * La ligne d'un mois regroupe ce qui est dû (loyer et charges du bail, autres sommes dues du mois,
 * reste dû reporté du mois précédent) et ce qui est réglé (paiements rattachés à ce mois).
 *
 * Règles :
 * - un paiement est rattaché au mois de sa date, sauf si l'utilisateur le déplace (period_month) ;
 *   il ne règle que les sommes de ce mois : d'abord le reste dû reporté, puis le loyer, puis les autres sommes ;
 * - plusieurs paiements d'un même mois s'additionnent ;
 * - un mois échu partiellement réglé : le reste dû est reporté dans « Autre somme due » du mois suivant
 *   (« Reste dû MM/AAAA ») et ne compte plus sur sa ligne d'origine ; en cascade, le cumul passe au mois suivant ;
 * - dernier mois du bail (pas de mois suivant) : le reste dû reste sur sa ligne ;
 * - excédent : trop-perçu sur sa ligne, ou avance déduite du mois suivant (excess_mode = 'avance') ;
 * - une somme couverte par une quittance n'est jamais modifiée.
 *
 * `ledgerPlan` calcule les écritures qui mettent un bail en conformité avec ces règles (idempotent : aucune
 * écriture quand tout est déjà conforme) ; `ledgerRows` construit les lignes affichées.
 */
import type { Allocation, Insert, Lease, Payment, Receipt, RentalSettings, RentCharge } from '../data/types.ts';
import { chargeTotal, monthOf } from './rental.ts';
import { round2 } from './simulator.ts';

// ---------- Mois (AAAA-MM) ----------
export function addMonths(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12 + 1;
  return `${yy}-${String(mm).padStart(2, '0')}`;
}
/** MM/AAAA */
export const mmYYYY = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;
/**
 * Mois de la ligne d'une somme due : le mois de la période pour un loyer ou un report, le mois d'exigibilité
 * pour une autre somme (un rappel de charges de l'année précédente figure sur la ligne du mois où il est exigé).
 */
export const chargeMonth = (c: Pick<RentCharge, 'kind' | 'period_start' | 'due_date'>) => (c.kind === 'loyer' || c.kind === 'report' ? c.period_start : c.due_date).slice(0, 7);
/** Mois de rattachement d'un paiement. */
export const paymentMonth = (p: Pick<Payment, 'paid_on' | 'period_month'>) => (p.period_month ?? p.paid_on).slice(0, 7);

/** Libellé de la ligne de report : « Reste dû 10/2026 » ou, en cascade, « Reste dû 09/2026 à 10/2026 ». */
export function reportLabel(from: string, to: string): string {
  return from === to ? `Reste dû ${mmYYYY(from)}` : `Reste dû ${mmYYYY(from)} à ${mmYYYY(to)}`;
}

// ---------- Réglages généraux ----------
export interface LedgerSettings {
  /** Colonne « Reçu » : automatique, ou cochée après confirmation de l'utilisateur. */
  receivedMode: 'auto' | 'confirmation';
  /** Point de départ des lignes : début de chaque bail, ou date choisie. */
  startMode: 'bail' | 'date';
  startDate: string | null;
}
export function ledgerSettings(rs: RentalSettings | null | undefined): LedgerSettings {
  const date = rs?.ledger_start_date && /^\d{4}-\d{2}-\d{2}$/.test(rs.ledger_start_date) ? rs.ledger_start_date : null;
  return { receivedMode: rs?.received_mode === 'confirmation' ? 'confirmation' : 'auto', startMode: rs?.ledger_start_mode === 'date' && date ? 'date' : 'bail', startDate: date };
}
/** Première date couverte par les lignes d'un bail (début du bail, ou date choisie si elle est postérieure). */
export function ledgerStart(lease: Pick<Lease, 'start_date'>, s: LedgerSettings): string {
  return s.startMode === 'date' && s.startDate && s.startDate > lease.start_date ? s.startDate : lease.start_date;
}

// ---------- Documents ----------
type ReceiptLike = Pick<Receipt, 'charge_id' | 'kind' | 'cancelled_at' | 'extra_lines'>;
/** Sommes couvertes par une quittance valable (directement ou en ligne supplémentaire). */
export function quittancedIds(receipts: ReceiptLike[]): Set<string> {
  const out = new Set<string>();
  for (const r of receipts) if (!r.cancelled_at && r.kind === 'quittance') { out.add(r.charge_id); for (const x of r.extra_lines ?? []) out.add(x.charge_id); }
  return out;
}

const byPaymentOrder = (a: Payment, b: Payment) => a.paid_on.localeCompare(b.paid_on) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
/** Ordre de règlement dans un mois : reste dû reporté (la dette la plus ancienne), loyer, autres sommes. */
const fillRank = (c: RentCharge) => (c.kind === 'report' ? 0 : c.kind === 'loyer' ? 1 : 2);
const byFillOrder = (a: RentCharge, b: RentCharge) => fillRank(a) - fillRank(b) || a.due_date.localeCompare(b.due_date) || a.id.localeCompare(b.id);

// ---------- Plan de mise en conformité d'un bail ----------
export interface LedgerInput {
  lease: Pick<Lease, 'id' | 'start_date' | 'end_date'>;
  charges: RentCharge[];
  payments: Payment[];
  allocations: Allocation[];
  receipts: (ReceiptLike & { id?: string })[];
  settings: LedgerSettings;
  today: string;
  /** Reprise : rétablir les loyers annulés sans motif dans la période du bail. */
  restoreCancelled?: boolean;
}

/** Référence d'une somme : id existant, ou clé d'une ligne de report à créer (« new:AAAA-MM »). */
export type ChargeRef = string;
export interface LedgerPlan {
  deleteAllocations: Allocation[];
  deleteCharges: RentCharge[];
  createCharges: { key: string; row: Insert<RentCharge> }[];
  updateCharges: { charge: RentCharge; patch: Partial<RentCharge> & { carried_to?: ChargeRef | null } }[];
  createAllocations: { payment_id: string; charge: ChargeRef; amount: number }[];
}
export const emptyPlan = (p: LedgerPlan) => !p.deleteAllocations.length && !p.deleteCharges.length && !p.createCharges.length && !p.updateCharges.length && !p.createAllocations.length;
export const planSize = (p: LedgerPlan) => p.deleteAllocations.length + p.deleteCharges.length + p.createCharges.length + p.updateCharges.length + p.createAllocations.length;

export function ledgerPlan(input: LedgerInput): LedgerPlan {
  const { lease, settings, today } = input;
  const cur = monthOf(today);
  const startMonth = monthOf(ledgerStart(lease, settings));
  const endMonth = lease.end_date ? monthOf(lease.end_date) : null;
  const charges = input.charges.filter((c) => c.lease_id === lease.id);
  const ids = new Set(charges.map((c) => c.id));
  const payments = input.payments.filter((p) => p.lease_id === lease.id).sort(byPaymentOrder);
  const allocations = input.allocations.filter((a) => ids.has(a.charge_id));
  const quittanced = quittancedIds(input.receipts);
  const withReceipt = new Set(input.receipts.map((r) => r.charge_id));
  const frozen = allocations.filter((a) => quittanced.has(a.charge_id));
  const movable = allocations.filter((a) => !quittanced.has(a.charge_id));

  const plan: LedgerPlan = { deleteAllocations: [], deleteCharges: [], createCharges: [], updateCharges: [], createAllocations: [] };
  const patches = new Map<string, Partial<RentCharge> & { carried_to?: ChargeRef | null }>();
  const patch = (c: RentCharge, p: Partial<RentCharge> & { carried_to?: ChargeRef | null }) => patches.set(c.id, { ...(patches.get(c.id) ?? {}), ...p });

  // 1. loyers hors période (avant le point de départ, après la fin du bail) : supprimés s'ils n'ont aucun document
  const inRange = (m: string) => m >= startMonth && (!endMonth || m <= endMonth);
  const removed = new Set<string>();
  for (const c of charges) {
    if (c.kind !== 'loyer' || inRange(monthOf(c.period_start)) || quittanced.has(c.id) || withReceipt.has(c.id)) continue;
    removed.add(c.id);
    plan.deleteCharges.push(c);
  }
  // 2. reprise : loyers annulés sans motif dans la période, rétablis
  const restored = new Set<string>();
  if (input.restoreCancelled) for (const c of charges) {
    if (c.kind === 'loyer' && c.cancelled_at && !c.cancel_reason?.trim() && !removed.has(c.id) && inRange(monthOf(c.period_start)) && monthOf(c.period_start) <= cur
      && !charges.some((x) => x !== c && x.kind === 'loyer' && !x.cancelled_at && x.period_start === c.period_start)) {
      restored.add(c.id);
      patch(c, { cancelled_at: null, cancel_reason: null });
    }
  }
  const active = charges.filter((c) => !removed.has(c.id) && (!c.cancelled_at || restored.has(c.id)));

  // 3. groupes par mois
  const groups = new Map<string, RentCharge[]>();
  for (const c of active) { const m = chargeMonth(c); groups.set(m, [...(groups.get(m) ?? []), c]); }
  const hasLoyer = (m: string) => (groups.get(m) ?? []).some((c) => c.kind === 'loyer');
  const paysByMonth = new Map<string, Payment[]>();
  for (const p of payments) { const m = paymentMonth(p); paysByMonth.set(m, [...(paysByMonth.get(m) ?? []), p]); }

  // montants libres de chaque paiement (hors parts figées par une quittance) et place restante de chaque somme
  const free = new Map(payments.map((p) => [p.id, round2(p.amount - frozen.filter((a) => a.payment_id === p.id).reduce((s, a) => s + a.amount, 0))]));
  const desired = new Map<string, number>(); // `${payment}|${charge ref}` → montant
  const give = (pid: string, ref: ChargeRef, amount: number) => { const k = `${pid}|${ref}`; desired.set(k, round2((desired.get(k) ?? 0) + amount)); };

  // lignes de report : existantes (une par mois au plus) et souhaitées
  const reportOf = new Map<string, RentCharge>();
  for (const c of active) if (c.kind === 'report') { const m = monthOf(c.period_start); if (!reportOf.has(m)) reportOf.set(m, c); else { plan.deleteCharges.push(c); removed.add(c.id); } }

  const months = [...new Set([...groups.keys(), ...paysByMonth.keys()])].sort();
  /** Reste dû à reporter sur le mois `to` ; `from` = mois d'origine le plus ancien encore dû. */
  let carry = null as { amount: number; from: string; to: string } | null;
  /** Excédent du mois précédent à déduire du mois `to`. */
  let advance = null as { to: string; list: { pid: string; amount: number }[] } | null;
  const carriedTo = new Map<string, ChargeRef | null>();
  const keptReports = new Set<string>();

  for (const m of months) {
    const incoming: { amount: number; from: string; to: string } | null = carry && carry.to === m ? carry : null;
    const own = (groups.get(m) ?? []).filter((c) => c.kind !== 'report' && !removed.has(c.id));
    const loyer = own.find((c) => c.kind === 'loyer') ?? null;
    const existing = reportOf.get(m) ?? null;
    let reportRef: ChargeRef | null = null;
    let reportRoom = 0;
    let reportFrom: string | null = null;
    if (existing && quittanced.has(existing.id)) {
      // report déjà quittancé : figé
      reportRef = existing.id; keptReports.add(existing.id);
      reportFrom = existing.carry_from?.slice(0, 7) ?? addMonths(m, -1);
      reportRoom = 0;
    } else if (incoming && loyer) {
      const label = reportLabel(incoming.from, addMonths(m, -1));
      reportFrom = incoming.from;
      if (existing) {
        reportRef = existing.id; keptReports.add(existing.id);
        const p: Partial<RentCharge> = {};
        if (round2(existing.rent_amount) !== incoming.amount || existing.charges_amount !== 0) { p.rent_amount = incoming.amount; p.charges_amount = 0; }
        if (existing.label !== label) p.label = label;
        if ((existing.carry_from ?? null) !== `${incoming.from}-01`) p.carry_from = `${incoming.from}-01`;
        if (Object.keys(p).length) patch(existing, p);
      } else {
        reportRef = `new:${m}`;
        plan.createCharges.push({ key: reportRef, row: {
          lease_id: lease.id, kind: 'report', period_start: loyer.period_start, period_end: loyer.period_end, due_date: loyer.due_date,
          rent_amount: incoming.amount, charges_amount: 0, label, carry_from: `${incoming.from}-01`, cancelled_at: null,
        } });
      }
      reportRoom = incoming.amount;
    }
    if (existing && !keptReports.has(existing.id) && !removed.has(existing.id)) {
      // report devenu inutile (reste dû réglé entre-temps) : supprimé
      removed.add(existing.id); plan.deleteCharges.push(existing);
    }

    // places restantes : report (dette la plus ancienne), loyer, autres sommes du mois
    const slots: { ref: ChargeRef; room: number; charge: RentCharge | null }[] = [];
    if (reportRef) slots.push({ ref: reportRef, room: reportRoom, charge: existing && reportRef === existing.id ? existing : null });
    for (const c of [...own].sort(byFillOrder)) {
      const room = round2(chargeTotal(c) - frozen.filter((a) => a.charge_id === c.id).reduce((s, a) => s + a.amount, 0));
      slots.push({ ref: c.id, room: quittanced.has(c.id) ? 0 : Math.max(0, room), charge: c });
    }
    const fill = (pid: string, amount: number): number => {
      let left = round2(amount);
      for (const s of slots) {
        if (left <= 0) break;
        if (s.room <= 0) continue;
        const a = round2(Math.min(left, s.room));
        give(pid, s.ref, a);
        s.room = round2(s.room - a);
        left = round2(left - a);
      }
      return left;
    };
    // avance du mois précédent, puis paiements du mois
    const leftovers: { pid: string; amount: number }[] = [];
    if (advance && advance.to === m) for (const x of advance.list) { const l = fill(x.pid, x.amount); if (l > 0) leftovers.push({ pid: x.pid, amount: l }); }
    for (const p of paysByMonth.get(m) ?? []) {
      const f = free.get(p.id) ?? 0;
      if (f <= 0) continue;
      const l = fill(p.id, f);
      if (l > 0) leftovers.push({ pid: p.id, amount: l });
    }
    const remaining = round2(slots.reduce((s, x) => s + x.room, 0));
    const next = addMonths(m, 1);
    // report : mois échu, et un loyer existe le mois suivant (sinon, dernier mois du bail : reste dû sur sa ligne)
    const canCarry = m < cur && hasLoyer(next) && inRange(next) && remaining > 0;
    const nextExisting = reportOf.get(next);
    const nextRef = canCarry ? (nextExisting && !removed.has(nextExisting.id) ? nextExisting.id : `new:${next}`) : null;
    for (const s of slots) carriedTo.set(s.charge ? s.charge.id : s.ref, canCarry && s.room > 0 ? nextRef : null);
    const reportStillDue = !!reportRef && slots[0]!.ref === reportRef && slots[0]!.room > 0;
    carry = canCarry ? { amount: remaining, from: reportStillDue && reportFrom ? reportFrom : m, to: next } : null;
    advance = loyer?.excess_mode === 'avance' && leftovers.length ? { to: next, list: leftovers } : null;
  }

  // 4. affectations : celles qui changent
  const current = new Map<string, Allocation[]>();
  for (const a of movable) { const k = `${a.payment_id}|${a.charge_id}`; current.set(k, [...(current.get(k) ?? []), a]); }
  for (const [k, list] of current) {
    const want = desired.get(k);
    const have = round2(list.reduce((s, a) => s + a.amount, 0));
    if (want !== undefined && want === have && list.length === 1) { desired.delete(k); continue; }
    plan.deleteAllocations.push(...list);
  }
  for (const a of movable) if (removed.has(a.charge_id) && !plan.deleteAllocations.includes(a)) plan.deleteAllocations.push(a);
  for (const [k, amount] of desired) {
    if (amount <= 0) continue;
    const [payment_id, charge] = k.split('|') as [string, string];
    plan.createAllocations.push({ payment_id, charge, amount });
  }

  // 5. marques de report sur les sommes d'origine
  for (const c of active) {
    if (removed.has(c.id)) continue;
    const want = carriedTo.get(c.id) ?? null;
    if ((c.carried_to ?? null) !== want) patch(c, { carried_to: want });
  }
  for (const pc of plan.createCharges) { const want = carriedTo.get(pc.key) ?? null; if (want) pc.row.carried_to = want; }
  for (const [id, p] of patches) { const c = charges.find((x) => x.id === id)!; plan.updateCharges.push({ charge: c, patch: p }); }
  return plan;
}

// ---------- Lignes affichées ----------
export type RowStatus = 'reglee' | 'partielle' | 'reportee' | 'impayee' | 'a_venir' | 'annulee' | 'hors_periode';
export const ROW_STATUS_LABELS: Record<RowStatus, string> = {
  reglee: 'Réglé', partielle: 'Partiel', reportee: 'Partiel reporté', impayee: 'Impayé', a_venir: 'À venir', annulee: 'Annulé', hors_periode: 'Hors période',
};

export interface LedgerRow {
  key: string;
  lease_id: string;
  /** AAAA-MM */
  month: string;
  loyer: RentCharge | null;
  /** Autres sommes dues du mois (régularisation, autre). */
  others: RentCharge[];
  /** Reste dû reporté du mois précédent. */
  report: RentCharge | null;
  rent: number;
  charges: number;
  other: number;
  carryIn: number;
  due: number;
  /** Somme des paiements rattachés au mois. */
  paid: number;
  payments: Payment[];
  lastPaidOn: string | null;
  /** Montant affecté aux sommes du mois (y compris une avance du mois précédent). */
  allocated: number;
  /** Part des paiements du mois affectée au mois suivant (avance). */
  advanceOut: number;
  /** Part réglée par l'avance du mois précédent. */
  advanceIn: number;
  /** Réglé − dû, avance comprise : négatif = reste dû, positif = trop-perçu. */
  gap: number;
  /** Reste dû reporté sur le mois suivant. */
  carriedOut: number;
  status: RowStatus;
  received: 'oui' | 'partiel' | 'non';
  /** Mode confirmation : paiement reçu, réception à confirmer. */
  toConfirm: boolean;
  /** Excédent reçu dont la nature reste à choisir (autre somme due, loyer supérieur, trop-perçu). */
  excessToQualify: boolean;
  quittance: Receipt | null;
  recus: Receipt[];
  cancelledDocs: Receipt[];
}

export function ledgerRows(d: { charges: RentCharge[]; payments: Payment[]; allocations: Allocation[]; receipts: Receipt[]; leases: Pick<Lease, 'id' | 'start_date' | 'end_date'>[] },
  settings: LedgerSettings, today: string): LedgerRow[] {
  const cur = monthOf(today);
  const leaseIds = new Set(d.leases.map((l) => l.id));
  const chargeById = new Map(d.charges.map((c) => [c.id, c]));
  const payById = new Map(d.payments.map((p) => [p.id, p]));
  const groups = new Map<string, RentCharge[]>();
  for (const c of d.charges) {
    if (!leaseIds.has(c.lease_id)) continue;
    if (c.cancelled_at && c.kind !== 'loyer') continue;
    const k = `${c.lease_id}|${chargeMonth(c)}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const pays = new Map<string, Payment[]>();
  for (const p of d.payments) { if (!leaseIds.has(p.lease_id)) continue; const k = `${p.lease_id}|${paymentMonth(p)}`; pays.set(k, [...(pays.get(k) ?? []), p]); }
  const allocByCharge = new Map<string, Allocation[]>();
  for (const a of d.allocations) allocByCharge.set(a.charge_id, [...(allocByCharge.get(a.charge_id) ?? []), a]);
  const allocByPay = new Map<string, Allocation[]>();
  for (const a of d.allocations) allocByPay.set(a.payment_id, [...(allocByPay.get(a.payment_id) ?? []), a]);
  const out: LedgerRow[] = [];
  for (const k of new Set([...groups.keys(), ...pays.keys()])) {
    const [lease_id, month] = k.split('|') as [string, string];
    const list = groups.get(k) ?? [];
    const loyers = list.filter((c) => c.kind === 'loyer');
    const loyer = loyers.find((c) => !c.cancelled_at) ?? loyers[0] ?? null;
    const others = list.filter((c) => c.kind === 'regularisation' || c.kind === 'autre');
    const report = list.find((c) => c.kind === 'report') ?? null;
    const activeCharges = [...(loyer && !loyer.cancelled_at ? [loyer] : []), ...others, ...(report ? [report] : [])];
    const ids = new Set(activeCharges.map((c) => c.id));
    const rent = loyer && !loyer.cancelled_at ? loyer.rent_amount : 0;
    const charges = loyer && !loyer.cancelled_at ? loyer.charges_amount : 0;
    const other = round2(others.reduce((s, c) => s + chargeTotal(c), 0));
    const carryIn = report ? chargeTotal(report) : 0;
    const due = round2(rent + charges + other + carryIn);
    const monthPays = (pays.get(k) ?? []).sort(byPaymentOrder);
    const paid = round2(monthPays.reduce((s, p) => s + p.amount, 0));
    const allocs = activeCharges.flatMap((c) => allocByCharge.get(c.id) ?? []);
    const allocated = round2(allocs.reduce((s, a) => s + a.amount, 0));
    const advanceIn = round2(allocs.filter((a) => { const p = payById.get(a.payment_id); return p && paymentMonth(p) !== month; }).reduce((s, a) => s + a.amount, 0));
    const advanceOut = round2(monthPays.flatMap((p) => allocByPay.get(p.id) ?? []).filter((a) => { const c = chargeById.get(a.charge_id); return c && !ids.has(c.id) && chargeMonth(c) !== month; }).reduce((s, a) => s + a.amount, 0));
    const carried = activeCharges.filter((c) => c.carried_to);
    const carriedOut = round2(carried.reduce((s, c) => s + Math.max(0, chargeTotal(c) - (allocByCharge.get(c.id) ?? []).reduce((x, a) => x + a.amount, 0)), 0));
    const gap = round2(paid + advanceIn - advanceOut - due);
    const lease = d.leases.find((l) => l.id === lease_id);
    let status: RowStatus;
    if (!activeCharges.length) status = loyer?.cancelled_at ? 'annulee' : 'hors_periode';
    else if (due > 0 && allocated >= due) status = 'reglee';
    else if (due <= 0) status = 'reglee';
    else if (month > cur || (month === cur && allocated === 0 && (loyer?.due_date ?? `${month}-01`) > today)) status = 'a_venir';
    else if (carried.length) status = 'reportee';
    else if (allocated > 0) status = 'partielle';
    else status = 'impayee';
    void lease;
    const docs = d.receipts.filter((r) => ids.has(r.charge_id) || (loyer && r.charge_id === loyer.id) || (r.extra_lines ?? []).some((x) => ids.has(x.charge_id)));
    const valid = docs.filter((r) => !r.cancelled_at);
    const quittance = valid.find((r) => r.kind === 'quittance' && (r.charge_id === loyer?.id || ids.has(r.charge_id))) ?? null;
    const paidSome = allocated > 0 || paid > 0;
    const confirmed = !!loyer?.received_at;
    const received: LedgerRow['received'] = settings.receivedMode === 'confirmation'
      ? (!confirmed ? 'non' : status === 'reglee' ? 'oui' : 'partiel')
      : (status === 'reglee' && due > 0 ? 'oui' : status === 'reglee' ? (paidSome ? 'oui' : 'non') : allocated > 0 ? 'partiel' : 'non');
    out.push({
      key: k, lease_id, month, loyer, others, report, rent, charges, other, carryIn, due, paid, payments: monthPays,
      lastPaidOn: monthPays.length ? monthPays[monthPays.length - 1]!.paid_on : null,
      allocated, advanceOut, advanceIn, gap, carriedOut, status, received,
      toConfirm: settings.receivedMode === 'confirmation' && !confirmed && paidSome && !!loyer && !loyer.cancelled_at,
      excessToQualify: gap > 0 && !!loyer && !loyer.cancelled_at && !loyer.excess_mode && !quittance,
      quittance, recus: valid.filter((r) => r.kind === 'recu'), cancelledDocs: docs.filter((r) => r.cancelled_at),
    });
  }
  return out.sort((a, b) => b.month.localeCompare(a.month) || a.lease_id.localeCompare(b.lease_id));
}

/**
 * Quittance du mois : possible quand le loyer et toutes les autres sommes du mois (reste dû reporté compris)
 * sont intégralement réglés. Les autres sommes figurent en lignes distinctes (« Reste dû MM/AAAA réglé »).
 */
export function monthQuittance(row: LedgerRow, allocations: Allocation[], receipts: ReceiptLike[]): { chargeId: string; extras: string[] } | null {
  if (!row.loyer || row.loyer.cancelled_at || row.quittance || row.status !== 'reglee') return null;
  const q = quittancedIds(receipts);
  if (q.has(row.loyer.id)) return null;
  const paidOf = (c: RentCharge) => round2(allocations.filter((a) => a.charge_id === c.id).reduce((s, a) => s + a.amount, 0));
  const extras = [...row.others, ...(row.report ? [row.report] : [])].filter((c) => !c.cancelled_at && !q.has(c.id));
  if (paidOf(row.loyer) < chargeTotal(row.loyer) || extras.some((c) => paidOf(c) < chargeTotal(c))) return null;
  return { chargeId: row.loyer.id, extras: extras.filter((c) => chargeTotal(c) > 0).map((c) => c.id) };
}

/** Qualification d'un excédent reçu sur un mois. */
export type ExcessChoice = 'autre' | 'loyer' | 'trop_percu';
export const EXCESS_LABELS: Record<ExcessChoice, string> = {
  autre: 'Autre somme due', loyer: 'Loyer supérieur', trop_percu: 'Trop-perçu',
};
