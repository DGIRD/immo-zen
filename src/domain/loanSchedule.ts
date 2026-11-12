/**
 * Tableau d'amortissement d'un crédit, importé du document de la banque (PDF, CSV ou texte copié) :
 * repérage des lignes d'échéance, des colonnes (intérêts, capital amorti, assurance, échéance, capital restant dû)
 * et totaux par année civile (intérêts déductibles, assurance, capital restant dû au 31/12).
 *
 * Les colonnes sont reconnues d'après leur en-tête quand il existe, sinon d'après leur contenu :
 * le capital restant dû décroît, le capital amorti en est la différence d'une ligne à l'autre, les intérêts
 * sont proportionnels au capital restant dû précédent, l'échéance est la somme des autres.
 */
import { round2 } from './simulator.ts';

export interface ScheduleRow { date: string; payment: number; interest: number; principal: number; insurance: number; remaining: number }
export interface LoanSchedule { source?: string; imported_at: string; rows: ScheduleRow[] }

export type ColumnRole = 'payment' | 'interest' | 'principal' | 'insurance' | 'remaining' | 'ignore';
export const COLUMN_ROLE_LABELS: Record<ColumnRole, string> = {
  payment: 'Échéance', interest: 'Intérêts', principal: 'Capital amorti', insurance: 'Assurance', remaining: 'Capital restant dû', ignore: 'Ignorer',
};

/** Morceau de texte d'une ligne ; `x` (bord droit, en points) quand il vient d'un PDF. */
export interface Token { text: string; x?: number }

export interface ParsedTable {
  /** Valeurs par ligne d'échéance et par colonne (0 si la case est vide). */
  rows: { date: string | null; index: number | null; values: number[] }[];
  /** Libellé d'en-tête retrouvé pour chaque colonne. */
  headers: string[];
  roles: ColumnRole[];
  warnings: string[];
}

const AMOUNT = /^-?\d{1,3}(?:[   .]\d{3})*,\d{2}$|^-?\d+(?:[.,]\d{2})$/;
const DATE = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})|(\d{4})-(\d{2})-(\d{2})/;
const MONTH_ONLY = /^(\d{1,2})[/.-](\d{4})$/;

