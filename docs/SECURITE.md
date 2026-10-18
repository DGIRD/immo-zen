# Sécurité

## Isolation des données

- RLS activé sur toutes les tables Immo-Zen ; politique `user_id = auth.uid()` en lecture et en écriture. Accès anonyme révoqué.
- Clés étrangères composites `(id, user_id)` : impossible de rattacher un scénario, une tâche, un échange ou une agence à un objet d'un autre compte, même en connaissant son identifiant.
- Le propriétaire d'une ligne ne peut pas être modifié (déclencheur).
- L'historique système (création, changement de statut, acquisition, reprise) n'est écrit que par le serveur ; l'utilisateur ne peut ajouter ou supprimer que ses échanges et notes ; aucune modification d'historique.
- Sauvegarde et fonction de reprise dans le schéma `immozen_backup`, inaccessible aux rôles de l'API.
- Les prospects commerciaux de la plateforme (lot 3) seront dans une table séparée, réservée aux administrateurs ; aucun accès administrateur aux données privées des abonnés par défaut.

Vérifié par `npm run test:db` avec deux comptes (lecture, modification, suppression, création au nom d'autrui, rattachement croisé, accès anonyme).

## Gestion locative (lot 2)

- Toutes les tables locatives sont isolées par utilisateur (RLS + clés étrangères composites), vérifié avec deux comptes.
- Quittances et file d'e-mails : lecture seule pour l'utilisateur ; écriture uniquement par des fonctions serveur qui vérifient la propriété et les règles (période intégralement réglée, pas de doublon).
- Journal des tâches et file de suppression de fichiers : aucun accès utilisateur.
- Documents : bucket privé, chemin imposé `<id utilisateur>/<id document>/<fichier>` (vérifié par la base et par les politiques du stockage), 10 Mo maximum, types limités (PDF, images, Word, Excel, texte), accès par lien signé de 60 secondes. La suppression d'une fiche met le fichier en file de suppression côté serveur.
- Fonction serveur : appel authentifié par un jeton (`CRON_SECRET`) stocké dans le coffre Supabase ; clé `service_role` uniquement côté serveur ; aucun envoi sans `EMAIL_ENABLED=true` ; journaux sans adresse e-mail ni contenu.

## Plateforme (lot 3)

- Abonnements écrits uniquement par le serveur (webhook Stripe signé, clé service_role) ou par un administrateur via des fonctions journalisées ; un utilisateur ne peut ni s'attribuer un abonnement ni se nommer administrateur (testé).
- Administrateurs désignés en SQL uniquement (table `admins`, aucun droit d'écriture par l'API).
- Les administrateurs voient e-mail, dates et état d'abonnement des comptes, jamais leurs biens, baux, locataires ou documents. Exception : résumé chiffré, si l'abonné a autorisé l'accès support (31 jours au plus), chaque consultation étant journalisée.
- Contrôle d'accès par abonnement : politiques RLS restrictives sur les écritures, désactivées tant que `app_config.enforce_subscription` est faux.
- Invitations par Supabase Auth : l'invité choisit son mot de passe, aucun mot de passe n'est envoyé.
- Secrets Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) uniquement dans les secrets des fonctions ; le navigateur ne voit jamais de carte bancaire (Stripe Checkout).

## Services externes appelés par le navigateur

- Saisie automatique des adresses : `data.geopf.fr` (IGN) et `geo.api.gouv.fr`, services publics sans compte. Seul le texte de l'adresse ou le code postal saisi est envoyé, sans identifiant de compte.

## Assistant

- L'aide intégrée fonctionne entièrement dans le navigateur. Le mode conversationnel transmet au modèle Claude uniquement les questions de la conversation et le nom de la rubrique affichée, jamais les données de l'utilisateur ; la clé d'API reste un secret de la fonction serveur ; quota quotidien par compte (`assistant_usage`), non modifiable par l'utilisateur.

## Secrets

- Le frontend ne contient que l'URL et la clé **publique** du projet. Le build échoue si la clé fournie est une clé `service_role` ou `sb_secret_`.
- Aucun secret dans le dépôt ; `.env` ignoré par git. Les secrets serveur (Stripe, e-mail) iront dans les secrets des Edge Functions (lots 2-3).

## Comptes

- Mots de passe gérés par Supabase Auth ; jamais transmis ni affichés par l'application. Réinitialisation par lien e-mail (PKCE).
- À configurer dans Supabase : longueur minimale 10, confirmation d'e-mail, protection contre les mots de passe divulgués, limitation de débit (Auth → Rate limits), URL de redirection limitées au domaine de l'application.

## Entrées

Validation côté client (formulaires, simulateur, import) **et** côté serveur (contraintes SQL : longueurs, formats e-mail et URL, valeurs positives, statuts autorisés). Les exports CSV neutralisent les formules (`=`, `+`, `-`, `@`). L'import JSON est validé, limité à 20 Mo, et crée de nouveaux identifiants.

## Appareil

- Copie des données en lecture hors connexion dans le stockage du navigateur, effacée à la déconnexion (ainsi que le stockage de session). Le service worker ne stocke aucune donnée privée.
- Les journaux du navigateur ne contiennent pas de données personnelles émises volontairement par l'application.

## Points à traiter avant la production

- Désactiver la création de compte libre lorsque l'abonnement existera (lot 3), ou la conserver en connaissance de cause.
- Activer les sauvegardes quotidiennes / PITR du projet Supabase de production.
- Protéger les comptes administrateurs (MFA) dès le lot 3.
