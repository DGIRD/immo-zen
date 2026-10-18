/**
 * Base de connaissances de l'assistant Immo-Zen : fonctionnement de l'application, par rubrique.
 * Partagée entre l'application (réponses instantanées, sans service externe) et la fonction
 * serveur « assistant » (contexte fourni au modèle de langage, si une clé d'API est configurée).
 * À tenir à jour à chaque évolution fonctionnelle.
 */

export interface HelpTopic {
  id: string;
  title: string;
  /** Rubriques (clé de menu) où le sujet est mis en avant. */
  pages: string[];
  keywords: string[];
  body: string;
  actions?: { label: string; path: string }[];
  /** Questions proposées à l'ouverture de l'assistant sur ces rubriques. */
  questions?: string[];
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'demarrer', title: 'Bien démarrer avec Immo-Zen', pages: ['dashboard'],
    keywords: ['commencer', 'demarrer', 'debut', 'premier', 'presentation', 'fonctionnement', 'quoi', 'faire', 'application', 'utiliser', 'comment marche'],
    body: `Immo-Zen suit un bien de la recherche à la gestion :
1. **Prospection** : « Ajouter un bien » ouvre le simulateur, où vous saisissez en une fois la fiche du bien et sa simulation (prix, crédit, loyer, charges).
2. **Acquisition** : « Marquer comme acquis » fait passer le bien dans **Mes biens**, avec son historique.
3. **Gestion** : créez le bail (Locataires et baux), suivez les loyers, émettez les quittances, saisissez ou importez les dépenses.
4. **Déclaration fiscale** : les montants à reporter sont calculés chaque année selon le régime de chaque bien.
Le **tableau de bord** regroupe ce qui est à faire : relances, visites, impayés, quittances à émettre, révisions de loyer.`,
    actions: [{ label: 'Ajouter un bien', path: '/simulateur' }, { label: 'Mes biens', path: '/biens' }],
    questions: ['Par où commencer ?', 'Comment ajouter un bien en prospection ?', 'Que montre le cash-flow du tableau de bord ?'],
  },
  {
    id: 'tableau-de-bord', title: 'Tableau de bord', pages: ['dashboard'],
    keywords: ['tableau', 'bord', 'accueil', 'cash', 'flow', 'cashflow', 'previsionnel', 'a faire', 'relances', 'indicateurs'],
    body: `Le tableau de bord affiche les biens en prospection, les relances à faire, les biens détenus et le **cash-flow prévisionnel** mensuel : loyers charges comprises (bail en cours, sinon loyer saisi) − charges annuelles / 12 − mensualité de crédit, avant impôts. Un bien sans loyer, charges ni crédit renseignés reprend sa simulation principale.
Avec des baux : impayés échus, quittances à émettre, relances à valider, loyers encaissés de l'année. La liste « À faire » regroupe impayés, relances, visites, tâches et révisions de loyer possibles.`,
  },
  {
    id: 'prospection', title: 'Prospection et simulateur : une seule saisie', pages: ['prospection', 'simulateur'],
    keywords: ['prospection', 'ajouter', 'bien', 'annonce', 'repere', 'statut', 'visite', 'offre', 'simulation', 'saisie', 'double', 'fiche', 'agence', 'agent', 'relance'],
    body: `« Ajouter un bien » (Prospection) ouvre le **simulateur**, qui contient la fiche du bien (titre, statut, adresse avec saisie automatique, type, pièces, DPE, lien de l'annonce) et la simulation. **Enregistrer** crée le bien en prospection et son scénario.
Prix, surface, travaux et loyer se saisissent uniquement dans le simulateur ; le **scénario principal** met à jour la fiche. La fiche du bien garde l'agence, l'agent, la date de relance, la prochaine action, la visite, les commentaires et la vigilance (bouton Modifier).
Le tableau Prospection permet recherche, tri, filtres par statut, colonnes personnalisables, comparaison de 2 à 4 biens, exports Excel/CSV/JSON. 15 statuts suivent le parcours, de « Repéré » à « Sous compromis ».`,
    actions: [{ label: 'Ajouter un bien', path: '/simulateur' }, { label: 'Prospection', path: '/prospection' }],
    questions: ['Comment ajouter un bien en prospection ?', 'Comment comparer plusieurs biens ?', 'Où saisir l’agence et la date de relance ?'],
  },
  {
    id: 'simulateur', title: 'Simulateur : calculs, rendement et cash-flow', pages: ['simulateur'],
    keywords: ['simulateur', 'calcul', 'cash', 'flow', 'cashflow', 'rendement', 'negociation', 'fai', 'notaire', 'frais', 'agence', 'credit', 'emprunt', 'mensualite', 'apport', 'differe', 'amortissement', 'tableau', 'loyer', 'm2', 'metre', 'bas', 'haut', 'copropriete', 'provision', '80', 'pno', 'scenario', 'principal'],
    body: `- **Négociation** = prix de présentation FAI − prix proposé frais d'agence compris, en € et en %.
- **Loyer hors charges** = surface × loyer au m² bas ou haut (sélecteur), ou « Saisie libre ». Loyer charges comprises = loyer + provision.
- **Charges de copropriété** : part récupérable et provision proposées à 80 % (arrondies à l'euro supérieur), modifiables.
- **Coût total** = prix hors honoraires + frais d'agence + notaire (7,5 % par défaut) + travaux + mobilier + garantie + dossier. Indiquez si le prix inclut les honoraires pour ne pas les compter deux fois.
- **Crédit** : taux (3,5 % par défaut), durée (20 ans), assurance (0,3 %), différé partiel ou total ; tableau d'amortissement par année ou par mois, export Excel.
- **Cash-flow avant fiscalité** = loyers − vacance − charges non récupérables − mensualités et assurance.
Plusieurs scénarios par bien ; le premier devient principal (modifiable dans l'onglet Simulations de la fiche). Valeurs par défaut dans Paramètres. « Méthode de calcul » détaille les formules.`,
    questions: ['Comment est calculé le cash-flow ?', 'À quoi sert le loyer au m² bas et haut ?', 'Comment changer les valeurs par défaut ?'],
  },
  {
    id: 'acquisition', title: 'Passer un bien en « Acquis »', pages: ['prospection', 'biens'],
    keywords: ['acquis', 'acheter', 'achat', 'transferer', 'mes biens', 'photographie', 'revenir'],
    body: `Sur la fiche du bien, **Marquer comme acquis** (ou statut « Acquis ») le transfère dans **Mes biens**, sans doublon et avec tout son historique. Les hypothèses du scénario principal sont figées (« photographie à l'acquisition »). En cas d'erreur : menu Plus → « Revenir en prospection ».`,
  },
  {
    id: 'mes-biens', title: 'Mes biens : loyer, charges, crédit, cash-flow', pages: ['biens'],
    keywords: ['mes biens', 'detenu', 'proprietaire', 'charges', 'annuelles', 'taxe', 'fonciere', 'pno', 'gli', 'gestion', 'credit', 'pret', 'capital', 'restant', 'cash', 'flow', 'regime', 'fiscal', 'occupation', 'loue'],
    body: `Un bien détenu porte : mode de détention, **régime fiscal** (micro-foncier, réel foncier, micro-BIC, LMNP réel, IS), date et coût d'acquisition, loyer et provision, **charges annuelles** (taxe foncière, copropriété, PNO, gestion locative, GLI, autres) et **crédit** (montant, taux, durée, première échéance, assurance ; mensualité calculée ou saisie, capital restant dû). « Reprendre le crédit de la simulation » recopie celui du scénario acquis.
Le tableau Mes biens affiche locataire actif, « Loué » dès qu'un bail est en cours, encaissements et dépenses de l'année, solde locatif, **cash-flow prévisionnel** (loyer CC − charges / 12 − crédit) et cash-flow réel (encaissé − payé).`,
    actions: [{ label: 'Ajouter un bien détenu', path: '/bien/nouveau?mode=owned' }],
    questions: ['Comment renseigner mon crédit ?', 'Comment est calculé le cash-flow d’un bien ?', 'Où indiquer le régime fiscal ?'],
  },
  {
    id: 'adresses', title: 'Adresses : saisie automatique', pages: ['prospection', 'simulateur', 'biens'],
    keywords: ['adresse', 'code postal', 'ville', 'commune', 'automatique', 'saisie'],
    body: `Commencez à taper l'adresse : des suggestions de la Base Adresse Nationale s'affichent ; en choisir une remplit le code postal et la ville. Un code postal seul propose sa ou ses communes. Sans le service, la saisie manuelle reste possible.`,
  },
  {
    id: 'baux', title: 'Locataires et baux', pages: ['locataires'],
    keywords: ['bail', 'baux', 'locataire', 'colocation', 'titulaire', 'nouveau', 'meuble', 'vide', 'echeances', 'depot', 'garantie', 'fin', 'depart'],
    body: `**Nouveau bail** : bien détenu, titulaire(s) (créez-les au besoin), dates, loyer hors charges, provision ou forfait de charges, jour de paiement, dépôt de garantie. Les échéances jusqu'au mois en cours sont créées tout de suite, puis chaque mois par le serveur.
Colocation : plusieurs titulaires sur un bail, ou un bail par chambre ; date de départ d'un colocataire dans l'onglet Titulaires. Fin du bail : les échéances suivantes non réglées sont annulées. La fiche du bail regroupe échéances, paiements, quittances, relances, dépôt de garantie (suivi à part du solde), titulaires et documents.`,
    actions: [{ label: 'Nouveau bail', path: '/baux/nouveau' }],
    questions: ['Comment créer un bail ?', 'Comment gérer une colocation ?', 'Comment suivre le dépôt de garantie ?'],
  },
  {
    id: 'loyers', title: 'Loyers et paiements', pages: ['loyers', 'locataires'],
    keywords: ['loyer', 'loyers', 'paiement', 'payer', 'encaisser', 'confirmer', 'impaye', 'partiel', 'trop', 'percu', 'avance', 'solde', 'echeance', 'retard'],
    body: `**Enregistrer un paiement** : montant, date, moyen, référence ; il est réparti de la plus ancienne échéance à la plus récente (ou « Répartir à la main »). Un excédent reste en avance.
**Confirmer le paiement** d'une échéance passée : la date du jour est proposée et signalée « date par défaut ». Sans confirmation, l'échéance reste impayée, même si vous ne répondez pas à l'e-mail de rappel.
Le **solde** se calcule uniquement à partir des échéances et des paiements ; le dépôt de garantie n'y entre pas.`,
    questions: ['Comment enregistrer un loyer reçu ?', 'Comment importer mes loyers depuis Excel ?', 'Que faire d’un paiement partiel ?'],
  },
  {
    id: 'import-loyers', title: 'Importer des loyers depuis Excel', pages: ['loyers'],
    keywords: ['importer', 'import', 'excel', 'xlsx', 'csv', 'coller', 'masse', 'loyers', 'fichier', 'releve'],
    body: `Loyers et paiements → **Importer des loyers (Excel)** : fichier .xlsx/.csv ou lignes collées depuis Excel, colonnes *Date · Montant · Locataire · Appartement · Moyen · Référence · Commentaire* (Date et Montant obligatoires ; modèle téléchargeable). Le bail est retrouvé d'après le locataire ou l'adresse, sinon choisi sur la ligne. Chaque ligne devient un paiement réparti sur les échéances dues ; un fichier réimporté ne crée pas de doublon.`,
    actions: [{ label: 'Loyers et paiements', path: '/loyers' }],
  },
  {
    id: 'quittances', title: 'Quittances, reçus et rappel de charges', pages: ['loyers', 'locataires'],
    keywords: ['quittance', 'quittances', 'recu', 'pdf', 'envoyer', 'email', 'annuler', 'rappel', 'charges', 'regularisation', 'annee', 'precedente'],
    body: `**Émettre la quittance** n'est proposé que pour une échéance intégralement réglée, une seule fois par période. Paiement partiel : **reçu** (« ne vaut pas quittance »). Aperçu, PDF, envoi au locataire par e-mail ; annulation avec motif.
**Rappel de charges d'une année précédente** : fiche du bail → « Ajouter une somme due » → *Rappel de charges* (année, montant). Une fois réglé, « Émettre la quittance » d'un loyer propose de l'ajouter sur une ligne distincte ; il ne peut pas être quittancé deux fois.
Option du bail « quittance automatique » : émise et envoyée seulement après un paiement saisi ou confirmé qui règle exactement la période.`,
    questions: ['Comment émettre une quittance ?', 'Comment ajouter un rappel de charges sur une quittance ?'],
  },
  {
    id: 'revision', title: 'Révision annuelle du loyer (IRL)', pages: ['locataires', 'loyers'],
    keywords: ['revision', 'reviser', 'irl', 'indice', 'insee', 'augmenter', 'augmentation', 'indexation', 'anniversaire', 'dpe', 'gel'],
    body: `Dans le bail, cochez « révision annuelle » et choisissez l'**IRL de référence** (trimestre figurant au bail). Chaque année à la date anniversaire, la fiche du bail propose **Réviser le loyer** (signalé au tableau de bord) : nouveau loyer = loyer × IRL de l'année / IRL du même trimestre un an plus tôt (valeurs INSEE intégrées, saisissables sinon).
Règles : une révision par année de bail ; demande tardive sans effet rétroactif (une année non réclamée est perdue) ; interdite pour un logement classé F ou G au DPE. Les échéances encore impayées à partir de la date d'effet sont mises à jour ; l'historique est conservé.`,
    questions: ['Comment réviser le loyer avec l’IRL ?'],
  },
  {
    id: 'relances', title: 'Relances d’impayés', pages: ['locataires', 'loyers'],
    keywords: ['relance', 'relancer', 'impaye', 'retard', 'rappel', 'modele', 'courrier'],
    body: `« Préparer une relance » (fiche du bail) rédige un rappel amiable à partir de votre modèle (Paramètres) avec le montant dû et les périodes. Relisez, puis envoyez par e-mail ou marquez « envoyée par vos soins ». Avec l'option du bail, une relance est préparée automatiquement après le délai choisi : **rien n'est envoyé sans votre validation**, et elle est annulée si la dette est réglée. Aucune pénalité n'est ajoutée.`,
  },
  {
    id: 'depenses', title: 'Dépenses : saisie, import, suppression', pages: ['depenses'],
    keywords: ['depense', 'depenses', 'facture', 'ajouter', 'supprimer', 'ligne', 'categorie', 'recuperable', 'nature', 'justificatif', 'dupliquer', 'rapide'],
    body: `La **ligne d'ajout rapide** au-dessus du tableau ajoute une dépense en une fois (date, bien, catégorie, libellé, montant). « Ajouter une dépense » ouvre la fiche complète : nature (charge, immobilisation, capital, trésorerie), part récupérable (ex. ordures ménagères), statut payé/à payer, justificatif, durée d'amortissement.
Chaque ligne a un bouton 🗑 ; cochez plusieurs lignes pour les supprimer ensemble ; « Dupliquer » recopie une ligne. Catégories : Crédit, Assurance crédit, Charges de copropriété, Assurance, Taxe foncière, Entretien amortissable ou non, Loyer (recette), Frais bancaires, Meuble, Frais de crédit, Gestion locative…`,
    actions: [{ label: 'Dépenses', path: '/depenses' }],
    questions: ['Comment importer mon relevé bancaire ?', 'Comment supprimer plusieurs dépenses ?', 'Comment amortir un meuble ?'],
  },
  {
    id: 'import-depenses', title: 'Importer un relevé de dépenses (Excel)', pages: ['depenses'],
    keywords: ['importer', 'import', 'releve', 'banque', 'bancaire', 'excel', 'xlsx', 'csv', 'coller', 'masse'],
    body: `Dépenses → **Importer (Excel, CSV)** : fichier ou lignes collées, colonnes *Date · Libellé · Compte du mouvement · Montant (EUROS) · Catégorie · Commentaires · Appartement* (+ facultatif « Durée d'amortissement »). Montants négatifs = dépenses, positifs = recettes (catégorie Loyer). Les catégories et le logement (d'après l'adresse) sont reconnus ; le reste se choisit ligne par ligne ou une fois par adresse. Un relevé réimporté ne crée pas de doublon.`,
  },
  {
    id: 'amortissements', title: 'Amortissements', pages: ['depenses', 'fiscal'],
    keywords: ['amortissement', 'amortir', 'amortissements', 'duree', 'meuble', 'mobilier', 'travaux', 'bati', 'terrain', 'dotation', 'lmnp'],
    body: `Sur une dépense de meuble, d'entretien amortissable ou d'immobilisation, le champ **Durée d'amortissement** fixe la durée (sinon : meubles 7 ans, travaux 10 ans, réglables dans la déclaration). La **Déclaration fiscale** affiche une section Amortissements : base, durée, dotation de l'année, cumul, reste à amortir.
Ils sont déduits en **LMNP au réel** (avec le bâti : valeur amortissable − part du terrain, 30 ans par défaut), dans la limite du résultat ; l'excédent est reporté. En location nue, rien ne s'amortit (travaux déduits l'année du paiement) ; aux régimes micro, l'abattement les remplace.`,
  },
  {
    id: 'fiscal', title: 'Déclaration fiscale', pages: ['fiscal'],
    keywords: ['declaration', 'fiscal', 'fiscale', 'impot', 'impots', '2044', '2042', 'case', 'cases', '4ba', '4bb', '4bc', '4be', '5nd', '5na', '5ny', 'micro', 'reel', 'foncier', 'deficit', 'lmnp', 'bic'],
    body: `Choisissez l'année des revenus : selon le régime de chaque bien, l'onglet donne les cases à remplir — **4BE** (micro-foncier), formulaire **2044** ligne par ligne puis **4BA / 4BB / 4BC** (réel foncier), **5ND** (micro-BIC), **5NA / 5NY** (LMNP réel, avec amortissements). Saisies possibles : régularisation des provisions N−1 (ligne 230), recettes diverses, paramètres d'amortissement. Export Excel.
Les montants viennent des loyers encaissés et dépenses payées de l'année ; les intérêts d'emprunt du crédit saisi dans Mes biens. C'est une **aide au remplissage**, pas un conseil fiscal : vérifiez avec les notices ou un professionnel.`,
    questions: ['Quelles cases remplir pour ma déclaration ?', 'Pourquoi ne vois-je pas les amortissements ?', 'D’où viennent les intérêts d’emprunt ?'],
  },
  {
    id: 'documents', title: 'Documents', pages: ['documents'],
    keywords: ['document', 'documents', 'fichier', 'pdf', 'photo', 'justificatif', 'bail', 'stocker', 'telecharger'],
    body: `PDF, images, Word, Excel ou texte, 10 Mo maximum, rattachés à un bien, un bail ou une dépense. Ils sont privés : chaque ouverture passe par un lien valable 60 secondes. Supprimer un document supprime aussi le fichier.`,
  },
  {
    id: 'contacts', title: 'Contacts', pages: ['contacts'],
    keywords: ['contact', 'contacts', 'agence', 'agent', 'artisan', 'notaire', 'banque', 'syndic', 'echange'],
    body: `Agences, agents, artisans, notaires, banques, syndics… avec coordonnées, organisme, secteur, notes, date de relance, biens liés et échanges. Une agence créée depuis la fiche d'un bien y apparaît automatiquement.`,
  },
  {
    id: 'sauvegarde', title: 'Exports, sauvegarde et import', pages: ['parametres'],
    keywords: ['export', 'exporter', 'sauvegarde', 'sauvegarder', 'backup', 'json', 'excel', 'csv', 'importer', 'restaurer'],
    body: `Chaque tableau s'exporte en Excel (.xlsx), CSV ou JSON. **Paramètres → Télécharger une sauvegarde** : tout le compte en un fichier JSON. « Importer une sauvegarde » montre un aperçu, ignore les doublons et télécharge d'abord l'état actuel.`,
  },
  {
    id: 'compte', title: 'Compte, synchronisation et hors connexion', pages: ['parametres'],
    keywords: ['compte', 'mot de passe', 'connexion', 'deconnexion', 'synchronisation', 'synchronise', 'hors connexion', 'conflit', 'installer', 'telephone', 'mobile', 'application'],
    body: `L'indicateur en haut à droite montre l'état : Synchronisé, Enregistrement…, Hors connexion ou Erreur (cliquez pour resynchroniser). Hors connexion, vous consultez la dernière version chargée sans rien modifier. Si une donnée a été modifiée ailleurs entre-temps, Immo-Zen vous le signale au lieu d'écraser. Le navigateur propose d'**installer** l'application sur l'écran d'accueil. « Mot de passe oublié » envoie un lien de réinitialisation ; la déconnexion efface la copie locale.`,
  },
  {
    id: 'abonnement', title: 'Mon abonnement et accès support', pages: ['abonnement', 'parametres'],
    keywords: ['abonnement', 'payer', 'prix', 'tarif', 'stripe', 'facture', 'resilier', 'essai', 'support', 'aide'],
    body: `**Mon abonnement** : état de l'accès (essai, abonnement, résiliation programmée, fin d'accès), offres et paiement sécurisé par Stripe, puis espace client Stripe pour factures, moyen de paiement et résiliation. Si l'accès prend fin, les données restent consultables et exportables. **Paramètres → Accès support** : autorisez pour 7 jours le support à voir un résumé chiffré de votre compte (chaque consultation est journalisée).`,
  },
  {
    id: 'parametres', title: 'Paramètres', pages: ['parametres'],
    keywords: ['parametres', 'reglages', 'valeurs', 'defaut', 'modele', 'bailleur', 'relance'],
    body: `Paramètres : valeurs par défaut du simulateur (notaire, agence, taux, durée, assurance, PNO), gestion locative (nom et adresse du bailleur, modèles de relance), sauvegarde et import, reprise des anciennes simulations, compte et accès support.`,
  },
];

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(['le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'd', 'l', 'a', 'au', 'aux', 'et', 'ou', 'en', 'je', 'j', 'mon', 'ma', 'mes', 'comment', 'pour', 'que', 'qu', 'quoi', 'est', 'ce', 'il', 'on', 'dans', 'sur', 'par', 'se', 'faire', 'peut', 'puis', 'pas', 'ne', 'y', 'avec', 'quel', 'quelle', 'quelles', 'quels', 'ou', 'c']);

/** Recherche des sujets d'aide : mots-clés, titre et texte, avec un bonus pour la rubrique affichée. */
export function searchHelp(question: string, page?: string, limit = 3): HelpTopic[] {
  const words = norm(question).split(' ').filter((w) => w.length > 1 && !STOP.has(w));
  if (!words.length) return HELP_TOPICS.filter((t) => page && t.pages.includes(page)).slice(0, limit);
  const q = ` ${norm(question)} `;
  const scored = HELP_TOPICS.map((t) => {
    let score = 0;
    const title = norm(t.title);
    const body = ` ${norm(t.body)} `;
    for (const k of t.keywords) {
      const nk = norm(k);
      if (nk.includes(' ') ? q.includes(` ${nk} `) : words.includes(nk)) score += nk.includes(' ') ? 4 : 3;
      else if (words.some((w) => w.length > 3 && (nk.startsWith(w) || w.startsWith(nk)))) score += 1.5;
    }
    for (const w of words) {
      if (title.includes(w)) score += 2;
      if (body.includes(` ${w}`)) score += 0.5;
    }
    if (page && t.pages.includes(page)) score += 1;
    return { t, score };
  }).filter((x) => x.score >= 3).sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.t);
}

/** Texte complet de l'aide (contexte de l'assistant conversationnel). */
export function helpCorpus(): string {
  return HELP_TOPICS.map((t) => `## ${t.title}\n${t.body}`).join('\n\n');
}

export const ASSISTANT_SYSTEM = `Tu es l'assistant d'Immo-Zen, application web française de prospection immobilière, de simulation et de gestion locative pour particuliers.
Ton rôle : expliquer le fonctionnement de l'application, en français, simplement et brièvement (quelques phrases ou une courte liste d'étapes), en citant les noms exacts des menus et boutons.
Règles :
- Appuie-toi uniquement sur la documentation ci-dessous. Si la réponse n'y figure pas, dis-le et propose la rubrique la plus proche ; n'invente aucune fonction.
- Tu ne vois pas les données de l'utilisateur et ne peux rien modifier : indique-lui où cliquer.
- Pour la fiscalité ou le droit, explique ce que fait l'application et rappelle qu'il ne s'agit pas d'un conseil ; renvoie vers les notices officielles ou un professionnel.
- Ne demande jamais de mot de passe ni de coordonnées bancaires.

Documentation d'Immo-Zen :
`;