export function parseAmount(s: string): number | null {
  const t = s.replace(/€|EUR/g, '').replace(/[  ]/g, ' ').trim();
  if (!AMOUNT.test(t)) return null;
  // 1 234,56 / 1.234,56 / 1234,56 → 1234.56 ; 1234.56 → 1234.56
  const n = t.includes(',') ? Number(t.replace(/[.\s]/g, '').replace(',', '.')) : Number(t.replace(/\s/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function parseDate(s: string): string | null {
  const t = s.trim();
  const mo = t.match(MONTH_ONLY);
  if (mo) return `${mo[2]}-${mo[1]!.padStart(2, '0')}-01`;
  const m = t.match(DATE);
  if (!m) return null;
  if (m[4]) return `${m[4]}-${m[5]}-${m[6]}`;
  const d = Number(m[1]), mm = Number(m[2]);
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  if (d < 1 || d > 31 || mm < 1 || mm > 12 || y < 1980 || y > 2100) return null;
  return `${y}-${String(mm).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Découpe un texte copié (ou un CSV) en lignes de morceaux : tabulation, point-virgule ou au moins deux espaces. */
export function tokenizeText(text: string): Token[][] {
  return text.split(/\r?\n/).map((line) => {
    // tabulations ou points-virgules : colonnes conservées (cases vides comprises)
    if (line.includes('\t') || line.includes(';')) return line.split(line.includes('\t') ? '\t' : ';').map((c, i) => ({ text: c.trim().replace(/^"|"$/g, ''), x: i * 100 })).filter((t) => t.text);
    const sep = / {2,}/;
    let parts = line.split(sep).map((x) => x.trim().replace(/^"|"$/g, '')).filter(Boolean);
    // ligne « 15/01/2025 914,76 412,33 … » séparée par de simples espaces : montants reconnus à leurs deux décimales
    if (parts.length <= 2) parts = line.match(/\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|-?\d{1,3}(?:[   .]\d{3})*,\d{2}|-?\d+[.,]\d{2}|[^\s\d][^\d]*|\d+/g)?.map((x) => x.trim()).filter(Boolean) ?? parts;
    return parts.map((text) => ({ text }));
  });
}

const HEADER_KEYS: [ColumnRole, RegExp][] = [
  ['remaining', /restant|crd|solde|reste|apr[eè]s/i],
  ['insurance', /assur/i],
  ['interest', /int[ée]r[eê]t/i],
  ['principal', /capital|amorti|amortissement|principal/i],
  ['payment', /[ée]ch[ée]ance|mensualit|montant|total|versement/i],
];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
}

/** Repère les lignes d'échéance et regroupe leurs montants en colonnes. */
export function parseTable(lines: Token[][]): ParsedTable {
  const warnings: string[] = [];
  type Raw = { line: number; date: string | null; index: number | null; amounts: { v: number; x?: number }[] };
  const raw: Raw[] = [];
  lines.forEach((toks, li) => {
    let date: string | null = null, index: number | null = null;
    const amounts: Raw['amounts'] = [];
    toks.forEach((t, ti) => {
      const s = t.text.trim();
      if (!s || /%$/.test(s)) return;
      if (!date) { const d = parseDate(s); if (d && (DATE.test(s) || MONTH_ONLY.test(s))) { date = d; return; } }
      const a = parseAmount(s);
      if (a !== null) { amounts.push({ v: a, x: t.x }); return; }
      if (ti <= 1 && index === null && /^\d{1,3}$/.test(s)) index = Number(s);
    });
    if (amounts.length >= 2 && (date || index !== null)) raw.push({ line: li, date, index, amounts });
  });
  if (raw.length < 2) return { rows: [], headers: [], roles: [], warnings: ['Aucune ligne d’échéance reconnue : le document doit contenir une ligne par échéance avec sa date et ses montants.'] };

  // colonnes : par position (PDF) ou par rang (texte)
  const withX = raw.every((r) => r.amounts.every((a) => a.x !== undefined));
  let centers: number[];
  if (withX) {
    const xs = raw.flatMap((r) => r.amounts.map((a) => a.x!)).sort((a, b) => a - b);
    const groups: number[][] = [];
    for (const x of xs) { const g = groups.at(-1); if (g && x - g.at(-1)! <= 12) g.push(x); else groups.push([x]); }
    centers = groups.filter((g) => g.length >= Math.max(2, raw.length * 0.2)).map(median);
  } else {
    const counts = new Map<number, number>();
    for (const r of raw) counts.set(r.amounts.length, (counts.get(r.amounts.length) ?? 0) + 1);
    const k = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]![0];
    centers = Array.from({ length: k }, (_, i) => i);
    const skipped = raw.filter((r) => r.amounts.length !== k).length;
    if (skipped) warnings.push(`${skipped} ligne(s) au nombre de montants différent alignées à droite : vérifiez-les.`);
  }
  const rows = raw.map((r) => {
    const values = centers.map(() => 0);
    r.amounts.forEach((a, i) => {
      let c: number;
      if (withX) c = centers.reduce((best, cx, j) => (Math.abs(cx - a.x!) < Math.abs(centers[best]! - a.x!) ? j : best), 0);
      else c = centers.length - r.amounts.length + i; // alignement à droite
      if (c >= 0) values[c] = a.v;
    });
    return { date: r.date, index: r.index, values };
  });

  // en-têtes : lignes de texte au-dessus de la première échéance
  const headers = centers.map(() => '');
  const first = raw[0]!.line;
  for (let li = Math.max(0, first - 4); li < first; li++) {
    const toks = lines[li]!.filter((t) => /[a-zé]/i.test(t.text));
    if (toks.filter((t) => HEADER_KEYS.some(([, re]) => re.test(t.text))).length < 2) continue;
    if (withX) {
      for (const t of toks) {
        const c = centers.reduce((best, cx, j) => (Math.abs(cx - t.x!) < Math.abs(centers[best]! - t.x!) ? j : best), 0);
        if (t.x !== undefined && Math.abs(centers[c]! - t.x) < 60) headers[c] = `${headers[c]} ${t.text}`.trim();
      }
    } else {
      const labels = toks.map((t) => t.text).filter((s) => !/^(n°|no|num|date|p[ée]riode|rang)/i.test(s));
      const off = centers.length - labels.length;
      labels.forEach((s, i) => { if (i + off >= 0) headers[i + off] = `${headers[i + off]} ${s}`.trim(); });
    }
  }
  return { rows, headers, roles: guessRoles(rows.map((r) => r.values), headers), warnings };
}

/** Rôle de chaque colonne : en-tête d'abord, contenu ensuite. */
export function guessRoles(values: number[][], headers: string[] = []): ColumnRole[] {
  const n = values[0]?.length ?? 0;
  const col = (j: number) => values.map((v) => v[j] ?? 0);
  const roles: ColumnRole[] = Array.from({ length: n }, () => 'ignore');
  const free = (j: number) => roles[j] === 'ignore';
  // 1. en-têtes
  for (const [role, re] of HEADER_KEYS) {
    const j = headers.findIndex((h, i) => free(i) && re.test(h));
    if (j >= 0 && !roles.includes(role)) roles[j] = role;
  }
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.05, Math.abs(b) * 0.002);
  const score = (pred: (i: number) => boolean) => { let ok = 0, tot = 0; for (let i = 1; i < values.length; i++) { tot++; if (pred(i)) ok++; } return tot ? ok / tot : 0; };
  // 2. capital restant dû : la plus grande colonne, décroissante
  if (!roles.includes('remaining')) {
    const cand = [...Array(n).keys()].filter(free).map((j) => ({ j, m: median(col(j)), dec: score((i) => col(j)[i]! <= col(j)[i - 1]! + 0.01) }))
      .filter((c) => c.dec >= 0.9).sort((a, b) => b.m - a.m)[0];
    if (cand) roles[cand.j] = 'remaining';
  }
  const rem = roles.indexOf('remaining');
  // 3. capital amorti : différence du capital restant dû
  if (rem >= 0 && !roles.includes('principal')) {
    const R = col(rem);
    const cand = [...Array(n).keys()].filter(free).map((j) => ({ j, s: score((i) => close(col(j)[i]!, R[i - 1]! - R[i]!)) })).sort((a, b) => b.s - a.s)[0];
    if (cand && cand.s >= 0.6) roles[cand.j] = 'principal';
  }
  // 4. intérêts : proportionnels au capital restant dû précédent (taux constant), et non constants
  if (rem >= 0 && !roles.includes('interest')) {
    const R = col(rem);
    const cand = [...Array(n).keys()].filter(free).map((j) => {
      const ratios = values.slice(1).map((_, k) => (R[k]! > 0 ? col(j)[k + 1]! / R[k]! : 0)).filter((x) => x > 0);
      const m = median(ratios);
      const dev = ratios.length ? ratios.reduce((a, x) => a + Math.abs(x - m), 0) / ratios.length / (m || 1) : 1;
      const s = ratios.length ? ratios.filter((x) => Math.abs(x - m) <= m * 0.02).length / (values.length - 1) : 0;
      const c = col(j), cm = median(c);
      const constant = c.filter((x) => Math.abs(x - cm) <= Math.max(0.01, cm * 0.001)).length >= values.length * 0.8;
      return { j, s, m, dev, constant };
    }).filter((c) => c.m > 0 && c.m < 0.02 && !c.constant && c.s >= 0.6).sort((a, b) => a.dev - b.dev)[0];
    if (cand) roles[cand.j] = 'interest';
  }
  // 5. échéance : somme des autres montants ; l'assurance est le reste éventuel
  const pr = roles.indexOf('principal'), it = roles.indexOf('interest');
  if (pr >= 0 && it >= 0) {
    const others = [...Array(n).keys()].filter(free);
    if (!roles.includes('payment')) {
      for (const j of others) {
        if (score((i) => close(col(j)[i]!, col(pr)[i]! + col(it)[i]!)) >= 0.6) { roles[j] = 'payment'; break; }
        const ins = others.find((k) => k !== j && score((i) => close(col(j)[i]!, col(pr)[i]! + col(it)[i]! + col(k)[i]!)) >= 0.6);
        if (ins !== undefined) { roles[j] = 'payment'; if (!roles.includes('insurance')) roles[ins] = 'insurance'; break; }
      }
    }
    if (!roles.includes('insurance')) {
      // petite colonne presque constante
      const cand = [...Array(n).keys()].filter(free).map((j) => ({ j, m: median(col(j)) })).filter((c) => c.m > 0 && c.m < median(col(it)) && col(c.j).filter((x) => Math.abs(x - c.m) <= c.m * 0.1).length >= values.length * 0.6)[0];
      if (cand) roles[cand.j] = 'insurance';
    }
  }
  return roles;
}

function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** Tableau final d'après les rôles choisis ; sans date, les échéances sont datées depuis la première échéance du crédit. */
export function buildSchedule(t: ParsedTable, roles: ColumnRole[], firstDue: string | null | undefined, source?: string): { schedule: LoanSchedule | null; errors: string[] } {
  const errors: string[] = [];
  const at = (r: ColumnRole) => roles.indexOf(r);
  if (at('interest') < 0) errors.push('Indiquez la colonne des intérêts.');
  const needDates = t.rows.some((r) => !r.date);
  if (needDates && !firstDue) errors.push('Certaines échéances n’ont pas de date : renseignez la première échéance du crédit.');
  if (errors.length) return { schedule: null, errors };
  const v = (r: ParsedTable['rows'][number], role: ColumnRole) => (at(role) >= 0 ? round2(r.values[at(role)] ?? 0) : 0);
  const rows: ScheduleRow[] = t.rows.map((r, i) => {
    const interest = v(r, 'interest'), principal = v(r, 'principal'), insurance = v(r, 'insurance');
    const payment = at('payment') >= 0 ? v(r, 'payment') : round2(interest + principal + insurance);
    const date = r.date ?? addMonths(firstDue!, r.index != null ? r.index - (t.rows[0]!.index ?? 1) : i);
    return { date, payment, interest, principal, insurance, remaining: v(r, 'remaining') };
  }).sort((a, b) => a.date.localeCompare(b.date));
  return { schedule: { source, imported_at: new Date().toISOString(), rows }, errors };
}

export interface ScheduleYear { year: number; count: number; payments: number; interest: number; principal: number; insurance: number; remainingEnd: number | null }

/** Totaux par année civile (date d'échéance). */
export function scheduleYears(s: LoanSchedule | null | undefined): ScheduleYear[] {
  if (!s?.rows.length) return [];
  const by = new Map<number, ScheduleYear>();
  for (const r of s.rows) {
    const y = Number(r.date.slice(0, 4));
    const e = by.get(y) ?? { year: y, count: 0, payments: 0, interest: 0, principal: 0, insurance: 0, remainingEnd: null };
    e.count++;
    e.payments = round2(e.payments + r.payment);
    e.interest = round2(e.interest + r.interest);
    e.principal = round2(e.principal + r.principal);
    e.insurance = round2(e.insurance + r.insurance);
    if (r.remaining > 0 || e.remainingEnd !== null) e.remainingEnd = r.remaining;
    by.set(y, e);
  }
  return [...by.values()].sort((a, b) => a.year - b.year);
}

/** Montants d'une année d'après le tableau importé (null si le tableau ne couvre pas l'année). */
export function scheduleYear(s: LoanSchedule | null | undefined, year: number): ScheduleYear | null {
  return scheduleYears(s).find((y) => y.year === year) ?? null;
}

/** Capital restant dû au 31/12 d'après le tableau (dernière échéance de l'année ou d'avant). */
export function scheduleRemaining(s: LoanSchedule | null | undefined, year: number): number | null {
  if (!s?.rows.length) return null;
  const before = s.rows.filter((r) => r.date <= `${year}-12-31`);
  if (!before.length) return null;
  const last = before.at(-1)!;
  return last.remaining > 0 || s.rows.at(-1) === last ? last.remaining : null;
}

/** Lignes d'un classeur ou d'un CSV : un morceau par cellule (dates Excel converties, montants à deux décimales). */
export function cellsToLines(rows: (string | number | null)[][]): Token[][] {
  return rows.map((row) => row.flatMap((c, i): Token[] => {
    // abscisse fictive : une colonne du classeur = une colonne du tableau, cases vides comprises
    const x = i * 100;
    if (c === null || c === '') return [];
    if (typeof c === 'string') return [{ text: c, x }];
    if (i <= 2 && Number.isInteger(c) && c > 25000 && c < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + c * 86400000);
      return [{ text: d.toISOString().slice(0, 10), x }];
    }
    if (Number.isInteger(c) && c >= 0 && c < 1000 && i <= 1) return [{ text: String(c), x }];
    return [{ text: c.toFixed(2), x }];
  }));
}

// ---------------------------------------------------------------- PDF (pdf.js, chargé à la demande)

interface PdfTextItem { str: string; transform: number[]; width: number }

/** Lignes de morceaux d'un PDF : morceaux regroupés par ordonnée, bord droit en abscisse. */
export function pdfItemsToLines(pages: PdfTextItem[][]): Token[][] {
  const out: Token[][] = [];
  for (const items of pages) {
    const byY = new Map<number, PdfTextItem[]>();
    for (const it of items) {
      if (!it.str.trim()) continue;
      const y = Math.round(it.transform[5]! / 2) * 2;
      const key = [...byY.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
      byY.set(key, [...(byY.get(key) ?? []), it]);
    }
    for (const y of [...byY.keys()].sort((a, b) => b - a)) {
      const its = byY.get(y)!.sort((a, b) => a.transform[4]! - b.transform[4]!);
      // morceaux collés (« 1 » « 234,56 ») réunis
      const toks: Token[] = [];
      for (const it of its) {
        const x0 = it.transform[4]!, x1 = x0 + it.width;
        const prev = toks.at(-1);
        if (prev && x0 - prev.x! < 2.5 && /\d$/.test(prev.text) && /^[\d\s,.]/.test(it.str)) { prev.text += it.str; prev.x = x1; }
        else toks.push({ text: it.str, x: x1 });
      }
      out.push(toks);
    }
  }
  return out;
}

/** Texte d'un PDF, page par page (pdf.js servi avec l'application, chargé à la demande). */
export async function readPdfLines(data: ArrayBuffer, base = 'vendor/pdfjs/'): Promise<Token[][]> {
  const url = new URL(`${base}pdf.min.mjs`, document.baseURI).href;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import(/* @vite-ignore */ url);
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(`${base}pdf.worker.min.mjs`, document.baseURI).href;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
  const pages: PdfTextItem[][] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.filter((x: { str?: string }) => typeof x.str === 'string'));
  }
  return pdfItemsToLines(pages);
}
