# Mise en service : OVH, Resend, Stripe

Ordre conseillé : **1. OVH (nom de domaine)** → **2. jeton Supabase** → **3. Resend (e-mails)** → **4. Stripe (formules et paiements)**.
Chaque étape est indépendante : l'application fonctionne déjà sans elles (adresse GitHub, pas d'e-mails, pas de paiement).
Dans les exemples, remplacez `immo-zen.fr` par votre domaine.

## Organisation de l'adresse

- `https://immo-zen.fr/` : **site vitrine** (dossier `site/` du dépôt) — raison d'être, solution, accompagnement, guides, tarifs, questions, formulaire « Être recontacté ».
- `https://immo-zen.fr/app/` : **application** (Espace client). Tant que le domaine n'est pas branché : https://dgird.github.io/immo-zen/ et https://dgird.github.io/immo-zen/app/.
- Les demandes du formulaire arrivent dans **Administration → Prospects commerciaux** (migration `20261018000300_site_contact.sql` à exécuter).
- **Mentions légales** (`site/mentions-legales.html`) : éditeur, SIREN, adresse et e-mail de contact **à compléter** avant d'annoncer le site.

## 0. Avant de commencer (une fois)

Dans Supabase → SQL Editor, exécutez les migrations pas encore passées (dans l'ordre des noms de fichiers du dossier `supabase/migrations`), notamment :
`20261017000100_lot3_import_fiscal.sql`, `20261017000200_lot3_plateforme.sql`, `20261017000300_loyers_irl_rappels.sql`, `20261018000100_amortissements.sql`.
Puis désignez-vous administrateur :
```sql
insert into public.admins (user_id) select id from auth.users where email = 'votre@email.fr';
```

## 1. OVH : nom de domaine

**Recommandé : OVH pour le domaine uniquement.** L'application reste servie par GitHub Pages (gratuit, HTTPS automatique) et Supabase (base, comptes, fonctions). Un serveur OVH (VPS) n'est pas nécessaire : il ne servirait qu'à héberger la page, déjà gratuite, et ajouterait mises à jour et sauvegardes à gérer.

1. ovhcloud.com → **Noms de domaine** → réservez `immo-zen.fr` (ou autre).
2. **Web Cloud → Noms de domaine → immo-zen.fr → Zone DNS** :
   - supprimez les enregistrements A et AAAA existants sur le domaine nu (`@`, souvent la page « parking » d'OVH) ;
   - ajoutez 4 enregistrements **A** pour `@` : `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` ;
   - (facultatif) 4 **AAAA** pour `@` : `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153` ;
   - **CNAME** `www` → `dgird.github.io.` (sans le nom du dépôt).
3. GitHub → **Settings → Pages → Custom domain** : `immo-zen.fr` → Save. Attendez la vérification DNS (quelques minutes à 24 h), puis cochez **Enforce HTTPS**.
   Conseillé : GitHub → votre profil → Settings → Pages → **Add a domain** pour vérifier le domaine (protection contre la prise de contrôle).
4. Supabase → **Authentication → URL Configuration** : *Site URL* `https://immo-zen.fr/app/` ; *Redirect URLs* : ajoutez `https://immo-zen.fr/**` (gardez l'ancienne adresse quelques semaines).
5. GitHub → Settings → Secrets and variables → Actions → **Variables** : `APP_URL` = `https://immo-zen.fr/app/` (adresse de l'application : liens de paiement et d'invitation).
6. Vérifiez https://immo-zen.fr (site vitrine), puis « Espace client » → https://immo-zen.fr/app/ : connexion, puis « Mot de passe oublié » (le lien doit revenir sur le nouveau domaine). Réinstallez l'application mobile depuis la nouvelle adresse.

*Si vous tenez à un serveur OVH* (VPS) : il faudra un serveur web (nginx), un certificat (Let's Encrypt), et remplacer la publication GitHub Pages par un envoi du dossier `dist` sur le serveur. Dites-le-moi, j'adapterai le déploiement ; Supabase reste nécessaire pour la base et les comptes.

## 2. Jeton Supabase pour les déploiements

1. supabase.com → avatar → **Account → Access Tokens → Generate new token** (nom : « GitHub Immo-Zen »).
2. GitHub → Settings → Secrets and variables → Actions → **New repository secret** : `SUPABASE_ACCESS_TOKEN` = le jeton.
3. Générez un **jeton de planification** long et aléatoire (ex. un gestionnaire de mots de passe, 40 caractères) et enregistrez-le en secret GitHub `CRON_SECRET`.

Le workflow **Actions → « Fonctions serveur Supabase » → Run workflow** transmet ensuite les secrets aux fonctions et déploie `daily`, `platform` et `stripe-webhook`. Relancez-le après chaque changement de secret.

## 3. Adresse contact@immo-zen.fr et Resend (e-mails)

L'adresse `contact@immo-zen.fr` sert à la fois à **recevoir** (boîte ou redirection OVH) et à **envoyer** les e-mails de l'application (Resend). Les deux cohabitent sans conflit : la réception utilise les enregistrements MX du domaine, Resend ses propres enregistrements sur `send` et `resend._domainkey`.

**Réception (OVH)**
1. OVH → **Web Cloud → Emails** (ou **Noms de domaine → immo-zen.fr → Emails**) : créez l'adresse `contact` si votre offre comprend une boîte, sinon **Redirections → Ajouter une redirection** : `contact@immo-zen.fr` → votre adresse personnelle (gratuit).
2. Vérifiez dans la zone DNS que les **MX** du domaine (`@`) pointent vers OVH (`mx1.mail.ovh.net`…), créés automatiquement.

**Envoi (Resend)**
1. resend.com → créez un compte (offre gratuite suffisante pour démarrer).
2. **Domains → Add Domain** : `immo-zen.fr`, région Europe (Ireland) si proposée.
3. Créez dans la **zone DNS OVH** les enregistrements affichés par Resend (copiez exactement les valeurs) :
   | Type | Sous-domaine (OVH) | Valeur |
   |---|---|---|
   | TXT | `resend._domainkey` | clé DKIM fournie par Resend |
   | CNAME | `rsend` | valeur fournie (ex. `rsend-euw1.forge.rmta.net.`) |
   | CNAME | `send` | valeur fournie (ex. `send.forge.rmta.net.`) |
   | TXT | `_dmarc` (conseillé) | `v=DMARC1; p=none;` |
   Selon la version de Resend, la partie envoi peut aussi apparaître en MX + TXT sur `send` : recopiez ce qui est affiché. N'ajoutez jamais le MX de la partie « Receiving ». Le domaine déclaré dans Resend doit être `immo-zen.fr` (et non `mail.immo-zen.fr`) pour envoyer depuis contact@immo-zen.fr.
   Ne touchez pas aux MX ni au SPF du domaine nu (`@`) : ils servent à la réception OVH. Dans OVH, le sous-domaine se saisit sans `.immo-zen.fr`. Puis **Verify** dans Resend.
4. **API Keys → Create API Key** (« Sending access », domaine `immo-zen.fr`). Copiez-la.
5. GitHub → Secrets : `RESEND_API_KEY` = la clé. Variables : `EMAIL_FROM` = `Immo-Zen <contact@immo-zen.fr>`, `EMAIL_REPLY_TO` = `contact@immo-zen.fr`, `EMAIL_ENABLED` = `false` pour commencer.
6. Lancez le workflow « Fonctions serveur Supabase ».
6 bis. E-mails de connexion (confirmation de compte, mot de passe oublié) : Supabase → **Authentication → Emails → SMTP Settings** → Enable custom SMTP : hôte `smtp.resend.com`, port `465`, utilisateur `resend`, mot de passe = la clé Resend, expéditeur `contact@immo-zen.fr`, nom `Immo-Zen`. Sans cela, Supabase n'envoie que quelques e-mails par heure avec son expéditeur par défaut.
7. Supabase → **Database → Extensions** : activez `pg_cron` et `pg_net`. Puis SQL Editor : exécutez `supabase/scheduling.example.sql` en remplaçant `VOTRE-PROJET` par `sbxnjvjsapnsdeenmvtm` et le jeton par la valeur de `CRON_SECRET`.
8. Le lendemain, vérifiez `job_runs` (requêtes en fin de fichier) : les tâches tournent sans rien envoyer. Puis variable `EMAIL_ENABLED` = `true`, relancez le workflow, et envoyez-vous une quittance de test (locataire avec votre propre adresse).

## 4. Stripe : formules, moyens de paiement et abonnements

Grille appliquée (migration `20261018000500_formules.sql`) : **Découverte** gratuite · **Essentiel** 9,90 €/mois ou 99 €/an · **Patrimoine** 19,90 €/mois ou 199 €/an · **Pro** 39,90 €/mois ou 399 €/an · **Pack fiscal** 49 € pour 12 mois (paiement ponctuel, en complément d'Essentiel ou Patrimoine). Prix TTC.

### 4.1 Compte
1. stripe.com → créez le compte. Restez en **mode test** (interrupteur en haut) jusqu'à la recette.
2. **Paramètres → Informations publiques** : nom affiché « Immo-Zen », e-mail et site du support, **URL des conditions générales**. Ils apparaissent sur la page de paiement et les reçus.

### 4.2 Moyens de paiement
**Paramètres → Paiements → Moyens de paiement**. L'application ne fixe aucune liste : la page de paiement propose automatiquement les moyens activés ici et compatibles avec les abonnements.

| Moyen | Réglage conseillé | Frais Stripe (France) | Remarques |
|---|---|---|---|
| Cartes (CB, Visa, Mastercard) | **Activé** (par défaut) | 1,5 % + 0,25 € (carte standard de l'EEE) ; 2,8 % + 0,25 € (carte premium) ; 3,15 % + 0,25 € (hors EEE) | Indispensable. Authentification 3D Secure gérée par Stripe. |
| Apple Pay, Google Pay | **Activés** | comme la carte | Aucune vérification de domaine nécessaire : la page de paiement est hébergée par Stripe. |
| Link | Activé | comme la carte | Paiement en un clic pour les clients déjà connus de Stripe. |
| Prélèvement SEPA | **Activé** | 0,35 € par prélèvement | Le moins cher pour l'annuel. Confirmation après plusieurs jours ouvrés : l'abonnement (ou le pack) s'active à la confirmation. Le client peut contester un prélèvement pendant 8 semaines. |
| PayPal | Facultatif, pas au lancement | voir la page tarifaire | Compatible avec les abonnements ; à activer si des clients le demandent. |
| Autres (paiement fractionné, virement, portefeuilles étrangers) | Désactivés | — | Inutiles pour des montants de 10 à 400 €. |

S'ajoutent les frais de **Stripe Billing** (abonnements) : 0,7 % du volume facturé. Tarifs relevés sur stripe.com/fr/pricing le 18/10/2026.

### 4.3 Catalogue
**Catalogue de produits → Ajouter un produit**, quatre produits :

| Produit | Prix à créer | Code Immo-Zen |
|---|---|---|
| Immo-Zen Essentiel | 9,90 € **récurrent mensuel** · 99 € **récurrent annuel** | `essentiel_mensuel`, `essentiel_annuel` |
| Immo-Zen Patrimoine | 19,90 € mensuel · 199 € annuel | `patrimoine_mensuel`, `patrimoine_annuel` |
| Immo-Zen Pro | 39,90 € mensuel · 399 € annuel | `pro_mensuel`, `pro_annuel` |
| Immo-Zen Pack fiscal | 49 € **ponctuel** (« one-off », pas récurrent) | `pack_fiscal` |

Si vous êtes en franchise de TVA, saisissez ces montants tels quels. Si vous facturez la TVA, réglez « Comportement fiscal : taxes incluses » pour que le prix affiché reste TTC. Notez chaque identifiant `price_…`.

### 4.4 Espace client (portail)
**Paramètres → Facturation → Portail client** :
- **Factures** et **moyens de paiement** : activés ;
- **Annulation** : « à la fin de la période de facturation » ;
- **Changement d'offre** : activé, produits Essentiel, Patrimoine et Pro avec leurs deux prix ; passage à une formule supérieure **au prorata immédiatement**, passage à une formule inférieure **à la fin de la période**.
Enregistrez. L'application relit l'abonnement à chaque changement : la nouvelle formule s'applique dès que Stripe l'envoie.

### 4.5 Offre fondateurs (facultatif)
**Catalogue de produits → Coupons → Créer** : −30 %, durée « Pour toujours », limité aux trois prix **annuels**, 300 utilisations au plus. Puis **Codes promotionnels** : code `FONDATEUR`. La page de paiement d'Immo-Zen accepte déjà les codes promotionnels.

### 4.6 E-mails et relances de paiement
- **Paramètres → E-mails clients** : reçus de paiement, factures payées, échec de paiement, notification de prélèvement SEPA : activés.
- **Paramètres → Facturation → Recouvrement** : nouvelles tentatives intelligentes (4 tentatives sur 2 semaines par exemple), puis **annuler l'abonnement**. Pendant les relances, le compte garde sa formule ; à l'annulation, il passe en Découverte, sans perte de données.

### 4.7 Clé API et webhook
1. **Développeurs → Clés API** : clé secrète `sk_test_…` → secret GitHub `STRIPE_SECRET_KEY`.
2. **Développeurs → Webhooks → Ajouter une destination** : URL `https://sbxnjvjsapnsdeenmvtm.supabase.co/functions/v1/stripe-webhook`, événements :
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`.
   Le secret de signature `whsec_…` → secret GitHub `STRIPE_WEBHOOK_SECRET`.
3. Supabase SQL Editor : exécutez `supabase/migrations/20261018000500_formules.sql`.
4. Lancez le workflow « Fonctions serveur Supabase » (il redéploie `platform` et `stripe-webhook`).

### 4.8 Offres dans Immo-Zen
**Administration → Offres et tarifs** : pour chacune des sept offres, collez l'identifiant `price_…`, vérifiez le prix affiché et cochez « Offre ouverte ». Les limites de chaque formule sont dans la table `plan_tiers` (modifiable en SQL).

### 4.9 Recette en mode test (depuis un second compte, non administrateur)
1. Mon abonnement → Annuel → **Choisir Essentiel** → carte `4242 4242 4242 4242` (date future, CVC quelconque). Mon abonnement doit afficher « Essentiel », puis Administration → Journal : événements « traité ».
2. **Ajouter le pack fiscal** → la rubrique Déclaration fiscale s'ouvre.
3. Espace client : passez en Patrimoine (prorata), puis programmez une résiliation.
4. Second abonnement par **prélèvement SEPA** avec l'IBAN de test `FR1420041010050500013M02606` : l'activation arrive après confirmation de Stripe.
5. Carte `4000 0000 0000 0341` : échec au renouvellement, compte en « Paiement en retard », formule conservée.
6. Renvoyez un événement depuis le tableau de bord Stripe : il doit rester sans effet (doublon).

### 4.10 Passage en production
1. Activez le compte Stripe (identité, IBAN de versement).
2. En mode **live** : recréez produits, prix, coupon, portail et webhook ; remplacez `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` et les `price_…` ; relancez le workflow.
3. Conditions générales de vente : abonnement sans engagement, résiliation en ligne, et droit de rétractation de 14 jours d'un service en ligne (renonciation expresse si le service démarre immédiatement). À faire relire.
4. Seulement ensuite : **Administration → Application des formules** → « Appliquer les limites des formules ». Les comptes de plus de 30 jours sans abonnement passent en Découverte ; les plus récents gardent l'essai Patrimoine jusqu'à son terme.

## 5. Estimation DVF

1. Supabase SQL Editor : exécutez `supabase/migrations/20261018000400_estimation_dvf.sql` (fourchette d'estimation des biens).
2. Lancez le workflow « Fonctions serveur Supabase » : il déploie la fonction `dvf`, utilisée seulement si le navigateur ne peut pas lire directement les fichiers publics de data.gouv.fr. Aucune clé n'est nécessaire.

## 6. Contrats de bail, espace locataire et offre Découverte de 30 jours

1. Supabase SQL Editor : exécutez `supabase/migrations/20261020000100_baux_espace_locataire.sql`. Sans elle, le contrat de bail ne peut pas être enregistré avec le bail, ni l'espace locataire ouvert.
2. Lancez le workflow « Fonctions serveur Supabase » : la fonction `daily` insère le lien de l'application (variable `APP_URL`, par défaut `https://dgird.github.io/immo-zen/app/` ; mettez `https://immo-zen.fr/app/` si le domaine est branché) dans les e-mails d'invitation.
3. Supabase → Authentication → URL Configuration : l'adresse de l'application doit figurer dans les Redirect URLs (déjà fait si vous avez suivi la partie 1), pour que le locataire revienne sur son espace après avoir confirmé son compte.
4. Offre Découverte : la migration règle l'essai sur 30 jours en formule Découverte. Elle ne s'applique qu'une fois « Appliquer les limites des formules » activé dans Administration ; ensuite, un compte de plus de 30 jours sans abonnement passe en consultation seule.

## 7. Assistant conversationnel (facultatif)

Sans réglage, l'assistant répond à partir de l'aide intégrée (gratuit). Pour des réponses aux questions libres :
1. Supabase SQL Editor : exécutez `supabase/migrations/20261018000200_assistant.sql` (quota quotidien).
2. platform.claude.com : créez un compte, ajoutez un moyen de paiement (facturation à l'usage ; le modèle par défaut, Claude Haiku 5.5, est le moins cher), puis **API Keys → Create Key**. Fixez une limite de dépense mensuelle dans la console.
3. GitHub → secret `ANTHROPIC_API_KEY`. Facultatif : variables `ASSISTANT_MODEL` (ex. `claude-sonnet-5-5` pour des réponses plus fines, plus coûteuses) et `ASSISTANT_DAILY_LIMIT` (40 questions par compte et par jour par défaut).
4. Lancez le workflow « Fonctions serveur Supabase » (il déploie aussi la fonction `assistant`).
Seules les questions et le nom de la rubrique affichée sont transmis au modèle, jamais les données des biens ou des locataires.

## Récapitulatif des réglages GitHub (Settings → Secrets and variables → Actions)

| Nom | Type | Valeur |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | secret | jeton Supabase (étape 2) |
| `CRON_SECRET` | secret | jeton aléatoire, identique à celui de `scheduling.example.sql` |
| `RESEND_API_KEY` | secret | `re_…` |
| `STRIPE_SECRET_KEY` | secret | `sk_test_…` puis `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | secret | `whsec_…` |
| `APP_URL` | variable | `https://immo-zen.fr/app/` |
| `EMAIL_FROM` | variable | `Immo-Zen <contact@immo-zen.fr>` |
| `EMAIL_REPLY_TO` | variable | `contact@immo-zen.fr` |
| `EMAIL_ENABLED` | variable | `false`, puis `true` après vérification |
| `ANTHROPIC_API_KEY` | secret | clé de l'API Claude (assistant, facultatif) |
| `ASSISTANT_MODEL`, `ASSISTANT_DAILY_LIMIT` | variables | facultatives |
