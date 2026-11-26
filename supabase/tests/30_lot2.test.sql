-- Tests SQL du lot 2 : gestion locative. Exécuté après 10_rls_and_rules.test.sql.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

-- Bien détenu et bien en prospection pour Alice
insert into public.properties (id, user_id, title, status, city) values
  ('aaaaaaaa-1111-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Studio loué', 'acquis', 'Lyon'),
  ('aaaaaaaa-1111-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Bien en prospection', 'repere', 'Lyon');

begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

select tests.fails($q$ insert into public.leases (property_id, start_date, rent_hc) values ('aaaaaaaa-1111-0000-0000-000000000002', '2026-01-01', 500) $q$,
  'bail : refusé sur un bien en prospection');

insert into public.tenants (id, first_name, last_name, email) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Léa', 'Martin', 'lea@example.test'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Hugo', 'Bernard', null);
insert into public.leases (id, property_id, start_date, rent_hc, charges_amount, payment_day, deposit_amount, landlord_name)
values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', '2026-01-15', 900, 60, 5, 900, 'Alice Propriétaire');
insert into public.lease_tenants (lease_id, tenant_id) values
  ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002');
select tests.ok((select count(*) from public.lease_tenants) = 2, 'colocation : deux titulaires sur le bail');

-- Échéances
select tests.ok(public.iz_generate_rent_charges('cccccccc-0000-0000-0000-000000000001', '2026-03-31') = 3, 'échéances : janvier à mars générées');
select tests.ok(public.iz_generate_rent_charges('cccccccc-0000-0000-0000-000000000001', '2026-03-31') = 0, 'échéances : relance sans doublon');
select tests.ok((select rent_amount = 493.55 and charges_amount = 32.90 and due_date = '2026-01-15' and period_start = '2026-01-15'
                   from public.rent_charges where period_start = '2026-01-15'), 'échéances : prorata 17/31 et échéance au début du bail');
select tests.ok((select rent_amount = 900 and charges_amount = 60 and due_date = '2026-02-05' from public.rent_charges where period_start = '2026-02-01'),
  'échéances : mois complet, échéance au jour de paiement');

-- Paiement partiel
insert into public.payments (id, lease_id, amount, paid_on) values ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 500, '2026-01-20');
insert into public.payment_allocations (payment_id, charge_id, amount)
  select 'dddddddd-0000-0000-0000-000000000001', id, 500 from public.rent_charges where period_start = '2026-01-15';
select tests.fails($q$ select public.iz_issue_receipt((select id from public.rent_charges where period_start = '2026-01-15'), 'quittance') $q$,
  'quittance : impossible pour une période partiellement réglée');
select tests.ok((select kind = 'recu' and paid_amount = 500 and number like 'R-%-0001'
                   from public.iz_issue_receipt((select id from public.rent_charges where period_start = '2026-01-15'), 'recu')),
  'reçu : émis pour un paiement partiel');

-- Un paiement réparti sur deux échéances, plafonds
insert into public.payments (id, lease_id, amount, paid_on, date_defaulted, source)
  values ('dddddddd-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001', 100, '2026-02-03', true, 'confirmation');
insert into public.payment_allocations (payment_id, charge_id, amount)
  select 'dddddddd-0000-0000-0000-000000000002', id, 26.45 from public.rent_charges where period_start = '2026-01-15';
insert into public.payment_allocations (payment_id, charge_id, amount)
  select 'dddddddd-0000-0000-0000-000000000002', id, 73.55 from public.rent_charges where period_start = '2026-02-01';
select tests.ok((select count(*) from public.payment_allocations where payment_id = 'dddddddd-0000-0000-0000-000000000002') = 2,
  'paiement : affecté à plusieurs échéances');
select tests.fails($q$ update public.payment_allocations set amount = 80 where payment_id = 'dddddddd-0000-0000-0000-000000000002' and amount = 73.55 $q$,
  'paiement : répartition supérieure au paiement refusée');
