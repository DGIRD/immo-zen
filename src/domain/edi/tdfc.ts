/**
 * Télétransmission EDI-TDFC de la liasse BIC au régime réel simplifié (LMNP) : formulaires F-IDENTIF, 2031,
 * 2033-B, 2033-C et dépôts « néant » des 2033-A, D, E, F, G.
 *
 * Références : cahier des charges EDI-TDFC campagne 2026 (DGFiP), volume IV (GUM INFENT Déclaration Fiscale,
 * version 26.01) et dictionnaire des données 2025-2026 (éditeurs, v2026).
 *
 * Ce module produit le message INFENT-DF et l'interchange non sécurisé. La sécurisation (groupe fonctionnel
 * AUTACK signé) et l'envoi SFTP sont des étapes distinctes : un interchange sans AUTACK est refusé par la DGFiP.
 *
 * NON VALIDÉ par un professionnel ni par l'attestation de conformité EDIFICAS.
 */
import type { Liasse2033B } from '../fiscal.ts';
import type { BilanFacts } from '../bilan.ts';
import { UNA, amount, encodeLatin9, invalidLatin9, segment, toLatin9Text } from './edifact.ts';
import { parseAccreditation, signGroup, autackGroup, type RawRsaSigner } from './autack.ts';

// ------------------------------------------------------------------ campagnes intégrées

export interface TdfcCampaign {
  /** Année de la campagne TDFC (dépôts de l'année, exercices clos l'année précédente). */
  year: number;
  /** Millésime des formulaires (AA). */
  millesime: string;
  /** Accord d'interchange (UNB 0032), groupe fonctionnel et message (0057). */
  interchangeAgreement: string;
  groupVersion: string;
}

/** Seules les campagnes dont le cahier des charges a été intégré sont acceptées. */
export const TDFC_CAMPAIGNS: Record<number, TdfcCampaign> = {
  2026: { year: 2026, millesime: '26', interchangeAgreement: 'PED-DGI-IN-TD2601', groupVersion: 'FD2601' },
};

/** Campagne applicable à un exercice clos à la date donnée (exercice civil clos en N → campagne N + 1). */
export function campaignFor(periodEnd: string): TdfcCampaign | null {
  return TDFC_CAMPAIGNS[Number(periodEnd.slice(0, 4)) + 1] ?? null;
}

// ------------------------------------------------------------------ données d'entrée

export interface PostalAddress {
  /** Numéro, indice (B, T, Q) et voie, ex. « 12 rue des Lilas ». */
  street: string;
  complement?: string;
  locality?: string;
  zip: string;
  city: string;
  /** Code ISO 3166 à 2 lettres, seulement hors de France. */
  country?: string;
}

/** Partenaire EDI émetteur (Immo-Zen une fois habilitée). */
export interface EdiPartner {
  /** Numéro d'agrément DGFiP (7 chiffres : code postal + rang). */
  agrement: string;
  name: string;
  address: PostalAddress;
  /** Mode de transfert et alias communiqués par l'ESI de Strasbourg. */
  transfer: { mode: 'T' | 'C'; alias: string };
  software: { editor: string; program: string; version: string; revision?: string };
  /** Référence de l'attestation de conformité EDIFICAS du module. */
  attestation: string;
  /** Accréditation remise par le correspondant téléprocédures (1368 caractères hexadécimaux). */
  accreditation?: string;
}

/** Déclarant (loueur en meublé non professionnel). */
export interface TdfcDeclarant {
  siren: string;
  /** Référence d'obligation fiscale, ex. « BIC1 ». */
  rof: string;
  /** Nom et prénom. */
  name: string;
  /** Adresse de l'établissement (en LMNP, souvent celle du logement loué). */
  address: PostalAddress;
  /** Adresse du domicile, si elle diffère (2031, zone BG). */
  home?: PostalAddress;
  /** Code NAF, ex. « 6820A ». */
  naf?: string;
  activity?: string;
}

export interface TdfcPeriod { start: string; end: string }

/**
 * Montants du bilan au 31/12. Ils sont normalement calculés par `bilanFacts` (src/domain/bilan.ts) à partir des
 * loyers, dépôts, dépenses et de l'historique depuis l'acquisition (voir `balanceFromFacts`).
 */
export interface TdfcBalanceInputs {
  /** Trésorerie d'un compte dédié à l'activité (0 sans compte dédié). */
  cash?: number;
  /** Loyers et charges échus non réglés. */
  receivables?: number;
  /** Dépôts de garantie reçus et non restitués. */
  depositsHeld?: number;
  /** Charges à payer et autres dettes. */
  otherDebts?: number;
  /** Compte de l'exploitant suivi (avant résultat de l'exercice). Absent : il équilibre le bilan. */
  exploitant?: number;
  /** Écart de capital restant dû banque − calcul (pour expliquer l'écart du compte de l'exploitant). */
  loanBankGap?: number;
  /** Corrections manuelles sans contrepartie dans les flux suivis (ex. dépôts corrigés : calcul − correction). */
  manualAdjustment?: number;
}

