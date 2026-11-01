# Loyers de marché et taux de crédit

Expression de besoin des 29 et 30 octobre 2026. Calculs : `src/domain/marketRent.ts`, `src/domain/marketRentLookup.ts`, `src/domain/loanRates.ts` (tests : `tests/marketRent.test.ts`, `tests/loanRates.test.ts`). Migration : `supabase/migrations/20261030000100_loyers_marche_taux.sql`.

## Loyer de marché

**Source.** Carte des loyers (ANIL, ministère chargé du Logement), millésime chargé par l'administrateur (Administration → Données de marché). Loyers d'annonce, charges comprises, location vide, par commune : bas (`lwr.IPm2`), central (`loypredm2`), haut (`upr.IPm2`), en €/m²/mois. Mention affichée : « Estimations ANIL, à partir des données du Groupe SeLoger et de leboncoin ».

**Calcul.** Loyer mensuel CC = indicateur × surface, arrondi à l'euro (bas, central, haut).

| Règle | Contenu |
|---|---|
| Segment | Maison → maisons ; appartement 1-2 pièces → T1-T2 ; 3 pièces et plus → T3+ ; pièces inconnues → appartements (tous). Segment absent : repli sur appartements (tous), signalé. |
| Paris, Lyon, Marseille | Indicateur de l'arrondissement (code postal), sinon de la commune. |
| Meublé | Coefficient 1,15 par défaut (réglable par l'administrateur, modifiable par bien). |
| Hors charges | CC − charges mensuelles du bien (provision ; dans le simulateur, provision saisie ou 80 % des charges de copropriété). Charges inconnues : CC seul, signalé. |
| Fiabilité | Bonne : niveau commune, R² ≥ 0,5, ≥ 30 annonces. Faible : R² < 0,5, < 30 annonces, ou fourchette trop large (haut − bas > 60 % du central, seuil réglable). Moyenne sinon (EPCI, maille). Un cran de moins si la surface s'écarte de plus de 50 % du bien type (37, 52, 72 ou 92 m²) ou en cas de repli de segment. |
| Photographie | Fourchette, millésime, segment, fiabilité et date enregistrés avec le bien (`properties.market_rent`). Recalcul automatique si les caractéristiques changent ; un nouveau millésime est proposé (« Mettre à jour »), jamais appliqué seul. Saisie manuelle possible (le plafond légal ne peut pas être relevé). |
| Reprise | Jamais automatique : « Reprendre bas et haut dans la simulation » (loyers au m² hors charges), « Utiliser le loyer central », ou dans un nouveau bail « Utiliser le loyer central / le plafond légal ». |

**Encadrement.** Dans les 9 territoires encadrés (Paris, Lille-Hellemmes-Lomme, Plaine Commune, Est Ensemble, Lyon et Villeurbanne, Montpellier, Bordeaux, Pays basque, Grenoble-Alpes Métropole), le loyer haut = loyer de référence majoré × surface (hors charges ; CC = plafond + charges). Le plafond est cherché par commune, zone (choisie dans la fiche si la commune en compte plusieurs, ou « Hors zone encadrée »), nombre de pièces (4 = 4 et plus), année de construction et type de location. Plafonds chargés par l'administrateur (modèle : `docs/modeles/plafonds-encadrement.csv`), avec une fin de validité (23/11/2026 par défaut, fin de l'expérimentation sauf nouvelle loi) : après elle, retour automatique au haut de la Carte des loyers. Commune encadrée sans plafonds chargés : message d'alerte.

**Où.** Fiche unique prospection/simulation (calcul automatique), fiche du bien (calcul sur demande), nouveau bail (relocation, comparaison au dernier bail), tableau de prospection (colonnes « Loyer de marché central » et « Écart loyer / marché », masquées par défaut, exportées).

## Taux de crédit

| Donnée | Source | Mise à jour |
|---|---|---|
| Barème des taux nominaux hors assurance (10, 15, 20, 25 ans…) | Saisi par l'administrateur (Observatoire Crédit Logement/CSA, courtiers) ; réutilisation automatique de Crédit Logement soumise à son accord | Mensuelle ; « à vérifier » au-delà de 45 jours |
| Taux effectif moyen et taux d'usure par tranche (< 10 ans, 10-20 ans, ≥ 20 ans, variable, relais ; personnes morales) | Banque de France ; 4e trimestre 2026 chargé par la migration | Trimestrielle, saisie avant le 1er janvier, avril, juillet, octobre |

