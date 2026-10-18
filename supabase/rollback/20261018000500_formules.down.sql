-- Annule 20261018000500_formules.sql : retour à l'offre unique (mensuel, annuel) et au contrôle « consultation seule ».
-- Les abonnements rattachés aux nouvelles offres perdent leur offre (plan_code vidé) ; le pack fiscal est oublié.
drop trigger if exists iz_plan_check_property on public.properties;
drop trigger if exists iz_plan_check_scenario on public.scenarios;
drop trigger if exists iz_plan_check_contact on public.pro_contacts;
do $$
begin
  if to_regclass('public.documents') is not null then
    drop trigger if exists iz_plan_check_document on public.documents;
    drop trigger if exists iz_plan_check_lease on public.leases;
    drop trigger if exists iz_plan_check_reminder on public.reminders;
    drop trigger if exists iz_plan_check_outbox on public.email_outbox;
    -- quittance automatique d'origine
    execute $f$
      create or replace function public.iz_auto_receipt()
      returns trigger language plpgsql security definer set search_path = public as $b$
      declare c rent_charges%rowtype; l leases%rowtype; r receipts%rowtype;
      begin
        select * into c from rent_charges where id = new.charge_id;
        select * into l from leases where id = c.lease_id;
        if not l.receipt_auto_send or c.cancelled_at is not null then return null; end if;
        if iz_charge_allocated(c.id) <> c.rent_amount + c.charges_amount then return null; end if;
        if exists (select 1 from receipts where charge_id = c.id and kind = 'quittance' and cancelled_at is null) then return null; end if;
        r := iz__issue_receipt(c.id, 'quittance');
        if cardinality(r.tenant_emails) > 0 then perform iz__queue_receipt_email(r.id); end if;
        return null;
      end $b$ $f$;
    revoke execute on function public.iz_auto_receipt() from public, anon, authenticated;
  end if;
end $$;
drop function if exists public.iz_plan_check_property();
drop function if exists public.iz_plan_check_scenario();
drop function if exists public.iz_plan_check_contact();
drop function if exists public.iz_plan_check_document();
drop function if exists public.iz_plan_check_lease();
drop function if exists public.iz_plan_check_reminder();
drop function if exists public.iz_plan_check_outbox();
drop function if exists public.iz_my_plan();
drop function if exists public.iz_grant_fiscal_pack(uuid, int);

