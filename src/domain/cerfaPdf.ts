/**
 * Formulaires de la liasse BIC au réel simplifié (2031-SD, 2033-A à 2033-D) redessinés case par case, avec leurs
 * numéros de case et la disposition des imprimés, pour la liasse PDF de travail (comme le font les services en ligne).
 * Pas de logo officiel : chaque page porte la mention de reproduction. Les montants s'écrivent à l'euro.
 */
import { pdfSafe } from '../../supabase/functions/_shared/receiptPdf.ts';

/** Montants par numéro de case ; une case absente reste vide. */
export type Boxes = Record<string, number | undefined>;

export interface CerfaData {
  year: number;
  name: string;
  address: string;
  siren: string;
  home: string | null;
  activity: string;
  /** 2033-A : actif et passif, null si le bilan n'est pas établi. */
  a: Boxes | null;
  b: Boxes;
  c: Boxes;
  d: Boxes;
  /** 2031 : résultat fiscal (bénéfice positif, déficit négatif). */
  result: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
export interface CerfaCtx { pdf: Any; lib: Any; font: Any; bold: Any }

const W = 595.28, H = 841.89;
const L = 30, R = 565;

/** « 773 762 », « -15 166 » ; zéro écrit seulement si demandé. */
export function amount(v: number | undefined, zero = false): string {
  if (v === undefined || (Math.round(v) === 0 && !zero)) return '';
  const n = Math.round(v);
  const s = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return n < 0 ? `-${s}` : s;
}

export async function drawCerfaForms(ctx: CerfaCtx, d: CerfaData): Promise<void> {
  const mono = await ctx.pdf.embedFont(ctx.lib.StandardFonts.Courier);
  const ink = ctx.lib.rgb(0, 0, 0), soft = ctx.lib.rgb(0.35, 0.35, 0.35), shade = ctx.lib.rgb(0.82, 0.82, 0.82), band = ctx.lib.rgb(0.92, 0.92, 0.92);
  let page: Any;

  const rect = (x: number, y: number, w: number, h: number, fill?: unknown) =>
    page.drawRectangle({ x, y, width: w, height: h, borderColor: ink, borderWidth: 0.5, ...(fill ? { color: fill } : {}) });
  const fit = (s: string, f: Any, size: number, w: number) => { let t = pdfSafe(s); while (t.length > 1 && f.widthOfTextAtSize(t, size) > w) t = t.slice(0, -1); return t; };
  const text = (s: string, x: number, y: number, size = 7, f: Any = ctx.font, color: unknown = ink) => page.drawText(pdfSafe(s), { x, y, size, font: f, color });
  /** Libellé dans une cellule, sur deux lignes au besoin. */
  const split = (s: string, w: number, size: number, f: Any) => {
    const lines: string[] = [];
    let cur = '';
    for (const wd of pdfSafe(s).split(' ')) { const t = cur ? `${cur} ${wd}` : wd; if (f.widthOfTextAtSize(t, size) <= w - 4) cur = t; else { if (cur) lines.push(cur); cur = wd; } }
    if (cur) lines.push(cur);
    return lines;
  };
  const label = (s: string, x: number, y: number, w: number, h: number, size0 = 6.8, f: Any = ctx.font) => {
    // police réduite jusqu'à ce que le libellé tienne dans la hauteur de la case
    let size = size0, lines = split(s, w, size, f);
    while (size > 4.6 && lines.length > Math.max(1, Math.floor((h - 1) / (size + 1)))) { size -= 0.3; lines = split(s, w, size, f); }
    const shown = lines.slice(0, Math.max(1, Math.floor((h - 1) / (size + 1))));
    const top = y + h / 2 + ((shown.length - 1) * (size + 1)) / 2 - size / 2 + 1;
    shown.forEach((l, i) => text(l, x + 2, top - i * (size + 1), size, f));
  };
  const right = (s: string, x: number, y: number, w: number, h: number, size = 8.2, f: Any = mono) => { if (s) text(s, x + w - 3 - f.widthOfTextAtSize(s, size), y + h / 2 - size / 2 + 1.2, size, f); };
  const center = (s: string, x: number, y: number, w: number, h: number, size = 6.5, f: Any = ctx.font) => text(s, x + (w - f.widthOfTextAtSize(pdfSafe(s), size)) / 2, y + h / 2 - size / 2 + 1, size, f);
  /** Case : numéro puis montant. */
  const box = (x: number, y: number, codeW: number, valW: number, h: number, code: string | null, v: number | undefined, zero = false, grey = false) => {
    if (code !== null) { rect(x, y, codeW, h); center(code, x, y, codeW, h, 6.5); }
    rect(x + (code !== null ? codeW : 0), y, valW + (code !== null ? 0 : codeW), h, grey ? shade : undefined);
    right(amount(v, zero), x + codeW, y, valW, h);
  };
  const vertical = (s: string, x: number, y: number, w: number, h: number) => {
    rect(x, y, w, h);
    const size = 6;
    const tw = ctx.font.widthOfTextAtSize(pdfSafe(s), size);
    page.drawText(pdfSafe(s), { x: x + w / 2 + 2, y: y + (h - tw) / 2, size, font: ctx.font, color: ink, rotate: ctx.lib.degrees(90) });
  };
  const newPage = (n: string, title: string, form: string) => {
    page = ctx.pdf.addPage([W, H]);
    // cadre du titre ajusté au texte, entre le numéro d'annexe et la référence du formulaire
    let size = 8.5;
    while (size > 6 && ctx.bold.widthOfTextAtSize(pdfSafe(title), size) > 340) size -= 0.25;
    const bw = ctx.bold.widthOfTextAtSize(pdfSafe(title), size) + 16;
    const bx = Math.max(L + 26, (L + R - 100) / 2 - bw / 2);
    text(n, bx - 22, H - 47, 10, ctx.bold);
    rect(bx, H - 52, bw, 18);
    center(title, bx, H - 52, bw, 18, size, ctx.bold);
    text(`DGFiP N° ${form}`, R - 88, H - 44, 7.5);
    text('Reproduction établie par Immo-Zen - document de travail', R - 190, H - 62, 6, ctx.font, soft);
    return H - 74;
  };
  const header = (y: number) => {
    rect(L, y - 16, R - L, 16);
    label('Formulaire obligatoire (article 302 septies A bis du Code général des impôts)', L, y - 16, 150, 16, 5.5);
    text('Désignation de l’entreprise', L + 175, y - 11, 7);
    text(fit(d.name, mono, 7.5, 230), L + 270, y - 11, 7.5, mono);
    text('Néant', R - 45, y - 11, 7);
    rect(R - 18, y - 13, 8, 8);
    return y - 16;
  };

  // ------------------------------------------------------------------ 2031-SD
  {
    page = ctx.pdf.addPage([W, H]);
    let y = H - 40;
    text('N° 2031-SD', R - 60, y, 9, ctx.bold);
    text('IMPÔT SUR LE REVENU', L + 190, y - 30, 11, ctx.bold);
    text('Bénéfices industriels et commerciaux', L + 195, y - 44, 8.5);
    text('Reproduction établie par Immo-Zen - document de travail', L, y - 10, 6, ctx.font, soft);
    y -= 58;
    const row = (h: number, cells: [string, number, (string | null)?, boolean?][]) => {
      let x = L;
      for (const [lbl, w, val, grey] of cells) { rect(x, y - h, w, h, grey ? band : undefined); if (lbl) label(lbl, x, y - h, w, h, 6.8); if (val) text(fit(val, mono, 7.5, w - 6), x + 4, y - h + h / 2 - 2.5, 7.5, mono); x += w; }
      y -= h;
    };
    const tick = (on: boolean) => (on ? 'X' : '');
    row(13, [['Exercice ouvert le', 90, null, true], ['', 150, `01/01/${d.year}`], ['Régime « simplifié d’imposition »', 140, null, true], ['', 20, tick(true)], ['ou « réel normal »', 115, null, true], ['', 20, '']]);
    row(13, [['et clos le', 90, null, true], ['', 150, `31/12/${d.year}`], ['Option pour la comptabilité super-simplifiée', 160, null, true], ['', 20, ''], ['TVA', 95, null, true], ['', 20, '']]);
    y -= 6;
    row(14, [['A   IDENTIFICATION', 535, null, true]]);
    row(14, [['Dénomination de l’entreprise :', 120, null], ['', 150, d.name], ['Adresse du déclarant (si différente de l’adresse de l’entreprise) :', 265, null]]);
    row(14, [['Adresse de l’entreprise :', 120, null], ['', 150, d.address], ['', 265, d.home ?? '']]);
    {
      rect(L, y - 14, 120, 14); label('SIREN', L, y - 14, 120, 14);
      const digits = d.siren.replace(/\D/g, '').padEnd(9, ' ').slice(0, 9).split('');
      digits.forEach((c, i) => { rect(L + 120 + i * 16, y - 14, 16, 14); center(c.trim(), L + 120 + i * 16, y - 14, 16, 14, 8, mono); });
      rect(L + 120 + 9 * 16, y - 14, 535 - 120 - 9 * 16, 14);
      y -= 14;
    }
    row(14, [['B   DIVERS', 535, null, true]]);
    row(14, [['Activités exercées (souligner l’activité principale) :', 200, null], ['', 335, d.activity]]);
    y -= 6;
    row(14, [['C   RÉCAPITULATION DES ÉLÉMENTS D’IMPOSITION', 335, null, true], ['Col. 1', 100, null, true], ['Col. 2', 100, null, true]]);
    const resRow = (lbl: string, c1: string, c2: string, h = 16) => {
      rect(L, y - h, 335, h); label(lbl, L, y - h, 335, h, 6.8);
      rect(L + 335, y - h, 100, h); right(c1, L + 335, y - h, 100, h);
      rect(L + 435, y - h, 100, h); right(c2, L + 435, y - h, 100, h);
      y -= h;
    };
    const ben = d.result > 0 ? d.result : 0, def = d.result < 0 ? -d.result : 0;
    resRow('1. Résultat fiscal - Bénéfice col. 1, Déficit col. 2 (report de la ligne 370 ou 372 du 2033-B-SD)', amount(ben, true), amount(def));
    resRow('2. Revenus de valeurs et capitaux mobiliers (compris dans les résultats ci-dessus)', '', '');
    resRow('3. Total', amount(ben, true), amount(def));
    resRow('4. Bénéfice imposable (col. 1 - col. 2) ou Déficit déductible (col. 2 - col. 1)', amount(ben, true), amount(def));
    resRow('5. Plus-values', '', '');
    resRow('6. Exonérations, abattements et crédits d’impôt', '', '');
    resRow('7. dont BIC non professionnels (2031 bis-SD) : a - BÉNÉFICE col. 1 ; b - DÉFICIT col. 2', amount(ben, true), amount(def));
    resRow('8. Régime des sociétés de personnes', '', '');
    resRow('9. Comptabilité informatisée : l’entreprise dispose-t-elle d’une comptabilité informatisée ?', 'NON', '');
    y -= 10;
    text('Résultat de l’activité de location meublée non professionnelle, à reporter en case 5NA (bénéfice) ou 5NY (déficit) de la déclaration 2042-C-PRO.', L, y, 6.5, ctx.font, soft);
  }

  // ------------------------------------------------------------------ 2033-A-SD
  if (d.a) {
    const a = d.a;
    let y = header(newPage('(1)', 'BILAN SIMPLIFIÉ', '2033-A-SD'));
    rect(L, y - 14, R - L, 14); text('Adresse de l’entreprise', L + 3, y - 10, 7); text(fit(d.address, mono, 7.5, 330), L + 150, y - 10, 7.5, mono); y -= 14;
    rect(L, y - 14, R - L, 14); text('SIREN', L + 3, y - 10, 7); text(d.siren, L + 150, y - 10, 7.5, mono);
    text('Durée de l’exercice en nombre de mois : 12', L + 250, y - 10, 7); text(`Exercice N clos le 31/12/${d.year}`, R - 112, y - 10, 7); y -= 14;
    // en-tête actif
    const lab = 238, cw = 22, vw = (R - L - lab - 3 * cw) / 3;
    const cx = (i: number) => L + lab + i * (cw + vw);
    rect(L, y - 24, lab, 24); center('ACTIF', L, y - 24, lab, 24, 9, ctx.bold);
    ['Brut', 'Amortissements - Provisions', 'Net'].forEach((h, i) => { rect(cx(i), y - 12, cw + vw, 12); center(h, cx(i), y - 12, cw + vw, 12, 6.8); rect(cx(i), y - 24, cw + vw, 12); center(String(i + 1), cx(i), y - 24, cw + vw, 12, 6.5); });
    y -= 24;
    const h = 13;
    const actif: [string, [string, string] | null, number, number, number, boolean?][] = [
      ['Immobilisations incorporelles - Fonds commercial *', ['010', '012'], 0, 0, 0],
      ['Immobilisations incorporelles - Autres *', ['014', '016'], 0, 0, 0],
      ['Immobilisations corporelles *', ['028', '030'], a['028'] ?? 0, a['030'] ?? 0, (a['028'] ?? 0) - (a['030'] ?? 0)],
      ['Immobilisations financières * (1)', ['040', '042'], 0, 0, 0],
      ['Total I (5)', ['044', '048'], a['044'] ?? 0, a['048'] ?? 0, (a['044'] ?? 0) - (a['048'] ?? 0), true],
      ['Stocks : matières premières, approvisionnements, en cours *', ['050', '052'], 0, 0, 0],
      ['Stocks : marchandises *', ['060', '062'], 0, 0, 0],
      ['Avances et acomptes versés sur commandes', ['064', '066'], 0, 0, 0],
      ['Créances : clients et comptes rattachés *', ['068', '070'], 0, 0, 0],
      ['Créances : autres * (3)', ['072', '074'], a['072'] ?? 0, 0, a['072'] ?? 0],
      ['Valeurs mobilières de placement', ['080', '082'], 0, 0, 0],
      ['Disponibilités', ['084', '086'], a['084'] ?? 0, 0, a['084'] ?? 0],
      ['Charges constatées d’avance *', ['092', '094'], 0, 0, 0],
      ['Total II', ['096', '098'], a['096'] ?? 0, 0, a['096'] ?? 0, true],
      ['Total général (I + II)', ['110', '112'], a['110'] ?? 0, a['112'] ?? 0, (a['110'] ?? 0) - (a['112'] ?? 0), true],
    ];
    const yA = y;
    for (const [lbl, codes, v1, v2, v3, strong] of actif) {
      rect(L + 14, y - h, lab - 14, h);
      if (strong) { const f = ctx.bold; text(pdfSafe(lbl), L + lab - 3 - f.widthOfTextAtSize(pdfSafe(lbl), 7), y - h + 4, 7, f); } else label(lbl, L + 14, y - h, lab - 14, h);
      box(cx(0), y - h, cw, vw, h, codes?.[0] ?? null, v1);
      box(cx(1), y - h, cw, vw, h, codes?.[1] ?? null, v2);
      rect(cx(2), y - h, cw + vw, h); right(amount(v3), cx(2), y - h, cw + vw, h);
      y -= h;
    }
    vertical('ACTIF IMMOBILISÉ', L, yA - 5 * h, 14, 5 * h);
    vertical('ACTIF CIRCULANT', L, y + h, 14, 9 * h);
    rect(L, y, 14, h);
    // passif
    y -= 6;
    const pl = R - L - cw - vw;
    rect(L, y - 18, pl, 18); center('PASSIF', L, y - 18, pl, 18, 9, ctx.bold);
    rect(L + pl, y - 18, cw + vw, 18); center('Exercice N - Net', L + pl, y - 18, cw + vw, 18, 6.8);
    y -= 18;
    const passif: [string, string, number | undefined, boolean?][] = [
      ['Capital social ou individuel *', '120', a['120']], ['Écarts de réévaluation', '124', undefined], ['Réserve légale', '126', undefined],
      ['Réserves réglementées *', '130', undefined], ['Autres réserves', '132', undefined], ['Report à nouveau', '134', undefined],
      ['Résultat de l’exercice', '136', a['136']], ['Provisions réglementées', '140', undefined], ['Total I', '142', a['142'], true],
      ['Provisions pour risques et charges - Total II', '154', undefined, true],
      ['Emprunts et dettes assimilées', '156', a['156']], ['Avances et acomptes reçus sur commandes en cours', '164', undefined],
      ['Fournisseurs et comptes rattachés *', '166', undefined], ['Dettes fiscales et sociales', '172', undefined], ['Autres dettes (dont dépôts de garantie reçus)', '175', a['175']], ['Produits constatés d’avance', '174', undefined],
      ['Total III', '176', a['176'], true], ['Total général (I + II + III)', '180', a['180'], true],
    ];
    for (const [lbl, code, v, strong] of passif) {
      rect(L + 14, y - h, pl - 14, h);
      if (strong) { const f = ctx.bold; text(pdfSafe(lbl), L + pl - 3 - f.widthOfTextAtSize(pdfSafe(lbl), 7), y - h + 4, 7, f); } else label(lbl, L + 14, y - h, pl - 14, h);
      box(L + pl, y - h, cw, vw, h, code, v, code === '136');
      y -= h;
    }
    vertical('CAPITAUX PROPRES', L, y + 9 * h, 14, 9 * h);
    rect(L, y + 8 * h, 14, h);
    vertical('DETTES (4)', L, y, 14, 8 * h);
    y -= 6;
    // renvois
    const rv: [string, string, number | undefined][] = [['(1) Dont immobilisations financières à moins d’un an', '193', undefined], ['(4) Dont dettes à plus d’un an', '195', a['195']],
      ['(2) Dont créances à plus d’un an', '197', undefined], ['(5) Coût de revient des immobilisations acquises ou créées au cours de l’exercice *', '182', a['182']],
      ['(3) Dont compte courant d’associés débiteurs', '199', undefined], ['(5) Prix de vente hors TVA des immobilisations cédées au cours de l’exercice *', '184', undefined]];
    for (let i = 0; i < rv.length; i += 2) {
      const half = (R - L) / 2;
      for (const [k, [lbl, code, v]] of [rv[i]!, rv[i + 1]!].entries()) {
        const x = L + k * half;
        rect(x, y - h, half - cw - 70, h); label(lbl, x, y - h, half - cw - 70, h, 6);
        box(x + half - cw - 70, y - h, cw, 70, h, code, v);
      }
      y -= h;
    }
    text('* Des explications concernant cette rubrique figurent dans la notice n° 2033-NOT-SD', L, y - 10, 6.5);
  }

  // ------------------------------------------------------------------ 2033-B-SD
  {
    const b = d.b;
    let y = header(newPage('(2)', 'COMPTE DE RÉSULTAT SIMPLIFIÉ DE L’EXERCICE (en liste)', '2033-B-SD'));
    const lab = 300, cw = 22, vw = 80;
    const xa = L + lab, xb = xa + cw + vw;
    const h = 12;
    const sec = (title: string) => { rect(L, y - 14, R - L, 14, band); text(title, L + 4, y - 10, 8, ctx.bold); text(`Exercice N clos le 31/12/${d.year}`, xb + 2, y - 10, 6.5); y -= 14; };
    type Row = [string, string | null, string | null, boolean?];
    const rows = (list: Row[]) => {
      for (const [lbl, ca, cb, strong] of list) {
        rect(L, y - h, lab, h);
        if (strong && ctx.bold.widthOfTextAtSize(pdfSafe(lbl), 7) < lab - 6) text(pdfSafe(lbl), L + lab - 3 - ctx.bold.widthOfTextAtSize(pdfSafe(lbl), 7), y - h + 3.5, 7, ctx.bold); else label(lbl, L, y - h, lab, h, 6.6, strong ? ctx.bold : ctx.font);
        const zero = (code: string) => ['310', '352', '370'].includes(code) && b[code] !== undefined;
        if (ca) box(xa, y - h, cw, vw, h, ca, b[ca], zero(ca)); else rect(xa, y - h, cw + vw, h, cb ? undefined : shade);
        if (cb) box(xb, y - h, cw, R - xb - cw, h, cb, b[cb], zero(cb)); else rect(xb, y - h, R - xb, h, shade);
        y -= h;
      }
    };
    sec('A - RÉSULTAT COMPTABLE');
    rows([
      ['Ventes de marchandises *', '209', '210'],
      ['Production vendue : biens', '215', '214'],
      ['Production vendue : services *', '217', '218'],
      ['Production stockée * (variation du stock en produits intermédiaires, produits finis et en cours)', null, '222'],
      ['Production immobilisée *', null, '224'],
      ['Subventions d’exploitation reçues', null, '226'],
      ['Autres produits', null, '230'],
      ['Total des produits d’exploitation hors TVA (I)', null, '232', true],
      ['Achats de marchandises * (y compris droits de douane)', null, '234'],
      ['Variation de stocks (marchandises) *', null, '236'],
      ['Achats de matières premières et autres approvisionnements *', null, '238'],
      ['Variation de stock (matières premières et approvisionnements) *', null, '240'],
      ['Autres charges externes *', null, '242'],
      ['Impôts, taxes et versements assimilés (dont taxe professionnelle, CFE et CVAE *)', '243', '244'],
      ['Rémunérations du personnel *', null, '250'],
      ['Charges sociales (cf. renvoi 380)', null, '252'],
      ['Dotations aux amortissements *', null, '254'],
      ['Dotations aux provisions', null, '256'],
      ['Autres charges (dont provisions fiscales pour implantations commerciales à l’étranger *)', '259', '262'],
      ['Total des charges d’exploitation (II)', null, '264', true],
      ['1 - RÉSULTAT D’EXPLOITATION (I - II)', null, '270', true],
      ['Produits financiers (III)', '280', null],
      ['Charges financières (V)', null, '294'],
      ['Produits exceptionnels (IV)', null, '290'],
      ['Charges exceptionnelles (VI)', '347', '300'],
      ['Impôt sur les bénéfices * (VII)', null, '306'],
      ['2 - BÉNÉFICES OU PERTES : Produits (I + III + IV) - Charges (II + V + VI + VII)', null, '310', true],
    ]);
    y -= 4;
    sec('B - RÉSULTAT FISCAL');
    rows([
      ['Reporter le bénéfice comptable col. 1, le déficit comptable col. 2', '312', '314'],
      ['Réintégrations : rémunérations et avantages personnels non déductibles *', '316', null],
      ['Réintégrations : amortissements excédentaires (art. 39-4 du CGI) et autres amortissements non déductibles', '318', null],
      ['Réintégrations : provisions non déductibles *', '322', null],
      ['Réintégrations : impôts et taxes non déductibles *', '324', null],
      ['Réintégrations : divers *', '330', null],
      ['Déductions : exonérations et abattements (entreprises nouvelles, ZFU, ZRR...)', '342', null],
      ['Déductions : divers * (dont imputation des amortissements différés, art. 39 C)', '350', null],
      ['RÉSULTAT FISCAL AVANT IMPUTATION DES DÉFICITS ANTÉRIEURS', '352', '354', true],
      ['Déficit de l’exercice reporté en arrière *', '356', null],
      ['Déficits antérieurs reportables * dont imputés sur le résultat', null, '360'],
      ['RÉSULTAT FISCAL APRÈS IMPUTATION DES DÉFICITS', '370', '372', true],
    ]);
    text('Résultats : bénéfice col. 1 (352, 370), déficit col. 2 (354, 372).', L, y - 10, 6.5);
    text('* Des explications concernant ces rubriques figurent dans la notice n° 2033-NOT-SD', L, y - 19, 6.5);
  }

  // ------------------------------------------------------------------ 2033-C-SD
  {
    const c = d.c;
    let y = header(newPage('(3)', 'IMMOBILISATIONS - AMORTISSEMENTS - PLUS-VALUES - MOINS-VALUES', '2033-C-SD'));
    const lab = 175, cw = 20, vw = (R - L - lab - 4 * cw) / 4;
    const cx = (i: number) => L + lab + i * (cw + vw);
    const h = 14;
    const head = (num: string, title: string, cols: string[]) => {
      rect(L, y - 24, 18, 24); center(num, L, y - 24, 18, 24, 8, ctx.bold);
      rect(L + 18, y - 24, lab - 18, 24); center(title, L + 18, y - 24, lab - 18, 24, 8, ctx.bold);
      cols.forEach((t, i) => { rect(cx(i), y - 24, cw + vw, 24); label(t, cx(i), y - 24, cw + vw, 24, 6.2); });
      y -= 24;
    };
    const table = (rows: [string, string[]][], total: [string, string[]]) => {
      for (const [lbl, codes] of [...rows, total]) {
        rect(L, y - h, lab, h);
        if (lbl === total[0]) center(lbl, L, y - h, lab, h, 7, ctx.bold); else label(lbl, L, y - h, lab, h, 6.6);
        codes.forEach((code, i) => box(cx(i), y - h, cw, vw, h, code, c[code]));
        y -= h;
      }
    };
    head('I', 'IMMOBILISATIONS', ['Valeur brute des immobilisations au début de l’exercice', 'Augmentations', 'Diminutions', 'Valeur brute des immobilisations à la fin de l’exercice']);
    table([
      ['Immobilisations incorporelles - Fonds commercial', ['400', '402', '404', '406']],
      ['Immobilisations incorporelles - Autres', ['410', '412', '414', '416']],
      ['Terrains', ['420', '422', '424', '426']],
      ['Constructions', ['430', '432', '434', '436']],
      ['Installations techniques, matériel et outillage industriels', ['440', '442', '444', '446']],
      ['Installations générales, agencements, aménagements divers', ['450', '452', '454', '456']],
      ['Matériel de transport', ['460', '462', '464', '466']],
      ['Autres immobilisations corporelles', ['470', '472', '474', '476']],
      ['Immobilisations financières', ['480', '482', '484', '486']],
    ], ['TOTAL', ['490', '492', '494', '496']]);
    y -= 8;
    head('II', 'AMORTISSEMENTS', ['Montant des amortissements au début de l’exercice', 'Augmentations : dotations de l’exercice', 'Diminutions : amortissements afférents aux éléments sortis de l’actif et reprises', 'Montant des amortissements à la fin de l’exercice']);
    table([
      ['Immobilisations incorporelles', ['500', '502', '504', '506']],
      ['Terrains', ['510', '512', '514', '516']],
      ['Constructions', ['520', '522', '524', '526']],
      ['Installations techniques, matériel et outillage industriels', ['530', '532', '534', '536']],
      ['Installations générales, agencements, aménagements divers', ['540', '542', '544', '546']],
      ['Matériel de transport', ['550', '552', '554', '556']],
      ['Autres immobilisations corporelles', ['560', '562', '564', '566']],
    ], ['TOTAL', ['570', '572', '574', '576']]);
    y -= 8;
    rect(L, y - 16, 18, 16); center('III', L, y - 16, 18, 16, 8, ctx.bold);
    rect(L + 18, y - 16, R - L - 18, 16); label('PLUS-VALUES, MOINS-VALUES à 19 %, 15 % et 0 % pour les entreprises à l’IS et 12,8 % pour les entreprises à l’IR', L + 18, y - 16, R - L - 18, 16, 7, ctx.bold);
    y -= 16;
    rect(L, y - 16, R - L, 16); center('Néant : aucune immobilisation cédée au cours de l’exercice', L, y - 16, R - L, 16, 7);
    y -= 16;
    text('* Des explications concernant ces rubriques figurent dans la notice n° 2033-NOT-SD', L, y - 10, 6.5);
  }

  // ------------------------------------------------------------------ 2033-D-SD
  {
    const dd = d.d;
    let y = header(newPage('(4)', 'RELEVÉ DES PROVISIONS - AMORTISSEMENTS DÉROGATOIRES - DÉFICITS', '2033-D-SD'));
    const h = 13;
    const secT = (num: string, title: string) => { rect(L, y - 15, 22, 15); center(num, L, y - 15, 22, 15, 8, ctx.bold); rect(L + 22, y - 15, R - L - 22, 15); text(title, L + 26, y - 11, 8, ctx.bold); y -= 15; };
    secT('I', 'RELEVÉ DES PROVISIONS - AMORTISSEMENTS DÉROGATOIRES');
    const lab = 175, cw = 20, vw = (R - L - lab - 4 * cw) / 4;
    const cx = (i: number) => L + lab + i * (cw + vw);
    rect(L, y - 20, lab, 20); text('A   NATURE DES PROVISIONS', L + 3, y - 13, 7.5);
    ['Montant au début de l’exercice', 'Augmentations : dotations de l’exercice', 'Diminutions : reprises de l’exercice', 'Montant à la fin de l’exercice'].forEach((t, i) => { rect(cx(i), y - 20, cw + vw, 20); label(t, cx(i), y - 20, cw + vw, 20, 6.2); });
    y -= 20;
    for (const [lbl, codes] of [
      ['Amortissements dérogatoires', ['600', '602', '604', '606']], ['Dont majorations exceptionnelles de 30 %', ['601', '603', '605', '607']],
      ['Autres provisions réglementées *', ['610', '612', '614', '616']], ['Provisions pour risques et charges', ['620', '622', '624', '626']],
      ['Provisions pour dépréciation : sur immobilisations', ['630', '632', '634', '636']], ['Sur stocks et en cours', ['640', '642', '644', '646']],
      ['Sur comptes clients', ['650', '652', '654', '656']], ['Autres provisions pour dépréciation', ['660', '662', '664', '666']], ['TOTAL', ['680', '682', '684', '686']],
    ] as [string, string[]][]) {
      rect(L, y - h, lab, h); if (lbl === 'TOTAL') center(lbl, L, y - h, lab, h, 7, ctx.bold); else label(lbl, L, y - h, lab, h, 6.6);
      codes.forEach((code, i) => box(cx(i), y - h, cw, vw, h, code, dd[code]));
      y -= h;
    }
    y -= 8;
    secT('II', 'DÉFICITS REPORTABLES');
    const dl = 300, dw = 120;
    for (const [lbl, code] of [['Déficits restant à reporter au titre de l’exercice précédent (1)', '982'], ['Déficits imputés', '983'], ['Déficits reportables', '984'], ['Déficits de l’exercice', '860'], ['Total des déficits restant à reporter', '870']] as [string, string][]) {
      rect(L, y - h, dl, h); label(lbl, L, y - h, dl, h, 6.8);
      box(L + dl, y - h, cw, dw, h, code, dd[code]);
      rect(L + dl + cw + dw, y - h, R - L - dl - cw - dw, h, shade);
      y -= h;
    }
    y -= 8;
    secT('IV', 'DIVERS');
    for (const [lbl, code] of [
      ['Primes et cotisations complémentaires facultatives', '381'], ['Cotisations personnelles obligatoires de l’exploitant *', '380'], ['N° du centre de gestion agréé', '388'],
      ['Montant de la TVA collectée', '374'], ['Montant de la TVA déductible sur biens et services (sauf immobilisations)', '378'], ['Montant des prélèvements personnels de l’exploitant', '399'],
    ] as [string, string][]) {
      rect(L, y - h, R - L - cw - 110, h); label(lbl, L, y - h, R - L - cw - 110, h, 6.8);
      box(R - cw - 110, y - h, cw, 110, h, code, dd[code]);
      y -= h;
    }
    text('(1) Cette case correspond au montant porté sur la ligne 870 du tableau n° 2033-D-SD déposé au titre de l’exercice précédent.', L, y - 10, 6.2);
    text('* Des explications concernant ces rubriques figurent dans la notice n° 2033-NOT-SD', L, y - 19, 6.2);
  }
}
