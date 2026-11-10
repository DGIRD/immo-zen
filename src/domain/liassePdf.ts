/**
 * Liasse LMNP au réel, en document de travail PDF, sur le modèle des liasses produites par les services en ligne :
 * synthèse, reports sur la 2042-C-PRO, résultat de l'activité, récapitulatifs par bien, suivi des amortissements
 * excédentaires (art. 39 C), détail des immobilisations, puis les montants des formulaires 2031, 2033-A, 2033-B,
 * 2033-C et 2033-D avec leurs numéros de case.
 *
 * Ce n'est pas l'imprimé officiel : la liasse se dépose en ligne (espace professionnel ou télétransmission).
 * Les montants des formulaires sont arrondis à l'euro, comme sur les imprimés.
 */
import type { Property } from '../data/types.ts';
import type { PdfDoc, PdfSection, TableBlock } from './docPdf.ts';
import type { Bilan2033A } from './edi/tdfc.ts';
import type { FiscalSummary, Liasse2033B, ReelBic } from './fiscal.ts';

export interface LiasseInput {
  year: number;
  reel: NonNullable<FiscalSummary['reelBic']>;
  properties: Property[];
  /** Bilan relu dans la déclaration (corrections comprises) ; absent : formulaire 2033-A non produit. */
  bilan: Bilan2033A | null;
  declarant?: { name?: string | null; siren?: string | null; address?: string | null; home?: string | null } | null;
  /** Date d'édition (AAAA-MM-JJ). */
  editedOn: string;
}

const r0 = (v: number) => Math.round(v);
/** Montant à l'euro, espaces ordinaires (police standard du PDF). */
export const eur = (v: number) => `${r0(v) === 0 ? '0' : r0(v).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} €`;
const box = (v: number) => (r0(v) === 0 ? '' : r0(v).toLocaleString('fr-FR').replace(/[  ]/g, ' '));
const fr = (iso: string) => iso.split('-').reverse().join('/');
const sum = (l: number[]) => Math.round(l.reduce((a, x) => a + x, 0) * 100) / 100;
const lineOf = (l: Liasse2033B, code: string) => l.lines.find((x) => x.code === code)?.amount ?? 0;
const insuranceOf = (r: ReelBic) => r.charges.find((c) => c.label === 'Assurance emprunteur')?.amount ?? 0;
const addressOf = (p: Property | undefined) => (p ? [p.address, [p.zip, p.city].filter(Boolean).join(' ')].filter(Boolean).join(' ') : '');

