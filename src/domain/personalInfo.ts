/**
 * Mon compte > Informations personnelles : identité et situation de l'emprunteur (et du co-emprunteur), revenus,
 * épargne et crédits hors biens immobiliers. Elles pré-remplissent le dossier banque et l'offre d'achat.
 * Les crédits immobiliers des biens détenus viennent de « Mes biens » : ici, seulement les autres crédits.
 */
import type { Borrower, BorrowerLoan, BorrowerPerson } from './bankDossier.ts';
import { money } from './format.ts';
import { round2 } from './simulator.ts';
import type { PatrimonyLine } from './patrimony.ts';

export type Contract = 'cdi' | 'fonctionnaire' | 'cdd' | 'interim' | 'independant' | 'liberal' | 'dirigeant' | 'retraite' | 'sans_activite';
export type Family = 'celibataire' | 'marie' | 'pacse' | 'concubinage' | 'divorce' | 'veuf';
export type Housing = 'proprietaire' | 'locataire' | 'loge_gratuitement';
export type LoanKind = 'consommation' | 'auto' | 'travaux' | 'etudiant' | 'loa' | 'renouvelable' | 'immobilier_autre' | 'autre';

export const CONTRACT_LABELS: Record<Contract, string> = {
  cdi: 'Salarié en CDI', fonctionnaire: 'Fonctionnaire ou agent statutaire', cdd: 'Salarié en CDD', interim: 'Intérimaire',
  independant: 'Indépendant, commerçant, artisan', liberal: 'Profession libérale', dirigeant: 'Dirigeant de société',
  retraite: 'Retraité', sans_activite: 'Sans activité',
};
export const FAMILY_LABELS: Record<Family, string> = {
  celibataire: 'Célibataire', marie: 'Marié(e)', pacse: 'Pacsé(e)', concubinage: 'En concubinage', divorce: 'Divorcé(e)', veuf: 'Veuf ou veuve',
};
export const HOUSING_LABELS: Record<Housing, string> = { proprietaire: 'Propriétaire', locataire: 'Locataire', loge_gratuitement: 'Logé gratuitement' };
export const LOAN_KIND_LABELS: Record<LoanKind, string> = {
  consommation: 'Prêt personnel', auto: 'Crédit auto', travaux: 'Prêt travaux', etudiant: 'Prêt étudiant', loa: 'Location avec option d’achat (LOA, LLD)',
  renouvelable: 'Crédit renouvelable', immobilier_autre: 'Crédit immobilier d’un bien absent de « Mes biens »', autre: 'Autre crédit',
};

export interface PersonInfo {
  first_name?: string;
  last_name?: string;
  birth_date?: string | null;
  profession?: string;
  employer?: string;
  contract?: Contract | null;
  /** Date d'entrée dans l'emploi actuel (ancienneté). */
  since?: string | null;
  /** Revenus nets mensuels avant impôt (moyenne sur 12 mois, primes comprises). */
  income?: number | null;
}

export interface OtherLoan {
  id: string;
  kind: LoanKind;
  label?: string;
  lender?: string;
  /** Mensualité, assurance comprise. */
  monthly?: number | null;
  remaining?: number | null;
  end_date?: string | null;
}

export interface PersonalInfo {
  borrower?: PersonInfo;
  /** Co-emprunteur (conjoint, partenaire, associé) ; absent ou null : emprunt seul. */
  co_borrower?: PersonInfo | null;
  family?: Family | null;
  children?: number | null;
  address?: string;
  zip?: string;
  city?: string;
  phone?: string;
  email?: string;
  housing?: Housing | null;
  /** Loyer de la résidence principale, si locataire. */
  housing_rent?: number | null;
  /** Autres revenus mensuels réguliers du foyer (pensions, allocations…), hors loyers des biens. */
  other_income?: number | null;
  other_income_label?: string;
  /** Épargne disponible du foyer (livrets, assurance-vie…), avant l'apport du projet. */
  savings?: number | null;
  other_loans?: OtherLoan[];
  /** Présentation reprise en page de garde du dossier banque. */
  presentation?: string;
}

