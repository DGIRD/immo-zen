// Immo-Zen – lecture d'une annonce immobilière : caractéristiques du bien extraites d'une page web
// (données structurées JSON-LD, balises Open Graph, puis texte) ou d'un texte collé.
// Partagé entre le navigateur (texte collé) et la fonction serveur « annonce » (page téléchargée).
// Aucune dépendance : fonctionne sous Deno et dans le navigateur.

export type ListingType = 'appartement' | 'maison' | 'immeuble' | 'parking' | 'local' | 'terrain' | 'autre';
export type ListingSource = 'données structurées' | 'balises de la page' | 'texte de l’annonce' | 'lecture assistée';

export interface ListingData {
  title: string | null;
  /** Prix affiché, frais d'agence inclus (FAI). */
  price: number | null;
  surface: number | null;
  rooms: number | null;
  bedrooms: number | null;
  property_type: ListingType | null;
  zip: string | null;
  city: string | null;
  address: string | null;
  dpe: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | null;
  /** Charges de copropriété, par an. */
  copro_charges_annual: number | null;
  /** Taxe foncière, par an. */
  property_tax_annual: number | null;
  /** Honoraires d'agence à la charge de l'acquéreur, en montant. */
  agency_fees: number | null;
  floor: number | null;
  furnished: boolean | null;
  description: string | null;
  /** Origine de chaque valeur trouvée. */
  sources: Partial<Record<ListingField, ListingSource>>;
}
export type ListingField = Exclude<keyof ListingData, 'sources'>;

export const LISTING_FIELDS: ListingField[] = ['title', 'price', 'surface', 'rooms', 'bedrooms', 'property_type', 'zip', 'city', 'address', 'dpe',
  'copro_charges_annual', 'property_tax_annual', 'agency_fees', 'floor', 'furnished', 'description'];

export const emptyListing = (): ListingData => ({
  title: null, price: null, surface: null, rooms: null, bedrooms: null, property_type: null, zip: null, city: null, address: null, dpe: null,
  copro_charges_annual: null, property_tax_annual: null, agency_fees: null, floor: null, furnished: null, description: null, sources: {},
});

// ---------------------------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------------------------
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â',
  ccedil: 'ç', ocirc: 'ô', ucirc: 'û', ugrave: 'ù', icirc: 'î', iuml: 'ï', euml: 'ë', sup2: '²', euro: '€', rsquo: '’', laquo: '«', raquo: '»', deg: '°' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e: string) => {
    if (e[0] === '#') { const n = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Texte lisible d'une page HTML (scripts, styles et balises retirés). */
export function htmlToText(html: string): string {
  return decodeEntities(html
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article|dd|dt)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t  ]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** « 245 000 € », « 245.000€ », « 1 250,50 » → nombre. */
export function parseAmount(s: string | number | null | undefined): number | null {
  if (s === null || s === undefined) return null;
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  let t = s.replace(/[\s  €]/g, '').replace(/eur(os?)?$/i, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, ''); // 245.000 ou 1.250,50
  t = t.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const clean = (s: string | null | undefined, max = 300) => { const t = (s ?? '').replace(/\s+/g, ' ').trim(); return t ? t.slice(0, max) : null; };
const NUM = String.raw`(\d{1,3}(?:[   .]\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)`;

// plages de vraisemblance : une valeur hors plage est ignorée (ex. un numéro de téléphone pris pour un prix)
const PLAUSIBLE = {
  price: [5_000, 50_000_000], surface: [5, 5_000], rooms: [1, 50], bedrooms: [0, 40], copro: [0, 50_000], tax: [0, 50_000], fees: [0, 500_000], floor: [-3, 80],
} as const;
const within = (n: number | null, [a, b]: readonly [number, number]) => (n !== null && n >= a && n <= b ? n : null);

export function guessType(s: string): ListingType | null {
  const t = norm(s);
  if (/\b(appartement|appart|studio|duplex|triplex|loft|t[1-9]\b|f[1-9]\b)/.test(t)) return 'appartement';
  if (/\b(maison|villa|pavillon|longere|longère|mas|chalet|corps de ferme)/.test(t)) return 'maison';
  if (/\bimmeuble\b/.test(t)) return 'immeuble';
  if (/\b(parking|garage|box|stationnement)\b/.test(t)) return 'parking';
  if (/\b(local commercial|local professionnel|bureau|boutique|fonds de commerce|entrepot)\b/.test(t)) return 'local';
  if (/\bterrain\b/.test(t)) return 'terrain';
  return null;
}

// ---------------------------------------------------------------------------------------------
// Données structurées (JSON-LD schema.org) et balises meta
// ---------------------------------------------------------------------------------------------
type Json = Record<string, unknown>;
function jsonLdNodes(html: string): Json[] {
  const out: Json[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    try {
      const walk = (v: unknown) => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') {
          out.push(v as Json);
          const o = v as Json;
          for (const k of ['@graph', 'mainEntity', 'itemOffered', 'offers', 'object', 'about']) if (o[k]) walk(o[k]);
        }
      };
      walk(JSON.parse(decodeEntities(m[1]!.trim())));
    } catch { /* bloc illisible */ }
  }
  return out;
}
const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);
const qv = (v: unknown): number | null => {
  if (v && typeof v === 'object') { const o = v as Json; return parseAmount(str(o.value) ?? str(o.minValue)); }
  return parseAmount(str(v));
};

