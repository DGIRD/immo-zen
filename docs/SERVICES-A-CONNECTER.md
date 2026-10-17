# Services à connecter

| Service | Usage | Lot | État | Action |
|---|---|---|---|---|
| Supabase (projet existant) | base, comptes, RLS | 1 | **À configurer** | exécuter les migrations, régler Auth (DEPLOIEMENT) |
| Supabase (projet de test) | recette | 1 | **À créer** | — |
| GitHub Pages (Actions) | hébergement | 1 | **À configurer** | source « GitHub Actions » + variables |
| Supabase Storage | documents et photos privés | 2 | **Créé par la migration** | bucket « documents » privé et politiques inclus dans la migration du lot 2 |
| Resend (ou autre fournisseur) | confirmations de paiement, quittances, relances | 2 | **À configurer** | compte, domaine vérifié (SPF, DKIM), clé d'API en secret de fonction |
| Supabase Edge Functions + pg_cron/pg_net | tâches serveur | 2 | **À configurer** | `supabase functions deploy daily`, `scheduling.example.sql` ([TACHES-SERVEUR](TACHES-SERVEUR.md)) |
| Stripe | abonnements mensuel et annuel | 3 | Code livré — **à configurer** (aucun compte) | compte, mode test, produit et 2 prix, espace client, webhook, secrets, déploiement de `platform` et `stripe-webhook` ([ABONNEMENTS](ABONNEMENTS.md)) |
| Supabase Auth (invitations) | invitation d'utilisateurs par un administrateur | 3 | **À configurer** | URL de redirection, modèle d'e-mail « Invite user » |
| Géoplateforme IGN (API Adresse) et geo.api.gouv.fr | saisie automatique des adresses | — | Livré, **aucune configuration** | service public gratuit, sans clé |
| Génération PDF | quittances, reçus | 2 | Livré | pdf-lib dans le navigateur et la fonction serveur ; modèle à relire |

Aucun de ces services n'a été contacté ou configuré pendant ce lot.