/** Montants du bilan calculés par l'application. */
export function balanceFromFacts(f: BilanFacts): TdfcBalanceInputs {
  return { cash: f.cash, receivables: f.receivables, depositsHeld: f.depositsHeld, otherDebts: f.payables, exploitant: f.exploitant.closing, loanBankGap: f.loans.bankGap };
}

export interface TdfcRequest {
  partner: EdiPartner;
  declarant: TdfcDeclarant;
  period: TdfcPeriod;
  liasse: Liasse2033B;
  balance?: TdfcBalanceInputs;
  /** Interchange de test (UNB 0035 = 1, UNG DF4) ou réel. */
  test: boolean;
  /** Date de préparation. */
  preparedAt: Date;
  /** Numéro séquentiel de l'interchange dans la journée (1 à 999). */
  sequence: number;
  /** Référence interne du document (restituée dans le compte rendu). */
  documentRef: string;
}

// ------------------------------------------------------------------ données du groupe 4

type Value =
  | { seg: 'MOA'; amount: number }
  | { seg: 'FTX'; texts: string[] }
  | { seg: 'DTM'; value: string; format: '102' | '602' | '718' | '801' | '802' }
  | { seg: 'CCI'; table: string; value: string }
  | { seg: 'CUX'; currency: string }
  | { seg: 'RFF'; value: string }
  | { seg: 'NAD'; id?: string; names: string[]; address?: PostalAddress; phone?: string };

export interface TdfcItem {
  form: string;
  /** Code de la zone sur l'imprimé (CC). */
  code: string;
  /** Indice de répétition de la donnée en tableau (DDDD), 0 hors tableau. */
  row?: number;
  /** Libellé, pour l'aperçu et la relecture. */
  label: string;
  value: Value;
}

/** Code donnée IND 5030 : FFFFFFFFFF MM IIII DDDD CC SSS (25 caractères). */
export function dataCode(item: TdfcItem, millesime: string): string {
  const seg = item.value.seg;
  return item.form.padEnd(10, ' ') + millesime + '0000' + String(item.row ?? 0).padStart(4, '0') + item.code + seg;
}

const pos = (v: number) => Math.max(0, v);
const money = (form: string, code: string, label: string, v: number): TdfcItem => ({ form, code, label, value: { seg: 'MOA', amount: v } });
const neant = (form: string, code: string): TdfcItem => ({ form, code, label: `${form} déposé néant`, value: { seg: 'CCI', table: 'TBX', value: 'X' } });

