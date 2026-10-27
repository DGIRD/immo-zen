/**
 * Import en masse de loyers encaissés (Excel .xlsx, CSV ou copier-coller).
 * Colonnes reconnues (ordre libre) : Date · Montant · Locataire · Appartement (ou Bien, Adresse) · Moyen · Référence (ou Libellé) · Commentaire.
 * Chaque ligne devient un paiement du bail retrouvé, affecté à l'échéance du mois de sa date ; les paiements
 * d'un même mois sont additionnés et la quittance de ce mois est proposée.
 */
import type { Insert, Lease, LeaseTenant, Payment, PaymentMethod, Property, Receipt, Tenant } from '../data/types.ts';
import { lineHash, matchProperty, norm, parseAmount, parseDate, type Cell } from './importing.ts';
import { allocateByMonth, applyPlan, eur, leaseTenants, monthlyTotals, tenantName, type ChargeView, type MonthSummary } from './rental.ts';
import { round2 } from './simulator.ts';

export const RENT_IMPORT_COLUMNS = ['Date', 'Montant', 'Locataire', 'Appartement', 'Moyen', 'Référence', 'Commentaire'] as const;
type Field = 'date' | 'amount' | 'tenant' | 'property' | 'method' | 'reference' | 'comment';
const HEADERS: [Field, RegExp][] = [
  ['date', /^date/],
  ['amount', /^montant|^somme|^credit/],
  ['tenant', /^locataire|^payeur|^nom/],
  ['property', /^appartement|^bien|^logement|^adresse|^lot/],
  ['method', /^moyen|^mode|^type de paiement/],
  ['reference', /^reference|^libelle|^intitule|^operation/],
  ['comment', /^commentaire|^note|^remarque/],
];

export function detectRentColumns(rows: Cell[][]): { header: number; map: Partial<Record<Field, number>> } | null {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const map: Partial<Record<Field, number>> = {};
    rows[r]!.forEach((c, i) => {
      if (typeof c !== 'string') return;
      const n = norm(c);
      for (const [f, re] of HEADERS) if (map[f] === undefined && re.test(n)) { map[f] = i; break; }
    });
    if (map.date !== undefined && map.amount !== undefined) return { header: r, map };
  }
  return null;
}

export function matchMethod(v: Cell): PaymentMethod {
  const n = norm(String(v ?? ''));
  if (/prel/.test(n)) return 'prelevement';
  if (/cheque|chq/.test(n)) return 'cheque';
  if (/espece|cash|liquide/.test(n)) return 'especes';
  if (/caf|apl|aide/.test(n)) return 'caf';
  if (!n || /vir/.test(n)) return 'virement';
  return 'autre';
}

export interface RentImportRow {
  line: number;
  date: string | null;
  amount: number | null;
  rawTenant: string | null;
  rawProperty: string | null;
  leaseId: string | null;
  method: PaymentMethod;
  reference: string | null;
  comment: string | null;
  ref: string;
  errors: string[];
}

interface Ctx { leases: Lease[]; properties: Property[]; links: LeaseTenant[]; tenants: Tenant[] }

const activeAt = (l: Lease, d: string | null) => !d || (l.start_date <= d && (!l.end_date || l.end_date >= d));

