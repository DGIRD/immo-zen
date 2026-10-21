-- Tests SQL : factures d'abonnement (lecture par leur seul titulaire) et e-mail « facture_abonnement ».
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

insert into auth.users (id, email, created_at) values
  ('fa000000-0000-0000-0000-000000000001', 'abonne@example.test', now()),
  ('fa000000-0000-0000-0000-000000000002', 'autre@example.test', now());
-- écrit par le webhook (rôle serveur)
insert into public.billing_invoices (id, user_id, number, invoice_date, amount_paid_cents, billing_reason, description)
  values ('in_test_1', 'fa000000-0000-0000-0000-000000000001', 'A1-0001', now(), 9900, 'subscription_create', 'Abonnement Immo-Zen Essentiel (annuel)');
insert into public.email_outbox (user_id, kind, to_emails, subject, body_text, stripe_invoice_id, dedupe_key)
  values ('fa000000-0000-0000-0000-000000000001', 'facture_abonnement', array['abonne@example.test'], 'Bienvenue', 'Texte', 'in_test_1', 'facture:in_test_1');
select tests.ok((select count(*) from public.email_outbox where dedupe_key = 'facture:in_test_1') = 1, 'facture : e-mail de confirmation en file');
select tests.fails($q$ insert into public.email_outbox (user_id, kind, to_emails, subject, body_text, dedupe_key) values ('fa000000-0000-0000-0000-000000000001', 'facture_abonnement', array['abonne@example.test'], 'x', 'x', 'facture:in_test_1') $q$, 'facture : jamais deux e-mails pour la même facture');

begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"fa000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select tests.ok((select count(*) from public.billing_invoices) = 1, 'factures : visibles par leur titulaire');
select tests.fails($q$ insert into public.billing_invoices (id, user_id, invoice_date) values ('in_faux', 'fa000000-0000-0000-0000-000000000001', now()) $q$, 'factures : création impossible depuis l''application');
select tests.fails($q$ update public.billing_invoices set amount_paid_cents = 0 $q$, 'factures : modification impossible depuis l''application');
commit;
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"fa000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select tests.ok((select count(*) from public.billing_invoices) = 0, 'factures : invisibles pour un autre compte');
commit;
begin;
set local role anon;
select tests.fails($q$ select count(*) from public.billing_invoices $q$, 'factures : inaccessibles sans connexion');
commit;

select 'Tests SQL factures passés' as fin;
