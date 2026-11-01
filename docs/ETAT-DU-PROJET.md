# État du projet — lots 1, 2 et 3 (17 octobre 2026)

Légende : **Implémenté et testé** = code livré et couvert par un test automatisé exécuté · **Implémenté** = code livré, vérifié à la main seulement · **À configurer** = code livré, nécessite un service externe · **Restant** = non commencé.

## Livré dans le lot 1

| Fonction | État | Preuve |
|---|---|---|
| Analyse de l'ancienne version et reprise des données (simulations → biens + scénarios + contacts agence/agent dédoublonnés) | Implémenté et testé | `supabase/tests` (16 vérifications), e2e |
| Sauvegarde préalable et annulation de la reprise | Implémenté et testé | test de réversibilité SQL |
| Reprise des simulations de l'ancienne version restées dans le navigateur (hors connexion) | Implémenté et testé | e2e |
| Schéma PostgreSQL, verrou optimiste, RLS par utilisateur | Implémenté et testé | tests SQL deux comptes |
| Connexion, création de compte, mot de passe oublié (Supabase Auth) | À configurer | testé en mode démonstration uniquement ; nécessite le projet Supabase |
| Menu complet ; rubriques des lots 2-3 marquées « non disponibles » | Implémenté et testé | e2e |
| États des lieux : supprimés (menu, écrans, routes, code) | Implémenté et testé | e2e vérifie le code livré ; l'ancienne version n'en contenait pas |
| Prospection : tableau (recherche, tri, filtres, pagination, sélection multiple, colonnes personnalisables, actions, cartes mobiles) | Implémenté et testé | e2e |
| 15 statuts d'acquisition, statuts d'occupation distincts | Implémenté et testé | SQL + unitaires |
| Passage à « Acquis » → Mes biens, même ligne, historique conservé, photographie des hypothèses | Implémenté et testé | SQL + e2e |
| Ajout direct d'un bien détenu | Implémenté et testé | SQL + e2e |
| Fiche bien : commentaires, échanges, tâches, simulations, vigilance | Implémenté et testé (échanges, simulations) / implémenté (tâches) | e2e |
| Duplication, archivage, comparaison (2 à 4 biens) | Implémenté et testé | e2e + SQL |
| Simulateur : paramètres par défaut modifiables, honoraires inclus/exclus, différé partiel/total, amortissement, rendements, cash-flow | Implémenté et testé | 15 tests unitaires |
| Plusieurs scénarios par bien, scénario principal | Implémenté et testé | e2e |
| Contacts immobiliers : coordonnées, organisme, secteur, biens liés, échanges, relance | Implémenté et testé | e2e |
| Tableau de bord (relances, visites, tâches, parcours) | Implémenté | captures |
| Exports Excel .xlsx réel, CSV, JSON ; amortissement en .xlsx | Implémenté et testé | relu par openpyxl + e2e |
| Sauvegarde JSON complète, import avec aperçu, doublons, sauvegarde préalable | Implémenté et testé | unitaires + e2e |
| État de synchronisation visible, détection des conflits sans écrasement silencieux | Implémenté et testé | SQL + e2e |
| Hors connexion : consultation seule des données chargées ; aucune écriture simulée | Implémenté | vérifié à la main |
| Purge du cache privé à la déconnexion | Implémenté et testé | e2e |
| PWA installable (manifeste, service worker sans cache des données) | Implémenté | — |
| Rendu mobile 390 px sans défilement horizontal | Implémenté et testé | e2e + captures |
| CI GitHub Actions et déploiement GitHub Pages | À configurer | workflows livrés, non exécutés ici |

## Livré dans le lot 2 — gestion locative

