# Guide utilisateur — lots 1 et 2

## Se connecter

Utilisez le même e-mail et le même mot de passe qu'avec l'ancienne version : vos simulations ont été reprises en biens de prospection. « Mot de passe oublié » envoie un lien de réinitialisation. Sur téléphone ou ordinateur, le navigateur propose d'**installer** l'application (icône sur l'écran d'accueil).

L'indicateur en haut à droite montre l'état : *Synchronisé*, *Enregistrement…*, *Hors connexion* ou *Erreur*. Cliquez dessus pour resynchroniser. Hors connexion, vous consultez la dernière version chargée mais ne pouvez rien modifier.

## Prospection

Les biens que vous étudiez. **Ajouter un bien** : titre obligatoire, le reste au fil de l'eau. Vous pouvez créer l'agence et l'agent directement depuis le formulaire.

Le tableau se recherche, se trie (clic sur un en-tête), se filtre (en cours, refusés, archivés, statut précis, relances dues), se pagine. **Colonnes** choisit les colonnes affichées (mémorisé sur l'appareil). Cochez des lignes pour changer leur statut, les comparer (2 à 4) ou les exporter. Le menu « ⋯ » de chaque ligne : ouvrir, modifier, simuler, dupliquer, marquer comme acquis, archiver, supprimer.

La **fiche** regroupe caractéristiques, éléments de vigilance, commentaires, simulations, historique et échanges (appel, e-mail, visite… avec le contact concerné), tâches à échéance.

Aucun import automatique depuis les portails d'annonces : collez le lien de l'annonce dans la fiche.

## Passer un bien en « Acquis »

Bouton **Marquer comme acquis** (ou statut « Acquis »). Après confirmation, le bien quitte la prospection et apparaît dans **Mes biens**, avec tout son historique. Les hypothèses de son scénario principal sont figées (« photographie à l'acquisition ») : elles ne changeront plus, même si vous retouchez le scénario. Une erreur ? « Revenir en prospection » dans le menu Plus.

## Adresses

Dans la fiche d'un bien (prospection ou Mes biens), commencez à taper l'adresse : des suggestions de la Base Adresse Nationale s'affichent ; en choisir une remplit le code postal et la ville. Un code postal saisi seul propose sa ou ses communes. Sans connexion au service, la saisie manuelle reste possible.

## Mes biens

Les biens détenus, acquis depuis la prospection ou ajoutés directement (**Ajouter un bien détenu**) : mode de détention, régime fiscal renseigné, date et coût d'acquisition, occupation, loyer et provision, et **charges annuelles** (taxe foncière, copropriété, assurance PNO, gestion locative, GLI, autres) avec leur total ; elles pré-remplissent les simulations du bien. Section **Crédit** : montant, taux, durée, date de première échéance, assurance (€/mois) ; la mensualité est calculée, ou saisie si vous la connaissez. Le bouton « Reprendre le crédit de la simulation » recopie le crédit du scénario figé à l'acquisition. Le **cash-flow prévisionnel** du bien (fiche, tableau Mes biens, tableau de bord) = loyer charges comprises (celui du bail en cours, sinon le loyer saisi) − charges annuelles / 12 − mensualité de crédit, avant impôts. Sans loyer ni charge saisis, il reprend la simulation principale. Voir plus bas « Mes biens » pour le suivi locatif.

## Simulateur

Accessible seul ou depuis un bien (pré-rempli avec prix, travaux et loyer estimé). **Le simulateur alimente la prospection** : une simulation enregistrée sans bien choisi crée un bien « Repéré » (donnez-lui un titre), avec les prix, la surface, les travaux et le loyer simulés ; pour un bien déjà en prospection, le scénario principal met à jour ces valeurs sur sa fiche. Les résultats se mettent à jour à chaque saisie. Indiquez si le prix inclut les honoraires d'agence pour éviter de les compter deux fois. Enregistrez plusieurs scénarios par bien ; le premier devient le **scénario principal** (modifiable dans l'onglet Simulations de la fiche), utilisé dans les tableaux et la comparaison. Le tableau d'amortissement s'affiche par année ou par mois et s'exporte en Excel. « Méthode de calcul » détaille les formules. Les valeurs par défaut se règlent dans **Paramètres**.

Le **prix de présentation FAI** permet de calculer la négociation (en euros et en %) par rapport au prix proposé, frais d'agence compris. Le **loyer hors charges** se calcule à partir de la surface et d'un loyer au m² **bas** ou **haut** (sélecteur), ou se saisit librement ; le **loyer charges comprises** y ajoute la provision. En saisissant les charges de copropriété, la part récupérable et la provision sont proposées à 80 % (arrondies à l'euro supérieur) et restent modifiables. L'assurance PNO est proposée à 99 € par an.

Les résultats sont avant impôts et ne constituent pas un conseil financier.

## Locataires et baux

**Nouveau bail** : choisissez un bien détenu, cochez le ou les titulaires (ou créez-les), indiquez les dates, le loyer hors charges, la provision ou le forfait de charges, le jour de paiement et le dépôt de garantie. Les échéances jusqu'au mois en cours sont créées immédiatement, puis chaque mois par le serveur.

Colocation : plusieurs titulaires sur un même bail, ou un bail par chambre. Au départ d'un colocataire, indiquez sa date de départ dans l'onglet Titulaires. Au départ du locataire, renseignez la fin du bail : les échéances suivantes non réglées sont annulées. Un nouveau bail peut ensuite être créé pour le même bien ; l'historique des anciens baux reste consultable.

La fiche du bail regroupe échéances, paiements, quittances et reçus, relances, dépôt de garantie, titulaires et documents.

## Loyers et paiements

- **Enregistrer un paiement** : montant, date, moyen, référence. Il est réparti automatiquement de la plus ancienne échéance à la plus récente (modifiable avec « Répartir à la main »). Un excédent est conservé en avance (trop-perçu) et peut être affecté plus tard.
- **Confirmer le paiement** (échéance passée) : la date du jour est proposée par défaut et le paiement est marqué « date par défaut » tant que vous ne la corrigez pas. Sans confirmation, l'échéance reste impayée, même si vous ne répondez pas à l'e-mail de rappel.
- Le **solde** d'un bail est toujours calculé à partir des échéances et des paiements : il ne se saisit pas. Le dépôt de garantie n'y entre pas.

### Importer des loyers

**Loyers et paiements → Importer des loyers (Excel)** : fichier .xlsx ou .csv, ou lignes collées, avec les colonnes *Date · Montant · Locataire · Appartement · Moyen · Référence · Commentaire* (Date et Montant obligatoires, modèle téléchargeable). Le bail est retrouvé d'après le locataire ou le logement (sinon à choisir). Chaque ligne devient un paiement réparti sur les échéances dues les plus anciennes ; un excédent reste en avance. Un fichier réimporté ne crée pas de doublon.

### Révision annuelle du loyer (IRL)

Dans le bail, cochez « révision annuelle » et choisissez l'IRL de référence (trimestre figurant au bail ; le dernier publié à la signature est proposé). Chaque année à la date anniversaire, la fiche du bail propose **Réviser le loyer** (et le tableau de bord le signale) : nouveau loyer = loyer × IRL du trimestre de l'année / IRL du même trimestre un an plus tôt (valeurs INSEE intégrées jusqu'au 3e trimestre 2026, saisissables ensuite). Une seule révision par année de bail ; demande tardive sans effet rétroactif (une année non réclamée est perdue) ; révision refusée pour un logement classé F ou G au DPE. Les échéances encore impayées à partir de la date d'effet sont mises à jour ; l'historique des révisions est conservé.

## Quittances et reçus

**Émettre la quittance** n'est proposé que pour une échéance intégralement réglée ; une seule quittance par période. Pour un paiement partiel, un **reçu** indique la somme reçue et le reste dû. Chaque document s'ouvre en aperçu, se télécharge en PDF et peut être envoyé au locataire par e-mail (adresse renseignée dans sa fiche). **Rappel de charges** : dans le bail, « Ajouter une somme due » → *Rappel de charges d'une année précédente* (année, montant). Une fois réglé, « Émettre la quittance » d'un loyer propose de l'ajouter : il figure sur une ligne distincte de la quittance et ne peut plus être quittancé une seconde fois. Une quittance émise par erreur s'annule avec un motif ; ses paiements redeviennent alors modifiables.

Envoi automatique (option du bail) : la quittance part seule quand un paiement que vous avez saisi ou confirmé règle exactement la période. Elle ne part jamais sur la seule base d'une date.

## Relances

« Préparer une relance » rédige un rappel amiable à partir de votre modèle (Paramètres), avec le montant dû et les périodes. Relisez, modifiez, puis envoyez par e-mail ou marquez « envoyée par vos soins » (courrier). Si l'option est activée sur le bail, une relance est préparée automatiquement après le délai choisi et vous êtes prévenu : elle n'est jamais envoyée sans votre validation, et elle est annulée si la dette est réglée entre-temps. Aucune pénalité n'est ajoutée.

## Dépenses

Par bien : date, fournisseur, montant, catégorie, **nature** (charge, immobilisation, remboursement de capital, trésorerie), part récupérable sur le locataire, statut (payée ou à payer) et justificatif. Les totaux par nature et l'export Excel facilitent la préparation de la déclaration ; ils ne constituent pas une attestation fiscale.

### Importer un relevé

**Dépenses → Importer (Excel, CSV)** : choisissez un fichier .xlsx ou .csv, ou collez les lignes copiées depuis Excel, avec les colonnes *Date · Libellé · Compte du mouvement · Montant (EUROS) · Catégorie · Commentaires · Appartement* (seules Date et Montant sont obligatoires ; un modèle Excel est proposé). Montants négatifs = dépenses, positifs = recettes (catégorie Loyer). L'aperçu reconnaît les catégories (Crédit, Assurance crédit, Charges de copropriété (dont travaux), Assurance, Taxe foncière, Entretien amortissable ou non, Loyer, Frais bancaires / financiers, Meuble, Frais de crédit) et le logement d'après l'adresse ou le titre du bien ; ce qui n'est pas reconnu se choisit ligne par ligne, ou une fois par adresse. Un relevé réimporté ne crée pas de doublon.

## Déclaration fiscale

Choisissez l'année des revenus : l'onglet indique, selon le régime de chaque bien (à choisir dans le tableau ou la fiche du bien), les cases à remplir — 4BE (micro-foncier), formulaire 2044 ligne par ligne puis 4BA / 4BB / 4BC (réel), 5ND (micro-BIC), 5NA / 5NY avec amortissements (LMNP au réel). Quelques montants se saisissent (régularisation des provisions de l'année précédente, recettes diverses, paramètres d'amortissement). Export Excel. Détail des règles : [DECLARATION-FISCALE](DECLARATION-FISCALE.md). C'est une aide au remplissage, pas un conseil fiscal.

Ajout et suppression rapides : la ligne au-dessus du tableau ajoute une dépense en une fois (date, bien, catégorie, libellé, montant) ; chaque ligne a un bouton Supprimer, et la sélection multiple permet de supprimer plusieurs lignes ; « Dupliquer » recopie une ligne.

## Documents

PDF, images, Word, Excel ou texte, 10 Mo maximum, rattachés à un bien, un bail ou une dépense. Ils sont privés : chaque ouverture passe par un lien valable 60 secondes. Supprimer un document supprime aussi le fichier.

## Mes biens

Pour chaque bien détenu : locataire actif, « Loué » dès qu'un bail est en cours, loyers encaissés et dépenses payées depuis le 1er janvier, solde locatif et cash-flow réel (encaissements − dépenses payées, avant impôts, hors dépôt de garantie).

## Mon abonnement

État de votre accès (essai, abonnement, résiliation programmée, fin d'accès), offres et paiement sécurisé par Stripe, puis espace client Stripe pour les factures, le moyen de paiement et la résiliation. Si l'accès prend fin, vos données restent consultables et exportables. **Paramètres → Accès support** : autorisez, pour 7 jours, le support à consulter un résumé chiffré de votre compte.

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
