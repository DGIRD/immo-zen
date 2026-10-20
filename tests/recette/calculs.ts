/**
 * Recette des calculs du cahier de test (données de référence : T2 à 150 000 €).
 * Usage : node --import tsx tests/recette/calculs.ts  → JSON { id: { ok, detail } }
 */
import { DEFAULT_INPUTS, simulate, validateInputs, type SimulationInputs } from '../../src/domain/simulator.ts';
import { revisionPlan } from '../../src/domain/irl.ts';
import { fiscalSummary, foncierBoxes, loanYear, type FiscalData, type Foncier2044 } from '../../src/domain/fiscal.ts';
import { autoAllocate, chargeViews, leaseLedger, planCharges } from '../../src/domain/rental.ts';
import type { Expense, Property, RentCharge, Payment } from '../../src/data/types.ts';

const out: Record<string, { ok: boolean; detail: string }> = {};
const check = (id: string, fn: () => string) => {
  try { out[id] = { ok: true, detail: fn() }; } catch (e) { out[id] = { ok: false, detail: String((e as Error).message ?? e) }; }
};
const eq = (a: number, b: number, what: string, tol = 0.005) => { if (!Number.isFinite(a) || Math.abs(a - b) > tol) throw new Error(`${what} : obtenu ${a}, attendu ${b}`); };

const ref: SimulationInputs = {
  ...DEFAULT_INPUTS, price: 150000, agencyFees: 0, notaryRate: 7.5, works: 8000, downPayment: 9250, interestRate: 3.5, loanYears: 20,
  insuranceRate: 0.3, rentMode: 'manuel', monthlyRent: 750, propertyTaxAnnual: 900, coproChargesAnnual: 600, coproRecoverableAnnual: 0,
  pnoAnnual: 150, maintenanceAnnual: 300, vacancyAnnual: 750, surface: 45,
};

check('SIM-01', () => {
  const o = simulate(ref); if (!o.ok) throw new Error('simulation refusée');
  const r = o.result;
  eq(r.notaryFees, 11250, 'frais de notaire'); eq(r.totalCost, 169250, 'coût total'); eq(r.loanAmount, 160000, 'emprunt');
  eq(r.monthlyPayment, 927.94, 'mensualité'); eq(r.monthlyInsurance, 40, 'assurance'); eq(Math.round(r.grossYield * 100) / 100, 5.32, 'rentabilité brute');
  eq(r.annualNetOperatingIncome, 6300, 'revenu net'); eq(r.cashflowMonthlySteady, -442.94, 'cash-flow mensuel');
  eq(Math.round(r.totalInterest), 62706, 'intérêts totaux', 5);
  return `coût 169 250 €, mensualité 927,94 € + 40 €, brut ${r.grossYield.toFixed(2)} %, net ${r.netYield.toFixed(2)} %, cash-flow ${r.cashflowMonthlySteady} €/mois, intérêts ${Math.round(r.totalInterest)} €`;
});
check('SIM-01b', () => {
  const o = simulate({ ...ref, loanYears: 25 }); if (!o.ok) throw new Error('refus');
  eq(o.result.monthlyPayment, 801.00, 'mensualité 25 ans'); eq(o.result.cashflowMonthlySteady, -316.00, 'cash-flow 25 ans');
  return 'sur 25 ans : 801,00 € et −316,00 €/mois';
});
check('SIM-02', () => {
  const base = simulate(ref); const p = simulate({ ...ref, deferralType: 'partiel', deferralMonths: 6 }); const t = simulate({ ...ref, deferralType: 'total', deferralMonths: 6 });
  if (!base.ok || !p.ok || !t.ok) throw new Error('refus');
  const p1 = p.result.amortization[0]!; const t1 = t.result.amortization[0]!;
  if (p1.phase === 'amortissement' || p1.principal !== 0) throw new Error(`différé partiel : 1er mois ${JSON.stringify(p1)}`);
  eq(p1.payment, 466.67, 'différé partiel : intérêts seuls (160 000 × 3,5 % / 12)');
  if (t1.payment !== 0) throw new Error(`différé total : mensualité ${t1.payment}`);
  if (!(t.result.totalInterest > p.result.totalInterest && p.result.totalInterest > base.result.totalInterest)) throw new Error('coût du crédit non croissant');
  if (t.result.amortization.length !== 240) throw new Error(`durée totale ${t.result.amortization.length} mois`);
  return `partiel : ${p1.payment} € d'intérêts/mois ; total : 0 €, intérêts capitalisés ; intérêts totaux ${Math.round(base.result.totalInterest)} < ${Math.round(p.result.totalInterest)} < ${Math.round(t.result.totalInterest)} €`;
});
check('SIM-03', () => {
  const ex = simulate({ ...ref, agencyFees: 10000, priceMode: 'hors_honoraires' }); const inc = simulate({ ...ref, price: 160000, agencyFees: 10000, priceMode: 'honoraires_inclus' });
  if (!ex.ok || !inc.ok) throw new Error('refus');
  eq(ex.result.netPrice, 150000, 'prix net (exclus)'); eq(inc.result.netPrice, 150000, 'prix net (inclus)');
  eq(ex.result.notaryFees, 11250, 'notaire calculé sur le net vendeur'); eq(inc.result.totalCost, ex.result.totalCost, 'même coût total');
  return 'prix net vendeur 150 000 € dans les deux modes ; notaire 11 250 € sur le net vendeur ; coût total 179 250 €';
});
check('SIM-07', () => {
  const errs = [validateInputs({ ...ref, price: -1 }), validateInputs({ ...ref, loanYears: 0 }), validateInputs({ ...ref, monthlyRent: Number('abc') })];
  errs.forEach((e, i) => { if (!e.length) throw new Error(`saisie invalide n° ${i + 1} acceptée`); });
  return errs.map((e) => e[0]!.message).join(' | ');
});
check('SIM-08', () => {
  const o = simulate({ ...ref, chargesProvisionMonthly: 25, coproRecoverableAnnual: 830, coproChargesAnnual: 1430 }); if (!o.ok) throw new Error('refus');
  const w = o.result.warnings.find((x) => x.includes('régularisation'));
  if (!w) throw new Error('aucun avertissement'); return w;
});

