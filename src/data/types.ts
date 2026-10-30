// Types des lignes, alignés sur supabase/migrations/20261013000100_immozen_core.sql
import type { SimulationInputs, ScenarioSummary } from '../domain/simulator.ts';
import type { MarketRentSnapshot } from '../domain/marketRent.ts';

export type PropertyStatus =
  | 'repere' | 'a_contacter' | 'informations_demandees' | 'visite_a_programmer' | 'visite_programmee'
  | 'visite' | 'offre_envisagee' | 'offre_transmise' | 'negociation' | 'offre_acceptee' | 'sous_compromis'
  | 'acquis' | 'refuse' | 'abandonne' | 'archive';
export type OccupationStatus = 'vacant' | 'loue' | 'travaux' | 'usage_personnel';
export type PropertyType = 'appartement' | 'maison' | 'immeuble' | 'parking' | 'local' | 'terrain' | 'autre';
export type OwnershipMode = 'nom_propre' | 'indivision' | 'sci_ir' | 'sci_is' | 'demembrement' | 'autre';
export type TaxRegime = 'micro_foncier' | 'reel_foncier' | 'micro_bic' | 'reel_bic' | 'is' | 'autre';
export type ContactKind = 'agence' | 'agent' | 'artisan' | 'notaire' | 'banque' | 'courtier' | 'syndic' | 'gestionnaire' | 'diagnostiqueur' | 'autre';
export type EventKind = 'creation' | 'status_change' | 'acquisition' | 'exchange' | 'note' | 'visit' | 'migration';
export type Channel = 'telephone' | 'email' | 'sms' | 'visite' | 'rendez_vous' | 'courrier' | 'autre';

