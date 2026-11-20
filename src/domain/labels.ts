import type { Channel, ContactKind, EventKind, OccupationStatus, OwnershipMode, PropertyStatus, PropertyType, TaxRegime, PropertyUsage } from '../data/types.ts';

/** Statuts d'acquisition, dans l'ordre du parcours. */
export const STATUS_LABELS: Record<PropertyStatus, string> = {
  repere: 'Repéré',
  a_contacter: 'À contacter',
  informations_demandees: 'Informations demandées',
  visite_a_programmer: 'Visite à programmer',
  visite_programmee: 'Visite programmée',
  visite: 'Visité',
  offre_envisagee: 'Offre envisagée',
  offre_transmise: 'Offre transmise',
  negociation: 'Négociation',
  offre_acceptee: 'Offre acceptée',
  sous_compromis: 'Sous compromis',
  acquis: 'Acquis',
  refuse: 'Refusé',
  abandonne: 'Abandonné',
  archive: 'Archivé',
};
export const STATUS_ORDER = Object.keys(STATUS_LABELS) as PropertyStatus[];
/** Statuts proposés en prospection (« acquis » transfère vers Mes biens). */
export const PROSPECT_STATUSES = STATUS_ORDER;

export type StatusTone = 'early' | 'active' | 'hot' | 'won' | 'closed';
export function statusTone(s: PropertyStatus): StatusTone {
  if (s === 'acquis') return 'won';
  if (s === 'refuse' || s === 'abandonne' || s === 'archive') return 'closed';
  if (['offre_transmise', 'negociation', 'offre_acceptee', 'sous_compromis'].includes(s)) return 'hot';
  if (['visite_a_programmer', 'visite_programmee', 'visite', 'offre_envisagee'].includes(s)) return 'active';
  return 'early';
}

export const USAGE_LABELS: Record<PropertyUsage, string> = {
  locatif: 'Bien locatif',
  residence_principale: 'Résidence principale',
  residence_secondaire: 'Résidence secondaire',
};

export const OCCUPATION_LABELS: Record<OccupationStatus, string> = {
  vacant: 'Vacant',
  loue: 'Loué',
  travaux: 'En travaux',
  usage_personnel: 'Usage personnel',
};

export const TYPE_LABELS: Record<PropertyType, string> = {
  appartement: 'Appartement', maison: 'Maison', immeuble: 'Immeuble', parking: 'Parking',
  local: 'Local', terrain: 'Terrain', autre: 'Autre',
};

export const OWNERSHIP_LABELS: Record<OwnershipMode, string> = {
  nom_propre: 'En nom propre', indivision: 'Indivision', sci_ir: 'SCI à l’IR', sci_is: 'SCI à l’IS',
  demembrement: 'Démembrement', autre: 'Autre',
};

export const TAX_REGIME_LABELS: Record<TaxRegime, string> = {
  micro_foncier: 'Micro-foncier', reel_foncier: 'Réel foncier', micro_bic: 'Micro-BIC (meublé)',
  reel_bic: 'Réel BIC (LMNP)', is: 'Impôt sur les sociétés', autre: 'Autre',
};

export const CONTACT_KIND_LABELS: Record<ContactKind, string> = {
  agence: 'Agence', agent: 'Agent', artisan: 'Artisan', notaire: 'Notaire', banque: 'Banque',
  courtier: 'Courtier', syndic: 'Syndic', gestionnaire: 'Gestionnaire', diagnostiqueur: 'Diagnostiqueur', autre: 'Autre',
};

export const CHANNEL_LABELS: Record<Channel, string> = {
  telephone: 'Téléphone', email: 'E-mail', sms: 'SMS', visite: 'Visite', rendez_vous: 'Rendez-vous', courrier: 'Courrier', autre: 'Autre',
};

export const EVENT_LABELS: Record<EventKind, string> = {
  creation: 'Création', status_change: 'Statut', acquisition: 'Acquisition', exchange: 'Échange',
  note: 'Note', visit: 'Visite', migration: 'Reprise de l’ancienne version',
};

export const DPE_VALUES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;