| Fonction | État | Preuve |
|---|---|---|
| Locataires (coordonnées, archivage) et baux successifs par bien détenu | Implémenté et testé | SQL + e2e |
| Colocation : plusieurs titulaires par bail, départ d'un colocataire, ou plusieurs baux simultanés | Implémenté et testé (titulaires) / implémenté (départ) | SQL + e2e |
| Location vide ou meublée, loyer HC, provision ou forfait de charges, jour de paiement | Implémenté et testé | e2e |
| Échéances mensuelles générées depuis le bail (prorata, idempotentes), sommes dues additionnelles (régularisation) | Implémenté et testé | SQL + unitaires (mêmes résultats TS/SQL) |
| Paiements : plusieurs paiements par échéance, un paiement sur plusieurs échéances, partiel, trop-perçu conservé en avance | Implémenté et testé | SQL + unitaires + e2e |
| Solde calculé uniquement depuis échéances et paiements ; statuts payée / partielle / impayée / à venir / annulée | Implémenté et testé | unitaires + SQL |
| Confirmation du paiement : date du jour par défaut, signalée et modifiable ; absence de réponse ≠ paiement | Implémenté et testé | SQL + e2e |
| Dépôt de garantie suivi séparément (encaissement, restitution, retenue) | Implémenté et testé | SQL + e2e |
| Quittance PDF : aperçu, téléchargement, historique, numérotation, uniquement si période intégralement réglée, jamais en double, annulation motivée | Implémenté et testé | SQL + unitaires + e2e |
| Reçu de paiement partiel (« ne vaut pas quittance ») | Implémenté et testé | SQL + e2e |
| Envoi de la quittance au locataire, envoi automatique sous conditions | Implémenté et testé (file, règles) / **à configurer** (envoi réel) | SQL + unitaires |
| Relances amiables : modèles modifiables, aperçu, délai, arrêt quand la dette est réglée, historique | Implémenté et testé | SQL + e2e |
| E-mail mensuel au propriétaire pour confirmer le paiement | Implémenté et testé (préparation) / **à configurer** (envoi réel) | SQL |
| Tâches serveur planifiées (fuseau Paris, journal, anti-doublons, reprises sur erreur) | Implémenté et testé (SQL, logique d'envoi) / **à configurer** (déploiement, planification, Resend) | SQL + unitaires |
| Dépenses par bien : catégorie, nature (charge, immobilisation, capital, trésorerie), part récupérable, statut, justificatif | Implémenté et testé | SQL + e2e |
| Documents privés : bucket privé, chemins par compte, types et taille contrôlés, lien temporaire 60 s, suppression des fichiers | Implémenté et testé (règles SQL, interface en démonstration) / **non testé** contre le vrai stockage Supabase | SQL + e2e |
| Mes biens : locataire actif, « Loué » déduit des baux, encaissements, dépenses, solde, cash-flow réel de l'année | Implémenté et testé | e2e |
| Tableau de bord : impayés, quittances à émettre, relances à valider | Implémenté | captures |
| Simulateur → prospection : une simulation sans bien crée un bien « Repéré » ; le scénario principal met à jour prix, surface, travaux et loyer du bien en prospection | Implémenté et testé | unitaires + e2e |
| Mes biens : crédit (montant, taux, durée, première échéance, assurance, mensualité saisie ou calculée), capital restant dû | Implémenté et testé | unitaires + e2e |
| Cash-flow prévisionnel par bien détenu et au tableau de bord : loyer CC (bail en cours sinon loyer saisi) − charges annuelles / 12 − crédit ; à défaut de données, simulation principale | Implémenté et testé | unitaires + e2e |
| Icônes Immo-Zen ; adresse https://dgird.github.io/immo-zen/ | Implémenté (icônes) / **à configurer** (renommer le dépôt, voir DEPLOIEMENT) | — |
| Exports .xlsx / CSV des échéances, paiements, dépenses ; sauvegarde JSON incluant la gestion locative | Implémenté | — |

## Livré dans le lot 3

| Fonction | État | Preuve |
|---|---|---|
| Import en masse des dépenses et recettes (Excel .xlsx, CSV, copier-coller) : colonnes reconnues, catégories de la liste, logement d'après l'adresse, aperçu ligne par ligne, anti-doublon | Implémenté et testé | unitaires + SQL + e2e |
| Nouvelles catégories de dépenses ; « Loyer » enregistré comme recette, compté dans les encaissements et le cash-flow réel | Implémenté et testé | unitaires + e2e |
| Abonnements Stripe : Checkout, espace client, webhook signé et idempotent, résiliation programmée, échec de paiement, expiration | Implémenté et testé (logique, SQL) / **à configurer** (compte Stripe, secrets, déploiement) | SQL + unitaires |
| Contrôle d'accès par abonnement dans les règles RLS (désactivé par défaut ; lecture et export conservés) | Implémenté et testé | SQL |
| Mon abonnement : statut, période, échéance ou fin d'accès, factures et résiliation via Stripe | Implémenté et testé (démonstration) | e2e |
| Administration : comptes, invitation sans mot de passe en clair, accès manuel, offres, contrôle d'accès, incidents, journal, prospects commerciaux séparés | Implémenté et testé (SQL, démonstration) / **à configurer** (premier administrateur, invitation) | SQL + e2e |
| Accès support autorisé par l'abonné, limité et journalisé | Implémenté et testé | SQL + e2e |
| Déclaration fiscale : micro-foncier (4BE), 2044 ligne par ligne et 4BA/4BB/4BC, micro-BIC (5ND, puis 5NI/5NG/5NH), LMNP réel avec amortissements et report (5NA/5NY), saisies complémentaires, export Excel | Implémenté et testé (calculs) / **non validé par un professionnel** | unitaires + e2e |

## Évolutions du 17 octobre 2026

| Fonction | État | Preuve |
|---|---|---|
| Saisie automatique des adresses (Base Adresse Nationale, IGN) : code postal et ville remplis ; communes d'un code postal | Implémenté et testé (services simulés) | unitaires + e2e |
| Dépenses : ligne d'ajout rapide, bouton Supprimer par ligne, suppression multiple, duplication | Implémenté et testé | e2e |
| Import Excel des loyers : bail retrouvé, répartition automatique, anti-doublon | Implémenté et testé | unitaires + SQL + e2e |
| Révision annuelle IRL : indices INSEE intégrés, une fois par année de bail, sans rétroactivité, gel F/G, échéances mises à jour, historique, rappel au tableau de bord | Implémenté et testé | unitaires + SQL + e2e |
| Rappel de charges des années précédentes repris sur la quittance (ligne distincte, jamais quittancé deux fois) | Implémenté et testé | unitaires + SQL + e2e |

Limites : les valeurs IRL sont intégrées jusqu'au 3e trimestre 2026 (à compléter chaque trimestre ou saisir à la main) ; la révision ne modifie pas les échéances déjà partiellement réglées ; le service d'adresses n'a pas été appelé réellement pendant les tests (réponses simulées).

## Évolutions du 18 octobre 2026

| Fonction | État | Preuve |
|---|---|---|
| Prospection et simulation fusionnées : fiche du bien et simulation dans un seul écran, plus de double saisie des prix | Implémenté et testé | e2e |
| Durée d'amortissement personnalisée par dépense (saisie, import), section Amortissements de la déclaration (dotation, cumul, reste), sans double déduction | Implémenté et testé | unitaires + SQL + e2e |
| Déploiement des fonctions serveur et de leurs secrets par GitHub Actions ; guide de mise en service OVH, Resend, Stripe ([MISE-EN-SERVICE](MISE-EN-SERVICE.md)) | Implémenté, **non exécuté** (jeton Supabase à fournir) | — |

## Assistant (18 octobre 2026)

| Fonction | État | Preuve |
|---|---|---|
| Assistant d'aide (bouton « ? Assistant ») : questions proposées par rubrique, réponses de l'aide intégrée, liens vers les écrans | Implémenté et testé | unitaires (pertinence de 13 questions types) + e2e |
| Mode conversationnel via l'API Claude (fonction `assistant`, quota quotidien, aucune donnée utilisateur transmise) | Implémenté et testé (quota SQL) / **à configurer** (clé d'API) ; appel réel non testé | SQL |

