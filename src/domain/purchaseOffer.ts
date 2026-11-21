/**
 * Offre d'achat générée à partir d'une simulation : prix proposé, motifs de négociation choisis par l'acquéreur
 * (DPE, prix au-dessus du marché, taux de crédit, travaux, charges…), financement et condition suspensive de prêt,
 * durée de validité. Modèle indicatif, à relire avant envoi ; ce n'est pas un conseil juridique.
 */
import type { PdfBlock, PdfDoc, PdfSection } from './docPdf.ts';
import { date, money, pct } from './format.ts';
import { round2, type SimulationInputs, type SimulationResult } from './simulator.ts';

export interface OfferProperty {
  title: string; address?: string | null; zip?: string | null; city?: string | null; property_type?: string | null;
  rooms?: number | null; dpe?: string | null; construction_year?: number | null;
  estimate_low?: number | null; estimate_high?: number | null; estimate_median?: number | null; estimate_on?: string | null;
}

export type ArgumentId = 'dpe' | 'marche' | 'taux' | 'travaux' | 'copro' | 'taxe' | 'duree' | 'rendement' | 'libre';

export interface NegotiationArgument {
  id: ArgumentId;
  label: string;
  /** Texte proposé, modifiable par l'acquéreur avant génération. */
  text: string;
  /** Décote justifiée par cet argument (indicative), en euros. */
  amount: number;
  /** Argument pertinent au vu des données (proposé coché). */
  relevant: boolean;
  /** L'argument a besoin d'une précision saisie par l'acquéreur (durée de mise en vente, texte libre). */
  needsInput?: boolean;
}

/** Calendrier de la loi Climat et résilience : interdiction de mise en location des logements « passoires ». */
const DPE_BAN: Record<string, string> = { G: 'depuis le 1er janvier 2025', F: 'à compter du 1er janvier 2028', E: 'à compter du 1er janvier 2034' };

export interface OfferContext { property: OfferProperty; inputs: SimulationInputs; result: SimulationResult }

/** Prix affiché hors honoraires d'agence (comparable aux ventes DVF, qui sont des prix nets vendeur). */
export function askingNet(c: OfferContext): number {
  const { inputs: i, result: r } = c;
  return Math.max(0, round2(i.askingPrice - r.agencyFees));
}

