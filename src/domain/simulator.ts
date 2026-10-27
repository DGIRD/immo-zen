/**
 * Moteur du simulateur Immo-Zen.
 * Fonctions pures, sans dépendance à l'interface : testées dans tests/simulator.test.ts.
 * Formules, conventions et arrondis : docs/FORMULES-SIMULATEUR.md.
 */

export const ENGINE_VERSION = '1';

export type PriceMode = 'hors_honoraires' | 'honoraires_inclus';
export type NotaryMode = 'percent' | 'amount';
export type DeferralType = 'aucun' | 'partiel' | 'total';
/** Loyer hors charges : surface × prix au m² bas ou haut, ou montant saisi. */
export type RentMode = 'bas' | 'haut' | 'manuel';

export interface SimulationInputs {
  priceMode: PriceMode;
  /** Prix de présentation, frais d'agence inclus (FAI). Sert au calcul de la négociation. */
  askingPrice: number;
  /** Surface habitable du logement (m²). */
  surface: number;
  /** Prix proposé. En mode « honoraires inclus », il contient les frais d'agence. */
  price: number;
  agencyFees: number;
  notaryMode: NotaryMode;
  /** Taux appliqué au prix hors honoraires (mode percent). */
  notaryRate: number;
  /** Montant saisi (mode amount). */
  notaryAmount: number;
  works: number;
  furniture: number;
  guaranteeFees: number;
  dossierFees: number;
  downPayment: number;
  useLoan: boolean;
  /** Taux nominal annuel en %. */
  interestRate: number;
  loanYears: number;
  /** Taux annuel d'assurance en % du capital initial. */
  insuranceRate: number;
  deferralMonths: number;
  deferralType: DeferralType;
  rentMode: RentMode;
  /** Loyer au m² (hors charges, par mois), fourchette basse et haute. */
  rentM2Low: number;
  rentM2High: number;
  /** Loyer hors charges saisi (mode « manuel ») ; sinon calculé. */
  monthlyRent: number;
  chargesProvisionMonthly: number;
  coproChargesAnnual: number;
  coproRecoverableAnnual: number;
  propertyTaxAnnual: number;
  propertyTaxRecoverableAnnual: number;
  pnoAnnual: number;
  managementAnnual: number;
  gliAnnual: number;
  maintenanceAnnual: number;
  vacancyAnnual: number;
  otherChargesAnnual: number;
}

export const NUMERIC_FIELDS = [
  'askingPrice', 'surface', 'rentM2Low', 'rentM2High', 'price', 'agencyFees', 'notaryRate', 'notaryAmount', 'works', 'furniture', 'guaranteeFees', 'dossierFees',
  'downPayment', 'interestRate', 'loanYears', 'insuranceRate', 'deferralMonths', 'monthlyRent',
  'chargesProvisionMonthly', 'coproChargesAnnual', 'coproRecoverableAnnual', 'propertyTaxAnnual',
  'propertyTaxRecoverableAnnual', 'pnoAnnual', 'managementAnnual', 'gliAnnual', 'maintenanceAnnual',
  'vacancyAnnual', 'otherChargesAnnual',
] as const satisfies readonly (keyof SimulationInputs)[];
export type NumericField = (typeof NUMERIC_FIELDS)[number];

/** Paramètres par défaut demandés (modifiables dans Paramètres). */
export const DEFAULT_INPUTS: SimulationInputs = {
  priceMode: 'hors_honoraires',
  askingPrice: 0,
  surface: 0,
  price: 0,
  agencyFees: 10000,
  notaryMode: 'percent',
  notaryRate: 7.5,
  notaryAmount: 0,
  works: 0,
  furniture: 0,
  guaranteeFees: 0,
  dossierFees: 0,
  downPayment: 0,
  useLoan: true,
  interestRate: 3.5,
  loanYears: 20,
  insuranceRate: 0.3,
  deferralMonths: 0,
  deferralType: 'aucun',
  rentMode: 'bas',
  rentM2Low: 0,
  rentM2High: 0,
  monthlyRent: 0,
  chargesProvisionMonthly: 0,
  coproChargesAnnual: 0,
  coproRecoverableAnnual: 0,
  propertyTaxAnnual: 0,
  propertyTaxRecoverableAnnual: 0,
  pnoAnnual: 99,
  managementAnnual: 0,
  gliAnnual: 0,
  maintenanceAnnual: 0,
  vacancyAnnual: 0,
  otherChargesAnnual: 0,
};

