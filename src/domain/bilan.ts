/**
 * Bilan simplifié 2033-A du loueur en meublé au réel, à partir des données de gestion de l'application :
 * créances de loyers, dépôts de garantie détenus, charges à payer, emprunts, et suivi du compte de l'exploitant
 * d'une année sur l'autre depuis l'acquisition.
 *
 * Convention « sans compte bancaire dédié » (par défaut) : trésorerie de l'activité nulle ; les loyers encaissés
 * sont des prélèvements de l'exploitant, les dépenses payées de sa poche des apports.
 *
 * Le résultat de la liasse étant calculé sur les encaissements, les créances et les charges à payer créent
 * un écart avec le compte de l'exploitant suivi : il est calculé et expliqué, jamais masqué.
 */
import type { DepositMovement, Expense, TaxPropertyInputs } from '../data/types.ts';
import { fiscalSummary, loanBalance, loanYear, type FiscalData } from './fiscal.ts';
import { isIncome } from './rental.ts';
import { round2 } from './simulator.ts';

export interface BilanData extends FiscalData {
  deposits?: DepositMovement[];
}

export interface BilanInputs {
  /** Trésorerie d'un compte dédié à l'activité au 31/12 de l'année (sinon 0). */
  cash?: number;
  /** Trésorerie du compte dédié au 31/12 de l'année précédente. */
  cashPrevious?: number;
  /**
   * Capitaux propres d'ouverture (capital individuel + résultat N-1) repris du bilan N-1 déjà déposé,
   * lorsque les années précédentes n'ont pas été tenues dans l'application.
   */
  openingEquity?: number;
}

export interface Line { label: string; amount: number }

export interface BilanFacts {
  year: number;
  /** Loyers et charges échus non réglés au 31/12. */
  receivables: number;
  receivablesDetail: Line[];
  /** Dépôts de garantie reçus et non restitués au 31/12. */
  depositsHeld: number;
  /** Dépenses de l'année non payées au 31/12 (charges à payer). */
  payables: number;
  payablesDetail: Line[];
  cash: number;
  /** Emprunts ; bankGap : somme des écarts banque − calcul (explique une partie de l'écart du compte de l'exploitant). */
  loans: { remaining: number; beyondOneYear: number; bankGap: number };
  /** Compte de l'exploitant suivi : ouverture, apports, prélèvements, clôture (avant résultat de l'année). */
  exploitant: {
    opening: number;
    contributions: number;
    withdrawals: number;
    closing: number;
    source: 'historique' | 'bilan_n-1';
    contributionsDetail: Line[];
    withdrawalsDetail: Line[];
  };
  warnings: string[];
}

const inYear = (date: string | null | undefined, y: number) => !!date && date.slice(0, 4) === String(y);
const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));
const LOAN_CATEGORIES = new Set<Expense['category']>(['credit', 'interets', 'assurance_credit']);

