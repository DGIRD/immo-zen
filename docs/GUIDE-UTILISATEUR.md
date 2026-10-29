# Guide utilisateur — lots 1 et 2

## Assistant

Le bouton **? Assistant** (en haut) ouvre un panneau qui explique le fonctionnement de l'application : questions proposées selon la rubrique affichée, réponse avec les étapes, boutons pour s'y rendre et sujets liés. Sans configuration, il répond à partir de l'aide intégrée ; avec une clé d'API Claude ([MISE-EN-SERVICE](MISE-EN-SERVICE.md)), il répond aux questions formulées librement et tient compte de la conversation. Il ne voit pas vos données et ne remplace pas un conseil fiscal ou juridique.

## Se connecter

Utilisez le même e-mail et le même mot de passe qu'avec l'ancienne version : vos simulations ont été reprises en biens de prospection. « Mot de passe oublié » envoie un lien de réinitialisation. Sur téléphone ou ordinateur, le navigateur propose d'**installer** l'application (icône sur l'écran d'accueil).

L'indicateur en haut à droite montre l'état : *Synchronisé*, *Enregistrement…*, *Hors connexion* ou *Erreur*. Cliquez dessus pour resynchroniser. Hors connexion, vous consultez la dernière version chargée mais ne pouvez rien modifier.

## Prospection

**Une seule fiche, un seul écran** : « Ajouter un bien » ouvre le simulateur, qui regroupe tout : le bien (titre, statut, adresse, type, pièces, DPE, lien de l'annonce), l'**estimation du prix** (ventes DVF), le **suivi** (agence, agent — créables sur place —, prochaine action, date de relance, visite, commentaires, points de vigilance) et la simulation (prix, surface, travaux, loyer, financement, charges). Enregistrer crée le bien en prospection et son scénario. Sur la fiche, **Modifier la fiche et la simulation** rouvre ce même écran : il n'existe plus de second formulaire. Titre obligatoire, le reste au fil de l'eau.

La prospection et le simulateur ne concernent que la recherche de nouveaux biens : les biens détenus n'y apparaissent pas.

### Estimation du prix (DVF)

« Estimer avec les ventes DVF » calcule une fourchette à partir des ventes publiques « Demandes de valeurs foncières » (DGFiP / Etalab) des trois dernières années publiées dans la commune : ventes d'un seul appartement ou d'une seule maison, les plus proches de l'adresse (rayon élargi de 300 m à 2 km jusqu'à au moins 16 ventes), surfaces de moitié au double de celle du bien, valeurs extrêmes écartées. Fourchette = 1er et 3e quartiles du prix au m² × surface. Il faut le type, la surface et l'adresse (au moins code postal et ville). Les ventes retenues sont consultables ; la fourchette peut aussi être saisie à la main. Le tableau Prospection affiche l'estimation et l'écart entre le prix proposé et l'estimation médiane. Les données publiées s'arrêtent fin 2025 et ne sont pas indexées : c'est un repère, pas une expertise.

