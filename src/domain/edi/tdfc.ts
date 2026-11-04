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
import { UNA, amount, encodeLatin9, invalidLatin9, segment, toLatin9Text } from './edifact.ts';

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

export interface TdfcRequest {
  partner: EdiPartner;
  declarant: TdfcDeclarant;
  period: TdfcPeriod;
  liasse: Liasse2033B;
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
export function liasseItems(r: Pick<TdfcRequest, 'declarant' | 'period' | 'liasse'>): TdfcItem[] {
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

  // 2033-C : immobilisations et amortissements
  items.push(...items2033C(l, period));

  // Formulaires sans contenu pour un LMNP sans salarié ni associé
  items.push(neant('2033D', 'PF'), neant('2033E', 'DB'), neant('2033F', 'GS'), neant('2033G', 'GS'));
  return items;
}

/** Lignes du 2033-C par nature : bâti → constructions, travaux → installations et agencements, meubles → autres. */
function items2033C(l: Liasse2033B, period: TdfcPeriod): TdfcItem[] {
  const rows = {
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
      money('2033C', r.gross[0], `Valeur brute au début de l’exercice : ${r.label}`, begin),
      money('2033C', r.gross[1], `Augmentations : ${r.label}`, added),
      money('2033C', r.gross[2], `Valeur brute en fin d’exercice : ${r.label}`, end),
      money('2033C', r.dep[0], `Amortissements au début de l’exercice : ${r.label}`, depBegin),
      money('2033C', r.dep[1], `Dotations de l’exercice : ${r.label}`, dot),
      money('2033C', r.dep[2], `Amortissements en fin d’exercice : ${r.label}`, depEnd),
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

const yymmdd = (d: Date) => d.toISOString().slice(2, 10).replaceAll('-', '');
const hhmm = (d: Date) => d.toISOString().slice(11, 16).replace(':', '');

/** Référence d'interchange (n14) : agrément (7) + dernier chiffre de l'année + quantième (3) + séquence (3). */
export function interchangeRef(agrement: string, at: Date, sequence: number): string {
  const start = Date.UTC(at.getUTCFullYear(), 0, 1);
  const day = Math.floor((at.getTime() - start) / 86400000) + 1;
  return agrement + String(at.getUTCFullYear() % 10) + String(day).padStart(3, '0') + String(sequence).padStart(3, '0');
}

export interface TdfcMessage {
  campaign: TdfcCampaign;
  items: TdfcItem[];
  /** Segments UNH … UNT du message INFENT-DF. */
  segments: string[];
  /** Interchange complet, sans le groupe fonctionnel AUTACK de sécurisation. */
  interchange: string;
  reference: string;
}

/** Construit le message INFENT-DF et l'interchange (non sécurisé). */
export function buildInterchange(r: TdfcRequest): TdfcMessage {
  const campaign = campaignFor(r.period.end);
  if (!campaign) throw new Error(`Cahier des charges EDI-TDFC non intégré pour un exercice clos le ${r.period.end}.`);
  const items = liasseItems(r);
  const p = r.partner;
  const at = r.preparedAt;
  const ref = interchangeRef(p.agrement, at, r.sequence);
  const msgRef = '00001';

  const body: string[] = [
    segment('UNH', msgRef, ['INFENT', 'D', '00B', 'UN', campaign.groupVersion]),
    segment('BGM', ['IDF', '71', '211'], ['INFENT' + r.documentRef]),
    segment('DTM', ['242', at.toISOString().slice(0, 10).replaceAll('-', ''), '102']),
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

  const interchange = [
    UNA,
    segment('UNB', ['UNOL', '3'], [p.agrement, '146', p.transfer.mode + p.transfer.alias], ['DGI_EDI_TDFC'], [yymmdd(at), hhmm(at)], ref,
      undefined, undefined, undefined, undefined, campaign.interchangeAgreement, r.test ? '1' : undefined),
    segment('UNG', 'INFENT', [r.test ? 'DF4' : 'DF1', '146'], ['EDI_TDFC'], [yymmdd(at), hhmm(at)], '1', 'UN', ['D', '00B', campaign.groupVersion]),
    ...body,
    segment('UNE', '1', '1'),
    segment('UNZ', '1', ref),
  ].join('');
  return { campaign, items, segments: body, interchange, reference: ref };
}

/** Interchange encodé en ISO 8859-15, prêt à être sécurisé. */
export function encodeInterchange(m: TdfcMessage): Uint8Array {
  return encodeLatin9(m.interchange);
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

  out.push({ level: 'bloquant', message: '2033-A (bilan simplifié) : pas encore produit par Immo-Zen.' });
  out.push({ level: 'bloquant', message: 'Sécurisation AUTACK non encore intégrée : l’interchange ne peut pas être transmis.' });

  // jeu de caractères
  const texts = [d.name, d.activity ?? '', d.address.street, d.address.city, d.address.complement ?? '', d.home?.street ?? '', d.home?.city ?? '', p.name];
  const bad = invalidLatin9(texts.map(toLatin9Text).join(''));
  if (bad.length) out.push({ level: 'bloquant', message: `Caractères non autorisés (ISO 8859-15) : ${bad.join(' ')}` });
  return out;
}
