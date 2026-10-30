-- Tests SQL : mise à jour automatique des données de marché (30/10/2026).
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

grant select, insert, update, delete on public.rent_market_indicators, public.rent_caps, public.market_sync to service_role;
grant usage on schema tests to service_role;
grant execute on all functions in schema tests to service_role;

-- ---------- fonction serveur (rôle service) : remplacement par lots et en une transaction
begin;
set local role service_role;
select tests.ok(public.iz_market_replace_indicators(2025::smallint, 'maison',
  '[{"insee":"94033","libgeo":"Fontenay-sous-Bois","low":13.1,"mid":16.2,"high":19.9,"level":"commune","r2":0.6,"nb_obs_commune":90,"nb_obs_maille":300},
    {"insee":"94080","libgeo":"Vincennes","low":16,"mid":20,"high":24,"level":"maille","r2":null,"nb_obs_commune":null,"nb_obs_maille":800}]'::jsonb, true) = 2,
  'Carte des loyers : premier lot enregistré');
select tests.ok(public.iz_market_replace_indicators(2025::smallint, 'maison',
  '[{"insee":"94017","libgeo":"Champigny-sur-Marne","low":12,"mid":14,"high":17,"level":"commune","r2":0.55,"nb_obs_commune":60,"nb_obs_maille":60}]'::jsonb, false) = 1, 'Carte des loyers : lot suivant enregistré');
select tests.ok((select count(*) from public.rent_market_indicators where vintage = 2025 and segment = 'maison') = 3, 'Carte des loyers : lot suivant ajouté sans effacer le précédent');
select tests.ok(public.iz_market_replace_indicators(2025::smallint, 'maison',
  '[{"insee":"94033","libgeo":"Fontenay-sous-Bois","low":13.5,"mid":16.6,"high":20.3,"level":"commune","r2":0.6,"nb_obs_commune":95,"nb_obs_maille":300}]'::jsonb, true) = 1, 'Carte des loyers : nouvelle publication enregistrée');
select tests.ok((select count(*) from public.rent_market_indicators where vintage = 2025 and segment = 'maison') = 1
  and (select mid from public.rent_market_indicators where vintage = 2025 and segment = 'maison' and insee = '94033') = 16.6, 'Carte des loyers : nouvelle publication remplace le segment');
select tests.fails($q$ select public.iz_market_replace_indicators(2025::smallint, 'maison', '[{"insee":"94033","low":30,"mid":16,"high":20,"level":"commune"}]'::jsonb, true) $q$,
  'Carte des loyers : ligne incohérente refusée (tout le lot)');
select tests.ok((select count(*) from public.rent_market_indicators where vintage = 2025 and segment = 'maison') = 1, 'Carte des loyers : données conservées après un lot refusé');
insert into public.rent_caps (territory, insee, zone, rooms, ref, max, min, valid_from) values ('Paris', '75111', 'Ancien', 2, 20, 24, 14, '2025-07-01');
select tests.ok(public.iz_market_replace_caps('Paris',
  '[{"insee":"75111","zone":"Folie-Méricourt","rooms":2,"year_min":null,"year_max":1945,"furnished":false,"ref":28.1,"max":33.7,"min":19.7,"valid_from":"2026-07-01","valid_to":"2026-11-23"},
    {"insee":"75111","zone":"Folie-Méricourt","rooms":2,"year_min":null,"year_max":1945,"furnished":true,"ref":32,"max":38.4,"min":22.4,"valid_from":"2026-07-01","valid_to":"2026-11-23"}]'::jsonb) = 2, 'plafonds de Paris enregistrés');
select tests.ok((select count(*) from public.rent_caps where territory = 'Paris') = 2 and not exists (select 1 from public.rent_caps where territory = 'Paris' and zone = 'Ancien'), 'plafonds de Paris remplacés en une fois');
insert into public.market_sync (source, version, details) values ('paris:2026', '2026', '{"plafonds":2}');
commit;

-- ---------- abonné : aucune écriture, état des chargements invisible
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f9900000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select tests.fails($q$ select public.iz_market_replace_indicators(2025::smallint, 'maison', '[]'::jsonb, true) $q$, 'remplacement de la Carte refusé à un compte');
select tests.fails($q$ select public.iz_market_replace_caps('Paris', '[]'::jsonb) $q$, 'remplacement des plafonds refusé à un compte');
select tests.ok((select count(*) from public.market_sync) = 0, 'état des chargements invisible pour un non-administrateur');
select tests.fails($q$ insert into public.market_sync (source, version) values ('x', 'y') $q$, 'état des chargements non modifiable');
commit;

-- ---------- administrateur : lecture de l'état, date de fin de l'encadrement
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f9900000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select tests.ok((select version from public.market_sync where source = 'paris:2026') = '2026', 'état des chargements lisible par l''administrateur');
select tests.ok((select encadrement_end from public.market_config) = '2026-11-23', 'fin de l''encadrement : 23/11/2026 par défaut');
update public.market_config set encadrement_end = '2028-11-23';
select tests.ok((select encadrement_end from public.market_config) = '2028-11-23', 'fin de l''encadrement modifiable par l''administrateur');
commit;

select 'Tests SQL marché automatique passés' as fin;
