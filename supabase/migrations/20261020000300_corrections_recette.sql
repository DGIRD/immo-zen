-- Corrections issues de la recette du 20/10/2026.
--  ANO-001 : la fonction « daily » vérifie le jeton de la planification contre le coffre (vault),
--            seule source de vérité : plus de secret à recopier à l'identique dans les fonctions.
--  ANO-004 : motif d'annulation d'une échéance.
--  ANO-008 : fonctions SECURITY DEFINER retirées au rôle anonyme (sauf le formulaire du site),
--            search_path fixé sur les fonctions utilitaires.
-- Réexécutable sans effet de bord.

-- ---------- ANO-001 : jeton de la planification
create or replace function public.iz_cron_token_ok(p_token text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if coalesce(p_token, '') = '' or to_regclass('vault.decrypted_secrets') is null then return false; end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into v using 'immozen_cron_secret';
  return v is not null and length(v) >= 16 and v = p_token;
end $$;
revoke all on function public.iz_cron_token_ok(text) from public, anon, authenticated;
grant execute on function public.iz_cron_token_ok(text) to service_role;

-- ---------- ANO-004 : motif d'annulation des échéances
alter table public.rent_charges add column if not exists cancel_reason text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'rent_charges_cancel_reason_len') then
    alter table public.rent_charges add constraint rent_charges_cancel_reason_len check (char_length(cancel_reason) <= 500);
  end if;
end $$;

-- ---------- ANO-008 : durcissement
-- Fonctions SECURITY DEFINER de l'API : réservées aux comptes connectés (elles contrôlaient déjà auth.uid()).
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname <> 'iz_submit_lead'
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
-- Fonctions utilitaires sans search_path fixe.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'public' and p.proname in ('iz_eur', 'iz_today_paris', 'iz__is_prospect', 'iz__size_label', 'iz__plan_refuse'))
       or (n.nspname = 'immozen_backup' and p.proname in ('txt', 'num', 'map_status', 'map_type'))
  loop
    execute format('alter function %s set search_path = %I, public, pg_catalog', f.sig, f.nspname);
  end loop;
end $$;
