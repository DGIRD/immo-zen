-- Immo-Zen : factures d'abonnement et e-mails de confirmation.
--  * billing_invoices : factures Stripe payées (abonnement, renouvellement, changement de formule, pack fiscal),
--    enregistrées par le webhook, lisibles par leur seul titulaire (rubrique « Mes factures ») ;
--  * email_outbox : nouveau type « facture_abonnement » (confirmation + facture PDF jointe à l'envoi).
-- Annulation : supabase/rollback/20261021000100_factures.down.sql

create table if not exists public.billing_invoices (
  id text primary key check (id ~ '^in_'),
  user_id uuid not null references auth.users(id) on delete cascade,
  number text,
  invoice_date timestamptz not null,
  amount_paid_cents int not null default 0,
  currency text not null default 'eur',
  status text not null default 'paid',
  billing_reason text,
  description text,
  plan_code text,
  period_start timestamptz,
  period_end timestamptz,
  hosted_invoice_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists billing_invoices_user_idx on public.billing_invoices(user_id, invoice_date desc);
alter table public.billing_invoices enable row level security;
drop policy if exists billing_invoices_own on public.billing_invoices;
create policy billing_invoices_own on public.billing_invoices for select to authenticated using (user_id = auth.uid());
revoke all on public.billing_invoices from anon, authenticated;
grant select on public.billing_invoices to authenticated;

alter table public.email_outbox add column if not exists stripe_invoice_id text;
alter table public.email_outbox drop constraint if exists email_outbox_kind_check;
alter table public.email_outbox add constraint email_outbox_kind_check
  check (kind in ('confirmation_paiement','quittance','relance','relance_a_valider','invitation_locataire','contact_site','facture_abonnement'));

notify pgrst, 'reload schema';
