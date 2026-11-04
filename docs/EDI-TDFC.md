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
| `tests/tdfc.test.ts`, `tests/autack.test.ts` | 22 tests, dont l'exemple signé par la DGFiP et la population fictive |
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

**Bilan 2033-A** : l'application ne tient pas de comptabilité en partie double. Le bilan est donc construit à partir de ce qu'elle connaît : les immobilisations et amortissements de la liasse, le capital restant dû calculé d'après le crédit saisi, et la part à plus d'un an. Il s'y ajoute quatre montants saisis par le déclarant (`TdfcBalanceInputs`) : trésorerie, loyers restant dus, dépôts de garantie reçus et autres dettes. Le **capital individuel (compte de l'exploitant)** équilibre l'actif et le passif. Les contrôles bloquent un bilan déséquilibré et signalent un compte de l'exploitant négatif.

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
3. **Interface** : SIREN, ROF, saisies du bilan, mandat de l'abonné, aperçu, historique des dépôts.
4. **Campagne 2027** : intégrer le nouveau cahier des charges dès sa publication (mars 2027).

## Points à faire valider

- La correspondance des lignes papier avec les codes EDI a été établie d'après les libellés du dictionnaire. Sont notamment à relire : CF et EL au 2033-B, CW et CX au 2031, et le bilan construit autour du compte de l'exploitant.
- Le terrain est estimé par le pourcentage saisi (15 % par défaut) du coût d'acquisition.
- L'attestation de conformité EDIFICAS est indispensable avant tout envoi.
