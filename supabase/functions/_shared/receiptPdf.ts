/**
 * Quittance de loyer / reçu de paiement partiel au format PDF.
 * Module partagé : utilisé par l'application (aperçu, téléchargement) et par la fonction
 * serveur d'envoi (pièce jointe). La bibliothèque pdf-lib est passée en paramètre pour
 * fonctionner à l'identique dans le navigateur, Node et Deno.
 *
 * Le contenu reprend les mentions usuelles d'une quittance (art. 21 de la loi n° 89-462) :
 * identité du bailleur et du locataire, adresse du logement, période, détail du loyer et des
 * charges. Le modèle doit être relu par le propriétaire ; il n'est pas présenté comme validé
 * juridiquement.
 */

export interface ReceiptData {
  kind: 'quittance' | 'recu';
  number: string;
  issued_on: string;
  period_start: string;
  period_end: string;
  rent_amount: number;
  charges_amount: number;
  paid_amount: number;
  payments: { date: string; amount: number; method: string }[];
  tenant_names: string;
  landlord_name: string | null;
  landlord_address: string | null;
  property_address: string | null;
  charges_label?: string;
  /** Rappels de charges (régularisations d'années précédentes) réglés et repris sur la quittance. */
  extra_lines?: { label: string; amount: number }[] | null;
}

// Sous-ensemble de l'API pdf-lib utilisé
interface PdfLib {
  PDFDocument: { create(): Promise<any> };
  StandardFonts: { Helvetica: string; HelveticaBold: string };
  rgb(r: number, g: number, b: number): unknown;
}

const METHODS: Record<string, string> = { virement: 'virement', prelevement: 'prélèvement', cheque: 'chèque', especes: 'espèces', caf: 'CAF / APL', autre: 'autre moyen' };

export function frDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function frMoney(v: number): string {
  const r = Math.round(Math.abs(v) * 100 + 1e-9) / 100;
  const [i, d] = r.toFixed(2).split('.');
  return `${v < 0 ? '-' : ''}${i!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${d} €`;
}

/** Remplace les caractères absents de l'encodage WinAnsi des polices standard. */
export function pdfSafe(s: string): string {
  return s
    .replace(/[\u202f\u00a0\u2009]/g, ' ')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7e\u00a0-\u00ff\u20ac\u0152\u0153\u0160\u0161\u0178\u017d\u017e]/g, '?');
}

/** Lignes de texte du document (testables indépendamment du rendu). */
export function receiptLines(r: ReceiptData) {
  const extras = (r.extra_lines ?? []).filter((x) => x.amount);
  const total = Math.round((r.rent_amount + r.charges_amount + extras.reduce((a, x) => a + x.amount, 0)) * 100) / 100;
  const remaining = Math.round((total - r.paid_amount) * 100) / 100;
  const period = `du ${frDate(r.period_start)} au ${frDate(r.period_end)}`;
  const landlord = r.landlord_name?.trim() || 'Le bailleur';
  const title = r.kind === 'quittance' ? 'Quittance de loyer' : 'Reçu de paiement partiel';
  const statement = r.kind === 'quittance'
    ? `Je soussigné(e) ${landlord}, bailleur du logement désigné ci-dessus, déclare avoir reçu de ${r.tenant_names} la somme de ${frMoney(total)} au titre du loyer et des charges pour la période ${period}${extras.length ? `, ainsi que du rappel de charges (${extras.map((x) => x.label).join(', ')})` : ''}, et lui en donne quittance, sous réserve de tous mes droits.`
    : `Je soussigné(e) ${landlord}, bailleur du logement désigné ci-dessus, déclare avoir reçu de ${r.tenant_names} la somme de ${frMoney(r.paid_amount)}, à valoir sur le loyer et les charges de la période ${period}. Il reste dû ${frMoney(remaining)} pour cette période. Le présent reçu ne vaut pas quittance.`;
  return {
    title,
    number: `N° ${r.number}`,
    period,
    landlord: [landlord, r.landlord_address ?? ''].filter(Boolean),
    tenant: r.tenant_names,
    property: r.property_address ?? '—',
    detail: [
      ['Loyer hors charges', frMoney(r.rent_amount)],
      [r.charges_label ?? 'Provision pour charges', frMoney(r.charges_amount)],
      ...extras.map((x) => [x.label, frMoney(x.amount)] as [string, string]),
      [extras.length ? 'Total réglé' : 'Total de la période', frMoney(total)],
      ...(r.kind === 'recu' ? [['Montant reçu', frMoney(r.paid_amount)], ['Reste dû', frMoney(remaining)]] : []),
    ] as [string, string][],
    payments: r.payments.map((p) => `${frDate(p.date)} : ${frMoney(p.amount)} par ${METHODS[p.method] ?? p.method}`),
    statement,
    signature: `Fait le ${frDate(r.issued_on)}`,
    footer: r.kind === 'quittance'
      ? 'La quittance est délivrée gratuitement au locataire (article 21 de la loi n° 89-462 du 6 juillet 1989).'
      : 'Reçu délivré pour un paiement partiel. Une quittance sera délivrée une fois la période intégralement réglée.',
  };
}