interface Versioned {
  id: string;
  user_id: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Property extends Versioned {
  title: string;
  status: PropertyStatus;
  status_before_archive: PropertyStatus | null;
  occupation_status: OccupationStatus | null;
  property_type: PropertyType;
  address: string | null;
  zip: string | null;
  city: string | null;
  surface: number | null;
  rooms: number | null;
  dpe: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | null;
  listing_url: string | null;
  asking_price: number | null;
  offer_price: number | null;
  works_budget: number | null;
  estimated_rent: number | null;
  /** Provision mensuelle sur charges (biens détenus). */
  charges_provision?: number | null;
  /** Charges annuelles d'un bien détenu (€/an). */
  property_tax_annual?: number | null;
  copro_charges_annual?: number | null;
  pno_annual?: number | null;
  management_annual?: number | null;
  gli_annual?: number | null;
  other_charges_annual?: number | null;
  /** Fourchette d'estimation de la valeur (DVF ou saisie). */
  estimate_low?: number | null;
  estimate_high?: number | null;
  estimate_median?: number | null;
  estimate_on?: string | null;
  estimate_source?: string | null;
  estimate_details?: EstimateDetails | null;
  /** Loyer de marché : bien meublé, année de construction et zone d'encadrement, fourchette enregistrée. */
  furnished?: boolean | null;
  construction_year?: number | null;
  rent_zone?: string | null;
  market_rent?: MarketRentSnapshot | null;
  /** Crédit d'un bien détenu. */
  loan_amount?: number | null;
  loan_rate?: number | null;
  loan_years?: number | null;
  loan_start_date?: string | null;
  loan_insurance_monthly?: number | null;
  loan_monthly_payment?: number | null;
  agency_id: string | null;
  agent_id: string | null;
  next_action: string | null;
  follow_up_date: string | null;
  visit_at: string | null;
  comments: string | null;
  vigilance: string[];
  ownership_mode: OwnershipMode | null;
  tax_regime: TaxRegime | null;
  acquired_at: string | null;
  acquisition_cost: number | null;
  acquisition_snapshot: AcquisitionSnapshot | null;
  primary_scenario_id: string | null;
  legacy_simulation_id: string | null;
  legacy_ref: string | null;
}

export interface EstimateDetails {
  perM2?: { p25: number; median: number; p75: number };
  count?: number;
  radius?: number | null;
  from?: string;
  to?: string;
  surface?: number;
  comparables?: { date: string; address: string; surface: number; value: number; perM2: number; distance: number | null }[];
}

export interface AcquisitionSnapshot {
  scenario_id: string;
  scenario_name: string;
  inputs: Partial<SimulationInputs>;
  results: ScenarioSummary | null;
  engine_version: string;
  taken_at: string;
}

export interface Scenario extends Versioned {
  property_id: string | null;
  name: string;
  inputs: Partial<SimulationInputs> & { legacy?: unknown };
  results: ScenarioSummary | null;
  engine_version: string;
  archived_at: string | null;
  legacy_simulation_id: string | null;
}

export interface Contact extends Versioned {
  kind: ContactKind;
  name: string;
  organization_id: string | null;
  organization_name: string | null;
  email: string | null;
  phone: string | null;
  sector: string | null;
  notes: string | null;
  next_follow_up: string | null;
  archived_at: string | null;
  legacy_source: string | null;
}

export interface PropertyTask extends Versioned {
  property_id: string;
  title: string;
  due_date: string | null;
  done_at: string | null;
}

export interface TimelineEvent {
  id: string;
  user_id: string;
  property_id: string | null;
  contact_id: string | null;
  kind: EventKind;
  channel: Channel | null;
  occurred_at: string;
  summary: string;
  data: Record<string, unknown>;
  created_at: string;
}

export interface UserSettings {
  user_id: string;
  simulator_defaults: Partial<SimulationInputs>;
  ui_prefs: Record<string, unknown>;
  rental_settings?: RentalSettings;
  /** Saisies complémentaires de la déclaration fiscale, par année puis par bien. */
  tax_inputs?: TaxInputs;
  version: number;
  updated_at: string;
}

export interface TaxPropertyInputs {
  /** 2044 ligne 230 : régularisation des provisions pour charges déduites l'année précédente. */
  regularisation?: number;
  /** 2044 ligne 213 : recettes diverses (indemnités d'assurance…). */
  other_income?: number;
  /** LMNP réel : part du terrain non amortissable (%), durées d'amortissement (années). */
  land_pct?: number;
  building_years?: number;
  furniture_years?: number;
  works_years?: number;
  /** Valeur amortissable retenue (sinon coût d'acquisition). */
  depreciable_base?: number;
  /** Micro-BIC : nature de la location meublée (cases 5NI, 5NG ou 5NH de la 2042-C-PRO). */
  meuble_kind?: MeubleKind;
  /** Déficits fonciers antérieurs non encore imputés (case 4BD), saisis depuis l'avis d'imposition. */
  prior_deficits?: number;
}
export type MeubleKind = 'longue_duree' | 'tourisme_classe' | 'chambre_hotes' | 'tourisme_non_classe';
export type TaxInputs = Record<string, Record<string, TaxPropertyInputs>>;

export interface ReminderTemplate {
  subject: string;
  body: string;
}
export interface RentalSettings {
  landlord_name?: string;
  landlord_address?: string;
  /** Modèles de relance, niveaux 1 à 3. */
  reminder_templates?: ReminderTemplate[];
  /** Colonne « Reçu » de Loyers et paiements : cochée automatiquement, ou après confirmation de l'utilisateur. */
  received_mode?: 'auto' | 'confirmation';
  /** Point de départ des lignes mensuelles : début de chaque bail, ou une date choisie. */
  ledger_start_mode?: 'bail' | 'date';
  /** Date choisie (AAAA-MM-JJ) quand ledger_start_mode = 'date'. */
  ledger_start_date?: string | null;
  /** Date de passage au tableau unique (reprise des échéances et paiements existants). */
  ledger_unified_at?: string | null;
}

// ---------------------------------------------------------------------
// Lot 2 : gestion locative
// ---------------------------------------------------------------------
export interface Tenant extends Versioned {
  first_name: string | null;
  last_name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  archived_at: string | null;
}

export interface Lease extends Versioned {
  property_id: string;
  label: string | null;
  furnished: boolean;
  start_date: string;
  end_date: string | null;
  rent_hc: number;
  charges_amount: number;
  charges_mode: 'provision' | 'forfait';
  deposit_amount: number;
  payment_day: number;
  landlord_name: string | null;
  landlord_address: string | null;
  owner_confirmation_email: boolean;
  receipt_auto_send: boolean;
  reminder_enabled: boolean;
  reminder_delay_days: number;
  notes: string | null;
  /** Révision annuelle selon l'IRL. */
  irl_enabled?: boolean;
  irl_base_label?: string | null;
  irl_base_value?: number | null;
  last_revision_on?: string | null;
  /** Informations du contrat de bail généré (type de bail, désignation, clauses). */
  contract?: LeaseContract | null;
}

/** Type de contrat : loi du 6 juillet 1989 (vide, meublé) ou Code civil (hors résidence principale, parking). */
export type ContractKind = 'vide' | 'meuble' | 'civil_secondaire' | 'civil_societe' | 'parking';
export interface LeaseContract {
  kind: ContractKind;
  landlord_kind?: 'physique' | 'sci_familiale' | 'morale';
  landlord_email?: string | null;
  landlord_representative?: string | null;
  /** Bail civil à une société : preneur personne morale et occupant désigné. */
  company_name?: string | null;
  company_id?: string | null;
  company_representative?: string | null;
  occupant_name?: string | null;
  building_type?: 'collectif' | 'individuel';
  ownership_regime?: 'copropriete' | 'monopropriete';
  construction_period?: 'avant_1949' | '1949_1974' | '1975_1989' | '1989_2005' | 'apres_2005';
  tax_id?: string | null;
  surface?: number | null;
  rooms?: number | null;
  other_parts?: string | null;
  equipment?: string | null;
  heating?: 'individuel' | 'collectif';
  hot_water?: 'individuel' | 'collectif';
  collective_split?: string | null;
  usage?: 'habitation' | 'mixte';
  private_annexes?: string | null;
  common_areas?: string | null;
  telecom?: string | null;
  duration_months?: number | null;
  reduced_reason?: string | null;
  student?: boolean;
  tacit_renewal?: boolean;
  notice_months?: number | null;
  zone_tendue?: boolean;
  reference_rent?: number | null;
  reference_rent_increased?: number | null;
  rent_complement?: number | null;
  rent_complement_reason?: string | null;
  previous_rent?: number | null;
  previous_rent_date?: string | null;
  payment_terms?: 'echoir' | 'echu';
  payment_place?: string | null;
  energy_cost_min?: number | null;
  energy_cost_max?: number | null;
  energy_ref_year?: number | null;
  works_done?: string | null;
  works_landlord?: string | null;
  works_tenant?: string | null;
  agency_fees_tenant?: number | null;
  agency_fees_landlord?: number | null;
  guarantor?: string | null;
  furniture?: string[];
  parking_spot?: string | null;
  special_conditions?: string | null;
  signed_place?: string | null;
  signed_on?: string | null;
  // ----- Contrats types modifiés par le décret n° 2026-596 du 6 juillet 2026 (baux conclus ou renouvelés à compter du 1er octobre 2026)
  /** Numéro de téléphone portable du bailleur (facultatif). */
  landlord_phone?: string | null;
  /** Logement soumis à la servitude de résidence principale (art. L. 151-14-1 du code de l'urbanisme). */
  principal_residence_servitude?: boolean;
  /** Clause résolutoire : défaut d'assurance des risques locatifs (facultatif, proposé par défaut). */
  clause_insurance?: boolean;
  /** Clause résolutoire : troubles de voisinage constatés par une décision passée en force de chose jugée (facultatif). */
  clause_neighbours?: boolean;
  /** IV.A.2° Date de révision du loyer (à défaut : date anniversaire du contrat). */
  revision_date?: string | null;
  /** IV.C (location vide) Contribution pour le partage des économies de charges : montant, durée, travaux. */
  charges_economy?: string | null;
  /** Assurance souscrite par le bailleur pour le compte des colocataires : montant annuel récupérable. */
  coloc_insurance_annual?: number | null;
  /** Réévaluation d'un loyer manifestement sous-évalué (renouvellement) : montant et modalités. */
  rent_reassessment?: string | null;
  /** IX. Honoraires : détail. */
  agency_fees_landlord_edl?: number | null;
  agency_fees_landlord_other?: number | null;
  agency_fees_tenant_edl?: number | null;
  agency_cap_m2?: number | null;
  agency_cap_edl_m2?: number | null;
  /** XI.E Autorisation préalable de mise en location (« permis de louer »). */
  rental_permit?: boolean;
}

/** Accès d'un locataire à son espace (invitation, acceptation, révocation). */
export interface TenantAccount {
  id: string;
  user_id: string;
  tenant_id: string;
  email: string;
  invited_at: string | null;
  account_user_id: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeaseRevision {
  id: string;
  user_id: string;
  lease_id: string;
  effective_on: string;
  old_rent: number;
  new_rent: number;
  old_index_label: string;
  old_index: number;
  new_index_label: string;
  new_index: number;
  charges_updated: number;
  created_at: string;
}

export interface LeaseTenant {
  lease_id: string;
  tenant_id: string;
  user_id: string;
  left_on: string | null;
  created_at: string;
}

/** report : reste dû du mois précédent, reporté automatiquement dans « Autre somme due ». */
export type ChargeKind = 'loyer' | 'regularisation' | 'autre' | 'report';
export interface RentCharge extends Versioned {
  lease_id: string;
  kind: ChargeKind;
  period_start: string;
  period_end: string;
  due_date: string;
  rent_amount: number;
  charges_amount: number;
  label: string | null;
  cancelled_at: string | null;
  /** Motif saisi à l'annulation (migration 20261020000300). */
  cancel_reason?: string | null;
  /** Report : premier mois (AAAA-MM-01) dont le reste dû est repris. */
  carry_from?: string | null;
  /** Somme dont le reste dû a été reporté sur le mois suivant (ligne de report). */
  carried_to?: string | null;
  /** Loyer : excédent reçu laissé en trop-perçu, ou reporté en avance sur le mois suivant. */
  excess_mode?: 'trop_percu' | 'avance' | null;
  /** Loyer : réception confirmée par l'utilisateur (colonne « Reçu » en mode confirmation). */
  received_at?: string | null;
}

export type PaymentMethod = 'virement' | 'prelevement' | 'cheque' | 'especes' | 'caf' | 'autre';
export interface Payment extends Versioned {
  lease_id: string;
  amount: number;
  paid_on: string;
  date_defaulted: boolean;
  method: PaymentMethod;
  reference: string | null;
  comment: string | null;
  source: 'saisie' | 'confirmation' | 'import';
  /** Empreinte de la ligne importée (anti-doublon). */
  import_ref?: string | null;
  /** Mois de rattachement (AAAA-MM-01) ; à défaut, le mois de la date du paiement. */
  period_month?: string | null;
}

export interface Allocation {
  id: string;
  user_id: string;
  payment_id: string;
  charge_id: string;
  amount: number;
  created_at: string;
}

export interface DepositMovement {
  id: string;
  user_id: string;
  lease_id: string;
  kind: 'encaissement' | 'restitution' | 'retenue';
  amount: number;
  occurred_on: string;
  comment: string | null;
  created_at: string;
}

export interface Receipt {
  id: string;
  user_id: string;
  lease_id: string;
  charge_id: string;
  kind: 'quittance' | 'recu';
  number: string;
  issued_on: string;
  period_start: string;
  period_end: string;
  rent_amount: number;
  charges_amount: number;
  paid_amount: number;
  payments: { date: string; amount: number; method: PaymentMethod }[];
  tenant_names: string;
  tenant_emails: string[];
  landlord_name: string | null;
  landlord_address: string | null;
  property_address: string | null;
  send_status: 'non_envoye' | 'a_envoyer' | 'envoye' | 'echec';
  sent_at: string | null;
  send_error: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  /** Rappels de charges repris sur la quittance. */
  extra_lines?: { charge_id: string; label: string; amount: number }[];
  created_at: string;
}

export type ReminderStatus = 'brouillon' | 'a_envoyer' | 'envoye' | 'echec' | 'annule' | 'envoye_manuellement';
export interface Reminder extends Versioned {
  lease_id: string;
  level: number;
  charge_ids: string[];
  debt_amount: number;
  subject: string;
  body: string;
  recipients: string[];
  status: ReminderStatus;
  created_by: 'proprietaire' | 'automatique';
  sent_at: string | null;
  error: string | null;
}

export type DocumentCategory = 'bail' | 'quittance' | 'facture' | 'diagnostic' | 'assurance' | 'fiscal' | 'copropriete' | 'photo' | 'identite' | 'autre';
export interface DocumentRow extends Versioned {
  property_id: string | null;
  lease_id: string | null;
  tenant_id: string | null;
  category: DocumentCategory;
  title: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  notes: string | null;
  /** Visible dans l'espace locataire (document d'un bail ou d'un locataire). */
  shared_with_tenant?: boolean;
}

export type ExpenseCategory = 'copropriete' | 'taxe_fonciere' | 'assurance' | 'interets' | 'frais_bancaires' | 'travaux' | 'mobilier' | 'entretien' | 'gestion' | 'autre'
  | 'credit' | 'assurance_credit' | 'entretien_amortissable' | 'loyer' | 'frais_credit';
export type ExpenseNature = 'charge' | 'immobilisation' | 'remboursement_capital' | 'tresorerie';
export interface Expense extends Versioned {
  property_id: string;
  expense_date: string;
  supplier: string | null;
  label: string | null;
  amount: number;
  category: ExpenseCategory;
  nature: ExpenseNature;
  recoverable_amount: number;
  payment_status: 'a_payer' | 'paye';
  paid_on: string | null;
  document_id: string | null;
  notes: string | null;
  /** Durée d'amortissement choisie (années) ; vide : durée par défaut de la catégorie. */
  amortization_years?: number | null;
  /** Compte bancaire du mouvement (import). */
  account?: string | null;
  /** Empreinte de la ligne importée (anti-doublon). */
  import_ref?: string | null;
}

export interface OutboxMessage {
  id: string;
  user_id: string;
  kind: 'confirmation_paiement' | 'quittance' | 'relance' | 'relance_a_valider' | 'invitation_locataire' | 'contact_site';
  to_emails: string[];
  subject: string;
  status: 'a_envoyer' | 'en_cours' | 'envoye' | 'echec' | 'annule';
  receipt_id: string | null;
  reminder_id: string | null;
  lease_id: string | null;
  charge_id: string | null;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface Tables {
  properties: Property;
  scenarios: Scenario;
  pro_contacts: Contact;
  property_tasks: PropertyTask;
  timeline_events: TimelineEvent;
  tenants: Tenant;
  leases: Lease;
  lease_tenants: LeaseTenant;
  rent_charges: RentCharge;
  payments: Payment;
  payment_allocations: Allocation;
  deposit_movements: DepositMovement;
  reminders: Reminder;
  documents: DocumentRow;
  expenses: Expense;
}
export type TableName = keyof Tables;
/** Tables en lecture seule côté navigateur (écrites par les fonctions serveur). */
export interface ReadOnlyTables {
  receipts: Receipt;
  email_outbox: OutboxMessage;
}
export type VersionedTable = 'properties' | 'scenarios' | 'pro_contacts' | 'property_tasks'
  | 'tenants' | 'leases' | 'rent_charges' | 'payments' | 'reminders' | 'documents' | 'expenses';

/** Colonnes gérées par le serveur, jamais envoyées par le client. */
export type ServerManaged = 'id' | 'user_id' | 'version' | 'created_at' | 'updated_at';
export type Insert<T> = Partial<Omit<T, ServerManaged>> & { id?: string };
export type Patch<T> = Partial<Omit<T, ServerManaged>>;
