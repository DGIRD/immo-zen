-- =====================================================================
-- Ajout de la seule tâche « immozen-marche » (données de marché), sans toucher aux autres tâches ni au jeton.
-- À exécuter une fois dans Supabase > SQL Editor, après la migration 20261030000200_donnees_marche_auto.sql
-- et le déploiement de la fonction « marche » (workflow « Fonctions serveur Supabase »).
-- Le jeton est lu dans le coffre (« immozen_cron_secret »), déjà créé par supabase/scheduling.sql.
-- =====================================================================
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'immozen_cron_secret') then
    raise exception 'Jeton « immozen_cron_secret » absent du coffre : exécutez d''abord supabase/scheduling.sql.';
  end if;
  if exists (select 1 from cron.job where jobname = 'immozen-marche') then perform cron.unschedule('immozen-marche'); end if;
end $$;

-- Chaque nuit à 4 h 37 UTC (6 h 37 l'été, 5 h 37 l'hiver à Paris)
select cron.schedule('immozen-marche', '37 4 * * *', $$
  select net.http_post(
    url := 'https://sbxnjvjsapnsdeenmvtm.supabase.co/functions/v1/marche',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'immozen_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000)
$$);

select jobid, jobname, schedule, active from cron.job where jobname = 'immozen-marche';

-- Premier chargement sans attendre la nuit (facultatif) : relance la même requête immédiatement.
-- select net.http_post(url := 'https://sbxnjvjsapnsdeenmvtm.supabase.co/functions/v1/marche',
--   headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'immozen_cron_secret')),
--   body := '{}'::jsonb, timeout_milliseconds := 300000);
-- Résultat : select status, details, finished_at from public.job_runs where job = 'marche' order by started_at desc limit 5;