Le tableau se recherche, se trie (clic sur un en-tête), se filtre (en cours, refusés, archivés, statut précis, relances dues), se pagine. **Colonnes** choisit les colonnes affichées (mémorisé sur l'appareil). Cochez des lignes pour changer leur statut, les comparer (2 à 4) ou les exporter. Le menu « ⋯ » de chaque ligne : ouvrir, modifier la fiche et la simulation, dupliquer, marquer comme acquis, archiver, supprimer.

La **fiche** regroupe caractéristiques, éléments de vigilance, commentaires, simulations, historique et échanges (appel, e-mail, visite… avec le contact concerné), tâches à échéance.

Aucun import automatique depuis les portails d'annonces : collez le lien de l'annonce dans la fiche.

## Passer un bien en « Acquis »

Bouton **Marquer comme acquis** (ou statut « Acquis »). Après confirmation, le bien quitte la prospection et apparaît dans **Mes biens**, avec tout son historique. Les hypothèses de son scénario principal sont figées (« photographie à l'acquisition ») : elles ne changeront plus, même si vous retouchez le scénario. Une erreur ? « Revenir en prospection » dans le menu Plus.

## Adresses

Dans la fiche d'un bien (prospection ou Mes biens), commencez à taper l'adresse : des suggestions de la Base Adresse Nationale s'affichent ; en choisir une remplit le code postal et la ville. Un code postal saisi seul propose sa ou ses communes. Sans connexion au service, la saisie manuelle reste possible.

## Mes biens

Les biens détenus, acquis depuis la prospection ou ajoutés directement (**Ajouter un bien détenu**) : mode de détention, régime fiscal renseigné, date et coût d'acquisition, occupation, loyer et provision, et **charges annuelles** (taxe foncière, copropriété, assurance PNO, gestion locative, GLI, autres) avec leur total. **Estimation du prix actuel** : une fourchette (calcul DVF ou saisie manuelle) remplace les prix affiché et proposé de la prospection ; le tableau Mes biens peut afficher la plus-value latente (estimation médiane − coût d'acquisition, avant impôts et frais de vente). Section **Crédit** : montant, taux, durée, date de première échéance, assurance (€/mois) ; la mensualité est calculée, ou saisie si vous la connaissez. Le bouton « Reprendre le crédit de la simulation » recopie le crédit du scénario figé à l'acquisition. Le **cash-flow prévisionnel** du bien (fiche, tableau Mes biens, tableau de bord) = loyer charges comprises (celui du bail en cours, sinon le loyer saisi) − charges annuelles / 12 − mensualité de crédit, avant impôts. Sans loyer ni charge saisis, il reprend la simulation principale. Voir plus bas « Mes biens » pour le suivi locatif.

## Simulateur

Accessible seul ou depuis un bien en prospection ; seuls les biens en prospection y sont proposés. **Le simulateur alimente la prospection** : une simulation enregistrée sans bien choisi crée un bien « Repéré » (donnez-lui un titre), avec les prix, la surface, les travaux et le loyer simulés ; pour un bien déjà en prospection, le scénario principal met à jour ces valeurs sur sa fiche. Les résultats se mettent à jour à chaque saisie. Indiquez si le prix inclut les honoraires d'agence pour éviter de les compter deux fois. Enregistrez plusieurs scénarios par bien ; le premier devient le **scénario principal** (modifiable dans l'onglet Simulations de la fiche), utilisé dans les tableaux et la comparaison. Le tableau d'amortissement s'affiche par année ou par mois et s'exporte en Excel. « Méthode de calcul » détaille les formules. Les valeurs par défaut se règlent dans **Paramètres**.

