-- Retour arrière de 20261120000100_residences.sql

create or replace function public.iz_property_status_rules()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  snap jsonb;
begin
  -- Archivage : mémoriser le statut précédent pour pouvoir désarchiver
  if new.status = 'archive' and (tg_op = 'INSERT' or old.status <> 'archive') then
    new.status_before_archive := coalesce(new.status_before_archive, case when tg_op = 'UPDATE' then old.status end, 'repere');
  elsif new.status <> 'archive' then
    new.status_before_archive := null;
  end if;

  -- Passage à « acquis » : le bien rejoint « Mes biens »
  if new.status = 'acquis' and (tg_op = 'INSERT' or old.status <> 'acquis') then
    -- sans date saisie : la 1re échéance du crédit si elle est passée, sinon aujourd'hui (ANO-014)
    new.acquired_at := coalesce(new.acquired_at, least(new.loan_start_date, current_date), current_date);
    new.occupation_status := coalesce(new.occupation_status, 'vacant');
    if new.acquisition_snapshot is null and new.primary_scenario_id is not null then
      select jsonb_build_object(
               'scenario_id', s.id, 'scenario_name', s.name, 'inputs', s.inputs,
               'results', s.results, 'engine_version', s.engine_version, 'taken_at', now())
        into snap
        from public.scenarios s
       where s.id = new.primary_scenario_id and s.user_id = new.user_id;
      new.acquisition_snapshot := snap;
    end if;
  end if;

  -- Un bien qui n'est plus détenu n'a pas de statut d'occupation
  if new.status <> 'acquis' then
    new.occupation_status := null;
  end if;
  return new;
end;
$$;

drop trigger if exists iz_status_rules on public.properties;
create trigger iz_status_rules before insert or update of status on public.properties
  for each row execute function public.iz_property_status_rules();

create or replace function public.iz_plan_check_property() returns trigger language plpgsql security definer set search_path = public as $$
declare t plan_tiers; n int;
begin
  t := iz_plan_of(new.user_id);
  if t.max_owned is null and t.max_prospects is null then return new; end if;
  -- sérialise les créations d'un même compte (deux onglets, import)
  perform pg_advisory_xact_lock(hashtextextended('iz_plan:' || new.user_id::text, 0));
  if t.max_owned is not null and new.status = 'acquis' and (tg_op = 'INSERT' or old.status is distinct from 'acquis') then
    select count(*) into n from properties where user_id = new.user_id and status = 'acquis' and id <> new.id;
    if n >= t.max_owned then perform iz__plan_refuse(t, case when t.max_owned = 1 then '1 bien détenu au plus' else t.max_owned || ' biens détenus au plus' end); end if;
  end if;
  if t.max_prospects is not null and iz__is_prospect(new.status) and (tg_op = 'INSERT' or not iz__is_prospect(old.status)) then
    select count(*) into n from properties where user_id = new.user_id and iz__is_prospect(status) and id <> new.id;
    if n >= t.max_prospects then perform iz__plan_refuse(t, format('%s biens en prospection au plus (hors biens archivés, refusés ou abandonnés)', t.max_prospects)); end if;
  end if;
  return new;
end $$;

drop trigger if exists iz_plan_check_property on public.properties;
create trigger iz_plan_check_property before insert or update of status on public.properties
  for each row execute function public.iz_plan_check_property();

create or replace function public.iz_my_plan() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid(); t plan_tiers; c app_config; v_pack timestamptz; st record; v_storage bigint := 0;
begin
  if u is null then raise exception 'Session expirée.' using errcode = '42501'; end if;
  t := iz_plan_of(u);
  select * into c from app_config limit 1;
  select fiscal_pack_until into v_pack from subscriptions where user_id = u;
  select * into st from iz_access_state(u);
  if to_regclass('public.documents') is not null then
    execute 'select coalesce(sum(size_bytes), 0) from public.documents where user_id = $1' into v_storage using u;
  end if;
  return jsonb_build_object(
    'tier', t.code, 'label', t.label, 'enforce', coalesce(c.enforce_subscription, false),
    'reason', st.reason, 'until', st.until, 'trial_tier', c.trial_tier, 'fiscal_pack_until', v_pack,
    'limits', jsonb_build_object('owned', t.max_owned, 'prospects', t.max_prospects, 'scenarios', t.max_scenarios, 'storage_mb', t.storage_mb),
    'features', jsonb_build_object('contacts', t.f_contacts, 'automations', t.f_automations,
                                   'consolidated', t.f_consolidated, 'fiscal', iz_feature(u, 'fiscal'), 'sharing', t.f_sharing),
    'usage', jsonb_build_object(
      'owned', (select count(*) from properties where user_id = u and status = 'acquis'),
      'prospects', (select count(*) from properties where user_id = u and iz__is_prospect(status)),
      'storage_bytes', v_storage));
end $$;

create or replace function public.iz_lease_rules() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.property_id <> old.property_id then
    if not exists (select 1 from properties p where p.id = new.property_id and p.user_id = new.user_id and p.status = 'acquis') then
      raise exception 'Un bail ne peut concerner qu''un bien détenu (rubrique Mes biens).' using errcode = 'check_violation';
    end if;
  end if;
  if (tg_op = 'INSERT' or new.start_date <> old.start_date) and new.start_date < date '1950-01-01' then
    raise exception 'Date de début improbable (avant 1950) : vérifiez l''année.' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and new.property_id <> old.property_id
     and exists (select 1 from rent_charges c where c.lease_id = old.id) then
    raise exception 'Le bien d''un bail ayant des échéances ne peut pas être changé.' using errcode = 'check_violation';
  end if;
  -- Nouvelle date de début : échéances devenues fausses supprimées (régénérées ensuite)
  if tg_op = 'UPDATE' and new.start_date <> old.start_date then
    perform iz__purge_lease_charges(new.id, new.start_date, old.start_date);
  end if;
  -- Fin de bail avancée : les échéances futures sans paiement sont annulées
  if tg_op = 'UPDATE' and new.end_date is not null and (old.end_date is null or new.end_date < old.end_date) then
    update rent_charges c set cancelled_at = now()
     where c.lease_id = new.id and c.kind = 'loyer' and c.period_start > new.end_date and c.cancelled_at is null
       and not exists (select 1 from payment_allocations a where a.charge_id = c.id);
  end if;
  return new;
end $$;

alter table public.properties drop column if exists usage;
