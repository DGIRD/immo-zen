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
import { drawCerfaForms, type Boxes, type CerfaData } from './cerfaPdf.ts';
import { drawOfficialCerfa, type CerfaSources } from './cerfaOfficial.ts';

export interface LiasseInput {
  year: number;
  reel: NonNullable<FiscalSummary['reelBic']>;
  properties: Property[];
  /** Bilan relu dans la déclaration (corrections comprises) ; absent : formulaire 2033-A non produit. */
  bilan: Bilan2033A | null;
  declarant?: { name?: string | null; siren?: string | null; address?: string | null; home?: string | null } | null;
  /** Date d'édition (AAAA-MM-JJ). */
  editedOn: string;
  /** Imprimés officiels (PDF de impots.gouv.fr) ; à défaut, formulaires redessinés. */
  cerfa?: CerfaSources | null;
}

const r0 = (v: number) => Math.round(v);
/** Montant à l'euro, espaces ordinaires (police standard du PDF). */
export const eur = (v: number) => `${r0(v) === 0 ? '0' : r0(v).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} €`;
const box = (v: number) => (r0(v) === 0 ? '' : r0(v).toLocaleString('fr-FR').replace(/[  ]/g, ' '));
const fr = (iso: string) => iso.split('-').reverse().join('/');
const sum = (l: number[]) => Math.round(l.reduce((a, x) => a + x, 0) * 100) / 100;
const lineOf = (l: Liasse2033B, code: string) => l.lines.find((x) => x.code === code)?.amount ?? 0;
const addressOf = (p: Property | undefined) => (p ? [p.address, [p.zip, p.city].filter(Boolean).join(' ')].filter(Boolean).join(' ') : '');