-- Accès d'origine : sans abonnement après l'essai, contrôle activé → consultation seule
create or replace function public.iz_access_state(p_user uuid default auth.uid())
returns table (has_access boolean, reason text, until timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  c app_config;
  s subscriptions;
  v_created timestamptz;
begin
  select * into c from app_config limit 1;
  if p_user is null then return query select false, 'anonyme', null::timestamptz; return; end if;
  if exists (select 1 from admins where user_id = p_user) then return query select true, 'administrateur', null::timestamptz; return; end if;
  select * into s from subscriptions where user_id = p_user;
  if s.status in ('active','trialing','past_due') then
    return query select true, 'abonnement_' || s.status, s.current_period_end; return;
  end if;
  if s.status = 'canceled' and s.current_period_end > now() then
    return query select true, 'resilie_fin_de_periode', s.current_period_end; return;
  end if;
  select created_at into v_created from auth.users where id = p_user;
  if v_created + make_interval(days => coalesce(c.trial_days, 0)) > now() then
    return query select true, 'essai', v_created + make_interval(days => c.trial_days); return;
  end if;
  if not coalesce(c.enforce_subscription, false) then
    return query select true, 'acces_libre', null::timestamptz; return;
  end if;
  return query select false, coalesce('abonnement_' || nullif(s.status, 'none'), 'sans_abonnement'), s.current_period_end;
end $$;

do $$
declare t text;
begin
  foreach t in array array['properties','scenarios','timeline_events','property_tasks','pro_contacts','tenants','leases','lease_tenants',
                           'rent_charges','payments','payment_allocations','deposit_movements','reminders','documents','expenses'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists iz_gate_insert on public.%I', t);
    execute format('drop policy if exists iz_gate_update on public.%I', t);
    execute format('drop policy if exists iz_gate_delete on public.%I', t);
    execute format('create policy iz_gate_insert on public.%I as restrictive for insert to authenticated with check (public.iz_has_access())', t);
    execute format('create policy iz_gate_update on public.%I as restrictive for update to authenticated using (public.iz_has_access())', t);
    execute format('create policy iz_gate_delete on public.%I as restrictive for delete to authenticated using (public.iz_has_access())', t);
  end loop;
end $$;

-- Administration d'origine
drop function if exists public.iz_admin_users();
create or replace function public.iz_admin_users()
returns table (user_id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, is_admin boolean,
               status text, source text, plan_code text, current_period_end timestamptz, cancel_at_period_end boolean,
               has_access boolean, access_reason text, support_until timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform iz_require_admin();
  return query
    select u.id, u.email::text, u.created_at, u.last_sign_in_at, exists (select 1 from admins a where a.user_id = u.id),
           coalesce(s.status, 'none'), s.source, s.plan_code, s.current_period_end, coalesce(s.cancel_at_period_end, false),
           st.has_access, st.reason, sa.granted_until
      from auth.users u
      left join subscriptions s on s.user_id = u.id
      left join support_access sa on sa.user_id = u.id and sa.granted_until > now()
      cross join lateral iz_access_state(u.id) st
     order by u.created_at desc;
end $$;

drop function if exists public.iz_admin_set_manual_access(uuid, timestamptz, text, text);
create or replace function public.iz_admin_set_manual_access(p_user uuid, p_until timestamptz, p_note text default null)
returns subscriptions language plpgsql security definer set search_path = public as $$
declare s subscriptions;
begin
  perform iz_require_admin();
  select * into s from subscriptions where user_id = p_user;
  if found and s.source = 'stripe' and s.status in ('active','trialing','past_due') then
    raise exception 'Ce compte a un abonnement Stripe en cours : gérez-le dans Stripe.';
  end if;
  insert into subscriptions (user_id, source, status, current_period_end, note, updated_at)
  values (p_user, 'manuel', case when p_until is null or p_until <= now() then 'canceled' else 'active' end, p_until, left(p_note, 300), now())
  on conflict (user_id) do update set source = 'manuel', status = excluded.status, current_period_end = excluded.current_period_end,
    note = excluded.note, cancel_at_period_end = false, updated_at = now()
  returning * into s;
  insert into admin_audit (admin_id, action, target_user, details) values (auth.uid(), 'acces_manuel', p_user, jsonb_build_object('jusqu_au', p_until, 'note', p_note));
  return s;
end $$;

drop function if exists public.iz_admin_set_config(boolean, int, text, text);
create or replace function public.iz_admin_set_config(p_enforce boolean, p_trial_days int, p_support_email text)
returns app_config language plpgsql security definer set search_path = public as $$
declare c app_config;
begin
  perform iz_require_admin();
  update app_config set enforce_subscription = p_enforce, trial_days = p_trial_days, support_email = nullif(trim(p_support_email), ''),
    updated_at = now(), updated_by = auth.uid()
  returning * into c;
  insert into admin_audit (admin_id, action, details) values (auth.uid(), 'configuration', to_jsonb(c));
  return c;
end $$;
revoke all on function public.iz_admin_users(), public.iz_admin_set_manual_access(uuid, timestamptz, text), public.iz_admin_set_config(boolean, int, text) from public, anon;
grant execute on function public.iz_admin_users(), public.iz_admin_set_manual_access(uuid, timestamptz, text), public.iz_admin_set_config(boolean, int, text) to authenticated;

drop function if exists public.iz_feature(uuid, text);
drop function if exists public.iz__plan_refuse(plan_tiers, text);
drop function if exists public.iz_plan_of(uuid);
drop function if exists public.iz_user_tier(uuid);
drop function if exists public.iz__is_prospect(text);
drop function if exists public.iz__size_label(int);

update public.subscriptions set plan_code = null where plan_code is not null and plan_code not in ('mensuel','annuel');
delete from public.plans where code not in ('mensuel','annuel');
update public.plans set label = replace(label, ' (ancienne offre)', '') where code in ('mensuel','annuel');
alter table public.plans drop constraint if exists plans_tier_kind_check;
alter table public.plans drop column if exists sort, drop column if exists kind, drop column if exists tier;
alter table public.plans drop constraint if exists plans_code_check;
alter table public.plans add constraint plans_code_check check (code in ('mensuel','annuel'));
alter table public.subscriptions drop column if exists manual_tier, drop column if exists fiscal_pack_until;
alter table public.app_config drop column if exists trial_tier;
drop table if exists public.plan_tiers;
notify pgrst, 'reload schema';
