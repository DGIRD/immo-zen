# Immo-Zen

*Prospectez, investissez et gérez vos locations sereinement.*

Site vitrine (`site/`, publié à la racine) et application web progressive (PWA, publiée sous `/app/`) de prospection immobilière et de gestion locative pour particuliers. Elle succède à l'ancienne version de l'application, dont les données sont reprises.

> **État : lots 1, 2 et 3 livrés** (prospection, simulateur, Mes biens ; gestion locative ; import de relevés, déclaration fiscale, abonnements Stripe et administration). Les paiements et e-mails réels restent à configurer. Détail : [docs/ETAT-DU-PROJET.md](docs/ETAT-DU-PROJET.md).

## Démarrer en local

```bash
npm install
npm run dev          # http://127.0.0.1:5173 — sans .env : mode démonstration (données dans le navigateur)
```

Pour travailler contre un vrai projet Supabase, copiez `.env.example` en `.env` et renseignez l'URL et la clé **publique** du projet.

## Vérifier

```bash
npm run typecheck    # TypeScript strict
npm test             # tests unitaires : simulateur, reprise, import, exports CSV/XLSX
npm run test:db      # tests SQL sur un PostgreSQL local jetable : migrations, RLS entre deux comptes, annulation
npm run build && npm run test:e2e   # parcours navigateur bureau et mobile, captures dans test-results/
```

## Documentation

| Document | Contenu |
|---|---|
| [ETAT-DU-PROJET](docs/ETAT-DU-PROJET.md) | Implémenté, testé, à configurer, restant ; limites connues |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Choix techniques, structure du code, environnements |
| [MIGRATION-ANCIENNE-VERSION](docs/MIGRATION-ANCIENNE-VERSION.md) | Analyse de l'existant, correspondances, sauvegarde, annulation |
| [FORMULES-SIMULATEUR](docs/FORMULES-SIMULATEUR.md) | Formules, conventions, arrondis |
| [SECURITE](docs/SECURITE.md) | Isolation des données, RLS, secrets, synchronisation |
| [DEPLOIEMENT](docs/DEPLOIEMENT.md) | Mise en service pas à pas, sauvegarde et restauration |
| [GUIDE-UTILISATEUR](docs/GUIDE-UTILISATEUR.md) | Utilisation de l'application |
| [SERVICES-A-CONNECTER](docs/SERVICES-A-CONNECTER.md) | Supabase, Stripe, e-mails… |
| [TACHES-SERVEUR](docs/TACHES-SERVEUR.md) | Tâches planifiées, e-mails, garde-fous, mise en route |
| [DECLARATION-FISCALE](docs/DECLARATION-FISCALE.md) | Calcul des cases de la déclaration, sources |
| [MISE-EN-SERVICE](docs/MISE-EN-SERVICE.md) | OVH, Resend, Stripe : actions à faire |
| [ABONNEMENTS](docs/ABONNEMENTS.md) | Stripe, accès, administration, mise en service |
| [LOYERS-ET-TAUX](docs/LOYERS-ET-TAUX.md) | Loyer de marché, encadrement, taux de crédit et usure |
| [TESTS](docs/TESTS.md) | Ce qui est testé et derniers résultats |

L'ancienne application est conservée, non publiée, dans `legacy/idf-invest/` pour référence.