const ymd = (iso: string) => iso.replaceAll('-', '');
function months(p: TdfcPeriod): number {
  const s = new Date(p.start + 'T00:00:00Z'), e = new Date(p.end + 'T00:00:00Z');
  return (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + e.getUTCMonth() - s.getUTCMonth() + 1;
}

/** Montant d'une ligne de la liasse calculée par Immo-Zen (lignes du 2033-B papier). */
function line(l: Liasse2033B, code: string): number {
  return l.lines.find((x) => x.code === code)?.amount ?? 0;
}

/**
 * Données de la liasse. Correspondance établie d'après les libellés du dictionnaire des données 2026 :
 * les lignes 218 à 354 du 2033-B papier calculées par l'application sont reprises sous les codes EDI de même objet.
 */
export function liasseItems(r: Pick<TdfcRequest, 'declarant' | 'period' | 'liasse' | 'balance'>): TdfcItem[] {
  const { declarant: d, period, liasse: l } = r;
  const items: TdfcItem[] = [];

  // F-IDENTIF : identification du dossier
  items.push(
    { form: 'F-IDENTIF', code: 'AA', label: 'Identification du déclarant', value: { seg: 'NAD', id: d.siren, names: [d.name], address: d.address } },
    { form: 'F-IDENTIF', code: 'BA', label: 'Catégorie fiscale : BIC', value: { seg: 'CCI', table: 'TCF', value: 'BI' } },
    { form: 'F-IDENTIF', code: 'BB', label: 'Régime fiscal : réel simplifié', value: { seg: 'CCI', table: 'TRF', value: 'RS' } },
    { form: 'F-IDENTIF', code: 'BC', label: 'Imposition : impôt sur le revenu', value: { seg: 'CCI', table: 'TBS', value: 'IR' } },
    { form: 'F-IDENTIF', code: 'CA', label: 'Début de l’exercice', value: { seg: 'DTM', value: ymd(period.start), format: '102' } },
    { form: 'F-IDENTIF', code: 'CB', label: 'Fin de l’exercice', value: { seg: 'DTM', value: ymd(period.end), format: '102' } },
    { form: 'F-IDENTIF', code: 'CC', label: 'Durée de l’exercice (mois)', value: { seg: 'DTM', value: String(months(period)), format: '802' } },
    { form: 'F-IDENTIF', code: 'DA', label: 'Monnaie de dépôt', value: { seg: 'CUX', currency: 'EUR' } },
    { form: 'F-IDENTIF', code: 'KD', label: 'Référence d’obligation fiscale', value: { seg: 'RFF', value: d.rof } },
  );
  if (d.naf) items.push({ form: 'F-IDENTIF', code: 'AB', label: 'Code NAF', value: { seg: 'RFF', value: d.naf } });

  // 2031 : déclaration de résultats BIC
  const fiscal = l.fiscalResult;
  items.push({ form: '2031', code: 'AB', label: 'Activité exercée', value: { seg: 'FTX', texts: [d.activity ?? 'Location meublée non professionnelle'] } });
  if (d.home) items.push({ form: '2031', code: 'BG', label: 'Adresse du domicile', value: { seg: 'NAD', names: [], address: d.home } });
  if (fiscal >= 0) items.push(money('2031', 'CA', 'Résultat fiscal : bénéfice', fiscal), money('2031', 'CW', 'BIC non professionnels : bénéfice', fiscal));
  else items.push(money('2031', 'CB', 'Résultat fiscal : déficit', -fiscal), money('2031', 'CX', 'BIC non professionnels : déficit', -fiscal));

  // 2033-B : compte de résultat simplifié
  items.push(
    money('2033B', 'BC', 'Production vendue (services) — ligne 218', line(l, '218')),
    money('2033B', 'BH', 'Total des produits d’exploitation — ligne 232', line(l, '232')),
    money('2033B', 'BN', 'Autres charges externes — ligne 242', line(l, '242')),
    money('2033B', 'BP', 'Impôts, taxes et versements assimilés — ligne 244', line(l, '244')),
    money('2033B', 'BS', 'Dotations aux amortissements — ligne 254', line(l, '254')),
    money('2033B', 'BV', 'Total des charges d’exploitation — ligne 264', line(l, '264')),
    money('2033B', 'BW', 'Résultat d’exploitation — ligne 270', line(l, '270')),
    money('2033B', 'BZ', 'Charges financières — ligne 294', line(l, '294')),
    money('2033B', 'CC', 'Bénéfice ou perte — ligne 310', line(l, '310')),
  );
  const reint = line(l, '318');
  if (reint > 0) items.push(money('2033B', 'CF', 'Amortissements non déductibles (art. 39 C du CGI)', reint));
  if (l.deferredUsed > 0) {
    items.push(
      money('2033B', 'EL', 'Déductions diverses', l.deferredUsed),
      { form: '2033B', code: 'MA', row: 1, label: 'Détail des déductions diverses : libellé', value: { seg: 'FTX', texts: ['Amortissements différés imputés (art. 39 C)'] } },
      { ...money('2033B', 'MB', 'Détail des déductions diverses : montant', l.deferredUsed), row: 1 },
    );
  }
  if (fiscal >= 0) items.push(money('2033B', 'CM', 'Bénéfice fiscal avant imputation des déficits', fiscal), money('2033B', 'CR', 'Bénéfice fiscal après imputation des déficits', fiscal));
  else items.push(money('2033B', 'EM', 'Déficit fiscal avant imputation des déficits', -fiscal), money('2033B', 'ER', 'Déficit fiscal après imputation des déficits', -fiscal));

  // 2033-A : bilan simplifié ; 2033-C : immobilisations et amortissements
  items.push(...items2033A(bilan2033A(l, period, r.balance)));
  items.push(...items2033C(l, period));

  // Formulaires sans contenu pour un LMNP sans salarié ni associé
  items.push(neant('2033D', 'PF'), neant('2033E', 'DB'), neant('2033F', 'GS'), neant('2033G', 'GS'));
  return items;
}

/** Bilan simplifié 2033-A d'un loueur en meublé : immobilisations, créances, trésorerie, emprunts, dépôts. */
export interface Bilan2033A {
  immoGross: number; immoDep: number; immoNet: number;
  receivables: number; cash: number; currentTotal: number;
  assetsGross: number; assetsDep: number; assetsNet: number;
  /** Capital individuel déclaré (compte de l'exploitant suivi + écart éventuel). */
  capital: number; result: number; equity: number;
  loans: number; otherDebts: number; debts: number; liabilities: number;
  loansBeyondOneYear: number; acquisitions: number;
  /** Compte de l'exploitant issu du suivi (null s'il n'est pas suivi : le capital équilibre alors le bilan). */
  tracked: number | null;
  /** Écart entre le bilan et le compte de l'exploitant suivi, et sa décomposition probable. */
  gap: number;
  gapExplained: { receivables: number; payables: number; loanBank: number; manual: number; other: number };
}

export function bilan2033A(l: Liasse2033B, period: TdfcPeriod, b: TdfcBalanceInputs = {}): Bilan2033A {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const immoGross = r2(l.assets.reduce((s, a) => s + a.gross, 0));
  const immoDep = r2(l.assets.reduce((s, a) => s + a.cumulated, 0));
  const immoNet = r2(immoGross - immoDep);
  const receivables = r2(b.receivables ?? 0), cash = r2(b.cash ?? 0);
  const currentTotal = r2(receivables + cash);
  const assetsNet = r2(immoNet + currentTotal);
  const result = line(l, '310');
  const loans = l.loans.remaining;
  const otherDebts = r2((b.depositsHeld ?? 0) + (b.otherDebts ?? 0));
  const debts = r2(loans + otherDebts);
  const balancing = r2(assetsNet - result - debts);
  const tracked = b.exploitant ?? null;
  const gap = tracked === null ? 0 : r2(balancing - tracked);
  // résultat calculé sur les encaissements : créances et charges à payer ne sont pas dans le résultat ;
  // un capital restant dû de la banque différent du calcul n'a pas de contrepartie dans les flux suivis
  const explained = { receivables, payables: -(b.otherDebts ?? 0), loanBank: -(b.loanBankGap ?? 0), manual: r2(b.manualAdjustment ?? 0) };
  const other = r2(gap - explained.receivables - explained.payables - explained.loanBank - explained.manual);
  const capital = balancing;
  return {
    immoGross, immoDep, immoNet, receivables, cash, currentTotal,
    assetsGross: r2(immoGross + currentTotal), assetsDep: immoDep, assetsNet,
    capital, result, equity: r2(capital + result), loans, otherDebts, debts, liabilities: r2(capital + result + debts),
    loansBeyondOneYear: l.loans.beyondOneYear,
    acquisitions: r2(l.assets.filter((a) => a.start >= period.start && a.start <= period.end).reduce((s, a) => s + a.gross, 0)),
    tracked, gap, gapExplained: { ...explained, other: tracked === null ? 0 : other },
  };
}

function items2033A(b: Bilan2033A): TdfcItem[] {
  const m = (code: string, label: string, v: number) => money('2033A', code, label, v);
  const out = [
    m('AC', 'Immobilisations corporelles, brut', b.immoGross), m('BC', 'Immobilisations corporelles, amortissements', b.immoDep), m('CC', 'Immobilisations corporelles, net', b.immoNet),
    m('AE', 'Total I actif immobilisé, brut', b.immoGross), m('BE', 'Total I actif immobilisé, amortissements', b.immoDep), m('CE', 'Total I actif immobilisé, net', b.immoNet),
  ];
  if (b.receivables) out.push(m('AJ', 'Créances clients, brut', b.receivables), m('CJ', 'Créances clients, net', b.receivables));
  if (b.cash) out.push(m('AM', 'Disponibilités, brut', b.cash), m('CM', 'Disponibilités, net', b.cash));
  out.push(
    m('AQ', 'Total II actif circulant, brut', b.currentTotal), m('CQ', 'Total II actif circulant, net', b.currentTotal),
    m('AR', 'Total général de l’actif, brut', b.assetsGross), m('BR', 'Total général de l’actif, amortissements', b.assetsDep), m('CR', 'Total général de l’actif, net', b.assetsNet),
    m('FA', 'Capital individuel (compte de l’exploitant)', b.capital), m('FG', 'Résultat de l’exercice', b.result), m('FJ', 'Total I capitaux propres', b.equity),
  );
  if (b.loans) out.push(m('FL', 'Emprunts et dettes assimilées', b.loans));
  if (b.otherDebts) out.push(m('FP', 'Autres dettes (dépôts de garantie reçus)', b.otherDebts));
  out.push(m('FR', 'Total III dettes', b.debts), m('FS', 'Total général du passif', b.liabilities));
  if (b.loansBeyondOneYear) out.push(m('JA', 'Dettes à plus d’un an', b.loansBeyondOneYear));
  if (b.acquisitions) out.push(m('JB', 'Coût de revient des immobilisations acquises dans l’exercice', b.acquisitions));
  return out;
}

/** Lignes du 2033-C par nature : terrain, bâti → constructions, travaux → agencements, meubles → autres immobilisations. */
function items2033C(l: Liasse2033B, period: TdfcPeriod): TdfcItem[] {
  const rows = {
    terrain: { label: 'terrains', gross: ['AC', 'BC', 'DC'], dep: [] },
    bati: { label: 'constructions', gross: ['AD', 'BD', 'DD'], dep: ['FC', 'GC', 'JC'] },
    travaux: { label: 'installations générales, agencements', gross: ['AF', 'BF', 'DF'], dep: ['FE', 'GE', 'JE'] },
    meuble: { label: 'autres immobilisations corporelles', gross: ['AH', 'BH', 'DH'], dep: ['FG', 'GG', 'JG'] },
  } as const;
  const out: TdfcItem[] = [];
  const total = { begin: 0, added: 0, end: 0, depBegin: 0, dot: 0, depEnd: 0 };
  for (const [kind, r] of Object.entries(rows) as [keyof typeof rows, (typeof rows)[keyof typeof rows]][]) {
    const list = l.assets.filter((a) => a.kind === kind);
    if (list.length === 0) continue;
    const added = list.filter((a) => a.start >= period.start && a.start <= period.end).reduce((s, a) => s + a.gross, 0);
    const end = list.reduce((s, a) => s + a.gross, 0);
    const depEnd = list.reduce((s, a) => s + a.cumulated, 0);
    const dot = list.reduce((s, a) => s + a.dotation, 0);
    const begin = end - added, depBegin = depEnd - dot;
    out.push(
      money('2033C', r.gross[0]!, `Valeur brute au début de l’exercice : ${r.label}`, begin),
      money('2033C', r.gross[1]!, `Augmentations : ${r.label}`, added),
      money('2033C', r.gross[2]!, `Valeur brute en fin d’exercice : ${r.label}`, end),
    );
    const [dBegin, dDot, dEnd] = r.dep as readonly string[];
    if (dBegin && dDot && dEnd) out.push(
      money('2033C', dBegin, `Amortissements au début de l’exercice : ${r.label}`, depBegin),
      money('2033C', dDot, `Dotations de l’exercice : ${r.label}`, dot),
      money('2033C', dEnd, `Amortissements en fin d’exercice : ${r.label}`, depEnd),
    );
    total.begin += begin; total.added += added; total.end += end; total.depBegin += depBegin; total.dot += dot; total.depEnd += depEnd;
  }
  if (out.length === 0) return [neant('2033C', 'RQ')];
  out.push(
    money('2033C', 'AK', 'Total des immobilisations au début de l’exercice', total.begin),
    money('2033C', 'BK', 'Total des augmentations', total.added),
    money('2033C', 'DK', 'Total des immobilisations en fin d’exercice', total.end),
    money('2033C', 'FH', 'Total des amortissements au début de l’exercice', total.depBegin),
    money('2033C', 'GH', 'Total des dotations de l’exercice', total.dot),
    money('2033C', 'JH', 'Total des amortissements en fin d’exercice', total.depEnd),
  );
  return out;
}

// ------------------------------------------------------------------ segments

function addressComposite(a: PostalAddress): (string | undefined)[] {
  const street = /^\d/.test(a.street.trim()) ? a.street.trim() : `0000 ${a.street.trim()}`;
  return [street, a.complement, a.locality];
}

function nad(qualifier: string, id: (string | undefined)[] | undefined, names: (string | undefined)[] | undefined, a?: PostalAddress): string {
  return segment('NAD', qualifier, id, undefined, names, a ? addressComposite(a) : undefined, a?.city, undefined, a?.zip, a?.country);
}

function valueSegments(v: Value): string[] {
  switch (v.seg) {
    case 'MOA': {
      const m = amount(v.amount);
      return [segment('MOA', ['ZZZ', m.value, undefined, undefined, m.status])];
    }
    case 'FTX': return [segment('FTX', 'ZZZ', undefined, undefined, v.texts)];
    case 'DTM': return [segment('DTM', ['ZZZ', v.value, v.format])];
    case 'CCI': return [segment('CCI', undefined, undefined, [v.table, 'LIS', '211']), segment('CAV', [v.value, v.table, '211'])];
    case 'CUX': return [segment('CUX', ['3', v.currency])];
    case 'RFF': return [segment('RFF', ['ZZZ', v.value])];
    case 'NAD': {
      const out = [nad('ZZZ', v.id ? [v.id, '100', 'ZZZ'] : undefined, v.names.length ? v.names : undefined, v.address)];
      if (v.phone) out.push(segment('CTA', 'ZZZ', [undefined, v.phone]), segment('COM', [v.phone, 'TE']));
      return out;
    }
  }
}

/** Date et heure légales de Paris (préparation de l'interchange et horodatage de la signature). */
export function parisStamp(d: Date): { yyyymmdd: string; yymmdd: string; hhmm: string; signature: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((p) => [p.type, p.value]));
  const yyyymmdd = `${parts.year}${parts.month}${parts.day}`, hhmm = `${parts.hour}${parts.minute}`;
  return { yyyymmdd, yymmdd: yyyymmdd.slice(2), hhmm, signature: yyyymmdd + hhmm };
}

