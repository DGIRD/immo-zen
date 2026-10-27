/**
 * Génération des contrats de bail.
 *
 *  - Location vide et location meublée à usage de résidence principale : structure et mentions des contrats types
 *    du décret n° 2015-587 du 29 mai 2015 (annexe 1 : logement nu, annexe 2 : logement meublé), pris pour
 *    l'application de l'article 3 de la loi n° 89-462 du 6 juillet 1989, dans leur version issue du décret
 *    n° 2026-596 du 6 juillet 2026 (baux conclus ou renouvelés à compter du 1er octobre 2026) : rubriques I à XI
 *    dans l'ordre officiel, téléphone portable facultatif, servitude de résidence principale, clause résolutoire
 *    réécrite (partie obligatoire et clauses facultatives).
 *  - Bail civil (résidence secondaire, logement loué à une société) et location d'un parking seul : il n'existe
 *    pas de modèle officiel ; le contrat suit les articles 1714 et suivants du Code civil.
 *
 * Le document produit reprend les informations saisies ; il doit être relu par les parties. Il n'est pas présenté
 * comme validé juridiquement.
 */
import type { ContractKind, Lease, LeaseContract, Property, Tenant } from '../data/types.ts';

export type Block =
  | { t: 'p'; text: string }
  | { t: 'kv'; rows: [string, string][] }
  | { t: 'list'; items: string[] }
  | { t: 'sign'; parties: string[] };
export interface DocSection { title: string; blocks: Block[] }
export interface ContractDoc {
  title: string;
  subtitle: string;
  sections: DocSection[];
  /** Points bloquants : informations manquantes ou clause illégale. */
  errors: string[];
  /** Points à vérifier. */
  warnings: string[];
  fileName: string;
}
export interface ContractContext {
  lease: Lease;
  property: Property;
  tenants: Tenant[];
  today: string;
}

export const CONTRACT_KIND_LABELS: Record<ContractKind, string> = {
  vide: 'Location vide (résidence principale)',
  meuble: 'Location meublée (résidence principale)',
  civil_secondaire: 'Bail civil : résidence secondaire',
  civil_societe: 'Bail civil : logement loué à une société',
  parking: 'Location d’un parking ou d’un garage',
};
export const CONSTRUCTION_LABELS: Record<NonNullable<LeaseContract['construction_period']>, string> = {
  avant_1949: 'avant 1949', '1949_1974': 'de 1949 à 1974', '1975_1989': 'de 1975 à 1989', '1989_2005': 'de 1989 à 2005', apres_2005: 'depuis 2005',
};
/** Liste minimale du mobilier d'un logement meublé (décret n° 2015-981 du 31 juillet 2015). */
export const FURNITURE_MINIMUM = [
  'Literie comprenant couette ou couverture',
  'Dispositif d’occultation des fenêtres dans les pièces destinées à être utilisées comme chambre',
  'Plaques de cuisson',
  'Four ou four à micro-ondes',
  'Réfrigérateur et congélateur ou, au minimum, réfrigérateur doté d’un compartiment à une température inférieure ou égale à -6 °C',
  'Vaisselle nécessaire à la prise des repas',
  'Ustensiles de cuisine',
  'Table et sièges',
  'Étagères de rangement',
  'Luminaires',
  'Matériel d’entretien ménager adapté aux caractéristiques du logement',
];
/** Référence du contrat type officiel (version applicable aux baux conclus ou renouvelés depuis le 1er octobre 2026). */
export const CONTRACT_TYPE_REF = {
  vide: 'annexe 1 du décret n° 2015-587 du 29 mai 2015 modifié, en dernier lieu par le décret n° 2026-596 du 6 juillet 2026',
  meuble: 'annexe 2 du décret n° 2015-587 du 29 mai 2015 modifié, en dernier lieu par le décret n° 2026-596 du 6 juillet 2026',
} as const;
export const CONTRACT_TYPE_SOURCES = {
  vide: 'https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000047983882',
  meuble: 'https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000054393993',
} as const;
export const NOTICE_URL = 'https://www.service-public.fr/particuliers/vosdroits/F920';

