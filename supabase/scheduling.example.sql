-- =====================================================================
-- Planification des tâches serveur Immo-Zen (exemple générique ; utilisez plutôt supabase/scheduling.sql, prêt à l’emploi)
-- À exécuter dans Supabase > SQL Editor APRÈS :
--   1. la migration 20261014000200_lot2_gestion_locative.sql ;
--   2. le déploiement de la fonction « daily » (voir docs/TACHES-SERVEUR.md) ;
--   3. l'activation des extensions pg_cron et pg_net (Database > Extensions).
-- Remplacez VOTRE-PROJET et le jeton (identique au secret CRON_SECRET de la fonction).
-- pg_cron s'exécute en UTC : 04:00 UTC = 6 h l'été / 5 h l'hiver à Paris ;
-- la date « du jour » est toujours calculée à Paris par iz_today_paris().
-- =====================================================================

-- Jeton stocké dans le coffre (Vault), jamais en clair dans les tâches
select vault.create_secret('REMPLACEZ-PAR-UN-JETON-LONG-ET-ALEATOIRE', 'immozen_cron_secret');

-- Chaque jour : échéances du mois, e-mails de confirmation au propriétaire,
-- relances préparées en brouillon, puis envoi de la file et ménage des fichiers supprimés
select cron.schedule('immozen-daily', '0 4 * * *', $$
  select net.http_post(
    url := 'https://VOTRE-PROJET.supabase.co/functions/v1/daily',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'immozen_cron_secret')),
    body := '{"tasks":["daily","outbox","storage"]}'::jsonb)
$$);

-- Toutes les 15 minutes : envoi des e-mails en attente (quittances, relances validées)
select cron.schedule('immozen-outbox', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://VOTRE-PROJET.supabase.co/functions/v1/daily',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'immozen_cron_secret')),
    body := '{"tasks":["outbox"]}'::jsonb)
$$);

-- Variante sans e-mails : seulement les tâches en base (échéances, relances en brouillon)
-- select cron.schedule('immozen-daily-sql', '0 4 * * *', $$ select public.iz_daily_tasks() $$);

-- Contrôle
-- select * from cron.job;
-- select job, run_key, status, details, finished_at from public.job_runs order by started_at desc limit 20;
-- select kind, status, attempts, last_error, created_at from public.email_outbox order by created_at desc limit 20;
