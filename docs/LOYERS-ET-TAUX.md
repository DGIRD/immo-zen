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

## Limites

- Données de marché chargées à la main par l'administrateur (fichiers data.gouv.fr, arrêtés préfectoraux, valeurs de la Banque de France) : pas encore de récupération automatique (l'API Webstat de la Banque de France demande une inscription ; à brancher dans une fonction serveur planifiée).
- Zone d'encadrement choisie par l'utilisateur, pas déduite de l'adresse (contours non chargés).
- Pas de tendance mensuelle des taux au tableau de bord (série MIR1 de la Banque de France non chargée).
- La fourchette ne tient compte ni de l'étage, ni du DPE, ni de l'état, ni des extérieurs.