/** Valeurs par défaut réglables dans Paramètres. */
export const DEFAULT_SETTING_FIELDS = ['notaryRate', 'agencyFees', 'interestRate', 'loanYears', 'insuranceRate', 'pnoAnnual'] as const;

/**
 * Valeurs par défaut de l'utilisateur. Seuls les champs réglables sont repris ; l'assurance PNO
 * n'est reprise que si elle a été enregistrée depuis son ajout (format 2), pour ne pas imposer
 * 0 € aux comptes qui avaient enregistré leurs valeurs auparavant.
 */
export function userDefaults(saved: Record<string, unknown> | null | undefined): SimulationInputs {
  const s = saved ?? {};
  const picked: Record<string, unknown> = {};
  for (const k of DEFAULT_SETTING_FIELDS) {
    if (k === 'pnoAnnual' && s._v !== 2) continue;
    if (s[k] !== undefined) picked[k] = s[k];
  }
  return normalizeInputs(picked, DEFAULT_INPUTS);
}

/** Arrondi commercial au centime (demi vers l'infini), robuste aux erreurs binaires. */
export function round2(x: number): number {
  const s = Math.sign(x);
  return (s * Math.round(Math.abs(x) * 100 + 1e-9)) / 100;
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = v.replace(/\s/g, '').replace(',', '.');
    if (t === '') return 0;
    return Number(t);
  }
  if (v === null || v === undefined) return 0;
  return Number.NaN;
}

/** Complète des entrées partielles (formulaire, base, ancienne version) avec les valeurs par défaut. */
export function normalizeInputs(partial: Partial<Record<keyof SimulationInputs, unknown>> | null | undefined, defaults: SimulationInputs = DEFAULT_INPUTS): SimulationInputs {
  const p = partial ?? {};
  const out: SimulationInputs = { ...defaults };
  for (const k of NUMERIC_FIELDS) {
    if (p[k] !== undefined) out[k] = toNumber(p[k]);
  }
  if (p.priceMode === 'hors_honoraires' || p.priceMode === 'honoraires_inclus') out.priceMode = p.priceMode;
  if (p.notaryMode === 'percent' || p.notaryMode === 'amount') out.notaryMode = p.notaryMode;
  if (p.deferralType === 'aucun' || p.deferralType === 'partiel' || p.deferralType === 'total') out.deferralType = p.deferralType;
  if (typeof p.useLoan === 'boolean') out.useLoan = p.useLoan;
  if (p.rentMode === 'bas' || p.rentMode === 'haut' || p.rentMode === 'manuel') out.rentMode = p.rentMode;
  // Scénario enregistré avant l'ajout du loyer au m² : le loyer saisi est conservé tel quel.
  else if (p.monthlyRent !== undefined) out.rentMode = 'manuel';
  // Fourchette de loyer au m² héritée de l'ancienne version
  const legacy = (p as { legacy?: { rentM2Low?: unknown; rentM2High?: unknown } }).legacy;
  if (legacy && p.rentM2Low === undefined && typeof legacy.rentM2Low === 'number') out.rentM2Low = legacy.rentM2Low;
  if (legacy && p.rentM2High === undefined && typeof legacy.rentM2High === 'number') out.rentM2High = legacy.rentM2High;
  return out;
}

/**
 * Cash-flow mensuel affiché : seulement une fois le loyer connu (prix au m² et surface, ou loyer saisi).
 * Avant, la simulation ne montrerait que les charges (ex. −69 €) : elle n'est pas encore lancée.
 */
