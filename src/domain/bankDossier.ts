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
import { patrimonyTotals, type PatrimonyLine } from './patrimony.ts';

const USAGE_SHORT: Record<PatrimonyLine['usage'], string> = { locatif: 'Locatif', residence_principale: 'Résidence principale', residence_secondaire: 'Résidence secondaire' };

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

export interface Kpi { label: string; value: string; sub?: string; tone?: 'pos' | 'neg' }
export interface DossierCover {
  label: string; title: string; subtitle: string; pitch: string[]; kpis: Kpi[];
  financing: { equity: number; loan: number };
  debt: { before: number | null; after: number; max: number } | null;
}
export interface BankDossier extends PdfDoc { cover: DossierCover }

export function bankDossierDoc(o: { property: DossierProperty; inputs: SimulationInputs; result: SimulationResult; borrower?: Borrower; editedOn: string; withSchedule?: boolean; patrimony?: PatrimonyLine[] }): BankDossier {
  const { property: p, inputs: i, result: r, borrower: b = {} } = o;
  const where = [p.address, [p.zip, p.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const fees = r.financingFees;
  const taeg = r.loanAmount > 0 ? estimateTaeg({ amount: r.loanAmount, rate: i.interestRate, years: i.loanYears, insuranceRate: i.insuranceRate, fees }) : null;
  const ratio = debtRatio(b, r.monthlyPaymentWithInsurance, r.monthlyRent);
  const sections: PdfSection[] = [];

  // 1. page de garde : le projet en bref et les chiffres clés
  const pitch = [
    `Acquisition ${p.property_type ? `d’un ${(TYPE[p.property_type] ?? p.property_type).toLowerCase()}` : 'd’un bien'}${p.rooms ? ` de ${p.rooms} pièce${p.rooms > 1 ? 's' : ''}` : ''}${i.surface ? ` (${String(i.surface).replace('.', ',')} m2)` : ''}${p.city ? ` à ${p.city}` : ''}${p.furnished ? ', destiné à la location meublée' : p.furnished === false ? ', destiné à la location nue' : ', destiné à la location'}.`,
    `Coût total du projet ${money(r.totalCost)}, financé par ${r.equity > 0 ? `un apport de ${money(r.equity)} et ` : ''}un prêt de ${money(r.loanAmount)} sur ${i.loanYears} ans.`,
    ...(o.patrimony?.length ? (() => { const t = patrimonyTotals(o.patrimony); return [`Patrimoine immobilier actuel : ${t.count} bien${t.count > 1 ? 's' : ''} estimé${t.count > 1 ? 's' : ''} ${money(t.value)}, dont ${money(t.remaining)} de capital restant dû, soit ${money(t.net)} de patrimoine net.`]; })() : []),
    ...(b.presentation?.trim() ? [b.presentation.trim()] : []),
  ];
  const cf = r.cashflowMonthlySteady;
  const kpis: Kpi[] = [
    { label: 'Coût total du projet', value: money(r.totalCost), sub: 'frais et travaux compris' },
    { label: 'Montant emprunté', value: money(r.loanAmount), sub: `sur ${i.loanYears} ans à ${pct(i.interestRate)}` },
    { label: 'Apport personnel', value: money(r.equity), sub: r.totalCost > 0 ? `${pct(round2((r.equity / r.totalCost) * 100))} du projet` : undefined },
    { label: 'Mensualité', value: money2(r.monthlyPaymentWithInsurance), sub: 'assurance comprise' },
    { label: 'Loyer mensuel', value: money2(r.monthlyRent), sub: 'hors charges' },
    { label: 'Cash-flow mensuel', value: money2(cf), sub: 'avant impôt', tone: cf >= 0 ? 'pos' : 'neg' },
    { label: 'Rendement brut', value: pct(r.grossYield) },
    { label: 'Rendement net de charges', value: pct(r.netYield) },
    ratio ? { label: 'Endettement après projet', value: pct(ratio.after), sub: `plafond recommandé ${HCSF_MAX} %`, tone: ratio.after > HCSF_MAX ? 'neg' : 'pos' }
      : { label: 'Coût total du crédit', value: money(r.financingCost), sub: 'intérêts, assurance, frais' },
  ];
  const cover: DossierCover = {
    label: 'Dossier de financement', title: p.title,
    subtitle: [where, `Projet d’investissement locatif · établi le ${date(o.editedOn)}`].filter(Boolean).join('\n'),
    pitch, kpis, financing: { equity: r.equity, loan: r.loanAmount },
    debt: ratio ? { before: ratio.before, after: ratio.after, max: HCSF_MAX } : null,
  };

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

  // 2 bis. bilan patrimonial immobilier : biens détenus, valeur estimée (médiane), capital restant dû, patrimoine net
  if (o.patrimony?.length) {
    const lines = o.patrimony;
    const t = patrimonyTotals(lines);
    // valeur du bien visé : prix médian de son estimation (on suppose une négociation réussie), à défaut le prix d'achat
    const est = p.estimate_median != null && p.estimate_median > 0 ? p.estimate_median
      : p.estimate_low != null && p.estimate_high != null ? Math.round((p.estimate_low + p.estimate_high) / 2) : null;
    const projectValue = est ?? r.offerFai, projectDebt = r.loanAmount;
    const afterValue = round2(t.value + projectValue), afterDebt = round2(t.remaining + projectDebt);
    const src = (l: PatrimonyLine) => l.valueSource === 'achat' ? ' (1)' : l.valueSource === 'fourchette' ? ' (2)' : '';
    const notes = [
      lines.some((l) => l.valueSource === 'achat') ? '(1) Faute d’estimation, valeur retenue au coût d’acquisition.' : '',
      lines.some((l) => l.valueSource === 'fourchette') ? '(2) Milieu de la fourchette d’estimation.' : '',
      lines.some((l) => l.remainingSource === 'initial') ? '(3) Date de début du crédit inconnue : montant emprunté à l’origine.' : '',
      t.missingValue ? `${t.missingValue} bien${t.missingValue > 1 ? 's' : ''} sans valeur connue, non compté${t.missingValue > 1 ? 's' : ''} dans le total.` : '',
    ].filter(Boolean);
    sections.push({ title: 'Bilan patrimonial immobilier', blocks: [
      { t: 'table', head: ['Bien', 'Usage', 'Valeur estimée', 'Capital restant dû', 'Patrimoine net'], widths: [3, 1.6, 1.4, 1.4, 1.4], align: ['l', 'l', 'r', 'r', 'r'], total: true, rows: [
        ...lines.map((l) => [
          `${l.title}${l.city && !l.title.includes(l.city) ? ` (${l.city})` : ''}`, USAGE_SHORT[l.usage],
          l.value != null ? money(l.value) + src(l) : 'non estimée',
          l.remaining ? money(l.remaining) + (l.remainingSource === 'initial' ? ' (3)' : '') : 'aucun',
          l.value != null ? money(round2(l.value - l.remaining)) : '—',
        ]),
        ['Total du patrimoine actuel', '', money(t.value), money(t.remaining), money(t.net)],
      ] },
      { t: 'table', head: ['Synthèse', 'Aujourd’hui', 'Après le projet'], widths: [3, 1.5, 1.5], align: ['l', 'r', 'r'], rows: [
        ['Valeur estimée des biens', money(t.value), money(afterValue)],
        ['Capital restant dû', money(t.remaining), money(afterDebt)],
        ['Patrimoine immobilier net', money(t.net), money(round2(afterValue - afterDebt))],
        ['Part financée par la dette', t.ltv == null ? '—' : pct(t.ltv), afterValue > 0 ? pct(round2((afterDebt / afterValue) * 100)) : '—'],
        ['Mensualités de crédit en cours', money(t.monthlyLoan), money(round2(t.monthlyLoan + r.monthlyPaymentWithInsurance))],
      ] },
      { t: 'p', text: [`Valeurs : prix médian de l’estimation de chaque bien (ventes DVF comparables ou saisie du propriétaire). Capital restant dû calculé au ${date(o.editedOn)} d’après les caractéristiques des crédits. « Après le projet » ajoute ${est != null ? `la valeur médiane estimée du bien visé (${money(projectValue)})` : `le prix d’acquisition du bien visé (${money(projectValue)}), faute d’estimation`} et le prêt demandé (${money(projectDebt)}).`, ...notes].join(' ') },
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
    cover,
    title: `Dossier de financement — ${p.title}`,
    subtitle: `Projet d’investissement locatif${where ? ` · ${where}` : ''} · établi le ${date(o.editedOn)}`,
    sections,
    footer: 'Simulation indicative Immo-Zen, hors fiscalité',
  };
}
