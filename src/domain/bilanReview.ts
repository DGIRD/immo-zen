/**
 * Relecture du bilan 2033-A : chaque ligne avec son montant, son origine et son détail, corrections manuelles
 * motivées et conservées (une correction annulée reste visible), écart avec le compte de l'exploitant suivi.
 */
import type { BilanCorrection, Property, TaxPropertyInputs } from '../data/types.ts';
import { bilanFacts, type BilanData, type BilanFacts, type Line } from './bilan.ts';
import { balanceFromFacts, bilan2033A, type Bilan2033A, type TdfcBalanceInputs, type TdfcPeriod } from './edi/tdfc.ts';
import { loanBalance, type Liasse2033B } from './fiscal.ts';
import { round2 } from './simulator.ts';

export type Origin = 'calcul' | 'banque' | 'saisie' | 'correction' | 'convention' | 'historique' | 'bilan_n-1' | 'liasse' | 'total';
export const ORIGIN_LABELS: Record<Origin, string> = {
  calcul: 'Calculé', banque: 'Banque', saisie: 'Saisi', correction: 'Corrigé', convention: 'Convention',
  historique: 'Suivi depuis l’achat', 'bilan_n-1': 'Bilan N-1 repris', liasse: 'Liasse', total: 'Total',
};

export const CORRECTABLE: Record<BilanCorrection['field'], string> = {
  receivables: 'Créances (loyers impayés au 31/12)',
  depositsHeld: 'Dépôts de garantie détenus',
  payables: 'Charges à payer',
};

export interface ReviewLine {
  code: string;
  label: string;
  amount: number;
  origin: Origin;
  note?: string;
  detail?: Line[];
  /** Montant calculé avant correction manuelle. */
  computed?: number;
  field?: BilanCorrection['field'];
}

export interface BilanReview {
  facts: BilanFacts;
  bilan: Bilan2033A;
  /** Montants à transmettre (corrections comprises). */
  balance: TdfcBalanceInputs;
  actif: ReviewLine[];
  passif: ReviewLine[];
  corrections: BilanCorrection[];
  /** Message sur l'écart avec le compte de l'exploitant suivi, et sa gravité. */
  gapMessage: { level: 'ok' | 'avertissement' | 'bloquant'; text: string };
}

/** Correction en vigueur pour une ligne : la plus récente non annulée. */
export function activeCorrection(list: BilanCorrection[] | undefined, field: BilanCorrection['field']): BilanCorrection | null {
  return (list ?? []).filter((c) => c.field === field && !c.revoked_at).sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
}

