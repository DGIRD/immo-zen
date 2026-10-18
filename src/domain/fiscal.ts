/**
 * Déclaration fiscale annuelle (revenus de l'année N déclarés en N+1), par régime renseigné sur chaque bien.
 *
 * Sources : formulaire 2044 (édition 2026, revenus 2025), 2042 cases 4BA à 4BE, 2042-C-PRO cases 5ND, 5NA, 5NY.
 * Principe de caisse : recettes encaissées et dépenses payées pendant l'année civile.
 * Aide au remplissage : ne vaut ni attestation ni conseil fiscal. Les montants sont à vérifier avec les notices.
 */
import type { Allocation, Expense, ExpenseCategory, Lease, Payment, Property, RentCharge, TaxPropertyInputs, TaxRegime } from '../data/types.ts';
import { isIncome } from './rental.ts';
import { amortize, round2 } from './simulator.ts';

export const MICRO_FONCIER_LIMIT = 15000;
export const MICRO_BIC_LIMIT = 77700;
export const FONCIER_DEFICIT_LIMIT = 10700;
export const FORFAIT_222 = 20;
export const DEFAULT_TAX_INPUTS: Required<Pick<TaxPropertyInputs, 'land_pct' | 'building_years' | 'furniture_years' | 'works_years'>> = {
  land_pct: 15, building_years: 30, furniture_years: 7, works_years: 10,
};

export interface FiscalData {
  properties: Property[];
  leases: Lease[];
  charges: RentCharge[];
  payments: Payment[];
  allocations: Allocation[];
  expenses: Expense[];
}

/** Montants de l'année pour un bien (avant application d'un régime). */
export interface YearAmounts {
  /** Loyers hors charges encaissés (paiements des baux, au prorata loyer / charges de chaque échéance). */
  rentsHC: number;
  /** Provisions et forfaits de charges encaissés. */
  chargesCollected: number;
  /** Paiements non affectés à une échéance (avances), comptés en loyers. */
  advances: number;
  /** Recettes importées (catégorie Loyer), déjà comprises dans rentsHC / chargesCollected. */
  importedIncome: number;
  otherIncome: number;
  byCategory: Partial<Record<ExpenseCategory, number>>;
  /** Mêmes montants hors dépenses amortissables (LMNP réel : elles sont amorties, pas déduites). */
  byCategoryCurrent: Partial<Record<ExpenseCategory, number>>;
  /** Part récupérable de la taxe foncière (ordures ménagères), non déductible au foncier. */
  teom: number;
  /** Intérêts et assurance du crédit retenus (relevé si saisis, sinon tableau d'amortissement du bien). */
  interest: number;
  interestSource: 'depenses' | 'credit' | 'aucun';
  loanInsurance: number;
  loanInsuranceSource: 'depenses' | 'credit' | 'aucun';
  /** Mensualités saisies en catégorie « Crédit » (trésorerie, non déductibles en tant que telles). */
  repayments: number;
  warnings: string[];
}

const inYear = (d: string | null | undefined, y: number) => !!d && d.startsWith(String(y));
const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));

function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** Intérêts et assurance d'emprunt échus dans l'année, d'après le crédit saisi sur le bien. */
export function loanYear(p: Property, year: number): { interest: number; insurance: number; principal: number; months: number } | null {
  const amount = p.loan_amount ?? 0;
  const months = Math.round((p.loan_years ?? 0) * 12);
  if (amount <= 0 || months <= 0 || !p.loan_start_date) return null;
  const rows = amortize(amount, p.loan_rate ?? 0, months, 0);
  let interest = 0, principal = 0, n = 0;
  rows.forEach((r, i) => {
    if (inYear(addMonths(p.loan_start_date!, i), year)) { interest += r.interest; principal += r.principal; n++; }
  });
  return { interest: round2(interest), principal: round2(principal), insurance: round2((p.loan_insurance_monthly ?? 0) * n), months: n };
}

