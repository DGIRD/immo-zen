/**
 * Import en masse de dépenses et recettes depuis un relevé (Excel .xlsx, CSV ou copier-coller).
 * Colonnes attendues (ordre libre, en-têtes reconnus sans tenir compte des accents ni de la casse) :
 * Date · Libellé · Compte du mouvement · Montant (EUROS) · Catégorie · Commentaires · Appartement
 */
import JSZip from 'jszip';
import type { Expense, ExpenseCategory, Insert, Property } from '../data/types.ts';
import { EXPENSE_CATEGORY_LABELS, defaultNature } from './rental.ts';

export type Cell = string | number | null;

export const IMPORT_COLUMNS = ['Date', 'Libellé', 'Compte du mouvement', 'Montant (EUROS)', 'Catégorie', 'Commentaires', 'Appartement'] as const;
type Field = 'date' | 'label' | 'account' | 'amount' | 'category' | 'notes' | 'property' | 'years';

export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ---------------------------------------------------------------- lecture des fichiers

/** Texte collé ou CSV : séparateur détecté (tabulation, point-virgule, virgule), guillemets gérés. */
export function parseDelimited(text: string): Cell[][] {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const first = clean.split('\n').find((l) => l.trim()) ?? '';
  const sep = first.includes('\t') ? '\t' : (first.split(';').length >= first.split(',').length ? ';' : ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]!;
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"' && cur === '') quoted = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.map((r) => r.map((v): Cell => (v.trim() === '' ? null : v.trim()))).filter((r) => r.some((v) => v !== null));
}

const xmlDecode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => xmlDecode(m[1]!)).join('');
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

/** Première feuille d'un classeur .xlsx. Les dates Excel restent des nombres (convertis par parseDate). */
export async function parseXlsx(data: ArrayBuffer | Uint8Array): Promise<Cell[][]> {
  const zip = await JSZip.loadAsync(data);
  const shared: string[] = [];
  const sst = await zip.file('xl/sharedStrings.xml')?.async('string');
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]!));
  // première feuille dans l'ordre du classeur
  const wb = await zip.file('xl/workbook.xml')?.async('string');
  const rels = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
  let path = 'xl/worksheets/sheet1.xml';
  const rid = wb?.match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1];
  const target = rid && rels ? new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1] : undefined;
  if (target) path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  const sheet = await zip.file(path)?.async('string');
  if (!sheet) throw new Error('Feuille introuvable dans le classeur.');
  const rows: Cell[][] = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: Cell[] = [];
    for (const cm of rm[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]!;
      const body = cm[2] ?? '';
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: Cell = null;
      if (type === 's' && v !== undefined) value = shared[Number(v)] ?? null;
      else if (type === 'inlineStr') value = textOf(body);
      else if (type === 'str' || type === 'e') value = v !== undefined ? xmlDecode(v) : null;
      else if (type === 'b') value = v === '1' ? 'VRAI' : 'FAUX';
      else if (v !== undefined) value = Number(v);
      const idx = ref ? colIndex(ref) : row.length;
      while (row.length < idx) row.push(null);
      row[idx] = typeof value === 'string' && value.trim() === '' ? null : typeof value === 'string' ? value.trim() : value;
    }
    if (row.some((c) => c !== null)) rows.push(row);
  }
  return rows;
}

export async function readImportFile(file: File): Promise<Cell[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) return parseXlsx(await file.arrayBuffer());
  if (name.endsWith('.xls')) throw new Error('Ancien format Excel (.xls) : enregistrez le fichier au format .xlsx (Fichier → Enregistrer sous).');
  const buf = new Uint8Array(await file.arrayBuffer());
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf); // CSV Excel français
  return parseDelimited(text);
}

// ---------------------------------------------------------------- valeurs

/** « -319,35 € », « 1 234,56 », « (12,00) », 1234.5 → nombre ; null si illisible. */
export function parseAmount(v: Cell): number | null {
  if (v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  let s = v.replace(/[\s  €]|EUR/gi, '');
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else s = s.replace(',', '.');
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s) * (neg ? -1 : 1);
  return Math.round(n * 100) / 100;
}

/** « 27/04/2023 », « 27/04/23 », « 2023-04-27 » ou date Excel → AAAA-MM-JJ ; null si illisible. */
export function parseDate(v: Cell): string | null {
  if (v === null) return null;
  const iso = (y: number, m: number, d: number) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return dt.toISOString().slice(0, 10);
  };
  if (typeof v === 'number') {
    if (v < 1 || v > 2958465) return null;
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return dt.toISOString().slice(0, 10);
  }
  const s = v.trim();
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (m) { const y = Number(m[3]); return iso(y < 100 ? 2000 + y : y, Number(m[2]), Number(m[1])); }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  if (/^\d{5}(\.\d+)?$/.test(s)) return parseDate(Number(s));
  return null;
}

