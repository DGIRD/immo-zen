-- =====================================================================
-- Immo-Zen – Formules Découverte, Essentiel, Patrimoine et Pro (grille du 18/10/2026)
-- Additive et idempotente. Annulation : supabase/rollback/20261018000500_formules.down.sql
--
--  * plan_tiers : limites et fonctions de chaque formule (modifiables en SQL par un administrateur) ;
--  * plans : six offres Stripe (3 formules × mensuel/annuel) et le pack fiscal (paiement ponctuel) ;
--  * iz_user_tier() : formule en vigueur d'un compte (abonnement, accès manuel, essai, sinon Découverte) ;
--  * déclencheurs : les limites sont vérifiées par la base, quelle que soit l'origine de l'écriture
--    (interface, import d'une sauvegarde, tâche serveur). Les exports (Excel, CSV, sauvegarde) restent ouverts
--    à toutes les formules. Les données existantes au-delà d'une limite
--    (après un changement de formule) restent consultables et modifiables : seuls les ajouts sont refusés.
--  * Tant que le contrôle d'accès (app_config.enforce_subscription) est désactivé, tout le monde
--    dispose de toutes les fonctions (phase de lancement) : la migration ne change rien pour les comptes existants.
--  * Le contrôle n'interdit plus les modifications des comptes sans abonnement : ils passent en formule
--    Découverte (gratuite, limitée) au lieu de la consultation seule.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Formules et limites
-- ---------------------------------------------------------------------
create table if not exists public.plan_tiers (
  code text primary key check (code in ('decouverte','essentiel','patrimoine','pro')),
  label text not null check (char_length(label) between 1 and 40),
  rank int not null unique,
  -- null : illimité
  max_owned int check (max_owned is null or max_owned >= 0),            -- biens détenus (statut « acquis »)
  max_prospects int check (max_prospects is null or max_prospects >= 0), -- biens en prospection actifs
  max_scenarios int check (max_scenarios is null or max_scenarios >= 1), -- scénarios actifs par bien
  storage_mb int check (storage_mb is null or storage_mb >= 0),          -- espace des documents privés
  f_contacts boolean not null default false,     -- contacts immobiliers, relances agence, comparaison
  f_automations boolean not null default false,  -- quittances automatiques, relances d'impayés, e-mail mensuel
  f_consolidated boolean not null default false, -- cash-flow consolidé du tableau de bord
  f_fiscal boolean not null default false,       -- déclaration fiscale (sinon : pack fiscal)
  f_sharing boolean not null default false,      -- plusieurs SCI, accès partagé (à venir)
  updated_at timestamptz not null default now()
);
insert into public.plan_tiers (code, label, rank, max_owned, max_prospects, max_scenarios, storage_mb,
                               f_contacts, f_automations, f_consolidated, f_fiscal, f_sharing) values
  ('decouverte', 'Découverte', 0, 1,    5,    2,    100,   false, false, false, false, false),
  ('essentiel',  'Essentiel',  1, 3,    null, null, 1024,  true,  true,  false, false, false),
  ('patrimoine', 'Patrimoine', 2, 10,   null, null, 5120,  true,  true,  true,  false, false),
  ('pro',        'Pro',        3, null, null, null, 20480, true,  true,  true,  true,  true)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- Offres Stripe : formule × périodicité, et options
-- ---------------------------------------------------------------------
alter table public.plans drop constraint if exists plans_code_check;
alter table public.plans add constraint plans_code_check check (code ~ '^[a-z][a-z_]{1,39}$');
alter table public.plans add column if not exists tier text references public.plan_tiers(code);
alter table public.plans add column if not exists kind text not null default 'formule' check (kind in ('formule','option'));
alter table public.plans add column if not exists sort int not null default 100;
alter table public.plans drop constraint if exists plans_tier_kind_check;
alter table public.plans add constraint plans_tier_kind_check check ((kind = 'formule') = (tier is not null) or code in ('mensuel','annuel'));

-- Prix affichés (TTC, centimes) ; seul le prix Stripe fait foi pour le paiement.
insert into public.plans (code, label, amount_cents, billing_interval, tier, kind, sort) values
  ('essentiel_mensuel',  'Essentiel, mensuel',  990,   'month', 'essentiel',  'formule', 10),
  ('essentiel_annuel',   'Essentiel, annuel',   9900,  'year',  'essentiel',  'formule', 11),
  ('patrimoine_mensuel', 'Patrimoine, mensuel', 1990,  'month', 'patrimoine', 'formule', 20),
  ('patrimoine_annuel',  'Patrimoine, annuel',  19900, 'year',  'patrimoine', 'formule', 21),
  ('pro_mensuel',        'Pro, mensuel',        3990,  'month', 'pro',        'formule', 30),
  ('pro_annuel',         'Pro, annuel',         39900, 'year',  'pro',        'formule', 31),
  -- paiement ponctuel : déclaration fiscale pendant 12 mois (formules Essentiel et Patrimoine)
  ('pack_fiscal',        'Pack fiscal (12 mois)', 4900, 'year', null,         'option',  90)
on conflict (code) do nothing;
-- Anciennes offres uniques : conservées pour les abonnements éventuels, fermées, rattachées à Patrimoine
update public.plans set tier = coalesce(tier, 'patrimoine'), active = false, sort = 99,
       label = case when label like '%(ancienne offre)' then label else left(label || ' (ancienne offre)', 80) end
 where code in ('mensuel','annuel');

alter table public.subscriptions add column if not exists manual_tier text references public.plan_tiers(code);
alter table public.subscriptions add column if not exists fiscal_pack_until timestamptz;
alter table public.app_config add column if not exists trial_tier text not null default 'patrimoine' references public.plan_tiers(code);

alter table public.plan_tiers enable row level security;
drop policy if exists plan_tiers_read on public.plan_tiers;
create policy plan_tiers_read on public.plan_tiers for select to authenticated using (true);
drop policy if exists plan_tiers_admin on public.plan_tiers;
create policy plan_tiers_admin on public.plan_tiers for update to authenticated using (public.iz_is_admin()) with check (public.iz_is_admin());

-- ---------------------------------------------------------------------
-- Formule en vigueur
-- ---------------------------------------------------------------------
create or replace function public.iz_user_tier(p_user uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare c app_config; s subscriptions; v_created timestamptz; v_tier text;
begin
  if p_user is null then return 'decouverte'; end if;
  if exists (select 1 from admins where user_id = p_user) then return 'pro'; end if;
  select * into c from app_config limit 1;
  -- phase de lancement : toutes les fonctions pour tout le monde
  if not coalesce(c.enforce_subscription, false) then return 'pro'; end if;
  select * into s from subscriptions where user_id = p_user;
  if found and (s.status in ('active','trialing','past_due') or (s.status = 'canceled' and s.current_period_end > now())) then
    if s.source = 'manuel' then return coalesce(s.manual_tier, 'pro'); end if;
    select p.tier into v_tier from plans p where p.code = s.plan_code;
    return coalesce(v_tier, 'patrimoine');  -- offre inconnue (prix Stripe non déclaré) : jamais moins qu'un abonné
  end if;
  select created_at into v_created from auth.users where id = p_user;
  if v_created + make_interval(days => coalesce(c.trial_days, 0)) > now() then return coalesce(c.trial_tier, 'patrimoine'); end if;
  return 'decouverte';
end $$;

create or replace function public.iz_plan_of(p_user uuid)
returns plan_tiers language sql stable security definer set search_path = public as $$
  select t.* from plan_tiers t where t.code = iz_user_tier(p_user)
$$;

-- Fonction incluse ? (fiscal : formule Pro, ou pack fiscal en cours de validité)
create or replace function public.iz_feature(p_user uuid, p_feature text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare t plan_tiers;
begin
  t := iz_plan_of(p_user);
  return case p_feature
    when 'contacts' then t.f_contacts
    when 'automations' then t.f_automations
    when 'consolidated' then t.f_consolidated
    when 'sharing' then t.f_sharing
    when 'fiscal' then t.f_fiscal or exists (select 1 from subscriptions s where s.user_id = p_user and s.fiscal_pack_until > now())
    else false end;
end $$;

create or replace function public.iz__plan_refuse(p_tier plan_tiers, p_what text)
returns void language plpgsql as $$
begin
  raise exception 'Formule % : %. Choisissez une formule supérieure dans « Mon abonnement ».', p_tier.label, p_what
    using errcode = 'P0001', hint = 'iz_plan_limit';
end $$;

create or replace function public.iz__is_prospect(p_status text)
returns boolean language sql immutable as $$
  select p_status is not null and p_status not in ('acquis','archive','refuse','abandonne')
$$;

create or replace function public.iz__size_label(p_mb int)
returns text language sql immutable as $$
  select case when p_mb >= 1024 then (p_mb / 1024)::text || ' Go' else p_mb::text || ' Mo' end
$$;

-- ---------------------------------------------------------------------
-- Contrôles des limites
-- ---------------------------------------------------------------------
create or replace function public.iz_plan_check_property()
returns trigger language plpgsql security definer set search_path = public as $$
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

create or replace function public.iz_plan_check_scenario()
returns trigger language plpgsql security definer set search_path = public as $$
declare t plan_tiers; n int;
begin
  if new.property_id is null or new.archived_at is not null then return new; end if;
  if tg_op = 'UPDATE' and old.property_id is not distinct from new.property_id and old.archived_at is null then return new; end if;
  t := iz_plan_of(new.user_id);
  if t.max_scenarios is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('iz_plan:' || new.user_id::text, 0));
  select count(*) into n from scenarios where user_id = new.user_id and property_id = new.property_id and archived_at is null and id <> new.id;
  if n >= t.max_scenarios then perform iz__plan_refuse(t, format('%s scénarios de simulation par bien au plus', t.max_scenarios)); end if;
  return new;
end $$;
drop trigger if exists iz_plan_check_scenario on public.scenarios;
create trigger iz_plan_check_scenario before insert or update of property_id, archived_at on public.scenarios
  for each row execute function public.iz_plan_check_scenario();

create or replace function public.iz_plan_check_contact()
returns trigger language plpgsql security definer set search_path = public as $$
declare t plan_tiers;
begin
  t := iz_plan_of(new.user_id);
  if not t.f_contacts then perform iz__plan_refuse(t, 'les contacts immobiliers (agences, agents, relances) ne sont pas inclus'); end if;
  return new;
end $$;
drop trigger if exists iz_plan_check_contact on public.pro_contacts;
create trigger iz_plan_check_contact before insert on public.pro_contacts for each row execute function public.iz_plan_check_contact();

do $$
begin
  if to_regclass('public.documents') is null then return; end if;
  execute $f$
    create or replace function public.iz_plan_check_document()
    returns trigger language plpgsql security definer set search_path = public as $b$
    declare t plan_tiers; v_used bigint;
    begin
      t := iz_plan_of(new.user_id);
      if t.storage_mb is null then return new; end if;
      perform pg_advisory_xact_lock(hashtextextended('iz_plan:' || new.user_id::text, 0));
      select coalesce(sum(size_bytes), 0) into v_used from documents where user_id = new.user_id and id <> new.id;
      if v_used + new.size_bytes > t.storage_mb::bigint * 1048576 then
        perform iz__plan_refuse(t, format('%s d''espace pour les documents au plus', iz__size_label(t.storage_mb)));
      end if;
      return new;
    end $b$ $f$;
  drop trigger if exists iz_plan_check_document on public.documents;
  create trigger iz_plan_check_document before insert on public.documents for each row execute function public.iz_plan_check_document();

  execute $f$
    create or replace function public.iz_plan_check_lease()
    returns trigger language plpgsql security definer set search_path = public as $b$
    declare t plan_tiers;
    begin
      -- seul l'activation d'une automatisation est contrôlée : un bail existant reste modifiable après un changement de formule
      if not ((new.receipt_auto_send and (tg_op = 'INSERT' or not old.receipt_auto_send))
           or (new.reminder_enabled and (tg_op = 'INSERT' or not old.reminder_enabled))
           or (new.owner_confirmation_email and (tg_op = 'INSERT' or not old.owner_confirmation_email))) then
        return new;
      end if;
      t := iz_plan_of(new.user_id);
      if not t.f_automations then
        perform iz__plan_refuse(t, 'l''envoi automatique des quittances, les relances d''impayés et l''e-mail mensuel de confirmation ne sont pas inclus');
      end if;
      return new;
    end $b$ $f$;
  drop trigger if exists iz_plan_check_lease on public.leases;
  create trigger iz_plan_check_lease before insert or update on public.leases for each row execute function public.iz_plan_check_lease();

  -- Relances : un brouillon automatique est simplement ignoré, une relance saisie est refusée
  execute $f$
    create or replace function public.iz_plan_check_reminder()
    returns trigger language plpgsql security definer set search_path = public as $b$
    declare t plan_tiers;
    begin
      t := iz_plan_of(new.user_id);
      if t.f_automations then return new; end if;
      if new.created_by = 'automatique' then return null; end if;
      perform iz__plan_refuse(t, 'les relances d''impayés ne sont pas incluses');
      return null;
    end $b$ $f$;
  drop trigger if exists iz_plan_check_reminder on public.reminders;
  create trigger iz_plan_check_reminder before insert on public.reminders for each row execute function public.iz_plan_check_reminder();

  -- E-mails automatiques (confirmation de paiement, relance à valider) : non préparés sans la fonction
  execute $f$
    create or replace function public.iz_plan_check_outbox()
    returns trigger language plpgsql security definer set search_path = public as $b$
    begin
      if new.kind in ('confirmation_paiement','relance_a_valider') and not iz_feature(new.user_id, 'automations') then return null; end if;
      return new;
    end $b$ $f$;
  drop trigger if exists iz_plan_check_outbox on public.email_outbox;
  create trigger iz_plan_check_outbox before insert on public.email_outbox for each row execute function public.iz_plan_check_outbox();

  -- Quittance automatique : uniquement si la formule l'inclut (le bail peut avoir été réglé avant un changement de formule)
  execute $f$
    create or replace function public.iz_auto_receipt()
    returns trigger language plpgsql security definer set search_path = public as $b$
    declare c rent_charges%rowtype; l leases%rowtype; r receipts%rowtype;
    begin
      select * into c from rent_charges where id = new.charge_id;
      select * into l from leases where id = c.lease_id;
      if not l.receipt_auto_send or c.cancelled_at is not null then return null; end if;
      if not iz_feature(l.user_id, 'automations') then return null; end if;
      if iz_charge_allocated(c.id) <> c.rent_amount + c.charges_amount then return null; end if;
      if exists (select 1 from receipts where charge_id = c.id and kind = 'quittance' and cancelled_at is null) then return null; end if;
      r := iz__issue_receipt(c.id, 'quittance');
      if cardinality(r.tenant_emails) > 0 then perform iz__queue_receipt_email(r.id); end if;
      return null;
    end $b$ $f$;
  revoke execute on function public.iz_auto_receipt() from public, anon, authenticated;
end $$;

-- ---------------------------------------------------------------------
-- Accès : plus de « consultation seule », un compte sans abonnement passe en Découverte
-- ---------------------------------------------------------------------
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
  return query select true, 'decouverte', null::timestamptz;
end $$;

-- Les garde-fous « consultation seule » du lot 3 sont remplacés par les limites de formule
do $$
declare t text;
begin
  foreach t in array array['properties','scenarios','timeline_events','property_tasks','pro_contacts','tenants','leases','lease_tenants',
                           'rent_charges','payments','payment_allocations','deposit_movements','reminders','documents','expenses'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists iz_gate_insert on public.%I', t);
    execute format('drop policy if exists iz_gate_update on public.%I', t);
    execute format('drop policy if exists iz_gate_delete on public.%I', t);
  end loop;
end $$;

-- Formule, limites, fonctions et usage du compte connecté (pour l'interface)
create or replace function public.iz_my_plan()
returns jsonb language plpgsql stable security definer set search_path = public as $$
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

-- Pack fiscal payé (appelé par le webhook Stripe uniquement) : 12 mois, prolongé s'il est encore valide
create or replace function public.iz_grant_fiscal_pack(p_user uuid, p_months int default 12)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v timestamptz;
begin
  insert into subscriptions (user_id, fiscal_pack_until, updated_at)
  values (p_user, now() + make_interval(months => p_months), now())
  on conflict (user_id) do update
    set fiscal_pack_until = greatest(coalesce(subscriptions.fiscal_pack_until, now()), now()) + make_interval(months => p_months), updated_at = now()
  returning fiscal_pack_until into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Administration : formule dans la liste des comptes, accès manuel et essai par formule
-- ---------------------------------------------------------------------
drop function if exists public.iz_admin_users();
create or replace function public.iz_admin_users()
returns table (user_id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, is_admin boolean,
               status text, source text, plan_code text, current_period_end timestamptz, cancel_at_period_end boolean,
               has_access boolean, access_reason text, support_until timestamptz, tier text, fiscal_pack_until timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform iz_require_admin();
  return query
    select u.id, u.email::text, u.created_at, u.last_sign_in_at, exists (select 1 from admins a where a.user_id = u.id),
           coalesce(s.status, 'none'), s.source, s.plan_code, s.current_period_end, coalesce(s.cancel_at_period_end, false),
           st.has_access, st.reason, sa.granted_until, iz_user_tier(u.id), s.fiscal_pack_until
      from auth.users u
      left join subscriptions s on s.user_id = u.id
      left join support_access sa on sa.user_id = u.id and sa.granted_until > now()
      cross join lateral iz_access_state(u.id) st
     order by u.created_at desc;
end $$;

drop function if exists public.iz_admin_set_manual_access(uuid, timestamptz, text);
create or replace function public.iz_admin_set_manual_access(p_user uuid, p_until timestamptz, p_note text default null, p_tier text default 'pro')
returns subscriptions language plpgsql security definer set search_path = public as $$
declare s subscriptions;
begin
  perform iz_require_admin();
  if p_tier is null or not exists (select 1 from plan_tiers where code = p_tier) then raise exception 'Formule inconnue.'; end if;
  select * into s from subscriptions where user_id = p_user;
  if found and s.source = 'stripe' and s.status in ('active','trialing','past_due') then
    raise exception 'Ce compte a un abonnement Stripe en cours : gérez-le dans Stripe.';
  end if;
  insert into subscriptions (user_id, source, status, current_period_end, note, manual_tier, updated_at)
  values (p_user, 'manuel', case when p_until is null or p_until <= now() then 'canceled' else 'active' end, p_until, left(p_note, 300), p_tier, now())
  on conflict (user_id) do update set source = 'manuel', status = excluded.status, current_period_end = excluded.current_period_end,
    note = excluded.note, manual_tier = excluded.manual_tier, cancel_at_period_end = false, updated_at = now()
  returning * into s;
  insert into admin_audit (admin_id, action, target_user, details)
  values (auth.uid(), 'acces_manuel', p_user, jsonb_build_object('jusqu_au', p_until, 'note', p_note, 'formule', p_tier));
  return s;
end $$;

drop function if exists public.iz_admin_set_config(boolean, int, text);
create or replace function public.iz_admin_set_config(p_enforce boolean, p_trial_days int, p_support_email text, p_trial_tier text default 'patrimoine')
returns app_config language plpgsql security definer set search_path = public as $$
declare c app_config;
begin
  perform iz_require_admin();
  if p_trial_tier is null or not exists (select 1 from plan_tiers where code = p_trial_tier) then raise exception 'Formule d''essai inconnue.'; end if;
  update app_config set enforce_subscription = p_enforce, trial_days = p_trial_days, support_email = nullif(trim(p_support_email), ''),
    trial_tier = p_trial_tier, updated_at = now(), updated_by = auth.uid()
  returning * into c;
  insert into admin_audit (admin_id, action, details) values (auth.uid(), 'configuration', to_jsonb(c));
  return c;
end $$;

-- ---------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------
revoke all on function public.iz_user_tier(uuid), public.iz_plan_of(uuid), public.iz_feature(uuid, text), public.iz__plan_refuse(plan_tiers, text),
  public.iz_plan_check_property(), public.iz_plan_check_scenario(), public.iz_plan_check_contact(),
  public.iz_my_plan(), public.iz_grant_fiscal_pack(uuid, int), public.iz_admin_users(),
  public.iz_admin_set_manual_access(uuid, timestamptz, text, text), public.iz_admin_set_config(boolean, int, text, text) from public, anon;
revoke all on function public.iz_grant_fiscal_pack(uuid, int), public.iz_user_tier(uuid), public.iz_plan_of(uuid), public.iz_feature(uuid, text) from authenticated;
grant execute on function public.iz_my_plan(), public.iz_admin_users(), public.iz_admin_set_manual_access(uuid, timestamptz, text, text),
  public.iz_admin_set_config(boolean, int, text, text) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.iz_grant_fiscal_pack(uuid, int), public.iz_user_tier(uuid), public.iz_feature(uuid, text) to service_role';
  end if;
end $$;
grant select on public.plan_tiers to authenticated;
grant update on public.plan_tiers to authenticated;

notify pgrst, 'reload schema';
