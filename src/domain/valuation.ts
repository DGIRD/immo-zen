/**
 * Estimation de la valeur d'un bien par les ventes publiques DVF.
 * 1. localisation de l'adresse (Base Adresse Nationale) → code commune et coordonnées ;
 * 2. lecture des fichiers DVF de la commune dans le navigateur, sinon par la fonction serveur « dvf » ;
 * 3. fourchette : 1er et 3e quartiles du prix au m² des ventes comparables × surface.
 */
import type { Property } from '../data/types.ts';
import { GEOCODE_URL } from './address.ts';
import { dvfYears, estimate, loadSales, type DvfEstimate, type DvfType } from '../../supabase/functions/_shared/dvf.ts';

export type { DvfEstimate };

export interface Located { citycode: string; lat: number | null; lon: number | null; label: string; precise: boolean }

export async function locate(address: string | null | undefined, zip: string | null | undefined, city: string | null | undefined, fetchImpl: typeof fetch = fetch): Promise<Located | null> {
  const q = [address, zip, city].filter(Boolean).join(' ').trim();
  if (q.length < 3) return null;
  const res = await fetchImpl(`${GEOCODE_URL}?${new URLSearchParams({ q, limit: '1' })}`);
  if (!res.ok) throw new Error('Service d’adresses indisponible.');
  const f = ((await res.json()) as { features?: { geometry?: { coordinates?: [number, number] }; properties: { citycode?: string; label?: string; type?: string } }[] }).features?.[0];
  if (!f?.properties.citycode) return null;
  const precise = f.properties.type === 'housenumber' || f.properties.type === 'street';
  const [lon, lat] = f.geometry?.coordinates ?? [];
  return { citycode: f.properties.citycode, lat: precise && lat != null ? lat : null, lon: precise && lon != null ? lon : null, label: f.properties.label ?? q, precise };
}

export function dvfType(t: Property['property_type'] | null | undefined): DvfType | null {
  return t === 'appartement' ? 'Appartement' : t === 'maison' ? 'Maison' : null;
}

export interface ValuationInput {
  address?: string | null; zip?: string | null; city?: string | null;
  property_type?: Property['property_type'] | null; surface?: number | null;
}

/** Erreur explicative (affichée telle quelle). */
export class ValuationError extends Error {}

export async function valuate(
  input: ValuationInput,
  today: string,
  server: ((p: { citycode: string; type: DvfType; surface: number; lat: number | null; lon: number | null }) => Promise<DvfEstimate | null>) | null,
  fetchImpl: typeof fetch = fetch,
): Promise<{ estimate: DvfEstimate; place: Located }> {
  const type = dvfType(input.property_type);
  if (!type) throw new ValuationError('L’estimation DVF concerne les appartements et les maisons.');
  if (!(input.surface && input.surface > 0)) throw new ValuationError('Renseignez la surface du logement.');
  const place = await locate(input.address, input.zip, input.city, fetchImpl).catch(() => null);
  if (!place) throw new ValuationError('Adresse introuvable : renseignez au moins le code postal et la ville.');
  const payload = { citycode: place.citycode, type, surface: input.surface, lat: place.lat, lon: place.lon };
  let est: DvfEstimate | null;
  try {
    est = estimate(await loadSales(place.citycode, dvfYears(today), fetchImpl), payload);
  } catch (e) {
    // fichiers illisibles depuis le navigateur (réseau, sécurité du navigateur) : calcul par le serveur
    if (!server) throw new ValuationError('Données DVF inaccessibles depuis ce navigateur.');
    est = await server(payload);
    void e;
  }
  if (!est) throw new ValuationError('Trop peu de ventes comparables dans le secteur pour une estimation fiable.');
  return { estimate: est, place };
}
