-- =====================================================================
-- Immo-Zen – Contrats de bail, espace locataire, offre Découverte de 30 jours
-- Additive et idempotente. Annulation : supabase/rollback/20261020000100_baux_espace_locataire.down.sql
--
--  * leases.contract : informations du contrat de bail généré (type de bail, désignation, clauses) ;
--  * documents.shared_with_tenant : document visible dans l'espace locataire ;
--  * tenant_accounts : invitation d'un locataire à son espace (code à usage unique, lié à son e-mail),
--    accès en lecture seule à ses quittances et aux documents partagés, révocable par le bailleur ;
--  * fichiers : un locataire ne lit que les fichiers explicitement partagés avec lui ;
--  * offre Découverte : 30 jours gratuits (limites Découverte) à la création du compte ; ensuite, sans
--    abonnement et si le contrôle d'accès est activé, consultation et export seulement.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Contrat de bail et partage de documents
-- ---------------------------------------------------------------------
alter table public.leases add column if not exists contract jsonb;
alter table public.leases drop constraint if exists leases_contract_check;
alter table public.leases add constraint leases_contract_check check (contract is null or (jsonb_typeof(contract) = 'object' and pg_column_size(contract) <= 65536));

alter table public.documents add column if not exists shared_with_tenant boolean not null default false;

-- ---------------------------------------------------------------------
-- Comptes locataires
-- ---------------------------------------------------------------------
create table if not exists public.tenant_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,      -- bailleur
  tenant_id uuid not null,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  code_hash text,                                                          -- sha256 du code d'invitation en cours
  invited_at timestamptz,
  account_user_id uuid references auth.users(id) on delete set null,       -- compte du locataire, après acceptation
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id),
  foreign key (tenant_id, user_id) references public.tenants(id, user_id) on delete cascade
);
create index if not exists tenant_accounts_account_idx on public.tenant_accounts(account_user_id);

alter table public.tenant_accounts enable row level security;
-- le bailleur voit les accès de ses locataires ; toute écriture passe par les fonctions ci-dessous
drop policy if exists tenant_accounts_read on public.tenant_accounts;
create policy tenant_accounts_read on public.tenant_accounts for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete on public.tenant_accounts from authenticated, anon;
grant select on public.tenant_accounts to authenticated;

-- File d'e-mails : invitation à l'espace locataire
alter table public.email_outbox drop constraint if exists email_outbox_kind_check;
alter table public.email_outbox add constraint email_outbox_kind_check
  check (kind in ('confirmation_paiement','quittance','relance','relance_a_valider','invitation_locataire'));

