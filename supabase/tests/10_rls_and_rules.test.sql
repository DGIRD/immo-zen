-- Tests SQL : reprise IDF Invest, isolation entre deux comptes, règles métier.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

create schema if not exists tests;
grant usage on schema tests to authenticated, anon;
create or replace function tests.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'ÉCHEC : %', label; end if;
  raise notice 'OK   %', label;
end $$;
grant execute on function tests.ok(boolean, text) to authenticated, anon;

-- Exécute une requête et vérifie qu'elle est refusée
create or replace function tests.fails(q text, label text) returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    raise notice 'OK   % (refusé : %)', label, sqlerrm;
    return;
  end;
  raise exception 'ÉCHEC : % (la requête aurait dû être refusée)', label;
end $$;
grant execute on function tests.fails(text, text) to authenticated, anon;

-- ===================== Reprise IDF Invest =====================
select tests.ok((select count(*) from public.properties) = 3, 'reprise : 3 simulations → 3 biens');
select tests.ok((select count(*) from public.scenarios where legacy_simulation_id is not null) = 3, 'reprise : 3 scénarios liés');
select tests.ok((select count(*) from public.properties where primary_scenario_id is null) = 0, 'reprise : chaque bien a son scénario principal');
select tests.ok((select count(*) from public.pro_contacts where user_id = '11111111-1111-1111-1111-111111111111' and kind = 'agence') = 1,
  'reprise : agence dédoublonnée sans tenir compte de la casse');
select tests.ok((select count(*) from public.pro_contacts where user_id = '11111111-1111-1111-1111-111111111111' and kind = 'agent') = 1,
  'reprise : agent dédoublonné par e-mail');
select tests.ok((select email from public.pro_contacts where kind = 'agent' and user_id = '11111111-1111-1111-1111-111111111111') = 'claire.martin@agence.test',
  'reprise : e-mail normalisé en minuscules');
select tests.ok((select count(*) from public.pro_contacts where user_id = '22222222-2222-2222-2222-222222222222') = 2,
  'reprise : contacts de Bruno séparés de ceux d''Alice (agence + notaire)');
select tests.ok((select status = 'archive' and status_before_archive = 'abandonne' from public.properties where legacy_ref = 'SIM-2026-0002'),
  'reprise : simulation archivée → bien archivé, statut d''origine conservé');
select tests.ok((select surface = 19.5 and dpe is null and listing_url is null and estimated_rent = 690
                   from public.properties where legacy_ref = 'SIM-2026-0002'),
  'reprise : valeurs invalides écartées, nombres « 19,5 » convertis');
select tests.ok((select estimated_rent = 1008 and status = 'visite_programmee' from public.properties where title = 'T2 Montreuil'),
  'reprise : loyer « Moyen » recalculé (42 m² × 24 €) et statut converti');
select tests.ok((select (inputs->>'notaryAmount')::numeric = 16125 and inputs->>'notaryMode' = 'amount' from public.scenarios s
                   join public.properties p on p.primary_scenario_id = s.id where p.title = 'T2 Montreuil'),
  'reprise : frais de notaire saisis conservés en montant');
select tests.ok((select count(*) from public.timeline_events where kind = 'migration') = 3, 'reprise : événement d''historique tracé');
select tests.ok((select migrated_properties = 0 from immozen_backup.migrate_idf_invest()), 'reprise : seconde exécution sans doublon');
select tests.ok((select count(*) from public.properties) = 3, 'reprise : toujours 3 biens après relance');
select tests.ok((select count(*) from immozen_backup.idf_simulations_20261013) = 3, 'sauvegarde : copie intégrale des simulations');
select tests.ok((select count(*) from public.simulations) = 3, 'tables de l''ancienne version intactes');