function wrap(text: string, font: any, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}

export async function buildReceiptPdf(lib: PdfLib, r: ReceiptData): Promise<Uint8Array> {
  const L = receiptLines(r);
  const doc = await lib.PDFDocument.create();
  doc.setTitle(pdfSafe(`${L.title} ${r.number}`));
  doc.setAuthor(pdfSafe(r.landlord_name ?? 'Bailleur'));
  doc.setCreator('Immo-Zen');
  doc.setProducer('Immo-Zen');
  doc.setCreationDate(new Date(`${r.issued_on.slice(0, 10)}T12:00:00Z`));
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(lib.StandardFonts.Helvetica);
  const bold = await doc.embedFont(lib.StandardFonts.HelveticaBold);
  const ink = lib.rgb(0.11, 0.16, 0.16);
  const soft = lib.rgb(0.35, 0.4, 0.39);
  const line = lib.rgb(0.8, 0.84, 0.82);
  const M = 56;
  const W = 595.28 - 2 * M;
  const text = (s: string, x: number, size = 10.5, f = font, color = ink) => page.drawText(pdfSafe(s), { x, y, size, font: f, color });

  // Logo Immo-Zen (maison stylisée, mêmes tracés que l'icône de l'application) et nom
  const sapin = lib.rgb(0.122, 0.29, 0.27);
  const s = 1, lx = M, ly = 841.89 - 28; // coin haut gauche du logo (32 × 32 unités)
  page.drawSvgPath('M4 17 L16 6 L28 17', { x: lx, y: ly, scale: s, borderColor: sapin, borderWidth: 2.6 * s, borderLineCap: 1 });
  page.drawSvgPath('M9 26 H23', { x: lx, y: ly, scale: s, borderColor: sapin, borderWidth: 2.6 * s, borderLineCap: 1 });
  page.drawCircle({ x: lx + 16 * s, y: ly - 19 * s, size: 2.4 * s, color: sapin });
  page.drawText('Immo-Zen', { x: lx + 32 * s + 6, y: ly - 20 * s, size: 16, font: bold, color: sapin });
  page.drawLine({ start: { x: M, y: ly - 32 * s - 8 }, end: { x: M + W, y: ly - 32 * s - 8 }, thickness: 0.6, color: line });
  let y = 841.89 - 106;

  text(L.title, M, 22, bold);
  page.drawText(pdfSafe(L.number), { x: M + W - bold.widthOfTextAtSize(pdfSafe(L.number), 11), y: y + 4, size: 11, font: bold, color: ink });
  y -= 22;
  text(`Période ${L.period}`, M, 11, font, soft);
  y -= 36;

  // Bailleur / locataire
  const colW = W / 2 - 10;
  const top = y;
  text('Bailleur', M, 9, bold, soft);
  y -= 15;
  for (const l of L.landlord.flatMap((s) => wrap(pdfSafe(s), font, 10.5, colW))) { text(l, M); y -= 14; }
  const leftEnd = y;
  y = top;
  text('Locataire(s)', M + W / 2 + 10, 9, bold, soft);
  y -= 15;
  for (const l of wrap(pdfSafe(L.tenant), font, 10.5, colW)) { text(l, M + W / 2 + 10); y -= 14; }
  y = Math.min(y, leftEnd) - 14;
  text('Logement', M, 9, bold, soft);
  y -= 15;
  for (const l of wrap(pdfSafe(L.property), font, 10.5, W)) { text(l, M); y -= 14; }
  y -= 16;

  // Détail
  page.drawLine({ start: { x: M, y: y + 8 }, end: { x: M + W, y: y + 8 }, thickness: 0.8, color: line });
  y -= 8;
  L.detail.forEach(([k, v], i) => {
    const isTotal = k === 'Total de la période';
    const f = isTotal ? bold : font;
    text(k, M, 11, f);
    page.drawText(pdfSafe(v), { x: M + W - f.widthOfTextAtSize(pdfSafe(v), 11), y, size: 11, font: f, color: ink });
    y -= 20;
    if (isTotal && i < L.detail.length - 1) y -= 2;
  });
  page.drawLine({ start: { x: M, y: y + 8 }, end: { x: M + W, y: y + 8 }, thickness: 0.8, color: line });
  y -= 18;

  if (L.payments.length) {
    text('Paiements reçus', M, 9, bold, soft);
    y -= 15;
    for (const p of L.payments) { text(p, M); y -= 14; }
    y -= 10;
  }

  for (const l of wrap(pdfSafe(L.statement), font, 11, W)) { text(l, M, 11); y -= 16; }
  y -= 18;
  text(L.signature, M + W / 2, 11);
  y -= 16;
  text(pdfSafe(r.landlord_name ?? ''), M + W / 2, 11, bold);

  y = 60;
  for (const l of wrap(pdfSafe(L.footer), font, 8.5, W)) { text(l, M, 8.5, font, soft); y -= 11; }
  return doc.save();
}