insert into public.payments (id, lease_id, amount, paid_on) values ('dddddddd-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000001', 2000, '2026-02-10');
select tests.fails($q$ insert into public.payment_allocations (payment_id, charge_id, amount)
                      select 'dddddddd-0000-0000-0000-000000000003', id, 1000 from public.rent_charges where period_start = '2026-02-01' $q$,
  'échéance : affectation supérieure au montant dû refusée');
select tests.fails($q$ update public.payments set amount = 50 where id = 'dddddddd-0000-0000-0000-000000000002' $q$,
  'paiement : montant inférieur à la répartition refusé');

-- Trop-perçu : reste non affecté, solde calculé
insert into public.payment_allocations (payment_id, charge_id, amount)
  select 'dddddddd-0000-0000-0000-000000000003', id, 886.45 from public.rent_charges where period_start = '2026-02-01';
select tests.ok((select sum(amount) from public.payments) - (select sum(rent_amount + charges_amount) from public.rent_charges) = 2600 - 2446.45,
  'solde : 2 600 € encaissés − 2 446,45 € dus = 153,55 € de trop-perçu');

-- Quittance : une seule, protégée
select tests.ok((select number like 'Q-%-0001' and paid_amount = 526.45 and tenant_names = 'Hugo Bernard, Léa Martin' and jsonb_array_length(payments) = 2
                   from public.iz_issue_receipt((select id from public.rent_charges where period_start = '2026-01-15'), 'quittance')),
  'quittance : émise pour une période intégralement réglée, avec titulaires et paiements');
select public.iz_issue_receipt((select id from public.rent_charges where period_start = '2026-01-15'), 'quittance');
select tests.ok((select count(*) from public.receipts where kind = 'quittance') = 1, 'quittance : pas de doublon');
select tests.fails($q$ insert into public.receipts (user_id, lease_id, charge_id, kind, number, issued_on, period_start, period_end, rent_amount, charges_amount, paid_amount, tenant_names)
                      select user_id, lease_id, id, 'quittance', 'X', current_date, period_start, period_end, 0, 0, 0, 'x' from public.rent_charges limit 1 $q$,
  'quittance : création directe par le navigateur interdite');
select tests.fails($q$ delete from public.payments where id = 'dddddddd-0000-0000-0000-000000000001' $q$,
  'quittance : suppression d''un paiement couvert refusée');
select tests.fails($q$ update public.rent_charges set cancelled_at = now() where period_start = '2026-01-15' $q$,
  'échéance réglée : annulation refusée');
select tests.fails($q$ select public.iz_cancel_receipt((select id from public.receipts where kind = 'quittance'), '') $q$, 'quittance : motif d''annulation obligatoire');
select public.iz_cancel_receipt((select id from public.receipts where kind = 'quittance'), 'Erreur de période');
select tests.ok((select number like 'Q-%-0002' from public.iz_issue_receipt((select id from public.rent_charges where period_start = '2026-01-15'), 'quittance')),
  'quittance : nouvelle émission après annulation, numéro suivant');

-- Envoi au locataire : file d'e-mails, une seule fois
select public.iz_queue_receipt_email((select id from public.receipts where kind = 'quittance' and cancelled_at is null));
select public.iz_queue_receipt_email((select id from public.receipts where kind = 'quittance' and cancelled_at is null));
select tests.ok((select count(*) = 1 and bool_and(to_emails = array['lea@example.test']) from public.email_outbox where kind = 'quittance'),
  'envoi : une seule mise en file, aux seuls locataires ayant un e-mail');
select tests.ok((select send_status = 'a_envoyer' from public.receipts where kind = 'quittance' and cancelled_at is null), 'envoi : statut « à envoyer »');
-- Renvoi (26/11/2026) : refusé tant qu'un envoi est en attente ; après envoi, renvoi à l'adresse actuelle de la fiche locataire
select tests.fails($q$ select public.iz_resend_receipt_email((select id from public.receipts where kind = 'quittance' and cancelled_at is null)) $q$,
  'renvoi : refusé si un envoi est déjà en attente');
