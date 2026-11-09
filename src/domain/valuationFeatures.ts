/**
 * Ajustement de l'estimation DVF selon les caractéristiques du bien.
 * Les ventes DVF ne disent rien de l'étage, de l'état, de l'extérieur ou du DPE : l'estimation de base reflète
 * un bien « moyen » du secteur. Chaque caractéristique déclarée applique un écart publié par une étude,
 * toutes choses égales par ailleurs quand l'étude le permet. Écarts indicatifs, plafonnés à ±25 % au total.
 */
export type Dpe = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

export interface EstimateFeatures {
  floor?: 'rdc' | 'bas' | 'haut' | null;
  elevator?: boolean | null;
  outdoor?: 'aucun' | 'balcon' | 'jardin' | null;
  parking?: boolean | null;
  condition?: 'a_renover' | 'bon' | 'renove' | null;
  dpe?: Dpe | null;
}

export interface FeatureAdjustment { key: keyof EstimateFeatures | 'ascenseur'; label: string; pct: number; source: string }

const NOTAIRES_2019 = 'Notaires de France, valorisation des caractéristiques des biens (ventes 2017-2018, hors Île-de-France)';
const NOTAIRES_DPE = 'Notaires de France, valeur verte des logements (appartements, écart avec un DPE D)';
const CASAVO = 'Étude Casavo 2025 (écart moyen biens rénovés / non rénovés : +9 % en France, +12,5 % à Paris)';
const ETAGE = 'Études Liberkeys et Casavo à Paris (rez-de-chaussée −4 à −6 %), Notaires de France à Lyon (4e et plus avec ascenseur +8 %)';

const DPE_PCT: Record<Dpe, number> = { A: 16, B: 12, C: 6, D: 0, E: -4, F: -8, G: -12 };

export const MAX_TOTAL_PCT = 25;

/** Écarts à appliquer, dans l'ordre d'affichage ; seules les caractéristiques renseignées comptent. */
export function featureAdjustments(f: EstimateFeatures | null | undefined, ctx: { apartment: boolean; paris: boolean }): FeatureAdjustment[] {
  if (!f) return [];
  const out: FeatureAdjustment[] = [];
  if (f.dpe && DPE_PCT[f.dpe] !== 0) out.push({ key: 'dpe', label: `DPE ${f.dpe}`, pct: DPE_PCT[f.dpe], source: NOTAIRES_DPE });
  if (f.condition === 'a_renover') out.push({ key: 'condition', label: 'Travaux importants à prévoir', pct: -8, source: CASAVO });
  if (f.condition === 'renove') out.push({ key: 'condition', label: 'Rénové récemment', pct: 5, source: CASAVO });
  if (ctx.apartment) {
    if (f.floor === 'rdc') out.push({ key: 'floor', label: 'Rez-de-chaussée', pct: -5, source: ETAGE });
    if (f.floor === 'haut' && f.elevator === false) out.push({ key: 'ascenseur', label: '4e étage ou plus sans ascenseur', pct: -3, source: 'Étude Liberkeys à Paris (−2,6 % au 6e étage sans ascenseur)' });
    if (f.floor === 'haut' && f.elevator === true) out.push({ key: 'ascenseur', label: '4e étage ou plus avec ascenseur', pct: 3, source: ETAGE });
    if (f.outdoor === 'balcon' || f.outdoor === 'jardin') out.push({ key: 'outdoor', label: f.outdoor === 'balcon' ? 'Balcon ou terrasse' : 'Jardin privatif', pct: 6, source: NOTAIRES_2019 });
    if (f.parking && !ctx.paris) out.push({ key: 'parking', label: 'Parking ou garage', pct: 7, source: NOTAIRES_2019 });
  }
  return out;
}

/** Coefficient total (multiplicatif), plafonné à ±25 %. */
export function totalFactor(adj: FeatureAdjustment[]): number {
  const f = adj.reduce((t, a) => t * (1 + a.pct / 100), 1);
  return Math.min(1 + MAX_TOTAL_PCT / 100, Math.max(1 - MAX_TOTAL_PCT / 100, f));
}

export function applyFeatures(base: { low: number; median: number; high: number }, adj: FeatureAdjustment[]): { low: number; median: number; high: number; pct: number } {
  const k = totalFactor(adj);
  const r = (x: number) => Math.round((x * k) / 1000) * 1000;
  return { low: r(base.low), median: r(base.median), high: r(base.high), pct: Math.round((k - 1) * 1000) / 10 };
}

/** Avertissements réglementaires liés au DPE pour un bien destiné à la location (métropole). */
export function dpeRentalWarning(dpe: Dpe | null | undefined): string | null {
  if (dpe === 'G') return 'Logement classé G : il ne peut plus être loué depuis le 1er janvier 2025 (nouveau bail, renouvellement ou reconduction) sans travaux.';
  if (dpe === 'F') return 'Logement classé F : il ne pourra plus être loué à partir du 1er janvier 2028 sans travaux, et son loyer ne peut pas être augmenté.';
  if (dpe === 'E') return 'Logement classé E : il ne pourra plus être loué à partir du 1er janvier 2034 sans travaux.';
  return null;
}