/** Référence d'interchange (n14) : agrément (7) + dernier chiffre de l'année + quantième (3) + séquence (3). */
export function interchangeRef(agrement: string, at: Date, sequence: number): string {
  const s = parisStamp(at).yyyymmdd;
  const [y, m, d] = [Number(s.slice(0, 4)), Number(s.slice(4, 6)), Number(s.slice(6))];
  const day = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000) + 1;
  return agrement + String(y % 10) + String(day).padStart(3, '0') + String(sequence).padStart(3, '0');
}

export interface TdfcMessage {
  campaign: TdfcCampaign;
  items: TdfcItem[];
  /** Segments UNH … UNT du message INFENT-DF. */
  segments: string[];
  /** Groupe fonctionnel INFENT (UNG … UNE), objet de la signature. */
  group: string;
  /** Interchange complet, sans le groupe fonctionnel AUTACK de sécurisation. */
  interchange: string;
  reference: string;
  test: boolean;
  agrement: string;
  stamp: ReturnType<typeof parisStamp>;
}

/** Construit le message INFENT-DF et l'interchange (non sécurisé). */
export function buildInterchange(r: TdfcRequest): TdfcMessage {
  const campaign = campaignFor(r.period.end);
  if (!campaign) throw new Error(`Cahier des charges EDI-TDFC non intégré pour un exercice clos le ${r.period.end}.`);
  const items = liasseItems(r);
  const p = r.partner;
  const at = parisStamp(r.preparedAt);
  const ref = interchangeRef(p.agrement, r.preparedAt, r.sequence);
  const msgRef = '00001';

  const body: string[] = [
    segment('UNH', msgRef, ['INFENT', 'D', '00B', 'UN', campaign.groupVersion]),
    segment('BGM', ['IDF', '71', '211'], ['INFENT' + r.documentRef]),
    segment('DTM', ['242', at.yyyymmdd, '102']),
    segment('RFF', ['AUM', p.software.editor]),
    segment('RFF', ['AUN', p.software.program, undefined, p.software.version, p.software.revision]),
    segment('RFF', ['AUO', p.attestation]),
    nad('MS', [p.agrement, '100', '268'], [p.name], p.address),
    segment('NAD', 'MR', undefined, undefined, ['DGI_EDI_TDFC']),
  ];
  items.forEach((item, i) => {
    body.push(segment('SEQ', undefined, [String(i + 1)]), segment('IND', undefined, [dataCode(item, campaign.millesime)]), ...valueSegments(item.value));
  });
  body.push(segment('UNT', String(body.length + 1), msgRef));

  const group = [
    segment('UNG', 'INFENT', [r.test ? 'DF4' : 'DF1', '146'], ['EDI_TDFC'], [at.yymmdd, at.hhmm], '1', 'UN', ['D', '00B', campaign.groupVersion]),
    ...body,
    segment('UNE', '1', '1'),
  ].join('');
  const header = UNA + segment('UNB', ['UNOL', '3'], [p.agrement, '146', p.transfer.mode + p.transfer.alias], ['DGI_EDI_TDFC'], [at.yymmdd, at.hhmm], ref,
    undefined, undefined, undefined, undefined, campaign.interchangeAgreement, r.test ? '1' : undefined);
  const interchange = header + group + segment('UNZ', '1', ref);
  return { campaign, items, segments: body, group, interchange, reference: ref, test: r.test, agrement: p.agrement, stamp: at };
}