export function liasseDoc(i: LiasseInput): PdfDoc {
  const { year, reel, properties } = i;
  const l = reel.liasse;
  const list = reel.perProperty;
  const prop = (id: string) => properties.find((p) => p.id === id);
  const name = (id: string) => prop(id)?.title ?? id;
  const where = (id: string) => [name(id), addressOf(prop(id))].filter(Boolean).join(' - ');

  const receipts = sum(list.map((r) => r.receipts));
  const interest = sum(list.map((r) => r.interest + insuranceOf(r)));
  const charges = sum(list.map((r) => r.chargesTotal - insuranceOf(r)));
  const dotations = sum(list.map((r) => r.depreciationYear));
  const comptable = sum([receipts, -charges, -interest, -dotations]);
  const fiscal = l.fiscalResult;
  const stockStart = sum(list.map((r) => r.deferredBefore));
  const stockUsed = sum(list.map((r) => r.deferredUsed));
  const stockAdded = sum(list.map((r) => r.deferredAdded));
  const stockEnd = sum(list.map((r) => r.deferredAfter));
  const sections: PdfSection[] = [];

  // ---------------------------------------------------------------- synthèse
  sections.push({ title: `Synthèse de l'exercice ${year}`, blocks: [
    { t: 'kv', rows: [
      ['Activité', 'Location meublée non professionnelle (LMNP), régime réel simplifié'],
      ['Exploitant', i.declarant?.name || 'à compléter'],
      ['SIREN', i.declarant?.siren || 'à compléter'],
      ['Exercice', `du 01/01/${year} au 31/12/${year} (12 mois)`],
      ['Biens', list.map((r) => where(r.propertyId)).join(' ; ')],
    ] },
    { t: 'kv', rows: [
      ['Recettes brutes', eur(receipts)],
      ['Dépenses (charges, intérêts et dotations)', eur(-(charges + interest + dotations))],
      ['Résultat comptable', eur(comptable)],
      [`Résultat fiscal ${year}`, fiscal >= 0 ? `${eur(fiscal)} (bénéfice)` : `${eur(fiscal)} (déficit)`],
      ['Amortissements reportables au 31/12', eur(stockEnd)],
      ['Déficit fiscal reportable', eur(fiscal < 0 ? -fiscal : 0)],
    ] },
    ...(comptable < 0 && fiscal >= 0 ? [{ t: 'p' as const, text: `Le résultat comptable est négatif à cause des amortissements, mais l'amortissement ne peut ni créer ni augmenter un déficit (article 39 C du CGI) : la part non déduite (${eur(stockAdded)} cette année) est réintégrée ligne 318 du 2033-B et reportée sans limite de durée sur les bénéfices des années suivantes. Seul le résultat fiscal se reporte sur la déclaration de revenus.` }] : []),
  ] });

  // ---------------------------------------------------------------- 2042-C-PRO
  sections.push({ title: `Reports sur votre déclaration de revenus ${year + 1} (2042-C-PRO)`, blocks: [
    { t: 'p', text: 'Sur impots.gouv.fr, espace particulier : rubrique « Revenus des locations meublées non professionnelles », régime du bénéfice réel. Cases du déclarant 1 (5NA / 5NY) ; second déclarant : 5OA / 5OY.' },
    { t: 'table', head: ['Case', 'Libellé', 'Montant'], widths: [1, 5, 1.6], align: ['l', 'l', 'r'], rows: [
      ['5NA', `Bénéfice de l'année ${year} (locations meublées non professionnelles, réel)`, eur(reel.box5NA)],
      ['5NY', `Déficit de l'année ${year}`, eur(reel.box5NY)],
    ] },
    { t: 'p', text: 'Déficits des années antérieures non encore déduits : cases 5GA à 5GJ, une par année d\'origine, d\'après vos avis d\'imposition (non suivis par Immo-Zen). Les amortissements reportables ne se déclarent pas : ils figurent dans le suivi ci-dessous.' },
  ] });

  // ---------------------------------------------------------------- résultat de l'activité
  const byLabel = new Map<string, number>();
  for (const r of list) for (const c of r.charges) if (c.label !== 'Assurance emprunteur') byLabel.set(c.label, (byLabel.get(c.label) ?? 0) + c.amount);
  const kinds: [string, string][] = [['bati', 'Bâti (construction et frais d\'acquisition)'], ['travaux', 'Travaux et agencements'], ['meuble', 'Meubles et équipements']];
  const depBy = (k: string) => sum(list.flatMap((r) => r.depreciation.filter((d) => d.kind === k).map((d) => d.amount)));
  sections.push({ title: "Résultat de l'activité LMNP", newPage: true, blocks: [
    { t: 'table', head: ['Recettes', 'Montant'], widths: [5, 1.6], total: true, rows: [['Loyers et charges encaissés', eur(receipts)], ['Total recettes', eur(receipts)]] },
    { t: 'table', head: ['Dépenses', 'Montant'], widths: [5, 1.6], total: true, rows: [...[...byLabel.entries()].filter(([, v]) => v > 0).map(([k, v]) => [k, eur(v)]), ['Total dépenses', eur(charges)]] },
    { t: 'table', head: ['Intérêts', 'Montant'], widths: [5, 1.6], total: true, rows: [['Intérêts et assurance d\'emprunt', eur(interest)], ['Total intérêts', eur(interest)]] },
    { t: 'table', head: ['Dotations aux amortissements', 'Montant'], widths: [5, 1.6], total: true, rows: [...kinds.filter(([k]) => depBy(k) > 0).map(([k, lb]) => [lb, eur(depBy(k))]), ['Dotations totales', eur(dotations)]] },
    { t: 'kv', rows: [
      ['Résultat de l\'exercice avant imputation des déficits et des amortissements antérieurs', eur(comptable)],
      ['Dont amortissements reportables (excédent de l\'année)', eur(stockAdded)],
      ...(stockUsed > 0 ? [['Amortissements antérieurs imputés', eur(stockUsed)] as [string, string]] : []),
    ] },
  ] });

  // ---------------------------------------------------------------- récapitulatifs par bien
  const withDep = dotations !== 0;
  const recapRows = list.map((r) => {
    const ins = insuranceOf(r);
    const res = r.resultBeforeDepreciation - r.depreciationYear;
    return [where(r.propertyId), eur(r.receipts), eur(-(r.chargesTotal - ins)), eur(-(r.interest + ins)), ...(withDep ? [eur(-r.depreciationYear)] : []), eur(res)];
  });
  recapRows.push(['Total global', eur(receipts), eur(-charges), eur(-interest), ...(withDep ? [eur(-dotations)] : []), eur(comptable)]);
  const recap: TableBlock = { t: 'table', head: ['Bien', 'Recettes', 'Charges', 'Intérêts d\'emprunt', ...(withDep ? ['Amortissement'] : []), 'Résultat'], rows: recapRows, total: true, widths: [3.2, 1.3, 1.3, 1.4, ...(withDep ? [1.4] : []), 1.3] };
  const suivi: TableBlock = { t: 'table', head: ['Bien', 'Stock au 1er janvier', 'Stock utilisé', 'Report stocké', 'Stock au 31 décembre'], total: true, widths: [3.2, 1.4, 1.3, 1.3, 1.5], rows: [
    ...list.map((r) => [where(r.propertyId), eur(r.deferredBefore), r.deferredUsed ? eur(r.deferredUsed) : '', r.deferredAdded ? eur(r.deferredAdded) : '', eur(r.deferredAfter)]),
    ['Total suivi', eur(stockStart), stockUsed ? eur(stockUsed) : '', stockAdded ? eur(stockAdded) : '', eur(stockEnd)],
  ] };
  sections.push({ title: 'Récapitulatif du résultat comptable', blocks: [recap, { t: 'kv', rows: [['Résultat avant imputation des déficits antérieurs', eur(comptable)]] }] });
  if (stockStart || stockEnd || stockUsed) sections.push({ title: 'Suivi des amortissements excédentaires reportables par bien', blocks: [suivi,
    { t: 'p', text: 'Excédent de l\'année réparti entre les biens au prorata de leurs dotations ; stock utilisé réparti au prorata des stocks de début d\'année.' }] });

  // ---------------------------------------------------------------- immobilisations
  const immo: PdfSection = { title: 'Détail des immobilisations', newPage: true, blocks: [] };
  for (const r of list) {
    const assets = l.assets.filter((a) => a.propertyId === r.propertyId);
    if (!assets.length) continue;
    const rows = assets.map((a) => {
      const terrain = a.kind === 'terrain';
      const annual = a.years ? a.gross / a.years : 0;
      const end = terrain ? 0 : a.gross - a.cumulated;
      const label = a.label.replace(`${name(r.propertyId)} – `, '');
      return [`${label} (${fr(a.start)})`, eur(a.gross), terrain ? '-' : eur(a.dotation), terrain ? '-' : eur(annual), terrain ? '-' : eur(end + a.dotation), terrain ? '-' : eur(end), terrain ? '-' : eur(a.cumulated)];
    });
    const am = assets.filter((a) => a.kind !== 'terrain');
    rows.push(['Total', eur(sum(assets.map((a) => a.gross))), eur(sum(am.map((a) => a.dotation))), eur(sum(am.map((a) => (a.years ? a.gross / a.years : 0)))),
      eur(sum(am.map((a) => a.gross - a.cumulated + a.dotation))), eur(sum(am.map((a) => a.gross - a.cumulated))), eur(sum(am.map((a) => a.cumulated)))]);
    immo.blocks.push({ t: 'table', caption: where(r.propertyId), head: ['Élément', 'Valeur brute', 'Dotation de l\'exercice', 'Amort. annuel', 'Restant début d\'exercice', 'Restant fin d\'exercice', 'Cumulés fin d\'exercice'],
      widths: [3, 1.2, 1.1, 1.1, 1.3, 1.3, 1.3], rows, total: true });
  }
  if (immo.blocks.length) sections.push(immo);

  // ---------------------------------------------------------------- formulaires
  const forms = (code: string, label: string, amount: number | string): string[] => [code, label, typeof amount === 'number' ? box(amount) : amount];
  /** Résultat : le zéro s'écrit (case de résultat toujours servie). */
  const result = (code: string, label: string, amount: number): string[] => [code, label, box(amount) || '0'];
  const formTable = (rows: string[][]): TableBlock => ({ t: 'table', head: ['Case', 'Libellé', 'Montant'], widths: [0.8, 5.2, 1.4], align: ['l', 'l', 'r'], rows });

  sections.push({ title: '2031-SD - Déclaration de résultats (BIC, impôt sur le revenu)', newPage: true, blocks: [
    { t: 'kv', rows: [
      ['Exercice', `ouvert le 01/01/${year}, clos le 31/12/${year}`],
      ['Régime', 'réel simplifié d\'imposition'],
      ['Dénomination', i.declarant?.name || 'à compléter'],
      ['SIREN', i.declarant?.siren || 'à compléter'],
      ['Adresse de l\'entreprise', i.declarant?.address || addressOf(prop(list[0]?.propertyId ?? '')) || 'à compléter'],
      ...(i.declarant?.home ? [['Adresse du domicile', i.declarant.home] as [string, string]] : []),
      ['Activité', 'Location meublée non professionnelle'],
    ] },
    formTable([
      result('1', 'Résultat fiscal - bénéfice (col. 1), report de la ligne 370 du 2033-B', fiscal > 0 ? fiscal : 0),
      forms('1', 'Résultat fiscal - déficit (col. 2), report de la ligne 372 du 2033-B', fiscal < 0 ? -fiscal : 0),
      result('7a', 'Dont BIC non professionnels - bénéfice (2031 bis)', fiscal > 0 ? fiscal : 0),
      forms('7b', 'Dont BIC non professionnels - déficit (2031 bis)', fiscal < 0 ? -fiscal : 0),
    ]),
  ] });

  if (i.bilan) {
    const b = i.bilan;
    sections.push({ title: `2033-A-SD - Bilan simplifié au 31/12/${year}`, blocks: [
      { t: 'table', caption: 'Actif', head: ['Case', 'Libellé', 'Brut', 'Amortissements', 'Net'], widths: [1.2, 4, 1.3, 1.4, 1.3], align: ['l', 'l', 'r', 'r', 'r'], rows: [
        ['028 / 030', 'Immobilisations corporelles', box(b.immoGross), box(b.immoDep), box(b.immoNet)],
        ['044 / 048', 'Total I', box(b.immoGross), box(b.immoDep), box(b.immoNet)],
        ['072', 'Créances (loyers et charges échus non réglés)', box(b.receivables), '', box(b.receivables)],
        ['084', 'Disponibilités', box(b.cash), '', box(b.cash)],
        ['096', 'Total II', box(b.currentTotal), '', box(b.currentTotal)],
        ['110 / 112', 'Total général (I + II)', box(b.assetsGross), box(b.assetsDep), box(b.assetsNet)],
      ], total: true },
      { t: 'table', caption: 'Passif', head: ['Case', 'Libellé', 'Montant'], widths: [1.2, 6.7, 1.3], align: ['l', 'l', 'r'], rows: [
        ['120', 'Capital individuel (compte de l\'exploitant)', box(b.capital)],
        ['136', 'Résultat de l\'exercice', box(b.result)],
        ['142', 'Total I (capitaux propres)', box(b.equity)],
        ['156', 'Emprunts et dettes assimilées', box(b.loans)],
        ['172', 'Autres dettes (dépôts de garantie reçus, charges à payer)', box(b.otherDebts)],
        ['176', 'Total III (dettes)', box(b.debts)],
        ['195', 'Dont dettes à plus d\'un an', box(b.loansBeyondOneYear)],
        ['180', 'Total général (I + II + III)', box(b.liabilities)],
      ] },
    ] });
  }

  const deferredUsed = l.deferredUsed;
  sections.push({ title: '2033-B-SD - Compte de résultat simplifié', blocks: [formTable([
    forms('218', 'Production vendue - services (loyers et charges encaissés)', lineOf(l, '218')),
    forms('232', 'Total des produits d\'exploitation (I)', lineOf(l, '232')),
    forms('242', 'Autres charges externes', lineOf(l, '242')),
    forms('244', 'Impôts, taxes et versements assimilés', lineOf(l, '244')),
    forms('254', 'Dotations aux amortissements', lineOf(l, '254')),
    forms('264', 'Total des charges d\'exploitation (II)', lineOf(l, '264')),
    forms('270', 'Résultat d\'exploitation (I - II)', lineOf(l, '270')),
    forms('294', 'Charges financières (V)', lineOf(l, '294')),
    result('310', 'Bénéfice ou perte', lineOf(l, '310')),
    forms(lineOf(l, '310') >= 0 ? '312' : '314', `Report du résultat comptable (${lineOf(l, '310') >= 0 ? 'bénéfice, col. 1' : 'déficit, col. 2'})`, Math.abs(lineOf(l, '310'))),
    forms('318', 'Amortissements excédentaires (art. 39-4) et autres amortissements non déductibles (art. 39 C)', lineOf(l, '318')),
    ...(deferredUsed > 0 ? [forms('-', 'Déduction : amortissements différés des exercices antérieurs (art. 39 C)', deferredUsed)] : []),
    result(fiscal >= 0 ? '352' : '354', `Résultat fiscal avant imputation des déficits antérieurs (${fiscal >= 0 ? 'bénéfice' : 'déficit'})`, Math.abs(fiscal)),
    result(fiscal >= 0 ? '370' : '372', `Résultat fiscal après imputation des déficits (${fiscal >= 0 ? 'bénéfice' : 'déficit'})`, Math.abs(fiscal)),
  ])] });

  // 2033-C : par nature, comme la télétransmission
  const natures = [
    { kind: 'terrain', label: 'Terrains', g: ['420', '422', '424', '426'], d: null },
    { kind: 'bati', label: 'Constructions', g: ['430', '432', '434', '436'], d: ['520', '522', '524', '526'] },
    { kind: 'travaux', label: 'Installations générales, agencements, aménagements', g: ['450', '452', '454', '456'], d: ['540', '542', '544', '546'] },
    { kind: 'meuble', label: 'Autres immobilisations corporelles', g: ['470', '472', '474', '476'], d: ['560', '562', '564', '566'] },
  ] as const;
  const start = `${year}-01-01`, end = `${year}-12-31`;
  const gRows: string[][] = [], dRows: string[][] = [];
  const tot = { gb: 0, ga: 0, ge: 0, db: 0, dd: 0, de: 0 };
  for (const n of natures) {
    const as = l.assets.filter((a) => a.kind === n.kind);
    if (!as.length) continue;
    const added = sum(as.filter((a) => a.start >= start && a.start <= end).map((a) => a.gross));
    const ge = sum(as.map((a) => a.gross));
    gRows.push([`${n.g[0]} à ${n.g[3]}`, n.label, box(ge - added), box(added), '', box(ge)]);
    tot.gb += ge - added; tot.ga += added; tot.ge += ge;
    if (n.d) {
      const de = sum(as.map((a) => a.cumulated)), dd = sum(as.map((a) => a.dotation));
      dRows.push([`${n.d[0]} à ${n.d[3]}`, n.label, box(de - dd), box(dd), '', box(de)]);
      tot.db += de - dd; tot.dd += dd; tot.de += de;
    }
  }
  if (gRows.length) {
    gRows.push(['490 à 496', 'Total', box(tot.gb), box(tot.ga), '', box(tot.ge)]);
    dRows.push(['570 à 576', 'Total', box(tot.db), box(tot.dd), '', box(tot.de)]);
    const head = (a: string, b: string) => ['Cases', 'Nature', a, b, 'Diminutions', 'Fin d\'exercice'];
    const w = [1.2, 3.6, 1.3, 1.3, 1.1, 1.3];
    const al: ('l' | 'r')[] = ['l', 'l', 'r', 'r', 'r', 'r'];
    sections.push({ title: '2033-C-SD - Immobilisations et amortissements', blocks: [
      { t: 'table', caption: 'I - Immobilisations (valeurs brutes)', head: head('Début d\'exercice', 'Augmentations'), widths: w, align: al, rows: gRows, total: true },
      { t: 'table', caption: 'II - Amortissements', head: head('Début d\'exercice', 'Dotations'), widths: w, align: al, rows: dRows, total: true },
    ] });
  }

  sections.push({ title: '2033-D-SD - Déficits reportables', blocks: [formTable([
    forms('860', 'Déficits de l\'exercice', fiscal < 0 ? -fiscal : 0),
    forms('870', 'Total des déficits restant à reporter (déficits antérieurs non suivis par Immo-Zen : à ajouter)', fiscal < 0 ? -fiscal : 0),
  ])] });

  sections.push({ title: 'Suivi des amortissements régulièrement comptabilisés dont la déduction est écartée (art. 39 C du CGI)', blocks: [
    { t: 'kv', rows: [
      ['Amortissements non déduits reportables au titre des exercices antérieurs (1)', eur(stockStart)],
      ['Imputation opérée à la clôture de l\'exercice (2)', eur(stockUsed)],
      ['Amortissements de l\'exercice dont la déduction est écartée (3), ligne 318', eur(stockAdded)],
      ['Amortissements reportables en fin d\'exercice (1) - (2) + (3)', eur(stockEnd)],
    ] },
  ] });

  return {
    title: `Liasse fiscale LMNP - exercice ${year}`,
    subtitle: `${i.declarant?.name ? `${i.declarant.name} - ` : ''}document de travail édité par Immo-Zen le ${fr(i.editedOn)} à partir des loyers encaissés, des dépenses payées et des amortissements. Ce n'est pas l'imprimé officiel : la liasse 2031 et 2033 se dépose en ligne (espace professionnel sur impots.gouv.fr ou télétransmission). Montants des formulaires à l'euro. À vérifier avec les notices 2031-NOT et 2033-NOT ; ne vaut pas conseil fiscal.`,
    sections,
    footer: `Immo-Zen - liasse LMNP ${year} - document de travail`,
  };
}
