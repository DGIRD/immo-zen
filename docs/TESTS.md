# Tests et résultats

Exécution du 30/10/2026 (mise à jour automatique des données de marché).

| Suite | Commande | Résultat |
|---|---|---|
| Typage strict (`strict`, `noUncheckedIndexedAccess`) | `npm run typecheck` | 0 erreur |
| Unitaires : contrat de bail vide, meublé, civil, parking et PDF (5), déclaration par régime, liasse 2033-B et parcours impots.gouv (4), invitation locataire (1), estimation DVF (4), révision IRL (4), import de loyers, adresses, quittance avec rappel (4), simulateur, biens, signature et événements Stripe (3), crédit et cash-flow, import de relevés (6), déclaration fiscale (5), reprise, sauvegarde/import, CSV, XLSX, gestion locative et quittance PDF, file d’e-mails | `npm test` | **156/156** (dont loyers de marché : 14, taux de crédit : 5, mise à jour automatique : 7) |
| SQL lot 1 : reprise (16), isolation (13), règles et concurrence (16), compte (2), annulation (5) ; lot 2 : baux, échéances, paiements, quittances, relances, documents, dépenses, isolation, tâches quotidiennes, file d’e-mails (61) ; lot 3 : import de relevés, isolation, saisies fiscales (6), plateforme : droits, contrôle d’accès, résiliation, expiration, accès manuel et support, journal (25) ; import de loyers, révision IRL, rappel de charges, isolation (15) ; estimation du prix (3) ; formules et offre Découverte de 30 jours, consultation seule ensuite ; contrat de bail, espace locataire : invitation, acceptation liée à l’e-mail, lecture seule, fichiers partagés, révocation, isolation (27) | `npm run test:db` | **0 échec** (dont données de marché : 20, mise à jour automatique : 17) |
| Navigateur (Chromium, bureau 1360 px et mobile 390 px, mode démonstration) | `npm run build && npm run test:e2e` | **48/48 étapes** |
| Recette du cahier de test : calculs de référence et parcours complémentaires | `npm run test:recette` | **16/16** calculs, **38/39** cas (mentions légales à compléter) |

## Couverture des exigences minimales

| Exigence | Couvert par |
|---|---|
| Création et connexion | e2e (mode démonstration) ; création de profil automatique en SQL. **Non testé contre un vrai Supabase Auth** |
| Isolation de deux utilisateurs | SQL |
| Sauvegarde et synchronisation | e2e (enregistrement, conflit), SQL (verrou optimiste) |
| Transfert prospect → Mes biens | SQL + e2e (même id, nombre de biens inchangé, historique, photographie) |
| Calculs | unitaires |
| Imports et exports | unitaires + e2e |
| Rendu mobile | e2e (aucun défilement horizontal, cartes, menu) + captures |
| Absence des états des lieux | e2e (menu, routes, code livré) |
| Paiements partiels et trop-perçus | SQL + unitaires + e2e |
| Impossibilité de quittancer un impayé | SQL + e2e |
| Prévention des doublons (échéances, quittances, e-mails) | SQL + unitaires |
| Abonnement et expiration | SQL + unitaires (webhook) ; appels Stripe réels non testés |

Les captures d'écran sont produites dans `test-results/` (artefact de la CI).
