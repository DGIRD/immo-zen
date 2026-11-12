-- Annulation de 20261112000100_inscriptions_site.sql
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin perform cron.unschedule('iz-alertes-site'); exception when others then null; end;
  end if;
end $$;
drop function if exists public.iz_site_alerts(date);
drop function if exists public.iz_unsubscribe(uuid);
drop function if exists public.iz_confirm_subscription(uuid);
drop function if exists public.iz_subscribe(text, text, boolean, text, text, text, int, boolean, text);
delete from public.email_outbox where kind in ('inscription_site', 'alerte_irl');
alter table public.email_outbox drop constraint if exists email_outbox_kind_check;
alter table public.email_outbox add constraint email_outbox_kind_check
  check (kind in ('confirmation_paiement','quittance','relance','relance_a_valider','invitation_locataire','contact_site','facture_abonnement','alerte_exploitation'));
alter table public.email_outbox drop constraint if exists email_outbox_user_check;
alter table public.email_outbox add constraint email_outbox_user_check check (user_id is not null or kind in ('contact_site', 'alerte_exploitation'));
drop table if exists public.site_subscribers;
notify pgrst, 'reload schema';
