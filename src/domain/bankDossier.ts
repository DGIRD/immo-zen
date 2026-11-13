/**
 * Dossier de financement d'un projet locatif, à remettre à une banque ou à un courtier :
 * le bien, le plan de financement (emplois / ressources), le prêt demandé, la rentabilité locative,
 * l'endettement de l'emprunteur (s'il le renseigne) et le tableau d'amortissement annuel.
 * Simulation indicative, hors fiscalité : ce n'est ni une offre de prêt ni un conseil.
 */
import type { PdfBlock, PdfDoc, PdfSection } from './docPdf.ts';
import { money, money2, pct, date } from './format.ts';
import { estimateTaeg } from './loanRates.ts';
import { round2, type SimulationInputs, type SimulationResult } from './simulator.ts';

export interface DossierProperty {
  title: string; address?: string | null; zip?: string | null; city?: string | null; property_type?: string | null;
  rooms?: number | null; dpe?: string | null; construction_year?: number | null; furnished?: boolean | null;
  estimate_low?: number | null; estimate_high?: number | null; estimate_median?: number | null; estimate_on?: string | null;
  market_rent?: { low?: number | null; high?: number | null; vintage?: number | null } | null;
}

/** Situation de l'emprunteur : facultative, saisie au moment de l'export, jamais enregistrée. */
export interface Borrower {
  names?: string;
  situation?: string;
  /** Revenus nets mensuels du foyer, avant impôt. */
  income?: number | null;
  /** Mensualités des crédits en cours (assurance comprise). */
  currentLoans?: number | null;
  /** Loyers déjà perçus, par mois. */
  currentRents?: number | null;
  /** Épargne restant disponible après l'apport. */
  savingsAfter?: number | null;
  presentation?: string;
}

/** Part des loyers retenue dans les revenus, pratique bancaire courante. */
export const RENT_WEIGHT = 0.7;
/** Taux d'effort maximal recommandé par le Haut Conseil de stabilité financière, assurance comprise. */
export const HCSF_MAX = 35;

export interface DebtRatio { before: number | null; after: number; incomeRetained: number; debt: number; remainingLiving: number }

/** Taux d'endettement avant et après le projet (loyers comptés à 70 %). */
export function debtRatio(b: Borrower, newPayment: number, newRent: number): DebtRatio | null {
  if (!(b.income && b.income > 0)) return null;
  const loans = b.currentLoans ?? 0, rents = b.currentRents ?? 0;
  const incomeBefore = b.income + RENT_WEIGHT * rents;
  const incomeRetained = b.income + RENT_WEIGHT * (rents + newRent);
  const debt = loans + newPayment;
  return {
    before: incomeBefore > 0 ? round2((loans / incomeBefore) * 100) : null,
    after: round2((debt / incomeRetained) * 100),
    incomeRetained: round2(incomeRetained),
    debt: round2(debt),
    remainingLiving: round2(incomeRetained - debt),
  };
}

const kv = (rows: [string, string][]): PdfBlock => ({ t: 'kv', rows: rows.filter(([, v]) => v && v !== '—') });
const TYPE: Record<string, string> = { appartement: 'Appartement', maison: 'Maison', immeuble: 'Immeuble', local: 'Local', parking: 'Parking', terrain: 'Terrain' };

