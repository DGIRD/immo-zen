-- Tests SQL : séquence de bienvenue des inscrits (étapes 1 à 3, arrêt à la désinscription, comptes existants).
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

begin;
set local role anon;
select public.iz_subscribe('nouveau@example.test', 'guide', true, 'J’accepte.', '/', null, null, false, null);
select public.iz_subscribe('alerte@example.test', 'calcul-irl', false, null, null, null, 5, false, null);
select public.iz_subscribe('client@example.test', 'checklist', true, 'J’accepte.', '/', null, null, false, null);
commit;
select tests.ok((select welcome_step from public.site_subscribers where email = 'nouveau@example.test') = 1, 'bienvenue : étape 1 dès l''inscription');
select tests.ok((select count(*) from public.email_outbox where to_emails[1] = 'nouveau@example.test' and body_text like '%guide-10%inscrit à la lettre%desinscrire=%') = 1, 'bienvenue : étape 1 dans l''e-mail du guide, avec désinscription');
select tests.ok((select count(*) from public.email_outbox where kind = 'bienvenue' and to_emails[1] = 'nouveau@example.test') = 0, 'bienvenue : pas de second e-mail le même jour');
select tests.ok((select welcome_step from public.site_subscribers where email = 'alerte@example.test') = 0, 'bienvenue : rien pour une alerte seule (sans accord)');

-- dates de confirmation fixées pour le test
update public.site_subscribers set confirmed_at = '2027-01-01 10:00+01' where email = 'nouveau@example.test';
update public.site_subscribers set confirmed_at = '2027-03-01 10:00+01' where email = 'client@example.test';
select public.iz_site_alerts('2027-01-04');
select tests.ok((select welcome_step from public.site_subscribers where email = 'nouveau@example.test') = 1, 'bienvenue : rien avant J+4');
select public.iz_site_alerts('2027-01-05');
select tests.ok((select count(*) from public.email_outbox where kind = 'bienvenue' and to_emails[1] = 'nouveau@example.test' and subject = 'Combien vous coûterait une agence ?' and body_text like '%7 à 12 % TTC%') = 1, 'bienvenue : étape 2 à J+4');
select public.iz_site_alerts('2027-01-06');
select tests.ok((select count(*) from public.email_outbox where kind = 'bienvenue' and to_emails[1] = 'nouveau@example.test') = 1, 'bienvenue : pas de doublon');
select public.iz_site_alerts('2027-01-11');
select tests.ok((select count(*) from public.email_outbox where kind = 'bienvenue' and to_emails[1] = 'nouveau@example.test' and body_text like '%immo-zen.fr/app/%') = 1, 'bienvenue : étape 3 (essai) à J+10');
select public.iz_site_alerts('2027-02-11');
select tests.ok((select count(*) from public.email_outbox where kind = 'bienvenue' and to_emails[1] = 'nouveau@example.test') = 2, 'bienvenue : séquence terminée (étapes 2 et 3)');

-- adresse qui a déjà un compte : pas d'invitation à l'essai
insert into auth.users (id, email) values (gen_random_uuid(), 'client@example.test');
select public.iz_site_alerts('2027-03-05');
select public.iz_site_alerts('2027-03-11');
select tests.ok((select count(*) from public.email_outbox where kind = 'bienvenue' and to_emails[1] = 'client@example.test') = 1
  and (select welcome_step from public.site_subscribers where email = 'client@example.test') = 3, 'bienvenue : pas d’essai proposé à un client');

-- désinscription : la séquence s'arrête
begin;
set local role anon;
select public.iz_subscribe('parti@example.test', 'lettre', true, 'J’accepte.', '/', null, null, false, null);
commit;
select public.iz_unsubscribe((select unsubscribe_token from public.site_subscribers where email = 'parti@example.test'));
update public.site_subscribers set confirmed_at = '2027-01-01 10:00+01' where email = 'parti@example.test';
select public.iz_site_alerts('2027-01-20');
select tests.ok((select count(*) from public.email_outbox where kind = 'bienvenue' and to_emails[1] = 'parti@example.test') = 0, 'bienvenue : arrêt à la désinscription');

-- réinscription après désinscription : active, bienvenue de nouveau
begin;
set local role anon;
select public.iz_subscribe('parti@example.test', 'lettre', true, 'J’accepte.', '/', null, null, false, null);
commit;
select tests.ok((select unsubscribed_at is null and confirmed_at is not null and welcome_step = 1 from public.site_subscribers where email = 'parti@example.test'), 'bienvenue : réinscription active');
select tests.ok((select count(*) from public.email_outbox where to_emails[1] = 'parti@example.test' and subject = 'Bienvenue dans la lettre Immo-Zen') = 2, 'bienvenue : e-mail de la lettre à chaque inscription');

delete from auth.users where email = 'client@example.test';
delete from public.email_outbox where kind in ('inscription_site', 'alerte_irl', 'bienvenue');
delete from public.site_subscribers;
select 'Tests SQL bienvenue passés' as fin;