-- ===================== Isolation entre comptes =====================
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select tests.ok((select count(*) from public.properties) = 2, 'isolation : Alice voit ses 2 biens uniquement');
select tests.ok((select count(*) from public.pro_contacts) = 2, 'isolation : Alice voit ses 2 contacts uniquement');
select tests.ok((select count(*) from public.profiles) = 1, 'isolation : Alice ne voit que son profil');
select tests.fails($q$ select count(*) from immozen_backup.idf_simulations_20261013 $q$, 'isolation : sauvegarde inaccessible à un utilisateur');
select tests.fails($q$ select * from immozen_backup.migrate_idf_invest() $q$, 'isolation : fonction de reprise non exécutable par un utilisateur');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select tests.ok((select count(*) from public.properties) = 1, 'isolation : Bruno voit son seul bien');
with u as (update public.properties set title = 'piraté' where legacy_ref = 'SIM-2026-0002' returning 1)
select tests.ok((select count(*) from u) = 0, 'isolation : Bruno ne peut pas modifier un bien d''Alice');
with d as (delete from public.properties where title = 'T2 Montreuil' returning 1)
select tests.ok((select count(*) from d) = 0, 'isolation : Bruno ne peut pas supprimer un bien d''Alice');
select tests.fails($q$ insert into public.properties (user_id, title) values ('11111111-1111-1111-1111-111111111111', 'intrus') $q$,
  'isolation : Bruno ne peut pas créer un bien au nom d''Alice');
select tests.fails(format($q$ insert into public.scenarios (property_id, name) values (%L, 'intrus') $q$,
                          (select id from public.properties where title = 'Maison Melun')::text || 'x'),
  'isolation : identifiant invalide refusé');
commit;

-- Bruno tente de rattacher un scénario au bien d'Alice dont il aurait deviné l'identifiant
do $$
declare alice_property uuid;
begin
  select id into alice_property from public.properties where title = 'T2 Montreuil';
  perform set_config('test.alice_property', alice_property::text, false);
end $$;
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select tests.fails(format($q$ insert into public.scenarios (property_id, name) values (%L, 'intrus') $q$, current_setting('test.alice_property')),
  'isolation : scénario impossible sur le bien d''un autre compte');
select tests.fails(format($q$ insert into public.timeline_events (property_id, kind, summary) values (%L, 'note', 'intrus') $q$, current_setting('test.alice_property')),
  'isolation : note impossible sur le bien d''un autre compte');
commit;

begin;
set local role anon;
select tests.fails($q$ select count(*) from public.properties $q$, 'isolation : accès anonyme refusé');
commit;

-- ===================== Règles métier =====================
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

-- verrou optimiste
select set_config('test.v', (select version::text from public.properties where title = 'T2 Montreuil'), true);
with u as (update public.properties set next_action = 'Rappeler' where title = 'T2 Montreuil' and version = current_setting('test.v')::int returning version)
select tests.ok((select version from u) = current_setting('test.v')::int + 1, 'concurrence : mise à jour avec la version lue → version incrémentée');
with u as (update public.properties set next_action = 'Écrasement' where title = 'T2 Montreuil' and version = current_setting('test.v')::int returning 1)
select tests.ok((select count(*) from u) = 0, 'concurrence : version périmée → aucune ligne modifiée (conflit détecté)');

-- propriétaire immuable
update public.properties set user_id = '22222222-2222-2222-2222-222222222222' where title = 'T2 Montreuil';
select tests.ok((select user_id = '11111111-1111-1111-1111-111111111111' from public.properties where title = 'T2 Montreuil'),
  'sécurité : le propriétaire d''un bien ne peut pas être changé');

-- statut d'occupation refusé pour un bien non détenu
select tests.fails($q$ update public.properties set occupation_status = 'loue' where title = 'T2 Montreuil' $q$,
  'règle : pas de statut d''occupation pour un bien en prospection');

