import type { AcquisitionSnapshot, Property, Scenario } from '../data/types.ts';
import { amortize, autoProvisionMonthly, autoRecoverableAnnual, normalizeInputs, round2, simulate, summarize, type SimulationInputs, type SimulationResult } from './simulator.ts';
import { todayParis } from './format.ts';

export const isOwned = (p: Pick<Property, 'status'>) => p.status === 'acquis';
export const isProspect = (p: Pick<Property, 'status'>) => p.status !== 'acquis';

export interface PropertyMetrics {
  pricePerM2: number | null;
  scenario: Scenario | null;
  result: SimulationResult | null;
}

/** Prix au m² : prix proposé s'il est renseigné, sinon prix affiché. */
export function pricePerM2(p: Pick<Property, 'surface' | 'offer_price' | 'asking_price'>): number | null {
  const price = p.offer_price ?? p.asking_price;
  if (!p.surface || !price) return null;
  return price / p.surface;
}

export function primaryScenario(p: Property, scenarios: Scenario[]): Scenario | null {
  const own = scenarios.filter((s) => s.property_id === p.id && !s.archived_at);
  return own.find((s) => s.id === p.primary_scenario_id) ?? own[0] ?? null;
}

export function scenarioResult(s: Scenario | null, defaults?: SimulationInputs): SimulationResult | null {
  if (!s) return null;
  const out = simulate(normalizeInputs(s.inputs, defaults));
  return out.ok ? out.result : null;
}

export function metrics(p: Property, scenarios: Scenario[], defaults?: SimulationInputs): PropertyMetrics {
  const scenario = primaryScenario(p, scenarios);
  return { pricePerM2: pricePerM2(p), scenario, result: scenarioResult(scenario, defaults) };
}

/** Loyer charges comprises = loyer hors charges + provision sur charges (mensuel). */
export function rentWithCharges(p: { estimated_rent?: number | null; charges_provision?: number | null }): number | null {
  if (p.estimated_rent == null && p.charges_provision == null) return null;
  return Math.round(((p.estimated_rent ?? 0) + (p.charges_provision ?? 0)) * 100) / 100;
}

/** Charges annuelles saisies sur un bien détenu. */
export const ANNUAL_CHARGE_FIELDS = [
  ['property_tax_annual', 'Taxe foncière'],
  ['copro_charges_annual', 'Charges de copropriété'],
  ['pno_annual', 'Assurance PNO'],
  ['management_annual', 'Gestion locative'],
  ['gli_annual', 'GLI'],
  ['other_charges_annual', 'Autres charges'],
] as const;
export type AnnualChargeField = (typeof ANNUAL_CHARGE_FIELDS)[number][0];

export function annualChargesTotal(p: Partial<Record<AnnualChargeField, number | null>>): number | null {
  const vals = ANNUAL_CHARGE_FIELDS.map(([k]) => p[k]).filter((v): v is number => v !== null && v !== undefined);
  return vals.length ? Math.round(vals.reduce((a, v) => a + v, 0) * 100) / 100 : null;
}

/** Crédit d'un bien détenu. */
export const LOAN_FIELDS = ['loan_amount', 'loan_rate', 'loan_years', 'loan_start_date', 'loan_insurance_monthly', 'loan_monthly_payment'] as const;

export interface LoanInfo {
  /** Mensualité hors assurance (saisie, sinon calculée). */
  payment: number;
  insurance: number;
  /** Mensualité assurance comprise ; 0 une fois le crédit remboursé. */
  monthlyTotal: number;
  computed: boolean;
  endDate: string | null;
  /** Capital restant dû à la date donnée (null sans date de début). */
  remaining: number | null;
  finished: boolean;
}

const addMonths = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
};
const monthsBetween = (from: string, to: string) => {
  const [y1, m1, d1] = from.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = to.split('-').map(Number) as [number, number, number];
  return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
};

type LoanFields = Partial<Record<'loan_amount' | 'loan_rate' | 'loan_years' | 'loan_insurance_monthly' | 'loan_monthly_payment', number | null>> & { loan_start_date?: string | null };

