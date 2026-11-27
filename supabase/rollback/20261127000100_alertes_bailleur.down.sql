do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'immozen-alertes-bailleur';
  end if;
end $$;
drop function if exists public.iz_owner_alerts(date);
delete from public.email_outbox where kind = 'alerte_bailleur';
alter table public.email_outbox drop constraint if exists email_outbox_kind_check;
alter table public.email_outbox add constraint email_outbox_kind_check
  check (kind in ('confirmation_paiement','quittance','relance','relance_a_valider','invitation_locataire','contact_site','facture_abonnement','alerte_exploitation','inscription_site','alerte_irl','bienvenue'));