// ---------- révision IRL
const lease = { start_date: '2024-11-01', end_date: null, rent_hc: 750, irl_enabled: true, irl_base_label: '2024-T2', irl_base_value: 145.17, last_revision_on: '2025-11-01' };
check('IRL-01', () => {
  const p = revisionPlan({ ...lease, last_revision_on: null }, '2026-11-01');
  if (p.block) throw new Error(`bloqué : ${p.block}`);
  // révision 2025 non demandée → perdue ; seule la variation 2025-T2 → 2026-T2 s'applique
  eq(p.newRent!, 758.64, 'nouveau loyer'); return `${p.oldKey} → ${p.newKey} : 750 € → ${p.newRent} € (effet ${p.effective})`;
});
check('IRL-03', () => {
  const twice = revisionPlan({ ...lease, last_revision_on: '2026-11-01', rent_hc: 758.64 }, '2026-12-01');
  if (twice.block !== 'pas_encore') throw new Error(`2e révision la même année : ${twice.block}`);
  const late = revisionPlan({ ...lease, last_revision_on: null }, '2027-03-15');
  if (late.effective !== '2027-03-15') throw new Error(`révision tardive effective le ${late.effective}`);
  return `2e révision refusée (prochaine le ${twice.anniversary}) ; révision demandée le 15/03/2027 effective le ${late.effective}`;
});
check('IRL-04', () => {
  const f = revisionPlan(lease, '2026-11-01', 'F'); const g = revisionPlan(lease, '2026-11-01', 'G');
  if (f.block !== 'dpe' || g.block !== 'dpe') throw new Error('gel non appliqué'); return f.message ?? 'bloqué (dpe)';
});
check('IRL-05', () => {
  const p = revisionPlan({ ...lease, start_date: '2027-03-01', irl_base_label: '2026-T4', last_revision_on: null }, '2028-03-01');
  if (p.block !== 'indice_inconnu') throw new Error(`attendu indice_inconnu, obtenu ${p.block}`);
  const m = revisionPlan({ ...lease, start_date: '2027-03-01', irl_base_label: '2026-T4', last_revision_on: null }, '2028-03-01', null, 150, 149);
  return `indice manquant signalé ; saisie manuelle → ${m.newRent} €`;
});

// ---------- loyers et paiements
const charges: RentCharge[] = planCharges({ start_date: '2026-08-01', end_date: null, rent_hc: 750, charges_amount: 60, payment_day: 5 }, '2026-10-31')
  .map((c, i) => ({ id: `c${i}`, user_id: 'u', version: 1, created_at: '', updated_at: '', lease_id: 'l1', kind: 'loyer', label: null, cancelled_at: null, cancel_reason: null, ...c }) as unknown as RentCharge);
check('LOY-04', () => {
  const views = chargeViews(charges, [], '2026-10-20');
  const plan = autoAllocate(1620, views);
  const amounts = plan.allocations.map((a) => `${a.charge_id}:${a.amount}`).join(', ');
  if (plan.allocations[0]?.charge_id !== 'c0' || plan.allocations[0].amount !== 810 || plan.allocations[1]?.charge_id !== 'c1') throw new Error(`répartition : ${amounts}`);
  return `1 620 € répartis : ${amounts}`;
});
check('LOY-05', () => {
  const views = chargeViews(charges.slice(0, 1), [], '2026-10-20');
  const plan = autoAllocate(900, views);
  eq(plan.remainder, 90, 'montant non affecté (avance)');
  const pay = { id: 'p1', user_id: 'u', version: 1, created_at: '', updated_at: '', lease_id: 'l1', amount: 900, paid_on: '2026-08-05' } as unknown as Payment;
  const led = leaseLedger(charges.slice(0, 1), [pay], plan.allocations.map((a, i) => ({ id: `a${i}`, payment_id: 'p1', ...a })) as never, '2026-10-20');
  return `90 € conservés en avance ; solde ${JSON.stringify(led).slice(0, 160)}`;
});

