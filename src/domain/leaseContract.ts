/**
 * Génération des contrats de bail.
 *
 *  - Location vide et location meublée à usage de résidence principale : structure et mentions des contrats types
 *    du décret n° 2015-587 du 29 mai 2015 (annexe 1 : logement nu, annexe 2 : logement meublé), pris pour
 *    l'application de l'article 3 de la loi n° 89-462 du 6 juillet 1989, mis à jour (décence énergétique,
 *    dépenses d'énergie, clause résolutoire après six semaines).
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
      ? `Soumis au ${c.kind === 'vide' ? 'titre Ier' : 'titre Ier bis'} de la loi n° 89-462 du 6 juillet 1989 tendant à améliorer les rapports locatifs – contrat type défini par le décret n° 2015-587 du 29 mai 2015`
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

function housingSections(c: LeaseContract, ctx: ContractContext): DocSection[] {
  const { lease: l, property: p, tenants } = ctx;
  const furnished = c.kind === 'meuble';
  const coloc = tenants.length > 1;
  const duration = c.duration_months ?? defaultDuration(c.kind, c.landlord_kind, c.student);
  const reduced = c.kind === 'vide' && !!c.reduced_reason?.trim() && duration < 36;
  const s: DocSection[] = [];

  s.push({ title: 'I. Désignation des parties', blocks: [
    { t: 'p', text: 'Le présent contrat est conclu entre les soussignés :' },
    { t: 'kv', rows: landlordRows(c, l) },
    { t: 'p', text: 'désigné(s) ci-après « le bailleur » ;' },
    { t: 'kv', rows: tenantRows(ctx) },
    { t: 'p', text: `désigné(s) ci-après « le locataire »${coloc ? ' (colocation)' : ''}.` },
    ...(c.guarantor ? [{ t: 'p', text: `Garant : ${c.guarantor} (acte de cautionnement annexé).` } as Block] : []),
  ] });

  s.push({ title: 'II. Objet du contrat', blocks: [
    { t: 'p', text: `Le présent contrat a pour objet la location d’un logement${furnished ? ' meublé' : ''} ainsi déterminé :` },
    { t: 'kv', rows: [
      ['A. Localisation du logement', address(p)],
      ...(c.tax_id ? [['Identifiant fiscal du logement', c.tax_id] as [string, string]] : []),
      ['Type d’habitat', c.building_type === 'individuel' ? 'Individuel' : 'Immeuble collectif'],
      ['Régime juridique de l’immeuble', c.ownership_regime === 'monopropriete' ? 'Monopropriété' : 'Copropriété'],
      ['Période de construction', c.construction_period ? CONSTRUCTION_LABELS[c.construction_period] : '—'],
      ['Surface habitable', c.surface ? `${String(c.surface).replace('.', ',')} m²` : '—'],
      ['Nombre de pièces principales', c.rooms ? String(c.rooms) : '—'],
      ['Autres parties du logement', c.other_parts || 'Néant'],
      ['Éléments d’équipement du logement', c.equipment || (furnished ? 'Cuisine équipée, installations sanitaires' : 'Installations sanitaires')],
      ['Production de chauffage', c.heating === 'collectif' ? 'Collective' : 'Individuelle'],
      ['Production d’eau chaude sanitaire', c.hot_water === 'collectif' ? 'Collective' : 'Individuelle'],
      ...((c.heating === 'collectif' || c.hot_water === 'collectif') ? [['Répartition de la consommation (collectif)', c.collective_split || 'Selon le règlement de copropriété'] as [string, string]] : []),
      ['Niveau de performance énergétique (DPE)', p.dpe ? `Classe ${p.dpe}` : '—'],
    ] },
    { t: 'p', text: 'Rappel : un logement décent doit respecter un niveau de performance minimal. En France métropolitaine, il doit être au moins de classe F depuis le 1er janvier 2025, de classe E à compter du 1er janvier 2028 et de classe D à compter du 1er janvier 2034 (article 6 de la loi du 6 juillet 1989).' },
    { t: 'kv', rows: [
      ['B. Destination des locaux', c.usage === 'mixte' ? 'Usage mixte professionnel et d’habitation' : 'Usage d’habitation'],
      ['C. Locaux et équipements accessoires à usage privatif', c.private_annexes || 'Néant'],
      ['D. Locaux, parties, équipements et accessoires à usage commun', c.common_areas || 'Néant'],
      ['E. Équipement d’accès aux technologies de l’information et de la communication', c.telecom || 'Néant'],
    ] },
  ] });

  const startRows: [string, string][] = [
    ['A. Date de prise d’effet', frDate(l.start_date)],
    ['B. Durée du contrat', `${months(duration)}${c.kind === 'meuble' && c.student ? ' (location à un étudiant)' : ''}`],
  ];
  const durationText = c.kind === 'vide'
    ? (reduced
      ? `Le bailleur, personne physique, conclut le contrat pour une durée réduite, au moins égale à un an, en raison de l’événement suivant, justifiant qu’il reprenne le logement pour des raisons professionnelles ou familiales : ${c.reduced_reason}. Le bailleur confirme la réalisation de l’événement au locataire deux mois au moins avant le terme du contrat.`
      : `En l’absence de proposition de renouvellement du contrat, celui-ci est, à son terme, reconduit tacitement pour ${c.landlord_kind === 'morale' ? '6 ans' : '3 ans'} et dans les mêmes conditions.`)
    : c.student
      ? 'Location consentie à un étudiant pour une durée de neuf mois : le contrat n’est pas reconduit tacitement et prend fin à son terme.'
      : 'En l’absence de proposition de renouvellement du contrat, celui-ci est, à son terme, reconduit tacitement pour un an et dans les mêmes conditions.';
  s.push({ title: 'III. Date de prise d’effet et durée du contrat', blocks: [
    { t: 'kv', rows: startRows },
    { t: 'p', text: durationText },
    { t: 'p', text: furnished
      ? 'Le locataire peut mettre fin au bail à tout moment, après avoir donné congé avec un préavis d’un mois. Le bailleur peut, lorsqu’il donne congé à son locataire, mettre fin au bail à son échéance et après un préavis de trois mois, pour reprendre le logement en vue de l’occuper lui-même ou une personne de sa famille, pour le vendre, ou pour un motif sérieux et légitime.'
      : 'Le locataire peut mettre fin au bail à tout moment, après avoir donné congé avec un préavis de trois mois, réduit à un mois dans les cas prévus par la loi (notamment logement situé en zone tendue, obtention d’un premier emploi, mutation, perte d’emploi, nouvel emploi consécutif à une perte d’emploi, état de santé, bénéficiaire du RSA ou de l’allocation adulte handicapé, attribution d’un logement social). Le bailleur peut, lorsqu’il donne congé à son locataire, mettre fin au bail à son échéance et après un préavis de six mois, pour reprendre le logement en vue de l’occuper lui-même ou une personne de sa famille, pour le vendre, ou pour un motif sérieux et légitime.' },
    { t: 'p', text: 'Le congé doit être notifié par lettre recommandée avec demande d’avis de réception, par acte de commissaire de justice ou par remise en main propre contre récépissé ou émargement.' },
  ] });

  const rentBlocks: Block[] = [
    { t: 'kv', rows: [
      ['Montant du loyer mensuel hors charges', eur(l.rent_hc)],
      ...(c.zone_tendue ? [
        ['Logement soumis au décret fixant annuellement l’évolution maximale des loyers à la relocation', 'Oui'],
        ['Loyer de référence (€/m²/mois)', eur(c.reference_rent)],
        ['Loyer de référence majoré (€/m²/mois)', eur(c.reference_rent_increased)],
        ...(c.rent_complement ? [['Complément de loyer', `${eur(c.rent_complement)} – ${c.rent_complement_reason ?? ''}`] as [string, string]] : []),
      ] as [string, string][] : []),
      ...(c.previous_rent ? [['Loyer du précédent locataire', `${eur(c.previous_rent)}${c.previous_rent_date ? `, dernier versement le ${frDate(c.previous_rent_date)}` : ''}`] as [string, string]] : []),
    ] },
  ];
  if (p.dpe === 'F' || p.dpe === 'G') rentBlocks.push({ t: 'p', text: 'Logement classé F ou G : le loyer ne peut faire l’objet d’aucune révision, majoration ni réévaluation (article 17-1 de la loi du 6 juillet 1989).' });
  else if (l.irl_enabled) {
    rentBlocks.push({ t: 'p', text: `Révision du loyer : le loyer est révisé chaque année à la date anniversaire du contrat, en fonction de la variation de l’indice de référence des loyers (IRL) publié par l’INSEE. Trimestre de référence : ${l.irl_base_label ? l.irl_base_label.replace('-T', ', ') + 'e trimestre' : '—'}${l.irl_base_value ? ` (valeur ${String(l.irl_base_value).replace('.', ',')})` : ''}. À défaut de manifestation du bailleur dans un délai d’un an suivant cette date, il est réputé avoir renoncé à la révision pour l’année écoulée.` });
  } else rentBlocks.push({ t: 'p', text: 'Le loyer n’est pas révisable en cours de bail.' });
  const chargesText = l.charges_mode === 'forfait'
    ? `Charges récupérables : forfait mensuel de ${eur(l.charges_amount)}, révisé chaque année dans les mêmes conditions que le loyer. Il ne donne lieu à aucune régularisation.`
    : `Charges récupérables : provisions mensuelles de ${eur(l.charges_amount)}, faisant l’objet d’une régularisation annuelle. Le bailleur communique au locataire, un mois avant cette régularisation, le décompte par nature de charges et, en immeuble collectif, le mode de répartition entre les locataires.`;
  rentBlocks.push({ t: 'p', text: chargesText });
  rentBlocks.push({ t: 'kv', rows: [
    ['Périodicité du paiement', 'Mensuelle'],
    ['Paiement', c.payment_terms === 'echu' ? 'À terme échu' : 'À échoir (d’avance)'],
    ['Date de paiement', `Le ${l.payment_day} de chaque mois`],
    ['Lieu de paiement', c.payment_place || 'Virement sur le compte indiqué par le bailleur'],
    ['Montant total dû à la première échéance', eur(l.rent_hc + l.charges_amount)],
  ] });
  if (c.energy_cost_min && c.energy_cost_max) {
    rentBlocks.push({ t: 'p', text: `Montant estimé des dépenses annuelles d’énergie pour un usage standard : entre ${eur(c.energy_cost_min)} et ${eur(c.energy_cost_max)} par an${c.energy_ref_year ? ` (prix de l’énergie indexés au 1er janvier ${c.energy_ref_year})` : ''}.` });
  }
  s.push({ title: 'IV. Conditions financières', blocks: rentBlocks });

  s.push({ title: 'V. Travaux', blocks: [
    { t: 'kv', rows: [
      ['Travaux réalisés depuis la fin du dernier contrat', c.works_done || 'Néant'],
      ['Majoration du loyer en cours de bail consécutive à des travaux d’amélioration du bailleur', c.works_landlord || 'Néant'],
      ['Diminution de loyer consécutive à des travaux entrepris par le locataire', c.works_tenant || 'Néant'],
    ] },
  ] });

  s.push({ title: 'VI. Garanties', blocks: [
    { t: 'p', text: `Dépôt de garantie : ${eur(l.deposit_amount)}${l.deposit_amount ? '' : ' (aucun dépôt)'}. Il ne peut excéder ${furnished ? 'deux mois' : 'un mois'} de loyer hors charges. Il est restitué dans un délai d’un mois à compter de la remise des clés lorsque l’état des lieux de sortie est conforme à l’état des lieux d’entrée, de deux mois dans le cas contraire, déduction faite des sommes restant dues au bailleur et dûment justifiées.` },
  ] });

  if (coloc) {
    s.push({ title: 'VII. Clause de solidarité', blocks: [
      { t: 'p', text: 'Les colocataires sont tenus solidairement et indivisiblement de l’exécution des obligations du présent contrat. La solidarité d’un colocataire sortant cesse lorsqu’un nouveau colocataire le remplace ou, à défaut, à l’expiration d’un délai de six mois après la date d’effet de son congé.' },
    ] });
  }

  s.push({ title: `${coloc ? 'VIII' : 'VII'}. Clause résolutoire`, blocks: [
    { t: 'p', text: 'Le présent contrat sera résilié immédiatement et de plein droit, sans qu’il soit besoin de faire ordonner cette résolution en justice :' },
    { t: 'list', items: [
      'six semaines après un commandement de payer demeuré infructueux, à défaut de paiement du loyer ou des charges dûment justifiées aux termes convenus, ou de versement du dépôt de garantie ;',
      'un mois après un commandement demeuré infructueux, à défaut d’assurance contre les risques locatifs ;',
      'en cas d’obligation d’user paisiblement des locaux loués non respectée, résultant de troubles de voisinage constatés par une décision de justice passée en force de chose jugée.',
    ] },
  ] });

  const n = (i: number) => ['VII', 'VIII', 'IX', 'X', 'XI', 'XII'][i + (coloc ? 1 : 0)];
  let i = 1;
  if (c.agency_fees_tenant || c.agency_fees_landlord) {
    s.push({ title: `${n(i++)}. Honoraires de location`, blocks: [
      { t: 'p', text: 'Rappel : la rémunération des personnes mandatées pour la mise en location est à la charge exclusive du bailleur, à l’exception des honoraires liés à la visite, à la constitution du dossier, à la rédaction du bail et à l’établissement de l’état des lieux d’entrée, partagés entre le bailleur et le locataire ; la part du locataire ne peut excéder celle du bailleur ni les plafonds réglementaires par mètre carré de surface habitable.' },
      { t: 'kv', rows: [['Honoraires à la charge du bailleur', eur(c.agency_fees_landlord ?? 0)], ['Honoraires à la charge du locataire', eur(c.agency_fees_tenant ?? 0)]] },
    ] });
  }
  s.push({ title: `${n(i++)}. Autres conditions particulières`, blocks: [
    { t: 'p', text: c.special_conditions?.trim() || 'Néant.' },
    { t: 'p', text: 'Le locataire s’assure contre les risques locatifs et en justifie lors de la remise des clés puis chaque année à la demande du bailleur. Il ne peut ni sous-louer ni céder le bail sans l’accord écrit du bailleur, y compris sur le prix du loyer.' },
  ] });

  const annexes = [
    ...(c.ownership_regime === 'copropriete' ? ['Extrait du règlement concernant la destination de l’immeuble, la jouissance et l’usage des parties privatives et communes, et la quote-part afférente au lot loué dans chacune des catégories de charges'] : []),
    `Dossier de diagnostic technique : diagnostic de performance énergétique${c.construction_period === 'avant_1949' ? ', constat de risque d’exposition au plomb' : ''}, état mentionnant l’absence ou la présence d’amiante (immeubles dont le permis de construire est antérieur au 1er juillet 1997), état de l’installation intérieure d’électricité et de gaz (installations de plus de quinze ans), état des risques et pollutions`,
    'Notice d’information relative aux droits et obligations des locataires et des bailleurs (arrêté du 29 mai 2015)',
    'État des lieux d’entrée',
    ...(furnished ? ['Inventaire et état détaillé du mobilier'] : []),
    ...(c.zone_tendue ? ['Références aux loyers habituellement constatés dans le voisinage pour des logements comparables (le cas échéant)'] : []),
    ...(c.guarantor ? ['Acte de cautionnement'] : []),
  ];
  if (furnished) {
    s.push({ title: `${n(i++)}. Mobilier`, blocks: [
      { t: 'p', text: 'Le logement est loué meublé. Il comporte au minimum les éléments de mobilier suivants, dont l’inventaire et l’état détaillé sont annexés au présent contrat :' },
      { t: 'list', items: c.furniture?.length ? c.furniture : FURNITURE_MINIMUM },
    ] });
  }
  s.push({ title: `${n(i++)}. Annexes`, blocks: [{ t: 'list', items: annexes }] });
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