-- ---------------------------------------------------------------------
-- Invitation, révocation, acceptation
-- ---------------------------------------------------------------------
create or replace function public.iz_invite_tenant(p_tenant uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid();
  t tenants%rowtype;
  a tenant_accounts%rowtype;
  v_code text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  v_landlord text;
begin
  if u is null then raise exception 'Session expirée.' using errcode = '42501'; end if;
  if to_regprocedure('public.iz_has_access()') is not null and not public.iz_has_access() then
    raise exception 'Accès en consultation seule : choisissez une formule dans « Mon abonnement » pour inviter un locataire.' using errcode = '42501';
  end if;
  select * into t from tenants where id = p_tenant and user_id = u;
  if not found then raise exception 'Locataire introuvable.' using errcode = 'P0002'; end if;
  if t.email is null then raise exception 'Renseignez l''adresse e-mail du locataire pour l''inviter.' using errcode = '22023'; end if;
  if t.archived_at is not null then raise exception 'Ce locataire est archivé.' using errcode = '22023'; end if;
  -- limite anti-abus : 10 invitations par bailleur et par jour
  if (select count(*) from email_outbox where user_id = u and kind = 'invitation_locataire' and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Trop d''invitations envoyées aujourd''hui : réessayez demain.' using errcode = '54000';
  end if;

  insert into tenant_accounts (user_id, tenant_id, email, code_hash, invited_at)
  values (u, t.id, lower(t.email), encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), now())
  on conflict (tenant_id) do update set
    email = excluded.email, code_hash = excluded.code_hash, invited_at = now(), revoked_at = null,
    -- une nouvelle adresse e-mail oblige le locataire à accepter de nouveau
    account_user_id = case when tenant_accounts.email = excluded.email then tenant_accounts.account_user_id end,
    accepted_at = case when tenant_accounts.email = excluded.email then tenant_accounts.accepted_at end,
    updated_at = now()
  returning * into a;

  select coalesce(nullif(trim((select landlord_name from leases l join lease_tenants lt on lt.lease_id = l.id
                                where lt.tenant_id = t.id and l.landlord_name is not null order by l.start_date desc limit 1)), ''),
                  'Votre bailleur') into v_landlord;

  insert into email_outbox (user_id, kind, to_emails, subject, body_text, dedupe_key)
  values (u, 'invitation_locataire', array[lower(t.email)],
    'Votre espace locataire Immo-Zen',
    'Bonjour ' || coalesce(nullif(trim(coalesce(t.first_name, '') || ' ' || t.last_name), ''), '') || ',' || chr(10) || chr(10) ||
    v_landlord || ' vous ouvre un espace locataire sur Immo-Zen : vous y retrouverez vos quittances de loyer et les documents qu''il partage avec vous.' || chr(10) || chr(10) ||
    'Pour y accéder, ouvrez ce lien puis créez votre compte (ou connectez-vous) avec cette adresse e-mail : ' || lower(t.email) || chr(10) ||
    '{{APP_URL}}#/espace-locataire?code=' || v_code || chr(10) || chr(10) ||
    'Code d''invitation : ' || v_code || chr(10) ||
    'Ce code ne fonctionne qu''avec votre adresse e-mail. Si vous n''attendiez pas ce message, ignorez-le.' || chr(10) || chr(10) ||
    'Immo-Zen',
    'invitation:' || a.id || ':' || v_code);

  return jsonb_build_object('id', a.id, 'code', v_code, 'email', a.email, 'invited_at', a.invited_at, 'accepted_at', a.accepted_at);
end $$;

create or replace function public.iz_revoke_tenant_access(p_tenant uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Session expirée.' using errcode = '42501'; end if;
  update tenant_accounts set revoked_at = now(), code_hash = null, updated_at = now()
   where tenant_id = p_tenant and user_id = auth.uid();
  if not found then raise exception 'Aucun accès à révoquer pour ce locataire.' using errcode = 'P0002'; end if;
  -- invitation encore en file : elle ne part plus
  update email_outbox set status = 'annule'
   where user_id = auth.uid() and kind = 'invitation_locataire' and status = 'a_envoyer'
     and dedupe_key like 'invitation:' || (select id from tenant_accounts where tenant_id = p_tenant) || ':%';
end $$;

create or replace function public.iz_accept_tenant_invite(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid();
  v_email text;
  a tenant_accounts%rowtype;
begin
  if u is null then raise exception 'Connectez-vous pour accepter l''invitation.' using errcode = '42501'; end if;
  select lower(email) into v_email from auth.users where id = u;
  select * into a from tenant_accounts
   where code_hash = encode(sha256(convert_to(upper(trim(coalesce(p_code, ''))), 'UTF8')), 'hex') and revoked_at is null;
  if not found then raise exception 'Invitation invalide, expirée ou révoquée : demandez une nouvelle invitation à votre bailleur.' using errcode = 'P0002'; end if;
  if a.invited_at < now() - interval '30 days' then raise exception 'Invitation expirée (30 jours) : demandez une nouvelle invitation à votre bailleur.' using errcode = 'P0002'; end if;
  if a.email <> v_email then
    raise exception 'Cette invitation a été envoyée à une autre adresse e-mail : connectez-vous avec l''adresse qui a reçu l''invitation.' using errcode = '42501';
  end if;
  update tenant_accounts set account_user_id = u, accepted_at = now(), code_hash = null, updated_at = now() where id = a.id returning * into a;
  return jsonb_build_object('id', a.id, 'accepted_at', a.accepted_at);
end $$;

-- ---------------------------------------------------------------------
-- Lecture par le locataire : baux, quittances, documents partagés (lecture seule)
-- ---------------------------------------------------------------------
create or replace function public.iz__tenant_leases(p_account uuid)
returns table (account_id uuid, landlord uuid, tenant_id uuid, lease_id uuid)
language sql stable security definer set search_path = public as $$
  select a.id, a.user_id, a.tenant_id, lt.lease_id
    from tenant_accounts a join lease_tenants lt on lt.tenant_id = a.tenant_id and lt.user_id = a.user_id
   where a.account_user_id = p_account and a.accepted_at is not null and a.revoked_at is null
$$;

create or replace function public.iz_tenant_portal()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'Session expirée.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'tenant_id', a.tenant_id, 'accepted_at', a.accepted_at,
        'tenant_name', trim(coalesce(t.first_name, '') || ' ' || t.last_name),
        'leases', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', l.id, 'label', l.label, 'furnished', l.furnished, 'start_date', l.start_date, 'end_date', l.end_date,
            'rent_hc', l.rent_hc, 'charges_amount', l.charges_amount, 'charges_mode', l.charges_mode, 'payment_day', l.payment_day,
            'landlord_name', l.landlord_name, 'landlord_address', l.landlord_address,
            'property_title', p.title, 'property_address', concat_ws(' ', p.address, p.zip, p.city)) order by l.start_date desc)
            from leases l join properties p on p.id = l.property_id
           where l.id in (select lease_id from iz__tenant_leases(u) x where x.account_id = a.id)), '[]'::jsonb),
        'receipts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', r.id, 'lease_id', r.lease_id, 'kind', r.kind, 'number', r.number, 'issued_on', r.issued_on,
            'period_start', r.period_start, 'period_end', r.period_end, 'rent_amount', r.rent_amount, 'charges_amount', r.charges_amount,
            'paid_amount', r.paid_amount, 'payments', r.payments, 'tenant_names', r.tenant_names, 'landlord_name', r.landlord_name,
            'landlord_address', r.landlord_address, 'property_address', r.property_address, 'extra_lines', r.extra_lines,
            'charges_mode', l.charges_mode) order by r.period_start desc, r.issued_on desc)
            from receipts r join leases l on l.id = r.lease_id
           where r.cancelled_at is null and r.lease_id in (select lease_id from iz__tenant_leases(u) x where x.account_id = a.id)), '[]'::jsonb),
        'documents', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', d.id, 'title', d.title, 'category', d.category, 'mime_type', d.mime_type, 'size_bytes', d.size_bytes,
            'storage_path', d.storage_path, 'created_at', d.created_at, 'lease_id', d.lease_id) order by d.created_at desc)
            from documents d
           where d.user_id = a.user_id and d.shared_with_tenant
             and (d.tenant_id = a.tenant_id or d.lease_id in (select lease_id from iz__tenant_leases(u) x where x.account_id = a.id))), '[]'::jsonb)
      ) order by a.accepted_at)
        from tenant_accounts a join tenants t on t.id = a.tenant_id
       where a.account_user_id = u and a.accepted_at is not null and a.revoked_at is null), '[]'::jsonb));