Le **prix de présentation FAI** permet de calculer la négociation (en euros et en %) par rapport au prix proposé, frais d'agence compris. Le **loyer hors charges** se calcule à partir de la surface et d'un loyer au m² **bas** ou **haut** (sélecteur), ou se saisit librement ; le **loyer charges comprises** y ajoute la provision. En saisissant les charges de copropriété, la part récupérable et la provision sont proposées à 80 % (arrondies à l'euro supérieur) et restent modifiables. L'assurance PNO est proposée à 99 € par an. Le **cash-flow** n'est simulé qu'une fois le loyer connu (loyer au m² et surface, ou loyer saisi) : sans loyer, il s'affiche « — » au lieu d'un montant négatif fait des seules charges.

Les résultats sont avant impôts et ne constituent pas un conseil financier.

## Locataires et baux

**Nouveau bail** : choisissez un bien détenu, cochez le ou les titulaires (ou créez-les), indiquez les dates, le loyer hors charges, la provision ou le forfait de charges, le jour de paiement et le dépôt de garantie. Une ligne mensuelle est créée pour chaque mois passé (depuis le début du bail, ou depuis la date choisie dans **Paramètres → Gestion locative**), puis une nouvelle ligne le 1er de chaque mois.

Colocation : **bail solidaire** (plusieurs titulaires sur un même bail, une seule ligne par mois, les virements des colocataires s'additionnent) ou **baux distincts** (un bail par colocataire, une ligne par mois et par bail) ; un logement peut porter plusieurs baux en même temps. Au départ d'un colocataire, indiquez sa date de départ dans l'onglet Titulaires. Au départ du locataire, renseignez la fin du bail : les échéances suivantes non réglées sont annulées. Un nouveau bail peut ensuite être créé pour le même bien ; l'historique des anciens baux reste consultable.

La fiche du bail regroupe ses lignes mensuelles (paiements, quittances et reçus), relances, dépôt de garantie, titulaires et documents. Pour un bail terminé, le **solde de sortie** rapproche le reste dû du dépôt de garantie détenu.

### Contrat de bail

Sur la fiche du bail, **Contrat de bail** rédige le contrat à signer, avec un aperçu en direct :
- **location vide** ou **meublée** (résidence principale du locataire) : structure et mentions des contrats types officiels (décret n° 2015-587 du 29 mai 2015, annexes 1 et 2), mis à jour : décence énergétique, dépenses annuelles d'énergie, clause résolutoire après six semaines, solidarité en colocation, mobilier minimal (décret n° 2015-981), liste des annexes à joindre ;
- **bail civil** pour une résidence secondaire ou un logement loué à une société (occupant désigné), et **location d'un parking** seul : rédigés d'après les articles 1714 et suivants du Code civil, faute de modèle officiel.

Loyer, charges, dépôt, dates et révision IRL viennent du bail ; nom et adresse du bailleur, adresse du logement, surface, période de construction, durée, encadrement des loyers, travaux, honoraires et conditions particulières se complètent à l'écran. Les points bloquants empêchent l'édition : dépôt de garantie au-delà d'un mois (vide) ou deux mois (meublé), durée inférieure au minimum légal, forfait de charges en location vide hors colocation, logement classé G, loyer au-dessus du loyer de référence majoré sans complément justifié. **Télécharger le PDF** ou **Enregistrer dans les documents** du bail (et le partager avec le locataire). Le contrat doit être relu par les parties ; il ne remplace pas un conseil juridique.

### Espace locataire

Chaque locataire peut consulter en ligne, en lecture seule, son logement, ses quittances et reçus (PDF) et les documents que vous partagez.
1. Renseignez son adresse e-mail (fiche locataire).
2. **Inviter à l'espace locataire** (liste des locataires, menu « ⋯ », ou onglet Titulaires du bail) : un e-mail lui envoie un lien valable 30 jours, utilisable uniquement avec son adresse e-mail. Le lien et le code s'affichent aussi pour lui être transmis autrement.
3. Il crée son compte (ou se connecte) avec cette adresse : son espace s'ouvre.

Partage d'un document : case « Visible dans l'espace locataire » à l'ajout, ou menu « ⋯ » → Partager avec le locataire (document rattaché à son bail). **Aperçu de l'espace locataire** montre exactement ce qu'il voit. **Révoquer l'accès** le ferme immédiatement ; une nouvelle invitation le rouvre. Le locataire ne voit ni vos autres biens, ni vos dépenses, ni les documents non partagés.

## Loyers et paiements

**Un seul tableau, une ligne par bail et par mois.** Colonnes : période, loyer dû (HC), charges dues, autre somme due (régularisation, rappel de charges, reste dû reporté du mois précédent, avec leur libellé), total dû, **réglé** (somme des paiements du mois, avec leur détail), date de règlement, **reçu**, **écart** (réglé − dû), statut (Réglé, Partiel, Partiel reporté, Impayé, À venir, Annulé) et quittance.

- **Rattachement au mois** : un paiement règle le mois de sa date (un virement du 3 novembre va en novembre). Pour un loyer payé en retard ou en avance, choisissez un autre **mois concerné** à la saisie ou dans l'aperçu de l'import. Plusieurs paiements du même mois s'additionnent.
- **Reste dû** : un mois échu partiellement réglé reporte son reste dû dans « Autre somme due » du mois suivant (« Reste dû MM/AAAA ») ; la ligne d'origine passe en « Partiel reporté » et la dette n'est comptée qu'une fois. Si le mois suivant est aussi partiel, le cumul passe au mois d'après. Au dernier mois du bail, le reste dû reste sur sa ligne et entre dans le solde de sortie. Un paiement règle d'abord le reste dû reporté (la dette la plus ancienne), puis le loyer, puis les autres sommes.
- **Excédent** (réglé supérieur au dû) : précisez s'il s'agit d'une **autre somme due** (ajoutée au mois avec un libellé), d'un **loyer supérieur** (loyer du mois porté au montant reçu ; case à cocher pour l'appliquer au bail pour les mois suivants) ou d'un **trop-perçu** (laissé sur la ligne, ou **reporté en avance** sur le mois suivant). Le choix peut être fait à la saisie, à l'import, ou plus tard avec **Qualifier l'écart** (filtre « Écarts »).
- **Reçu** : selon le réglage général (Paramètres → Gestion locative), la colonne se coche automatiquement d'après le relevé ou la saisie, ou après votre confirmation (**Confirmer**, ou **Marquer comme reçu** pour plusieurs lignes).
- **Paiement reçu** (mois échu) : la date du jour est proposée par défaut et le paiement est marqué « date par défaut » tant que vous ne la corrigez pas. Sans confirmation, le mois reste impayé, même si vous ne répondez pas à l'e-mail de rappel.
- Le **solde** d'un bail est toujours calculé à partir des sommes dues et des paiements : il ne se saisit pas. Le dépôt de garantie n'y entre pas.
- Chaque ligne se gère depuis son menu d'actions (⋯) dans Loyers et paiements, ou ses boutons dans la fiche du bail :
  - **Modifier** : date, loyer, charges. « Aligner sur le montant payé » ramène la ligne à ce qui a été réellement payé. Une quittance existante est annulée puis réémise sur le nouveau montant.
  - **Annuler le paiement** : les paiements du mois sont supprimés et le mois redevient dû ; les documents concernés sont annulés.
  - **Annuler la ligne** (avec un motif) puis **Réactiver** : une ligne annulée reste visible avec le filtre « Annulés ».
- **Passage au tableau unique** : à la première ouverture, une reprise range chaque paiement existant dans son mois (ou le mois de l'échéance sur laquelle il avait été confirmé) et reporte les restes dus ; une sauvegarde est téléchargée avant. Les quittances déjà émises restent attachées à leur mois.

### Importer un relevé

**Loyers et paiements → Importer un relevé (Excel, CSV)** : fichier .xlsx ou .csv, ou lignes collées, avec les colonnes *Date · Montant · Locataire · Appartement · Moyen · Référence · Commentaire* (Date et Montant obligatoires, modèle téléchargeable). Le bail est retrouvé d'après le locataire ou le logement (sinon à choisir), le mois d'après la date (modifiable ligne par ligne). L'import remplit la colonne « Réglé » de la ligne du mois ; l'aperçu par mois montre le dû, le réglé avant et après, l'écart, la nature de l'excédent à choisir et la quittance proposée pour un mois intégralement réglé (ou un reçu partiel). Un fichier réimporté ne crée pas de doublon.

### Révision annuelle du loyer (IRL)

Dans le bail, cochez « révision annuelle » et choisissez l'IRL de référence (trimestre figurant au bail ; le dernier publié à la signature est proposé). Chaque année à la date anniversaire, la fiche du bail propose **Réviser le loyer** (et le tableau de bord le signale) : nouveau loyer = loyer × IRL du trimestre de l'année / IRL du même trimestre un an plus tôt (valeurs INSEE intégrées jusqu'au 3e trimestre 2026, saisissables ensuite). Une seule révision par année de bail ; demande tardive sans effet rétroactif (une année non réclamée est perdue) ; révision refusée pour un logement classé F ou G au DPE. Les échéances encore impayées à partir de la date d'effet sont mises à jour ; l'historique des révisions est conservé.

## Quittances et reçus

**Émettre la quittance** n'est proposé que pour un mois intégralement réglé (loyer, charges, autres sommes et reste dû reporté) ; une seule quittance par mois. Les autres sommes du mois y figurent sur des lignes distinctes, dont « Reste dû MM/AAAA réglé » pour un reste dû reporté : la quittance du mois d'origine n'est pas réémise. Pour un paiement partiel, un **reçu** indique la somme reçue et le reste dû. Chaque document s'ouvre en aperçu, se télécharge en PDF et peut être envoyé au locataire par e-mail (adresse renseignée dans sa fiche). **Rappel de charges** : dans le bail, « Ajouter une somme due » → *Rappel de charges d'une année précédente* (année, montant). Il s'ajoute à « Autre somme due » du mois où il est exigé et figure sur la quittance de ce mois, sur une ligne distincte ; il ne peut pas être quittancé une seconde fois. Une quittance émise par erreur s'annule avec un motif ; ses paiements redeviennent alors modifiables.

Envoi automatique (option du bail) : la quittance part seule quand un paiement que vous avez saisi ou confirmé règle exactement la période. Elle ne part jamais sur la seule base d'une date.


**Modifier, rééditer, supprimer.** Une quittance émise n'est jamais modifiée en place, pour garder une numérotation continue : **Modifier** (bailleur, locataires, adresse du logement, date d'émission) et **Rééditer** (informations actuelles du bail et des paiements) émettent un nouveau document numéroté à la suite et annulent l'ancien, qui reste visible avec « Afficher les documents annulés ou remplacés ». **Supprimer** annule le document avec un motif. Les quittances portent le logo Immo-Zen ; la date d'envoi au locataire s'affiche dans la liste. La colonne « Quittance » de chaque ligne mensuelle donne accès aux documents du mois ; l’export Excel de Loyers et paiements les liste tous.

**Paiements.** Un paiement se modifie (montant, date, mois concerné, moyen, référence, commentaire) ou se supprime depuis la ligne de son mois. S'il figure sur une quittance, celle-ci est annulée puis rééditée automatiquement (si la période reste intégralement réglée).
## Relances

« Préparer une relance » rédige un rappel amiable à partir de votre modèle (Paramètres), avec le montant dû et les périodes. Relisez, modifiez, puis envoyez par e-mail ou marquez « envoyée par vos soins » (courrier). Si l'option est activée sur le bail, une relance est préparée automatiquement après le délai choisi et vous êtes prévenu : elle n'est jamais envoyée sans votre validation, et elle est annulée si la dette est réglée entre-temps. Aucune pénalité n'est ajoutée.

## Dépenses

Par bien : date, fournisseur, montant, catégorie, **nature** (charge, immobilisation, remboursement de capital, trésorerie), part récupérable sur le locataire, statut (payée ou à payer) et justificatif. Les totaux par nature et l'export Excel facilitent la préparation de la déclaration ; ils ne constituent pas une attestation fiscale.

### Importer un relevé

**Dépenses → Importer (Excel, CSV)** : choisissez un fichier .xlsx ou .csv, ou collez les lignes copiées depuis Excel, avec les colonnes *Date · Libellé · Compte du mouvement · Montant (EUROS) · Catégorie · Commentaires · Appartement* (seules Date et Montant sont obligatoires ; un modèle Excel est proposé). Montants négatifs = dépenses, positifs = recettes (catégorie Loyer). L'aperçu reconnaît les catégories (Crédit, Assurance crédit, Charges de copropriété (dont travaux), Assurance, Taxe foncière, Entretien amortissable ou non, Loyer, Frais bancaires / financiers, Meuble, Frais de crédit) et le logement d'après l'adresse ou le titre du bien ; ce qui n'est pas reconnu se choisit ligne par ligne, ou une fois par adresse. Un relevé réimporté ne crée pas de doublon.

## Déclaration fiscale

Choisissez l'année des revenus : l'onglet indique, selon le régime de chaque bien (à choisir dans le tableau ou la fiche du bien), les cases à remplir — 4BE (micro-foncier), formulaire 2044 ligne par ligne puis 4BA / 4BB / 4BC et 4BD (réel), 5NI, 5NG ou 5NH selon la nature du meublé (micro-BIC ; 5ND pour les revenus 2024), liasse 2031 et compte de résultat 2033-B puis 5NA / 5NY avec amortissements (LMNP au réel). La section **Où déclarer sur impots.gouv.fr** donne, pour chaque régime, le parcours pas à pas : espace particulier (déclaration de revenus en ligne, rubriques à cocher, cases) ou espace professionnel (liasse des meublés au réel, 2072 d'une SCI à l'IR, 2065 d'une société à l'IS), avec les dates limites. **Dossier PDF** regroupe parcours et montants. Quelques montants se saisissent (régularisation des provisions de l'année précédente, recettes diverses, paramètres d'amortissement). Export Excel. Détail des règles : [DECLARATION-FISCALE](DECLARATION-FISCALE.md). C'est une aide au remplissage, pas un conseil fiscal.

Ajout et suppression rapides : la ligne au-dessus du tableau ajoute une dépense en une fois (date, bien, catégorie, libellé, montant) ; chaque ligne a un bouton Supprimer, et la sélection multiple permet de supprimer plusieurs lignes ; « Dupliquer » recopie une ligne.

## Documents

PDF, images, Word, Excel ou texte, 10 Mo maximum, rattachés à un bien, un bail ou une dépense. Ils sont privés : chaque ouverture passe par un lien valable 60 secondes. Un document rattaché à un bail peut être partagé avec le locataire (colonne « Espace locataire »). Supprimer un document supprime aussi le fichier.

## Mes biens

Pour chaque bien détenu : locataire actif, « Loué » dès qu'un bail est en cours, loyers encaissés et dépenses payées depuis le 1er janvier, solde locatif et cash-flow réel (encaissements − dépenses payées, avant impôts, hors dépôt de garantie).

## Mon abonnement

**Offre Découverte** : 30 jours gratuits à la création du compte, sans carte bancaire (1 bien détenu, 5 biens en prospection, 2 scénarios par bien, 100 Mo de documents). À son terme, sans abonnement, vos données restent consultables et exportables mais ne sont plus modifiables (rien n'est supprimé). État de votre accès (offre Découverte, abonnement, résiliation programmée, fin d'accès), offres et paiement sécurisé par Stripe, puis espace client Stripe pour les factures, le moyen de paiement et la résiliation. Si l'accès prend fin, vos données restent consultables et exportables. **Paramètres → Accès support** : autorisez, pour 7 jours, le support à consulter un résumé chiffré de votre compte.

## Contacts

Agences, agents, artisans, notaires, banques… avec coordonnées, organisme, secteur, notes, date de relance, biens liés et échanges.

## Sauvegarde, export, import

- Chaque tableau s'exporte en Excel (.xlsx), CSV (séparateur « ; », pour Excel en français) ou JSON.
- **Paramètres → Télécharger une sauvegarde** : tout votre compte en un fichier JSON. **Importer une sauvegarde** affiche un aperçu, ignore les doublons et télécharge d'abord une sauvegarde de l'état actuel.
- **Données de l'ancienne version** : si des simulations de l'ancienne application n'avaient jamais été synchronisées depuis ce navigateur, elles sont proposées ici pour reprise.

## Déconnexion

Elle efface la copie locale des données sur l'appareil. Déconnectez-vous sur un appareil partagé.

## Guide administrateur

L'administration (utilisateurs, abonnements, tarifs, incidents, e-mails) arrive au lot 3. D'ici là, l'administration se fait dans la console Supabase : voir [DEPLOIEMENT](DEPLOIEMENT.md).
