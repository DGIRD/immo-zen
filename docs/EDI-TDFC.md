# Télétransmission EDI-TDFC de la liasse LMNP

État au 4 novembre 2026 : **liasse complète (F-IDENTIF, 2031, 2033-A à G) et signature AUTACK livrées et testées**. La transmission réelle demande encore trois choses :
- l'envoi SFTP et une fonction serveur de signature ;
- l'habilitation (agrément, accréditation, alias) ;
- l'attestation EDIFICAS et une validation fiscale.

Référentiel utilisé : cahier des charges EDI-TDFC de la **campagne 2026** (DGFiP), volume IV (GUM INFENT-DF 26.01, GUM AUTACK PEDI 13.01), dictionnaire des données éditeurs v2026, et pack technique « nouvelle sécurisation EDI » v1.1. Ces documents sont rangés sur le Drive, dans *Entreprise / Immo-Zen / Prérequis EDI-TDFC et facturation électronique*.

## Modules

| Fichier | Rôle |
| --- | --- |
| `src/domain/edi/edifact.ts` | Syntaxe EDIFACT (UNA `:+,? '`), échappement, montants (troncature, statuts 62 et 65), encodage ISO 8859-15 (€ = A4) |
| `src/domain/edi/tdfc.ts` | Correspondance liasse → codes TDFC, message INFENT-DF, interchange, bilan 2033-A, contrôles avant envoi, `secureInterchange` |
| `src/domain/edi/autack.ts` | Bloc signé, accréditation, groupe AUTACK PEDI (navigateur, Deno et Node ; aucune clé privée) |
| `supabase/functions/_shared/tdfcSigner.ts` | Signature RSA côté serveur (`node:crypto`), contrôle clé ↔ accréditation |
| `src/domain/bilan.ts` | Créances, dépôts, charges à payer, emprunts et compte de l'exploitant suivi |
| `src/domain/bilanReview.ts`, `src/pages/FiscalBilan.tsx` | Écran de relecture du bilan (Déclaration fiscale → LMNP) : origine de chaque ligne, saisies, corrections motivées et conservées |
| `tests/tdfc.test.ts`, `tests/autack.test.ts`, `tests/bilan.test.ts`, `tests/bilanReview.test.ts` | 35 tests, dont l'exemple signé par la DGFiP, la population fictive et l'équilibre spontané du bilan |
| `tests/fixtures/tdfc/` | Exemples publics du pack technique DGFiP (partenaire fictif) |
| `scripts/tdfc-exemple.ts` | Interchange de test non signé : `node --import tsx scripts/tdfc-exemple.ts sortie.edi` |

## Formulaires

| Formulaire | Données |
| --- | --- |
| F-IDENTIF | Déclarant (SIREN, nom, adresse), BIC / réel simplifié / IR, période, durée, EUR, ROF, NAF |
| 2031 | Activité, domicile, résultat fiscal (CA/CB), BIC non professionnels (CW/CX) |
| 2033-A | Immobilisations corporelles (brut, amortissements, net), créances, disponibilités, capital individuel, résultat, emprunts (capital restant dû), dépôts de garantie, dettes à plus d'un an, acquisitions de l'exercice |
| 2033-B | Lignes 218 à 310 ; réintégration art. 39 C (CF) ; amortissements différés imputés (EL, MA/MB) ; bénéfice (CM/CR) ou déficit (EM/ER) |
| 2033-C | Terrains, constructions (bâti), agencements (travaux), autres immobilisations (meubles) : brut et amortissements (début, augmentations, fin), totaux |
| 2033-D à G | Déposés néant |

**Bilan 2033-A** (`src/domain/bilan.ts`, `bilanFacts`) : construit à partir des données de gestion, sans saisie dans le cas courant.

| Ligne | Origine |
| --- | --- |
| Immobilisations (brut, amortissements) | Liasse : terrain, bâti, meubles, travaux |
| Créances (AJ/CJ) | Échéances échues au 31/12 non couvertes par des paiements reçus au plus tard le 31/12 |
| Disponibilités (AM/CM) | 0 par défaut (activité sans compte dédié) ; solde saisi sinon |
| Capital individuel (FA) | Compte de l'exploitant **suivi** depuis l'acquisition (voir ci-dessous) |
| Résultat (FG) | Ligne 310 du 2033-B |
| Emprunts (FL), dettes à plus d'un an (JA) | Capital restant dû **de la banque** s'il est saisi (`loan_remaining_bank`), sinon calculé ; alerte au-delà de 5 € d'écart |
| Autres dettes (FP) | Dépôts de garantie détenus (encaissements − restitutions − retenues) + charges à payer (dépenses de l'année non payées au 31/12) |

**Compte de l'exploitant** :
- **Ouverture** (l'année de l'achat) : apport = prix et frais − emprunt.
- **Chaque année** : solde précédent + résultat de l'année précédente + apports (dépenses payées, échéances d'emprunt, dépôts restitués) − prélèvements (loyers et recettes encaissés, dépôts encaissés, sauf la trésorerie conservée sur un compte dédié).
- **Reprise** : si les années précédentes n'ont pas été tenues dans l'application, les capitaux propres du bilan N-1 déposé sont repris (`openingEquity`).