end $$;

-- Fichier lisible par le locataire : document partagé de son bail ou à son nom
create or replace function public.iz_tenant_can_read(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from documents d join tenant_accounts a on a.user_id = d.user_id
     where d.storage_path = p_path and d.shared_with_tenant
       and a.account_user_id = auth.uid() and a.accepted_at is not null and a.revoked_at is null
       and (d.tenant_id = a.tenant_id
            or d.lease_id in (select lease_id from lease_tenants lt where lt.tenant_id = a.tenant_id and lt.user_id = a.user_id)))
$$;

drop policy if exists iz_documents_tenant_read on storage.objects;
create policy iz_documents_tenant_read on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.iz_tenant_can_read(name));

revoke all on function public.iz_invite_tenant(uuid), public.iz_revoke_tenant_access(uuid), public.iz_accept_tenant_invite(text),
  public.iz_tenant_portal(), public.iz_tenant_can_read(text), public.iz__tenant_leases(uuid) from public, anon;
grant execute on function public.iz_invite_tenant(uuid), public.iz_revoke_tenant_access(uuid), public.iz_accept_tenant_invite(text),
  public.iz_tenant_portal(), public.iz_tenant_can_read(text) to authenticated;

-- ---------------------------------------------------------------------
-- Offre Découverte : 30 jours, puis consultation seule sans abonnement
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.plan_tiers') is not null then
    alter table public.app_config alter column trial_tier set default 'decouverte';
    -- l'essai n'est plus une formule Patrimoine : c'est l'offre Découverte, limitée à 30 jours
    update public.app_config set trial_tier = 'decouverte', updated_at = now() where trial_tier = 'patrimoine';
  end if;
end $$;
update public.app_config set trial_days = 30, updated_at = now() where trial_days = 0;

-- Formule pendant l'essai : Découverte par défaut
do $$
begin
  if to_regprocedure('public.iz_admin_set_config(boolean,integer,text,text)') is not null then
    execute $f$
      create or replace function public.iz_admin_set_config(p_enforce boolean, p_trial_days int, p_support_email text, p_trial_tier text default 'decouverte')
      returns app_config language plpgsql security definer set search_path = public as $b$
      declare c app_config;
      begin
        perform iz_require_admin();
        if p_trial_tier is null or not exists (select 1 from plan_tiers where code = p_trial_tier) then raise exception 'Formule d''essai inconnue.'; end if;
        update app_config set enforce_subscription = p_enforce, trial_days = p_trial_days, support_email = nullif(trim(p_support_email), ''),
          trial_tier = p_trial_tier, updated_at = now(), updated_by = auth.uid()
        returning * into c;
        insert into admin_audit (admin_id, action, details) values (auth.uid(), 'configuration', to_jsonb(c));
        return c;
      end $b$;
    $f$;
  end if;
end $$;

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
  -- offre Découverte terminée, sans abonnement : consultation et export seulement
  return query select false, 'decouverte_terminee', v_created + make_interval(days => coalesce(c.trial_days, 0));
end $$;

-- Garde-fou « consultation seule » rétabli pour les comptes dont l'offre Découverte est terminée
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

notify pgrst, 'reload schema';