/** Mensualité et capital restant dû. Mensualité constante : capital × t / (1 − (1 + t)^−n). */
export function loanInfo(p: LoanFields, today: string): LoanInfo | null {
  const amount = p.loan_amount ?? 0;
  if (amount <= 0 && !p.loan_monthly_payment) return null;
  const months = Math.round((p.loan_years ?? 0) * 12);
  const rows = amount > 0 && months > 0 ? amortize(amount, p.loan_rate ?? 0, months, 0) : [];
  const computedPayment = rows[0]?.payment ?? 0;
  const payment = p.loan_monthly_payment ?? computedPayment;
  const insurance = p.loan_insurance_monthly ?? 0;
  const endDate = p.loan_start_date && months > 0 ? addMonths(p.loan_start_date, months) : null;
  let remaining: number | null = null;
  if (p.loan_start_date && rows.length) {
    const paid = Math.max(0, monthsBetween(p.loan_start_date, today) + 1);
    remaining = paid <= 0 ? amount : paid >= rows.length ? 0 : rows[paid - 1]!.balance;
    if (today < p.loan_start_date) remaining = amount;
  }
  const finished = endDate !== null && today >= endDate;
  return { payment: round2(payment), insurance: round2(insurance), monthlyTotal: finished ? 0 : round2(payment + insurance), computed: p.loan_monthly_payment == null, endDate, remaining, finished };
}

export interface CashflowEstimate {
  monthly: number;
  /** Loyer charges comprises encaissé par mois. */
  income: number;
  /** Charges annuelles / 12. */
  charges: number;
  /** Mensualité de crédit assurance comprise. */
  loan: number;
  source: 'bien' | 'simulation';
  loanSource: 'bien' | 'simulation' | null;
}

/**
 * Cash-flow mensuel prévisionnel d'un bien détenu, avant impôts :
 * loyer charges comprises (bail en cours, sinon loyer saisi) − charges annuelles / 12 − mensualité de crédit.
 * Sans loyer ni charge saisis, le résultat de la simulation principale est utilisé.
 * Sans crédit saisi, la mensualité de la simulation principale est reprise.
 */
export function ownedCashflow(
  p: Property,
  activeLeases: { rent_hc: number; charges_amount: number }[],
  sim: SimulationResult | null,
  today: string,
): CashflowEstimate | null {
  const charges = annualChargesTotal(p);
  const hasOwn = activeLeases.length > 0 || p.estimated_rent != null || p.charges_provision != null || charges != null;
  const loan = loanInfo(p, today);
  if (!hasOwn) {
    if (!sim) return loan ? { monthly: -loan.monthlyTotal, income: 0, charges: 0, loan: loan.monthlyTotal, source: 'bien', loanSource: 'bien' } : null;
    return { monthly: sim.cashflowMonthlyYear1, income: round2(sim.annualRent / 12), charges: round2(sim.annualOwnerCharges / 12), loan: sim.monthlyPaymentWithInsurance, source: 'simulation', loanSource: sim.loanAmount > 0 ? 'simulation' : null };
  }
  const income = activeLeases.length
    ? activeLeases.reduce((a, l) => a + l.rent_hc + l.charges_amount, 0)
    : (p.estimated_rent ?? 0) + (p.charges_provision ?? 0);
  const monthlyCharges = (charges ?? 0) / 12;
  const loanMonthly = loan ? loan.monthlyTotal : sim && sim.loanAmount > 0 ? sim.monthlyPaymentWithInsurance : 0;
  const loanSource = loan ? 'bien' : sim && sim.loanAmount > 0 ? 'simulation' : null;
  return { monthly: round2(income - monthlyCharges - loanMonthly), income: round2(income), charges: round2(monthlyCharges), loan: round2(loanMonthly), source: 'bien', loanSource };
}

/** Champs d'un bien en prospection alimentés par une simulation (seules les valeurs renseignées). */
export function prospectFieldsFromSimulation(i: SimulationInputs, r: SimulationResult): Partial<Property> {
  const out: Partial<Property> = {};
  if (i.askingPrice > 0) out.asking_price = i.askingPrice;
  if (i.price > 0) out.offer_price = i.price;
  if (i.surface > 0) out.surface = i.surface;
  if (i.works > 0) out.works_budget = i.works;
  if (r.monthlyRent > 0) out.estimated_rent = r.monthlyRent;
  return out;
}

