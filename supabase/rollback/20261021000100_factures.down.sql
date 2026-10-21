-- Annulation de 20261021000100_factures.sql
delete from public.email_outbox where kind = 'facture_abonnement';
alter table public.email_outbox drop constraint if exists email_outbox_kind_check;
alter table public.email_outbox add constraint email_outbox_kind_check
  check (kind in ('confirmation_paiement','quittance','relance','relance_a_valider','invitation_locataire','contact_site'));
alter table public.email_outbox drop column if exists stripe_invoice_id;
drop table if exists public.billing_invoices;
