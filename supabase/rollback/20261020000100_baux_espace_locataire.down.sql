-- Annulation de 20261020000100_baux_espace_locataire.sql
-- Les contrats de bail enregistrés (leases.contract), le partage des documents et les accès locataires sont supprimés.
drop policy if exists iz_documents_tenant_read on storage.objects;
drop function if exists public.iz_tenant_can_read(text);
drop function if exists public.iz_tenant_portal();
drop function if exists public.iz__tenant_leases(uuid);
drop function if exists public.iz_accept_tenant_invite(text);
drop function if exists public.iz_revoke_tenant_access(uuid);
drop function if exists public.iz_invite_tenant(uuid);
update public.email_outbox set status = 'annule' where kind = 'invitation_locataire' and status in ('a_envoyer','en_cours');
delete from public.email_outbox where kind = 'invitation_locataire';
alter table public.email_outbox drop constraint if exists email_outbox_kind_check;
alter table public.email_outbox add constraint email_outbox_kind_check check (kind in ('confirmation_paiement','quittance','relance','relance_a_valider'));
drop table if exists public.tenant_accounts;
alter table public.documents drop column if exists shared_with_tenant;
alter table public.leases drop constraint if exists leases_contract_check;
alter table public.leases drop column if exists contract;

-- Offre Découverte : retour à l'essai Patrimoine et à la formule Découverte sans limite de durée
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
  if to_regclass('public.plan_tiers') is not null then
    alter table public.app_config alter column trial_tier set default 'patrimoine';
    update public.app_config set trial_tier = 'patrimoine' where trial_tier = 'decouverte';
    execute $f$
      create or replace function public.iz_admin_set_config(p_enforce boolean, p_trial_days int, p_support_email text, p_trial_tier text default 'patrimoine')
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
declare c app_config; s subscriptions; v_created timestamptz;
begin
  select * into c from app_config limit 1;
  if p_user is null then return query select false, 'anonyme', null::timestamptz; return; end if;
  if exists (select 1 from admins where user_id = p_user) then return query select true, 'administrateur', null::timestamptz; return; end if;
  select * into s from subscriptions where user_id = p_user;
  if s.status in ('active','trialing','past_due') then return query select true, 'abonnement_' || s.status, s.current_period_end; return; end if;
  if s.status = 'canceled' and s.current_period_end > now() then return query select true, 'resilie_fin_de_periode', s.current_period_end; return; end if;
  select created_at into v_created from auth.users where id = p_user;
  if v_created + make_interval(days => coalesce(c.trial_days, 0)) > now() then
    return query select true, 'essai', v_created + make_interval(days => c.trial_days); return;
  end if;
  if not coalesce(c.enforce_subscription, false) then return query select true, 'acces_libre', null::timestamptz; return; end if;
  return query select true, 'decouverte', null::timestamptz;
end $$;
notify pgrst, 'reload schema';
