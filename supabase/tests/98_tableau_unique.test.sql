-- Tests SQL : Loyers et paiements, tableau unique (29/10/2026).
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

insert into auth.users (id, email, created_at) values ('f9800000-0000-0000-0000-000000000001', 'tableau@example.test', now());
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f9800000-0000-0000-0000-000000000001","role":"authenticated"}', true);
insert into public.properties (id, title, status) values ('f9810000-0000-0000-0000-000000000001', 'T2 Fontenay', 'acquis');
insert into public.leases (id, property_id, start_date, rent_hc, charges_amount, payment_day)
  values ('f9830000-0000-0000-0000-000000000001', 'f9810000-0000-0000-0000-000000000001', '2026-07-01', 900, 100, 5);

-- lignes depuis le début du bail (réglage par défaut)
select public.iz_generate_rent_charges('f9830000-0000-0000-0000-000000000001', '2026-09-30');
select tests.ok((select count(*) from public.rent_charges where lease_id = 'f9830000-0000-0000-0000-000000000001') = 3, 'lignes : une par mois depuis le début du bail (juillet à septembre)');

-- point de départ choisi : réglage général du compte
insert into public.user_settings (user_id) values ('f9800000-0000-0000-0000-000000000001') on conflict do nothing;
update public.user_settings set rental_settings = '{"ledger_start_mode":"date","ledger_start_date":"2026-08-15"}' where user_id = 'f9800000-0000-0000-0000-000000000001';
insert into public.leases (id, property_id, start_date, rent_hc, charges_amount) values ('f9830000-0000-0000-0000-000000000002', 'f9810000-0000-0000-0000-000000000001', '2026-01-01', 700, 0);
select public.iz_generate_rent_charges('f9830000-0000-0000-0000-000000000002', '2026-09-30');
select tests.ok((select min(period_start) from public.rent_charges where lease_id = 'f9830000-0000-0000-0000-000000000002') = '2026-08-01'
  and (select count(*) from public.rent_charges where lease_id = 'f9830000-0000-0000-0000-000000000002') = 2, 'point de départ : aucune ligne avant le mois choisi (août, mois complet)');
update public.user_settings set rental_settings = '{}' where user_id = 'f9800000-0000-0000-0000-000000000001';

-- paiement rattaché à un mois : premier jour du mois uniquement
select tests.fails($q$ insert into public.payments (lease_id, amount, paid_on, period_month) values ('f9830000-0000-0000-0000-000000000001', 10, '2026-07-03', '2026-07-15') $q$, 'paiement : mois de rattachement au premier du mois');
insert into public.payments (id, lease_id, amount, paid_on, period_month, source) values
  ('f9840000-0000-0000-0000-000000000001', 'f9830000-0000-0000-0000-000000000001', 1000, '2026-07-04', '2026-07-01', 'import'),
  ('f9840000-0000-0000-0000-000000000002', 'f9830000-0000-0000-0000-000000000001', 600, '2026-08-04', '2026-08-01', 'import'),
  ('f9840000-0000-0000-0000-000000000003', 'f9830000-0000-0000-0000-000000000001', 1400, '2026-09-03', '2026-09-01', 'import');
insert into public.payment_allocations (payment_id, charge_id, amount)
  select 'f9840000-0000-0000-0000-000000000001', id, 1000 from public.rent_charges where lease_id = 'f9830000-0000-0000-0000-000000000001' and period_start = '2026-07-01';
insert into public.payment_allocations (payment_id, charge_id, amount)
  select 'f9840000-0000-0000-0000-000000000002', id, 600 from public.rent_charges where lease_id = 'f9830000-0000-0000-0000-000000000001' and period_start = '2026-08-01';

-- reste dû d'août reporté dans « Autre somme due » de septembre
insert into public.rent_charges (id, lease_id, kind, period_start, period_end, due_date, rent_amount, charges_amount, label, carry_from)
  values ('f9850000-0000-0000-0000-000000000001', 'f9830000-0000-0000-0000-000000000001', 'report', '2026-09-01', '2026-09-30', '2026-09-05', 400, 0, 'Reste dû 08/2026', '2026-08-01');
select tests.fails($q$ insert into public.rent_charges (lease_id, kind, period_start, period_end, due_date, rent_amount, label)
  values ('f9830000-0000-0000-0000-000000000001', 'report', '2026-09-01', '2026-09-30', '2026-09-05', 10, 'doublon') $q$, 'report : un seul par bail et par mois');
update public.rent_charges set carried_to = 'f9850000-0000-0000-0000-000000000001'
 where lease_id = 'f9830000-0000-0000-0000-000000000001' and period_start = '2026-08-01' and kind = 'loyer';
select tests.ok(public.iz_charges_remaining(array(select id from public.rent_charges where lease_id = 'f9830000-0000-0000-0000-000000000001' and kind in ('loyer','report') and period_start <= '2026-09-01')) = 1400,
  'dette : le reste dû reporté ne compte qu''une fois (400 + 1000 en septembre)');
select tests.fails($q$ update public.rent_charges set excess_mode = 'autre' where lease_id = 'f9830000-0000-0000-0000-000000000001' and period_start = '2026-07-01' $q$, 'excédent : trop-perçu ou avance uniquement');

-- septembre réglé : d'abord le reste dû, puis le loyer ; quittance avec « Reste dû 08/2026 réglé »
insert into public.payment_allocations (payment_id, charge_id, amount) values ('f9840000-0000-0000-0000-000000000003', 'f9850000-0000-0000-0000-000000000001', 400);
insert into public.payment_allocations (payment_id, charge_id, amount)
  select 'f9840000-0000-0000-0000-000000000003', id, 1000 from public.rent_charges where lease_id = 'f9830000-0000-0000-0000-000000000001' and period_start = '2026-09-01' and kind = 'loyer';
select public.iz_issue_receipt_with_extras((select id from public.rent_charges where lease_id = 'f9830000-0000-0000-0000-000000000001' and period_start = '2026-09-01' and kind = 'loyer'),
  array['f9850000-0000-0000-0000-000000000001'::uuid]);
select tests.ok((select extra_lines -> 0 ->> 'label' from public.receipts where lease_id = 'f9830000-0000-0000-0000-000000000001' and kind = 'quittance') = 'Reste dû 08/2026 réglé'
  and (select paid_amount from public.receipts where lease_id = 'f9830000-0000-0000-0000-000000000001' and kind = 'quittance') = 1400, 'quittance : mention « Reste dû 08/2026 réglé », total 1 400 €');

-- confirmation de réception (colonne « Reçu »)
update public.rent_charges set received_at = now() where lease_id = 'f9830000-0000-0000-0000-000000000001' and period_start = '2026-07-01';
select tests.ok((select received_at is not null from public.rent_charges where lease_id = 'f9830000-0000-0000-0000-000000000001' and period_start = '2026-07-01'), 'réception confirmée enregistrée');
commit;

-- tâches quotidiennes : relance préparée sans compter la somme reportée
begin;
update public.leases set reminder_enabled = true, reminder_delay_days = 1 where id = 'f9830000-0000-0000-0000-000000000001';
select public.iz_daily_tasks('2026-09-20');
select tests.ok(not exists (select 1 from public.reminders where lease_id = 'f9830000-0000-0000-0000-000000000001'), 'relances : rien à relancer (août reporté, septembre réglé)');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select tests.ok(not exists (select 1 from public.rent_charges where kind = 'report' and lease_id = 'f9830000-0000-0000-0000-000000000001'), 'isolation : report invisible pour un autre compte');
commit;

select 'Tests SQL tableau unique passés' as fin;