export function yearAmounts(p: Property, year: number, d: FiscalData, inputs: TaxPropertyInputs = {}): YearAmounts {
  const warnings: string[] = [];
  const leaseIds = new Set(d.leases.filter((l) => l.property_id === p.id).map((l) => l.id));
  const charges = new Map(d.charges.filter((c) => leaseIds.has(c.lease_id)).map((c) => [c.id, c]));
  let rentsHC = 0, chargesCollected = 0, advances = 0;
  for (const pay of d.payments.filter((x) => leaseIds.has(x.lease_id) && inYear(x.paid_on, year))) {
    const allocs = d.allocations.filter((a) => a.payment_id === pay.id);
    for (const a of allocs) {
      const c = charges.get(a.charge_id);
      const total = c ? c.rent_amount + c.charges_amount : 0;
      const share = c && total > 0 ? c.rent_amount / total : 1;
      rentsHC += a.amount * share;
      chargesCollected += a.amount * (1 - share);
    }
    advances += pay.amount - allocs.reduce((s, a) => s + a.amount, 0);
  }
  if (advances > 0.005) warnings.push(`Paiements non affectés à une échéance (${round2(advances)} €) comptés en loyers de l'année.`);
  rentsHC += Math.max(0, advances);

  const exp = d.expenses.filter((e) => e.property_id === p.id && e.payment_status === 'paye' && inYear(e.paid_on ?? e.expense_date, year));
  const income = exp.filter(isIncome);
  const importedIncome = sum(income.map((e) => e.amount));
  if (importedIncome > 0) {
    // une recette de relevé est un loyer charges comprises : répartition selon le loyer et la provision du bien
    const rent = p.estimated_rent ?? 0, prov = p.charges_provision ?? 0;
    const share = rent > 0 && prov > 0 ? rent / (rent + prov) : 1;
    rentsHC += importedIncome * share;
    chargesCollected += importedIncome * (1 - share);
    if (share === 1 && prov === 0 && !(rent > 0)) warnings.push('Loyers importés comptés en totalité hors charges : renseignez le loyer et la provision du bien pour en séparer les charges.');
    if (d.payments.some((x) => leaseIds.has(x.lease_id) && inYear(x.paid_on, year))) warnings.push('Loyers saisis sur un bail ET importés d’un relevé : vérifiez qu’ils ne sont pas comptés deux fois.');
  }

  const byCategory: Partial<Record<ExpenseCategory, number>> = {};
  const byCategoryCurrent: Partial<Record<ExpenseCategory, number>> = {};
  let teom = 0;
  for (const e of exp.filter((x) => !isIncome(x))) {
    byCategory[e.category] = round2((byCategory[e.category] ?? 0) + e.amount);
    if (!isDepreciable(e)) byCategoryCurrent[e.category] = round2((byCategoryCurrent[e.category] ?? 0) + e.amount);
    if (e.category === 'taxe_fonciere') teom += e.recoverable_amount;
  }

  const loan = loanYear(p, year);
  const interestExp = (byCategory.interets ?? 0);
  const insuranceExp = (byCategory.assurance_credit ?? 0);
  const interest = interestExp > 0 ? interestExp : loan?.interest ?? 0;
  const loanInsurance = insuranceExp > 0 ? insuranceExp : loan?.insurance ?? 0;
  const repayments = byCategory.credit ?? 0;
  if (repayments > 0 && !loan && interestExp === 0) warnings.push('Mensualités de crédit importées sans crédit renseigné sur le bien : les intérêts déductibles ne peuvent pas être isolés (Mes biens → Modifier → Crédit).');
  if (loan && repayments > 0 && Math.abs(repayments - (loan.interest + loan.principal + loan.insurance)) > Math.max(50, repayments * 0.05))
    warnings.push(`Mensualités du relevé (${round2(repayments)} €) différentes du crédit renseigné (${round2(loan.interest + loan.principal + loan.insurance)} €) : vérifiez le crédit du bien.`);

  return {
    rentsHC: round2(rentsHC), chargesCollected: round2(chargesCollected), advances: round2(Math.max(0, advances)), importedIncome,
    otherIncome: round2(inputs.other_income ?? 0), byCategory, byCategoryCurrent, teom: round2(teom),
    interest: round2(interest), interestSource: interestExp > 0 ? 'depenses' : loan ? 'credit' : 'aucun',
    loanInsurance: round2(loanInsurance), loanInsuranceSource: insuranceExp > 0 ? 'depenses' : loan && loan.insurance > 0 ? 'credit' : 'aucun',
    repayments, warnings,
  };
}