reset role;
update public.email_outbox set status = 'envoye', sent_at = now() where kind = 'quittance';
update public.receipts set send_status = 'envoye', sent_at = now() where kind = 'quittance' and cancelled_at is null;
update public.tenants set email = 'lea.nouvelle@example.test' where email = 'lea@example.test';
set local role authenticated;
select public.iz_resend_receipt_email((select id from public.receipts where kind = 'quittance' and cancelled_at is null));
select tests.ok((select count(*) = 2 from public.email_outbox where kind = 'quittance'), 'renvoi : nouvel envoi mis en file');
select tests.ok((select to_emails = array['lea.nouvelle@example.test'] and body_text like '%de nouveau%' from public.email_outbox where kind = 'quittance' and status = 'a_envoyer'),
  'renvoi : adresse actuelle du locataire, texte de renvoi');
select tests.ok((select send_status = 'a_envoyer' and tenant_emails = array['lea.nouvelle@example.test'] from public.receipts where kind = 'quittance' and cancelled_at is null),
  'renvoi : statut « à envoyer », adresse du document mise à jour');
reset role;
update public.email_outbox set status = 'envoye' where kind = 'quittance';
update public.email_outbox set created_at = now() - interval '2 hours' where kind = 'quittance';
insert into public.email_outbox (user_id, kind, to_emails, subject, body_text, receipt_id, dedupe_key, status)
  select user_id, 'quittance', to_emails, subject, body_text, receipt_id, dedupe_key || ':t' || g, 'envoye' from public.email_outbox, generate_series(1, 3) g
   where kind = 'quittance' and dedupe_key not like '%renvoi%';
set local role authenticated;
select tests.fails($q$ select public.iz_resend_receipt_email((select id from public.receipts where kind = 'quittance' and cancelled_at is null)) $q$,
  'renvoi : 5 envois au plus par 24 heures');
reset role;
delete from public.email_outbox where dedupe_key like '%:t_';
update public.tenants set email = 'lea@example.test' where email = 'lea.nouvelle@example.test';
set local role authenticated;
select tests.fails($q$ insert into public.email_outbox (user_id, kind, to_emails, subject, body_text, dedupe_key)
                      values (auth.uid(), 'relance', array['x@y.z'], 's', 'b', 'k') $q$, 'e-mails : écriture directe interdite');
select tests.fails($q$ select count(*) from public.job_runs $q$, 'journal des tâches : inaccessible à un utilisateur');
select tests.fails($q$ select public.iz_daily_tasks('2026-03-01') $q$, 'tâches quotidiennes : non exécutables par un utilisateur');

-- Dépôt de garantie séparé
insert into public.deposit_movements (lease_id, kind, amount, occurred_on) values ('cccccccc-0000-0000-0000-000000000001', 'encaissement', 900, '2026-01-15');
select tests.ok((select sum(amount) from public.payments) = 2600, 'dépôt de garantie : distinct des loyers encaissés');

-- Relances
select tests.fails($q$ insert into public.reminders (lease_id, subject, body, status) values ('cccccccc-0000-0000-0000-000000000001', 's', 'b', 'a_envoyer') $q$,
  'relance : création directement « à envoyer » interdite');
insert into public.reminders (id, lease_id, subject, body, recipients, charge_ids)
  select 'eeeeeeee-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'Rappel', 'Bonjour', array['lea@example.test'], array_agg(id)
    from public.rent_charges where period_start = '2026-03-01';