## Site vitrine (18 octobre 2026)

| Fonction | État | Preuve |
|---|---|---|
| Site vitrine à la racine (raison d'être, parcours tout compris, accompagnement, guides, sécurité, tarifs, questions), calculateur de cash-flow, lien « Espace client » vers l'application publiée sous `/app/` | Implémenté et testé | e2e (bureau et mobile) |
| Formulaire « Être recontacté » → prospects commerciaux de l'administration (anti-robot, limites de fréquence) | Implémenté et testé (SQL) / **à configurer** (migration) | SQL + e2e |
| Mentions légales et confidentialité | **À compléter** (identité de l'éditeur ; contact : contact@immo-zen.fr) | — |

## Fiche unique et estimation DVF (18 octobre 2026)

| Fonction | État | Preuve |
|---|---|---|
| Prospection et simulation sur un seul écran : fiche, suivi (agence, agent, relance, visite, commentaires, vigilance), estimation et simulation ; plus de second formulaire ; libellés identiques entre simulateur, fiche et tableau | Implémenté et testé | e2e |
| Biens détenus exclus de la prospection et du simulateur | Implémenté et testé | e2e |
| Estimation par les ventes publiques DVF (3 dernières années, ventes proches et comparables, quartiles), ventes comparables consultables, saisie manuelle possible | Implémenté et testé (données simulées) / **à configurer** (migration `20261018000400`, fonction `dvf` de secours) | unitaires + SQL + e2e |
| Mes biens : fourchette « Estimation du prix actuel » à la place des prix affiché et proposé, plus-value latente | Implémenté et testé | e2e |
| Lecture réelle des fichiers data.gouv.fr depuis le navigateur | **Non testé en ligne** (réseau fermé pendant les tests) ; repli serveur prévu | — |

## Formules et tarifs (18 octobre 2026)

| Fonction | État | Preuve |
|---|---|---|
| Grille Découverte / Essentiel / Patrimoine / Pro, pack fiscal ; limites (biens détenus, prospection, scénarios, documents) et fonctions (contacts, automatisations, cash-flow consolidé, déclaration) vérifiées par la base | Implémenté et testé | SQL (44 vérifications) + unitaires |
| Mon abonnement : formule, jauges d'usage, choix de formule mensuel/annuel, pack fiscal ; verrous dans Contacts, Comparer, Déclaration fiscale, baux, tableau de bord | Implémenté et testé (démonstration) | e2e |
| Administration : formule par compte, accès manuel par formule, formule d'essai, application des formules | Implémenté et testé | SQL + e2e |
| Stripe : checkout par formule, pack fiscal en paiement ponctuel, confirmation différée du prélèvement SEPA | Implémenté et testé (logique) / **à configurer** (produits, prix, webhook) | unitaires |
| Site vitrine : section Tarifs avec la grille | Implémenté et testé | e2e + captures |

Migration à exécuter : `20261018000500_formules.sql`. Le contrôle reste désactivé tant qu'un administrateur ne l'active pas (Administration → Application des formules).

## Baux, déclaration par régime, espace locataire (20 octobre 2026)

| Fonction | État | Preuve |
|---|---|---|
| Contrat de bail vide et meublé d'après les contrats types (décret n° 2015-587), bail civil (résidence secondaire, société) et parking d'après le Code civil : saisie, contrôles bloquants, aperçu, PDF, enregistrement dans les documents | Implémenté et testé / **non validé par un juriste** | unitaires + SQL + e2e |
| Déclaration par régime : micro-BIC 5NI / 5NG / 5NH (revenus 2025) ou 5ND / 5NG (2024), liasse 2033-B et 2031 des LMNP au réel, case 4BD, parcours espace particulier / professionnel, SCI à l'IR (2072) et à l'IS (2065, consignes), dossier PDF | Implémenté et testé (calculs) / **non validé par un professionnel** | unitaires + e2e |
| Espace locataire : invitation par e-mail (code à usage unique lié à l'adresse, 30 jours), acceptation, quittances et documents partagés en lecture seule, aperçu du bailleur, révocation | Implémenté et testé (SQL, démonstration) / **à configurer** (migration `20261020000100`, fonction `daily` redéployée) ; parcours réel du locataire non testé contre Supabase Auth | SQL + e2e |
| Offre Découverte limitée à 30 jours, puis consultation seule sans abonnement (si les formules sont appliquées) ; site vitrine mis à jour | Implémenté et testé | SQL + e2e |

## Corrections de la recette (20 octobre 2026)

Cahier de test de 166 cas exécuté (voir le document de recette du projet). Corrections :

| Anomalie | Correction | Preuve |
|---|---|---|
| ANO-001 Tâches planifiées refusées (401), aucun e-mail envoyé | La fonction `daily` vérifie le jeton dans le coffre de la base (`iz_cron_token_ok`) ; `CRON_SECRET` devient facultatif | SQL + contrôle en ligne |
| ANO-002 Migration de l'assistant absente en ligne | Appliquée | contrôle en ligne |
| ANO-003 Dépôt de garantie et forfait de charges contrôlés seulement au contrat | Contrôlés dès la saisie du bail (`leaseFormIssues`) | unitaires + recette |
| ANO-004 Échéance annulée sans motif | Motif obligatoire, conservé (`rent_charges.cancel_reason`) et affiché | SQL + recette |
| ANO-005 Pas d'alerte DPE sur la fiche | Alertes automatiques F, G, E (`dpeAlerts`) dans la vigilance | unitaires + recette |
| ANO-006 Parcours du tableau de bord non cliquable | Chaque étape ouvre la prospection filtrée (`?statut=`) | recette |
| ANO-008 Analyse de sécurité Supabase | Fonctions SECURITY DEFINER retirées au rôle anonyme (sauf le formulaire du site), search_path fixé | SQL + analyse en ligne |
| ANO-007 Mentions légales | **À compléter** : identité de l'éditeur | — |

Migration à exécuter sur un autre projet : `20261020000300_corrections_recette.sql` (déjà appliquée sur le projet en ligne). Réglage manuel restant : Authentication → Password security → protection contre les mots de passe compromis.

## Loyers et paiements : un seul tableau (29 octobre 2026)

Expression de besoin du 29/10/2026. Migration à exécuter : `20261029000100_loyers_tableau_unique.sql` (sans elle, un paiement ne peut pas être enregistré).

| Fonction | État | Preuve |
|---|---|---|
| Une ligne par bail et par mois : loyer dû (HC), charges dues, autre somme due (avec libellés), total dû, réglé (détail des paiements), date de règlement, reçu, écart, statut, quittance | Implémenté et testé | unitaires + e2e |
| Lignes de tous les mois passés à la saisie des dates du bail, puis le 1er de chaque mois (serveur, et à l'ouverture de l'écran) ; point de départ au choix (début du bail ou date choisie, réglage général) | Implémenté et testé | SQL + unitaires + e2e |
| Paiement rattaché au mois de sa date, déplaçable dans l'aperçu ou à la saisie ; paiements d'un même mois additionnés | Implémenté et testé | unitaires + e2e |
| Reste dû d'un mois échu reporté dans « Autre somme due » du mois suivant (« Reste dû MM/AAAA »), compté une seule fois ; cascade ; dernier mois du bail sans report (solde de sortie avec le dépôt) | Implémenté et testé | unitaires + SQL + e2e |
| Excédent qualifié : autre somme due, loyer supérieur (option : appliqué au bail), trop-perçu (option : reporté en avance) ; « Qualifier l'écart » a posteriori | Implémenté et testé | unitaires + e2e |
| Colonne « Reçu » : automatique ou après confirmation (réglage général), confirmation par ligne ou groupée | Implémenté et testé | unitaires + SQL |
| Quittance du mois avec les autres sommes sur des lignes distinctes, dont « Reste dû MM/AAAA réglé » ; pas de réémission pour le mois d'origine | Implémenté et testé | SQL + e2e |
| Import d'un relevé : mois par ligne, aperçu par mois (dû, réglé avant/après, écart, excédent, quittance ou reçu partiel) | Implémenté et testé | unitaires + e2e |
| Colocation : bail solidaire (une ligne) ou baux distincts (une ligne par bail), plusieurs baux par logement | Implémenté (existant) | e2e |
| Reprise des échéances et paiements existants : validée par l'utilisateur, sauvegarde JSON téléchargée avant | Implémenté et testé (logique) / **non exécuté** sur les données en ligne | unitaires |
| Commandes « Mettre en cohérence paiements et quittances » et « Répartir les paiements par mois » supprimées (écran et code) | Implémenté et testé | e2e |

Limites : les reports et la répartition sont calculés par l'application (à l'ouverture de Loyers et paiements et après chaque écriture), pas par la tâche serveur du 1er du mois ; en attendant, la dette d'un mois non encore reporté reste comptée sur sa ligne d'origine (jamais deux fois). Une somme déjà quittancée n'est jamais modifiée par la reprise.

## Loyers de marché et taux de crédit (30 octobre 2026)

Expression de besoin des 29-30/10/2026, règles : [LOYERS-ET-TAUX](LOYERS-ET-TAUX.md). Migration à exécuter : `20261030000100_loyers_marche_taux.sql`, puis chargement des données dans Administration → Données de marché.

| Fonction | État | Preuve |
|---|---|---|
| Fourchette bas / central / haut (Carte des loyers), CC et HC, segment selon les pièces, arrondissements de Paris, Lyon, Marseille, coefficient meublé 1,15, fiabilité (R², annonces, maille, fourchette large, surface) | Implémenté et testé | unitaires + e2e |
| Calcul automatique dans la fiche unique, sur demande dans la fiche du bien, photographie enregistrée, nouveau millésime proposé, saisie manuelle | Implémenté et testé | e2e |
| Plafond légal = loyer haut dans les territoires encadrés (zone, pièces, année, meublé), fin de validité au 23/11/2026 prolongeable, alerte si plafond dépassé | Implémenté et testé (plafonds de démonstration) / **à charger** (arrêtés des 9 territoires) | unitaires + SQL + e2e |
| Reprise dans la simulation et dans un nouveau bail sur clic seulement ; comparaison au dernier bail (relocation) | Implémenté et testé | e2e |
| Colonnes de prospection « Loyer de marché central », « Écart loyer / marché » (exportées) | Implémenté | — |
| Taux de référence selon la durée (barème, interpolation), TAEG estimé, contrôle du taux d'usure (particulier / SCI), « Plafond non à jour » | Implémenté et testé | unitaires + e2e |
| Scénarios loyer bas / central / haut et taux bas / référence / haut | Implémenté et testé | e2e |
| Renégociation à étudier (biens détenus) | Implémenté et testé (calcul) | unitaires |
| Administration → Données de marché : Carte des loyers (CSV), plafonds (CSV), barème, taux d'usure, réglages | Implémenté et testé (démonstration) | SQL + e2e |
| Mise à jour automatique chaque nuit : Carte des loyers, taux d'usure (page de la Banque de France), plafonds de Paris ; rappel mensuel (barème, arrêtés) ; suivi dans l'administration | Implémenté et testé (réponses simulées) / **à activer** (fonction `marche`, planification) | unitaires + SQL + e2e |
| Contours des zones d'encadrement hors Paris, tendance mensuelle des taux, barème automatique (accord Crédit Logement) | **Restant** | — |

## Restant

Tout le périmètre du cahier des charges est livré. Reste **à configurer** : compte Stripe et fonctions `platform` / `stripe-webhook` ([ABONNEMENTS](ABONNEMENTS.md)), premier administrateur, envoi réel des e-mails (Resend). Pistes ultérieures : vérification de l'abonnement dans les fonctions serveur (quittances, relances), réimport de la gestion locative depuis une sauvegarde, liasse 2031/2033 complète, travaux de rénovation énergétique et déficits antérieurs dans la déclaration.

## Limites connues

### Lot 2
- **Migration du 16/10 à exécuter** : `20261016000100_property_loan.sql` (crédit des biens détenus ; reprend aussi, sans effet s'ils existent, les champs du 14/10, et retire le nom de l'ancienne version des libellés repris). Sans elle, un bien détenu avec un crédit ne peut pas être enregistré.
- Le cash-flow prévisionnel ne compte ni la vacance locative ni l'entretien d'un bien détenu, faute de champ dédié (les dépenses réelles sont dans le cash-flow réel).
- Migrations complémentaires du 14/10 (reprises par celle du 16/10) : `20261014000100_property_charges_provision.sql` (provision sur charges) et `20261014000300_property_annual_charges.sql` (charges annuelles de Mes biens). Sans elles, un bien dont ces champs sont renseignés ne peut pas être enregistré.
- **Migration SQL à exécuter** : `supabase/migrations/20261014000200_lot2_gestion_locative.sql`. Tant qu'elle ne l'est pas, l'application fonctionne pour le lot 1 et affiche un bandeau « Mise à jour de la base requise ».
- **E-mails non envoyés** tant que la fonction `daily`, la planification et un fournisseur (Resend) ne sont pas configurés ([TACHES-SERVEUR](TACHES-SERVEUR.md)). Les messages restent en file, visibles comme « envoi en attente ».
- Ni la fonction serveur ni le stockage Supabase n'ont pu être exécutés pendant le développement : leur logique est testée, pas leur déploiement.
- Modèle de quittance établi d'après les mentions usuelles (loi du 6 juillet 1989, art. 21), **non validé juridiquement** ; le reçu partiel l'indique expressément. Aucun contrat de bail n'est généré.
- Révision de loyer : seules les échéances générées après la modification du bail en tiennent compte. Une fin de bail avancée annule les échéances suivantes non réglées mais ne recalcule pas le prorata d'un mois déjà généré (à corriger à la main).
- La réimportation d'une sauvegarde ne restaure pas encore la gestion locative (exportée pour archivage).
- Pas d'import CSV de relevés bancaires ; pas de régularisation de charges automatisée (saisie d'une somme due).

### Lot 1

- **Création de compte ouverte** tant que l'abonnement (lot 3) n'existe pas : n'importe qui peut créer un compte et utiliser l'application gratuitement.
- **Pas de projet Supabase ni de navigateur connecté au réseau** pendant ce lot : l'authentification réelle, les appels PostgREST et la reprise sur la base de production n'ont pas été exécutés. Les migrations sont testées sur PostgreSQL 16 avec une émulation minimale de Supabase (`auth.uid()`, rôles). Une recette sur un projet Supabase de test est indispensable avant la production (voir DEPLOIEMENT).
- La CI installe les vraies dépendances npm ; en local, ce lot a été vérifié avec des versions déjà présentes (React 19.2, TypeScript 6.0, supabase-js 2.117 compilé depuis ses sources). Aucun fichier de verrouillage `package-lock.json` n'a pu être généré : à commiter après le premier `npm install`.
- Copie locale des données (lecture hors connexion) stockée en clair dans le navigateur, effacée à la déconnexion. À éviter sur un appareil partagé sans déconnexion.
- Taille du script : ~1,2 Mo minifié depuis le lot 2 (génération PDF intégrée), ≈ 350 Ko compressé. Un chargement différé du module PDF est prévu.
- Les résultats des simulations reprises peuvent différer de l'ancienne version, dont le « mode simplifié » mélangeait loyer charges comprises et charges partielles. Les anciennes valeurs sont conservées dans `inputs.legacy.results`.
