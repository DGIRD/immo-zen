-- Annulation de 20261021000200_alertes.sql
drop function if exists public.iz_ops_check();
delete from public.email_outbox where kind = 'alerte_exploitation';
alter table public.email_outbox drop constraint if exists email_outbox_user_check;
alter table public.email_outbox add constraint email_outbox_user_check check (user_id is not null or kind = 'contact_site');
alter table public.email_outbox drop constraint if exists email_outbox_kind_check;
alter table public.email_outbox add constraint email_outbox_kind_check
  check (kind in ('confirmation_paiement','quittance','relance','relance_a_valider','invitation_locataire','contact_site','facture_abonnement'));
drop table if exists public.ops_alerts;
