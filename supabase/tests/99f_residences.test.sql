-- Tests SQL : résidence principale ou secondaire (20/11/2026).
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

insert into auth.users (id, email, created_at) values ('f9f00000-0000-0000-0000-000000000001', 'residence@example.test', now());
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f9f00000-0000-0000-0000-000000000001","role":"authenticated"}', true);

insert into public.properties (id, title, status, usage, occupation_status, tax_regime, loan_amount, loan_rate, loan_years, loan_start_date)
  values ('f9f10000-0000-0000-0000-000000000001', 'Maison Nantes', 'acquis', 'residence_principale', 'loue', 'micro_foncier', 300000, 3, 25, '2020-01-05');
select tests.ok((select occupation_status = 'usage_personnel' and tax_regime is null from public.properties where id = 'f9f10000-0000-0000-0000-000000000001'),
  'résidence principale : occupation « usage personnel », sans régime fiscal');
select tests.fails($q$ insert into public.properties (title, status, usage) values ('X', 'acquis', 'bureau') $q$, 'usage inconnu refusé');
select tests.ok((select usage = 'locatif' from public.properties where id = (select id from public.properties where title = 'Maison Nantes' limit 1)) is false, 'usage conservé');
insert into public.properties (id, title, status) values ('f9f10000-0000-0000-0000-000000000002', 'T2 Lyon', 'acquis');
select tests.ok((select usage from public.properties where id = 'f9f10000-0000-0000-0000-000000000002') = 'locatif', 'usage par défaut : locatif');
select tests.ok((public.iz_my_plan() -> 'usage' ->> 'owned')::int = 1, 'forfait : seule la location compte');
select tests.fails($q$ insert into public.leases (property_id, start_date, rent_hc, charges_amount) values ('f9f10000-0000-0000-0000-000000000001', '2026-01-01', 900, 0) $q$, 'bail refusé sur une résidence');
-- bascule résidence → locatif : le bail redevient possible
update public.properties set usage = 'locatif', occupation_status = 'vacant' where id = 'f9f10000-0000-0000-0000-000000000001';
insert into public.leases (property_id, start_date, rent_hc, charges_amount) values ('f9f10000-0000-0000-0000-000000000001', '2026-01-01', 900, 0);
select tests.ok((public.iz_my_plan() -> 'usage' ->> 'owned')::int = 2, 'repassée en locatif : comptée dans le forfait');
commit;

delete from auth.users where email = 'residence@example.test';
select 'Tests SQL résidences passés' as fin;
