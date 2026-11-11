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

## Fonction serveur `tdfc`

| Fichier | Rôle |
| --- | --- |
| `supabase/functions/tdfc/index.ts` | Enveloppe Deno : session, lecture des données avec les droits de l'abonné (RLS), mandat, clé, archive |
| `supabase/functions/tdfc/core.ts` | Cœur pur : liasse, contrôles, numéro séquentiel, interchange signé, auto-vérification de la signature |
| `scripts/build-functions.mjs` | Regroupe `core.ts` et `src/domain` dans `core.bundle.js` (ignoré par git), avant le déploiement |
| `supabase/migrations/20261107000100_tdfc.sql` | `tdfc_declarants`, `tdfc_mandates`, `tdfc_submissions`, `tdfc_sequences`, `iz_tdfc_next_sequence`, `iz_tdfc_revoke_mandate` |
| `tests/tdfcServer.test.ts`, `supabase/tests/99c_tdfc.test.sql` | 7 tests du cœur (dont le fichier regroupé) et 29 vérifications SQL (droits, mandat, archive, compteur) |

**Actions** (POST, session de l'abonné) :
- `{ action: 'preview', year }` : renvoie les données qui seraient transmises (formulaire, code, libellé, valeur) et les contrôles. Il n'y a ni numéro, ni signature, ni archive.
- `{ action: 'prepare', year }` : enchaîne les étapes suivantes.
  1. Exige un mandat en vigueur et aucun contrôle bloquant.
  2. Prend le numéro séquentiel du jour (heure de Paris, 999 au plus).
  3. Signe l'interchange.
  4. **Vérifie la signature avec la clé publique de l'accréditation** avant toute archive.
  5. Archive dans `tdfc_submissions` (fichier en base 64, SHA-256, signature, résumé, contrôles, mandat).
  6. Renvoie le fichier `TDFC_<référence>[_TEST].edi`.

**Sécurité** :
- Les données sont lues avec la session de l'abonné : les règles RLS s'appliquent, et la fonction ne voit que ses propres lignes.
- L'archive et le compteur sont écrits par le rôle service seul : l'abonné ne peut que les lire.
- Le mandat est horodaté par la base, ne peut être ni modifié ni supprimé, et sa révocation reste dans l'historique.
- La clé privée est chargée une fois par instance. Elle est refusée si elle ne correspond pas à la clé certifiée par l'accréditation.

**Vérifié** :
- `deno check` sur l'enveloppe.
- Exécution réelle sous Deno 2.9 face à un faux Supabase :
  - refus sans session ;
  - aperçu de 69 données ;
  - interchange signé de 6 427 octets, archivé ;
  - signature vérifiée avec la clé de l'accréditation du partenaire fictif DGFiP.

### Mise en service

1. **Clé de signature**, générée sur un poste de confiance comme dans le pack DGFiP :
   `openssl genrsa -aes256 -out cle_privee_immozen.pem 2048`, puis `openssl rsa -in cle_privee_immozen.pem -pubout -out cle_publique_immozen.pem`.
   La clé publique est remise au correspondant téléprocédures. La clé privée n'est déposée nulle part ailleurs que dans les secrets Supabase.
2. **Secrets Supabase** (Edge Functions → Secrets ; jamais dans GitHub) :
   - `TDFC_PRIVATE_KEY` (PEM, les `\n` littéraux sont acceptés) et `TDFC_PRIVATE_KEY_PASSPHRASE` ;
   - `TDFC_ACCREDITATION` (1368 caractères), `TDFC_AGREMENT`, `TDFC_TRANSFER_ALIAS`, `TDFC_TRANSFER_MODE` (`T` par défaut) ;
   - `TDFC_ATTESTATION` (référence EDIFICAS), `TDFC_PARTNER_NAME`, `TDFC_PARTNER_ADDRESS` (JSON `{"street","zip","city"}`) ;
   - `TDFC_MODE` : `test` par défaut, `reel` seulement après la phase de tests DGFiP.
3. **Migration** `20261107000100_tdfc.sql`, puis le workflow « Fonctions serveur Supabase ». Il regroupe le cœur et déploie `tdfc`.

## Écran de télétransmission

**Service fermé aux abonnés** : `TDFC_OPEN = false` dans `src/data/tdfc.ts` masque le bouton
« Télétransmettre la liasse » et la page `#/declaration/teletransmission`. Pour voir l'écran avant
l'ouverture : `localStorage.setItem('iz-tdfc-preview', '1')` dans la console du navigateur. Ouverture :
passer `TDFC_OPEN` à `true` une fois l'habilitation obtenue, les secrets saisis et le mandat relu.

Le bouton **Télétransmettre la liasse** de la section LMNP mène à `#/declaration/teletransmission`, réservé aux formules qui incluent la déclaration fiscale. L'écran comporte quatre étapes ; chacune affiche son état (À faire, Fait, À corriger).

1. **Identité fiscale** (`tdfc_declarants`) : SIREN (clé de contrôle), référence d'obligation fiscale (BIC1 par défaut), nom, code NAF (6820A), adresse de l'activité, et le domicile s'il diffère. Les contrôles sont ceux de la base (35 caractères, code postal, formats).
2. **Mandat** (`tdfc_mandates`) : le texte du mandat (version `2026-11`, `MANDATE_VERSION`) s'affiche. La signature exige une case « J'ai lu et j'accepte ». La révocation est possible à tout moment et reste dans l'historique.
3. **Vérification** : aperçu calculé par la fonction serveur (localement en démonstration).
   - Il affiche les recettes, le résultat fiscal, le total du bilan et le nombre de données.
   - Il liste les points à vérifier propres à l'abonné.
   - Il montre les données qui seront transmises, par formulaire, à déplier (montants, dates et textes mis en forme).
   - Les blocages qui relèvent d'Immo-Zen (agrément, accréditation, configuration : `scope: 'partenaire'`) sont regroupés dans un bandeau « habilitation en cours » : ils n'apparaissent pas comme des erreurs de l'abonné.
4. **Préparation et signature** : ouverte quand l'identité fiscale est enregistrée, le mandat signé et la vérification sans point bloquant. Elle télécharge le fichier `.edi`, affiche la référence et l'empreinte SHA-256, et alimente l'historique.

**Historique** (`tdfc_submissions`) : date, année, référence, mode (test ou réel), état, résultat fiscal, et un nouveau téléchargement à l'identique.

**Démonstration** : l'identité fiscale et le mandat sont conservés dans le navigateur, et l'aperçu est calculé localement. La préparation signée est refusée avec un message explicite (aucune clé de signature).

**Code** :
- `src/data/tdfc.ts` : API en ligne et démonstration, contrôles de saisie, texte du mandat.
- `src/pages/Teletransmission.tsx` : l'écran.
- `tests/tdfcApi.test.ts` : 6 tests.
- Étape de bout en bout « télétransmission » : identité invalide puis valide, mandat, aperçu complet en LMNP au réel, préparation refusée en démonstration, rendu à 390 px, révocation.

**À faire relire par un juriste** : le texte du mandat (`MandateText` dans `Teletransmission.tsx`). Toute modification du texte doit changer `MANDATE_VERSION`.

## Reste à faire

1. **Transfert SFTP (PassTrans)** et lecture des retours : accusé de réception (INFENT-RCS), CONTRL, compte rendu (INFENT-CR, signé par la DGFiP et vérifiable avec `dgfip_cle_publique_pedi.pem`).
2. **Accès réservé au pack fiscal** côté serveur : la fonction `tdfc` doit aussi vérifier la formule (l'écran est déjà réservé).
3. **Campagne 2027** : intégrer le nouveau cahier des charges dès sa publication (mars 2027).

## Points à faire valider

- La correspondance des lignes papier avec les codes EDI a été établie d'après les libellés du dictionnaire. Sont notamment à relire : CF et EL au 2033-B, CW et CX au 2031, et le bilan construit autour du compte de l'exploitant.
- Le terrain vient de la décomposition du coût d'acquisition (Mes biens) ; à défaut, il est estimé par le pourcentage saisi (20 % par défaut) du coût d'acquisition.
- L'attestation de conformité EDIFICAS est indispensable avant tout envoi.
