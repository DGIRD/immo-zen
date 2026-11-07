/**
 * Syntaxe EDIFACT utilisée par EDI-TDFC (ISO 9735 version 3, jeu de caractères UNOL = ISO 8859-15).
 * Cahier des charges EDI-TDFC 2026, volume IV, § 4.2.4.2.
 *
 * Séparateurs imposés par la DGFiP : chaîne de service « UNA:+,? ' »
 *   :  séparateur de données constitutives
 *   +  séparateur de données
 *   ,  marque décimale
 *   ?  caractère suspensif (échappement)
 *   '  fin de segment
 */

export const UNA = "UNA:+,? '";

/** Une donnée simple (string) ou composite (liste de données constitutives). */
export type Element = string | (string | undefined)[] | undefined;

/** Échappe les caractères de service dans une valeur alphanumérique (après conversion typographique). */
export function escape(v: string): string {
  return toLatin9Text(v).replace(/[?:+']/g, (c) => `?${c}`);
}

/** Retire les données vides en fin de composite et en fin de segment (règle EDIFACT de troncature). */
function trimEnd<T>(xs: T[], empty: (x: T) => boolean): T[] {
  let n = xs.length;
  while (n > 0 && empty(xs[n - 1] as T)) n--;
  return xs.slice(0, n);
}

/** Construit un segment : étiquette + données, terminé par l'apostrophe. */
export function segment(tag: string, ...elements: Element[]): string {
  const parts = elements.map((e) => {
    if (e === undefined) return '';
    if (typeof e === 'string') return escape(e);
    return trimEnd(e.map((c) => (c === undefined ? '' : escape(c))), (c) => c === '').join(':');
  });
  return [tag, ...trimEnd(parts, (p) => p === '')].join('+') + "'";
}

/**
 * Montant TDFC : euros sans centimes (troncature, aucun arrondi), sans signe.
 * Vol. IV § 4.2.2.4 : zéro significatif → statut 62, négatif → statut 65.
 */
export function amount(v: number): { value: string; status?: '62' | '65' } {
  const t = Math.trunc(v);
  if (t === 0) return { value: '0', status: '62' };
  if (t < 0) return { value: String(-t), status: '65' };
  return { value: String(t) };
}

/** Caractères acceptés par ISO 8859-15 et leur octet. € = A4 (et non 80 comme sous Windows). */
const LATIN9_SPECIAL: Record<string, number> = {
  '€': 0xa4, 'Š': 0xa6, 'š': 0xa8, 'Ž': 0xb4, 'ž': 0xb8, 'Œ': 0xbc, 'œ': 0xbd, 'Ÿ': 0xbe,
};
const LATIN1_REPLACED = new Set([0xa4, 0xa6, 0xa8, 0xb4, 0xb8, 0xbc, 0xbd, 0xbe]);

export function latin9Byte(ch: string): number | null {
  const special = LATIN9_SPECIAL[ch];
  if (special !== undefined) return special;
  const code = ch.codePointAt(0) ?? -1;
  if (code >= 0x20 && code <= 0x7e) return code;
  if (code >= 0xa0 && code <= 0xff && !LATIN1_REPLACED.has(code)) return code;
  return null;
}

/** Caractères absents d'ISO 8859-15 (ils provoqueraient un rejet syntaxique CONTRL). */
export function invalidLatin9(text: string): string[] {
  const bad = new Set<string>();
  for (const ch of text) if (latin9Byte(ch) === null) bad.add(ch);
  return [...bad];
}

/** Remplace les caractères typographiques courants par leur équivalent ISO 8859-15. */
export function toLatin9Text(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[  ]/g, ' ');
}

/** Encode l'interchange en ISO 8859-15. Lève une erreur si un caractère n'est pas représentable. */
export function encodeLatin9(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const b = latin9Byte(ch);
    if (b === null) throw new Error(`Caractère non autorisé en ISO 8859-15 : « ${ch} »`);
    out.push(b);
  }
  return Uint8Array.from(out);
}
