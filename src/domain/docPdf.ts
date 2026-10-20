/**
 * Rendu PDF d'un document structuré (contrat de bail, dossier de déclaration fiscale) avec pdf-lib.
 * Polices standard (encodage WinAnsi) : les caractères non représentables sont remplacés.
 */
import { pdfSafe } from '../../supabase/functions/_shared/receiptPdf.ts';
import type { DocSection } from './leaseContract.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfLib = { PDFDocument: { create(): Promise<any> }; StandardFonts: { Helvetica: string; HelveticaBold: string }; rgb(r: number, g: number, b: number): unknown };

export interface PdfDoc { title: string; subtitle?: string; sections: DocSection[]; footer?: string }

const W = 595.28, H = 841.89, M = 50;

export async function buildDocPdf(lib: PdfLib, doc: PdfDoc): Promise<Uint8Array> {
  const pdf = await lib.PDFDocument.create();
  pdf.setTitle(pdfSafe(doc.title));
  pdf.setCreator('Immo-Zen');
  const font = await pdf.embedFont(lib.StandardFonts.Helvetica);
  const bold = await pdf.embedFont(lib.StandardFonts.HelveticaBold);
  const ink = lib.rgb(0.09, 0.2, 0.18), grey = lib.rgb(0.35, 0.38, 0.37), rule = lib.rgb(0.8, 0.85, 0.82);
  let page = pdf.addPage([W, H]);
  let y = H - M;

  const wrap = (text: string, f: typeof font, size: number, width: number): string[] => {
    const out: string[] = [];
    for (const para of pdfSafe(text).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const test = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(test, size) <= width) { line = test; continue; }
        if (line) out.push(line);
        // mot plus long que la ligne : coupé
        let w = word;
        while (f.widthOfTextAtSize(w, size) > width) {
          let k = w.length - 1;
          while (k > 1 && f.widthOfTextAtSize(w.slice(0, k), size) > width) k--;
          out.push(w.slice(0, k)); w = w.slice(k);
        }
        line = w;
      }
      out.push(line);
    }
    return out;
  };
  const need = (h: number) => { if (y - h < M + 20) { page = pdf.addPage([W, H]); y = H - M; } };
  const text = (s: string, x: number, size: number, f = font, color = ink) => page.drawText(s, { x, y, size, font: f, color });

  // titre
  for (const l of wrap(doc.title, bold, 15, W - 2 * M)) { need(20); text(l, M, 15, bold); y -= 19; }
  if (doc.subtitle) { y -= 2; for (const l of wrap(doc.subtitle, font, 8.5, W - 2 * M)) { need(11); text(l, M, 8.5, font, grey); y -= 11; } }
  y -= 8;

  for (const s of doc.sections) {
    need(40);
    y -= 6;
    text(pdfSafe(s.title), M, 11, bold);
    y -= 5;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: rule });
    y -= 13;
    for (const b of s.blocks) {
      if (b.t === 'p') {
        for (const l of wrap(b.text, font, 9.5, W - 2 * M)) { need(13); text(l, M, 9.5); y -= 12.5; }
        y -= 4;
      } else if (b.t === 'list') {
        for (const it of b.items) {
          const lines = wrap(it, font, 9.5, W - 2 * M - 14);
          lines.forEach((l, i) => { need(13); if (i === 0) text('-', M + 3, 9.5); text(l, M + 14, 9.5); y -= 12.5; });
        }
        y -= 4;
      } else if (b.t === 'kv') {
        const lw = 200;
        for (const [k, v] of b.rows) {
          const kl = wrap(k, font, 9, lw - 8);
          const vl = wrap(v || '—', bold, 9.5, W - 2 * M - lw);
          const h = Math.max(kl.length, vl.length) * 12.5;
          need(h);
          const top = y;
          kl.forEach((l, i) => { y = top - i * 12.5; text(l, M, 9, font, grey); });
          vl.forEach((l, i) => { y = top - i * 12.5; text(l, M + lw, 9.5, bold); });
          y = top - h - 2;
        }
        y -= 4;
      } else {
        const bw = (W - 2 * M - 20) / 2;
        for (let i = 0; i < b.parties.length; i += 2) {
          need(90);
          for (const [j, who] of b.parties.slice(i, i + 2).entries()) {
            const x = M + j * (bw + 20);
            page.drawRectangle({ x, y: y - 80, width: bw, height: 80, borderColor: rule, borderWidth: 0.8 });
            for (const [k, l] of wrap(who, font, 9, bw - 12).slice(0, 2).entries()) page.drawText(l, { x: x + 6, y: y - 13 - k * 11, size: 9, font, color: grey });
          }
          y -= 92;
        }
      }
    }
  }
  const pages = pdf.getPages();
  pages.forEach((p: { drawText: (s: string, o: object) => void }, i: number) => {
    const label = `${doc.footer ? pdfSafe(doc.footer) + ' - ' : ''}Page ${i + 1} / ${pages.length}`;
    p.drawText(label, { x: M, y: 28, size: 7.5, font, color: grey });
  });
  return pdf.save();
}