export function simulatedCashflow(r: { monthlyRent: number; cashflowMonthlyYear1: number } | null | undefined): number | null {
  return r && r.monthlyRent > 0 ? r.cashflowMonthlyYear1 : null;
}

/** Loyer hors charges mensuel retenu (surface × prix au m², ou montant saisi). */
export function effectiveRent(i: Pick<SimulationInputs, 'rentMode' | 'surface' | 'rentM2Low' | 'rentM2High' | 'monthlyRent'>): number {
  if (i.rentMode === 'bas') return round2(i.surface * i.rentM2Low);
  if (i.rentMode === 'haut') return round2(i.surface * i.rentM2High);
  return round2(i.monthlyRent);
}

/** Valeurs proposées à partir des charges de copropriété : 80 % récupérables, en euros entiers arrondis au supérieur. */
export const RECOVERABLE_SHARE = 0.8;
export function autoRecoverableAnnual(coproAnnual: number): number {
  return coproAnnual > 0 ? Math.ceil(round2(coproAnnual * RECOVERABLE_SHARE)) : 0;
}
export function autoProvisionMonthly(coproAnnual: number): number {
  return coproAnnual > 0 ? Math.ceil(round2((coproAnnual * RECOVERABLE_SHARE) / 12)) : 0;
}

/** Prix proposé exprimé frais d'agence inclus, comparable au prix de présentation FAI. */
export function offerFai(i: Pick<SimulationInputs, 'priceMode' | 'price' | 'agencyFees'>): number {
  return round2(i.priceMode === 'honoraires_inclus' ? i.price : i.price + i.agencyFees);
}

export interface FieldError {
  field: keyof SimulationInputs;
  message: string;
}

export function validateInputs(i: SimulationInputs): FieldError[] {
  const errors: FieldError[] = [];
  for (const k of NUMERIC_FIELDS) {
    const v = i[k];
    if (!Number.isFinite(v)) errors.push({ field: k, message: 'Valeur numérique invalide.' });
    else if (v < 0) errors.push({ field: k, message: 'La valeur ne peut pas être négative.' });
  }
  if (errors.length) return errors;
  if (i.price > 1e9) errors.push({ field: 'price', message: 'Prix hors limites.' });
  if (i.priceMode === 'honoraires_inclus' && i.agencyFees > i.price) {
    errors.push({ field: 'agencyFees', message: 'Les honoraires inclus dépassent le prix proposé.' });
  }
  if (i.notaryMode === 'percent' && i.notaryRate > 20) errors.push({ field: 'notaryRate', message: 'Taux de frais de notaire supérieur à 20 %.' });
  if (i.useLoan) {
    if (i.interestRate > 25) errors.push({ field: 'interestRate', message: 'Taux supérieur à 25 %.' });
    if (i.insuranceRate > 5) errors.push({ field: 'insuranceRate', message: "Taux d'assurance supérieur à 5 %." });
    if (!Number.isInteger(i.loanYears) || i.loanYears < 1 || i.loanYears > 40) {
      errors.push({ field: 'loanYears', message: 'Durée entière entre 1 et 40 ans.' });
    }
    if (i.deferralType !== 'aucun') {
      if (!Number.isInteger(i.deferralMonths) || i.deferralMonths < 1 || i.deferralMonths > 36) {
        errors.push({ field: 'deferralMonths', message: 'Différé : nombre entier de mois entre 1 et 36.' });
      } else if (i.deferralMonths >= i.loanYears * 12) {
        errors.push({ field: 'deferralMonths', message: 'Le différé doit être plus court que la durée du prêt.' });
      }
    }
  }
  if (i.rentMode !== 'manuel' && i.rentM2Low > 0 && i.rentM2High > 0 && i.rentM2Low > i.rentM2High) {
    errors.push({ field: 'rentM2High', message: 'Le loyer au m² haut doit être supérieur ou égal au bas.' });
  }
  if (i.coproRecoverableAnnual > i.coproChargesAnnual) {
    errors.push({ field: 'coproRecoverableAnnual', message: 'La part récupérable dépasse les charges de copropriété.' });
  }
  if (i.propertyTaxRecoverableAnnual > i.propertyTaxAnnual) {
    errors.push({ field: 'propertyTaxRecoverableAnnual', message: 'La part récupérable dépasse la taxe foncière.' });
  }
  return errors;
}