// ---------- déclaration fiscale (exemple de référence)
const prop = (o: Partial<Property>): Property => ({
  id: 'p1', user_id: 'u', version: 1, created_at: '', updated_at: '', title: 'T2', status: 'acquis', status_before_archive: null, occupation_status: 'loue',
  property_type: 'appartement', address: null, zip: null, city: null, surface: 45, rooms: 2, dpe: null, listing_url: null, asking_price: null, offer_price: null,
  works_budget: null, estimated_rent: 750, charges_provision: 0, agency_id: null, agent_id: null, next_action: null, follow_up_date: null, visit_at: null,
  comments: null, vigilance: [], ownership_mode: 'nom_propre', tax_regime: 'reel_foncier', acquired_at: '2025-01-01', acquisition_cost: 169250,
  acquisition_snapshot: null, primary_scenario_id: null, legacy_simulation_id: null, legacy_ref: null, ...o,
} as Property);
let n = 0;
const exp = (category: Expense['category'], amount: number, d = '2025-03-01'): Expense => ({
  id: `e${++n}`, user_id: 'u', version: 1, created_at: '', updated_at: '', property_id: 'p1', expense_date: d, supplier: null, label: null, amount, category,
  nature: 'charge', recoverable_amount: 0, payment_status: 'paye', paid_on: d, document_id: null, notes: null,
} as Expense);
const data = (p: Property, e: Expense[]): FiscalData => ({ properties: [p], leases: [], charges: [], payments: [], allocations: [], expenses: e });
const refExpenses = () => [exp('loyer', 8250), exp('taxe_fonciere', 900), exp('copropriete', 600), exp('assurance', 150), exp('entretien', 300)];
const loanP = { loan_amount: 160000, loan_rate: 3.5, loan_years: 20, loan_start_date: '2025-01-05', loan_insurance_monthly: 40 };

check('FIS-02', () => {
  const s = fiscalSummary(2025, data(prop({ tax_regime: 'micro_foncier' }), [exp('loyer', 8250)]), () => ({}));
  eq(s.microFoncier!.box4BE, 8250, 'case 4BE'); return 'case 4BE = 8 250 €';
});
check('FIS-03', () => {
  const p = prop(loanP);
  const s = fiscalSummary(2025, data(p, refExpenses()), () => ({}));
  const l = Object.fromEntries(s.reelFoncier!.perProperty[0]!.lines.map((x) => [x.code, x.amount]));
  const ly = loanYear(p, 2025)!;
  eq(l['211']!, 8250, 'ligne 211'); eq(l['222']!, 20, 'ligne 222'); eq(l['223']!, 150, 'ligne 223'); eq(l['224']!, 300, 'ligne 224');
  eq(l['227']!, 900, 'ligne 227'); eq(l['229']!, 600, 'ligne 229'); eq(l['250']!, Math.round((ly.interest + 480) * 100) / 100, 'ligne 250');
  const expected263 = 8250 - 1970 - l['250']!;
  eq(l['263']!, Math.round(expected263 * 100) / 100, 'ligne 263');
  eq(s.reelFoncier!.boxes.box4BA, l['263']!, 'case 4BA');
  return `211 = 8 250 ; 222 = 20 ; 223 = 150 ; 224 = 300 ; 227 = 900 ; 229 = 600 ; 250 = ${l['250']} (intérêts ${ly.interest.toFixed(2)} + 480) ; 263 = 4BA = ${l['263']} €`;
});
check('FIS-04', () => {
  const p = prop(loanP);
  const s = fiscalSummary(2025, data(p, [...refExpenses(), exp('entretien', 15000)]), () => ({}));
  const b = s.reelFoncier!.boxes;
  const f = (r215: number, r240: number, r250: number) => ({ propertyId: 'x', lines: [], r215, r240, r250, r263: r215 - r240 - r250, notDeductible: [] }) as Foncier2044;
  const big = foncierBoxes([f(10000, 25000, 3000)]);
  if (big.box4BC !== 10700) throw new Error(`plafond 4BC : ${big.box4BC}`);
  return `exemple + 15 000 € de travaux : 4BC = ${b.box4BC} €, 4BB = ${b.box4BB} € ; plafond 10 700 € vérifié`;
});
check('FIS-05', () => {
  const s = fiscalSummary(2025, data(prop({ tax_regime: 'micro_bic' }), [exp('loyer', 9350)]), () => ({}));
  const line = s.microBic!.lines[0]!;
  if (line.box !== '5NI') throw new Error(`case ${line.box}`); eq(s.microBic!.taxable, 4675, 'imposable');
  return `case ${line.box} = ${line.amount} € ; imposable après 50 % : ${s.microBic!.taxable} €`;
});

console.log(JSON.stringify(out, null, 1));
