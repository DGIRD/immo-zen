-- Tests SQL : inscriptions du site (consentement, inscription directe, désinscription, alertes IRL).
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

-- calcul seul, sans case cochée : un e-mail avec le lien, aucune adresse conservée
begin;
set local role anon;
select public.iz_subscribe('Calcul@Example.test', 'calcul-cash-flow', false, null, '/outils/simulateur-cash-flow.html', 'prix=200000&loyer=900', null, false, null);
commit;
select tests.ok((select count(*) from public.site_subscribers where email = 'calcul@example.test') = 0, 'inscriptions : calcul seul, adresse non conservée');
select tests.ok((select body_text from public.email_outbox where kind = 'inscription_site' and to_emails[1] = 'calcul@example.test') like '%simulateur-cash-flow.html?prix=200000&loyer=900%', 'inscriptions : lien du calcul dans l''e-mail');
select tests.ok((select body_text from public.email_outbox where kind = 'inscription_site' and to_emails[1] = 'calcul@example.test') not like '%confirmer=%', 'inscriptions : pas de lien de confirmation sans case cochée');

-- paramètres suspects : ignorés (aucun texte libre)
begin;
set local role anon;
select public.iz_subscribe('piege@example.test', 'calcul-irl', false, null, null, 'x=<a href="http://evil">', null, false, null);
commit;
select tests.ok((select body_text from public.email_outbox where to_emails[1] = 'piege@example.test') not like '%evil%', 'inscriptions : paramètres non conformes écartés');

-- guide avec case cochée : conservée, active tout de suite, preuve enregistrée
begin;
set local role anon;
select public.iz_subscribe('lecteur@example.test', 'guide', true, 'J’accepte de recevoir les conseils et offres d’Immo-Zen.', '/', null, null, false, null);
commit;
select tests.ok((select marketing_consent and confirmed_at is not null and welcome_step = 1 and consent_at is not null and consent_page = '/' from public.site_subscribers where email = 'lecteur@example.test'), 'inscriptions : accord enregistré, actif sans confirmation');
select tests.ok((select body_text from public.email_outbox where to_emails[1] = 'lecteur@example.test') like '%guide-10-verifications-avant-achat.pdf%inscrit à la lettre%simulateur-cash-flow%desinscrire=%', 'inscriptions : guide, bienvenue et lien de désinscription');
select tests.ok((select body_text from public.email_outbox where to_emails[1] = 'lecteur@example.test') not like '%confirmer=%', 'inscriptions : aucun lien de confirmation');
-- deuxième demande (checklist) : document seul, pas de second message de bienvenue
begin;
set local role anon;
select public.iz_subscribe('lecteur@example.test', 'checklist', true, 'J’accepte.', '/', null, null, false, null);
commit;
select tests.ok((select count(*) from public.email_outbox where to_emails[1] = 'lecteur@example.test' and body_text like '%simulateur-cash-flow%') = 1, 'inscriptions : bienvenue une seule fois');

-- anonyme : aucune lecture directe de la table
begin;
set local role anon;
select tests.ok(not has_table_privilege('anon', 'public.site_subscribers', 'SELECT'), 'inscriptions : table illisible sans droit');
commit;

-- anciens liens de confirmation : toujours reconnus
select tests.ok(public.iz_confirm_subscription((select confirm_token from public.site_subscribers where email = 'lecteur@example.test')) = 'deja', 'inscriptions : ancien lien, déjà active');
select tests.ok(public.iz_confirm_subscription(gen_random_uuid()) = 'inconnu', 'inscriptions : lien inconnu');

-- alerte IRL : active tout de suite, envoyée le mois choisi, une seule fois par an
begin;
set local role anon;
select public.iz_subscribe('bailleur@example.test', 'calcul-irl', false, null, null, null, 3, false, null);
commit;
select tests.ok(public.iz_site_alerts('2027-02-10') = 0, 'alertes IRL : rien hors du mois choisi');
select tests.ok(public.iz_site_alerts('2027-03-01') = 1, 'alertes IRL : rappel le mois de révision, sans confirmation');
select tests.ok(public.iz_site_alerts('2027-03-15') = 0, 'alertes IRL : une seule fois par an');
select tests.ok(not has_function_privilege('anon', 'public.iz_site_alerts(date)', 'EXECUTE'), 'alertes IRL : réservées au serveur');

select tests.ok(public.iz_unsubscribe((select unsubscribe_token from public.site_subscribers where email = 'bailleur@example.test')) = 'desinscrit', 'inscriptions : désinscription');
select tests.ok((select irl_alert_month is null and unsubscribed_at is not null from public.site_subscribers where email = 'bailleur@example.test'), 'inscriptions : alerte coupée à la désinscription');
select tests.ok(public.iz_site_alerts('2028-03-01') = 0, 'alertes IRL : plus rien après désinscription');

-- lettre sans case cochée : rien
begin;
set local role anon;
select public.iz_subscribe('rien@example.test', 'lettre', false, null, null, null, null, false, null);
commit;
select tests.ok((select count(*) from public.email_outbox where to_emails[1] = 'rien@example.test') = 0, 'inscriptions : lettre sans accord, aucun envoi');

-- limite : 3 messages par adresse et par jour
do $$ begin
  perform public.iz_subscribe('limite@example.test', 'checklist', false, null, null, null, null, false, null);
  perform public.iz_subscribe('limite@example.test', 'checklist', false, null, null, null, null, false, null);
  perform public.iz_subscribe('limite@example.test', 'checklist', false, null, null, null, null, false, null);
  begin
    perform public.iz_subscribe('limite@example.test', 'checklist', false, null, null, null, null, false, null);
    raise exception 'limite non appliquée';
  exception when check_violation then null;
  end;
end $$;
select tests.ok(true, 'inscriptions : limite de 3 messages par jour et par adresse');

update public.email_outbox set status = 'envoye', created_at = now() - interval '31 days' where to_emails[1] = 'calcul@example.test';
select public.iz_site_alerts('2027-01-01');
select tests.ok((select count(*) from public.email_outbox where to_emails[1] = 'calcul@example.test') = 0, 'inscriptions : messages aux visiteurs effacés après 30 jours');
delete from public.email_outbox where kind in ('inscription_site', 'alerte_irl');
delete from public.site_subscribers;
select 'Tests SQL inscriptions passés' as fin;
