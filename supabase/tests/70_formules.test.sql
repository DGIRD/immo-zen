-- Tests SQL des formules : Découverte, Essentiel, Patrimoine, Pro ; pack fiscal ; accès manuel ; essai.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

insert into auth.users (id, email, created_at) values
  ('c0000000-0000-0000-0000-000000000001', 'carole@example.test', now() - interval '90 days'),
  ('c0000000-0000-0000-0000-000000000002', 'denis@example.test', now());

-- ---------- Contrôle désactivé (phase de lancement) : aucune limite
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select tests.ok((select public.iz_my_plan() ->> 'tier') = 'pro', 'lancement : toutes les fonctions sans abonnement');
insert into public.properties (title, status) select 'Lancement ' || g, 'repere' from generate_series(1, 6) g;
select tests.ok((select count(*) from public.properties) = 6, 'lancement : 6 biens en prospection acceptés');
delete from public.properties;
commit;

select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select public.iz_admin_set_config(true, 30, null);
select tests.ok((select enforce_subscription and trial_tier = 'patrimoine' from public.app_config), 'contrôle activé, essai en formule Patrimoine');
select set_config('request.jwt.claims', '', false);

-- ---------- Carole : compte de plus de 30 jours, sans abonnement → Découverte
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select tests.ok((select public.iz_my_plan() ->> 'tier') = 'decouverte', 'Découverte : formule d''un compte sans abonnement après l''essai');
select tests.ok((select (public.iz_my_plan() -> 'limits' ->> 'owned')::int = 1 and (public.iz_my_plan() -> 'limits' ->> 'prospects')::int = 5), 'Découverte : limites transmises à l''interface');
insert into public.properties (title, status) select 'Prospect ' || g, 'repere' from generate_series(1, 5) g;
select tests.ok((select count(*) from public.properties) = 5, 'Découverte : 5 biens en prospection');
select tests.fails($q$ insert into public.properties (title, status) values ('Prospect 6', 'repere') $q$, 'Découverte : 6e bien en prospection refusé');
update public.properties set status = 'abandonne' where title = 'Prospect 5';
insert into public.properties (title, status) values ('Prospect 6', 'visite');
select tests.ok(true, 'Découverte : un bien abandonné libère une place');
select tests.fails($q$ update public.properties set status = 'repere' where title = 'Prospect 5' $q$, 'Découverte : reprise d''un bien abandonné refusée quand la limite est atteinte');
insert into public.properties (title, status) values ('Studio détenu', 'acquis');
select tests.fails($q$ insert into public.properties (title, status) values ('Second bien détenu', 'acquis') $q$, 'Découverte : 2e bien détenu refusé');
select tests.fails($q$ update public.properties set status = 'acquis' where title = 'Prospect 1' $q$, 'Découverte : passage à « Acquis » refusé au-delà d''un bien détenu');
insert into public.scenarios (property_id, name) select id, 'S1' from public.properties where title = 'Prospect 1';
insert into public.scenarios (property_id, name) select id, 'S2' from public.properties where title = 'Prospect 1';
select tests.fails($q$ insert into public.scenarios (property_id, name) select id, 'S3' from public.properties where title = 'Prospect 1' $q$, 'Découverte : 3e scénario d''un bien refusé');
update public.scenarios set archived_at = now() where name = 'S2';
insert into public.scenarios (property_id, name) select id, 'S3' from public.properties where title = 'Prospect 1';
select tests.ok(true, 'Découverte : un scénario archivé libère une place');
insert into public.scenarios (name) values ('Simulation libre');
select tests.ok(true, 'Découverte : simulation sans bien acceptée');
select tests.fails($q$ insert into public.pro_contacts (kind, name) values ('agence', 'Agence du centre') $q$, 'Découverte : contacts immobiliers non inclus');
insert into public.documents (title, storage_path, mime_type, size_bytes)
  select 'Doc ' || g, 'c0000000-0000-0000-0000-000000000001/d' || g || '.pdf', 'application/pdf', 10485760 from generate_series(1, 10) g;
select tests.ok((select (public.iz_my_plan() -> 'usage' ->> 'storage_bytes')::bigint) = 104857600, 'Découverte : 100 Mo de documents');
select tests.fails($q$ insert into public.documents (title, storage_path, mime_type, size_bytes) values ('Doc 11', 'c0000000-0000-0000-0000-000000000001/d11.pdf', 'application/pdf', 1) $q$, 'Découverte : espace des documents limité à 100 Mo');
insert into public.leases (property_id, start_date, rent_hc) select id, current_date, 600 from public.properties where title = 'Studio détenu';
select tests.ok(true, 'Découverte : bail sans automatisation accepté');
select tests.fails($q$ update public.leases set receipt_auto_send = true $q$, 'Découverte : envoi automatique des quittances non inclus');
select tests.fails($q$ update public.leases set reminder_enabled = true $q$, 'Découverte : relances automatiques non incluses');
select tests.ok((select (public.iz_my_plan() -> 'features' ->> 'fiscal')::boolean) = false, 'Découverte : déclaration fiscale non incluse');
update public.plan_tiers set max_owned = 99 where code = 'decouverte';
select tests.ok((select max_owned from public.plan_tiers where code = 'decouverte') = 1, 'limites non modifiables par un non-administrateur');
select tests.fails($q$ select public.iz_grant_fiscal_pack('c0000000-0000-0000-0000-000000000001') $q$, 'pack fiscal : impossible de se l''attribuer');
commit;