/** Flux de l'année entre l'activité et l'exploitant (convention sans compte dédié). */
function yearFlows(year: number, d: BilanData, propertyIds: Set<string>, inputs: (pid: string, y: number) => TaxPropertyInputs) {
  const contributions: Line[] = [];
  const withdrawals: Line[] = [];
  const props = d.properties.filter((p) => propertyIds.has(p.id));
  const leaseIds = new Set(d.leases.filter((l) => propertyIds.has(l.property_id)).map((l) => l.id));

  for (const p of props) {
    if (inYear(p.acquired_at, year)) {
      const inp = inputs(p.id, year);
      const cost = inp.depreciable_base ?? p.acquisition_cost ?? p.acquisition_snapshot?.results?.totalCost ?? 0;
      const loan = p.loan_start_date && p.loan_start_date.slice(0, 4) <= String(year) ? p.loan_amount ?? 0 : 0;
      if (cost > 0) contributions.push({ label: `${p.title} : apport à l'acquisition (prix et frais ${round2(cost)} € − emprunt ${round2(loan)} €)`, amount: round2(cost - loan) });
    }
    const loan = loanYear(p, year);
    const a = { interest: 0, insurance: 0 };
    const exp = d.expenses.filter((e) => e.property_id === p.id && e.payment_status === 'paye' && inYear(e.paid_on ?? e.expense_date, year));
    a.interest = sum(exp.filter((e) => e.category === 'interets').map((e) => e.amount));
    a.insurance = sum(exp.filter((e) => e.category === 'assurance_credit').map((e) => e.amount));
    const repaid = (loan?.principal ?? 0) + (a.interest || loan?.interest || 0) + (a.insurance || loan?.insurance || 0);
    if (repaid > 0) contributions.push({ label: `${p.title} : échéances d'emprunt (capital, intérêts, assurance)`, amount: round2(repaid) });
    const paid = sum(exp.filter((e) => !isIncome(e) && !LOAN_CATEGORIES.has(e.category)).map((e) => e.amount));
    if (paid > 0) contributions.push({ label: `${p.title} : dépenses payées`, amount: paid });
    const income = sum(exp.filter(isIncome).map((e) => e.amount));
    if (income > 0) withdrawals.push({ label: `${p.title} : recettes encaissées (relevés)`, amount: income });
  }
  const rents = sum(d.payments.filter((x) => leaseIds.has(x.lease_id) && inYear(x.paid_on, year)).map((x) => x.amount));
  if (rents > 0) withdrawals.push({ label: 'Loyers et charges encaissés', amount: rents });
  const dep = (d.deposits ?? []).filter((m) => leaseIds.has(m.lease_id) && inYear(m.occurred_on, year));
  const depIn = sum(dep.filter((m) => m.kind === 'encaissement').map((m) => m.amount));
  const depOut = sum(dep.filter((m) => m.kind === 'restitution').map((m) => m.amount));
  if (depIn > 0) withdrawals.push({ label: 'Dépôts de garantie encaissés', amount: depIn });
  if (depOut > 0) contributions.push({ label: 'Dépôts de garantie restitués', amount: depOut });
  return { contributions, withdrawals };
}

