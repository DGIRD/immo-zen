/**
 * Saisie automatique des adresses : service public Géoplateforme de l'IGN (Base Adresse Nationale),
 * sans clé ni compte. Requêtes envoyées directement depuis le navigateur ; seul le texte saisi est transmis.
 * En cas d'indisponibilité, la saisie manuelle reste possible.
 */
export const GEOCODE_URL = 'https://data.geopf.fr/geocodage/search';
export const COMMUNES_URL = 'https://geo.api.gouv.fr/communes';

export interface AddressSuggestion { label: string; address: string; zip: string; city: string }

interface Feature { properties: { label?: string; name?: string; postcode?: string; city?: string; type?: string } }

export function parseSuggestions(json: unknown): AddressSuggestion[] {
  const features = (json as { features?: Feature[] } | null)?.features ?? [];
  const seen = new Set<string>();
  const out: AddressSuggestion[] = [];
  for (const f of features) {
    const p = f.properties ?? {};
    if (!p.postcode || !p.city) continue;
    // pour une commune seule, le nom est celui de la ville : pas d'adresse de rue
    const address = p.type === 'municipality' ? '' : (p.name ?? '');
    const key = `${address}|${p.postcode}|${p.city}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: p.label ?? `${address} ${p.postcode} ${p.city}`.trim(), address, zip: p.postcode, city: p.city });
  }
  return out;
}

export async function searchAddress(q: string, signal?: AbortSignal): Promise<AddressSuggestion[]> {
  const text = q.trim();
  if (text.length < 3) return [];
  const url = `${GEOCODE_URL}?${new URLSearchParams({ q: text, limit: '6', autocomplete: '1' })}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Service d’adresses indisponible (${res.status})`);
  return parseSuggestions(await res.json());
}

/** Communes d'un code postal (plusieurs possibles : à choisir). */
export async function citiesForZip(zip: string, signal?: AbortSignal): Promise<string[]> {
  if (!/^\d{5}$/.test(zip)) return [];
  const res = await fetch(`${COMMUNES_URL}?${new URLSearchParams({ codePostal: zip, fields: 'nom', format: 'json' })}`, { signal });
  if (!res.ok) return [];
  const list = await res.json() as { nom: string }[];
  return [...new Set(list.map((c) => c.nom))].sort((a, b) => a.localeCompare(b, 'fr'));
}
