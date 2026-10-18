# Mise en service

L'ancienne version en ligne reste intacte tant que la branche `immo-zen` n'est pas fusionnée dans `main`.

## 1. Recette sur un projet Supabase de test

1. Créez un projet Supabase « immo-zen-test ».
2. SQL Editor : exécutez `legacy/idf-invest/supabase.sql` puis, si vous voulez tester la reprise, copiez quelques lignes de `simulations` de production (ou utilisez `supabase/tests/01_legacy_seed.sql` après avoir créé les comptes correspondants).
3. Exécutez `supabase/migrations/20261013000100_immozen_core.sql` puis `…20261013000200_migrate_idf_invest.sql`.
4. Authentication → URL Configuration : *Site URL* = adresse de test, *Redirect URLs* = la même adresse.
5. Authentication → Providers → Email : confirmation activée, mot de passe ≥ 10 caractères.
6. En local : `.env` avec l'URL et la clé publique du projet de test, `npm run dev`, puis recette : connexion, création d'un bien, simulation, passage à « Acquis », deux comptes distincts qui ne se voient pas, ouverture sur téléphone.

## 2. Sauvegarde de la production

Avant toute migration : Database → Backups (ou `pg_dump` depuis la chaîne de connexion) ; la migration crée en plus sa propre copie dans `immozen_backup`.

## 3. Migration de la production

Même ordre qu'en test. Vérifiez le contrôle de comptage indiqué dans [MIGRATION-ANCIENNE-VERSION](MIGRATION-ANCIENNE-VERSION.md). L'ancienne application continue de fonctionner.

## 4. Publication

1. GitHub → Settings → Pages → Source : **GitHub Actions** (aujourd'hui la publication se fait directement depuis la branche).
2. Projet Supabase : l'URL et la clé publique de production sont déjà dans `.github/workflows/deploy.yml` (reprises de l'ancienne version). Pour viser un autre projet, définissez les variables `IMMOZEN_SUPABASE_URL` et `IMMOZEN_SUPABASE_ANON_KEY` (Settings → Secrets and variables → Actions → Variables).
3. Fusionnez la pull request. Le workflow « Déploiement » vérifie, construit et publie. Il refuse de publier sans projet Supabase configuré.
4. Les utilisateurs ayant installé l'ancienne version reçoivent la nouvelle version au prochain chargement (nouveau service worker). En cas d'affichage de l'ancienne version : recharger, ou réinstaller la PWA.
5. Relancez `select * from immozen_backup.migrate_idf_invest();` pour reprendre les simulations créées entre la migration et la bascule.

## Adresse de l'application

Le site vitrine est publié à la racine (`site/`), l'application sous `/app/`. L'adresse suit le nom du dépôt. Pour publier sur **https://dgird.github.io/immo-zen/** : GitHub → Settings → General → *Repository name* = `immo-zen` → **Rename**, puis Actions → « Déploiement » → **Run workflow** (l'ancienne adresse `…/idf-invest/` cesse alors de répondre ; aucun réglage du code n'est nécessaire, les chemins sont relatifs). Dans Supabase → Authentication → URL Configuration : *Site URL* = `https://dgird.github.io/immo-zen/`, et ajouter la même adresse (ou `https://dgird.github.io/immo-zen/**`) dans *Redirect URLs*, sans quoi les liens de réinitialisation du mot de passe renverraient vers l'ancienne adresse. Une application installée depuis l'ancienne adresse doit être réinstallée depuis la nouvelle.

## Retour arrière

- Application : republier l'ancienne version (revert du commit de fusion) ; l'ancienne version refonctionne immédiatement, ses tables n'ayant pas été modifiées.
- Données : scripts de `supabase/rollback/` (voir MIGRATION-ANCIENNE-VERSION).

## Restauration

- Erreur ponctuelle d'un utilisateur : import de sa sauvegarde JSON (Paramètres).
- Incident global : restauration Supabase (sauvegarde quotidienne ou PITR selon l'offre), ou `psql < dump.sql` sur un nouveau projet puis changement des variables de déploiement.
- Tester une restauration sur le projet de test au moins une fois avant l'ouverture.

## Environnements

| Environnement | Projet Supabase | Variables |
|---|---|---|
| Développement | local ou projet dev | `.env` |
| Test | immo-zen-test | `.env` ou variables d'un environnement GitHub « test » |
| Production | projet Supabase actuel | variables du dépôt |
