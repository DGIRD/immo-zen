/**
 * Gestion locative : fonctions pures (échéancier, statuts, soldes, répartition des paiements).
 * Référence serveur : supabase/migrations/20261014000200_lot2_gestion_locative.sql.
 * Le serveur est la source de vérité ; ces fonctions servent à l'affichage, au mode
 * démonstration et aux tests. Les montants sont arrondis au centime.
 */
import type { Allocation, Expense, Lease, LeaseTenant, Payment, Receipt, RentCharge, Tenant } from '../data/types.ts';
import { round2 } from './simulator.ts';

// ---------- Dates (AAAA-MM-JJ, sans fuseau) ----------
export const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y!, m!, d!];
}
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export function addDays(date: string, n: number): string {
  const [y, m, d] = parts(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
export const dayDiff = (a: string, b: string) => {
  const [y1, m1, d1] = parts(a);
  const [y2, m2, d2] = parts(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
};
const minDate = (a: string, b: string) => (a < b ? a : b);
const maxDate = (a: string, b: string) => (a > b ? a : b);

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export function monthLabel(date: string): string {
  const [y, m] = parts(date);
  return `${MONTHS[m - 1]} ${y}`;
}

// ---------- Échéancier ----------
export interface PlannedCharge {
  period_start: string;
  period_end: string;
  due_date: string;
  rent_amount: number;
  charges_amount: number;
}

/**
 * Échéances mensuelles d'un bail jusqu'à `until` inclus (même règle que iz_generate_rent_charges) :
 * prorata au nombre de jours calendaires du mois pour un mois incomplet ;
 * échéance au jour de paiement, ou au premier jour du bail s'il commence après.
 */
export function planCharges(lease: Pick<Lease, 'start_date' | 'end_date' | 'rent_hc' | 'charges_amount' | 'payment_day'>, until: string): PlannedCharge[] {
  const out: PlannedCharge[] = [];
  const last = lease.end_date ? minDate(until, lease.end_date) : until;
  let [y, m] = parts(lease.start_date);
  for (;;) {
    const ms = iso(y, m, 1);
    if (ms > last) break;
    const dim = daysInMonth(y, m);
    const me = iso(y, m, dim);
    const ps = maxDate(ms, lease.start_date);
    const pe = lease.end_date ? minDate(me, lease.end_date) : me;
    const ratio = (dayDiff(ps, pe) + 1) / dim;
    const due = minDate(maxDate(iso(y, m, lease.payment_day), ps), pe);
    out.push({ period_start: ps, period_end: pe, due_date: due, rent_amount: round2(lease.rent_hc * ratio), charges_amount: round2(lease.charges_amount * ratio) });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

// ---------- Date de début du bail ----------
/** Bornes de saisie : une date hors de ces bornes est une erreur de frappe (ex. 0090 au lieu de 2024). */
export const LEASE_START_MIN = '1950-01-01';
/** Au-delà de ce nombre d'échéances passées créées d'un coup, une confirmation est demandée. */
export const LEASE_BACKLOG_WARN = 24;

/** Contrôle bloquant de la date de début (année plausible, pas plus de 3 ans dans le futur). */
export function leaseStartIssue(start: string | null | undefined, today: string): string | null {
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return 'Date de début obligatoire.';
  if (start < LEASE_START_MIN) return `Date improbable (avant ${LEASE_START_MIN.slice(0, 4)}) : vérifiez l’année.`;
  const [y, m, d] = parts(today);
  if (start > iso(y + 3, m, Math.min(d, 28))) return 'Date improbable (plus de 3 ans dans le futur) : vérifiez l’année.';
  return null;
}

/** Nombre d'échéances mensuelles qu'un bail aura de sa date de début jusqu'à aujourd'hui. */
export function pastChargeCount(lease: Pick<Lease, 'start_date' | 'end_date' | 'rent_hc' | 'charges_amount' | 'payment_day'>, today: string): number {
  return lease.start_date && lease.start_date <= today ? planCharges(lease, today).length : 0;
}

export interface StartChangeImpact {
  /** Échéances de loyer devenues fausses, supprimées puis régénérées. */
  remove: RentCharge[];
  /** Parmi elles, celles qui ont reçu un paiement ou une quittance / un reçu non annulé : modification refusée. */
  blocked: RentCharge[];
}

/**
 * Échéances touchées par un changement de date de début (même règle que iz_lease_rules) :
 * toutes les échéances de loyer antérieures à la nouvelle date, et, si la date recule,
 * l'échéance du premier mois incomplet (prorata à recalculer).
 */
export function startChangeImpact(lease: Pick<Lease, 'id' | 'start_date'>, newStart: string, charges: RentCharge[], allocations: Allocation[], receipts: Pick<Receipt, 'charge_id' | 'cancelled_at'>[]): StartChangeImpact {
  if (!newStart || newStart === lease.start_date) return { remove: [], blocked: [] };
  const partialFirst = newStart < lease.start_date && !lease.start_date.endsWith('-01');
  const remove = charges.filter((c) => c.lease_id === lease.id && c.kind === 'loyer'
    && (c.period_start < newStart || (partialFirst && c.period_start === lease.start_date)))
    .sort((a, b) => a.period_start.localeCompare(b.period_start));
  const paid = new Set(allocations.filter((a) => a.amount > 0).map((a) => a.charge_id));
  const issued = new Set(receipts.filter((r) => !r.cancelled_at).map((r) => r.charge_id));
  return { remove, blocked: remove.filter((c) => paid.has(c.id) || issued.has(c.id)) };
}

export type LeaseState = 'a_venir' | 'actif' | 'termine';
export function leaseState(l: Pick<Lease, 'start_date' | 'end_date'>, today: string): LeaseState {
  if (l.start_date > today) return 'a_venir';
  if (l.end_date && l.end_date < today) return 'termine';
  return 'actif';
}
export const LEASE_STATE_LABELS: Record<LeaseState, string> = { a_venir: 'À venir', actif: 'En cours', termine: 'Terminé' };

export function tenantName(t: Pick<Tenant, 'first_name' | 'last_name'>): string {
  return [t.first_name, t.last_name].filter(Boolean).join(' ');
}

/** Titulaires d'un bail (actuels, ou tous pour un bail terminé). */
export function leaseTenants(leaseId: string, links: LeaseTenant[], tenants: Tenant[], onlyCurrent = true): Tenant[] {
  const byId = new Map(tenants.map((t) => [t.id, t]));
  const own = links.filter((l) => l.lease_id === leaseId);
  const current = own.filter((l) => !l.left_on);
  return (onlyCurrent && current.length ? current : own).map((l) => byId.get(l.tenant_id)).filter((t): t is Tenant => !!t);
}

// ---------- Statuts et soldes ----------
export const chargeTotal = (c: Pick<RentCharge, 'rent_amount' | 'charges_amount'>) => round2(c.rent_amount + c.charges_amount);

export type ChargeStatus = 'payee' | 'partielle' | 'impayee' | 'a_venir' | 'annulee';
export const CHARGE_STATUS_LABELS: Record<ChargeStatus, string> = {
  payee: 'Payée', partielle: 'Partiellement payée', impayee: 'Impayée', a_venir: 'À venir', annulee: 'Annulée',
};

export function allocatedByCharge(allocations: Allocation[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of allocations) m.set(a.charge_id, round2((m.get(a.charge_id) ?? 0) + a.amount));
  return m;
}
export function allocatedByPayment(allocations: Allocation[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of allocations) m.set(a.payment_id, round2((m.get(a.payment_id) ?? 0) + a.amount));
  return m;
}

export function chargeStatus(c: RentCharge, allocated: number, today: string): ChargeStatus {
  if (c.cancelled_at) return 'annulee';
  const total = chargeTotal(c);
  if (allocated >= total && total > 0) return 'payee';
  if (total === 0) return 'payee';
  if (allocated > 0) return 'partielle';
  return c.due_date > today ? 'a_venir' : 'impayee';
}

export interface ChargeView {
  charge: RentCharge;
  total: number;
  paid: number;
  remaining: number;
  status: ChargeStatus;
  overdue: boolean;
  daysLate: number;
}

export function chargeViews(charges: RentCharge[], allocations: Allocation[], today: string): ChargeView[] {
  const alloc = allocatedByCharge(allocations);
  return charges.map((c) => {
    const total = chargeTotal(c);
    const paid = alloc.get(c.id) ?? 0;
    const remaining = c.cancelled_at ? 0 : round2(Math.max(0, total - paid));
    const status = chargeStatus(c, paid, today);
    const overdue = !c.cancelled_at && remaining > 0 && c.due_date < today;
    return { charge: c, total, paid, remaining, status, overdue, daysLate: overdue ? dayDiff(c.due_date, today) : 0 };
  }).sort((a, b) => a.charge.due_date.localeCompare(b.charge.due_date));
}

export interface LeaseLedger {
  /** Total des échéances non annulées. */
  due: number;
  /** Total des paiements reçus (hors dépôt de garantie). */
  received: number;
  /** received − due : positif = trop-perçu (avance), négatif = dette. */
  balance: number;
  /** Échéances échues non réglées à ce jour. */
  overdue: number;
  /** Paiements non encore affectés à une échéance (avance du locataire). */
  unallocated: number;
}

/** Solde d'un bail : calculé uniquement à partir des échéances et des paiements, jamais saisi. */
export function leaseLedger(charges: RentCharge[], payments: Payment[], allocations: Allocation[], today: string): LeaseLedger {
  const active = charges.filter((c) => !c.cancelled_at);
  const due = round2(active.reduce((a, c) => a + chargeTotal(c), 0));
  const received = round2(payments.reduce((a, p) => a + p.amount, 0));
  const views = chargeViews(active, allocations, today);
  const overdue = round2(views.filter((v) => v.overdue).reduce((a, v) => a + v.remaining, 0));
  const byPay = allocatedByPayment(allocations);
  const unallocated = round2(payments.reduce((a, p) => a + Math.max(0, p.amount - (byPay.get(p.id) ?? 0)), 0));
  return { due, received, balance: round2(received - due), overdue, unallocated };
}

// ---------- Répartition d'un paiement ----------
export interface AllocationPlan {
  allocations: { charge_id: string; amount: number }[];
  /** Reste non affecté (trop-perçu ou avance). */
  remainder: number;
}

/** Répartit un montant sur les échéances ouvertes, de la plus ancienne à la plus récente. */
export function autoAllocate(amount: number, open: ChargeView[]): AllocationPlan {
  let left = round2(amount);
  const allocations: AllocationPlan['allocations'] = [];
  for (const v of [...open].sort((a, b) => a.charge.due_date.localeCompare(b.charge.due_date))) {
    if (left <= 0) break;
    if (v.remaining <= 0 || v.charge.cancelled_at) continue;
    const a = round2(Math.min(left, v.remaining));
    allocations.push({ charge_id: v.charge.id, amount: a });
    left = round2(left - a);
  }
  return { allocations, remainder: left };
}

/** Vérifie une répartition saisie à la main (mêmes règles que le serveur). */
export function checkAllocation(amount: number, plan: { charge_id: string; amount: number }[], views: ChargeView[]): string | null {
  if (!(amount > 0)) return 'Le montant du paiement doit être positif.';
  let sum = 0;
  for (const a of plan) {
    if (!(a.amount > 0)) return 'Chaque montant réparti doit être positif.';
    const v = views.find((x) => x.charge.id === a.charge_id);
    if (!v) return 'Échéance inconnue.';
    if (v.charge.cancelled_at) return 'Échéance annulée.';
    if (round2(a.amount) > v.remaining) return `La répartition dépasse le reste dû de l’échéance de ${monthLabel(v.charge.period_start)}.`;
    sum = round2(sum + a.amount);
  }
  if (sum > round2(amount)) return 'La répartition dépasse le montant du paiement.';
  return null;
}

// ---------- Synthèse par bien ----------
export interface PropertyRentalSummary {
  activeLeases: Lease[];
  tenantNames: string;
  /** Loyers encaissés sur l'année (date de paiement). */
  received: number;
  /** Dépenses payées sur l'année (toutes natures : sorties de trésorerie). */
  expensesPaid: number;
  /** Solde locatif cumulé de tous les baux du bien (positif = avance). */
  balance: number;
  overdue: number;
  /** Cash-flow réel de l'année : encaissements − dépenses payées (hors dépôt de garantie). */
  cashflow: number;
}

export function propertyRentalSummary(propertyId: string, year: number, today: string, d: {
  leases: Lease[]; leaseTenants: LeaseTenant[]; tenants: Tenant[]; charges: RentCharge[]; payments: Payment[]; allocations: Allocation[]; expenses: Expense[];
}): PropertyRentalSummary {
  const leases = d.leases.filter((l) => l.property_id === propertyId);
  const ids = new Set(leases.map((l) => l.id));
  const activeLeases = leases.filter((l) => leaseState(l, today) === 'actif');
  const tenantNames = activeLeases.flatMap((l) => leaseTenants(l.id, d.leaseTenants, d.tenants).map(tenantName)).join(', ');
  const payments = d.payments.filter((p) => ids.has(p.lease_id));
  const charges = d.charges.filter((c) => ids.has(c.lease_id));
  const chargeIds = new Set(charges.map((c) => c.id));
  const ledger = leaseLedger(charges, payments, d.allocations.filter((a) => chargeIds.has(a.charge_id)), today);
  const y = String(year);
  const inYear = d.expenses.filter((e) => e.property_id === propertyId && e.payment_status === 'paye' && (e.paid_on ?? e.expense_date).startsWith(y));
  const importedIncome = round2(inYear.filter(isIncome).reduce((a, e) => a + e.amount, 0));
  const expensesPaid = round2(inYear.filter((e) => !isIncome(e)).reduce((a, e) => a + e.amount, 0));
  // encaissements = paiements saisis sur les baux + recettes importées d'un relevé
  const received = round2(payments.filter((p) => p.paid_on.startsWith(y)).reduce((a, p) => a + p.amount, 0) + importedIncome);
  return { activeLeases, tenantNames, received, expensesPaid, balance: ledger.balance, overdue: ledger.overdue, cashflow: round2(received - expensesPaid) };
}

// ---------- Modèles de relance ----------
export const DEFAULT_REMINDER_TEMPLATES = [
  { subject: 'Rappel : loyer impayé', body: 'Bonjour {locataires},\n\nSauf erreur de notre part, la somme de {montant} € reste due au titre du logement {bien} (échéances : {periodes}).\nPourriez-vous procéder au règlement ou nous contacter si une difficulté se présente ?\n\nSi le paiement a été effectué entre-temps, merci de ne pas tenir compte de ce message.\n\nCordialement,\n{bailleur}' },
  { subject: 'Second rappel : loyer impayé', body: 'Bonjour {locataires},\n\nNotre précédent message est resté sans réponse : la somme de {montant} € reste due au titre du logement {bien} (échéances : {periodes}).\nMerci de régulariser la situation dans les meilleurs délais ou de nous contacter pour convenir d’une solution.\n\nSi le paiement a été effectué entre-temps, merci de ne pas tenir compte de ce message.\n\nCordialement,\n{bailleur}' },
  { subject: 'Dernier rappel amiable : loyer impayé', body: 'Bonjour {locataires},\n\nMalgré nos précédents rappels, la somme de {montant} € reste due au titre du logement {bien} (échéances : {periodes}).\nNous vous remercions de nous contacter rapidement afin de trouver une solution amiable.\n\nCordialement,\n{bailleur}' },
] as const;

export const TEMPLATE_VARIABLES = ['{locataires}', '{montant}', '{bien}', '{periodes}', '{bailleur}'] as const;

export function eur(v: number): string {
  // format français sans espaces insécables (compatibles e-mail et PDF)
  const [i, d] = Math.abs(round2(v)).toFixed(2).split('.');
  return `${v < 0 ? '-' : ''}${i!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${d}`;
}

export function renderTemplate(tpl: string, vars: { locataires: string; montant: number; bien: string; periodes: string[]; bailleur: string }): string {
  return tpl
    .replaceAll('{locataires}', vars.locataires)
    .replaceAll('{montant}', eur(vars.montant))
    .replaceAll('{bien}', vars.bien)
    .replaceAll('{periodes}', vars.periodes.join(', '))
    .replaceAll('{bailleur}', vars.bailleur);
}

// ---------- Dépenses ----------
export const EXPENSE_CATEGORY_LABELS: Record<Expense['category'], string> = {
  credit: 'Crédit', assurance_credit: 'Assurance crédit', copropriete: 'Charges de copropriété (dont travaux)', assurance: 'Assurance',
  taxe_fonciere: 'Taxe foncière', entretien_amortissable: 'Entretien, petits travaux amortissables', entretien: 'Entretien, petits travaux non amortissables',
  loyer: 'Loyer (recette)', frais_bancaires: 'Frais bancaires / financiers', mobilier: 'Meuble', frais_credit: 'Frais de crédit',
  gestion: 'Gestion locative', interets: 'Intérêts d’emprunt', travaux: 'Travaux', autre: 'Autres dépenses',
};
/** Catégories proposées en premier (ordre de saisie) ; les suivantes restent disponibles. */
export const MAIN_EXPENSE_CATEGORIES: Expense['category'][] = ['credit', 'assurance_credit', 'copropriete', 'assurance', 'taxe_fonciere', 'entretien_amortissable', 'entretien', 'loyer', 'frais_bancaires', 'mobilier', 'frais_credit'];
export const OTHER_EXPENSE_CATEGORIES: Expense['category'][] = ['gestion', 'interets', 'travaux', 'autre'];
/** La catégorie « Loyer » enregistre une recette (mouvement crédité sur le compte), pas une dépense. */
export const isIncome = (e: Pick<Expense, 'category'>) => e.category === 'loyer';
export const EXPENSE_NATURE_LABELS = {
  charge: 'Charge', immobilisation: 'Immobilisation', remboursement_capital: 'Remboursement de capital', tresorerie: 'Trésorerie seule',
} as const;
/** Nature proposée par défaut selon la catégorie (modifiable : des travaux peuvent être une charge ou une immobilisation). */
export function defaultNature(category: Expense['category']): Expense['nature'] {
  if (category === 'mobilier' || category === 'entretien_amortissable') return 'immobilisation';
  if (category === 'credit' || category === 'loyer') return 'tresorerie';
  return 'charge';
}

export interface ExpenseTotals {
  /** Recettes importées (catégorie « Loyer »), exclues des dépenses. */
  income: number;
  total: number;
  paid: number;
  toPay: number;
  recoverable: number;
  byNature: Record<Expense['nature'], number>;
  byCategory: Partial<Record<Expense['category'], number>>;
}
export function expenseTotals(list: Expense[]): ExpenseTotals {
  const t: ExpenseTotals = { income: 0, total: 0, paid: 0, toPay: 0, recoverable: 0, byNature: { charge: 0, immobilisation: 0, remboursement_capital: 0, tresorerie: 0 }, byCategory: {} };
  for (const e of list) {
    if (isIncome(e)) { t.income = round2(t.income + e.amount); continue; }
    t.total = round2(t.total + e.amount);
    if (e.payment_status === 'paye') t.paid = round2(t.paid + e.amount); else t.toPay = round2(t.toPay + e.amount);
    t.recoverable = round2(t.recoverable + e.recoverable_amount);
    t.byNature[e.nature] = round2(t.byNature[e.nature] + e.amount);
    t.byCategory[e.category] = round2((t.byCategory[e.category] ?? 0) + e.amount);
  }
  return t;
}

export const PAYMENT_METHOD_LABELS = {
  virement: 'Virement', prelevement: 'Prélèvement', cheque: 'Chèque', especes: 'Espèces', caf: 'CAF / APL', autre: 'Autre',
} as const;
