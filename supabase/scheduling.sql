-- =====================================================================
-- Planification des tâches serveur Immo-Zen – script prêt à l'emploi (projet sbxnjvjsapnsdeenmvtm)
-- Supabase > SQL Editor > New query : collez tout le fichier, remplacez UNE SEULE valeur (ligne « jeton »
-- ci-dessous) par la valeur exacte du secret GitHub CRON_SECRET, puis « Run ».
-- Le script peut être relancé sans erreur (il met à jour le jeton et les tâches existantes).
-- =====================================================================

-- 1. Extensions nécessaires (planificateur et appels HTTP)
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- 2. Jeton partagé avec la fonction « daily », rangé dans le coffre (Vault)
do $$
declare
  jeton text := 'COLLEZ-ICI-LA-VALEUR-DU-SECRET-CRON_SECRET';
  v_id uuid;
begin
  if jeton like 'COLLEZ-ICI%' or length(jeton) < 16 then
    raise exception 'Remplacez COLLEZ-ICI-LA-VALEUR-DU-SECRET-CRON_SECRET par la valeur du secret GitHub CRON_SECRET (16 caractères au moins).';
  end if;
  select id into v_id from vault.secrets where name = 'immozen_cron_secret';
  if v_id is null then perform vault.create_secret(jeton, 'immozen_cron_secret');
  else perform vault.update_secret(v_id, jeton);
  end if;
end $$;

-- 3. Tâches (une tâche existante du même nom est remplacée)
do $$
declare j text;
begin
  foreach j in array array['immozen-daily', 'immozen-outbox'] loop
    if exists (select 1 from cron.job where jobname = j) then perform cron.unschedule(j); end if;
  end loop;
end $$;

-- Chaque jour à 4 h UTC (6 h l'été à Paris) : échéances, confirmations, relances, envoi de la file, ménage des fichiers
select cron.schedule('immozen-daily', '0 4 * * *', $$
  select net.http_post(
    url := 'https://sbxnjvjsapnsdeenmvtm.supabase.co/functions/v1/daily',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'immozen_cron_secret')),
    body := '{"tasks":["daily","outbox","storage"]}'::jsonb,
    timeout_milliseconds := 60000)
$$);

-- Toutes les 5 minutes : envoi des e-mails en attente (quittances, relances validées, invitations, formulaire du site)
select cron.schedule('immozen-outbox', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://sbxnjvjsapnsdeenmvtm.supabase.co/functions/v1/daily',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'immozen_cron_secret')),
    body := '{"tasks":["outbox"]}'::jsonb,
    timeout_milliseconds := 60000)
$$);

-- 4. Contrôle : les deux tâches doivent apparaître
select jobid, jobname, schedule, active from cron.job where jobname like 'immozen-%' order by jobname;

-- Quelques minutes plus tard, pour vérifier (à exécuter séparément) :
-- select id, status_code, left(content::text, 200) as reponse, created from net._http_response order by created desc limit 5;
--   200 : fonction appelée ; 401 : le jeton ne correspond pas au secret CRON_SECRET (relancer le workflow GitHub) ;
--   404 : fonction « daily » non déployée.
-- select kind, status, attempts, last_error, created_at from public.email_outbox order by created_at desc limit 10;
