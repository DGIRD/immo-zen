/**
 * Mise en page du dossier de financement : page de garde aux couleurs d'Immo-Zen (logo, projet, chiffres clés,
 * répartition apport / prêt, jauge d'endettement), puis sections aérées (fiches clé / valeur et tableaux).
 * pdf-lib, polices standard (WinAnsi) : les caractères non représentables sont remplacés par pdfSafe.
 */
import { pdfSafe } from '../../supabase/functions/_shared/receiptPdf.ts';
import type { BankDossier } from './bankDossier.ts';
import { money, pct } from './format.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
type Lib = { PDFDocument: { create(): Promise<Any> }; StandardFonts: Record<string, string>; rgb(r: number, g: number, b: number): unknown; LineCapStyle?: Record<string, unknown> };

const W = 595.28, H = 841.89, M = 56;

export async function buildBankDossierPdf(lib: Lib, d: BankDossier): Promise<Uint8Array> {
  const pdf = await lib.PDFDocument.create();
  pdf.setTitle(pdfSafe(d.title));
  pdf.setCreator('Immo-Zen');
  const font = await pdf.embedFont(lib.StandardFonts.Helvetica);
  const bold = await pdf.embedFont(lib.StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(lib.StandardFonts.TimesRomanBold);
  const c = (r: number, g: number, b: number) => lib.rgb(r / 255, g / 255, b / 255);
  const sapin = c(31, 74, 69), mousse = c(227, 237, 231), ocre = c(154, 100, 15), ink = c(28, 38, 36), grey = c(98, 108, 105);
  const white = c(255, 255, 255), rule = c(214, 224, 218), red = c(166, 50, 38), green = c(33, 110, 70), pale = c(244, 247, 245);
  let page: Any;
  let y = 0;
  const newPage = () => { page = pdf.addPage([W, H]); y = H - M; };
  const need = (h: number) => { if (y - h < M + 24) newPage(); };
  const wrap = (text: string, f: Any, size: number, width: number): string[] => {
    const out: string[] = [];
    for (const para of text.split('\n').map((x) => pdfSafe(x))) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const test = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(test, size) <= width) { line = test; continue; }
        if (line) out.push(line);
        line = word;
      }
      out.push(line);
    }
    return out;
  };
  const txt = (s: string, x: number, yy: number, size: number, f = font, color = ink) => page.drawText(pdfSafe(s), { x, y: yy, size, font: f, color });
  const right = (s: string, xr: number, yy: number, size: number, f = font, color = ink) => txt(s, xr - f.widthOfTextAtSize(pdfSafe(s), size), yy, size, f, color);

  /** Logo d'Immo-Zen (toit, point, trait) dessiné en vectoriel, blanc sur carré vert. */
  const logo = (x: number, yTop: number, size: number) => {
    const s = size / 512;
    page.drawRectangle({ x, y: yTop - size, width: size, height: size, color: sapin, borderColor: white, borderWidth: 0.8 });
    const P = (px: number, py: number) => ({ x: x + px * s, y: yTop - py * s });
    const th = 26 * s;
    page.drawLine({ start: P(142, 265), end: P(256, 160), thickness: th, color: white, lineCap: 1 });
    page.drawLine({ start: P(256, 160), end: P(370, 265), thickness: th, color: white, lineCap: 1 });
    page.drawCircle({ ...P(256, 284), size: 22 * s, color: white });
    page.drawLine({ start: P(190, 349), end: P(322, 349), thickness: th, color: white, lineCap: 1 });
  };

  // ------------------------------------------------------------------ page de garde
  newPage();
  const cv = d.cover;
  const band = 196;
  page.drawRectangle({ x: 0, y: H - band, width: W, height: band, color: sapin });
  logo(M, H - 40, 34);
  txt('Immo-Zen', M + 44, H - 63, 17, serif, white);
  right(cv.label.toUpperCase(), W - M, H - 60, 9, bold, mousse);
  let ty = H - 108;
  for (const l of wrap(cv.title, bold, 25, W - 2 * M).slice(0, 2)) { txt(l, M, ty, 25, bold, white); ty -= 29; }
  for (const l of wrap(cv.subtitle, font, 10, W - 2 * M)) { txt(l, M, ty + 4, 10, font, mousse); ty -= 14; }
  y = H - band - 34;

  // le projet en bref
  txt('Le projet en bref', M, y, 13, bold, sapin);
  y -= 20;
  for (const para of cv.pitch) {
    for (const l of wrap(para, font, 10.5, W - 2 * M)) { txt(l, M, y, 10.5, font, ink); y -= 15.5; }
    y -= 5;
  }
  y -= 12;

  // chiffres clés : 3 colonnes
  txt('Chiffres clés', M, y, 13, bold, sapin);
  y -= 14;
  const gap = 12, cols = 3, tw = (W - 2 * M - gap * (cols - 1)) / cols, th = 64;
  cv.kpis.forEach((k, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = M + col * (tw + gap), top = y - row * (th + gap);
    page.drawRectangle({ x, y: top - th, width: tw, height: th, color: mousse });
    page.drawRectangle({ x, y: top - th, width: 3, height: th, color: k.tone === 'neg' ? red : k.tone === 'pos' ? green : sapin });
    txt(k.label.toUpperCase(), x + 12, top - 17, 7.2, bold, grey);
    let vs = 17;
    while (vs > 11 && bold.widthOfTextAtSize(pdfSafe(k.value), vs) > tw - 24) vs -= 0.5;
    txt(k.value, x + 12, top - 38, vs, bold, k.tone === 'neg' ? red : sapin);
    if (k.sub) txt(wrap(k.sub, font, 7.8, tw - 24)[0] ?? '', x + 12, top - 52, 7.8, font, grey);
  });
  y -= Math.ceil(cv.kpis.length / cols) * (th + gap) + 18;

  // financement : barre apport / prêt
  const total = cv.financing.equity + cv.financing.loan;
  if (total > 0) {
    need(70);
    txt('Financement du projet', M, y, 13, bold, sapin);
    y -= 18;
    const bw = W - 2 * M, bh = 18;
    const we = (cv.financing.equity / total) * bw;
    page.drawRectangle({ x: M, y: y - bh, width: bw, height: bh, color: sapin });
    if (we > 0) page.drawRectangle({ x: M, y: y - bh, width: we, height: bh, color: ocre });
    y -= bh + 14;
    const legend = (x: number, color: unknown, label: string) => { page.drawRectangle({ x, y: y - 1, width: 9, height: 9, color }); txt(label, x + 14, y, 9, font, ink); };
    legend(M, ocre, `Apport ${money(cv.financing.equity)} (${pct(Math.round((cv.financing.equity / total) * 1000) / 10)})`);
    legend(M + bw / 2, sapin, `Prêt ${money(cv.financing.loan)} (${pct(Math.round((cv.financing.loan / total) * 1000) / 10)})`);
    y -= 38;
  }

  // endettement : jauge 0–50 % avec repère du plafond
  if (cv.debt) {
    need(70);
    txt('Taux d’endettement', M, y, 13, bold, sapin);
    right(`${cv.debt.before != null ? `aujourd’hui ${pct(cv.debt.before)} · ` : ''}après le projet ${pct(cv.debt.after)}`, W - M, y, 9.5, bold, cv.debt.after > cv.debt.max ? red : green);
    y -= 18;
    const bw = W - 2 * M, bh = 12, scale = 50;
    const at = (v: number) => M + (Math.min(scale, Math.max(0, v)) / scale) * bw;
    page.drawRectangle({ x: M, y: y - bh, width: bw, height: bh, color: pale, borderColor: rule, borderWidth: 0.6 });
    page.drawRectangle({ x: M, y: y - bh, width: at(cv.debt.after) - M, height: bh, color: cv.debt.after > cv.debt.max ? red : green });
    const mx = at(cv.debt.max);
    page.drawLine({ start: { x: mx, y: y + 4 }, end: { x: mx, y: y - bh - 4 }, thickness: 1.4, color: ink });
    y -= bh + 13;
    txt('0 %', M, y, 7.5, font, grey);
    txt(`plafond ${cv.debt.max} %`, mx - 22, y, 7.5, bold, ink);
    right(`${scale} %`, W - M, y, 7.5, font, grey);
    y -= 22;
  }

  // ------------------------------------------------------------------ sections
  /** Hauteur approximative d'un bloc, pour ne pas couper un petit tableau ou une fiche en bas de page. */
  const heightOf = (b: BankDossier['sections'][number]['blocks'][number]): number => {
    if (b.t === 'kv') return b.rows.length * 22 + 12;
    if (b.t === 'table') return (b.rows.length + 1) * 21 + 18 + (b.caption ? 15 : 0);
    if (b.t === 'p') return wrap(b.text, font, 9.8, W - 2 * M).length * 14.5 + 8;
    return 40;
  };
  newPage();
  for (const s of d.sections) {
    if (s.newPage && y < H - M - 1) newPage();
    const first = s.blocks[0] ? heightOf(s.blocks[0]) : 0;
    need(26 + Math.min(first, 360));
    page.drawRectangle({ x: M, y: y - 3, width: 4, height: 17, color: sapin });
    txt(s.title, M + 12, y, 13.5, bold, sapin);
    y -= 26;
    for (const b of s.blocks) {
      const h0 = heightOf(b);
      if (h0 < 360) need(h0);
      if (b.t === 'p') {
        for (const l of wrap(b.text, font, 9.8, W - 2 * M)) { need(15); txt(l, M, y, 9.8, font, ink); y -= 14.5; }
        y -= 8;
      } else if (b.t === 'kv') {
        const lw = 215;
        b.rows.forEach(([k, v], idx) => {
          const kl = wrap(k, font, 9.3, lw - 14), vl = wrap(v || '—', bold, 9.8, W - 2 * M - lw - 10);
          const h = Math.max(kl.length, vl.length) * 13 + 9;
          need(h);
          if (idx % 2 === 0) page.drawRectangle({ x: M, y: y - h + 9, width: W - 2 * M, height: h, color: pale });
          kl.forEach((l, i) => txt(l, M + 8, y - i * 13, 9.3, font, grey));
          vl.forEach((l, i) => txt(l, M + lw, y - i * 13, 9.8, bold, ink));
          y -= h;
        });
        y -= 12;
      } else if (b.t === 'table') {
        const fs = 8.6, lh = 11, pad = 5, tot = W - 2 * M;
        const rel = b.widths ?? b.head.map((_, i) => (i === 0 ? 3 : 1.4));
        const sum = rel.reduce((a, x) => a + x, 0);
        const cw = rel.map((x) => (x / sum) * tot);
        const xs = cw.map((_, i) => M + cw.slice(0, i).reduce((a, x) => a + x, 0));
        const al = b.align ?? b.head.map((_, i) => (i === 0 ? 'l' : 'r'));
        const row = (cells: string[], f: Any, fill: unknown | null, color: unknown) => {
          const lines = cells.map((x, i) => wrap(x || '', f, fs, cw[i]! - 2 * pad));
          const h = Math.max(1, ...lines.map((l) => l.length)) * lh + 2 * pad;
          need(h);
          if (fill) page.drawRectangle({ x: M, y: y - h, width: tot, height: h, color: fill });
          lines.forEach((ls, i) => ls.forEach((l, k) => {
            const w = f.widthOfTextAtSize(l, fs);
            page.drawText(l, { x: al[i] === 'r' ? xs[i]! + cw[i]! - pad - w : xs[i]! + pad, y: y - pad - (k + 1) * lh + 2.5, size: fs, font: f, color });
          }));
          y -= h;
          page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.4, color: rule });
        };
        if (b.caption) { txt(b.caption, M, y, 9.5, bold, ink); y -= 15; }
        need(50);
        row(b.head, bold, sapin, white);
        b.rows.forEach((r, i) => {
          const last = b.total && i === b.rows.length - 1;
          if (y < M + 50) { newPage(); row(b.head, bold, sapin, white); }
          row(r, last ? bold : font, last ? mousse : i % 2 ? pale : null, ink);
        });
        y -= 18;
      } else if (b.t === 'list') {
        for (const it of b.items) for (const [i, l] of wrap(it, font, 9.8, W - 2 * M - 14).entries()) { need(15); if (i === 0) txt('•', M + 3, y, 9.8); txt(l, M + 14, y, 9.8); y -= 14.5; }
        y -= 8;
      }
    }
    y -= 14;
  }

  // pied de page : logo discret, mention, pagination
  const pages = pdf.getPages();
  pages.forEach((p: Any, i: number) => {
    page = p;
    if (i > 0) { page.drawLine({ start: { x: M, y: 40 }, end: { x: W - M, y: 40 }, thickness: 0.5, color: rule }); }
    txt(`${d.footer ?? ''}`, M, 26, 7.5, font, grey);
    right(`${pdfSafe(d.cover.title)} · page ${i + 1} / ${pages.length}`, W - M, 26, 7.5, font, grey);
  });
  return pdf.save();
}
