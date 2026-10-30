/**
 * Calcul du loyer de marché d'un bien : localisation (Base Adresse Nationale), lecture des indicateurs
 * et des plafonds de la commune, puis calcul. Dépendances injectées : testé dans tests/marketRent.test.ts.
 */
import type { PropertyType } from '../data/types.ts';
import type { RentData } from '../data/market.ts';
import type { Located } from './valuation.ts';
import {
  arrondissementCode, CAP_STATUS_LABELS, computeMarketRent, ENCADRED_INSEE, findCap, pickIndicator, segmentFor,
  type CapStatus, type MarketRent,
} from './marketRent.ts';

export interface LookupInput {
  address?: string | null; zip?: string | null; city?: string | null;
  property_type?: PropertyType | null; rooms?: number | null; surface?: number | null;
  furnished?: boolean | null; furnishedCoef?: number | null; construction_year?: number | null; rent_zone?: string | null;
  chargesMonthly?: number | null;
}

export interface LookupResult {
  mr: MarketRent;
  insee: string;
  capStatus: CapStatus;
  capMessage: string | null;
  zones: string[];
  /** Territoire encadré dont les plafonds ne sont pas chargés. */
  encadreSansPlafond: string | null;
}

/** Erreur explicative (affichée telle quelle). */
export class MarketRentError extends Error {}

/** Caractéristiques qui déterminent le calcul : un changement relance le calcul automatique. */
export function lookupKey(i: LookupInput): string {
  return JSON.stringify([i.address ?? '', i.zip ?? '', i.city ?? '', i.property_type ?? '', i.rooms ?? null, i.surface ?? null, !!i.furnished,
    i.furnished ? i.furnishedCoef ?? null : null, i.construction_year ?? null, i.rent_zone ?? null, i.chargesMonthly ?? null]);
}

/** Ce qui manque pour lancer le calcul (null : tout est renseigné). */
export function missingForLookup(i: LookupInput): string | null {
  if (!segmentFor(i.property_type, i.rooms)) return 'Le loyer de marché concerne les appartements et les maisons.';
  if (!(i.surface && i.surface > 0)) return 'Renseignez la surface pour obtenir le loyer de marché.';
  if (!i.city?.trim() && !i.zip?.trim()) return 'Renseignez l’adresse (au moins le code postal et la ville) pour obtenir le loyer de marché.';
  return null;
}

export async function lookupMarketRent(i: LookupInput, today: string, deps: {
  locate: (address: string | null | undefined, zip: string | null | undefined, city: string | null | undefined) => Promise<Located | null>;
  rentData: (insees: string[]) => Promise<RentData | null>;
}): Promise<LookupResult> {
  const missing = missingForLookup(i);
  if (missing) throw new MarketRentError(missing);
  const place = await deps.locate(i.address, i.zip, i.city).catch(() => null);
  if (!place) throw new MarketRentError('Adresse introuvable : vérifiez le code postal et la ville.');
  const arr = arrondissementCode(place.citycode, i.zip);
  const codes = arr ? [arr, place.citycode] : [place.citycode];
  const data = await deps.rentData(codes);
  if (!data) throw new MarketRentError('Loyers de marché indisponibles : la base de données n’est pas à jour (migration du 30/10/2026 à exécuter).');
  const segment = segmentFor(i.property_type, i.rooms)!;
  const insee = codes.find((c) => data.indicators.some((r) => r.insee === c)) ?? codes[0]!;
  const picked = pickIndicator(data.indicators.filter((r) => r.insee === insee), segment);
  if (!picked) throw new MarketRentError(data.indicators.length
    ? 'Pas d’indicateur de loyer pour ce type de logement dans cette commune : saisissez la fourchette à la main.'
    : 'Aucun indicateur de loyer pour cette commune (Carte des loyers non chargée ou commune inconnue) : saisissez la fourchette à la main.');
  const caps = data.caps.filter((c) => c.insee === insee);
  const found = findCap(caps, { zone: i.rent_zone ?? null, rooms: i.rooms ?? null, year: i.construction_year ?? null, furnished: !!i.furnished, today });
  const mr = computeMarketRent({
    indicator: picked.indicator, fallback: picked.fallback, surface: i.surface!, furnished: !!i.furnished,
    furnishedCoef: i.furnishedCoef ?? data.config.furnished_coef, chargesMonthly: i.chargesMonthly ?? null, cap: found.cap,
    wideThreshold: data.config.rent_wide_threshold,
  });
  const encadre = ENCADRED_INSEE[insee] ?? ENCADRED_INSEE[place.citycode] ?? null;
  return {
    mr, insee, capStatus: found.status, zones: found.zones,
    capMessage: found.status === 'ok' || found.status === 'none' ? null : CAP_STATUS_LABELS[found.status],
    encadreSansPlafond: found.status === 'none' && encadre ? encadre : null,
  };
}
