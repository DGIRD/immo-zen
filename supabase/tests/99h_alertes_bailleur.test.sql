-- Tests SQL : alertes e-mail au propriétaire (révision IRL, échéance du bail), 27/11/2026.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

insert into auth.users (id, email, created_at) values ('f9b00000-0000-0000-0000-000000000001', 'alertes@example.test', now());
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f9b00000-0000-0000-0000-000000000001","role":"authenticated"}', true);
insert into public.properties (id, title, status) values ('f9b10000-0000-0000-0000-000000000001', 'T2 Alertes', 'acquis');
insert into public.leases (id, property_id, start_date, rent_hc, charges_amount, irl_enabled)
  values ('f9b20000-0000-0000-0000-000000000001', 'f9b10000-0000-0000-0000-000000000001', '2024-01-01', 800, 50, true);
reset role;

select public.iz_owner_alerts('2026-06-01');

select tests.ok((select count(*) = 1 from public.email_outbox where lease_id = 'f9b20000-0000-0000-0000-000000000001' and dedupe_key like 'alerte-fin-bail:%'),
  'échéance du bail vide : alerte deux mois avant la date limite du congé');
select tests.ok((select body_text like '%au plus tard le 30/06/2026%' and subject like '%31/12/2026%' from public.email_outbox where lease_id = 'f9b20000-0000-0000-0000-000000000001' and dedupe_key like 'alerte-fin-bail:%'),
  'échéance au 31/12/2026, congé au plus tard le 30/06/2026 (six mois avant)');
select public.iz_owner_alerts('2026-06-02');
select tests.ok((select count(*) = 1 from public.email_outbox where lease_id = 'f9b20000-0000-0000-0000-000000000001'), 'pas de doublon le lendemain');

select public.iz_owner_alerts('2026-12-10');
select tests.ok((select count(*) = 1 from public.email_outbox where dedupe_key = 'alerte-irl:f9b20000-0000-0000-0000-000000000001:2027-01-01'),
  'révision IRL : alerte un mois avant la date anniversaire (années non réclamées passées)');

update public.user_settings set rental_settings = jsonb_set(coalesce(rental_settings, '{}'), '{owner_alerts}', '{"irl": false, "fin_bail": false}')
 where user_id = 'f9b00000-0000-0000-0000-000000000001';
delete from public.email_outbox where lease_id = 'f9b20000-0000-0000-0000-000000000001';
select public.iz_owner_alerts('2026-06-01'); select public.iz_owner_alerts('2026-12-10');
select tests.ok((select count(*) = 0 from public.email_outbox where lease_id = 'f9b20000-0000-0000-0000-000000000001'), 'alertes désactivées dans Paramètres : aucun e-mail');

update public.user_settings set rental_settings = '{}' where user_id = 'f9b00000-0000-0000-0000-000000000001';
update public.leases set contract = '{"kind": "meuble"}' where id = 'f9b20000-0000-0000-0000-000000000001';
delete from public.email_outbox where lease_id = 'f9b20000-0000-0000-0000-000000000001';
select public.iz_owner_alerts('2026-08-15');
select tests.ok((select body_text like '%au plus tard le 30/09/2026%' and body_text like '%un an%' from public.email_outbox where lease_id = 'f9b20000-0000-0000-0000-000000000001' and dedupe_key like 'alerte-fin-bail:%'),
  'meublé : échéance annuelle au 31/12/2026, congé trois mois avant');
select tests.fails($q$ set local role authenticated; select public.iz_owner_alerts() $q$, 'fonction réservée au serveur');
rollback;
delete from auth.users where email = 'alertes@example.test';
select 'Tests SQL alertes bailleur passés' as fin;
