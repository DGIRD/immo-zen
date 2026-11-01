# Tâches serveur et e-mails (lot 2)

Les rappels, échéances et e-mails sont exécutés par le serveur, sans dépendre de l'ouverture de l'application.

## Ce que fait la tâche quotidienne

`public.iz_daily_tasks()` (SQL, fuseau Europe/Paris) :

1. **Échéances** : crée l'échéance du mois de chaque bail actif (une seule par mois et par bail).
2. **Confirmation au propriétaire** : le lendemain de l'échéance (et jusqu'à 3 jours après), si aucun paiement n'est enregistré, un e-mail invite le propriétaire à confirmer dans Immo-Zen. **L'absence de réponse ne vaut jamais paiement** : rien n'est enregistré sans action de sa part. Lors de la confirmation, la date du jour est proposée par défaut, signalée comme telle (« date par défaut ») et modifiable.
3. **Relances** : si le bail l'autorise et que le retard dépasse le délai choisi, une relance amiable est **préparée en brouillon** et le propriétaire est prévenu. Rien n'est envoyé au locataire sans sa validation après aperçu.
4. **Arrêt** : brouillons et envois en attente sont annulés dès que la dette est réglée.
5. **Journal** : chaque exécution est inscrite dans `job_runs` (statut, compteurs).

La fonction serveur `daily` (Edge Function) ajoute l'envoi de la file d'e-mails (`email_outbox`) et la suppression des fichiers dont la fiche a été supprimée.

## Données de marché (fonction « marche », chaque nuit à 4 h 37 UTC)

Carte des loyers, taux d'usure et plafonds de Paris chargés dès publication ; rappel à l'administrateur le 1er du mois. Détail : [LOYERS-ET-TAUX](LOYERS-ET-TAUX.md). Planification : tâche `immozen-marche` (`supabase/scheduling.sql`, ou `supabase/scheduling-marche.sql` pour l'ajouter seule).

## Garde-fous

| Risque | Protection |
|---|---|
| Doublon d'e-mail | clé unique par message (`confirmation:<échéance>`, `recu:<quittance>`, `relance:<relance>`), réservation avant envoi |
| Quittance pour un impayé | refusée par la base ; l'envoi automatique exige activation, paiement saisi/confirmé, montant exact, aucune quittance existante |
| Envoi sur la seule base d'une date | impossible : la quittance automatique est déclenchée par l'enregistrement d'un paiement, jamais par le calendrier |
| Relance d'une dette réglée | re-vérification au moment de l'envoi, annulation automatique |
| Erreur du fournisseur | nouvel essai différé (10, 20, 40… minutes), statut « échec » après 5 tentatives |
| Envoi depuis un environnement de test ou de démonstration | aucun envoi tant que `EMAIL_ENABLED` ne vaut pas `true` ; le mode démonstration n'atteint jamais le serveur |
| Données personnelles dans les journaux | seuls l'identifiant du message et l'erreur sont journalisés |

## Mise en route

1. **Fournisseur d'e-mail** : créez un compte Resend (ou adaptez `resendSender` à un autre fournisseur), vérifiez votre domaine d'envoi (enregistrements SPF/DKIM), créez une clé d'API.
2. **Déploiement de la fonction** (Supabase CLI) :
   ```bash
   supabase link --project-ref VOTRE-PROJET
   supabase secrets set CRON_SECRET=… RESEND_API_KEY=… EMAIL_FROM="Immo-Zen <loyers@votre-domaine.fr>" EMAIL_ENABLED=false
   supabase functions deploy daily --no-verify-jwt
   ```
   Commencez avec `EMAIL_ENABLED=false` : la fonction tourne sans rien envoyer.
3. **Planification** : activez `pg_cron` et `pg_net` (Database → Extensions), puis adaptez et exécutez `supabase/scheduling.example.sql`.
4. **Vérification** : consultez `job_runs` et `email_outbox` (requêtes en fin de fichier). Quand tout est conforme, passez `EMAIL_ENABLED=true`.

Sans fournisseur d'e-mail, la variante « sans e-mails » du fichier de planification exécute quand même les étapes 1, 3 et 4 ; les messages restent dans la file.

## Tests

- SQL (`npm run test:db`) : génération, confirmation sans doublon, absence de réponse ≠ paiement, relance en brouillon après délai, arrêt après règlement, réservation et nouvel essai de la file.
- Unitaires (`npm test`, `tests/outbox.test.ts`) : envoi désactivé par défaut, pièce jointe PDF, quittance annulée, relance devenue sans objet, échec du fournisseur, journaux sans adresse, format de l'appel Resend.
- **Non testé ici** : la fonction déployée sur Supabase et l'envoi réel par Resend (aucun compte ni réseau disponibles pendant le développement).
