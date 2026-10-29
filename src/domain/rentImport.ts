/**
 * Import en masse de loyers encaissés : relevé bancaire Excel (.xlsx), CSV ou copier-coller.
 * Colonnes reconnues (ordre libre) : Date · Montant · Locataire · Appartement (ou Bien, Adresse) · Moyen · Référence (ou Libellé) · Commentaire.
 * Chaque ligne devient un paiement du bail retrouvé, rattaché au mois de sa date (ou au mois choisi dans l'aperçu) :
 * l'import remplit la colonne « Réglé » de la ligne de ce mois. Les paiements d'un même mois sont additionnés ;
 * un excédent est qualifié par l'utilisateur (autre somme due, loyer supérieur ou trop-perçu).
 */
import type { Insert, Lease, LeaseTenant, Payment, PaymentMethod, Property, Tenant } from '../data/types.ts';
import { lineHash, matchProperty, norm, parseAmount, parseDate, type Cell } from './importing.ts';
import type { LedgerRow } from './ledger.ts';
import { leaseTenants, tenantName } from './rental.ts';
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
  /** Mois choisi dans l'aperçu (AAAA-MM) ; à défaut, le mois de la date. */
  month?: string | null;
  ref: string;
  errors: string[];
}

/** Mois de rattachement d'une ligne importée. */
export const importMonth = (r: Pick<RentImportRow, 'date' | 'month'>) => r.month ?? r.date?.slice(0, 7) ?? null;

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
    lease_id: r.leaseId!, amount: round2(r.amount!), paid_on: r.date!, period_month: `${importMonth(r)}-01`, method: r.method, reference: r.reference,
    comment: r.comment, source: 'import', date_defaulted: false, import_ref: r.ref,
  };
}

/** Récapitulatif d'un mois après import : la colonne « Réglé » avant et après, l'écart. */
export interface ImportMonth {
  lease_id: string;
  /** AAAA-MM */
  month: string;
  /** Somme des lignes importées pour ce mois. */
  received: number;
  count: number;
  row: LedgerRow | null;
  due: number;
  /** Réglé avant l'import (avance comprise). */
  before: number;
  after: number;
  /** Excédent après import (réglé − dû), à qualifier. */
  over: number;
  /** Mois intégralement réglé après import : quittance proposée. */
  settles: boolean;
}

/** Lignes prêtes additionnées par bail et par mois, rapprochées des lignes mensuelles existantes. */
export function importMonths(rows: RentImportRow[], ledger: LedgerRow[]): ImportMonth[] {
  const by = new Map<string, ImportMonth>();
  for (const r of rows) {
    const month = importMonth(r);
    if (!r.leaseId || !month || r.amount === null || !(r.amount > 0)) continue;
    const k = `${r.leaseId}|${month}`;
    let m = by.get(k);
    if (!m) {
      const row = ledger.find((x) => x.lease_id === r.leaseId && x.month === month) ?? null;
      const before = row ? round2(row.paid + row.advanceIn - row.advanceOut) : 0;
      m = { lease_id: r.leaseId, month, received: 0, count: 0, row, due: row?.due ?? 0, before, after: before, over: 0, settles: false };
      by.set(k, m);
    }
    m.received = round2(m.received + r.amount);
    m.count++;
    m.after = round2(m.before + m.received);
    m.over = m.row?.loyer ? Math.max(0, round2(m.after - m.due)) : 0;
    m.settles = !!m.row?.loyer && !m.row.quittance && m.due > 0 && m.after >= m.due;
  }
  return [...by.values()].sort((a, b) => a.month.localeCompare(b.month) || a.lease_id.localeCompare(b.lease_id));
}