/** Interchange non sécurisé encodé en ISO 8859-15 (pour relecture ; la DGFiP refuse un envoi sans AUTACK). */
export function encodeInterchange(m: TdfcMessage): Uint8Array {
  return encodeLatin9(m.interchange);
}

export interface SecuredInterchange {
  /** Fichier à transmettre (ISO 8859-15). */
  bytes: Uint8Array;
  text: string;
  signatureHex: string;
  reference: string;
}

/**
 * Sécurise l'interchange : signature du groupe INFENT et ajout du groupe AUTACK PEDI (UNZ compte 2 groupes).
 * L'accréditation doit avoir été délivrée pour la clé du signataire (vérifié par la fonction serveur).
 */
export async function secureInterchange(m: TdfcMessage, accreditationText: string, signer: RawRsaSigner): Promise<SecuredInterchange> {
  const accreditation = parseAccreditation(accreditationText);
  const signatureHex = await signGroup(encodeLatin9(m.group), m.stamp.signature, signer);
  const unb = m.interchange.slice(0, m.interchange.indexOf("'UNG+") + 1);
  const text = unb + m.group
    + autackGroup({ test: m.test, agrement: m.agrement, accreditation, signatureHex, yymmdd: m.stamp.yymmdd, hhmm: m.stamp.hhmm })
    + segment('UNZ', '2', m.reference);
  return { bytes: encodeLatin9(text), text, signatureHex, reference: m.reference };
}

