# Télétransmission EDI-TDFC de la liasse LMNP

État au 4 novembre 2026 : **générateur du message INFENT-DF livré et testé**. La transmission réelle n'est pas encore possible : il manque la sécurisation, l'envoi et le 2033-A, ainsi que l'habilitation, l'attestation et une validation fiscale.

Référentiel utilisé : cahier des charges EDI-TDFC de la **campagne 2026** (DGFiP), volume IV (GUM INFENT Déclaration Fiscale, version 26.01) et dictionnaire des données éditeurs v2026. Ces documents sont rangés sur le Drive, dans *Entreprise / Immo-Zen / Prérequis EDI-TDFC et facturation électronique*.

## Ce que fait le module

| Fichier | Rôle |
| --- | --- |
| `src/domain/edi/edifact.ts` | Syntaxe EDIFACT (UNA `:+,? '`), échappement, montants (troncature, statuts 62 et 65), encodage ISO 8859-15 (€ = A4) |
| `src/domain/edi/tdfc.ts` | Correspondance liasse → codes TDFC, construction du message et de l'interchange, contrôles avant envoi |
| `tests/tdfc.test.ts` | 14 tests (syntaxe, codes données, liasse calculée, compteurs, population fictive DGFiP) |
| `scripts/tdfc-exemple.ts` | Génère un interchange de test : `node --import tsx scripts/tdfc-exemple.ts sortie.edi` |

Formulaires produits à partir de la liasse calculée par `fiscal.ts` :

| Formulaire | Données |
| --- | --- |
| F-IDENTIF | Déclarant (SIREN, nom, adresse), BIC / réel simplifié / IR, période, durée, EUR, ROF, NAF |
| 2031 | Activité, adresse du domicile, résultat fiscal (CA/CB), BIC non professionnels (CW/CX) |
| 2033-B | Lignes 218, 232, 242, 244, 254, 264, 270, 294, 310 ; réintégration art. 39 C (CF) ; amortissements différés imputés (EL, détail MA/MB) ; bénéfice (CM/CR) ou déficit (EM/ER) |
| 2033-C | Bâti → constructions, travaux → agencements, meubles → autres immobilisations : valeurs brutes et amortissements (début, augmentations, fin) et totaux ; néant sans immobilisation |
| 2033-D, E, F, G | Déposés néant (LMNP sans provisions, salariés, associés ni filiales) |

Campagnes : un exercice clos en N relève de la campagne N + 1. Seule la campagne 2026 (exercices clos en 2025) est intégrée. Les déclarations des revenus 2026 demanderont le cahier des charges 2027, publié en mars 2027.

## Contrôles avant envoi (`checkRequest`)

Les contrôles **bloquants** portent sur :
- la campagne et la période ;
- l'agrément (7 chiffres), l'alias de transfert, l'attestation EDIFICAS et les références du logiciel ;
- le SIREN (clé de Luhn) et la ROF (`BIC1`, sans zéro initial) ;
- les adresses (voie, ville, code postal, 35 caractères au plus) et le code NAF ;
- la séquence journalière et la référence du document ;
- la cohérence du 2033-B (264, 270, 310, résultat fiscal) ;
- les caractères hors ISO 8859-15.

Deux contrôles bloquants resteront actifs tant que les étapes correspondantes ne sont pas livrées : le 2033-A et la sécurisation AUTACK.

## Reste à faire

1. **2033-A (bilan simplifié)** : immobilisations nettes, trésorerie, capital restant dû des emprunts, compte de l'exploitant. Il faut des données que l'application ne suit pas encore (trésorerie, apports).
2. **Sécurisation AUTACK** : signature de l'interchange avec la clé du partenaire, d'après le pack technique de la DGFiP. Elle demande la clé générée pour l'accréditation.
3. **Transfert SFTP (PassTrans)** et lecture des retours : accusé de réception (INFENT-RCS), CONTRL et compte rendu de traitement (INFENT-CR).
4. **Interface** : saisie du SIREN et de la ROF, mandat de l'abonné, aperçu des données avant envoi, historique des dépôts.
5. **Campagne 2027** : intégrer le nouveau cahier des charges dès sa publication.

## Points à faire valider

- La correspondance entre les lignes papier et les codes EDI a été établie d'après les libellés du dictionnaire, sans relecture par un expert-comptable. C'est notamment le cas pour la réintégration art. 39 C (CF), les amortissements différés imputés (EL) et le 2031 (CW/CX).
- Le terrain (non amortissable) n'apparaît pas encore au 2033-C.
- L'attestation de conformité EDIFICAS est indispensable avant tout envoi.