- Taux proposé : interpolation linéaire entre les deux durées voisines du barème (22 ans entre 3,55 % à 20 ans et 3,70 % à 25 ans → 3,61 %) ; hors barème, durée la plus proche (signalé). Repris sur clic (« Utiliser ce taux »).
- TAEG estimé : taux actuariel annuel ((1 + i)¹² − 1) égalisant capital − frais de garantie et de dossier et les mensualités assurance comprise, sans différé. Comparé au taux d'usure de la tranche et de l'emprunteur (particulier ou société, sélection dans le financement) : sous le plafond, proche (< 0,25 point), dépassé (« Financement probablement refusé »).
- Trimestre non chargé : « Plafond non à jour », jamais de valeur périmée.
- Scénarios (simulateur) : cash-flow et rendement brut aux loyers bas, central et haut de marché, et aux taux référence − 0,3, référence, référence + 0,3 point.
- Biens détenus : taux du crédit comparé au barème de la durée restante ; « Renégociation à étudier » au-delà de 0,7 point (réglable).

## Mise à jour automatique (fonction serveur « marche », chaque nuit)

| Donnée | Source interrogée | Publication | Chargement |
|---|---|---|---|
| Carte des loyers | API data.gouv.fr, jeu `carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-AAAA` (année en cours, sinon précédente) | Décembre | Automatique : segment par segment dès qu'un fichier est nouveau ou republié (somme de contrôle) ; reprise la nuit suivante si le temps manque (100 s par exécution) |
| Taux d'usure | Page publique de la Banque de France `taux-dusure-AAAA-qN`, trimestre en cours et suivant | Fin de chaque trimestre | Automatique dès publication ; un trimestre déjà présent (saisi à la main) n'est jamais écrasé |
| Plafonds de Paris | Données ouvertes de la Ville de Paris (`logement-encadrement-des-loyers`, année) | 1er juillet | Automatique : un plafond par quartier administratif (zone = quartier), rangé sous son arrondissement ; validité du 1er juillet au 30 juin, au plus tard à la fin de l'encadrement (réglage) |
| Barème des taux par durée | — (Crédit Logement/CSA : reproduction soumise à accord) | Mensuelle | Saisie par l'administrateur ; rappel par e-mail le 1er du mois |
| Plafonds des 8 autres territoires | — (arrêtés préfectoraux en PDF) | Annuelle | Chargement du modèle CSV ; rappel quand un arrêté a plus d'un an ou expire dans 45 jours |

- Garde-fous : fichier jugé incomplet (moins de 1 000 communes, moins de 500 plafonds de Paris, tableau d'usure incomplet) : rien n'est remplacé ; chaque source est indépendante ; remplacement en une transaction (plafonds) ou par lots ordonnés (Carte).
- Suivi : Administration → Données de marché → « Mises à jour automatiques » (dernier chargement de chaque source) ; journal `job_runs` (« marche ») ; un échec apparaît dans Incidents et est signalé par e-mail, une fois par semaine au plus pour la même erreur.
- Rappel du 1er du mois (adresse de support) : barème à saisir, usure du trimestre manquante, millésime ancien, arrêtés à vérifier, fin de l'encadrement dans moins de 45 jours, et ce qui a été chargé ou a échoué.
- Mise en route : migration `20261030000200_donnees_marche_auto.sql`, workflow « Fonctions serveur Supabase » (fonction `marche`), puis `supabase/scheduling-marche.sql` dans le SQL Editor. Aucune clé d'API.

## Limites

- Formats des sources lus d'après leur publication au 30/10/2026, sans accès réseau depuis l'environnement de développement : testés sur des réponses simulées. Un changement de format est détecté (rien n'est remplacé) et signalé.
- Zone d'encadrement choisie par l'utilisateur, pas déduite de l'adresse (contours non chargés).
- Pas de tendance mensuelle des taux au tableau de bord (série MIR1 de la Banque de France non chargée).
- La fourchette ne tient compte ni de l'étage, ni du DPE, ni de l'état, ni des extérieurs.