export interface AmortizationRow {
  month: number;
  year: number;
  phase: 'differe_partiel' | 'differe_total' | 'amortissement';
  /** Échéance de crédit hors assurance. */
  payment: number;
  interest: number;
  principal: number;
  /** Intérêts capitalisés (différé total). */
  capitalized: number;
  insurance: number;
  balance: number;
}

export interface AmortizationYear {
  year: number;
  payments: number;
  interest: number;
  principal: number;
  insurance: number;
  balance: number;
}

/**
 * Tableau d'amortissement mensuel (échéances constantes après différé).
 * Conventions : intérêts du mois = solde × taux/12 arrondis au centime ;
 * échéance arrondie au centime ; la dernière échéance solde exactement le capital.
 */
export function amortize(loan: number, annualRatePct: number, months: number, insuranceMonthly: number,
  deferralType: DeferralType = 'aucun', deferralMonths = 0): AmortizationRow[] {
  const rows: AmortizationRow[] = [];
  if (loan <= 0 || months <= 0) return rows;
  const r = annualRatePct / 100 / 12;
  const d = deferralType === 'aucun' ? 0 : deferralMonths;
  let balance = round2(loan);
  for (let m = 1; m <= d; m++) {
    const interest = round2(balance * r);
    if (deferralType === 'partiel') {
      rows.push({ month: m, year: Math.ceil(m / 12), phase: 'differe_partiel', payment: interest, interest, principal: 0, capitalized: 0, insurance: insuranceMonthly, balance });
    } else {
      balance = round2(balance + interest);
      rows.push({ month: m, year: Math.ceil(m / 12), phase: 'differe_total', payment: 0, interest: 0, principal: 0, capitalized: interest, insurance: insuranceMonthly, balance });
    }
  }
  const n = months - d;
  const payment = round2(r === 0 ? balance / n : (balance * r) / (1 - Math.pow(1 + r, -n)));
  for (let k = 1; k <= n; k++) {
    const m = d + k;
    const interest = round2(balance * r);
    let principal = round2(payment - interest);
    let pay = payment;
    if (k === n || principal > balance) {
      principal = balance;
      pay = round2(principal + interest);
    }
    balance = round2(balance - principal);
    rows.push({ month: m, year: Math.ceil(m / 12), phase: 'amortissement', payment: pay, interest, principal, capitalized: 0, insurance: insuranceMonthly, balance });
  }
  return rows;
}

export function yearlySummary(rows: AmortizationRow[]): AmortizationYear[] {
  const map = new Map<number, AmortizationYear>();
  for (const r of rows) {
    const y = map.get(r.year) ?? { year: r.year, payments: 0, interest: 0, principal: 0, insurance: 0, balance: 0 };
    y.payments = round2(y.payments + r.payment);
    y.interest = round2(y.interest + r.interest);
    y.principal = round2(y.principal + r.principal);
    y.insurance = round2(y.insurance + r.insurance);
    y.balance = r.balance;
    map.set(r.year, y);
  }
  return [...map.values()];
}

