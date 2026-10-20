-- Tests SQL : corrections de la recette du 20/10/2026 (jeton de planification, motif d'annulation, droits du rôle anonyme).
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

select tests.ok(not has_function_privilege('anon', 'public.iz_issue_receipt(uuid, text)', 'EXECUTE'), 'anonyme : émission de quittance non exécutable');
select tests.ok(not has_function_privilege('anon', 'public.iz_cancel_receipt(uuid, text)', 'EXECUTE'), 'anonyme : annulation de quittance non exécutable');
select tests.ok(not has_function_privilege('anon', 'public.iz_is_admin()', 'EXECUTE'), 'anonyme : iz_is_admin non exécutable');
select tests.ok(has_function_privilege('anon', 'public.iz_submit_lead(text, text, text, text, text, text)', 'EXECUTE'), 'anonyme : formulaire du site toujours ouvert');
select tests.ok(has_function_privilege('authenticated', 'public.iz_issue_receipt(uuid, text)', 'EXECUTE'), 'compte connecté : émission de quittance conservée');
select tests.ok(has_function_privilege('authenticated', 'public.iz_my_plan()', 'EXECUTE'), 'compte connecté : formule consultable');
select tests.ok(not has_function_privilege('authenticated', 'public.iz_cron_token_ok(text)', 'EXECUTE'), 'jeton de planification : non vérifiable par un compte connecté');
select tests.ok(has_function_privilege('service_role', 'public.iz_cron_token_ok(text)', 'EXECUTE'), 'jeton de planification : vérifiable par le serveur');
select tests.ok(public.iz_cron_token_ok('nimporte-quel-jeton-assez-long') = false, 'jeton de planification : refusé sans coffre ou sans correspondance');
select tests.ok(public.iz_cron_token_ok('') = false and public.iz_cron_token_ok(null) = false, 'jeton de planification : jeton vide refusé');
select tests.ok((select proconfig::text from pg_proc where proname = 'iz_eur' and pronamespace = 'public'::regnamespace) like '%search_path%', 'iz_eur : search_path fixé');

-- motif d'annulation d'une échéance, par son propriétaire uniquement
insert into auth.users (id, email, created_at) values ('f9000000-0000-0000-0000-000000000001', 'motif@example.test', now());
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
insert into public.properties (id, title, status) values ('f9100000-0000-0000-0000-000000000001', 'Studio motif', 'acquis');
insert into public.leases (id, property_id, start_date, rent_hc, charges_amount) values ('f9300000-0000-0000-0000-000000000001', 'f9100000-0000-0000-0000-000000000001', '2026-01-01', 500, 20);
select public.iz_generate_rent_charges('f9300000-0000-0000-0000-000000000001', '2026-02-28');
update public.rent_charges set cancelled_at = now(), cancel_reason = 'Mois offert (travaux)' where lease_id = 'f9300000-0000-0000-0000-000000000001' and period_start = '2026-02-01';
select tests.ok((select cancel_reason from public.rent_charges where lease_id = 'f9300000-0000-0000-0000-000000000001' and period_start = '2026-02-01') = 'Mois offert (travaux)', 'échéance : motif d''annulation enregistré');
select tests.fails($q$ update public.rent_charges set cancel_reason = repeat('x', 501) where lease_id = 'f9300000-0000-0000-0000-000000000001' $q$, 'échéance : motif limité à 500 caractères');
commit;

select 'Tests SQL corrections passés' as fin;