export function reviewBilan(
  year: number, d: BilanData, properties: Property[], liasse: Liasse2033B,
  inputs: (pid: string, y: number) => TaxPropertyInputs, foyer: TaxPropertyInputs,
): BilanReview {
  const period: TdfcPeriod = { start: `${year}-01-01`, end: `${year}-12-31` };
  const ids = properties.map((p) => p.id);
  const facts = bilanFacts(year, d, ids, inputs, { cash: foyer.bilan_cash, cashPrevious: foyer.bilan_cash_previous, openingEquity: foyer.bilan_opening_equity });
  const corrections = foyer.bilan_corrections ?? [];
  const pick = (field: BilanCorrection['field'], computed: number) => {
    const c = activeCorrection(corrections, field);
    return { amount: c ? round2(c.amount) : computed, c };
  };
  const rec = pick('receivables', facts.receivables), dep = pick('depositsHeld', facts.depositsHeld), pay = pick('payables', facts.payables);
  // les créances et charges à payer corrigées restent expliquées par leur nature ; la correction des dépôts
  // n'a pas de contrepartie dans les flux suivis : elle est expliquée comme correction manuelle
  const balance: TdfcBalanceInputs = { ...balanceFromFacts(facts), receivables: rec.amount, depositsHeld: dep.amount, otherDebts: pay.amount,
    manualAdjustment: round2(facts.depositsHeld - dep.amount) };
  const bilan = bilan2033A(liasse, period, balance);

  const corr = (c: BilanCorrection | null, computed: number): Pick<ReviewLine, 'origin' | 'note' | 'computed'> =>
    c ? { origin: 'correction', note: `${c.reason} (le ${c.at.slice(0, 10).split('-').reverse().join('/')})`, computed } : { origin: 'calcul' };
  const assets = liasse.assets.map((a) => ({ label: a.label, amount: a.gross }));
  const deps = liasse.assets.filter((a) => a.cumulated > 0).map((a) => ({ label: a.label, amount: a.cumulated }));

  const actif: ReviewLine[] = [
    { code: 'AC', label: 'Immobilisations corporelles, valeur brute', amount: bilan.immoGross, origin: 'liasse', detail: assets, note: 'Terrain, bâti, meubles et travaux amortissables (2033-C)' },
    { code: 'BC', label: 'Amortissements cumulés', amount: bilan.immoDep, origin: 'liasse', detail: deps },
    { code: 'CC', label: 'Immobilisations, valeur nette', amount: bilan.immoNet, origin: 'total' },
    { code: 'AJ', label: 'Créances : loyers et charges impayés au 31/12', amount: bilan.receivables, ...corr(rec.c, facts.receivables), detail: facts.receivablesDetail, field: 'receivables' },
    { code: 'AM', label: 'Disponibilités', amount: bilan.cash, origin: foyer.bilan_cash != null ? 'saisie' : 'convention',
      note: foyer.bilan_cash != null ? 'Solde du compte dédié au 31/12' : 'Activité sans compte bancaire dédié : 0' },
    { code: 'CR', label: 'Total de l’actif (net)', amount: bilan.assetsNet, origin: 'total' },
  ];

  const loanDetail = properties.map((p) => {
    const lb = loanBalance(p, year, inputs(p.id, year));
    return { p, lb };
  }).filter((x) => x.lb.remaining > 0 || x.lb.source === 'banque');
  const loanOrigin: Origin = loanDetail.length && loanDetail.every((x) => x.lb.source === 'banque') ? 'banque' : 'calcul';
  const ex = facts.exploitant;
  const passif: ReviewLine[] = [
    { code: 'FA', label: 'Capital individuel (compte de l’exploitant)', amount: bilan.capital, origin: ex.source === 'bilan_n-1' ? 'bilan_n-1' : 'historique',
      note: Math.abs(bilan.gap) >= 1 ? `Compte suivi ${ex.closing} € ; écart de ${bilan.gap} € intégré pour équilibrer le bilan` : 'Égal au compte suivi : le bilan s’équilibre de lui-même',
      detail: [{ label: 'Ouverture', amount: ex.opening }, ...ex.contributionsDetail.map((l) => ({ label: `+ ${l.label}`, amount: l.amount })),
        ...ex.withdrawalsDetail.map((l) => ({ label: `− ${l.label}`, amount: -l.amount })), { label: 'Clôture (avant résultat)', amount: ex.closing }] },
    { code: 'FG', label: 'Résultat de l’exercice', amount: bilan.result, origin: 'liasse', note: '2033-B, ligne 310' },
    { code: 'FJ', label: 'Capitaux propres', amount: bilan.equity, origin: 'total' },
    { code: 'FL', label: 'Emprunts (capital restant dû au 31/12)', amount: bilan.loans, origin: loanOrigin,
      detail: loanDetail.map(({ p, lb }) => ({ label: `${p.title} — ${lb.source === 'banque' ? `banque (calcul : ${lb.computed} €)` : 'calculé d’après le crédit du bien'}`, amount: lb.remaining })) },
    { code: 'FP', label: 'Dépôts de garantie détenus', amount: dep.amount, ...corr(dep.c, facts.depositsHeld), field: 'depositsHeld' },
    { code: 'FP', label: 'Charges à payer', amount: pay.amount, ...corr(pay.c, facts.payables), detail: facts.payablesDetail, field: 'payables' },
    { code: 'FS', label: 'Total du passif', amount: bilan.liabilities, origin: 'total' },
    { code: 'JA', label: 'dont dettes à plus d’un an', amount: bilan.loansBeyondOneYear, origin: loanOrigin },
  ];

  let gapMessage: BilanReview['gapMessage'] = { level: 'ok', text: 'Le bilan s’équilibre avec le compte de l’exploitant suivi.' };
  if (Math.abs(bilan.gap) >= 1) {
    const e = bilan.gapExplained, parts: string[] = [];
    if (e.receivables) parts.push(`loyers impayés ${e.receivables} €`);
    if (e.payables) parts.push(`charges à payer ${e.payables} €`);
    if (e.loanBank) parts.push(`écart banque / calcul ${e.loanBank} €`);
    if (e.manual) parts.push(`corrections manuelles ${e.manual} €`);
    if (Math.abs(e.other) >= 1) parts.push(`non expliqué ${e.other} €`);
    gapMessage = {
      level: Math.abs(e.other) >= 1 ? 'bloquant' : 'avertissement',
      text: `Écart de ${bilan.gap} € entre le bilan et le compte de l’exploitant suivi : ${parts.join(', ')}.`
        + (Math.abs(e.other) >= 1 ? ' Vérifiez les loyers, dépenses et dépôts, ou reprenez les capitaux propres du bilan N-1 déposé.' : ' Il vient du calcul du résultat sur les encaissements.'),
    };
  }
  return { facts, bilan, balance, actif, passif, corrections, gapMessage };
}
