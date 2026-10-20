/**
 * Parcours de déclaration sur impots.gouv.fr, par régime : espace particulier (déclaration de revenus en ligne,
 * 2042, 2044, 2042-C-PRO) et espace professionnel (liasse 2031 et 2033 des loueurs en meublé au réel, 2072 et 2065
 * des sociétés). Les libellés des écrans peuvent évoluer d'une campagne à l'autre : ils sont donnés à titre de repère.
 */
import type { Property } from '../data/types.ts';
import type { FiscalSummary } from './fiscal.ts';
import type { DocSection } from './leaseContract.ts';

export interface GuideBox { form: string; code: string; label: string; amount: number | null }
export interface GuideStep { id: string; title: string; space: 'particulier' | 'professionnel'; deadline: string; steps: string[]; boxes: GuideBox[]; notes: string[] }

const money = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[\u202f\u00a0]/g, ' ')} €`;

/** Date limite de dépôt de la liasse des BIC au réel : deuxième jour ouvré suivant le 1er mai (délai supplémentaire en ligne). */
export function liasseDeadline(year: number): string {
  const d = new Date(Date.UTC(year, 4, 1));
  let n = 0;
  while (n < 2) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !(d.getUTCMonth() === 4 && d.getUTCDate() === 8)) n++;
  }
  return d.toISOString().slice(0, 10);
}

const PARTICULIER_START = [
  'Sur impots.gouv.fr, ouvrez « Votre espace particulier » (numéro fiscal et mot de passe, ou FranceConnect), puis « Déclarer mes revenus ».',
  'Vérifiez votre situation (étape 1), puis passez à l’étape « Revenus et charges ».',
];

export function declarationGuide(f: FiscalSummary, properties: Property[], opts: { priorDeficits?: number } = {}): GuideStep[] {
  const y = f.year;
  const out: GuideStep[] = [];
  const filing = `Déclaration des revenus ${y} au printemps ${y + 1} : date limite en ligne fixée selon votre département (fin mai à début juin), publiée sur impots.gouv.fr.`;

  if (f.microFoncier) {
    out.push({
      id: 'micro-foncier', title: 'Location nue au micro-foncier', space: 'particulier', deadline: filing,
      steps: [...PARTICULIER_START,
        'Cochez la rubrique « Revenus fonciers », puis « Micro-foncier ».',
        `Case 4BE : indiquez ${money(f.microFoncier.box4BE)} de loyers bruts encaissés, hors charges. L’abattement de 30 % est appliqué automatiquement.`,
        'Validez la rubrique, contrôlez le récapitulatif, puis « Signer et envoyer ».'],
      boxes: [{ form: '2042', code: '4BE', label: 'Micro-foncier : recettes brutes', amount: f.microFoncier.box4BE }],
      notes: ['Pas de formulaire 2044. Le micro-foncier s’applique si les loyers bruts du foyer ne dépassent pas 15 000 € et qu’aucun bien n’est au réel.'],
    });
  }

  if (f.reelFoncier) {
    const b = f.reelFoncier.boxes;
    out.push({
      id: 'reel-foncier', title: 'Location nue au réel : 2044', space: 'particulier', deadline: filing,
      steps: [...PARTICULIER_START,
        'Cochez la rubrique « Revenus fonciers », puis « Déclaration 2044 ». L’annexe 2044 s’ouvre en ligne.',
        'Créez un immeuble par bien et reportez ligne par ligne les montants du tableau 2044 ci-dessous (lignes 211 à 263).',
        'À la fin de la 2044, le résultat (lignes 420 à 442) est reporté automatiquement sur la 2042 : vérifiez les cases 4BA, 4BB et 4BC.',
        ...(opts.priorDeficits ? [`Case 4BD : déficits fonciers antérieurs non encore imputés, ${money(opts.priorDeficits)} (d’après votre dernier avis d’imposition).`] : []),
        'Validez, contrôlez le récapitulatif, puis « Signer et envoyer ». Conservez les justificatifs de charges.'],
      boxes: [
        ...f.reelFoncier.perProperty.flatMap((pp) => pp.lines.filter((l) => l.amount !== 0 || ['215', '263'].includes(l.code))
          .map((l) => ({ form: '2044', code: l.code, label: `${properties.find((p) => p.id === pp.propertyId)?.title ?? 'Bien'} – ${l.label}`, amount: l.amount }))),
        { form: '2044', code: '420', label: 'Résultat foncier total', amount: b.l420 },
        { form: '2042', code: '4BA', label: 'Revenu foncier imposable', amount: b.box4BA },
        { form: '2042', code: '4BB', label: 'Déficit imputable sur les revenus fonciers', amount: b.box4BB },
        { form: '2042', code: '4BC', label: 'Déficit imputable sur le revenu global', amount: b.box4BC },
        ...(opts.priorDeficits ? [{ form: '2042', code: '4BD', label: 'Déficits fonciers antérieurs non imputés', amount: opts.priorDeficits }] : []),
      ],
      notes: ['Le déficit imputable sur le revenu global est plafonné à 10 700 € par an (hors intérêts d’emprunt) ; le bien doit rester loué jusqu’au 31 décembre de la 3e année suivant l’imputation.'],
    });
  }

  if (f.microBic) {
    out.push({
      id: 'micro-bic', title: 'Location meublée au micro-BIC : 2042-C-PRO', space: 'particulier', deadline: filing,
      steps: [...PARTICULIER_START,
        'À l’étape « Revenus et charges », cochez « Revenus des professions non salariées », puis « Revenus des locations meublées non professionnelles » (la déclaration complémentaire 2042-C-PRO s’ouvre).',
        ...f.microBic.lines.map((l) => `Case ${l.box} (${l.label}) : ${money(l.amount)} de recettes brutes, charges comprises. Abattement de ${Math.round(l.rate * 100)} % appliqué automatiquement.`),
        'Ne déduisez aucune charge : l’abattement forfaitaire les remplace. Validez, puis « Signer et envoyer ».'],
      boxes: f.microBic.lines.map((l) => ({ form: '2042-C-PRO', code: l.box, label: l.label, amount: l.amount })),
      notes: [
        'Second déclarant du foyer : cases 5OI, 5OG ou 5OH ; personne à charge : 5PI, 5PG ou 5PH.',
        'Numéro SIRET obligatoire dès la première location meublée (déclaration de début d’activité sur le guichet unique de l’INPI).',
        ...(y >= 2025 ? [] : ['Revenus 2024 : la case 5ND regroupait les locations meublées classiques et les meublés de tourisme non classés.']),
      ],
    });
  }

  if (f.reelBic) {
    const lia = f.reelBic.liasse;
    const dl = liasseDeadline(y + 1);
    out.push({
      id: 'lmnp-liasse', title: 'Location meublée au réel (LMNP) : liasse 2031 et 2033', space: 'professionnel',
      deadline: `Liasse des revenus ${y} à déposer au plus tard le ${dl.split('-').reverse().join('/')} (2e jour ouvré suivant le 1er mai ; un délai supplémentaire est généralement accordé pour le dépôt en ligne).`,
      steps: [
        'Prérequis : numéro SIRET (guichet unique de l’INPI) et espace professionnel sur impots.gouv.fr (« Créer votre espace professionnel » en mode simplifié ; code d’activation reçu par courrier).',
        'Espace professionnel → « Déclarer et payer » → tuile « Résultat ». Choisissez l’activité de location meublée (BIC), régime « Réel simplifié d’imposition », exercice du 1er janvier au 31 décembre, puis « Déclarer ».',
        'Saisissez la 2033-A (bilan : immobilisations, amortissements cumulés, emprunts), la 2033-C (immobilisations et amortissements) puis la 2033-B avec les lignes ci-dessous.',
        'Complétez la 2033-D si des déficits ou amortissements sont reportés, puis la 2031 (identification, régime, résultat fiscal repris de la 2033-B).',
        '« Valider », puis « Signer et envoyer » ; conservez l’accusé de réception.',
      ],
      boxes: [
        ...lia.lines.map((l) => ({ form: '2033-B', code: l.code, label: l.label, amount: l.amount })),
        ...(lia.deferredUsed ? [{ form: '2033-B', code: '—', label: 'Imputation des amortissements différés des exercices précédents (art. 39 C du CGI)', amount: lia.deferredUsed }] : []),
        { form: '2031', code: lia.fiscalResult >= 0 ? 'Bénéfice' : 'Déficit', label: 'Résultat fiscal reporté de la 2033-B', amount: Math.abs(lia.fiscalResult) },
        ...lia.assets.map((a) => ({ form: '2033-C', code: 'Immob.', label: `${a.label} – valeur brute (amortissements cumulés : ${money(a.cumulated)})`, amount: a.gross })),
      ],
      notes: [
        `Amortissements non déduits (art. 39 C du CGI) reportés sans limite de durée : ${money(lia.deferredAfter)} en fin d’exercice. Conservez le suivi de ces reports.`,
        'Taxe foncière et CFE vont en ligne 244 ; ajoutez la CFE dans Dépenses (catégorie Autre ou Taxe foncière) si vous la payez.',
        'Les lignes 2033-B sont données selon le formulaire simplifié en vigueur : vérifiez-les avec la notice 2033 de l’année.',
      ],
    });
    out.push({
      id: 'lmnp-2042', title: 'Location meublée au réel : report sur la 2042-C-PRO', space: 'particulier', deadline: filing,
      steps: [...PARTICULIER_START,
        'Cochez « Revenus des professions non salariées », puis « Revenus des locations meublées non professionnelles », régime du bénéfice réel.',
        f.reelBic.box5NY ? `Case 5NY : déficit de ${money(f.reelBic.box5NY)} (imputable sur les seuls revenus de locations meublées des dix années suivantes).`
          : `Case 5NA : bénéfice de ${money(f.reelBic.box5NA)}.`,
        'Déficits antérieurs non encore imputés : cases 5GA à 5GJ, une par année d’origine (d’après vos avis d’imposition).',
        'Validez, puis « Signer et envoyer ».'],
      boxes: [f.reelBic.box5NY
        ? { form: '2042-C-PRO', code: '5NY', label: 'Locations meublées non professionnelles au réel : déficit', amount: f.reelBic.box5NY }
        : { form: '2042-C-PRO', code: '5NA', label: 'Locations meublées non professionnelles au réel : bénéfice', amount: f.reelBic.box5NA }],
      notes: ['Second déclarant : cases 5OA ou 5OY ; personne à charge : 5PA ou 5PY.'],
    });
  }

  const sciIr = properties.filter((p) => p.status === 'acquis' && p.ownership_mode === 'sci_ir');
  if (sciIr.length) {
    out.push({
      id: 'sci-ir', title: 'SCI à l’impôt sur le revenu : 2072', space: 'professionnel',
      deadline: `Déclaration 2072 de la société à déposer en ligne au printemps ${y + 1} (date fixée chaque année, généralement mi-mai).`,
      steps: [
        'Espace professionnel de la SCI → « Déclarer et payer » → « Résultat » : déclaration 2072 (revenus fonciers de la société, répartition entre associés).',
        'Chaque associé reporte ensuite sa quote-part sur sa propre déclaration 2044 (rubrique des revenus des sociétés immobilières non soumises à l’impôt sur les sociétés), puis en case 4BA, 4BB ou 4BC.',
      ],
      boxes: [], notes: [`Biens concernés : ${sciIr.map((p) => p.title).join(', ')}. Les montants de la société se préparent comme une 2044 (régime réel foncier).`],
    });
  }
  if (f.byRegime.is.length) {
    out.push({
      id: 'sci-is', title: 'Société à l’impôt sur les sociétés : 2065 et 2033', space: 'professionnel',
      deadline: `Liasse de l’exercice clos le 31/12/${y} à déposer au plus tard le ${liasseDeadline(y + 1).split('-').reverse().join('/')} (délai supplémentaire en ligne).`,
      steps: [
        'Espace professionnel de la société → « Déclarer et payer » → « Résultat » : déclaration 2065 et annexes 2033 (bilan, compte de résultat, amortissements).',
        'Impôt sur les sociétés : acomptes et solde (relevé 2572) dans l’espace professionnel.',
      ],
      boxes: [], notes: [`Biens concernés : ${f.byRegime.is.map((p) => p.title).join(', ')}. La comptabilité de la société (souvent tenue par un expert-comptable) fait foi.`],
    });
  }
  return out;
}

/** Sections du dossier PDF de déclaration. */
export function guideSections(guide: GuideStep[]): DocSection[] {
  return guide.map((g) => ({
    title: `${g.title} – espace ${g.space}`,
    blocks: [
      { t: 'p' as const, text: g.deadline },
      { t: 'list' as const, items: g.steps },
      ...(g.boxes.length ? [{ t: 'kv' as const, rows: g.boxes.map((b): [string, string] => [`${b.form} – ${b.code} – ${b.label}`, b.amount === null ? '—' : money(b.amount)]) }] : []),
      ...g.notes.map((n) => ({ t: 'p' as const, text: n })),
    ],
  }));
}
