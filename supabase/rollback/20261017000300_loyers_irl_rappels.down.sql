-- Annule 20261017000300_loyers_irl_rappels.sql (l'historique des révisions est supprimé ; les loyers révisés restent).
create or replace function public.iz_issue_receipt(p_charge uuid, p_kind text default 'quittance')
returns public.receipts language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from rent_charges where id = p_charge and user_id = auth.uid()) then
    raise exception 'Échéance introuvable.' using errcode = 'insufficient_privilege';
  end if;
  return iz__issue_receipt(p_charge, p_kind);
end $$;
drop function if exists public.iz_issue_receipt_with_extras(uuid, uuid[]);
drop function if exists public.iz_charge_receipted(uuid);
alter table if exists public.receipts drop column if exists extra_lines;
drop function if exists public.iz_revise_rent(uuid, date, text, numeric, text, numeric);
drop table if exists public.lease_revisions;
alter table if exists public.leases drop column if exists irl_enabled, drop column if exists irl_base_label, drop column if exists irl_base_value, drop column if exists last_revision_on;
drop index if exists public.payments_import_ref_uq;
alter table if exists public.payments drop column if exists import_ref;
notify pgrst, 'reload schema';
