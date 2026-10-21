-- Immo-Zen : alertes d'exploitation par e-mail.
-- Appelée par la fonction « daily » à chaque passage de l'envoi des e-mails (toutes les 5 minutes) :
-- tout nouvel incident (e-mail définitivement en échec, événement Stripe en erreur, tâche serveur en erreur,
-- tâche quotidienne absente depuis plus de 26 heures) est signalé une seule fois à l'adresse de support
-- (Administration → réglages, sinon contact@immo-zen.fr).
-- Annulation : supabase/rollback/20261021000200_alertes.down.sql

create table if not exists public.ops_alerts (
  kind text not null,
  ref text not null,
  detail text,
  alerted_at timestamptz not null default now(),
  primary key (kind, ref)
);
alter table public.ops_alerts enable row level security;
revoke all on public.ops_alerts from anon, authenticated;

alter table public.email_outbox drop constraint if exists email_outbox_kind_check;
alter table public.email_outbox add constraint email_outbox_kind_check
  check (kind in ('confirmation_paiement','quittance','relance','relance_a_valider','invitation_locataire','contact_site','facture_abonnement','alerte_exploitation'));
alter table public.email_outbox drop constraint if exists email_outbox_user_check;
alter table public.email_outbox add constraint email_outbox_user_check check (user_id is not null or kind in ('contact_site', 'alerte_exploitation'));

create or replace function public.iz_ops_check()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_to text;
  v_lines text[] := '{}';
  v_count int := 0;
  r record;
begin
  -- nouveaux incidents, jamais signalés
  for r in
    select 'email'::text as kind, o.id::text as ref,
           'E-mail « ' || o.kind || ' » abandonné après ' || o.attempts || ' essais : ' || left(coalesce(o.last_error, 'erreur inconnue'), 200) as detail
      from email_outbox o
     where o.status = 'echec' and o.kind <> 'alerte_exploitation'
       and not exists (select 1 from ops_alerts a where a.kind = 'email' and a.ref = o.id::text)
    union all
    select 'stripe', e.id, 'Événement Stripe ' || e.type || ' en erreur : ' || left(coalesce(e.error, ''), 200)
      from stripe_events e
     where e.status = 'erreur'
       and not exists (select 1 from ops_alerts a where a.kind = 'stripe' and a.ref = e.id)
    union all
    select 'tache', j.id::text, 'Tâche serveur « ' || j.job || ' » en erreur : ' || left(coalesce(j.details::text, ''), 200)
      from job_runs j
     where j.status = 'erreur'
       and not exists (select 1 from ops_alerts a where a.kind = 'tache' and a.ref = j.id::text)
    union all
    select 'quotidienne', current_date::text, 'La tâche quotidienne (échéances, relances) n’a pas abouti depuis plus de 26 heures.'
     where exists (select 1 from job_runs where job = 'daily')
       and not exists (select 1 from job_runs where job = 'daily' and status = 'ok' and started_at > now() - interval '26 hours')
       and not exists (select 1 from ops_alerts a where a.kind = 'quotidienne' and a.ref = current_date::text)
    limit 50
  loop
    insert into ops_alerts (kind, ref, detail) values (r.kind, r.ref, r.detail) on conflict do nothing;
    v_lines := v_lines || ('- ' || r.detail);
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then return 0; end if;

  select coalesce(nullif(trim(support_email), ''), 'contact@immo-zen.fr') into v_to from app_config limit 1;
  insert into email_outbox (user_id, kind, to_emails, subject, body_text, dedupe_key)
  values (null, 'alerte_exploitation', array[coalesce(v_to, 'contact@immo-zen.fr')],
    'Immo-Zen – ' || v_count || ' incident(s) à vérifier',
    'Bonjour,' || chr(10) || chr(10) ||
    'Les incidents suivants viennent d’être détectés sur Immo-Zen :' || chr(10) || chr(10) ||
    array_to_string(v_lines, chr(10)) || chr(10) || chr(10) ||
    'Détail et suivi : Administration → Incidents ({{APP_URL}}#/admin).' || chr(10) ||
    'Chaque incident n’est signalé qu’une fois. Un e-mail en échec peut être renvoyé après correction de l’adresse ; un événement Stripe en erreur est renvoyé automatiquement par Stripe pendant 3 jours.',
    'alerte:' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'))
  on conflict (dedupe_key) do nothing;
  return v_count;
end $$;
revoke all on function public.iz_ops_check() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.iz_ops_check() to service_role';
  end if;
end $$;

-- incidents déjà présents à la mise en service : considérés comme connus (pas d'alerte rétroactive)
insert into public.ops_alerts (kind, ref, detail)
  select 'email', id::text, 'antérieur à la mise en service' from public.email_outbox where status = 'echec' on conflict do nothing;
insert into public.ops_alerts (kind, ref, detail)
  select 'stripe', id, 'antérieur à la mise en service' from public.stripe_events where status = 'erreur' on conflict do nothing;
insert into public.ops_alerts (kind, ref, detail)
  select 'tache', id::text, 'antérieur à la mise en service' from public.job_runs where status = 'erreur' on conflict do nothing;

notify pgrst, 'reload schema';