export function liasseDoc(i: LiasseInput): PdfDoc {
  const { year, reel, properties } = i;
  const l = reel.liasse;
  const list = reel.perProperty;
  const prop = (id: string) => properties.find((p) => p.id === id);
  const name = (id: string) => prop(id)?.title ?? id;
  const where = (id: string) => [name(id), addressOf(prop(id))].filter(Boolean).join(' - ');

  const receipts = sum(list.map((r) => r.receipts));
  const interest = sum(list.map((r) => r.interest));
  const charges = sum(list.map((r) => r.chargesTotal));
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
  for (const r of list) for (const c of r.charges) byLabel.set(c.label, (byLabel.get(c.label) ?? 0) + c.amount);
  const finBy = new Map<string, number>();
  for (const r of list) for (const c of r.financial) finBy.set(c.label, (finBy.get(c.label) ?? 0) + c.amount);
  const kinds: [string, string][] = [['bati', 'Construction'], ['frais', 'Frais d\'acquisition (notaire, agence)'], ['travaux', 'Travaux et agencements'], ['meuble', 'Meubles et équipements']];
  const depBy = (k: string) => sum(list.flatMap((r) => r.depreciation.filter((d) => d.kind === k).map((d) => d.amount)));
  sections.push({ title: "Résultat de l'activité LMNP", newPage: true, blocks: [
    { t: 'table', head: ['Recettes', 'Montant'], widths: [5, 1.6], total: true, rows: [['Loyers et charges encaissés', eur(receipts)], ['Total recettes', eur(receipts)]] },
    { t: 'table', head: ['Dépenses', 'Montant'], widths: [5, 1.6], total: true, rows: [...[...byLabel.entries()].filter(([, v]) => v > 0).map(([k, v]) => [k, eur(v)]), ['Total dépenses', eur(charges)]] },
    { t: 'table', head: ['Intérêts', 'Montant'], widths: [5, 1.6], total: true, rows: [...[...finBy.entries()].filter(([, v]) => v > 0).map(([k, v]) => [k, eur(v)]), ['Total intérêts', eur(interest)]] },
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
    const res = r.resultBeforeDepreciation - r.depreciationYear;
    return [where(r.propertyId), eur(r.receipts), eur(-r.chargesTotal), eur(-r.interest), ...(withDep ? [eur(-r.depreciationYear)] : []), eur(res)];
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
    // formulaires 2031 et 2033-A à D, case par case
    extraPages: (ctx) => (i.cerfa ? drawOfficialCerfa(ctx, i.cerfa, cerfaData(i)) : drawCerfaForms(ctx, cerfaData(i))),
  };
}

/** Montants des formulaires, par numéro de case des imprimés (2031-SD, 2033-A/B/C/D-SD). */
export function cerfaData(i: LiasseInput): CerfaData {
  const l = i.reel.liasse;
  const fiscal = l.fiscalResult;
  const line = (code: string) => lineOf(l, code);
  const b: Boxes = {};
  for (const code of ['218', '232', '242', '244', '254', '264', '270', '294', '310', '318']) b[code] = line(code);
  b[line('310') >= 0 ? '312' : '314'] = Math.abs(line('310'));
  if (l.deferredUsed) b['350'] = l.deferredUsed;
  b[fiscal >= 0 ? '352' : '354'] = Math.abs(fiscal);
  b[fiscal >= 0 ? '370' : '372'] = Math.abs(fiscal);

  const c: Boxes = {};
  const start = `${i.year}-01-01`, end = `${i.year}-12-31`;
  const map = { terrain: ['420', null], bati: ['430', '520'], frais: ['410', '500'], travaux: ['450', '540'], meuble: ['470', '560'] } as const;
  const add = (code: string, v: number) => { c[code] = Math.round(((c[code] ?? 0) + v) * 100) / 100; };
  for (const a of l.assets) {
    const [g, dep] = map[a.kind as keyof typeof map] ?? map.meuble;
    const gi = Number(g), added = a.start >= start && a.start <= end ? a.gross : 0;
    add(String(gi), a.gross - added); add(String(gi + 2), added); add(String(gi + 6), a.gross);
    add('490', a.gross - added); add('492', added); add('496', a.gross);
    if (dep) {
      const di = Number(dep);
      add(String(di), a.cumulated - a.dotation); add(String(di + 2), a.dotation); add(String(di + 6), a.cumulated);
      add('570', a.cumulated - a.dotation); add('572', a.dotation); add('576', a.cumulated);
    }
  }

  const bl = i.bilan;
  // frais d'acquisition en immobilisations incorporelles (014 / 016), le reste en corporelles (028 / 030)
  const fees = l.assets.filter((x) => x.kind === 'frais');
  const feesGross = Math.round(fees.reduce((t, x) => t + x.gross, 0) * 100) / 100, feesDep = Math.round(fees.reduce((t, x) => t + x.cumulated, 0) * 100) / 100;
  const a: Boxes | null = bl ? {
    ...(feesGross ? { '014': feesGross, '016': feesDep } : {}),
    '028': bl.immoGross - feesGross, '030': bl.immoDep - feesDep, '044': bl.immoGross, '048': bl.immoDep, '072': bl.receivables, '084': bl.cash, '096': bl.currentTotal,
    '110': bl.assetsGross, '112': bl.assetsDep, '120': bl.capital, '136': bl.result, '142': bl.equity, '156': bl.loans, '175': bl.otherDebts,
    '176': bl.debts, '180': bl.liabilities, '195': bl.loansBeyondOneYear, '182': bl.acquisitions,
  } : null;
  const d: Boxes = fiscal < 0 ? { '860': -fiscal, '870': -fiscal } : {};
  const first = i.properties.find((p) => p.id === i.reel.perProperty[0]?.propertyId);
  return {
    year: i.year, name: i.declarant?.name || 'à compléter', siren: i.declarant?.siren || '', home: i.declarant?.home ?? null,
    address: i.declarant?.address || addressOf(first) || '', activity: 'Loueur en meublé non professionnel', a, b, c, d, result: fiscal,
  };
}