const cat = (a: YearAmounts, ...cs: ExpenseCategory[]) => sum(cs.map((c) => a.byCategory[c] ?? 0));
const catCur = (a: YearAmounts, ...cs: ExpenseCategory[]) => sum(cs.map((c) => a.byCategoryCurrent[c] ?? 0));

// ---------------------------------------------------------------- location nue au réel (2044)

export interface Line2044 { code: string; label: string; amount: number }
export interface Foncier2044 {
  propertyId: string;
  lines: Line2044[];
  r215: number; r240: number; r250: number; r263: number;
  notDeductible: { label: string; amount: number }[];
}

export function foncier2044(p: Property, a: YearAmounts, inputs: TaxPropertyInputs = {}): Foncier2044 {
  const l211 = a.rentsHC;
  const l213 = a.otherIncome;
  const l215 = round2(l211 + l213);
  const l221 = cat(a, 'gestion');
  const l222 = l211 > 0 ? FORFAIT_222 : 0;
  const l223 = cat(a, 'assurance');
  const l224 = cat(a, 'entretien', 'entretien_amortissable', 'travaux');
  const l227 = round2(Math.max(0, cat(a, 'taxe_fonciere') - a.teom));
  const l229 = cat(a, 'copropriete');
  const l230 = round2(inputs.regularisation ?? 0);
  const l240 = round2(l221 + l222 + l223 + l224 + l227 + l229 - l230);
  const l250 = round2(a.interest + a.loanInsurance + cat(a, 'frais_credit'));
  const l263 = round2(l215 - l240 - l250);
  return {
    propertyId: p.id,
    lines: [
      { code: '211', label: 'Loyers bruts encaissés (hors charges)', amount: l211 },
      { code: '213', label: 'Recettes brutes diverses', amount: l213 },
      { code: '215', label: 'Total des recettes', amount: l215 },
      { code: '221', label: 'Frais d’administration et de gestion', amount: l221 },
      { code: '222', label: 'Autres frais de gestion (20 € par local)', amount: l222 },
      { code: '223', label: 'Primes d’assurance', amount: l223 },
      { code: '224', label: 'Dépenses de réparation, d’entretien et d’amélioration', amount: l224 },
      { code: '227', label: 'Taxes foncières (hors ordures ménagères)', amount: l227 },
      { code: '229', label: 'Provisions pour charges de copropriété payées', amount: l229 },
      { code: '230', label: 'Régularisation des provisions déduites l’an dernier (à déduire)', amount: l230 },
      { code: '240', label: 'Total des frais et charges', amount: l240 },
      { code: '250', label: 'Intérêts d’emprunt, assurance et frais d’emprunt', amount: l250 },
      { code: '263', label: 'Bénéfice (+) ou déficit (−)', amount: l263 },
    ],
    r215: l215, r240: l240, r250: l250, r263: l263,
    notDeductible: [
      { label: 'Meubles (location nue)', amount: cat(a, 'mobilier') },
      { label: 'Frais bancaires (couverts par le forfait de la ligne 222)', amount: cat(a, 'frais_bancaires') },
      { label: 'Remboursement de capital et mensualités', amount: round2(cat(a, 'credit')) },
      { label: 'Autres dépenses non classées', amount: cat(a, 'autre') },
    ].filter((x) => x.amount > 0),
  };
}