/** Arguments de négociation proposés, pré-remplis avec les chiffres de la simulation et de la fiche du bien. */
export function suggestArguments(c: OfferContext, opts: { monthsOnMarket?: number | null; offerPrice?: number | null } = {}): NegotiationArgument[] {
  const { property: p, inputs: i, result: r } = c;
  const out: NegotiationArgument[] = [];
  const surface = i.surface > 0 ? i.surface : null;

  const dpe = p.dpe?.toUpperCase() ?? null;
  const bad = dpe === 'E' || dpe === 'F' || dpe === 'G';
  out.push({
    id: 'dpe', label: 'Mauvais DPE (rénovation énergétique à prévoir)', relevant: bad, amount: bad ? Math.max(0, i.works) : 0,
    text: dpe
      ? `Le diagnostic de performance énergétique classe le logement en ${dpe}.${DPE_BAN[dpe] ? ` Selon le calendrier de la loi Climat et résilience, un logement classé ${dpe} est interdit à la mise en location ${DPE_BAN[dpe]}, ce qui impose des travaux de rénovation énergétique (isolation, chauffage, ventilation) et un nouveau diagnostic.` : ''} Ce coût et ce délai doivent être déduits du prix.`
      : 'Le diagnostic de performance énergétique laisse prévoir des travaux de rénovation énergétique, dont le coût doit être déduit du prix.',
  });

  const net = askingNet(c);
  const median = p.estimate_median ?? (p.estimate_low != null && p.estimate_high != null ? Math.round((p.estimate_low + p.estimate_high) / 2) : null);
  const gap = median && net ? round2(net - median) : 0;
  const gapPct = median && net ? round2((gap / median) * 100) : 0;
  out.push({
    id: 'marche', label: 'Prix au-dessus du marché', relevant: gapPct >= 3, amount: gap > 0 ? Math.round(gap) : 0,
    text: median
      ? `Les ventes récentes de biens comparables dans le secteur (données DVF${p.estimate_on ? ` au ${date(p.estimate_on)}` : ''}) situent la valeur de ce bien autour de ${money(median)}${surface ? `, soit ${money(Math.round(median / surface))} par m2` : ''}${p.estimate_low && p.estimate_high ? ` (fourchette ${money(p.estimate_low)} à ${money(p.estimate_high)})` : ''}. Le prix affiché, ${money(net)} hors honoraires${surface ? ` (${money(Math.round(net / surface))} par m2)` : ''}, ${gap > 0 ? `dépasse cette valeur de ${pct(gapPct)}` : 'est proche de cette valeur'}.`
      : 'Le prix affiché paraît élevé au regard des ventes récentes de biens comparables dans le secteur.',
  });

  const rate = i.useLoan && r.loanAmount > 0 ? i.interestRate : 0;
  out.push({
    id: 'taux', label: 'Taux de crédit immobilier élevés', relevant: rate >= 3.5, amount: 0,
    text: rate
      ? `Le financement est envisagé à ${pct(rate)} sur ${i.loanYears} ans : le coût total du crédit (intérêts, assurance et frais) atteint ${money(r.financingCost)}, ce qui réduit d’autant la capacité d’achat et doit se refléter dans le prix.`
      : 'Le niveau actuel des taux de crédit immobilier renchérit le coût du financement et réduit la capacité d’achat.',
  });

  out.push({
    id: 'travaux', label: 'Travaux à prévoir', relevant: i.works > 0 && !bad, amount: i.works > 0 && !bad ? Math.round(i.works) : 0,
    text: i.works > 0
      ? `La visite a fait apparaître des travaux à réaliser, estimés à ${money(i.works)} (remise en état, mise aux normes, équipements), qui ne sont pas pris en compte dans le prix affiché.`
      : 'La visite a fait apparaître des travaux à réaliser (remise en état, mise aux normes, équipements), qui ne sont pas pris en compte dans le prix affiché.',
  });

  const copro = i.coproChargesAnnual - i.coproRecoverableAnnual;
  out.push({
    id: 'copro', label: 'Charges de copropriété élevées', relevant: surface != null && i.coproChargesAnnual / surface >= 40, amount: 0,
    text: i.coproChargesAnnual > 0
      ? `Les charges de copropriété s’élèvent à ${money(i.coproChargesAnnual)} par an${surface ? ` (${money(Math.round(i.coproChargesAnnual / surface))} par m2)` : ''}, dont ${money(Math.max(0, copro))} restent à la charge du propriétaire : un niveau qui pèse sur la rentabilité et sur la valeur de revente.`
      : 'Le niveau des charges de copropriété pèse sur la rentabilité et sur la valeur de revente.',
  });

  out.push({
    id: 'taxe', label: 'Taxe foncière élevée', relevant: r.annualRent > 0 && i.propertyTaxAnnual / r.annualRent >= 0.12, amount: 0,
    text: i.propertyTaxAnnual > 0
      ? `La taxe foncière atteint ${money(i.propertyTaxAnnual)} par an${r.annualRent > 0 ? `, soit ${pct(round2((i.propertyTaxAnnual / r.annualRent) * 100))} des loyers attendus` : ''}.`
      : 'Le montant de la taxe foncière pèse sur la rentabilité du bien.',
  });

  const months = opts.monthsOnMarket ?? null;
  out.push({
    id: 'duree', label: 'Bien en vente depuis longtemps', relevant: (months ?? 0) >= 4, amount: 0, needsInput: true,
    text: months ? `Le bien est proposé à la vente depuis environ ${months} mois sans avoir trouvé preneur au prix affiché, signe que ce prix ne correspond pas au marché.` : 'Le bien est proposé à la vente depuis plusieurs mois sans avoir trouvé preneur au prix affiché, signe que ce prix ne correspond pas au marché.',
  });

  const yAsk = i.askingPrice > 0 ? round2((r.annualRent / i.askingPrice) * 100) : 0;
  const offer = opts.offerPrice ?? r.offerFai;
  const yOffer = offer > 0 ? round2((r.annualRent / offer) * 100) : 0;
  out.push({
    id: 'rendement', label: 'Rentabilité insuffisante au prix affiché', relevant: r.annualRent > 0 && r.cashflowMonthlySteady < 0, amount: 0,
    text: r.annualRent > 0
      ? `Pour un loyer attendu de ${money(r.monthlyRent)} par mois, le prix affiché ne procure qu’un rendement brut de ${pct(yAsk)}${yOffer > yAsk ? `, contre ${pct(yOffer)} au prix proposé` : ''}, insuffisant pour couvrir les charges et le financement.`
      : 'Au prix affiché, le loyer de marché ne permet pas de couvrir les charges et le financement.',
  });

  out.push({ id: 'libre', label: 'Autre motif (texte libre)', relevant: false, amount: 0, needsInput: true, text: '' });
  return out;
}