export interface SimulationResult {
  // négociation
  offerFai: number;
  /** Prix de présentation FAI − prix proposé FAI (positif = rabais obtenu). */
  negotiationAmount: number | null;
  /** En % du prix de présentation FAI. */
  negotiationPct: number | null;
  pricePerM2: number | null;
  // loyer
  monthlyRent: number;
  monthlyRentWithCharges: number;
  // acquisition
  netPrice: number;
  notaryBase: number;
  notaryFees: number;
  agencyFees: number;
  totalCost: number;
  equity: number;
  unusedDownPayment: number;
  // financement
  loanAmount: number;
  months: number;
  /** Mensualité de crédit en phase d'amortissement, hors assurance. */
  monthlyPayment: number;
  monthlyInsurance: number;
  /** Mensualité assurance comprise, en phase d'amortissement. */
  monthlyPaymentWithInsurance: number;
  totalInterest: number;
  totalInsurance: number;
  financingFees: number;
  /** Coût du crédit : intérêts + assurance + garantie + dossier. */
  financingCost: number;
  amortization: AmortizationRow[];
  years: AmortizationYear[];
  // exploitation (année pleine, hors fiscalité)
  annualRent: number;
  annualVacancy: number;
  annualOwnerCharges: number;
  ownerChargesDetail: { label: string; amount: number }[];
  annualNetOperatingIncome: number;
  grossYield: number;
  netYield: number;
  /** Remboursements année 1 (crédit + assurance). */
  year1DebtService: number;
  year1PrincipalRepaid: number;
  /** Cash-flow avant fiscalité, moyenne mensuelle sur l'année 1. */
  cashflowMonthlyYear1: number;
  cashflowAnnualYear1: number;
  /** Cash-flow mensuel en phase d'amortissement (après différé). */
  cashflowMonthlySteady: number;
  warnings: string[];
}

export type SimulationOutcome = { ok: true; result: SimulationResult } | { ok: false; errors: FieldError[] };