/** Répartition du résultat foncier entre les cases 4BA, 4BB et 4BC (2044, lignes 420 à 442). */
export function foncierBoxes(list: Foncier2044[]) {
  const A = sum(list.map((x) => x.r215));
  const B = sum(list.map((x) => x.r240));
  const C = sum(list.map((x) => x.r250));
  const l420 = round2(A - B - C);
  if (l420 >= 0) return { l420, box4BA: l420, box4BB: 0, box4BC: 0, detail: [] as [string, number][] };
  if (C > A) {
    const l436 = round2(Math.min(B, FONCIER_DEFICIT_LIMIT));
    const l437 = round2(B - l436);
    const l438 = round2(C - A);
    return { l420, box4BA: 0, box4BB: round2(l437 + l438), box4BC: l436, detail: [['436', l436], ['437', l437], ['438', l438], ['439', round2(l437 + l438)]] as [string, number][] };
  }
  const deficit = -l420;
  const l441 = round2(Math.min(deficit, FONCIER_DEFICIT_LIMIT));
  return { l420, box4BA: 0, box4BB: round2(deficit - l441), box4BC: l441, detail: [['441', l441], ['442', round2(deficit - l441)]] as [string, number][] };
}

// ---------------------------------------------------------------- meublé au réel (LMNP)

export interface DepreciationItem { label: string; kind: 'bati' | 'meuble' | 'travaux'; expenseId?: string; base: number; years: number; start: string; amount: number; cumulated: number; remaining: number }
export interface ReelBic {
  propertyId: string;
  receipts: number;
  charges: { label: string; amount: number }[];
  chargesTotal: number;
  interest: number;
  resultBeforeDepreciation: number;
  depreciation: DepreciationItem[];
  depreciationYear: number;
  deferredBefore: number;
  depreciationDeducted: number;
  deferredAfter: number;
  /** 2042-C-PRO : 5NA (bénéfice) ou 5NY (déficit). */
  box5NA: number;
  box5NY: number;
  warnings: string[];
}

function yearFraction(start: string, years: number, year: number): number {
  // part de l'année civile comprise dans [début, début + durée), au jour près (base 365)
  const s = Date.parse(start + 'T00:00:00Z');
  const e = Date.parse(addMonths(start, Math.round(years * 12)) + 'T00:00:00Z');
  const ys = Date.UTC(year, 0, 1), ye = Date.UTC(year + 1, 0, 1);
  const days = Math.max(0, Math.min(e, ye) - Math.max(s, ys)) / 86400000;
  return Math.min(1, days / 365);
}

/** Dépense amortissable : durée saisie sur la dépense, ou catégorie/nature d'immobilisation. */
export function isDepreciable(e: Expense): boolean {
  return (e.amortization_years ?? 0) > 0 || e.category === 'mobilier' || e.category === 'entretien_amortissable' || e.nature === 'immobilisation';
}
export function expenseYears(e: Expense, inputs: TaxPropertyInputs = {}): number {
  const prm = { ...DEFAULT_TAX_INPUTS, ...inputs };
  return e.amortization_years && e.amortization_years > 0 ? e.amortization_years : e.category === 'mobilier' ? prm.furniture_years : prm.works_years;
}

/** Dotation d'une année, cumul à la fin de l'année (plafonné à la base) et reste à amortir. */
function slice(base: number, years: number, start: string, year: number) {
  let cum = 0;
  for (let y = Number(start.slice(0, 4)); y <= year; y++) cum += base / years * yearFraction(start, years, y);
  const cumulated = round2(Math.min(base, cum));
  const before = round2(Math.min(base, cum - base / years * yearFraction(start, years, year)));
  return { amount: round2(cumulated - before), cumulated, remaining: round2(base - cumulated) };
}

/**
 * Amortissements d'un bien pour l'année : bâti (si demandé), meubles et travaux amortissables.
 * Durée de chaque dépense : celle saisie sur la dépense, sinon la durée par défaut de sa catégorie.
 */