select tests.ok((select status = 'a_envoyer' from public.iz_queue_reminder('eeeeeeee-0000-0000-0000-000000000001')), 'relance : envoi après validation');
select tests.fails($q$ update public.reminders set body = 'modifié' where id = 'eeeeeeee-0000-0000-0000-000000000001' $q$, 'relance : non modifiable une fois envoyée');
insert into public.reminders (id, lease_id, subject, body, recipients, charge_ids)
  select 'eeeeeeee-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001', 'Rappel', 'Bonjour', array['lea@example.test'], array_agg(id)
    from public.rent_charges where period_start = '2026-01-15';
select tests.ok((select status = 'annule' from public.iz_queue_reminder('eeeeeeee-0000-0000-0000-000000000002')), 'relance : annulée si la dette est déjà réglée');

-- Fin de bail avancée : échéances futures non réglées annulées
update public.leases set end_date = '2026-02-28' where id = 'cccccccc-0000-0000-0000-000000000001';
select tests.ok((select cancelled_at is not null from public.rent_charges where period_start = '2026-03-01'), 'fin de bail : échéance de mars annulée');

-- Documents : chemin dans le dossier de l'utilisateur
select tests.fails($q$ insert into public.documents (title, storage_path, mime_type, size_bytes) values ('x', '22222222-2222-2222-2222-222222222222/a/x.pdf', 'application/pdf', 10) $q$,
  'documents : chemin hors du dossier de l''utilisateur refusé');
select tests.fails($q$ insert into public.documents (title, storage_path, mime_type, size_bytes) values ('x', '11111111-1111-1111-1111-111111111111/a/x.exe', 'application/x-msdownload', 10) $q$,
  'documents : type de fichier non autorisé refusé');
select tests.fails($q$ insert into public.documents (title, storage_path, mime_type, size_bytes) values ('x', '11111111-1111-1111-1111-111111111111/a/x.pdf', 'application/pdf', 20000000) $q$,
  'documents : fichier de plus de 10 Mo refusé');