export function simulate(inputs: SimulationInputs): SimulationOutcome {
  const errors = validateInputs(inputs);
  if (errors.length) return { ok: false, errors };
  const i = inputs;
  const warnings: string[] = [];

  const netPrice = round2(i.priceMode === 'honoraires_inclus' ? i.price - i.agencyFees : i.price);
  const notaryBase = netPrice;
  const notaryFees = round2(i.notaryMode === 'percent' ? (notaryBase * i.notaryRate) / 100 : i.notaryAmount);
  const financingFees = round2(i.guaranteeFees + i.dossierFees);
  const totalCost = round2(netPrice + i.agencyFees + notaryFees + i.works + i.furniture + financingFees);

  let loanAmount = 0;
  let unusedDownPayment = 0;
  if (i.useLoan) {
    loanAmount = round2(Math.max(0, totalCost - i.downPayment));
    if (i.downPayment > totalCost) {
      unusedDownPayment = round2(i.downPayment - totalCost);
      warnings.push("L'apport dépasse le coût total : aucun emprunt n'est nécessaire.");
    }
  }
  const equity = round2(totalCost - loanAmount);
  const months = loanAmount > 0 ? Math.round(i.loanYears * 12) : 0;
  const monthlyInsurance = loanAmount > 0 ? round2((loanAmount * i.insuranceRate) / 100 / 12) : 0;
  const amortization = amortize(loanAmount, i.interestRate, months, monthlyInsurance, i.deferralType, i.deferralMonths);
  const years = yearlySummary(amortization);
  const steady = amortization.find((r) => r.phase === 'amortissement');
  const monthlyPayment = steady ? steady.payment : 0;
  const totalInterest = round2(amortization.reduce((a, r) => a + r.interest + r.capitalized, 0));
  const totalInsurance = round2(amortization.reduce((a, r) => a + r.insurance, 0));
  const financingCost = round2(totalInterest + totalInsurance + financingFees);

  const monthlyRent = effectiveRent(i);
  const monthlyRentWithCharges = round2(monthlyRent + i.chargesProvisionMonthly);
  const fai = offerFai(i);
  const negotiationAmount = i.askingPrice > 0 && i.price > 0 ? round2(i.askingPrice - fai) : null;
  const negotiationPct = negotiationAmount !== null ? (negotiationAmount / i.askingPrice) * 100 : null;
  const pricePerM2 = i.surface > 0 && i.price > 0 ? round2(fai / i.surface) : null;
  const annualRent = round2(monthlyRent * 12);
  const ownerChargesDetail = [
    { label: 'Copropriété non récupérable', amount: round2(i.coproChargesAnnual - i.coproRecoverableAnnual) },
    { label: 'Taxe foncière non récupérable', amount: round2(i.propertyTaxAnnual - i.propertyTaxRecoverableAnnual) },
    { label: 'Assurance PNO', amount: i.pnoAnnual },
    { label: 'Gestion', amount: i.managementAnnual },
    { label: 'GLI', amount: i.gliAnnual },
    { label: 'Entretien', amount: i.maintenanceAnnual },
    { label: 'Autres charges', amount: i.otherChargesAnnual },
  ];
  const annualOwnerCharges = round2(ownerChargesDetail.reduce((a, c) => a + c.amount, 0));
  const annualVacancy = round2(i.vacancyAnnual);
  const annualNetOperatingIncome = round2(annualRent - annualVacancy - annualOwnerCharges);
  const grossYield = totalCost > 0 ? (annualRent / totalCost) * 100 : 0;
  const netYield = totalCost > 0 ? (annualNetOperatingIncome / totalCost) * 100 : 0;

  const y1 = years[0];
  const year1DebtService = y1 ? round2(y1.payments + y1.insurance) : 0;
  const year1PrincipalRepaid = y1 ? y1.principal : 0;
  const cashflowAnnualYear1 = round2(annualNetOperatingIncome - year1DebtService);
  const cashflowMonthlyYear1 = round2(cashflowAnnualYear1 / 12);
  const cashflowMonthlySteady = round2(annualNetOperatingIncome / 12 - monthlyPayment - monthlyInsurance);

  const recoverable = i.coproRecoverableAnnual + i.propertyTaxRecoverableAnnual;
  const provisions = i.chargesProvisionMonthly * 12;
  if (Math.abs(provisions - recoverable) > Math.max(50, recoverable * 0.1)) {
    warnings.push(`Provisions sur charges (${round2(provisions)} €/an) éloignées des charges récupérables (${round2(recoverable)} €/an) : une régularisation annuelle sera à prévoir.`);
  }
  if (monthlyRent === 0) warnings.push(i.rentMode === 'manuel' ? 'Loyer non renseigné : rendements et cash-flow non significatifs.' : 'Renseignez la surface et le loyer au m² pour calculer le loyer.');
  if (negotiationAmount !== null && negotiationAmount < 0) warnings.push('Le prix proposé dépasse le prix de présentation.');
  if (i.price === 0) warnings.push('Prix non renseigné.');

  return {
    ok: true,
    result: {
      offerFai: fai, negotiationAmount, negotiationPct, pricePerM2, monthlyRent, monthlyRentWithCharges,
      netPrice, notaryBase, notaryFees, agencyFees: round2(i.agencyFees), totalCost, equity, unusedDownPayment,
      loanAmount, months, monthlyPayment, monthlyInsurance, monthlyPaymentWithInsurance: round2(monthlyPayment + monthlyInsurance),
      totalInterest, totalInsurance, financingFees, financingCost, amortization, years,
      annualRent, annualVacancy, annualOwnerCharges, ownerChargesDetail, annualNetOperatingIncome,
      grossYield, netYield, year1DebtService, year1PrincipalRepaid, cashflowMonthlyYear1, cashflowAnnualYear1,
      cashflowMonthlySteady, warnings,
    },
  };
}

/** Résumé compact stocké avec le scénario (sans le tableau d'amortissement). */
export function summarize(r: SimulationResult) {
  return {
    engineVersion: ENGINE_VERSION,
    totalCost: r.totalCost,
    loanAmount: r.loanAmount,
    monthlyPaymentWithInsurance: r.monthlyPaymentWithInsurance,
    financingCost: r.financingCost,
    annualRent: r.annualRent,
    grossYield: Math.round(r.grossYield * 100) / 100,
    netYield: Math.round(r.netYield * 100) / 100,
    cashflowMonthlyYear1: r.cashflowMonthlyYear1,
    cashflowMonthlySteady: r.cashflowMonthlySteady,
  };
}
export type ScenarioSummary = ReturnType<typeof summarize>;