const isHousing = (k: ContractKind) => k === 'vide' || k === 'meuble';
const eur = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[\u202f\u00a0]/g, ' ')} €`);
const frDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const tenantFull = (t: Tenant) => [t.first_name, t.last_name].filter(Boolean).join(' ');
const months = (n: number) => (n % 12 === 0 ? `${n / 12} an${n / 12 > 1 ? 's' : ''}` : `${n} mois`);

export function addMonthsIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1 + n, d));
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

/** Valeurs proposées à partir du bail et du bien (les valeurs déjà saisies sont conservées). */
export function defaultContract(ctx: ContractContext): LeaseContract {
  const { lease, property } = ctx;
  const saved = lease.contract ?? null;
  const kind: ContractKind = saved?.kind ?? (property.property_type === 'parking' ? 'parking' : lease.furnished ? 'meuble' : 'vide');
  const base: LeaseContract = {
    kind,
    landlord_kind: 'physique',
    building_type: property.property_type === 'maison' ? 'individuel' : 'collectif',
    ownership_regime: property.property_type === 'maison' ? 'monopropriete' : 'copropriete',
    surface: property.surface ?? null,
    rooms: property.rooms ?? null,
    heating: 'individuel',
    hot_water: 'individuel',
    usage: 'habitation',
    duration_months: defaultDuration(kind, 'physique', false),
    tacit_renewal: true,
    notice_months: kind === 'parking' ? 1 : kind.startsWith('civil') ? 3 : null,
    payment_terms: 'echoir',
    furniture: kind === 'meuble' ? [...FURNITURE_MINIMUM] : [],
    signed_on: ctx.today,
    clause_insurance: true,
    clause_neighbours: true,
  };
  return { ...base, ...(saved ?? {}), kind };
}

export function defaultDuration(kind: ContractKind, landlord: LeaseContract['landlord_kind'], student: boolean | undefined): number {
  if (kind === 'vide') return landlord === 'morale' ? 72 : 36;
  if (kind === 'meuble') return student ? 9 : 12;
  return 12;
}

/** Durée minimale légale (mois) : null si libre (bail civil, parking). */
export function minimumDuration(c: LeaseContract): number | null {
  if (c.kind === 'vide') return c.reduced_reason?.trim() && c.landlord_kind !== 'morale' ? 12 : c.landlord_kind === 'morale' ? 72 : 36;
  if (c.kind === 'meuble') return c.student ? 9 : 12;
  return null;
}
/** Dépôt de garantie maximal (art. 22 et 25-6 de la loi du 6 juillet 1989). */
export function maxDeposit(c: LeaseContract, rentHc: number): number | null {
  if (c.kind === 'vide') return rentHc;
  if (c.kind === 'meuble') return rentHc * 2;
  return null;
}

/**
 * Contrôles légaux faits dès la saisie du bail (avant même l'édition du contrat) :
 * plafond du dépôt de garantie et forfait de charges interdit en location vide hors colocation.
 * Les baux civils et de parking (contrat déjà qualifié comme tel) n'y sont pas soumis.
 */
export function leaseFormIssues(
  l: { furnished?: boolean | null; rent_hc?: number | null; deposit_amount?: number | null; charges_mode?: string | null; contract?: { kind?: string } | null },
  tenantCount: number,
): { deposit_amount?: string; charges_mode?: string } {
  const out: { deposit_amount?: string; charges_mode?: string } = {};
  const kind = l.contract?.kind && !['vide', 'meuble'].includes(l.contract.kind) ? l.contract.kind : l.furnished ? 'meuble' : 'vide';
  if (kind !== 'vide' && kind !== 'meuble') return out;
  const max = maxDeposit({ kind } as LeaseContract, Number(l.rent_hc ?? 0));
  if (max !== null && Number(l.deposit_amount ?? 0) > max + 0.005) {
    out.deposit_amount = `Dépôt de garantie trop élevé : ${eur(max)} maximum (${kind === 'vide' ? 'un mois' : 'deux mois'} de loyer hors charges en location ${kind === 'vide' ? 'vide' : 'meublée'}).`;
  }
  if (kind === 'vide' && l.charges_mode === 'forfait' && tenantCount < 2) {
    out.charges_mode = 'En location vide, les charges sont payées par provisions avec régularisation annuelle : le forfait est réservé à la colocation.';
  }
  return out;
}

export function checkContract(c: LeaseContract, ctx: ContractContext): { errors: string[]; warnings: string[] } {
  const { lease, property, tenants } = ctx;
  const errors: string[] = [];
  const warnings: string[] = [];
  const housing = isHousing(c.kind);
  if (!lease.landlord_name?.trim()) errors.push('Nom du bailleur manquant (bail → Modifier → Quittances).');
  if (!lease.landlord_address?.trim()) errors.push('Adresse du bailleur manquante (bail → Modifier → Quittances).');
  if (c.kind === 'civil_societe') {
    if (!c.company_name?.trim()) errors.push('Raison sociale de la société locataire manquante.');
    if (!c.occupant_name?.trim()) errors.push('Nom de l’occupant désigné manquant.');
  } else if (!tenants.length) errors.push('Aucun locataire : ajoutez le ou les titulaires du bail.');
  if (!property.address?.trim() || !property.city?.trim()) errors.push('Adresse du logement incomplète (Mes biens → Modifier).');
  if (housing && !(c.surface && c.surface > 0)) errors.push('Surface habitable manquante (mention obligatoire).');
  if (housing && !(c.rooms && c.rooms > 0)) errors.push('Nombre de pièces principales manquant.');
  if (c.kind === 'parking' && !c.parking_spot?.trim()) warnings.push('Précisez le numéro ou l’emplacement du parking.');

  const d = c.duration_months ?? 0;
  const min = minimumDuration(c);
  if (!(d > 0)) errors.push('Durée du bail manquante.');
  else if (min !== null && d < min) {
    errors.push(c.kind === 'vide'
      ? `Durée trop courte : ${months(min)} minimum pour ce bailleur${c.reduced_reason ? '' : ' (une durée réduite à un an exige un événement précis justifiant la reprise, bailleur personne physique)'}.`
      : `Durée trop courte : ${months(min)} minimum en location meublée${c.student ? ' étudiante' : ''}.`);
  }
  if (c.kind === 'vide' && c.reduced_reason?.trim() && d >= 36) warnings.push('Motif de durée réduite saisi alors que la durée est d’au moins trois ans : il sera ignoré.');

  const dep = maxDeposit(c, lease.rent_hc);
  if (dep !== null && lease.deposit_amount > dep + 0.005) {
    errors.push(`Dépôt de garantie trop élevé : ${eur(dep)} maximum (${c.kind === 'vide' ? 'un mois' : 'deux mois'} de loyer hors charges).`);
  }
  if (c.kind === 'vide' && lease.charges_mode === 'forfait' && tenants.length < 2) {
    errors.push('En location vide, les charges sont payées par provisions avec régularisation annuelle (le forfait est réservé à la colocation).');
  }
  if (housing || c.kind === 'civil_secondaire') {
    if (property.dpe === 'G') errors.push('Logement classé G au DPE : non décent depuis le 1er janvier 2025, il ne peut plus être donné en location comme résidence principale.');
    else if (property.dpe === 'F') warnings.push('Logement classé F : non décent à partir du 1er janvier 2028 ; loyer non révisable ni augmentable (logement F ou G).');
    else if (property.dpe === 'E') warnings.push('Logement classé E : non décent à partir du 1er janvier 2034.');
    if (!property.dpe && housing) warnings.push('Classe énergie du DPE non renseignée (Mes biens → Modifier).');
  }
  if (housing) {
    if (!(c.energy_cost_min && c.energy_cost_max)) warnings.push('Estimation des dépenses annuelles d’énergie du DPE à indiquer (mention obligatoire).');
    if (c.zone_tendue) {
      if (!(c.reference_rent && c.reference_rent_increased)) warnings.push('Zone d’encadrement des loyers : indiquez le loyer de référence et le loyer de référence majoré (€/m²).');
      else if (c.surface && lease.rent_hc > c.reference_rent_increased * c.surface + 0.005 && !(c.rent_complement && c.rent_complement > 0)) {
        errors.push(`Loyer supérieur au loyer de référence majoré (${eur(c.reference_rent_increased * c.surface)}) : un complément de loyer justifié par des caractéristiques exceptionnelles est nécessaire.`);
      }
      if (c.rent_complement && c.rent_complement > 0 && !c.rent_complement_reason?.trim()) errors.push('Complément de loyer sans justification.');
      if (c.rent_complement && c.rent_complement > 0 && (property.dpe === 'F' || property.dpe === 'G')) errors.push('Complément de loyer interdit pour un logement classé F ou G.');
    }
    if (!c.construction_period) warnings.push('Période de construction à préciser.');
    if (!c.tax_id?.trim()) warnings.push('Identifiant fiscal du logement à indiquer (mention du contrat type ; il figure dans l’espace « Gérer mes biens immobiliers » sur impots.gouv.fr).');
    if (lease.irl_enabled && !lease.irl_base_label) warnings.push('Révision prévue sans trimestre de référence de l’IRL (bail → Modifier).');
  }
  if (c.kind === 'civil_secondaire' || c.kind === 'civil_societe') {
    warnings.push('Bail civil : à réserver à un logement qui n’est pas la résidence principale de l’occupant ; sinon, la loi du 6 juillet 1989 s’applique et le bail doit suivre le contrat type.');
  }
  for (const t of tenants) if (!t.first_name) warnings.push(`Prénom manquant pour ${t.last_name}.`);
  return { errors, warnings };
}

// ---------------------------------------------------------------- rédaction

export function buildContract(c: LeaseContract, ctx: ContractContext): ContractDoc {
  const { errors, warnings } = checkContract(c, ctx);
  const sections = c.kind === 'vide' || c.kind === 'meuble' ? housingSections(c, ctx) : civilSections(c, ctx);
  const place = ctx.property.city ?? '';
  return {
    title: c.kind === 'vide' ? 'Contrat de location – logement nu' : c.kind === 'meuble' ? 'Contrat de location – logement meublé'
      : c.kind === 'parking' ? 'Contrat de location d’un emplacement de stationnement' : 'Bail d’habitation soumis au Code civil',
    subtitle: c.kind === 'vide' || c.kind === 'meuble'
      ? `Contrat type de location ou de colocation de logement ${c.kind === 'vide' ? 'nu' : 'meublé'} – soumis au ${c.kind === 'vide' ? 'titre Ier' : 'titre Ier bis'} de la loi n° 89-462 du 6 juillet 1989 tendant à améliorer les rapports locatifs – ${CONTRACT_TYPE_REF[c.kind]}`
      : c.kind === 'parking' ? 'Location soumise aux articles 1714 et suivants du Code civil'
      : 'Location ne constituant pas la résidence principale du preneur, soumise aux articles 1714 et suivants du Code civil',
    sections,
    errors,
    warnings,
    fileName: `bail-${c.kind}-${(place || 'logement').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}-${ctx.lease.start_date}.pdf`,
  };
}

function landlordRows(c: LeaseContract, l: Lease): [string, string][] {
  return [
    ['Bailleur', l.landlord_name || '—'],
    ['Qualité', c.landlord_kind === 'morale' ? 'Personne morale' : c.landlord_kind === 'sci_familiale' ? 'Société civile constituée exclusivement entre parents et alliés jusqu’au quatrième degré inclus' : 'Personne physique'],
    ['Domicile ou siège', l.landlord_address || '—'],
    ...(c.landlord_email ? [['Adresse électronique', c.landlord_email] as [string, string]] : []),
    ...(c.landlord_representative ? [['Représenté par (mandataire)', c.landlord_representative] as [string, string]] : []),
  ];
}
function tenantRows(ctx: ContractContext): [string, string][] {
  return ctx.tenants.map((t, i) => [ctx.tenants.length > 1 ? `Locataire ${i + 1}` : 'Locataire', `${tenantFull(t)}${t.email ? ` – ${t.email}` : ''}`]);
}
const address = (p: Property) => [p.address, [p.zip, p.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');

/** Mention « sans objet » d'une rubrique du contrat type non applicable (la numérotation officielle est conservée). */
const NA = 'Sans objet.';

/**
 * Location vide (annexe 1) ou meublée (annexe 2) : rubriques I à XI et sous-rubriques dans l'ordre et sous les intitulés
 * des contrats types, dans leur version issue du décret n° 2026-596 du 6 juillet 2026 (contrats conclus ou renouvelés à
 * compter du 1er octobre 2026). Une rubrique « le cas échéant » non applicable est conservée avec la mention « Sans objet ».
 */
function housingSections(c: LeaseContract, ctx: ContractContext): DocSection[] {
  const { lease: l, property: p, tenants } = ctx;
  const furnished = c.kind === 'meuble';
  const coloc = tenants.length > 1;
  const duration = c.duration_months ?? defaultDuration(c.kind, c.landlord_kind, c.student);
  const reduced = c.kind === 'vide' && !!c.reduced_reason?.trim() && duration < 36;
  const s: DocSection[] = [];

  // ---------- I. Désignation des parties
  s.push({ title: 'I. Désignation des parties', blocks: [
    { t: 'p', text: 'Le présent contrat est conclu entre les soussignés :' },
    { t: 'kv', rows: [
      ['Nom et prénom, ou dénomination du bailleur', l.landlord_name || '—'],
      ['Domicile ou siège social', l.landlord_address || '—'],
      ['Qualité du bailleur', c.landlord_kind === 'morale' ? 'Personne morale' : c.landlord_kind === 'sci_familiale' ? 'Personne morale : société civile constituée exclusivement entre parents et alliés jusqu’au quatrième degré inclus' : 'Personne physique'],
      ...(c.landlord_email ? [['Adresse électronique (facultatif)', c.landlord_email] as [string, string]] : []),
      ...(c.landlord_phone ? [['Numéro de téléphone portable (facultatif)', c.landlord_phone] as [string, string]] : []),
    ] },
    { t: 'p', text: 'désigné(s) ci-après « le bailleur » ;' },
    { t: 'kv', rows: [['Le cas échéant, représenté par le mandataire (nom ou raison sociale, adresse, activité exercée, numéro et lieu de délivrance de la carte professionnelle)', c.landlord_representative || NA]] },
    { t: 'kv', rows: tenants.flatMap((t, i): [string, string][] => {
      const k = coloc ? `Colocataire ${i + 1}` : 'Locataire';
      return [[`${k} : nom et prénom`, tenantFull(t)], ...(t.email ? [[`${k} : adresse électronique (facultatif)`, t.email] as [string, string]] : []),
        ...(t.phone ? [[`${k} : numéro de téléphone portable (facultatif)`, t.phone] as [string, string]] : [])];
    }) },
    { t: 'p', text: `désigné(s) ci-après « le locataire »${coloc ? ' (colocation)' : ''}.` },
    ...(c.guarantor ? [{ t: 'p', text: `Le cas échéant, garant : ${c.guarantor}.` } as Block] : []),
    { t: 'p', text: 'Il a été convenu ce qui suit :' },
  ] });

  // ---------- II. Objet du contrat
  s.push({ title: 'II. Objet du contrat', blocks: [
    { t: 'p', text: `Le présent contrat a pour objet la location d’un logement${furnished ? ' meublé' : ''} ainsi déterminé :` },
    { t: 'p', text: 'A. Consistance du logement' },
    { t: 'kv', rows: [
      ['Localisation du logement', address(p)],
      ['Identifiant fiscal du logement', c.tax_id || '—'],
      ['Type d’habitat', c.building_type === 'individuel' ? 'Individuel' : 'Immeuble collectif'],
      ['Régime juridique de l’immeuble', c.ownership_regime === 'monopropriete' ? 'Monopropriété' : 'Copropriété'],
      ['Période de construction', c.construction_period ? CONSTRUCTION_LABELS[c.construction_period] : '—'],
      ['Surface habitable', c.surface ? `${String(c.surface).replace('.', ',')} m²` : '—'],
      ['Nombre de pièces principales', c.rooms ? String(c.rooms) : '—'],
      ['Le cas échéant, autres parties du logement', c.other_parts || NA],
      ['Le cas échéant, éléments d’équipements du logement', c.equipment || (furnished ? 'Cuisine équipée, installations sanitaires' : NA)],
      ['Modalité de production de chauffage', c.heating === 'collectif' ? `Collectif${c.collective_split ? ` (répartition : ${c.collective_split})` : ''}` : 'Individuel'],
      ['Modalité de production d’eau chaude sanitaire', c.hot_water === 'collectif' ? `Collective${c.collective_split && c.heating !== 'collectif' ? ` (répartition : ${c.collective_split})` : ''}` : 'Individuelle'],
      ['Niveau de performance du logement (classe du diagnostic de performance énergétique)', p.dpe ? `Classe ${p.dpe}` : '—'],
    ] },
    { t: 'p', text: 'Rappel : un logement décent doit respecter les critères minimaux de performance suivants : en France métropolitaine, à compter du 1er janvier 2025, le niveau de performance minimal du logement correspond à la classe F du DPE ; à compter du 1er janvier 2028, à la classe E ; à compter du 1er janvier 2034, à la classe D. En Guadeloupe, Martinique, Guyane, à La Réunion et à Mayotte, à compter du 1er janvier 2028, à la classe F ; à compter du 1er janvier 2031, à la classe E. La consommation d’énergie finale et le niveau de performance du logement sont déterminés selon la méthode du DPE mentionné à l’article L. 126-26 du code de la construction et de l’habitation.' },
    { t: 'p', text: `B. Destination des locaux : ${c.usage === 'mixte' ? 'usage mixte professionnel et d’habitation' : 'usage d’habitation'}.` },
    ...(c.principal_residence_servitude ? [{ t: 'p', text: 'Le logement est soumis aux dispositions de l’article L. 151-14-1 du code de l’urbanisme : il doit être occupé exclusivement à titre de résidence principale, au sens de l’article 2 de la loi n° 89-462 du 6 juillet 1989.' } as Block] : []),
    { t: 'kv', rows: [
      ['C. Le cas échéant, désignation des locaux et équipements accessoires de l’immeuble à usage privatif du locataire', c.private_annexes || NA],
      ['D. Le cas échéant, énumération des locaux, parties, équipements et accessoires de l’immeuble à usage commun', c.common_areas || NA],
      ['E. Le cas échéant, équipement d’accès aux technologies de l’information et de la communication', c.telecom || NA],
    ] },
  ] });

  // ---------- III. Date de prise d'effet et durée
  const durationText = c.kind === 'vide'
    ? (reduced
      ? 'Le contrat est conclu pour une durée réduite, au moins égale à un an, le bailleur personne physique justifiant d’un événement précis qui le conduit à reprendre le logement pour des raisons professionnelles ou familiales. Le bailleur confirme la réalisation de l’événement au locataire, par lettre recommandée avec demande d’avis de réception, deux mois au moins avant le terme du contrat.'
      : `En l’absence de proposition de renouvellement du contrat, celui-ci est, à son terme, reconduit tacitement pour ${c.landlord_kind === 'morale' ? '6 ans' : '3 ans'} et dans les mêmes conditions.`)
    : c.student
      ? 'Location consentie à un étudiant pour une durée de neuf mois : le contrat n’est pas reconduit tacitement et prend fin à son terme.'
      : 'En l’absence de proposition de renouvellement du contrat, celui-ci est, à son terme, reconduit tacitement pour une durée d’un an et dans les mêmes conditions.';
  s.push({ title: 'III. Date de prise d’effet et durée du contrat', blocks: [
    { t: 'p', text: 'La durée du contrat et sa date de prise d’effet sont ainsi définies :' },
    { t: 'kv', rows: [
      ['A. Date de prise d’effet du contrat', frDate(l.start_date)],
      ['B. Durée du contrat', `${months(duration)}${furnished && c.student ? ' (location consentie à un étudiant)' : ''}`],
      ...(c.kind === 'vide' ? [['C. Le cas échéant, événement et raison justifiant la durée réduite du contrat de location', reduced ? c.reduced_reason! : NA] as [string, string]] : []),
    ] },
    { t: 'p', text: durationText },
    { t: 'p', text: furnished
      ? 'Le locataire peut mettre fin au bail à tout moment, après avoir donné congé avec un préavis d’un mois. Le bailleur peut, lorsqu’il donne congé à son locataire, mettre fin au bail à son échéance et après un préavis de trois mois, pour reprendre le logement en vue de l’occuper lui-même ou une personne de sa famille, pour le vendre, ou pour un motif sérieux et légitime.'
      : 'Le locataire peut mettre fin au bail à tout moment, après avoir donné congé dans les conditions de forme et de délai prévues par la loi : préavis de trois mois, réduit à un mois dans les cas prévus par l’article 15 de la loi du 6 juillet 1989 (notamment logement situé en zone tendue, obtention d’un premier emploi, mutation, perte d’emploi, nouvel emploi consécutif à une perte d’emploi, état de santé, bénéficiaire du revenu de solidarité active ou de l’allocation aux adultes handicapés, attribution d’un logement social). Le bailleur peut, lorsqu’il donne congé à son locataire, mettre fin au bail à son échéance et après un préavis de six mois, pour reprendre le logement en vue de l’occuper lui-même ou une personne de sa famille, pour le vendre, ou pour un motif sérieux et légitime.' },
    { t: 'p', text: 'Le congé est notifié par lettre recommandée avec demande d’avis de réception, par acte de commissaire de justice ou par remise en main propre contre récépissé ou émargement.' },
  ] });

  // ---------- IV. Conditions financières
  const L = (i: number) => 'ABCDEFG'[i]!;
  let k = 0;
  const fin: Block[] = [{ t: 'p', text: 'Les parties conviennent des conditions financières suivantes :' }];
  fin.push({ t: 'p', text: `${L(k++)}. Loyer` });
  fin.push({ t: 'kv', rows: [
    ['1° Fixation du loyer initial – a) Montant du loyer mensuel', eur(l.rent_hc)],
    ['b) Le cas échéant, logement soumis au décret fixant annuellement le montant maximum d’évolution des loyers à la relocation', c.zone_tendue ? 'Oui' : 'Non'],
    ['Logement soumis au loyer de référence majoré fixé par arrêté préfectoral', c.zone_tendue && c.reference_rent_increased ? 'Oui' : 'Non'],
    ...(c.zone_tendue && c.reference_rent_increased ? [
      ['Montant du loyer de référence', `${eur(c.reference_rent)}/m²/mois`],
      ['Montant du loyer de référence majoré', `${eur(c.reference_rent_increased)}/m²/mois`],
      ['Le cas échéant, complément de loyer', c.rent_complement ? `${eur(c.rent_complement)} – caractéristiques justifiant le complément : ${c.rent_complement_reason ?? ''}` : NA],
    ] as [string, string][] : []),
    ['c) Le cas échéant, informations relatives au loyer du dernier locataire', c.previous_rent ? `${eur(c.previous_rent)}${c.previous_rent_date ? `, date de versement : ${frDate(c.previous_rent_date)}` : ''}` : NA],
  ] });
  if (p.dpe === 'F' || p.dpe === 'G') {
    fin.push({ t: 'p', text: '2° Révision : sans objet. Logement classé F ou G : le loyer ne peut faire l’objet d’aucune révision, majoration ni réévaluation (article 17-1 de la loi du 6 juillet 1989).' });
  } else if (l.irl_enabled) {
    fin.push({ t: 'kv', rows: [
      ['2° Le cas échéant, modalités de révision – a) Date de révision', c.revision_date ? frDate(c.revision_date) : 'Chaque année, à la date anniversaire du contrat'],
      ['b) Date ou trimestre de référence de l’IRL', l.irl_base_label ? `${l.irl_base_label.replace('-T', ', ')}e trimestre${l.irl_base_value ? ` (valeur ${String(l.irl_base_value).replace('.', ',')})` : ''}` : '—'],
    ] });
  } else fin.push({ t: 'p', text: '2° Le cas échéant, modalités de révision : sans objet (loyer non révisable en cours de bail).' });

  fin.push({ t: 'p', text: `${L(k++)}. Charges récupérables` });
  fin.push({ t: 'kv', rows: [
    ['1. Modalité de règlement des charges récupérables', l.charges_mode === 'forfait' ? (furnished ? 'Forfait' : 'Forfait (colocation)') : l.charges_amount ? 'Provisions sur charges avec régularisation annuelle' : 'Paiement périodique des charges sans provision'],
    ['2. Le cas échéant, montant des provisions sur charges ou du forfait de charges', l.charges_amount ? `${eur(l.charges_amount)} par mois` : NA],
    ['3. Le cas échéant, modalités de révision du forfait de charges', l.charges_mode === 'forfait' ? 'Révision chaque année aux mêmes conditions que le loyer principal' : NA],
  ] });
  if (!furnished) {
    fin.push({ t: 'p', text: `${L(k++)}. Le cas échéant, contribution pour le partage des économies de charges : ${c.charges_economy?.trim() || 'sans objet'}.` });
  }
  fin.push({ t: 'p', text: `${L(k++)}. Le cas échéant, en cas de colocation, souscription par le bailleur d’une assurance pour le compte des colocataires : ${coloc && c.coloc_insurance_annual ? `oui – montant total annuel récupérable : ${eur(c.coloc_insurance_annual)}, montant récupérable par douzième : ${eur(Math.round(c.coloc_insurance_annual / 12 * 100) / 100)}` : coloc ? 'non' : 'sans objet'}.` });
  fin.push({ t: 'p', text: `${L(k++)}. Modalités de paiement` });
  fin.push({ t: 'kv', rows: [
    ['Périodicité du paiement', 'Mensuelle'],
    ['Paiement', c.payment_terms === 'echu' ? 'À terme échu' : 'À échoir'],
    ['Date ou période de paiement', `Le ${l.payment_day} de chaque mois`],
    ['Le cas échéant, lieu de paiement', c.payment_place || 'Virement sur le compte indiqué par le bailleur'],
    ['Le cas échéant, montant total dû à la première échéance de paiement pour une période complète de location', `${eur(l.rent_hc + l.charges_amount)} (loyer hors charges ${eur(l.rent_hc)}, ${l.charges_mode === 'forfait' ? 'forfait' : 'provision'} de charges ${eur(l.charges_amount)})`],
  ] });
  fin.push({ t: 'p', text: `${L(k++)}. Le cas échéant, exclusivement lors d’un renouvellement de contrat, modalités de réévaluation d’un loyer manifestement sous-évalué : ${c.rent_reassessment?.trim() || 'sans objet'}.` });
  fin.push({ t: 'p', text: `${L(k++)}. Dépenses énergétiques (pour information) : montant estimé des dépenses annuelles d’énergie pour un usage standard : ${c.energy_cost_min && c.energy_cost_max ? `entre ${eur(c.energy_cost_min)} et ${eur(c.energy_cost_max)} par an${c.energy_ref_year ? `, prix moyens des énergies indexés au 1er janvier ${c.energy_ref_year} (abonnements compris)` : ''}` : '—'}.` });
  s.push({ title: 'IV. Conditions financières', blocks: fin });

  // ---------- V. Travaux
  s.push({ title: 'V. Travaux', blocks: [
    { t: 'kv', rows: [
      ['A. Le cas échéant, montant et nature des travaux d’amélioration ou de mise en conformité avec les caractéristiques de décence effectués depuis la fin du dernier contrat de location ou depuis le dernier renouvellement', c.works_done || NA],
      ['B. Le cas échéant, majoration du loyer en cours de bail consécutive à des travaux d’amélioration entrepris par le bailleur', c.works_landlord || NA],
      ['C. Le cas échéant, diminution de loyer en cours de bail consécutive à des travaux entrepris par le locataire', c.works_tenant || NA],
    ] },
  ] });

  // ---------- VI. Garanties
  s.push({ title: 'VI. Garanties', blocks: [
    { t: 'p', text: `Le cas échéant, montant du dépôt de garantie de l’exécution des obligations du locataire (${furnished ? 'inférieur ou égal à deux mois' : 'inférieur ou égal à un mois'} de loyer hors charges) : ${l.deposit_amount ? eur(l.deposit_amount) : 'sans objet (aucun dépôt)'}.` },
    { t: 'p', text: 'Le dépôt de garantie est restitué dans un délai maximal d’un mois à compter de la remise des clés lorsque l’état des lieux de sortie est conforme à l’état des lieux d’entrée, et de deux mois dans le cas contraire, déduction faite, le cas échéant, des sommes restant dues au bailleur et des sommes dont celui-ci pourrait être tenu en lieu et place du locataire, sous réserve qu’elles soient dûment justifiées.' },
  ] });

  // ---------- VII. Clause de solidarité
  s.push({ title: 'VII. Clause de solidarité', blocks: [
    { t: 'p', text: coloc
      ? 'Modalités particulières des obligations en cas de pluralité de locataires : les colocataires sont tenus solidairement et indivisiblement de l’exécution des obligations du présent contrat. Conformément à l’article 8-1 de la loi du 6 juillet 1989, la solidarité d’un colocataire sortant et celle de la personne qui s’est portée caution pour lui prennent fin à la date d’effet du congé régulièrement délivré lorsqu’un nouveau colocataire figure au bail ou, à défaut, à l’expiration d’un délai de six mois après la date d’effet du congé.'
      : 'Sans objet (un seul locataire).' },
  ] });

  // ---------- VIII. Clause résolutoire (décret n° 2026-596 : partie obligatoire et clauses facultatives)
  const optional = [
    ...(c.clause_insurance !== false ? ['à défaut de souscription d’une assurance des risques locatifs par le locataire, un mois après un commandement demeuré infructueux ;'] : []),
    ...(c.clause_neighbours !== false ? ['en cas de non-respect par le locataire de son obligation d’user paisiblement des locaux loués, résultant de troubles de voisinage constatés par une décision de justice passée en force de chose jugée ;'] : []),
    ...(c.principal_residence_servitude ? ['lorsque le logement est soumis à l’article L. 151-14-1 du code de l’urbanisme, en cas de non-respect par le locataire de son obligation d’occuper le logement exclusivement à titre de résidence principale ; la clause ne produit effet qu’à l’expiration du délai de mise en demeure fixé par le maire en application du II de l’article L. 481-4 du même code.'] : []),
  ];
  s.push({ title: 'VIII. Clause résolutoire', blocks: [
    { t: 'p', text: 'Modalités de résiliation de plein droit du contrat : le présent contrat est résilié de plein droit, à défaut de paiement du loyer ou des charges dûment justifiées aux termes convenus, ou à défaut de versement du dépôt de garantie, six semaines après un commandement de payer demeuré infructueux.' },
    ...(optional.length ? [{ t: 'p', text: 'Il est également résilié de plein droit :' } as Block, { t: 'list', items: optional } as Block] : []),
  ] });

  // ---------- IX. Honoraires de location
  const hasFees = [c.agency_fees_tenant, c.agency_fees_landlord, c.agency_fees_tenant_edl, c.agency_fees_landlord_edl, c.agency_fees_landlord_other].some((x) => x && x > 0);
  s.push({ title: 'IX. Le cas échéant, honoraires de location', blocks: hasFees ? [
    { t: 'p', text: 'A. Dispositions applicables : la rémunération des personnes mandatées pour se livrer ou prêter leur concours à l’entremise ou à la négociation d’une mise en location d’un logement est à la charge exclusive du bailleur, à l’exception des honoraires liés aux prestations de visite du preneur, de constitution de son dossier, de rédaction du bail et d’établissement de l’état des lieux d’entrée (article 5 de la loi du 6 juillet 1989). Les honoraires imputables au locataire ne peuvent excéder ceux imputés au bailleur et sont plafonnés par mètre carré de surface habitable.' },
    { t: 'kv', rows: [
      ['Plafond des honoraires imputables aux locataires (visite, constitution du dossier, rédaction du bail)', c.agency_cap_m2 ? `${eur(c.agency_cap_m2)}/m² de surface habitable` : '—'],
      ['Plafond des honoraires imputables aux locataires (état des lieux d’entrée)', c.agency_cap_edl_m2 ? `${eur(c.agency_cap_edl_m2)}/m² de surface habitable` : '—'],
    ] },
    { t: 'p', text: 'B. Détail et répartition des honoraires' },
    { t: 'kv', rows: [
      ['1. À la charge du bailleur : visite du preneur, constitution de son dossier et rédaction de bail', eur(c.agency_fees_landlord ?? 0)],
      ['Le cas échéant, établissement de l’état des lieux d’entrée', eur(c.agency_fees_landlord_edl ?? 0)],
      ['Le cas échéant, autres prestations', eur(c.agency_fees_landlord_other ?? 0)],
      ['2. À la charge du locataire : visite du preneur, constitution de son dossier et rédaction de bail', eur(c.agency_fees_tenant ?? 0)],
      ['Le cas échéant, établissement de l’état des lieux d’entrée', eur(c.agency_fees_tenant_edl ?? 0)],
    ] },
  ] : [{ t: 'p', text: 'Sans objet (aucun professionnel mandaté et rémunéré pour la mise en location).' }] });

  // ---------- X. Autres conditions particulières
  s.push({ title: 'X. Autres conditions particulières', blocks: [
    { t: 'p', text: c.special_conditions?.trim() || 'Néant.' },
    ...(furnished ? [
      { t: 'p', text: 'Le logement est loué meublé. Il comporte au minimum les éléments de mobilier suivants (décret n° 2015-981 du 31 juillet 2015), dont l’inventaire et l’état détaillé sont annexés au présent contrat :' } as Block,
      { t: 'list', items: c.furniture?.length ? c.furniture : FURNITURE_MINIMUM } as Block,
    ] : []),
  ] });

  // ---------- XI. Annexes
  const annexes: string[] = [
    `A. Le cas échéant, un extrait du règlement concernant la destination de l’immeuble, la jouissance et l’usage des parties privatives et communes, et précisant la quote-part afférente au lot loué dans chacune des catégories de charges : ${c.ownership_regime === 'copropriete' ? 'joint' : 'sans objet'}`,
    `B. Un dossier de diagnostic technique comprenant : un diagnostic de performance énergétique ; ${c.construction_period === 'avant_1949' ? 'un constat de risque d’exposition au plomb (immeuble construit avant le 1er janvier 1949)' : 'le cas échéant, un constat de risque d’exposition au plomb (immeubles construits avant le 1er janvier 1949) : sans objet'} ; le cas échéant, une copie d’un état mentionnant l’absence ou la présence de matériaux ou de produits de la construction contenant de l’amiante ; le cas échéant, un état de l’installation intérieure d’électricité et de gaz ; le cas échéant, un état des risques naturels et technologiques`,
    'C. Une notice d’information relative aux droits et obligations des locataires et des bailleurs',
    furnished ? 'D. Un état des lieux, un inventaire et un état détaillé du mobilier' : 'D. Un état des lieux',
    `E. Le cas échéant, une autorisation préalable de mise en location : ${c.rental_permit ? 'jointe' : 'sans objet'}`,
    `F. Le cas échéant, les références aux loyers habituellement constatés dans le voisinage pour des logements comparables : ${c.zone_tendue ? 'jointes le cas échéant' : 'sans objet'}`,
    ...(c.guarantor ? ['Acte de cautionnement'] : []),
  ];
  s.push({ title: 'XI. Annexes', blocks: [{ t: 'p', text: 'Sont annexées et jointes au contrat de location les pièces suivantes :' }, { t: 'list', items: annexes }] });
  s.push(signatureSection(c, ctx));
  return s;
}

function civilSections(c: LeaseContract, ctx: ContractContext): DocSection[] {
  const { lease: l, property: p, tenants } = ctx;
  const parking = c.kind === 'parking';
  const company = c.kind === 'civil_societe';
  const duration = c.duration_months ?? 12;
  const end = addMonthsIso(l.start_date, duration);
  const notice = c.notice_months ?? (parking ? 1 : 3);
  const s: DocSection[] = [];
  s.push({ title: '1. Parties', blocks: [
    { t: 'kv', rows: landlordRows(c, l) },
    { t: 'p', text: 'ci-après « le bailleur » ;' },
    { t: 'kv', rows: company ? [
      ['Preneur', c.company_name || '—'],
      ...(c.company_id ? [['Immatriculation (SIREN)', c.company_id] as [string, string]] : []),
      ['Représentée par', c.company_representative || '—'],
    ] : tenantRows(ctx) },
    { t: 'p', text: 'ci-après « le preneur ».' },
  ] });
  s.push({ title: '2. Objet et destination', blocks: parking ? [
    { t: 'kv', rows: [['Adresse', address(p)], ['Emplacement', c.parking_spot || '—'], ...(c.private_annexes ? [['Accessoires', c.private_annexes] as [string, string]] : [])] },
    { t: 'p', text: 'L’emplacement est loué exclusivement pour le stationnement d’un véhicule. Il ne peut servir ni d’habitation, ni d’atelier, ni d’entrepôt ; aucun produit inflammable ou dangereux ne peut y être stocké.' },
  ] : [
    { t: 'kv', rows: [['Adresse du logement', address(p)], ['Surface', c.surface ? `${String(c.surface).replace('.', ',')} m²` : '—'], ['Pièces principales', c.rooms ? String(c.rooms) : '—'],
      ['Équipements', c.equipment || 'Néant'], ['Annexes privatives', c.private_annexes || 'Néant']] },
    { t: 'p', text: company
      ? `Le logement est loué à usage exclusif d’habitation, pour y loger ${c.occupant_name || 'l’occupant désigné'}, désigné(e) par le preneur. Le preneur, personne morale, ne peut y loger une autre personne sans l’accord écrit du bailleur. La présente location est régie par les articles 1714 et suivants du Code civil, la loi du 6 juillet 1989 ne s’appliquant pas aux locations consenties à une personne morale.`
      : 'Le logement est loué à usage d’habitation, à titre de résidence secondaire. Le preneur déclare disposer par ailleurs d’une résidence principale. La présente location, ne portant pas sur la résidence principale du preneur, est régie par les articles 1714 et suivants du Code civil et non par la loi du 6 juillet 1989.' },
  ] });
  s.push({ title: '3. Durée', blocks: [
    { t: 'p', text: `Le bail prend effet le ${frDate(l.start_date)} pour une durée de ${months(duration)}, soit jusqu’au ${frDate(end)}. ${c.tacit_renewal !== false ? `À défaut de congé, il est reconduit tacitement pour une durée de ${months(duration)}.` : 'Il prend fin à son terme sans reconduction tacite.'}` },
    { t: 'p', text: `Chaque partie peut donner congé ${parking ? 'à tout moment' : 'pour le terme du bail ou de chaque période de reconduction'} avec un préavis de ${notice} mois, par lettre recommandée avec demande d’avis de réception ou par acte de commissaire de justice.` },
  ] });
  const fin: Block[] = [
    { t: 'kv', rows: [
      ['Loyer mensuel', eur(l.rent_hc)],
      ...(l.charges_amount ? [[l.charges_mode === 'forfait' ? 'Forfait de charges' : 'Provision sur charges (régularisation annuelle)', eur(l.charges_amount)] as [string, string]] : []),
      ['Paiement', `${c.payment_terms === 'echu' ? 'À terme échu' : 'D’avance'}, le ${l.payment_day} de chaque mois`],
      ['Lieu de paiement', c.payment_place || 'Virement sur le compte indiqué par le bailleur'],
    ] },
    { t: 'p', text: l.irl_enabled
      ? `Le loyer est révisé chaque année à la date anniversaire du bail selon la variation de l’indice de référence des loyers publié par l’INSEE (trimestre de référence : ${l.irl_base_label ? l.irl_base_label.replace('-T', ', ') + 'e trimestre' : '—'}).`
      : 'Le loyer n’est pas révisable en cours de bail.' },
    { t: 'p', text: `Dépôt de garantie : ${eur(l.deposit_amount)}${l.deposit_amount ? ', restitué dans les deux mois de la restitution des clés, déduction faite des sommes dues au bailleur et dûment justifiées' : ''}.` },
  ];
  s.push({ title: '4. Conditions financières', blocks: fin });
  s.push({ title: '5. Obligations du preneur', blocks: [
    { t: 'list', items: [
      'payer le loyer et les charges aux termes convenus ;',
      `user paisiblement des lieux suivant la destination prévue au contrat${parking ? '' : ', et répondre des dégradations survenues pendant la location'} ;`,
      parking ? 'maintenir l’emplacement propre et respecter le règlement de l’immeuble ;' : 'prendre à sa charge l’entretien courant et les réparations locatives ;',
      `s’assurer contre les risques dont il doit répondre${parking ? ' (responsabilité civile du véhicule)' : ' (incendie, dégâts des eaux, risques locatifs)'} et en justifier à la demande du bailleur ;`,
      'ne pas sous-louer ni céder le bail sans l’accord écrit du bailleur ;',
      'laisser exécuter les travaux nécessaires et restituer les lieux en bon état à la fin du bail.',
    ] },
  ] });
  s.push({ title: '6. Obligations du bailleur', blocks: [
    { t: 'p', text: 'Le bailleur délivre les lieux en bon état d’usage et de réparations, en assure la jouissance paisible pendant la durée du bail et y fait les réparations autres que locatives (article 1720 du Code civil).' },
  ] });
  s.push({ title: '7. Clause résolutoire', blocks: [
    { t: 'p', text: 'À défaut de paiement d’un seul terme de loyer ou des charges à son échéance, ou de justification de l’assurance, et un mois après un commandement demeuré infructueux, le bail sera résilié de plein droit si bon semble au bailleur.' },
  ] });
  s.push({ title: '8. État des lieux et conditions particulières', blocks: [
    { t: 'p', text: 'Un état des lieux contradictoire est établi à l’entrée et à la sortie du preneur.' },
    { t: 'p', text: c.special_conditions?.trim() || 'Néant.' },
  ] });
  s.push(signatureSection(c, ctx, company ? [c.company_name || 'Le preneur'] : undefined));
  void tenants;
  return s;
}

function signatureSection(c: LeaseContract, ctx: ContractContext, preneurs?: string[]): DocSection {
  const copies = 1 + (preneurs?.length ?? (ctx.tenants.length || 1));
  return { title: 'Signatures', blocks: [
    { t: 'p', text: `Fait à ${c.signed_place || ctx.property.city || '…'}, le ${frDate(c.signed_on ?? ctx.today)}, en ${copies} exemplaires originaux, dont un remis à chaque signataire.` },
    { t: 'p', text: 'Signature précédée de la mention manuscrite « lu et approuvé ».' },
    { t: 'sign', parties: [`Le bailleur${ctx.lease.landlord_name ? ` : ${ctx.lease.landlord_name}` : ''}`, ...(preneurs ?? ctx.tenants.map((t) => `Le locataire : ${tenantFull(t)}`))] },
  ] };
}

/** Texte brut du contrat (aperçu, tests). */
export function contractText(doc: ContractDoc): string {
  const out: string[] = [doc.title, doc.subtitle, ''];
  for (const s of doc.sections) {
    out.push(s.title);
    for (const b of s.blocks) {
      if (b.t === 'p') out.push(b.text);
      else if (b.t === 'kv') for (const [k, v] of b.rows) out.push(`${k} : ${v}`);
      else if (b.t === 'list') for (const it of b.items) out.push(`- ${it}`);
      else out.push(b.parties.join(' / '));
    }
    out.push('');
  }
  return out.join('\n');
}