/** Bail d'après le locataire et/ou le logement, en vigueur à la date du paiement. */
export function matchLease(rawTenant: string | null, rawProperty: string | null, date: string | null, c: Ctx): string | null {
  let candidates = c.leases.filter((l) => activeAt(l, date));
  if (!candidates.length) candidates = c.leases;
  if (rawProperty) {
    const pid = matchProperty(rawProperty, c.properties.filter((p) => p.status === 'acquis'));
    if (pid) candidates = candidates.filter((l) => l.property_id === pid);
    else if (!rawTenant) return null;
  }
  if (rawTenant) {
    const words = norm(rawTenant).split(' ').filter((w) => w.length > 1);
    const scored = candidates.map((l) => {
      const names = norm(leaseTenants(l.id, c.links, c.tenants, false).map(tenantName).join(' ') + ' ' + (l.label ?? ''));
      return { l, score: words.filter((w) => names.split(' ').includes(w)).length };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
    if (scored.length && (scored.length === 1 || scored[0]!.score > scored[1]!.score)) return scored[0]!.l.id;
    if (!rawProperty) return null;
  }
  return candidates.length === 1 ? candidates[0]!.id : null;
}

export function buildRentImportRows(rows: Cell[][], c: Ctx): { rows: RentImportRow[]; error?: string } {
  const det = detectRentColumns(rows);
  if (!det) return { rows: [], error: 'En-têtes introuvables : la première ligne doit contenir au moins « Date » et « Montant ».' };
  const get = (r: Cell[], f: Field): Cell => (det.map[f] === undefined ? null : r[det.map[f]!] ?? null);
  const str = (v: Cell) => (v === null ? null : String(v).replace(/\s+/g, ' ').trim() || null);
  const seen = new Map<string, number>();
  const out: RentImportRow[] = [];
  rows.slice(det.header + 1).forEach((r, i) => {
    const errors: string[] = [];
    const date = parseDate(get(r, 'date'));
    const amount = parseAmount(get(r, 'amount'));
    if (!date) errors.push('date illisible');
    if (amount === null) errors.push('montant illisible');
    const rawTenant = str(get(r, 'tenant'));
    const rawProperty = str(get(r, 'property'));
    const reference = str(get(r, 'reference'));
    const leaseId = c.leases.length === 1 ? c.leases[0]!.id : matchLease(rawTenant, rawProperty, date, c);
    const base = lineHash([date, amount, norm(rawTenant ?? ''), norm(rawProperty ?? ''), norm(reference ?? '')].join('|'));
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.push({
      line: det.header + i + 2, date, amount, rawTenant, rawProperty, leaseId, method: matchMethod(get(r, 'method')),
      reference: reference?.slice(0, 120) ?? null, comment: str(get(r, 'comment'))?.slice(0, 500) ?? null, ref: `loy:${base}:${n}`, errors,
    });
  });
  return { rows: out };
}

export type RentRowStatus = 'ok' | 'doublon' | 'incomplet' | 'signe';
export function rentRowStatus(r: RentImportRow, existing: Set<string>): { status: RentRowStatus; message: string } {
  if (existing.has(r.ref)) return { status: 'doublon', message: 'Déjà importé' };
  if (!r.date || r.amount === null) return { status: 'incomplet', message: r.errors.join(', ') };
  if (r.amount <= 0) return { status: 'signe', message: 'Montant négatif ou nul : non importé' };
  if (!r.leaseId) return { status: 'incomplet', message: 'Bail à choisir' };
  return { status: 'ok', message: 'Paiement' };
}

export function toPayment(r: RentImportRow): Insert<Payment> & { import_ref: string } {
  return {
    lease_id: r.leaseId!, amount: round2(r.amount!), paid_on: r.date!, method: r.method, reference: r.reference,
    comment: r.comment, source: 'import', date_defaulted: false, import_ref: r.ref,
  };
}

/**
 * Répartition de plusieurs paiements d'un même bail, du plus ancien au plus récent :
 * chacun règle d'abord l'échéance du mois de sa date, puis les arriérés ; l'excédent reste en avance.
 */
export function planAllocations(payments: { key: string; amount: number; paid_on: string }[], open: ChargeView[], from?: string): Map<string, { charge_id: string; amount: number }[]> {
  let views = open;
  const out = new Map<string, { charge_id: string; amount: number }[]>();
  for (const p of [...payments].sort((a, b) => a.paid_on.localeCompare(b.paid_on))) {
    const plan = allocateByMonth(p.amount, p.paid_on, views, from);
    views = applyPlan(views, plan.allocations);
    out.set(p.key, plan.allocations);
  }
  return out;
}

/**
 * quittance : mois intégralement réglé ;
 * aligner : mois réglé pour moins que l'échéance — le paiement fait foi, l'échéance est ramenée
 * au montant payé puis quittancée (ou, au choix, reçu partiel) ;
 * deja : quittance déjà émise ; aucune : rien à émettre.
 */
export type MonthReceiptAction = 'quittance' | 'aligner' | 'deja' | 'aucune';
export interface MonthProposal extends MonthSummary {
  /** Total réglé sur l'échéance du mois après l'import. */
  paidAfter: number;
  /** Document proposé pour le mois. */
  action: MonthReceiptAction;
  /** Pour « aligner » : mois échu (quittance au montant payé proposée par défaut) ; sinon reçu partiel. */
  past: boolean;
  message: string;
}

/**
 * Après import : paiements additionnés par bail et par mois de paiement, avec la quittance
 * (période intégralement réglée) ou le reçu partiel proposé pour ce mois.
 */
export function monthProposals(rows: RentImportRow[], views: ChargeView[], receipts: Pick<Receipt, 'charge_id' | 'kind' | 'cancelled_at' | 'extra_lines'>[], leases: Pick<Lease, 'id' | 'start_date'>[], today = new Date().toISOString().slice(0, 10)): MonthProposal[] {
  const ok = rows.filter((r) => r.leaseId && r.date && r.amount !== null && r.amount > 0);
  const after = new Map<string, ChargeView[]>();
  for (const l of leases) {
    const list = ok.filter((r) => r.leaseId === l.id);
    if (!list.length) continue;
    const own = views.filter((v) => v.charge.lease_id === l.id && !v.charge.cancelled_at);
    const plans = planAllocations(list.map((r) => ({ key: r.ref, amount: r.amount!, paid_on: r.date! })), own.filter((v) => v.remaining > 0), l.start_date);
    after.set(l.id, applyPlan(own, [...plans.values()].flat()));
  }
  const quittanced = (id: string) => receipts.some((r) => r.kind === 'quittance' && !r.cancelled_at && (r.charge_id === id || (r.extra_lines ?? []).some((x) => x.charge_id === id)));
  return monthlyTotals(ok.map((r) => ({ lease_id: r.leaseId!, paid_on: r.date!, amount: r.amount! })), views).map((m) => {
    const v = m.charge ? (after.get(m.lease_id) ?? []).find((x) => x.charge.id === m.charge!.charge.id) ?? m.charge : null;
    const past = m.month < today.slice(0, 7);
    if (!v) return { ...m, past, paidAfter: 0, action: 'aucune' as const, message: 'Aucune échéance ce mois-là : montant gardé en avance ou affecté aux arriérés' };
    if (quittanced(v.charge.id)) return { ...m, past, paidAfter: v.paid, action: 'deja' as const, message: 'Quittance déjà émise' };
    if (v.remaining <= 0) return { ...m, past, paidAfter: v.paid, action: 'quittance' as const, message: 'Mois intégralement réglé' };
    if (v.paid > 0) return { ...m, past, paidAfter: v.paid, action: 'aligner' as const, message: `Payé ${eur(v.paid)} € pour ${eur(v.total)} € dus` };
    return { ...m, past, paidAfter: 0, action: 'aucune' as const, message: 'Échéance du mois non réglée' };
  });
}