const clean = (s?: string | null) => (s ?? '').trim();
export const personName = (p?: PersonInfo | null) => [clean(p?.first_name), clean(p?.last_name)].filter(Boolean).join(' ');

/** « David et Marie Dupont », ou « David Dupont et Marie Martin ». */
export function borrowerNames(info: PersonalInfo): string {
  const a = info.borrower, b = info.co_borrower;
  const na = personName(a), nb = personName(b);
  if (!nb) return na;
  if (!na) return nb;
  if (clean(a?.last_name) && clean(a?.last_name).toLowerCase() === clean(b?.last_name).toLowerCase() && clean(a?.first_name) && clean(b?.first_name)) {
    return `${clean(a?.first_name)} et ${clean(b?.first_name)} ${clean(a?.last_name)}`;
  }
  return `${na} et ${nb}`;
}

export function fullAddress(info: PersonalInfo): string {
  return [clean(info.address), [clean(info.zip), clean(info.city)].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

export function ageOn(birth: string | null | undefined, today: string): number | null {
  if (!birth || !/^\d{4}-\d{2}-\d{2}/.test(birth)) return null;
  const [y, m, d] = birth.slice(0, 10).split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.slice(0, 10).split('-').map(Number) as [number, number, number];
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/** Crédits hors biens encore en cours à la date donnée. */
export function activeOtherLoans(info: PersonalInfo, today: string): OtherLoan[] {
  return (info.other_loans ?? []).filter((l) => (l.monthly ?? 0) > 0 && (!l.end_date || l.end_date >= today));
}

export function householdIncome(info: PersonalInfo): number {
  return round2((info.borrower?.income ?? 0) + (info.co_borrower?.income ?? 0) + (info.other_income ?? 0));
}

function personLine(p: PersonInfo, today: string): BorrowerPerson {
  const age = ageOn(p.birth_date, today);
  const since = p.since && /^\d{4}/.test(p.since) ? p.since.slice(0, 4) : null;
  return {
    name: personName(p),
    age,
    job: [clean(p.profession), clean(p.employer) ? `chez ${clean(p.employer)}` : ''].filter(Boolean).join(' '),
    contract: p.contract ? `${CONTRACT_LABELS[p.contract]}${since && p.contract !== 'retraite' && p.contract !== 'sans_activite' ? ` depuis ${since}` : ''}` : '',
    income: p.income ?? null,
  };
}

/** Texte court de situation : « Marié(e), 2 enfants à charge · fonctionnaire depuis 2012 ». */
export function situationText(info: PersonalInfo, withJobs = true): string {
  const fam = [info.family ? FAMILY_LABELS[info.family] : '', info.children ? `${info.children} enfant${info.children > 1 ? 's' : ''} à charge` : ''].filter(Boolean).join(', ');
  const jobs = [info.borrower, info.co_borrower].filter((p): p is PersonInfo => !!p && !!p.contract)
    .map((p) => `${CONTRACT_LABELS[p.contract!].replace(/^Salarié en /, '').replace(/^(?!CDI|CDD)./, (c) => c.toLowerCase())}${p.since && /^\d{4}/.test(p.since) ? ` depuis ${p.since.slice(0, 4)}` : ''}`);
  return [fam, withJobs ? jobs.join(' et ') : ''].filter(Boolean).join(' · ');
}

/**
 * Situation de l'emprunteur pour le dossier banque : revenus, mensualités (crédits des biens détenus + autres
 * crédits), loyers perçus, épargne après l'apport.
 */
export function borrowerFromProfile(info: PersonalInfo, o: { patrimony: PatrimonyLine[]; equity: number; today: string }): Borrower {
  const others = activeOtherLoans(info, o.today);
  const propertyLoans = round2(o.patrimony.reduce((s, l) => s + l.monthlyLoan, 0));
  const otherMonthly = round2(others.reduce((s, l) => s + (l.monthly ?? 0), 0));
  const rents = round2(o.patrimony.reduce((s, l) => s + l.monthlyRent, 0));
  const income = householdIncome(info);
  const people = [info.borrower, info.co_borrower].filter((p): p is PersonInfo => !!p && !!(personName(p) || p.income)).map((p) => personLine(p, o.today));
  const loans: BorrowerLoan[] = [
    ...(propertyLoans > 0 ? [{ label: 'Crédits immobiliers des biens détenus (détail au bilan patrimonial)', monthly: propertyLoans, remaining: round2(o.patrimony.reduce((s, l) => s + l.remaining, 0)), end: null }] : []),
    ...others.map((l) => ({
      label: [clean(l.label) || LOAN_KIND_LABELS[l.kind], clean(l.lender)].filter(Boolean).join(' — '),
      monthly: l.monthly ?? 0, remaining: l.remaining ?? null, end: l.end_date ?? null,
    })),
  ];
  return {
    names: borrowerNames(info) || undefined,
    // le détail des emplois figure dans le tableau des emprunteurs
    situation: situationText(info, !people.length) || undefined,
    income: income > 0 ? income : null,
    currentLoans: propertyLoans + otherMonthly > 0 ? round2(propertyLoans + otherMonthly) : null,
    currentRents: rents > 0 ? rents : null,
    savingsAfter: info.savings != null && info.savings > 0 ? Math.max(0, round2(info.savings - Math.max(0, o.equity))) : null,
    presentation: clean(info.presentation) || undefined,
    people: people.length ? people : undefined,
    address: fullAddress(info) || undefined,
    contact: [clean(info.phone), clean(info.email)].filter(Boolean).join(' · ') || undefined,
    housing: info.housing ? `${HOUSING_LABELS[info.housing]}${info.housing === 'locataire' && info.housing_rent ? ` (loyer ${money(info.housing_rent)} par mois)` : ''}` : undefined,
    otherIncome: info.other_income ? { amount: info.other_income, label: clean(info.other_income_label) || 'Autres revenus' } : undefined,
    loans: loans.length ? loans : undefined,
  };
}

/** Champs manquants pour un dossier complet (affichés dans Mon compte). */
export function missingFields(info: PersonalInfo): string[] {
  const out: string[] = [];
  if (!personName(info.borrower)) out.push('nom et prénom');
  if (!info.borrower?.birth_date) out.push('date de naissance');
  if (!info.borrower?.contract) out.push('situation professionnelle');
  if (!(info.borrower?.income && info.borrower.income > 0)) out.push('revenus');
  if (!fullAddress(info)) out.push('adresse');
  if (!info.family) out.push('situation familiale');
  if (info.savings == null) out.push('épargne');
  return out;
}

const num = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? null : v);

/** Nettoie la saisie avant enregistrement : nombres invalides retirés, crédits vides supprimés. */
export function sanitizeInfo(i: PersonalInfo): PersonalInfo {
  const person = (p?: PersonInfo | null): PersonInfo | null | undefined => p && ({ ...p, income: num(p.income), birth_date: p.birth_date || null, since: p.since || null });
  return {
    ...i,
    borrower: person(i.borrower) ?? undefined,
    co_borrower: person(i.co_borrower),
    children: num(i.children), housing_rent: i.housing === 'locataire' ? num(i.housing_rent) : null,
    other_income: num(i.other_income), savings: num(i.savings),
    other_loans: (i.other_loans ?? []).map((l) => ({ ...l, monthly: num(l.monthly), remaining: num(l.remaining), end_date: l.end_date || null }))
      .filter((l) => l.monthly || l.remaining || l.label?.trim()),
  };
}

