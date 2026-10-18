# Tests et résultats

Exécution du 18/10/2026.

| Suite | Commande | Résultat |
|---|---|---|
| Typage strict (`strict`, `noUncheckedIndexedAccess`) | `npm run typecheck` | 0 erreur |
| Unitaires : révision IRL (4), import de loyers, adresses, quittance avec rappel (4), simulateur, biens, signature et événements Stripe (3), crédit et cash-flow, import de relevés (6), déclaration fiscale (5), reprise, sauvegarde/import, CSV, XLSX, gestion locative et quittance PDF, file d’e-mails | `npm test` | **74/74** |
| SQL lot 1 : reprise (16), isolation (13), règles et concurrence (16), compte (2), annulation (5) ; lot 2 : baux, échéances, paiements, quittances, relances, documents, dépenses, isolation, tâches quotidiennes, file d’e-mails (61) ; lot 3 : import de relevés, isolation, saisies fiscales (6), plateforme : droits, contrôle d’accès, résiliation, expiration, accès manuel et support, journal (25) ; import de loyers, révision IRL, rappel de charges, isolation (15) | `npm run test:db` | **163/163** |
| Navigateur (Chromium, bureau 1360 px et mobile 390 px, mode démonstration) | `npm run build && npm run test:e2e` | **35/35 étapes** |

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