-- E-mails automatiques non préparés en Découverte (tâche serveur)
insert into public.email_outbox (user_id, kind, to_emails, subject, body_text, dedupe_key)
values ('c0000000-0000-0000-0000-000000000001', 'confirmation_paiement', array['carole@example.test'], 'Loyer', 'Corps', 'test:formules:1');
select tests.ok((select count(*) from public.email_outbox where dedupe_key = 'test:formules:1') = 0, 'Découverte : e-mail mensuel de confirmation non préparé');
insert into public.reminders (user_id, lease_id, subject, body, created_by)
select user_id, id, 'Rappel', 'Corps', 'automatique' from public.leases where user_id = 'c0000000-0000-0000-0000-000000000001';
select tests.ok((select count(*) from public.reminders where user_id = 'c0000000-0000-0000-0000-000000000001') = 0, 'Découverte : relance automatique ignorée');

-- ---------- Abonnement Essentiel (écrit par le webhook)
insert into public.subscriptions (user_id, status, plan_code, stripe_customer_id, stripe_subscription_id, current_period_end, stripe_updated_at)
values ('c0000000-0000-0000-0000-000000000001', 'active', 'essentiel_annuel', 'cus_c1', 'sub_c1', now() + interval '1 year', 1);
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select tests.ok((select public.iz_my_plan() ->> 'tier') = 'essentiel', 'Essentiel : formule déduite du prix Stripe');
insert into public.properties (title, status) select 'Prospect E' || g, 'repere' from generate_series(1, 10) g;
select tests.ok(true, 'Essentiel : prospection illimitée');
update public.properties set status = 'acquis' where title in ('Prospect 1', 'Prospect 2');
select tests.ok((select count(*) from public.properties where status = 'acquis') = 3, 'Essentiel : 3 biens détenus');
select tests.fails($q$ update public.properties set status = 'acquis' where title = 'Prospect 3' $q$, 'Essentiel : 4e bien détenu refusé');
insert into public.pro_contacts (kind, name) values ('agence', 'Agence du centre');
select tests.ok(true, 'Essentiel : contacts immobiliers inclus');
update public.leases set receipt_auto_send = true;
select tests.ok(true, 'Essentiel : envoi automatique des quittances inclus');
select tests.ok((select (public.iz_my_plan() -> 'features' ->> 'fiscal')::boolean) = false, 'Essentiel : déclaration fiscale sans pack non incluse');
commit;
select public.iz_grant_fiscal_pack('c0000000-0000-0000-0000-000000000001');
select tests.ok(public.iz_feature('c0000000-0000-0000-0000-000000000001', 'fiscal'), 'pack fiscal : déclaration incluse pendant 12 mois');
select tests.ok((select fiscal_pack_until between now() + interval '11 months' and now() + interval '13 months' from public.subscriptions where user_id = 'c0000000-0000-0000-0000-000000000001'), 'pack fiscal : valable 12 mois');
select public.iz_grant_fiscal_pack('c0000000-0000-0000-0000-000000000001');
select tests.ok((select fiscal_pack_until > now() + interval '23 months' from public.subscriptions where user_id = 'c0000000-0000-0000-0000-000000000001'), 'pack fiscal : un second achat prolonge la validité');

-- ---------- Fin de l'abonnement : retour en Découverte, données conservées et modifiables
update public.subscriptions set status = 'canceled', current_period_end = now() - interval '1 day' where user_id = 'c0000000-0000-0000-0000-000000000001';
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select tests.ok((select public.iz_my_plan() ->> 'tier') = 'decouverte', 'fin d''abonnement : retour en Découverte');
update public.properties set title = title || ' (modifié)' where status = 'acquis';
select tests.ok((select count(*) from public.properties where title like '%(modifié)') = 3, 'fin d''abonnement : les 3 biens détenus restent modifiables');
update public.leases set rent_hc = 610;
select tests.ok((select rent_hc from public.leases limit 1) = 610, 'fin d''abonnement : un bail déjà automatisé reste modifiable');
select tests.fails($q$ insert into public.properties (title, status) values ('Nouveau', 'repere') $q$, 'fin d''abonnement : nouveau bien refusé au-delà des limites');
commit;

-- ---------- Accès manuel en formule Essentiel ; essai d'un nouveau compte
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select public.iz_admin_set_manual_access('c0000000-0000-0000-0000-000000000001', now() + interval '1 month', 'Partenaire', 'essentiel');
select tests.ok((select tier = 'essentiel' from public.iz_admin_users() where user_id = 'c0000000-0000-0000-0000-000000000001'), 'accès manuel : formule choisie par l''administrateur');
select tests.ok((select tier = 'patrimoine' from public.iz_admin_users() where user_id = 'c0000000-0000-0000-0000-000000000002'), 'essai : nouveau compte en formule Patrimoine');
select tests.fails($q$ select public.iz_admin_set_manual_access('c0000000-0000-0000-0000-000000000001', now() + interval '1 month', null, 'premium') $q$, 'accès manuel : formule inconnue refusée');
select tests.ok((select tier = 'pro' from public.iz_admin_users() where user_id = '22222222-2222-2222-2222-222222222222'), 'administrateur : formule Pro');
select public.iz_admin_set_config(false, 30, null);
select set_config('request.jwt.claims', '', false);

select 'Tests SQL des formules passés' as fin;
