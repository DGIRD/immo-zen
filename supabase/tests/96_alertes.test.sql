-- Tests SQL : alertes d'exploitation (incidents signalés une seule fois, sans boucle sur leurs propres échecs).
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

delete from public.email_outbox where kind = 'alerte_exploitation';
-- incidents existants reconnus au départ
select public.iz_ops_check() as premier \gset
delete from public.email_outbox where kind = 'alerte_exploitation';

insert into auth.users (id, email, created_at) values ('fb000000-0000-0000-0000-000000000001', 'alerte@example.test', now());
insert into public.email_outbox (user_id, kind, to_emails, subject, body_text, dedupe_key, status, attempts, last_error)
  values ('fb000000-0000-0000-0000-000000000001', 'quittance', array['alerte@example.test'], 's', 'b', 'test-alerte-1', 'echec', 5, 'Adresse refusée');
insert into public.stripe_events (id, type, status, error) values ('evt_test_alerte', 'invoice.paid', 'erreur', 'Facture sans compte');

select tests.ok(public.iz_ops_check() = 2, 'alertes : deux nouveaux incidents détectés');
select tests.ok((select count(*) from public.email_outbox where kind = 'alerte_exploitation') = 1, 'alertes : un seul e-mail pour les deux');
select tests.ok((select body_text from public.email_outbox where kind = 'alerte_exploitation') like '%Adresse refusée%Facture sans compte%'
             or (select body_text from public.email_outbox where kind = 'alerte_exploitation') like '%Facture sans compte%Adresse refusée%', 'alertes : détail des incidents dans le message');
select tests.ok((select to_emails[1] from public.email_outbox where kind = 'alerte_exploitation') = 'contact@immo-zen.fr', 'alertes : envoyées à l''adresse de support');
select tests.ok(public.iz_ops_check() = 0, 'alertes : un incident n''est signalé qu''une fois');
update public.email_outbox set status = 'echec', attempts = 5 where kind = 'alerte_exploitation';
select tests.ok(public.iz_ops_check() = 0, 'alertes : l''échec d''une alerte ne déclenche pas d''alerte');
select tests.ok(not has_function_privilege('authenticated', 'public.iz_ops_check()', 'EXECUTE'), 'alertes : réservées au serveur');

delete from public.stripe_events where id = 'evt_test_alerte';
select 'Tests SQL alertes passés' as fin;