/** Prix suggéré : prix affiché diminué des décotes justifiées par les arguments retenus, arrondi au millier inférieur. */
export function suggestedPrice(askingFai: number, args: NegotiationArgument[]): number {
  const cut = args.reduce((s, a) => s + Math.max(0, a.amount || 0), 0);
  return Math.max(0, Math.floor((askingFai - cut) / 1000) * 1000);
}

/* ---------- montant en lettres ---------- */
const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];

function below100(n: number): string {
  if (n <= 16) return UNITS[n]!;
  if (n < 20) return `dix-${UNITS[n - 10]}`;
  const t = Math.floor(n / 10), u = n % 10;
  if (t === 7 || t === 9) {
    const base = t === 7 ? 'soixante' : 'quatre-vingt';
    const rest = below100(10 + u);
    return t === 7 && u === 1 ? 'soixante et onze' : `${base}-${rest}`;
  }
  if (t === 8) return u === 0 ? 'quatre-vingts' : `quatre-vingt-${UNITS[u]}`;
  if (u === 0) return TENS[t]!;
  if (u === 1) return `${TENS[t]} et un`;
  return `${TENS[t]}-${UNITS[u]}`;
}
function below1000(n: number, final: boolean): string {
  const h = Math.floor(n / 100), r = n % 100;
  let s = '';
  if (h === 1) s = 'cent';
  else if (h > 1) s = `${UNITS[h]} cent${r === 0 && final ? 's' : ''}`;
  if (r) s = s ? `${s} ${below100(r)}` : below100(r);
  return s;
}
/** Nombre entier en toutes lettres (orthographe traditionnelle), ex. 185 000 → « cent quatre-vingt-cinq mille ». */
export function inWords(value: number): string {
  let n = Math.round(Math.abs(value));
  if (n === 0) return 'zéro';
  const parts: string[] = [];
  const millions = Math.floor(n / 1_000_000); n %= 1_000_000;
  const thousands = Math.floor(n / 1000); const rest = n % 1000;
  if (millions) parts.push(`${millions === 1 ? 'un' : below1000(millions, false)} million${millions > 1 ? 's' : ''}`);
  if (thousands) parts.push(thousands === 1 ? 'mille' : `${below1000(thousands, false)} mille`);
  if (rest) parts.push(below1000(rest, true));
  return parts.join(' ').replace('quatre-vingts mille', 'quatre-vingt mille');
}
export const euroWords = (v: number) => `${inWords(v)} euro${Math.round(v) > 1 ? 's' : ''}`;