-- transfert vers Mes biens
create temp table before_transfer on commit drop as select id, (select count(*) from public.properties) as n from public.properties where title = 'T2 Montreuil';
update public.properties set status = 'acquis' where title = 'T2 Montreuil';
select tests.ok((select p.id = b.id from public.properties p, before_transfer b where p.title = 'T2 Montreuil'), 'transfert : même bien (aucune duplication)');
select tests.ok((select count(*) = b.n from public.properties, before_transfer b group by b.n), 'transfert : nombre de biens inchangé');
select tests.ok((select acquired_at = current_date and occupation_status = 'vacant' from public.properties where title = 'T2 Montreuil'),
  'transfert : date d''acquisition et statut d''occupation initialisés');
select tests.ok((select acquisition_snapshot->'inputs'->>'notaryAmount' = '16125' from public.properties where title = 'T2 Montreuil'),
  'transfert : photographie des hypothèses conservée');
select tests.ok((select count(*) from public.timeline_events e join public.properties p on p.id = e.property_id
                   where p.title = 'T2 Montreuil' and e.kind in ('migration','status_change','acquisition')) >= 2,
  'transfert : historique conservé et complété');
update public.scenarios set inputs = inputs || '{"price": 1}' where id = (select primary_scenario_id from public.properties where title = 'T2 Montreuil');
select tests.ok((select acquisition_snapshot->'inputs'->>'price' = '215000' from public.properties where title = 'T2 Montreuil'),
  'transfert : la photographie ne change pas si le scénario est modifié ensuite');

-- ajout direct d'un bien déjà détenu
insert into public.properties (title, status, ownership_mode) values ('Parking détenu', 'acquis', 'nom_propre');
select tests.ok((select occupation_status = 'vacant' and acquired_at is not null from public.properties where title = 'Parking détenu'),
  'ajout direct dans Mes biens');
insert into public.properties (title, status, ownership_mode, loan_start_date) values ('Crédit ancien', 'acquis', 'nom_propre', current_date - 400);
select tests.ok((select acquired_at = current_date - 400 from public.properties where title = 'Crédit ancien'),
  'ajout direct sans date : date d''acquisition = 1re échéance passée du crédit (ANO-014)');
insert into public.properties (title, status, ownership_mode, loan_start_date) values ('Crédit futur', 'acquis', 'nom_propre', current_date + 30);
select tests.ok((select acquired_at = current_date from public.properties where title = 'Crédit futur'),
  'ajout direct sans date, 1re échéance à venir : date du jour');

-- archivage / désarchivage
update public.properties set status = 'archive' where title = 'Maison Melun';
update public.properties set status = 'negociation' where title = 'Parking détenu' and false;
insert into public.properties (title, status) values ('À archiver', 'negociation');
update public.properties set status = 'archive' where title = 'À archiver';
select tests.ok((select status_before_archive = 'negociation' from public.properties where title = 'À archiver'), 'archivage : statut précédent mémorisé');
update public.properties set status = status_before_archive where title = 'À archiver';
select tests.ok((select status = 'negociation' and status_before_archive is null from public.properties where title = 'À archiver'), 'désarchivage');

-- historique : types système réservés au serveur
select tests.fails($q$ insert into public.timeline_events (property_id, kind, summary) select id, 'acquisition', 'faux' from public.properties limit 1 $q$,
  'historique : un utilisateur ne peut pas forger un événement système');
insert into public.timeline_events (property_id, kind, channel, summary) select id, 'exchange', 'telephone', 'Appel agence' from public.properties where title = 'À archiver';
select tests.ok((select count(*) from public.timeline_events where kind = 'exchange') = 1, 'historique : échange saisi');
select tests.fails($q$ update public.timeline_events set summary = 'modifié' $q$, 'historique : non modifiable');
commit;

-- ===================== Création de compte =====================
insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333', 'chloe@example.test');
select tests.ok((select count(*) from public.profiles where id = '33333333-3333-3333-3333-333333333333') = 1, 'compte : profil créé automatiquement');
select tests.ok((select count(*) from public.user_settings where user_id = '33333333-3333-3333-3333-333333333333') = 1, 'compte : paramètres créés automatiquement');

\echo 'Tous les tests SQL sont passés.'