/** Faits du bilan au 31/12 de l'année, pour les biens au réel donnés. */
export function bilanFacts(year: number, d: BilanData, propertyIds: string[], inputs: (pid: string, y: number) => TaxPropertyInputs, b: BilanInputs = {}): BilanFacts {
  const ids = new Set(propertyIds);
  const end = `${year}-12-31`;
  const warnings: string[] = [];
  const props = d.properties.filter((p) => ids.has(p.id));
  const leases = d.leases.filter((l) => ids.has(l.property_id));
  const leaseIds = new Set(leases.map((l) => l.id));

  // créances : échéances échues au 31/12, moins les affectations de paiements reçus au plus tard le 31/12
  const payDate = new Map(d.payments.map((p) => [p.id, p.paid_on]));
  const receivablesDetail: Line[] = [];
  for (const l of leases) {
    let due = 0;
    for (const c of d.charges.filter((x) => x.lease_id === l.id && !x.cancelled_at && !x.carried_to && x.due_date <= end)) {
      const paid = sum(d.allocations.filter((a) => a.charge_id === c.id && (payDate.get(a.payment_id) ?? '9999') <= end).map((a) => a.amount));
      due += Math.max(0, c.rent_amount + c.charges_amount - paid);
    }
    if (due > 0.005) receivablesDetail.push({ label: `${props.find((p) => p.id === l.property_id)?.title ?? 'Bien'} – ${l.label ?? 'bail'}`, amount: round2(due) });
  }
  const receivables = sum(receivablesDetail.map((x) => x.amount));

  // dépôts de garantie détenus au 31/12
  let depositsHeld = 0;
  for (const l of leases) {
    const mv = (d.deposits ?? []).filter((m) => m.lease_id === l.id && m.occurred_on <= end);
    const held = sum(mv.map((m) => (m.kind === 'encaissement' ? m.amount : -m.amount)));
    depositsHeld += Math.max(0, held);
    const active = l.start_date <= end && (!l.end_date || l.end_date >= end);
    if (active && l.deposit_amount > 0 && mv.length === 0) warnings.push(`Bail « ${l.label ?? l.start_date} » : dépôt de garantie de ${l.deposit_amount} € prévu au bail mais aucun encaissement enregistré.`);
  }
  depositsHeld = round2(depositsHeld);

  // charges à payer : dépenses engagées jusqu'au 31/12, non payées à cette date
  const payablesDetail = d.expenses
    .filter((e) => ids.has(e.property_id) && !isIncome(e) && e.expense_date <= end && inYear(e.expense_date, year)
      && (e.payment_status === 'a_payer' || (e.paid_on != null && e.paid_on > end)))
    .map((e) => ({ label: `${e.label || e.supplier || e.category} (${e.expense_date})`, amount: round2(e.amount) }));
  const payables = sum(payablesDetail.map((x) => x.amount));

  // emprunts
  let remaining = 0, beyond = 0, bankGap = 0;
  for (const p of props) {
    const lb = loanBalance(p, year, inputs(p.id, year));
    remaining += lb.remaining; beyond += lb.beyondOneYear; bankGap += lb.gap;
    if (lb.source === 'banque' && Math.abs(lb.gap) > 5)
      warnings.push(`${p.title} : capital restant dû de la banque (${lb.remaining} €) différent du calcul (${lb.computed} €), écart ${lb.gap} € — vérifiez le crédit du bien (remboursement anticipé, renégociation, différé).`);
    if (lb.source === 'calcul') warnings.push(`${p.title} : capital restant dû calculé (${lb.remaining} €) — saisissez celui du tableau d'amortissement de la banque pour plus de sûreté.`);
  }

  // compte de l'exploitant
  const first = Math.min(year, ...props.map((p) => Number((p.acquired_at ?? `${year}`).slice(0, 4))));
  const cash = round2(b.cash ?? 0), cashPrevious = round2(b.cashPrevious ?? 0);
  let opening = 0;
  let source: BilanFacts['exploitant']['source'] = 'historique';
  if (b.openingEquity != null) { opening = round2(b.openingEquity); source = 'bilan_n-1'; }
  else {
    for (let y = first; y < year; y++) {
      const f = yearFlows(y, d, ids, inputs);
      const result = fiscalSummary(y, d, inputs).reelBic?.liasse.lines.find((x) => x.code === '310')?.amount ?? 0;
      opening += sum(f.contributions.map((x) => x.amount)) - sum(f.withdrawals.map((x) => x.amount)) + result;
    }
    opening = round2(opening);
  }
  const f = yearFlows(year, d, ids, inputs);
  const contributions = sum(f.contributions.map((x) => x.amount));
  // avec un compte dédié, la trésorerie conservée n'a pas été prélevée par l'exploitant ; l'historique des années
  // précédentes est reconstitué sans compte dédié, le bilan N-1 déposé intègre au contraire sa trésorerie
  const retained = source === 'bilan_n-1' ? cash - cashPrevious : cash;
  const withdrawals = round2(sum(f.withdrawals.map((x) => x.amount)) - retained);
  const closing = round2(opening + contributions - withdrawals);
  if (b.cash == null) warnings.push('Trésorerie comptée à 0 (activité sans compte bancaire dédié) : loyers encaissés et dépenses payées passent par le compte de l’exploitant.');
  return {
    year, receivables, receivablesDetail, depositsHeld, payables, payablesDetail, cash,
    loans: { remaining: round2(remaining), beyondOneYear: round2(beyond), bankGap: round2(bankGap) },
    exploitant: { opening, contributions, withdrawals, closing, source, contributionsDetail: f.contributions, withdrawalsDetail: f.withdrawals },
    warnings,
  };
}