insert into public.documents (id, property_id, title, storage_path, mime_type, size_bytes)
  values ('ffffffff-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 'Bail signé', '11111111-1111-1111-1111-111111111111/ffffffff-0000-0000-0000-000000000001/bail.pdf', 'application/pdf', 1000);
insert into storage.objects (bucket_id, name) values ('documents', '11111111-1111-1111-1111-111111111111/ffffffff-0000-0000-0000-000000000001/bail.pdf');
select tests.ok((select count(*) from storage.objects) = 1, 'stockage : dépôt dans son propre dossier');

-- Dépenses
insert into public.expenses (property_id, expense_date, amount, category, nature, recoverable_amount, payment_status, paid_on)
  values ('aaaaaaaa-1111-0000-0000-000000000001', '2026-02-01', 1200, 'taxe_fonciere', 'charge', 150, 'paye', '2026-02-01');
select tests.fails($q$ insert into public.expenses (property_id, expense_date, amount, category, recoverable_amount) values ('aaaaaaaa-1111-0000-0000-000000000001', '2026-02-01', 100, 'autre', 200) $q$,
  'dépense : part récupérable supérieure au montant refusée');
select tests.fails($q$ insert into public.expenses (property_id, expense_date, amount, category, payment_status) values ('aaaaaaaa-1111-0000-0000-000000000001', '2026-02-01', 100, 'autre', 'paye') $q$,
  'dépense : date de paiement obligatoire si payée');
commit;

-- ===================== Isolation : Bruno =====================
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select tests.ok((select count(*) from public.leases) + (select count(*) from public.rent_charges) + (select count(*) from public.payments)
              + (select count(*) from public.receipts) + (select count(*) from public.email_outbox) + (select count(*) from public.tenants)
              + (select count(*) from public.expenses) + (select count(*) from public.documents) = 0,
  'isolation : Bruno ne voit aucune donnée locative d''Alice');
select tests.fails($q$ select public.iz_issue_receipt('00000000-0000-0000-0000-000000000000'::uuid, 'recu') $q$, 'isolation : quittance impossible hors de son compte');
select tests.fails($q$ select public.iz_generate_rent_charges('cccccccc-0000-0000-0000-000000000001', '2026-12-31') $q$, 'isolation : génération sur le bail d''un autre refusée');
select tests.fails($q$ insert into public.payments (lease_id, amount, paid_on) values ('cccccccc-0000-0000-0000-000000000001', 10, '2026-01-01') $q$,
  'isolation : paiement sur le bail d''un autre refusé');
select tests.fails($q$ insert into storage.objects (bucket_id, name) values ('documents', '11111111-1111-1111-1111-111111111111/x/intrus.pdf') $q$,
  'isolation : dépôt dans le dossier d''un autre refusé');
select tests.ok((select count(*) from storage.objects) = 0, 'isolation : fichiers d''Alice invisibles');
commit;

-- ===================== Envoi automatique des quittances =====================
insert into public.tenants (id, user_id, last_name, email) values ('bbbbbbbb-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'Durand', 'durand@example.test');
insert into public.leases (id, user_id, property_id, start_date, rent_hc, charges_amount, payment_day, receipt_auto_send, owner_confirmation_email, reminder_enabled, reminder_delay_days, landlord_name)
values ('cccccccc-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-1111-0000-0000-000000000001', '2026-03-01', 700, 50, 5, true, true, true, 5, 'Alice');
insert into public.lease_tenants (lease_id, tenant_id, user_id) values ('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111');

begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select public.iz_generate_rent_charges('cccccccc-0000-0000-0000-000000000002', '2026-04-30');
insert into public.payments (id, lease_id, amount, paid_on) values ('dddddddd-0000-0000-0000-000000000010', 'cccccccc-0000-0000-0000-000000000002', 300, '2026-03-02');
insert into public.payment_allocations (payment_id, charge_id, amount)
  select 'dddddddd-0000-0000-0000-000000000010', id, 300 from public.rent_charges where lease_id = 'cccccccc-0000-0000-0000-000000000002' and period_start = '2026-03-01';
select tests.ok((select count(*) from public.receipts where lease_id = 'cccccccc-0000-0000-0000-000000000002') = 0, 'automatique : aucune quittance pour un paiement partiel');
insert into public.payments (id, lease_id, amount, paid_on) values ('dddddddd-0000-0000-0000-000000000011', 'cccccccc-0000-0000-0000-000000000002', 450, '2026-03-05');
insert into public.payment_allocations (payment_id, charge_id, amount)
  select 'dddddddd-0000-0000-0000-000000000011', id, 450 from public.rent_charges where lease_id = 'cccccccc-0000-0000-0000-000000000002' and period_start = '2026-03-01';
select tests.ok((select count(*) = 1 and bool_and(send_status = 'a_envoyer') from public.receipts where lease_id = 'cccccccc-0000-0000-0000-000000000002' and kind = 'quittance'),
  'automatique : quittance émise et mise en file une fois la période réglée');
select tests.ok((select count(*) from public.email_outbox where lease_id = 'cccccccc-0000-0000-0000-000000000002' and kind = 'quittance') = 1, 'automatique : un seul e-mail');
commit;

-- ===================== Tâches quotidiennes (serveur) =====================
select tests.ok((select (public.iz_daily_tasks('2026-04-06') ->> 'confirmations')::int >= 1), 'quotidien : e-mail de confirmation au propriétaire pour avril impayé');
select tests.ok((select count(*) from public.email_outbox where kind = 'confirmation_paiement' and to_emails = array['alice@example.test']) = 1,
  'quotidien : envoyé à l''adresse du propriétaire');
select public.iz_daily_tasks('2026-04-06');
select tests.ok((select count(*) from public.email_outbox where kind = 'confirmation_paiement') = 1, 'quotidien : pas de doublon à la relance de la tâche');
select tests.ok((select count(*) from public.payments where lease_id = 'cccccccc-0000-0000-0000-000000000002') = 2,
  'quotidien : l''absence de réponse ne crée aucun paiement');
select public.iz_daily_tasks('2026-04-12');
select tests.ok((select count(*) = 1 and bool_and(status = 'brouillon' and created_by = 'automatique' and body like '%750,00 €%' and recipients = array['durand@example.test'])
                   from public.reminders where lease_id = 'cccccccc-0000-0000-0000-000000000002'),
  'quotidien : relance préparée en brouillon après le délai, avec montant et destinataire');
select tests.ok((select count(*) from public.email_outbox where kind = 'relance_a_valider') = 1, 'quotidien : propriétaire prévenu qu''une relance attend sa validation');
select tests.ok((select count(*) from public.email_outbox where kind = 'relance') = 1, 'quotidien : aucune relance envoyée au locataire sans validation (seule la relance validée plus haut)');
select public.iz_daily_tasks('2026-04-13');
select tests.ok((select count(*) from public.reminders where lease_id = 'cccccccc-0000-0000-0000-000000000002') = 1, 'quotidien : pas de nouvelle relance avant le délai suivant');
select tests.ok((select count(*) >= 2 from public.job_runs where job = 'daily' and status = 'ok'), 'quotidien : exécutions journalisées');

-- Règlement : la relance préparée est arrêtée
insert into public.payments (id, user_id, lease_id, amount, paid_on) values ('dddddddd-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000002', 750, '2026-04-14');
insert into public.payment_allocations (user_id, payment_id, charge_id, amount)
  select '11111111-1111-1111-1111-111111111111', 'dddddddd-0000-0000-0000-000000000012', id, 750 from public.rent_charges where lease_id = 'cccccccc-0000-0000-0000-000000000002' and period_start = '2026-04-01';
select public.iz_daily_tasks('2026-04-15');
select tests.ok((select bool_and(status = 'annule') from public.reminders where lease_id = 'cccccccc-0000-0000-0000-000000000002'), 'quotidien : relance arrêtée une fois la dette réglée');
select tests.ok((select bool_and(status = 'annule') from public.email_outbox where kind = 'relance_a_valider'), 'quotidien : notification de relance annulée');

-- File d'e-mails (rôle serveur) : réservation, échec avec nouvel essai, succès
select tests.ok((select count(*) >= 1 from public.iz_claim_outbox(50)), 'file : messages réservés pour envoi');
select public.iz_outbox_result(id, false, 'Fournisseur indisponible') from public.email_outbox where kind = 'quittance' and charge_id = (select id from public.rent_charges where lease_id = 'cccccccc-0000-0000-0000-000000000002' and period_start = '2026-03-01');
select tests.ok((select status = 'a_envoyer' and last_error is not null and scheduled_at > now() from public.email_outbox where kind = 'quittance' and charge_id = (select id from public.rent_charges where lease_id = 'cccccccc-0000-0000-0000-000000000002' and period_start = '2026-03-01')),
  'file : échec temporaire reprogrammé');
select public.iz_outbox_result(id, true) from public.email_outbox where kind = 'quittance' and charge_id = (select id from public.rent_charges where lease_id = 'cccccccc-0000-0000-0000-000000000002' and period_start = '2026-03-01');
select tests.ok((select send_status = 'envoye' and sent_at is not null from public.receipts where charge_id = (select id from public.rent_charges where lease_id = 'cccccccc-0000-0000-0000-000000000002' and period_start = '2026-03-01') and kind = 'quittance'),
  'file : quittance marquée envoyée');

-- Suppression d'un document : fichier mis en file de suppression
delete from public.documents where id = 'ffffffff-0000-0000-0000-000000000001';
select tests.ok((select count(*) from public.storage_deletions) = 1, 'documents : fichier mis en file de suppression');

\echo 'Tests SQL du lot 2 passés.'