const CATEGORY_SYNONYMS: [RegExp, ExpenseCategory][] = [
  [/^assurance (du )?credit|^assurance emprunt/, 'assurance_credit'],
  [/^frais (de )?credit|^frais (de )?(dossier|garantie|pret)/, 'frais_credit'],
  [/^credit|^echeance|^pret|^emprunt|^mensualite/, 'credit'],
  [/copro|syndic/, 'copropriete'],
  [/^taxe fonciere|^tf\b|^impot foncier/, 'taxe_fonciere'],
  [/non amortissable/, 'entretien'],
  [/amortissable/, 'entretien_amortissable'],
  [/^entretien|^reparation|^petits? travaux/, 'entretien'],
  [/^loyer|^recette/, 'loyer'],
  [/^frais bancaires?|^frais financiers?|^banque/, 'frais_bancaires'],
  [/^meubles?|^mobilier|^equipement/, 'mobilier'],
  [/^assurance|^pno|^gli/, 'assurance'],
  [/^gestion|^agence|^honoraires/, 'gestion'],
  [/^interets?/, 'interets'],
  [/^travaux/, 'travaux'],
  [/^autres?/, 'autre'],
];

/** Catégorie du fichier (libellés Immo-Zen ou proches) → catégorie ; null si non reconnue. */
export function matchCategory(v: Cell): ExpenseCategory | null {
  if (v === null || v === '') return null;
  const n = norm(String(v));
  for (const [k, label] of Object.entries(EXPENSE_CATEGORY_LABELS) as [ExpenseCategory, string][]) if (norm(label) === n || k === n) return k;
  for (const [re, cat] of CATEGORY_SYNONYMS) if (re.test(n)) return cat;
  return null;
}

/** Catégorie devinée d'après le libellé bancaire, quand la colonne Catégorie est vide. */
export function guessCategory(label: string, amount: number): ExpenseCategory | null {
  const n = norm(label);
  if (amount > 0 && /loyer|caf|apl/.test(n)) return 'loyer';
  if (/\b(sdc|syndic|syndicat|copro)/.test(n)) return 'copropriete';
  if (/taxe fonciere|dgfip|impots? foncier/.test(n)) return 'taxe_fonciere';
  if (/echeance (de )?pret|pret immo|remboursement pret/.test(n)) return 'credit';
  if (/frais|commission|cotisation carte|tenue de compte/.test(n) && amount < 0 && Math.abs(amount) < 100) return 'frais_bancaires';
  return null;
}

/** Bien correspondant à la colonne « Appartement » (adresse ou titre) ; null si ambigu. */
export function matchProperty(v: Cell, properties: Pick<Property, 'id' | 'title' | 'address' | 'zip' | 'city'>[]): string | null {
  if (v === null || !properties.length) return null;
  const target = norm(String(v));
  if (!target) return null;
  const words = new Set(target.split(' ').filter((w) => w.length > 1 || /\d/.test(w)));
  let best: { id: string; score: number } | null = null;
  let tie = false;
  for (const p of properties) {
    const hay = norm([p.title, p.address, p.zip, p.city].filter(Boolean).join(' '));
    if (hay === target || norm(p.title) === target) return p.id;
    const hw = new Set(hay.split(' '));
    let common = 0;
    for (const w of words) if (hw.has(w)) common++;
    const score = words.size ? common / words.size : 0;
    if (!best || score > best.score) { best = { id: p.id, score }; tie = false; } else if (score === best.score) tie = true;
  }
  return best && best.score >= 0.6 && !tie ? best.id : null;
}

// ---------------------------------------------------------------- lignes

export interface ImportRow {
  line: number;
  date: string | null;
  label: string;
  account: string | null;
  /** Montant signé du relevé : négatif = dépense, positif = recette. */
  signed: number | null;
  rawCategory: string | null;
  category: ExpenseCategory | null;
  notes: string | null;
  rawProperty: string | null;
  propertyId: string | null;
  /** Durée d'amortissement (colonne facultative « Durée d'amortissement »). */
  years: number | null;
  ref: string;
  errors: string[];
}

const HEADER_MATCH: [Field, RegExp][] = [
  ['date', /^date/],
  ['label', /^libelle|^label|^intitule|^description|^operation/],
  ['account', /^compte/],
  ['amount', /^montant|^debit credit|^valeur/],
  ['category', /^categorie|^rubrique/],
  ['notes', /^commentaire|^note|^remarque/],
  ['property', /^appartement|^bien|^logement|^adresse|^lot/],
  ['years', /^duree|amortissement/],
];