export function depreciationItems(p: Property, year: number, d: FiscalData, inputs: TaxPropertyInputs, withBuilding = true): { items: DepreciationItem[]; warnings: string[] } {
  const prm = { ...DEFAULT_TAX_INPUTS, ...inputs };
  const items: DepreciationItem[] = [];
  const warnings: string[] = [];
  if (withBuilding) {
    const base = inputs.depreciable_base ?? p.acquisition_cost ?? p.acquisition_snapshot?.results?.totalCost ?? null;
    if (!base) warnings.push('Coût d’acquisition inconnu : amortissement du bâti non calculé (renseignez-le dans Mes biens ou ci-dessous).');
    else if (!p.acquired_at) warnings.push('Date d’acquisition inconnue : amortissement du bâti non calculé.');
    else {
      const building = round2(base * (1 - prm.land_pct / 100));
      items.push({ label: `Bâti (${100 - prm.land_pct} % de ${round2(base)} €)`, kind: 'bati', base: building, years: prm.building_years, start: p.acquired_at, ...slice(building, prm.building_years, p.acquired_at, year) });
    }
  }
  for (const e of d.expenses.filter((x) => x.property_id === p.id && x.payment_status === 'paye' && isDepreciable(x))) {
    const start = e.paid_on ?? e.expense_date;
    if (start.slice(0, 4) > String(year)) continue;
    const years = expenseYears(e, inputs);
    items.push({ label: `${e.category === 'mobilier' ? 'Meuble' : 'Travaux'} : ${e.label || e.supplier || start}`, kind: e.category === 'mobilier' ? 'meuble' : 'travaux', expenseId: e.id,
      base: e.amount, years, start, ...slice(e.amount, years, start, year) });
  }
  return { items, warnings };
}

/** Résultat LMNP au réel de l'année ; l'amortissement ne peut créer ni augmenter un déficit (art. 39 C du CGI) : l'excédent est reporté. */
export function reelBic(p: Property, year: number, d: FiscalData, inputsByYear: (y: number) => TaxPropertyInputs): ReelBic {
  const first = Math.min(year, Number((p.acquired_at ?? `${year}`).slice(0, 4)));
  let deferred = 0;
  let out: ReelBic | null = null;
  for (let y = first; y <= year; y++) {
    const inputs = inputsByYear(y);
    const a = yearAmounts(p, y, d, inputs);
    const receipts = round2(a.rentsHC + a.chargesCollected + a.otherIncome);
    const charges = [
      { label: 'Charges de copropriété', amount: catCur(a, 'copropriete') },
      { label: 'Taxe foncière', amount: catCur(a, 'taxe_fonciere') },
      { label: 'Assurances', amount: catCur(a, 'assurance') },
      { label: 'Entretien et petits travaux', amount: catCur(a, 'entretien') },
      { label: 'Gestion locative', amount: catCur(a, 'gestion') },
      { label: 'Frais bancaires et financiers', amount: catCur(a, 'frais_bancaires') },
      { label: 'Frais de crédit', amount: catCur(a, 'frais_credit') },
      { label: 'Assurance emprunteur', amount: a.loanInsurance },
      { label: 'Autres charges', amount: catCur(a, 'autre') },
    ].filter((c) => c.amount > 0);
    const chargesTotal = sum(charges.map((c) => c.amount));
    const r0 = round2(receipts - chargesTotal - a.interest);
    const dep = depreciationItems(p, y, d, inputs);
    const depYear = sum(dep.items.map((i) => i.amount));
    const available = round2(depYear + deferred);
    const deducted = r0 > 0 ? round2(Math.min(available, r0)) : 0;
    const deferredBefore = deferred;
    deferred = round2(available - deducted);
    if (y === year) {
      out = {
        propertyId: p.id, receipts, charges, chargesTotal, interest: a.interest, resultBeforeDepreciation: r0,
        depreciation: dep.items, depreciationYear: depYear, deferredBefore, depreciationDeducted: deducted, deferredAfter: deferred,
        box5NA: r0 > 0 ? round2(r0 - deducted) : 0, box5NY: r0 < 0 ? round2(-r0) : 0,
        warnings: [...a.warnings, ...dep.warnings],
      };
    }
  }
  return out!;
}

// ---------------------------------------------------------------- synthèse

export interface FiscalSummary {
  year: number;
  byRegime: Record<TaxRegime | 'non_renseigne', Property[]>;
  amounts: Map<string, YearAmounts>;
  microFoncier: { box4BE: number; taxable: number; warnings: string[] } | null;
  reelFoncier: { perProperty: Foncier2044[]; boxes: ReturnType<typeof foncierBoxes>; warnings: string[] } | null;
  microBic: { box5ND: number; taxable: number; warnings: string[] } | null;
  reelBic: { perProperty: ReelBic[]; box5NA: number; box5NY: number } | null;
  other: Property[];
  warnings: string[];
}