function fromJsonLd(html: string, d: ListingData) {
  const S: ListingSource = 'données structurées';
  const set = <K extends ListingField>(k: K, v: ListingData[K] | null) => { if (v !== null && v !== undefined && d[k] === null) { d[k] = v; d.sources[k] = S; } };
  for (const o of jsonLdNodes(html)) {
    const types = ([] as unknown[]).concat(o['@type'] ?? []).map((x) => String(x).toLowerCase());
    if (types.some((t) => /breadcrumb|organization|website|webpage|person|searchaction|imageobject/.test(t)) && !o.floorSize && !o.offers) continue;
    if (types.some((t) => /offer|product|residence|apartment|house|singlefamily|accommodation|realestatelisting|place/.test(t)) || o.floorSize || o.numberOfRooms) {
      set('title', clean(str(o.name)));
      const price = within(parseAmount(str(o.price)) ?? qv(o.priceSpecification), PLAUSIBLE.price);
      set('price', price);
      set('surface', within(qv(o.floorSize), PLAUSIBLE.surface));
      set('rooms', within(qv(o.numberOfRooms), PLAUSIBLE.rooms));
      set('bedrooms', within(qv(o.numberOfBedrooms), PLAUSIBLE.bedrooms));
      const addr = o.address as Json | undefined;
      if (addr && typeof addr === 'object') {
        set('zip', clean(str(addr.postalCode), 5)?.match(/^\d{5}$/)?.[0] ?? null);
        set('city', clean(str(addr.addressLocality), 100));
        set('address', clean(str(addr.streetAddress), 200));
      }
      const t = types.find((x) => /apartment|house|singlefamily/.test(x));
      if (t) set('property_type', /apartment/.test(t) ? 'appartement' : 'maison');
      set('description', clean(str(o.description), 2000));
    }
  }
}

function meta(html: string, name: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name.replace(/[.:]/g, '\\$&')}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  const v = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return v ? clean(decodeEntities(v), 2000) : null;
}

function fromMeta(html: string, d: ListingData) {
  const S: ListingSource = 'balises de la page';
  const set = <K extends ListingField>(k: K, v: ListingData[K] | null) => { if (v !== null && v !== undefined && d[k] === null) { d[k] = v; d.sources[k] = S; } };
  const title = meta(html, 'og:title') ?? clean(decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''), 200);
  set('title', title);
  set('price', within(parseAmount(meta(html, 'product:price:amount') ?? meta(html, 'og:price:amount')), PLAUSIBLE.price));
  set('description', meta(html, 'og:description') ?? meta(html, 'description'));
}