/** Repère la ligne d'en-têtes et la position de chaque colonne. */
export function detectColumns(rows: Cell[][]): { header: number; map: Partial<Record<Field, number>> } | null {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const map: Partial<Record<Field, number>> = {};
    rows[r]!.forEach((c, i) => {
      if (typeof c !== 'string') return;
      const n = norm(c);
      for (const [f, re] of HEADER_MATCH) if (map[f] === undefined && re.test(n)) { map[f] = i; break; }
    });
    if (map.date !== undefined && map.amount !== undefined) return { header: r, map };
  }
  return null;
}

/** Empreinte stable d'une ligne (cyrb53) : même relevé réimporté = mêmes empreintes. */
export function lineHash(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function buildImportRows(rows: Cell[][], properties: Pick<Property, 'id' | 'title' | 'address' | 'zip' | 'city'>[]): { rows: ImportRow[]; error?: string } {
  const det = detectColumns(rows);
  if (!det) return { rows: [], error: 'En-têtes introuvables : la première ligne doit contenir au moins « Date » et « Montant ».' };
  const { header, map } = det;
  const get = (r: Cell[], f: Field): Cell => (map[f] === undefined ? null : r[map[f]!] ?? null);
  const seen = new Map<string, number>();
  const propCache = new Map<string, string | null>();
  const out: ImportRow[] = [];
  rows.slice(header + 1).forEach((r, i) => {
    const errors: string[] = [];
    const date = parseDate(get(r, 'date'));
    const signed = parseAmount(get(r, 'amount'));
    const label = String(get(r, 'label') ?? '').replace(/\s+/g, ' ').trim();
    const account = get(r, 'account') === null ? null : String(get(r, 'account')).trim();
    if (!date) errors.push('date illisible');
    if (signed === null) errors.push('montant illisible');
    else if (signed === 0) errors.push('montant nul');
    const rawCategory = get(r, 'category') === null ? null : String(get(r, 'category'));
    const category = matchCategory(rawCategory) ?? (signed !== null ? guessCategory(label, signed) : null);
    if (rawCategory && !matchCategory(rawCategory)) errors.push(`catégorie « ${rawCategory} » à choisir`);
    const rawProperty = get(r, 'property') === null ? null : String(get(r, 'property')).trim();
    const pk = rawProperty ? norm(rawProperty) : '';
    if (!propCache.has(pk)) propCache.set(pk, rawProperty ? matchProperty(rawProperty, properties) : properties.length === 1 ? properties[0]!.id : null);
    const base = lineHash([date, norm(label), signed, norm(account ?? '')].join('|'));
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.push({
      line: header + i + 2, date, label, account, signed, rawCategory, category,
      notes: get(r, 'notes') === null ? null : String(get(r, 'notes')),
      rawProperty, propertyId: propCache.get(pk) ?? null,
      years: (() => { const y = parseAmount(get(r, 'years')); return y && y > 0 && y <= 50 ? y : null; })(),
      ref: `imp:${base}:${n}`, errors,
    });
  });
  return { rows: out };
}

export type ImportStatus = 'ok' | 'doublon' | 'incomplet' | 'signe';

/** État d'une ligne avant import. */
export function rowStatus(r: ImportRow, existingRefs: Set<string>): { status: ImportStatus; message: string } {
  if (existingRefs.has(r.ref)) return { status: 'doublon', message: 'Déjà importée' };
  if (!r.date || r.signed === null || r.signed === 0) return { status: 'incomplet', message: r.errors.join(', ') || 'Ligne incomplète' };
  if (!r.category) return { status: 'incomplet', message: 'Catégorie à choisir' };
  if (!r.propertyId) return { status: 'incomplet', message: 'Logement à choisir' };
  if (r.category === 'loyer' && r.signed < 0) return { status: 'signe', message: 'Loyer au débit : vérifiez (remboursement au locataire ?)' };
  if (r.category !== 'loyer' && r.signed > 0) return { status: 'signe', message: 'Montant crédité : remboursement ou recette ? Non importé par défaut' };
  return { status: 'ok', message: r.category === 'loyer' ? 'Recette' : 'Dépense' };
}

/** Ligne prête → dépense (ou recette « Loyer ») payée à la date du relevé. */
export function toExpense(r: ImportRow): Insert<Expense> {
  const category = r.category!;
  return {
    property_id: r.propertyId!,
    expense_date: r.date!,
    paid_on: r.date!,
    payment_status: 'paye',
    amount: Math.abs(r.signed!),
    category,
    nature: defaultNature(category),
    recoverable_amount: 0,
    label: r.label.slice(0, 300) || null,
    supplier: null,
    notes: r.notes?.slice(0, 2000) ?? null,
    account: r.account?.slice(0, 120) ?? null,
    import_ref: r.ref,
    document_id: null,
    ...(r.years ? { amortization_years: r.years } : {}),
  };
}
