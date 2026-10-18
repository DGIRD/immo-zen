# Abonnements, administration et accès support (lot 3)

## Formules (18 octobre 2026)

| | Découverte | Essentiel | Patrimoine | Pro |
|---|---|---|---|---|
| Prix TTC | gratuit | 9,90 €/mois ou 99 €/an | 19,90 €/mois ou 199 €/an | 39,90 €/mois ou 399 €/an |
| Biens détenus (statut « acquis ») | 1 | 3 | 10 | illimité |
| Biens en prospection (hors archivés, refusés, abandonnés) | 5 | illimité | illimité | illimité |
| Scénarios actifs par bien | 2 | illimité | illimité | illimité |
| Documents | 100 Mo | 1 Go | 5 Go | 20 Go |
| Contacts, relances agence, comparaison | — | oui | oui | oui |
| Quittances automatiques, relances d'impayés, e-mail de confirmation | — | oui | oui | oui |
| Cash-flow consolidé (tableau de bord) | — | — | oui | oui |
| Déclaration fiscale | — | pack fiscal 49 € / 12 mois | pack fiscal | incluse |

- **Formule en vigueur** (`iz_user_tier`) : administrateur → Pro ; contrôle désactivé → Pro pour tous (lancement) ; abonnement actif, en retard ou résilié jusqu'à la fin de la période → formule du prix Stripe ; accès manuel → formule choisie par l'administrateur ; essai (30 jours par défaut) → Patrimoine ; sinon Découverte.
- **Limites vérifiées par la base** (déclencheurs) quelle que soit l'origine de l'écriture ; l'interface fait la même vérification avant l'envoi (`src/domain/plans.ts`). Les données au-delà d'une limite après un changement de formule restent consultables, modifiables et exportables : seuls les ajouts sont refusés, et les automatisations d'un bail sont suspendues.
- **Exports** (Excel, CSV, sauvegarde) ouverts à toutes les formules.
- **Pack fiscal** : paiement ponctuel Stripe (`platform` action `pack`), crédité par le webhook une fois le paiement encaissé (`iz_grant_fiscal_pack`, 12 mois, prolongé en cas de rachat).
- Les limites se modifient dans la table `plan_tiers` (SQL, administrateurs).

## Ce qui est en place

- **Offres** : trois formules × mensuel/annuel et le pack fiscal (table `plans`), réglées par un administrateur : libellé, prix affiché, identifiant du prix Stripe, ouverture.
- **Paiement** : fonction `platform` → page de paiement Stripe (Checkout). L'abonnement n'est **jamais** activé par le navigateur : seul le webhook `stripe-webhook` écrit `subscriptions`, après vérification de la signature.
- **Webhook** : idempotent (`stripe_events`, un événement dupliqué est acquitté sans retraitement), relit l'abonnement chez Stripe à chaque événement (ordre d'arrivée indifférent), ignore un état plus ancien que celui enregistré, répond 500 en cas d'erreur pour que Stripe réessaie. Gère : création, renouvellement, changement d'offre, résiliation programmée (`cancel_at_period_end`), résiliation effective, échec de paiement (`past_due`, accès maintenu pendant les relances de Stripe), impayé, suspension ; remboursement journalisé sans effet direct sur l'accès.
- **Accès** (`iz_access_state`) : administrateur ; abonnement actif, en essai Stripe ou en retard de paiement ; résilié jusqu'à la fin de la période payée ; essai gratuit de N jours depuis la création du compte ; accès manuel accordé par un administrateur ; sinon accès libre tant que le contrôle est désactivé.
- **Application des formules** : **désactivée par défaut** (`app_config.enforce_subscription`). Activée, chaque compte a les limites de sa formule ; un compte sans abonnement passe en Découverte (plus de « consultation seule »). Limite : les fonctions serveur existantes (émission de quittance, relance) ne vérifient pas encore l'abonnement.
- **Mon abonnement** : état, période couverte, prochaine échéance ou fin d'accès, résiliation programmée distincte de l'expiration, factures et résiliation via l'espace client Stripe.
- **Administration** (administrateurs seulement) : comptes (e-mail, dates, abonnement, accès — aucune donnée immobilière), invitation par e-mail sans mot de passe en clair, accès manuel, offres et tarifs, contrôle d'accès et durée d'essai, incidents (e-mails en échec, tâches en erreur, événements Stripe en erreur), journal des actions et des événements Stripe, prospects commerciaux de la plateforme (table séparée).
- **Accès support** : l'abonné l'autorise lui-même (Paramètres, 7 jours, 31 au plus) ; l'administrateur ne voit qu'un résumé chiffré ; chaque consultation est journalisée.

## Mise en service (à faire)

1. **Migration** : `supabase/migrations/20261017000200_lot3_plateforme.sql` (SQL Editor).
2. **Premier administrateur** (SQL Editor, avec votre e-mail) :
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'vous@exemple.fr';
   ```
3. **Stripe** (mode test d'abord) : créer le compte, un produit « Immo-Zen » avec deux prix récurrents (mensuel, annuel), activer l'espace client (Settings → Billing → Customer portal : factures, moyen de paiement, résiliation en fin de période).
4. **Webhook Stripe** : point de terminaison `https://<projet>.supabase.co/functions/v1/stripe-webhook`, événements `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`.
5. **Secrets des fonctions** puis déploiement :
   ```bash
   supabase secrets set STRIPE_SECRET_KEY=sk_test_… STRIPE_WEBHOOK_SECRET=whsec_… APP_URL=https://dgird.github.io/immo-zen/
   supabase functions deploy platform
   supabase functions deploy stripe-webhook
   ```
6. **Administration → Offres et tarifs** : prix affichés et identifiants `price_…`, puis ouvrir les offres.
7. **Recette en mode test** : carte 4242 4242 4242 4242 (paiement accepté), 4000 0000 0000 0341 (échec au renouvellement) ; vérifier Mon abonnement, la résiliation, le journal Stripe. Renvoyer un événement depuis le tableau de bord Stripe doit être sans effet (doublon).
8. **Ouverture** : clés live, nouveau webhook live, nouveaux prix ; puis, si souhaité, **Administration → Contrôle d'accès**.
9. **Invitations** : Supabase → Authentication → URL Configuration doit autoriser `https://dgird.github.io/immo-zen/**` ; le modèle d'e-mail « Invite user » est personnalisable dans Supabase.

## Tests

- SQL (`supabase/tests/50_plateforme.test.sql`) : droits (non-administrateur, auto-attribution, tarifs, journal, prospects), contrôle d'accès (lecture conservée, écriture refusée), résiliation en fin de période, expiration, accès manuel, accès support autorisé et journalisé.
- Unitaires (`tests/stripe.test.ts`) : signature (valide, altérée, mauvais secret, rejeu, rotation), traduction d'un abonnement, événements concernés.
- Navigateur : offres, prospects, contrôle d'accès, journal, Mon abonnement, accès support (mode démonstration, sans paiement).
- **Non testé** : appels réels à Stripe et déploiement des fonctions (aucun compte Stripe ni accès Supabase pendant le développement).