// ---------------------------------------------------------------------------------------------
// Texte de l'annonce (expressions usuelles des annonces françaises)
// ---------------------------------------------------------------------------------------------
function fromText(text: string, d: ListingData) {
  const S: ListingSource = 'texte de l’annonce';
  const set = <K extends ListingField>(k: K, v: ListingData[K] | null) => { if (v !== null && v !== undefined && d[k] === null) { d[k] = v; d.sources[k] = S; } };
  const t = text.replace(/[  ]/g, ' ');
  const first = (re: RegExp) => t.match(re);

  // surface : « 45 m² », « 45,5 m2 », « surface habitable : 45 m² » (la surface habitable passe avant le terrain)
  const surfaces = [...t.matchAll(new RegExp(`(?:(surface habitable|surface|superficie|habitable)\\s*:?\\s*)?${NUM}\\s*(?:m²|m2|m\\s?²|mètres? carrés?)(?!\\s*de terrain)`, 'gi'))];
  const s = surfaces.find((m) => m[1]) ?? surfaces.find((m) => !/terrain/i.test(t.slice(Math.max(0, (m.index ?? 0) - 25), m.index ?? 0)));
  if (s) set('surface', within(parseAmount(s[2]!), PLAUSIBLE.surface));

  // prix : libellé explicite d'abord, puis montant en euros le plus grand et plausible
  const labelled = first(new RegExp(`(?:prix(?: de vente)?|vendu à|à vendre|tarif)\\s*(?:fai|net vendeur|honoraires inclus)?\\s*:?\\s*${NUM}\\s*(?:€|eur|euros)`, 'i'));
  let price = labelled ? within(parseAmount(labelled[1]!), PLAUSIBLE.price) : null;
  if (price === null) {
    const amounts = [...t.matchAll(new RegExp(`${NUM}\\s*(?:€|eur\\b|euros)(?!\\s*(?:/|par)\\s*(?:mois|an|m²|m2))`, 'gi'))]
      .filter((m) => !/(charges|taxe|honoraires|loyer|frais|mensualit)/i.test(t.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0)))
      .map((m) => within(parseAmount(m[1]!), PLAUSIBLE.price)).filter((n): n is number => n !== null);
    if (amounts.length) price = Math.max(...amounts);
  }
  set('price', price);

  // pièces et chambres
  const rooms = first(/(\d{1,2})\s*pi[eè]ces?\b/i) ?? first(/\b[TF]([1-9])\b/);
  if (rooms) set('rooms', within(Number(rooms[1]), PLAUSIBLE.rooms));
  else if (/\bstudio\b/i.test(t)) set('rooms', 1);
  const bed = first(/(\d{1,2})\s*chambres?\b/i);
  if (bed) set('bedrooms', within(Number(bed[1]), PLAUSIBLE.bedrooms));

  // DPE : « DPE : D », « classe énergie D », « Diagnostic de performance énergétique (DPE) : C »
  const dpe = first(/(?:dpe|classe [ée]nerg[ée]tique|classe [ée]nergie|consommation [ée]nerg[ée]tique|performance [ée]nerg[ée]tique)\s*(?:\(dpe\))?\s*(?:vierge|:|-|=)?\s*(?:classe\s*)?([A-G])\b/i);
  if (dpe) set('dpe', dpe[1]!.toUpperCase() as ListingData['dpe']);

  // charges de copropriété : annuelles, ou mensuelles × 12
  const copro = first(new RegExp(`(?:charges(?: de copropri[ée]t[ée])?|charges courantes|quote-part)[^\\d\\n]{0,40}?${NUM}\\s*(?:€|eur|euros)?\\s*(?:/|par)?\\s*(an|année|annuel(?:les)?|mois|mensuel(?:les)?|trimestre)?`, 'i'));
  if (copro && /copropri|charges/i.test(copro[0])) {
    const n = parseAmount(copro[1]!);
    const per = norm(copro[2] ?? (/(?:\/|par)\s*mois|mensuel/i.test(copro[0]) ? 'mois' : 'an'));
    const annual = n === null ? null : per.startsWith('mois') || per.startsWith('mensuel') ? n * 12 : per.startsWith('trimestre') ? n * 4 : n;
    set('copro_charges_annual', within(annual === null ? null : Math.round(annual), PLAUSIBLE.copro));
  }

  const tax = first(new RegExp(`taxe fonci[eè]re[^\\d\\n]{0,25}?${NUM}\\s*(?:€|eur|euros)?`, 'i'));
  if (tax) set('property_tax_annual', within(parseAmount(tax[1]!), PLAUSIBLE.tax));

  const fees = first(new RegExp(`honoraires[^\\d\\n%]{0,60}?${NUM}\\s*(?:€|eur|euros)`, 'i'));
  if (fees && !/vendeur/i.test(fees[0])) set('agency_fees', within(parseAmount(fees[1]!), PLAUSIBLE.fees));

  const floor = first(/(\d{1,2})\s*(?:er|e|ème|eme)\s*[ée]tage/i) ?? (/\brez[- ]de[- ]chauss[ée]e\b/i.test(t) ? ['', '0'] as unknown as RegExpMatchArray : null);
  if (floor) set('floor', within(Number(floor[1]), PLAUSIBLE.floor));

  if (/\b(meubl[ée]e?s?|vendu meubl)/i.test(t) && !/\bnon meubl/i.test(t)) set('furnished', true);

  // code postal et ville : « 75011 Paris », « Paris (75011) », « Lyon 3e (69003) »
  const zc = first(/\b(\d{5})\s+([A-ZÉÈÀÂÎÔ][A-Za-zÀ-ÿ'’\- ]{1,40}?)(?=\s*(?:\n|,|\(|$|\s{2}|\d|-))/) ;
  const cz = first(/([A-ZÉÈÀÂÎÔ][A-Za-zÀ-ÿ0-9'’\- ]{1,40}?)\s*\((\d{5})\)/);
  if (cz) { set('city', clean(cz[1], 100)); set('zip', cz[2]!); }
  else if (zc) { set('zip', zc[1]!); set('city', clean(zc[2], 100)); }
  else {
    const dep = first(/([A-ZÉÈÀÂÎÔ][A-Za-zÀ-ÿ'’\- ]{1,40}?)\s*\((\d{2})\)/);
    if (dep) set('city', clean(dep[1], 100));
  }

  set('property_type', guessType(d.title ?? '') ?? guessType(t.slice(0, 600)));
  if (!d.title) { const line = t.split('\n').map((x) => x.trim()).find((x) => x.length > 8 && x.length < 140 && guessType(x)); set('title', clean(line, 200)); }
  if (!d.description) set('description', clean(t, 2000));
}

/** Lit une page d'annonce (HTML) ou un texte collé. Les données structurées priment sur le texte. */
export function parseListing(input: { html?: string; text?: string }): ListingData {
  const d = emptyListing();
  if (input.html) {
    fromJsonLd(input.html, d);
    fromMeta(input.html, d);
    fromText(htmlToText(input.html), d);
  }
  if (input.text) fromText(input.text, d);
  // un titre générique de site (« Annonce immobilière… ») n'apporte rien
  if (d.title && /^(annonce|vente|achat)s?\b.{0,20}$/i.test(d.title)) { d.title = null; delete d.sources.title; }
  return d;
}

/** Nombre de caractéristiques utiles trouvées (hors titre et description). */
export function listingScore(d: ListingData): number {
  return (['price', 'surface', 'rooms', 'property_type', 'zip', 'city', 'dpe', 'copro_charges_annual', 'property_tax_annual'] as const).filter((k) => d[k] !== null).length;
}

/** Complète `base` avec les valeurs de `extra` pour les champs restés vides. */
export function mergeListing(base: ListingData, extra: Partial<ListingData>, source: ListingSource): ListingData {
  const out: ListingData = { ...base, sources: { ...base.sources } };
  for (const k of LISTING_FIELDS) {
    const v = extra[k];
    if (out[k] === null && v !== null && v !== undefined && v !== '') { (out as unknown as Record<string, unknown>)[k] = v; out.sources[k] = source; }
  }
  return out;
}

/** Valide une réponse de lecture assistée (JSON) avant de l'utiliser. */
export function sanitizeListing(raw: unknown): Partial<ListingData> {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  const n = (k: string, r: readonly [number, number]) => within(parseAmount(str(o[k])), r);
  const types: ListingType[] = ['appartement', 'maison', 'immeuble', 'parking', 'local', 'terrain', 'autre'];
  const dpe = typeof o.dpe === 'string' && /^[A-G]$/i.test(o.dpe) ? o.dpe.toUpperCase() as ListingData['dpe'] : null;
  return {
    title: clean(str(o.title), 200), price: n('price', PLAUSIBLE.price), surface: n('surface', PLAUSIBLE.surface), rooms: n('rooms', PLAUSIBLE.rooms),
    bedrooms: n('bedrooms', PLAUSIBLE.bedrooms), property_type: types.includes(o.property_type as ListingType) ? o.property_type as ListingType : null,
    zip: typeof o.zip === 'string' && /^\d{5}$/.test(o.zip) ? o.zip : null, city: clean(str(o.city), 100), address: clean(str(o.address), 200), dpe,
    copro_charges_annual: n('copro_charges_annual', PLAUSIBLE.copro), property_tax_annual: n('property_tax_annual', PLAUSIBLE.tax),
    agency_fees: n('agency_fees', PLAUSIBLE.fees), floor: n('floor', PLAUSIBLE.floor), furnished: typeof o.furnished === 'boolean' ? o.furnished : null,
  };
}

export const LISTING_AI_PROMPT = `Tu lis une annonce immobilière française. Réponds uniquement par un objet JSON, sans texte autour, avec ces clés (null si l'annonce ne le dit pas, n'invente rien) :
title (titre court), price (prix de vente affiché en euros, honoraires inclus), surface (surface habitable en m²), rooms (nombre de pièces), bedrooms,
property_type (appartement, maison, immeuble, parking, local, terrain ou autre), zip (code postal à 5 chiffres), city, address (rue si indiquée),
dpe (lettre A à G), copro_charges_annual (charges de copropriété par an, en euros), property_tax_annual (taxe foncière par an), agency_fees (honoraires à la charge de l'acquéreur, en euros),
floor (étage, 0 pour rez-de-chaussée), furnished (true ou false).`;
