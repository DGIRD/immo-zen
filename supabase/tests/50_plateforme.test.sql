-- Tests SQL du lot 3 : abonnements, contrôle d'accès, administration, accès support.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

-- Bob devient administrateur (uniquement possible en SQL)
insert into public.admins (user_id) values ('22222222-2222-2222-2222-222222222222');

-- ---------- Alice : utilisatrice ordinaire
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select tests.ok((select has_access and not is_admin and not enforce from public.iz_my_access()), 'accès : libre par défaut, contrôle désactivé');
select tests.fails($q$ select * from public.iz_admin_users() $q$, 'admin : liste des comptes refusée à un non-administrateur');
select tests.fails($q$ insert into public.admins (user_id) values ('11111111-1111-1111-1111-111111111111') $q$, 'admin : impossible de se nommer administrateur');
select tests.fails($q$ insert into public.subscriptions (user_id, status) values ('11111111-1111-1111-1111-111111111111', 'active') $q$, 'abonnement : impossible de s''attribuer un abonnement');
update public.plans set amount_cents = 1 where code = 'mensuel';
select tests.ok((select amount_cents from public.plans where code = 'mensuel') = 0, 'offres : tarif non modifiable par un non-administrateur');
select tests.ok((select count(*) from public.stripe_events) = 0 and (select count(*) from public.admin_audit) = 0, 'journal et événements invisibles');
select tests.fails($q$ insert into public.platform_leads (name) values ('X') $q$, 'prospects commerciaux réservés aux administrateurs');
select tests.fails($q$ insert into public.support_access (user_id, granted_until) values ('11111111-1111-1111-1111-111111111111', now() + interval '90 days') $q$,
  'accès support : 31 jours au plus');
commit;

-- ---------- Bob : administrateur
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select tests.ok((select count(*) from public.iz_admin_users()) >= 2, 'admin : liste des comptes');
select tests.ok((select is_admin from public.iz_my_access()), 'admin : reconnu');
update public.plans set amount_cents = 990, stripe_price_id = 'price_123abc', active = true where code = 'mensuel';
select tests.ok((select amount_cents from public.plans where code = 'mensuel') = 990, 'admin : tarif modifié');
select public.iz_admin_set_config(true, 0, 'support@immo-zen.test');
select tests.ok((select enforce_subscription from public.app_config), 'admin : contrôle d''accès activé');
select tests.fails($q$ select public.iz_admin_support_summary('11111111-1111-1111-1111-111111111111') $q$, 'support : refusé sans autorisation de l''abonné');
insert into public.platform_leads (name, email, source) values ('Agence Durand', 'contact@durand.test', 'salon');
select tests.ok((select count(*) from public.platform_leads) = 1, 'admin : prospect commercial créé');
commit;

-- ---------- Alice sans abonnement, contrôle activé, essai terminé
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select tests.ok((select not has_access and reason = 'decouverte_terminee' from public.iz_my_access()), 'sans abonnement, offre Découverte terminée : consultation seule');
select tests.ok((select public.iz_my_plan() ->> 'tier') = 'decouverte', 'sans abonnement : formule Découverte');
select tests.ok((select count(*) from public.properties) > 0, 'sans abonnement : consultation toujours possible');
update public.properties set title = title || ' modifié';
select tests.ok((select count(*) from public.properties where title like '% modifié') = 0, 'sans abonnement : modifications sans effet');
select tests.fails($q$ insert into public.properties (title, status) values ('Refusé', 'repere') $q$, 'sans abonnement : création refusée');
insert into public.support_access (user_id, granted_until) values ('11111111-1111-1111-1111-111111111111', now() + interval '7 days');
select tests.ok(true, 'accès support : autorisation donnée par l''abonnée');
commit;

-- ---------- Abonnement mis à jour par le serveur (webhook) puis accès offert
insert into public.subscriptions (user_id, status, plan_code, stripe_customer_id, stripe_subscription_id, current_period_end, stripe_updated_at)
values ('11111111-1111-1111-1111-111111111111', 'canceled', 'mensuel', 'cus_1', 'sub_1', now() + interval '10 days', 100);
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select tests.ok((select has_access and reason = 'resilie_fin_de_periode' from public.iz_my_access()), 'résiliation : accès jusqu''à la fin de la période payée');
insert into public.properties (title, status) values ('Créé pendant la période payée', 'repere');
select tests.ok(true, 'résiliation programmée : création encore possible');
commit;
update public.subscriptions set current_period_end = now() - interval '1 day' where user_id = '11111111-1111-1111-1111-111111111111';

begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select tests.ok((select tier = 'decouverte' from public.iz_admin_users() where user_id = '11111111-1111-1111-1111-111111111111'), 'expiration : retour en Découverte après la fin de période');
select public.iz_admin_set_manual_access('11111111-1111-1111-1111-111111111111', now() + interval '1 month', 'Geste commercial');
select tests.ok((select has_access and tier = 'pro' from public.iz_admin_users() where user_id = '11111111-1111-1111-1111-111111111111'), 'accès manuel offert par l''administrateur (formule Pro par défaut)');
select tests.ok((select (public.iz_admin_support_summary('11111111-1111-1111-1111-111111111111') ->> 'biens')::int > 0), 'support : résumé chiffré avec autorisation');
select tests.ok((select count(*) from public.admin_audit where action in ('acces_manuel', 'acces_support', 'configuration')) = 3, 'journal : actions d''administration tracées');
select public.iz_admin_set_config(false, 30, null);
commit;

select 'Tests SQL de la plateforme passés' as fin;
