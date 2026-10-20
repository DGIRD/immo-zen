# Déclaration fiscale : sources et règles de calcul

Source : `src/domain/fiscal.ts` · Tests : `tests/fiscal.test.ts`, e2e « déclaration fiscale ».
Références : formulaire 2044 (édition 2026, revenus 2025), 2042 (cases 4BA, 4BB, 4BC, 4BD, 4BE), 2042-C-PRO (édition 2026 : 5NI, 5NG, 5NH, 5NA, 5NY ; édition 2025 : 5ND, 5NG), liasse 2031 et 2033-B (lignes 218 à 354). Parcours de déclaration : `src/domain/taxGuide.ts`.
**Aide au remplissage, non validée par un professionnel : ni attestation ni conseil fiscal.**

## Données retenues (principe de caisse, année civile)

- **Loyers** : paiements des baux encaissés dans l'année, répartis entre loyer et charges au prorata de chaque échéance ; paiements non affectés comptés en loyers. Recettes importées d'un relevé (catégorie « Loyer ») : réparties selon le loyer et la provision saisis sur le bien, sinon comptées hors charges (signalé).
- **Dépenses** : dépenses payées dans l'année (date de paiement), par catégorie.
- **Intérêts et assurance d'emprunt** : catégories « Intérêts d'emprunt » / « Assurance crédit » si elles existent pour l'année ; sinon tableau d'amortissement du crédit saisi dans Mes biens (échéances tombant dans l'année). Les mensualités « Crédit » ne sont jamais déduites telles quelles.

## Catégories → 2044 (location nue au réel)

| Catégorie | Ligne |
|---|---|
| Loyer (recette), paiements des baux | 211 (hors charges) |
| Saisie « recettes diverses » | 213 |
| Gestion locative | 221 |
| Forfait 20 € par bien loué | 222 |
| Assurance | 223 |
| Entretien amortissable / non amortissable, Travaux | 224 |
| Taxe foncière − part récupérable (ordures ménagères) | 227 |
| Charges de copropriété (dont travaux) | 229 |
| Saisie « régularisation N−1 » | 230 (déduite) |
| Intérêts, Assurance crédit, Frais de crédit | 250 |
| Meuble, Frais bancaires, Crédit, Autres | non déductibles, listés à part |

Report sur la 2042 (lignes 420 à 442) : bénéfice → 4BA ; déficit hors intérêts imputable sur le revenu global dans la limite de 10 700 € → 4BC ; reste et part due aux intérêts → 4BB. Travaux de rénovation énergétique (plafond relevé) et déficits antérieurs (4BD) : non calculés.

## Autres régimes

- **Micro-foncier** : 4BE = loyers bruts hors charges + recettes diverses ; alerte au-delà de 15 000 € ou en cas de cumul avec le réel.
- **Micro-BIC** (recettes charges comprises, abattement minimum 305 €), selon la nature du meublé choisie pour chaque bien :
  - revenus 2025 et suivants (loi n° 2024-1039) : **5NI** location meublée classique (50 %, 77 700 €), **5NG** meublé de tourisme classé ou chambre d'hôtes (50 %, 77 700 €), **5NH** meublé de tourisme non classé (30 %, 15 000 €) ; alerte si le total dépasse 77 700 € ;
  - revenus 2024 : **5ND** (50 %, 77 700 €), **5NG** classé (71 %, 188 700 €).
  Second déclarant : 5OI / 5OG / 5OH ; personne à charge : 5PI / 5PG / 5PH.
- **LMNP au réel** : recettes charges comprises − charges (copropriété, taxe foncière, assurances, entretien non amortissable, gestion, frais bancaires et de crédit, assurance emprunteur, autres) − intérêts. Amortissement linéaire au prorata du temps : bâti (valeur amortissable − part du terrain, 15 % par défaut, 30 ans), meubles (7 ans), entretien amortissable et travaux immobilisés (10 ans), tous modifiables. Article 39 C : l'amortissement ne crée ni n'augmente un déficit, l'excédent est reporté (calcul depuis l'année d'acquisition). Résultat → 5NA ou 5NY (compensation entre meublés de la même activité). **Liasse 2033-B** de l'activité : 218 (recettes), 242 (autres charges externes), 244 (taxe foncière, CFE), 254 (dotations de l'année), 264, 270, 294 (intérêts), 310 (résultat comptable), 318 (amortissements non déductibles réintégrés, art. 39 C), imputation des amortissements différés antérieurs (sans code, à vérifier avec la notice), 352 ou 354 (résultat fiscal reporté sur la 2031) ; immobilisations et amortissements cumulés pour la 2033-C. Les numéros de ligne suivent le formulaire 2033-B simplifié : à vérifier avec la notice de l'année.
- **Parcours impots.gouv.fr** : espace particulier (déclaration en ligne : rubrique « Revenus fonciers » micro ou 2044 ; « Revenus des locations meublées non professionnelles » pour la 2042-C-PRO) ; espace professionnel pour la liasse LMNP (SIRET, tuile « Résultat », régime réel simplifié, saisie 2033-A, C, B, D puis 2031 ; date limite : 2e jour ouvré suivant le 1er mai), la 2072 d'une SCI à l'IR et la 2065 d'une société à l'IS (consignes, sans calcul).
- **Section Amortissements** (tous régimes) : chaque élément amorti avec sa base, sa durée, sa dotation de l'année, le cumul et le reste à amortir. La durée se choisit sur la dépense (onglet Dépenses, champ « Durée d'amortissement », ou colonne du même nom à l'import) ; à défaut, durée par défaut de la catégorie (meubles 7 ans, travaux 10 ans, modifiables). Une dépense dotée d'une durée est amortie et n'est plus déduite en charge (LMNP). Déductibles en LMNP au réel (et à l'IS) ; information seulement en location nue et aux régimes micro.
- **IS, autre** : pas de calcul, données disponibles dans Dépenses et Loyers.