export function bankDossierDoc(o: { property: DossierProperty; inputs: SimulationInputs; result: SimulationResult; borrower?: Borrower; editedOn: string; withSchedule?: boolean }): PdfDoc {
  const { property: p, inputs: i, result: r, borrower: b = {} } = o;
  const where = [p.address, [p.zip, p.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const fees = r.financingFees;
  const taeg = r.loanAmount > 0 ? estimateTaeg({ amount: r.loanAmount, rate: i.interestRate, years: i.loanYears, insuranceRate: i.insuranceRate, fees }) : null;
  const ratio = debtRatio(b, r.monthlyPaymentWithInsurance, r.monthlyRent);
  const sections: PdfSection[] = [];

  // 1. synthèse
  const pitch = [
    `Acquisition ${p.property_type ? `d’un ${(TYPE[p.property_type] ?? p.property_type).toLowerCase()}` : 'd’un bien'}${p.rooms ? ` de ${p.rooms} pièce${p.rooms > 1 ? 's' : ''}` : ''}${i.surface ? ` (${String(i.surface).replace('.', ',')} m2)` : ''}${p.city ? ` à ${p.city}` : ''}, destiné à la location ${p.furnished ? 'meublée' : p.furnished === false ? 'nue' : ''}`.trim() + '.',
    `Coût total du projet ${money(r.totalCost)}, financé par ${r.equity > 0 ? `un apport de ${money(r.equity)} et ` : ''}un prêt de ${money(r.loanAmount)} sur ${i.loanYears} ans.`,
    `Loyer attendu ${money(r.monthlyRent)} hors charges par mois, soit un rendement brut de ${pct(r.grossYield)} et un cash-flow de ${money(r.cashflowMonthlySteady)} par mois avant impôt.`,
  ];
  sections.push({ title: 'Synthèse du projet', blocks: [
    ...pitch.map((text) => ({ t: 'p', text }) as PdfBlock),
    ...(b.presentation?.trim() ? [{ t: 'p', text: b.presentation.trim() } as PdfBlock] : []),
    kv([
      ['Coût total du projet', money(r.totalCost)],
      ['Apport personnel', money(r.equity)],
      ['Montant emprunté', money(r.loanAmount)],
      ['Mensualité, assurance comprise', money2(r.monthlyPaymentWithInsurance)],
      ['Loyer mensuel hors charges', money2(r.monthlyRent)],
      ['Cash-flow mensuel avant impôt', money2(r.cashflowMonthlySteady)],
      ...(ratio ? [['Taux d’endettement après le projet', pct(ratio.after)] as [string, string]] : []),
    ]),
  ] });

  // 2. emprunteur
  if (b.names || b.situation || ratio) {
    sections.push({ title: 'Emprunteur', blocks: [
      kv([
        ['Emprunteur(s)', b.names?.trim() ?? ''],
        ['Situation professionnelle', b.situation?.trim() ?? ''],
        ['Revenus nets mensuels du foyer', b.income ? money(b.income) : ''],
        ['Crédits en cours (mensualités)', b.currentLoans ? money(b.currentLoans) : ''],
        ['Loyers déjà perçus (par mois)', b.currentRents ? money(b.currentRents) : ''],
        ['Épargne disponible après l’apport', b.savingsAfter ? money(b.savingsAfter) : ''],
      ]),
      ...(ratio ? [
        { t: 'table', head: ['Endettement', 'Avant le projet', 'Après le projet'], widths: [3, 1.5, 1.5], align: ['l', 'r', 'r'], rows: [
          ['Mensualités de crédit', money(b.currentLoans ?? 0), money(ratio.debt)],
          ['Revenus retenus (loyers à 70 %)', money((b.income ?? 0) + RENT_WEIGHT * (b.currentRents ?? 0)), money(ratio.incomeRetained)],
          ['Taux d’endettement', ratio.before == null ? '—' : pct(ratio.before), pct(ratio.after)],
          ['Reste à vivre mensuel', money((b.income ?? 0) + RENT_WEIGHT * (b.currentRents ?? 0) - (b.currentLoans ?? 0)), money(ratio.remainingLiving)],
        ] } as PdfBlock,
        { t: 'p', text: `Méthode usuelle des banques : loyers retenus à ${RENT_WEIGHT * 100} %, mensualités assurance comprise. Plafond recommandé par le Haut Conseil de stabilité financière : ${HCSF_MAX} %${ratio.after > HCSF_MAX ? ' (dépassé : la banque peut accorder une dérogation, dans la limite de 20 % de sa production)' : ''}.` } as PdfBlock,
      ] : []),
    ] });
  }

  // 3. le bien
  sections.push({ title: 'Le bien', blocks: [
    kv([
      ['Désignation', p.title],
      ['Adresse', where],
      ['Type', p.property_type ? TYPE[p.property_type] ?? p.property_type : ''],
      ['Surface habitable', i.surface ? `${String(i.surface).replace('.', ',')} m2` : ''],
      ['Pièces', p.rooms ? String(p.rooms) : ''],
      ['Année de construction', p.construction_year ? String(p.construction_year) : ''],
      ['Diagnostic de performance énergétique', p.dpe ? `classe ${p.dpe}` : ''],
      ['Location', p.furnished ? 'meublée' : p.furnished === false ? 'nue' : ''],
      ['Prix affiché (frais d’agence inclus)', i.askingPrice ? money(i.askingPrice) : ''],
      ['Prix négocié (frais d’agence inclus)', money(r.offerFai)],
      ...(r.negotiationAmount && r.negotiationAmount > 0 ? [['Négociation obtenue', `${money(r.negotiationAmount)} (${pct(r.negotiationPct)})`] as [string, string]] : []),
      ['Prix au m2', r.pricePerM2 ? money(r.pricePerM2) : ''],
      ...(p.estimate_low && p.estimate_high ? [['Estimation de marché (ventes DVF)', `${money(p.estimate_low)} à ${money(p.estimate_high)}${p.estimate_on ? `, au ${date(p.estimate_on)}` : ''}`] as [string, string]] : []),
      ...(p.market_rent?.low && p.market_rent?.high ? [['Loyer de marché (charges comprises)', `${money(p.market_rent.low)} à ${money(p.market_rent.high)} par mois (Carte des loyers ANIL${p.market_rent.vintage ? ` ${p.market_rent.vintage}` : ''})`] as [string, string]] : []),
    ]),
  ] });

  // 4. plan de financement
  const uses: [string, number][] = [
    ['Prix net vendeur', r.netPrice], ['Frais d’agence', r.agencyFees], ['Frais de notaire', r.notaryFees],
    ['Travaux', i.works], ['Mobilier', i.furniture], ['Frais de garantie', i.guaranteeFees], ['Frais de dossier', i.dossierFees],
  ];
  const usesRows = uses.filter(([, v]) => v > 0);
  sections.push({ title: 'Plan de financement', blocks: [
    { t: 'table', head: ['Emplois', 'Montant'], widths: [4, 1.6], align: ['l', 'r'], total: true, rows: [...usesRows.map(([l, v]) => [l, money(v)]), ['Coût total du projet', money(r.totalCost)]] },
    { t: 'table', head: ['Ressources', 'Montant'], widths: [4, 1.6], align: ['l', 'r'], total: true, rows: [
      ['Apport personnel', money(r.equity)], ['Prêt immobilier demandé', money(r.loanAmount)], ['Total des ressources', money(round2(r.equity + r.loanAmount))],
    ] },
    ...(r.totalCost > 0 ? [{ t: 'p', text: `Apport : ${pct(round2((r.equity / r.totalCost) * 100))} du coût total${r.equity >= r.notaryFees + fees ? ', couvrant les frais de notaire et de garantie' : ''}.` } as PdfBlock] : []),
  ] });

  // 5. prêt demandé
  sections.push({ title: 'Prêt demandé', blocks: [
    kv([
      ['Montant', money(r.loanAmount)],
      ['Durée', `${i.loanYears} ans (${r.months} mois)`],
      ['Taux nominal', pct(i.interestRate)],
      ['Assurance emprunteur', `${pct(i.insuranceRate)} du capital par an, soit ${money2(r.monthlyInsurance)} par mois`],
      ...(i.deferralMonths > 0 && i.deferralType !== 'aucun' ? [['Différé', `${i.deferralMonths} mois, ${i.deferralType === 'total' ? 'total' : 'partiel'}`] as [string, string]] : []),
      ['Mensualité hors assurance', money2(r.monthlyPayment)],
      ['Mensualité assurance comprise', money2(r.monthlyPaymentWithInsurance)],
      ['Coût total du crédit (intérêts, assurance, frais)', money(r.financingCost)],
      ...(taeg != null ? [['TAEG estimé', `${pct(taeg)} (estimation, hors différé ; seul le TAEG de l’offre de prêt fait foi)`] as [string, string]] : []),
      ['Emprunteur', i.borrower === 'personne_morale' ? 'personne morale (société)' : 'particulier'],
    ]),
  ] });

  // 6. rentabilité
  sections.push({ title: 'Rentabilité locative (année pleine, avant impôt)', blocks: [
    { t: 'table', head: ['Poste', 'Par an'], widths: [4, 1.6], align: ['l', 'r'], rows: [
      ['Loyers hors charges', money(r.annualRent)],
      ...(r.annualVacancy ? [['Vacance locative', money(-r.annualVacancy)]] : []),
      ...r.ownerChargesDetail.filter((c) => c.amount).map((c) => [c.label, money(-c.amount)]),
      ['Revenu net d’exploitation', money(r.annualNetOperatingIncome)],
      ['Remboursement du crédit (assurance comprise)', money(-r.monthlyPaymentWithInsurance * 12)],
      ['Cash-flow annuel avant impôt', money(round2(r.cashflowMonthlySteady * 12))],
    ], total: true },
    kv([
      ['Rendement brut', pct(r.grossYield)],
      ['Rendement net de charges', pct(r.netYield)],
      ['Cash-flow mensuel avant impôt', money2(r.cashflowMonthlySteady)],
      ...(r.cashflowMonthlySteady < 0 ? [['Effort d’épargne mensuel', money2(-r.cashflowMonthlySteady)] as [string, string]] : []),
    ]),
  ] });

  // 7. tableau d'amortissement
  if (o.withSchedule !== false && r.years.length) {
    sections.push({ title: 'Tableau d’amortissement annuel', newPage: true, blocks: [
      { t: 'table', head: ['Année', 'Échéances', 'Intérêts', 'Capital', 'Assurance', 'Capital restant dû'], widths: [0.8, 1.3, 1.3, 1.3, 1.1, 1.5], align: ['l', 'r', 'r', 'r', 'r', 'r'],
        rows: r.years.map((y) => [String(y.year), money(y.payments), money(y.interest), money(y.principal), money(y.insurance), money(y.balance)]) },
    ] });
  }

  sections.push({ title: 'Avertissement', blocks: [{ t: 'p', text: 'Simulation indicative établie avec Immo-Zen à partir des hypothèses saisies par l’emprunteur, hors fiscalité. Ce document n’est ni une offre de prêt ni un conseil en financement : seules l’offre de prêt et la fiche d’information standardisée de la banque font foi.' }] });

  return {
    title: `Dossier de financement — ${p.title}`,
    subtitle: `Projet d’investissement locatif${where ? ` · ${where}` : ''} · établi le ${date(o.editedOn)}`,
    sections,
    footer: 'Simulation indicative Immo-Zen, hors fiscalité',
  };
}
