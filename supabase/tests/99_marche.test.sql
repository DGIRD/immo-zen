-- Tests SQL : loyers de marché et taux de crédit (30/10/2026).
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

insert into auth.users (id, email, created_at) values
  ('f9900000-0000-0000-0000-000000000001', 'marche-admin@example.test', now()),
  ('f9900000-0000-0000-0000-000000000002', 'marche-abonne@example.test', now());
insert into public.admins (user_id) values ('f9900000-0000-0000-0000-000000000001');

-- ---------- administrateur : chargement des données de référence
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f9900000-0000-0000-0000-000000000001","role":"authenticated"}', true);
insert into public.rent_market_indicators (vintage, segment, insee, libgeo, low, mid, high, level, r2, nb_obs_commune, nb_obs_maille) values
  (2025, 'appart_t1t2', '93048', 'Montreuil', 18.5, 22.4, 27.1, 'commune', 0.71, 900, 900),
  (2025, 'appart', '93048', 'Montreuil', 16.9, 20.2, 24.3, 'commune', 0.74, 2100, 2100);
insert into public.rent_caps (territory, insee, zone, rooms, year_max, furnished, ref, max, min, valid_from, valid_to)
  values ('Est Ensemble', '93048', '1', 2, 1945, false, 20.5, 24.6, 14.35, '2026-06-01', '2026-11-23');
insert into public.loan_rate_benchmarks (effective_on, years, rate) values ('2026-10-01', 20, 3.55), ('2026-10-01', 25, 3.70);
update public.market_config set rent_wide_threshold = 0.5;
select tests.ok((select communes from public.iz_rent_indicator_stats() where segment = 'appart_t1t2') = 1, 'statistiques : communes chargées par segment');
select tests.fails($q$ insert into public.rent_market_indicators (vintage, segment, insee, low, mid, high, level) values (2025, 'appart', '93049', 30, 20, 25, 'commune') $q$, 'indicateurs : bas ≤ central ≤ haut');
select tests.fails($q$ insert into public.rent_caps (territory, insee, rooms, ref, max, min, valid_from) values ('X', '93048', 2, 30, 24, 14, '2026-06-01') $q$, 'plafonds : minoré ≤ référence ≤ majoré');
select tests.fails($q$ insert into public.rent_caps (territory, insee, rooms, ref, max, min, valid_from) values ('X', '93048', 5, 20, 24, 14, '2026-06-01') $q$, 'plafonds : 1 à 4 pièces');
select tests.fails($q$ insert into public.usury_rates (quarter, borrower, bracket, usury, valid_from, valid_to) values ('2027-1', 'particulier', '20_plus', 5, '2027-01-01', '2027-03-31') $q$, 'usure : trimestre AAAA-QN');
insert into public.usury_rates (quarter, borrower, bracket, average, usury, valid_from, valid_to) values ('2027-Q1', 'particulier', '20_plus', 4.10, 5.47, '2027-01-01', '2027-03-31');
commit;

-- ---------- abonné : lecture seule
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f9900000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select tests.ok((select count(*) from public.rent_market_indicators where insee = '93048') = 2, 'indicateurs : lisibles par tout compte connecté');
select tests.ok((select max from public.rent_caps where insee = '93048') = 24.6, 'plafonds : lisibles par tout compte connecté');
select tests.ok((select usury from public.usury_rates where quarter = '2026-Q4' and borrower = 'particulier' and bracket = '20_plus') = 5.40, 'usure : 4e trimestre 2026 chargé par la migration (5,40 % sur 20 ans et plus)');
select tests.ok((select count(*) from public.usury_rates where quarter = '2026-Q4' and borrower = 'personne_morale') = 3, 'usure : tranches des personnes morales (SCI)');
select tests.ok((select rent_wide_threshold from public.market_config) = 0.5, 'réglages : lisibles');
select tests.fails($q$ insert into public.rent_market_indicators (vintage, segment, insee, low, mid, high, level) values (2025, 'maison', '93048', 15, 18, 22, 'commune') $q$, 'indicateurs : écriture refusée à un non-administrateur');
select tests.fails($q$ insert into public.loan_rate_benchmarks (effective_on, years, rate) values ('2026-11-01', 20, 1) $q$, 'barème : écriture refusée à un non-administrateur');
update public.usury_rates set usury = 99 where quarter = '2026-Q4';
update public.market_config set furnished_coef = 2;
delete from public.rent_caps;
select tests.ok((select max(usury) from public.usury_rates where quarter = '2026-Q4') = 6.49 and (select furnished_coef from public.market_config) = 1.15
  and (select count(*) from public.rent_caps) = 1, 'usure, réglages, plafonds : non modifiables par un non-administrateur');

-- fourchette enregistrée avec le bien
insert into public.properties (id, title, status, property_type, surface, rooms, furnished, construction_year, rent_zone, market_rent)
  values ('f9910000-0000-0000-0000-000000000001', 'T2 Montreuil', 'repere', 'appartement', 45, 2, false, 1930, '1',
    '{"low":830,"mid":1008,"high":1187,"cap_hc":1107,"source":"auto","on":"2026-10-30"}');
select tests.ok((select (market_rent ->> 'cap_hc')::numeric from public.properties where id = 'f9910000-0000-0000-0000-000000000001') = 1107, 'bien : fourchette et plafond enregistrés');
select tests.fails($q$ update public.properties set market_rent = '[1,2]' where id = 'f9910000-0000-0000-0000-000000000001' $q$, 'bien : fourchette au format objet');
select tests.fails($q$ update public.properties set construction_year = 3000 where id = 'f9910000-0000-0000-0000-000000000001' $q$, 'bien : année de construction plausible');
commit;

-- ---------- rôle anonyme (site public) : aucune lecture
begin;
set local role anon;
select tests.fails($q$ select count(*) from public.rent_caps $q$, 'anonyme : aucun accès aux données de marché');
commit;

select 'Tests SQL marché passés' as fin;
