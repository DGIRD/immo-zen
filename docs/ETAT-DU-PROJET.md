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
| Déclaration fiscale : micro-foncier (4BE), 2044 ligne par ligne et 4BA/4BB/4BC, micro-BIC (5ND), LMNP réel avec amortissements et report (5NA/5NY), saisies complémentaires, export Excel | Implémenté et testé (calculs) / **non validé par un professionnel** | unitaires + e2e |

## Évolutions du 17 octobre 2026

| Fonction | État | Preuve |
|---|---|---|
| Saisie automatique des adresses (Base Adresse Nationale, IGN) : code postal et ville remplis ; communes d'un code postal | Implémenté et testé (services simulés) | unitaires + e2e |
| Dépenses : ligne d'ajout rapide, bouton Supprimer par ligne, suppression multiple, duplication | Implémenté et testé | e2e |
| Import Excel des loyers : bail retrouvé, répartition automatique, anti-doublon | Implémenté et testé | unitaires + SQL + e2e |
| Révision annuelle IRL : indices INSEE intégrés, une fois par année de bail, sans rétroactivité, gel F/G, échéances mises à jour, historique, rappel au tableau de bord | Implémenté et testé | unitaires + SQL + e2e |
| Rappel de charges des années précédentes repris sur la quittance (ligne distincte, jamais quittancé deux fois) | Implémenté et testé | unitaires + SQL + e2e |

Limites : les valeurs IRL sont intégrées jusqu'au 3e trimestre 2026 (à compléter chaque trimestre ou saisir à la main) ; la révision ne modifie pas les échéances déjà partiellement réglées ; le service d'adresses n'a pas été appelé réellement pendant les tests (réponses simulées).

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