Avec des données complètes, le bilan s'équilibre de lui-même (test « données complètes sans impayé »).

Le résultat de la liasse étant calculé sur les encaissements, l'écart entre le bilan et le compte suivi est calculé puis décomposé :
- loyers impayés au 31/12 ;
- charges à payer ;
- écart banque / calcul ;
- reste non expliqué.

Un écart entièrement expliqué donne un avertissement, un écart non expliqué bloque l'envoi. Le capital transmis est celui qui équilibre le bilan.

**À trancher avec l'expert-comptable** : en BIC, le résultat se calcule en principe sur les créances acquises et les dépenses engagées (art. 38-2 bis du CGI), et non sur les encaissements. Passer la liasse en engagements ferait disparaître l'écart, mais modifierait les montants déclarés.

**Écran de relecture** (page Déclaration fiscale, section LMNP, sous le 2033-B) :
- **Lecture** : actif et passif ligne par ligne, avec une étiquette d'origine (Liasse, Calculé, Banque, Saisi, Convention, Suivi depuis l'achat, Bilan N-1 repris, Corrigé). Chaque ligne se déplie sur son détail : biens, impayés par bail, charges à payer, mouvements du compte de l'exploitant, emprunts par bien.
- **État** : actif = passif, ou écart expliqué ou non expliqué.
- **Saisies** : capital restant dû de la banque par bien, trésorerie d'un compte dédié, capitaux propres du bilan N-1.
- **Corrections** : pour les créances, les dépôts de garantie et les charges à payer, l'abonné saisit un montant et un motif obligatoire. La correction la plus récente s'applique. Une correction annulée reste visible dans l'historique (date, motif, état). Ces données sont enregistrées avec les autres saisies fiscales, dans `bilan_corrections` (foyer, par année).
- **Mobile** : à 390 px, le code et l'origine passent sous le libellé ; le montant reste toujours visible.

## Signature (AUTACK PEDI)

Le procédé est reproduit d'après `signer_donnees.c` de la DGFiP et vérifié sur l'exemple officiel (`tests/autack.test.ts`) :
1. Le **bloc signé** (44 octets) est le SHA-256 du groupe fonctionnel INFENT, de `UNG` à `UNE…'` inclus, sur les octets ISO 8859-15 transmis, suivi de `AAAAMMJJhhmm`. Cet horodatage est identique à la date et à l'heure de l'UNG, en heure de Paris.
2. La **signature** RSA 2048 bits utilise le remplissage PKCS#1 v1.5 de type 1, sans en-tête d'algorithme (`RSA_private_encrypt`). Elle est transmise en hexadécimal (512 caractères) dans `USY`.
3. Le **second groupe fonctionnel** est l'AUTACK (`USH+1+1+3+1+2+2`, `USC++++ZZ1+2`, `USR` avec l'accréditation de 1368 caractères, `USB`, `USX++++1`, `USY`, `UST`). L'`UNZ` compte alors 2 groupes.
4. L'**accréditation** est décodée : SIRET étendu, dispositif, clé publique certifiée. La fonction serveur vérifie que la clé publique certifiée est bien celle de la clé privée utilisée.

**Clé privée** : elle est générée par Immo-Zen (RSA 2048, exposant 65537), conservée comme secret de la fonction serveur (`TDFC_PRIVATE_KEY`, `TDFC_PRIVATE_KEY_PASSPHRASE`) et ne passe jamais par le navigateur. Seule la clé publique (PEM) est remise au correspondant téléprocédures, qui délivre en retour l'accréditation.

## Reste à faire

1. **Fonction serveur `tdfc`** : construire la liasse, signer avec la clé secrète, archiver l'interchange et sa référence.
2. **Transfert SFTP (PassTrans)** et lecture des retours : accusé de réception (INFENT-RCS), CONTRL, compte rendu (INFENT-CR, signé par la DGFiP et vérifiable avec `dgfip_cle_publique_pedi.pem`).
3. **Interface de télétransmission** : SIREN, ROF, mandat de l'abonné, aperçu de l'interchange, historique des dépôts (l'écran de relecture du bilan est livré).
4. **Campagne 2027** : intégrer le nouveau cahier des charges dès sa publication (mars 2027).

## Points à faire valider

- La correspondance des lignes papier avec les codes EDI a été établie d'après les libellés du dictionnaire. Sont notamment à relire : CF et EL au 2033-B, CW et CX au 2031, et le bilan construit autour du compte de l'exploitant.
- Le terrain est estimé par le pourcentage saisi (15 % par défaut) du coût d'acquisition.
- L'attestation de conformité EDIFICAS est indispensable avant tout envoi.
