/**
 * Remplissage des imprimés officiels 2031-SD et 2033-SD (millésime 2026, téléchargés sur impots.gouv.fr et livrés
 * avec l'application dans public/cerfa/) : les pages sont recopiées telles quelles et les montants écrits dans les
 * cases, comme le font les services en ligne. Positions des cases : cerfaLayout.ts (généré).
 */
import { pdfSafe } from '../../supabase/functions/_shared/receiptPdf.ts';
import { amount, type CerfaCtx, type CerfaData } from './cerfaPdf.ts';
import { CERFA_LAYOUT } from './cerfaLayout.ts';

export interface CerfaSources { f2031: Uint8Array; f2033: Uint8Array }

/** Fichiers des imprimés, servis avec l'application. */
export const CERFA_FILES = { f2031: 'cerfa/2031-sd_5396.pdf', f2033: 'cerfa/2033-sd_5394.pdf' } as const;

type Slot = readonly [number, number, number];
type Pt = readonly [number, number];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export async function drawOfficialCerfa(ctx: CerfaCtx, src: CerfaSources, d: CerfaData): Promise<void> {
  const mono = await ctx.pdf.embedFont(ctx.lib.StandardFonts.Courier);
  const ink = ctx.lib.rgb(0.05, 0.05, 0.35);
  const load = (b: Uint8Array) => ctx.lib.PDFDocument.load(b);
  let page: Any;
  const write = (s: string, x: number, y: number, size = 8.5) => { if (s) page.drawText(pdfSafe(s), { x, y, size, font: mono, color: ink }); };
  /** Montant aligné à droite dans la case. */
  const put = (slot: Slot | undefined, v: number | undefined, zero = false) => {
    if (!slot) return;
    const s = amount(v, zero);
    if (!s) return;
    let size = 8.5;
    while (size > 6 && mono.widthOfTextAtSize(s, size) > slot[1] - slot[0] - 4) size -= 0.5;
    write(s, slot[1] - 3 - mono.widthOfTextAtSize(s, size), slot[2], size);
  };
  const left = (p: Pt | Slot, s: string, size = 8, max = 230) => {
    let t = pdfSafe(s);
    while (t.length > 1 && mono.widthOfTextAtSize(t, size) > max) t = t.slice(0, -1);
    const x = p.length === 3 ? p[0] + 4 : p[0];
    write(t, x, p[p.length - 1]!, size);
  };
  const cross = (s: Slot | Pt) => {
    const x = s.length === 3 ? (s[0] + s[1]) / 2 - 2.5 : s[0] - 2.5;
    write('X', x, s[s.length - 1]!, 9);
  };
  const digits = (cells: readonly Pt[], value: string, size = 9) => value.replace(/\s/g, '').split('').slice(0, cells.length).forEach((c, i) => write(c, cells[i]![0] - mono.widthOfTextAtSize(c, size) / 2, cells[i]![1], size));

  // ------------------------------------------------------------------ 2031-SD, page 1
  {
    const doc = await load(src.f2031);
    [page] = await ctx.pdf.copyPages(doc, [0]);
    ctx.pdf.addPage(page);
    const f = CERFA_LAYOUT['2031'];
    left(f.ouvert, `01/01/${d.year}`);
    left(f.clos, `31/12/${d.year}`);
    cross(f.simplifie);
    left(f.denomination, d.name, 8, 170);
    left(f.adresse, d.address, 8, 190);
    digits(f.siren, d.siren);
    if (d.home) left(f.domicile, d.home, 8, 250);
    left(f.activite, d.activity.toUpperCase(), 6.2, 562 - f.activite[0]);
    const ben = d.result > 0 ? d.result : 0, def = d.result < 0 ? -d.result : 0;
    for (const r of [f.r1, f.r3, f.r4]) { put(r[0], ben, true); put(r[1], def); }
    put(f.bicA, ben, true);
    put(f.bicB, def);
    cross(f.non);
  }

  // ------------------------------------------------------------------ 2033-SD : A à G
  const doc = await load(src.f2033);
  const keys = (['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const).filter((k) => k !== 'A' || d.a);
  const pages = await ctx.pdf.copyPages(doc, keys.map((k) => 'ABCDEFG'.indexOf(k)));
  keys.forEach((k, i) => {
    page = pages[i];
    ctx.pdf.addPage(page);
    const L = CERFA_LAYOUT['2033'][k] as unknown as { boxes: Record<string, Slot>; neant?: Slot; name?: Pt; siret?: Pt[]; duree?: Pt[]; address?: Pt; closDate?: Pt[] };
    if (L.closDate) digits(L.closDate, `3112${d.year}`, 6);
    if (L.name) left(L.name, d.name, 8, 200);
    const values: Record<string, number | undefined> = k === 'A' ? d.a ?? {} : k === 'B' ? d.b : k === 'C' ? d.c : k === 'D' ? d.d : {};
    const zeros = new Set(['310', '352', '370']);
    for (const [code, v] of Object.entries(values)) put(L.boxes[code], v, zeros.has(code));
    if (k === 'A' && d.a) {
      const a = d.a;
      if (L.siret) digits(L.siret, d.siren);
      if (L.duree) digits(L.duree, '12');
      if (L.address) left(L.address, d.address, 8, 300);
      // colonne Net (sans numéro de case) : brut - amortissements
      for (const [g, dep] of [['010', '012'], ['014', '016'], ['028', '030'], ['040', '042'], ['044', '048'], ['072', '074'], ['084', '086'], ['096', '098'], ['110', '112']] as const) {
        const net = (a[g] ?? 0) - (a[dep] ?? 0);
        if (a[g] !== undefined) put(L.boxes[`net${dep}`], net);
      }
    }
    // tableaux sans objet pour un loueur en meublé : case Néant cochée
    const empty = Object.values(values).every((v) => !v);
    if (L.neant && (k === 'E' || k === 'F' || k === 'G' || (k === 'D' && empty))) cross(L.neant);
  });
}