// ------------------------------------------------------------------ contrôles avant envoi

export interface TdfcCheck { level: 'bloquant' | 'avertissement'; message: string }

/** Clé de Luhn du SIREN. */
export function validSiren(siren: string): boolean {
  if (!/^\d{9}$/.test(siren)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) {
    let n = Number(siren[8 - i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    s += n;
  }
  return s % 10 === 0;
}

const ROF = /^(BIC|IS|BA|BNC|ISGROUPE|RF|CVAE|CFE)[1-9]\d{0,4}$/;

function checkAddress(where: string, a: PostalAddress | undefined, out: TdfcCheck[]) {
  if (!a) return;
  if (!a.street.trim()) out.push({ level: 'bloquant', message: `${where} : voie manquante.` });
  if (!a.city.trim()) out.push({ level: 'bloquant', message: `${where} : ville manquante.` });
  if (!a.country && !/^\d{5}$/.test(a.zip)) out.push({ level: 'bloquant', message: `${where} : code postal invalide (${a.zip}).` });
  for (const [k, v] of [['voie', a.street], ['complément', a.complement], ['lieu-dit', a.locality], ['ville', a.city]] as const)
    if (v && toLatin9Text(v).length > 35) out.push({ level: 'bloquant', message: `${where} : ${k} trop long (35 caractères au plus).` });
}

/** Contrôles avant envoi. Un seul contrôle bloquant interdit la transmission. */
export function checkRequest(r: TdfcRequest): TdfcCheck[] {
  const out: TdfcCheck[] = [];
  const { partner: p, declarant: d, period, liasse: l } = r;

  if (!campaignFor(period.end)) out.push({ level: 'bloquant', message: `Exercice clos le ${period.end} : le cahier des charges de la campagne ${Number(period.end.slice(0, 4)) + 1} n’est pas encore intégré.` });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period.start) || !/^\d{4}-\d{2}-\d{2}$/.test(period.end) || period.start > period.end)
    out.push({ level: 'bloquant', message: 'Période de l’exercice invalide.' });
  else if (months(period) > 24) out.push({ level: 'bloquant', message: 'Exercice de plus de 24 mois.' });

  if (!/^\d{7}$/.test(p.agrement)) out.push({ level: 'bloquant', message: 'Numéro d’agrément du partenaire EDI absent ou invalide (7 chiffres) : à recevoir après l’habilitation DGFiP.' });
  if (!/^[A-Z0-9]{8}$/.test(p.transfer.alias)) out.push({ level: 'bloquant', message: 'Alias de transfert absent ou invalide (8 caractères) : communiqué par l’ESI de Strasbourg.' });
  if (!p.attestation.trim()) out.push({ level: 'bloquant', message: 'Référence de l’attestation de conformité EDIFICAS manquante.' });
  if (!p.software.editor.trim() || !p.software.program.trim() || !p.software.version.trim()) out.push({ level: 'bloquant', message: 'Références du logiciel émetteur incomplètes.' });
  checkAddress('Adresse du partenaire EDI', p.address, out);

  if (!validSiren(d.siren)) out.push({ level: 'bloquant', message: `SIREN du déclarant invalide (${d.siren || 'vide'}).` });
  if (!ROF.test(d.rof)) out.push({ level: 'bloquant', message: `Référence d’obligation fiscale invalide (${d.rof || 'vide'}) : attendu BIC suivi d’un numéro sans zéro initial, ex. BIC1.` });
  if (!d.name.trim()) out.push({ level: 'bloquant', message: 'Nom du déclarant manquant.' });
  else if (toLatin9Text(d.name).length > 35) out.push({ level: 'bloquant', message: 'Nom du déclarant trop long (35 caractères au plus).' });
  checkAddress('Adresse du déclarant', d.address, out);
  checkAddress('Adresse du domicile', d.home, out);
  if (d.naf && !/^\d{4}[A-Z]$/.test(d.naf)) out.push({ level: 'bloquant', message: `Code NAF invalide (${d.naf}).` });

  if (!Number.isInteger(r.sequence) || r.sequence < 1 || r.sequence > 999) out.push({ level: 'bloquant', message: 'Numéro séquentiel d’interchange hors limites (1 à 999 par jour).' });
  if (!r.documentRef.trim() || r.documentRef.length > 29) out.push({ level: 'bloquant', message: 'Référence de document manquante ou trop longue (29 caractères au plus).' });

  // cohérence de la liasse
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
  const L = (c: string) => line(l, c);
  if (!near(L('264'), L('242') + L('244') + L('254'))) out.push({ level: 'bloquant', message: '2033-B : le total des charges (264) ne correspond pas à la somme des lignes 242, 244 et 254.' });
  if (!near(L('270'), L('232') - L('264'))) out.push({ level: 'bloquant', message: '2033-B : le résultat d’exploitation (270) est incohérent.' });
  if (!near(L('310'), L('270') - L('294'))) out.push({ level: 'bloquant', message: '2033-B : le résultat comptable (310) est incohérent.' });
  if (!near(l.fiscalResult, L('310') + L('318') - l.deferredUsed)) out.push({ level: 'bloquant', message: '2033-B : le résultat fiscal est incohérent avec les réintégrations et déductions.' });
  if (L('218') === 0) out.push({ level: 'avertissement', message: 'Aucune recette déclarée sur l’exercice.' });
  if (l.assets.length === 0) out.push({ level: 'avertissement', message: '2033-C déposé néant : aucune immobilisation amortie.' });
  if (Object.values(l.lines).some((x) => !Number.isInteger(x.amount))) out.push({ level: 'avertissement', message: 'Les centimes sont tronqués (règle TDFC : euros entiers, sans arrondi).' });

  const bil = bilan2033A(l, period, r.balance);
  if (!near(bil.assetsNet, bil.liabilities)) out.push({ level: 'bloquant', message: `2033-A : bilan déséquilibré (actif ${bil.assetsNet} €, passif ${bil.liabilities} €).` });
  if (!near(bil.assetsGross - bil.assetsDep, bil.assetsNet)) out.push({ level: 'bloquant', message: '2033-A : total de l’actif incohérent (brut − amortissements ≠ net).' });
  if (r.balance?.cash === undefined) out.push({ level: 'avertissement', message: '2033-A : trésorerie de l’activité non renseignée, comptée à 0.' });
  if (r.balance?.depositsHeld === undefined) out.push({ level: 'avertissement', message: '2033-A : dépôts de garantie reçus non renseignés, comptés à 0.' });
  if (bil.capital < 0) out.push({ level: 'avertissement', message: `2033-A : compte de l’exploitant négatif (${bil.capital} €) — vérifier la trésorerie et les emprunts.` });
  if (bil.tracked === null) out.push({ level: 'avertissement', message: '2033-A : compte de l’exploitant non suivi, calculé pour équilibrer le bilan.' });
  else if (Math.abs(bil.gap) >= 1) {
    const e = bil.gapExplained, parts: string[] = [];
    if (e.receivables) parts.push(`loyers impayés au 31/12 ${e.receivables} €`);
    if (e.payables) parts.push(`charges à payer ${e.payables} €`);
    if (e.loanBank) parts.push(`écart capital restant dû banque / calcul ${e.loanBank} €`);
    if (e.manual) parts.push(`corrections manuelles ${e.manual} €`);
    if (Math.abs(e.other) >= 1) parts.push(`non expliqué ${e.other} € (retenues sur dépôt, années hors réel, saisies manuelles)`);
    out.push({ level: Math.abs(e.other) >= 1 ? 'bloquant' : 'avertissement', message: `2033-A : écart de ${bil.gap} € entre le bilan et le compte de l’exploitant suivi (${bil.tracked} €) : ${parts.join(', ')}. Le résultat étant calculé sur les encaissements, les impayés et charges à payer créent cet écart.` });
  }
  if (!p.accreditation) out.push({ level: 'bloquant', message: 'Accréditation DGFiP absente : l’interchange ne peut pas être signé (à obtenir auprès du correspondant téléprocédures).' });
  else {
    try {
      parseAccreditation(p.accreditation);
    } catch (e) {
      out.push({ level: 'bloquant', message: (e as Error).message });
    }
  }

  // jeu de caractères
  const texts = [d.name, d.activity ?? '', d.address.street, d.address.city, d.address.complement ?? '', d.home?.street ?? '', d.home?.city ?? '', p.name];
  const bad = invalidLatin9(texts.map(toLatin9Text).join(''));
  if (bad.length) out.push({ level: 'bloquant', message: `Caractères non autorisés (ISO 8859-15) : ${bad.join(' ')}` });
  return out;
}