/* ---------- document ---------- */
export interface OfferParties {
  buyers: string;
  buyersAddress?: string;
  /** Destinataire : vendeur ou agence (facultatif). */
  recipient?: string;
}
export interface OfferTerms {
  /** Prix proposé, honoraires d'agence inclus. */
  priceFai: number;
  /** Honoraires d'agence à la charge de l'acquéreur, inclus dans le prix. */
  agencyFees: number;
  loan: { amount: number; years: number; maxRate: number } | null;
  equity: number;
  validUntil: string;
  /** Délai de signature de l'avant-contrat après acceptation, en jours. */
  compromisDays: number;
  /** Délai d'obtention du prêt (condition suspensive), en jours ; 30 minimum. */
  loanDays: number;
  place?: string;
  extraConditions?: string[];
}

export function purchaseOfferDoc(o: { property: OfferProperty; inputs: SimulationInputs; parties: OfferParties; terms: OfferTerms; args: NegotiationArgument[]; editedOn: string }): PdfDoc & { warnings: string[] } {
  const { property: p, inputs: i, parties: pa, terms: t } = o;
  const where = [p.address, [p.zip, p.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const net = round2(t.priceFai - t.agencyFees);
  const plural = /\bet\b|,|&/.test(pa.buyers);
  const we = plural ? 'Nous' : 'Je';
  const warnings: string[] = [];
  if (!pa.buyers.trim()) warnings.push('Indiquez le nom de l’acquéreur.');
  if (!where) warnings.push('L’adresse du bien n’est pas renseignée.');
  if (t.loan && t.loanDays < 30) warnings.push('Le délai d’obtention du prêt ne peut pas être inférieur à un mois (article L313-41 du Code de la consommation).');
  if (i.askingPrice && t.priceFai > i.askingPrice) warnings.push('Le prix proposé dépasse le prix affiché.');
  const discount = i.askingPrice > 0 ? round2(i.askingPrice - t.priceFai) : 0;
  const sections: PdfSection[] = [];

  sections.push({ title: 'Parties', blocks: [
    { t: 'kv', rows: ([
      [plural ? 'Acquéreurs' : 'Acquéreur', pa.buyers.trim() || '……………………………………'],
      ['Demeurant', pa.buyersAddress?.trim() || '……………………………………'],
      ['À l’attention de', pa.recipient?.trim() || 'Madame, Monsieur le vendeur'],
    ] as [string, string][]) },
  ] });

  const TYPE: Record<string, string> = { appartement: 'Appartement', maison: 'Maison', immeuble: 'Immeuble', local: 'Local', parking: 'Parking', terrain: 'Terrain' };
  sections.push({ title: 'Bien concerné', blocks: [
    { t: 'kv', rows: ([
      ['Désignation', p.title],
      ['Adresse', where],
      ['Type', p.property_type ? TYPE[p.property_type] ?? p.property_type : ''],
      ['Surface habitable', i.surface ? `${String(i.surface).replace('.', ',')} m2` : ''],
      ['Pièces', p.rooms ? String(p.rooms) : ''],
      ['Classe énergie (DPE)', p.dpe ?? ''],
      ['Prix de présentation', i.askingPrice ? `${money(i.askingPrice)} honoraires d’agence inclus` : ''],
    ] as [string, string][]).filter(([, v]) => v) },
  ] });

  sections.push({ title: 'Offre', blocks: [
    { t: 'p', text: `${we} soussigné${plural ? 's' : '(e)'} ${pa.buyers.trim() || '……………………'} ${plural ? 'déclarons' : 'déclare'} faire une offre d’achat pour le bien désigné ci-dessus, au prix de ${money(t.priceFai)} (${euroWords(t.priceFai)})${t.agencyFees > 0 ? `, honoraires d’agence inclus à la charge de l’acquéreur de ${money(t.agencyFees)}, soit un prix net vendeur de ${money(net)}` : ', net vendeur'}, frais d’acte en sus.` },
    ...(discount > 0 ? [{ t: 'p', text: `Ce prix est inférieur de ${money(discount)} (${pct(round2((discount / i.askingPrice) * 100))}) au prix de présentation, pour les motifs exposés ci-après.` } as PdfBlock] : []),
  ] });

  const chosen = o.args.filter((a) => a.text.trim());
  if (chosen.length) sections.push({ title: 'Motifs de l’offre', blocks: [{ t: 'list', items: chosen.map((a) => a.text.trim()) }] });

  const cond: string[] = [];
  if (t.loan && t.loan.amount > 0) {
    cond.push(`Obtention d’un ou plusieurs prêts immobiliers d’un montant maximal de ${money(t.loan.amount)}, d’une durée maximale de ${t.loan.years} ans, au taux nominal maximal de ${pct(t.loan.maxRate)} hors assurance, dans un délai de ${t.loanDays} jours à compter de la signature de l’avant-contrat (articles L313-40 et suivants du Code de la consommation).`);
  }
  cond.push(...(t.extraConditions ?? []).filter((x) => x.trim()));
  sections.push({ title: 'Financement et conditions', blocks: [
    { t: 'kv', rows: ([
      ['Apport personnel', t.equity > 0 ? money(t.equity) : ''],
      ['Prêt immobilier', t.loan && t.loan.amount > 0 ? `${money(t.loan.amount)} sur ${t.loan.years} ans` : 'sans recours à un prêt'],
    ] as [string, string][]).filter(([, v]) => v) },
    ...(cond.length ? [{ t: 'p', text: 'Cette offre est faite sous les conditions suspensives suivantes, qui seront reprises dans l’avant-contrat :' } as PdfBlock, { t: 'list', items: cond } as PdfBlock] : []),
    ...(!t.loan || t.loan.amount <= 0 ? [{ t: 'p', text: `L’acquisition est financée sans prêt. ${plural ? 'Les acquéreurs reconnaîtront' : 'L’acquéreur reconnaîtra'}, dans l’avant-contrat, par une mention manuscrite, être informé${plural ? 's' : '(e)'} que s’${plural ? 'ils recourent' : 'il recourt'} néanmoins à un prêt, ${plural ? 'ils ne pourront' : 'il ne pourra'} se prévaloir de la condition suspensive (article L313-42 du Code de la consommation).` } as PdfBlock] : []),
  ] });

  sections.push({ title: 'Validité et suite de l’offre', blocks: [
    { t: 'p', text: `Cette offre est valable jusqu’au ${date(t.validUntil)} inclus. Passé ce délai sans acceptation écrite, elle sera caduque de plein droit.` },
    { t: 'p', text: `En cas d’acceptation, l’avant-contrat (compromis ou promesse de vente) sera signé dans un délai de ${t.compromisDays} jours, chez le notaire de chacune des parties. L’acquéreur disposera alors du délai de rétractation de dix jours prévu par l’article L271-1 du Code de la construction et de l’habitation.` },
    { t: 'p', text: 'Aucune somme n’est versée à l’occasion de la présente offre (article 1589-1 du Code civil).' },
  ] });

  sections.push({ title: 'Signatures', blocks: [
    { t: 'p', text: `Fait à ${t.place?.trim() || '……………………'}, le ${date(o.editedOn)}, en deux exemplaires.` },
    { t: 'sign', parties: [`${plural ? 'Les acquéreurs' : 'L’acquéreur'} — « Bon pour offre d’achat »`, 'Le vendeur — « Bon pour acceptation », date'] },
    { t: 'p', text: 'Offre d’achat générée à l’aide d’Immo-Zen (immo-zen.fr).' },
  ] });

  return {
    title: 'Offre d’achat',
    subtitle: [p.title, where].filter(Boolean).join(' · '),
    sections,
    footer: 'Offre d’achat générée à l’aide d’Immo-Zen',
    warnings,
  };
}