/** Pré-remplit un scénario à partir de la fiche du bien. */
export function inputsFromProperty(p: Property, defaults: SimulationInputs): SimulationInputs {
  const v = (x: number | null | undefined, d: number) => (x === null || x === undefined ? d : x);
  return {
    ...defaults,
    askingPrice: p.asking_price ?? 0,
    surface: p.surface ?? 0,
    price: p.offer_price ?? p.asking_price ?? 0,
    works: p.works_budget ?? 0,
    // un loyer connu est repris tel quel ; sinon il est calculé au m²
    rentMode: p.estimated_rent ? 'manuel' : defaults.rentMode,
    monthlyRent: p.estimated_rent ?? 0,
    chargesProvisionMonthly: v(p.charges_provision, p.copro_charges_annual ? autoProvisionMonthly(p.copro_charges_annual) : defaults.chargesProvisionMonthly),
    coproRecoverableAnnual: p.copro_charges_annual ? autoRecoverableAnnual(p.copro_charges_annual) : defaults.coproRecoverableAnnual,
    propertyTaxAnnual: v(p.property_tax_annual, defaults.propertyTaxAnnual),
    coproChargesAnnual: v(p.copro_charges_annual, defaults.coproChargesAnnual),
    pnoAnnual: v(p.pno_annual, defaults.pnoAnnual),
    managementAnnual: v(p.management_annual, defaults.managementAnnual),
    gliAnnual: v(p.gli_annual, defaults.gliAnnual),
    otherChargesAnnual: v(p.other_charges_annual, defaults.otherChargesAnnual),
  };
}

/**
 * Règles appliquées lors d'un changement de statut.
 * Référence : fonction SQL public.iz_property_status_rules() (source de vérité côté serveur).
 * Cette version sert au mode démonstration local et aux tests.
 */
export function applyStatusRules(prev: Property | null, next: Property, scenarios: Scenario[], now = new Date()): Property {
  const p = { ...next };
  if (p.status === 'archive' && (!prev || prev.status !== 'archive')) {
    p.status_before_archive = p.status_before_archive ?? (prev ? prev.status : 'repere');
  } else if (p.status !== 'archive') {
    p.status_before_archive = null;
  }
  if (p.status === 'acquis' && (!prev || prev.status !== 'acquis')) {
    p.acquired_at = p.acquired_at ?? todayParis(now);
    p.occupation_status = p.occupation_status ?? 'vacant';
    if (!p.acquisition_snapshot && p.primary_scenario_id) {
      const s = scenarios.find((x) => x.id === p.primary_scenario_id && x.user_id === p.user_id);
      if (s) {
        const snap: AcquisitionSnapshot = {
          scenario_id: s.id, scenario_name: s.name, inputs: structuredClone(s.inputs),
          results: s.results, engine_version: s.engine_version, taken_at: now.toISOString(),
        };
        p.acquisition_snapshot = snap;
      }
    }
  }
  if (p.status !== 'acquis') p.occupation_status = null;
  return p;
}

export function statusEventSummary(from: Property['status'] | null, to: Property['status']): { kind: 'creation' | 'status_change' | 'acquisition'; summary: string } {
  if (from === null) {
    return to === 'acquis'
      ? { kind: 'acquisition', summary: 'Bien ajouté directement dans Mes biens' }
      : { kind: 'creation', summary: 'Bien ajouté à la prospection' };
  }
  if (to === 'acquis') return { kind: 'acquisition', summary: 'Bien acquis : transféré dans Mes biens' };
  if (from === 'acquis') return { kind: 'status_change', summary: 'Acquisition annulée : bien revenu en prospection' };
  return { kind: 'status_change', summary: 'Changement de statut' };
}

export { summarize };

/**
 * Alertes automatiques liées au DPE (loi Climat et résilience) : calendrier d'interdiction de
 * mise en location des logements énergivores et gel des loyers des classes F et G.
 */
export function dpeAlerts(dpe: string | null | undefined, today: string): string[] {
  const d = (dpe ?? '').toUpperCase();
  const gel = 'Loyer gelé : aucune révision, majoration ni réévaluation (logements F et G, depuis le 24 août 2022).';
  if (d === 'G') return ['DPE G : logement non décent depuis le 1er janvier 2025, il ne peut plus faire l’objet d’un nouveau bail ni d’un renouvellement.', gel, 'Des travaux de rénovation énergétique permettent de lever ces interdictions (déficit foncier majoré à 21 400 € pour un passage à D ou mieux).'];
  if (d === 'F') return [today < '2028-01-01' ? 'DPE F : logement non décent à partir du 1er janvier 2028 ; plus de nouveau bail ni de renouvellement après cette date.' : 'DPE F : logement non décent depuis le 1er janvier 2028 ; plus de nouveau bail ni de renouvellement.', gel];
  if (d === 'E') return [today < '2034-01-01' ? 'DPE E : logement non décent à partir du 1er janvier 2034 ; travaux à anticiper.' : 'DPE E : logement non décent depuis le 1er janvier 2034.'];
  return [];
}