export function fiscalSummary(year: number, d: FiscalData, inputs: (propertyId: string, y: number) => TaxPropertyInputs): FiscalSummary {
  const all = d.properties.filter((p) => p.status === 'acquis');
  const allAmounts = new Map(all.map((p) => [p.id, yearAmounts(p, year, d, inputs(p.id, year))]));
  // biens détenus pendant l'année, ou ayant des mouvements cette année-là (date d'acquisition parfois approximative)
  const owned = all.filter((p) => {
    const a = allAmounts.get(p.id)!;
    return !p.acquired_at || p.acquired_at.slice(0, 4) <= String(year) || a.rentsHC + a.chargesCollected > 0 || Object.keys(a.byCategory).length > 0;
  });
  const byRegime = { micro_foncier: [], reel_foncier: [], micro_bic: [], reel_bic: [], is: [], autre: [], non_renseigne: [] } as FiscalSummary['byRegime'];
  for (const p of owned) byRegime[p.tax_regime ?? 'non_renseigne'].push(p);
  const amounts = new Map(owned.map((p) => [p.id, allAmounts.get(p.id)!]));
  const warnings: string[] = [];
  if (byRegime.non_renseigne.length) warnings.push(`${byRegime.non_renseigne.length} bien(s) sans régime fiscal : choisissez-le pour l’inclure.`);

  let microFoncier: FiscalSummary['microFoncier'] = null;
  if (byRegime.micro_foncier.length) {
    const box = sum(byRegime.micro_foncier.map((p) => amounts.get(p.id)!.rentsHC + amounts.get(p.id)!.otherIncome));
    const w: string[] = [];
    if (box > MICRO_FONCIER_LIMIT) w.push(`Recettes supérieures à ${MICRO_FONCIER_LIMIT} € : le micro-foncier ne s’applique pas, passez au régime réel (2044).`);
    if (byRegime.reel_foncier.length) w.push('Un foyer ne peut pas cumuler micro-foncier et réel pour ses locations nues : l’option pour le réel s’applique à tous les biens.');
    microFoncier = { box4BE: box, taxable: round2(box * 0.7), warnings: w };
  }

  let reelFoncier: FiscalSummary['reelFoncier'] = null;
  if (byRegime.reel_foncier.length) {
    const perProperty = byRegime.reel_foncier.map((p) => foncier2044(p, amounts.get(p.id)!, inputs(p.id, year)));
    reelFoncier = { perProperty, boxes: foncierBoxes(perProperty), warnings: [] };
  }

  let microBic: FiscalSummary['microBic'] = null;
  if (byRegime.micro_bic.length) {
    const box = sum(byRegime.micro_bic.map((p) => { const a = amounts.get(p.id)!; return a.rentsHC + a.chargesCollected + a.otherIncome; }));
    const w: string[] = [];
    if (box > MICRO_BIC_LIMIT) w.push(`Recettes supérieures à ${MICRO_BIC_LIMIT} € : le micro-BIC ne s’applique pas.`);
    // abattement de 50 %, au moins 305 €
    microBic = { box5ND: box, taxable: round2(Math.max(0, box - Math.max(box * 0.5, 305))), warnings: w };
  }

  let reel: FiscalSummary['reelBic'] = null;
  if (byRegime.reel_bic.length) {
    const perProperty = byRegime.reel_bic.map((p) => reelBic(p, year, d, (y) => inputs(p.id, y)));
    // les résultats des différents meublés se compensent dans la même activité LMNP
    const total = sum(perProperty.map((r) => r.box5NA - r.box5NY));
    reel = { perProperty, box5NA: total > 0 ? total : 0, box5NY: total < 0 ? round2(-total) : 0 };
  }

  return { year, byRegime, amounts, microFoncier, reelFoncier, microBic, reelBic: reel, other: [...byRegime.is, ...byRegime.autre], warnings };
}
