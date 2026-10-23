-- Tests SQL : contrat de bail, espace locataire (invitation, acceptation, lecture seule, fichiers partagés, révocation).
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

insert into auth.users (id, email, created_at) values
  ('f0000000-0000-0000-0000-000000000001', 'bailleur@example.test', now()),
  ('f0000000-0000-0000-0000-000000000002', 'locataire@example.test', now()),
  ('f0000000-0000-0000-0000-000000000003', 'intrus@example.test', now());

-- ---------- Bailleur : bien, locataire, bail, quittance, documents
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
insert into public.properties (id, title, status, address, zip, city) values ('f1000000-0000-0000-0000-000000000001', 'T2 Lumière', 'acquis', '3 rue des Lilas', '69003', 'Lyon');
insert into public.tenants (id, first_name, last_name) values ('f2000000-0000-0000-0000-000000000001', 'Léa', 'Martin');
insert into public.leases (id, property_id, start_date, rent_hc, charges_amount, landlord_name)
  values ('f3000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', '2026-01-01', 700, 50, 'Paul Bailleur');
insert into public.lease_tenants (lease_id, tenant_id) values ('f3000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001');
select public.iz_generate_rent_charges('f3000000-0000-0000-0000-000000000001', '2026-02-28');
insert into public.payments (id, lease_id, amount, paid_on) values ('f4000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001', 750, '2026-01-03');
insert into public.payment_allocations (payment_id, charge_id, amount)
  select 'f4000000-0000-0000-0000-000000000001', id, 750 from public.rent_charges where lease_id = 'f3000000-0000-0000-0000-000000000001' and period_start = '2026-01-01';
select public.iz_issue_receipt((select id from public.rent_charges where lease_id = 'f3000000-0000-0000-0000-000000000001' and period_start = '2026-01-01'), 'quittance');
insert into public.documents (id, lease_id, category, title, storage_path, mime_type, size_bytes, shared_with_tenant) values
  ('f5000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001', 'bail', 'Bail signé', 'f0000000-0000-0000-0000-000000000001/bail.pdf', 'application/pdf', 1000, true),
  ('f5000000-0000-0000-0000-000000000002', 'f3000000-0000-0000-0000-000000000001', 'facture', 'Facture privée', 'f0000000-0000-0000-0000-000000000001/facture.pdf', 'application/pdf', 1000, false);
insert into storage.objects (bucket_id, name) values ('documents', 'f0000000-0000-0000-0000-000000000001/bail.pdf'), ('documents', 'f0000000-0000-0000-0000-000000000001/facture.pdf');

-- contrat de bail enregistré avec le bail
update public.leases set contract = '{"kind":"vide","duration_years":3}' where id = 'f3000000-0000-0000-0000-000000000001';
select tests.ok((select contract ->> 'kind' from public.leases where id = 'f3000000-0000-0000-0000-000000000001') = 'vide', 'bail : informations du contrat enregistrées');
select tests.fails($q$ update public.leases set contract = '"texte"' $q$, 'bail : contrat mal formé refusé');

select tests.fails($q$ select public.iz_invite_tenant('f2000000-0000-0000-0000-000000000001') $q$, 'invitation : e-mail du locataire obligatoire');
update public.tenants set email = 'Locataire@Example.test' where id = 'f2000000-0000-0000-0000-000000000001';
select public.iz_invite_tenant('f2000000-0000-0000-0000-000000000001') ->> 'code' as code \gset
select tests.ok(length(:'code') = 12, 'invitation : code à 12 caractères');
select tests.ok((select count(*) from public.email_outbox where kind = 'invitation_locataire' and to_emails = array['locataire@example.test']
  and body_text like '%{{APP_URL}}#/espace-locataire?code=' || :'code' || '%') = 1, 'invitation : e-mail en file avec le lien');
select tests.ok((select code_hash is not null and accepted_at is null from public.tenant_accounts), 'invitation : accès en attente, code stocké sous forme d''empreinte');
select tests.ok((select code_hash <> :'code' from public.tenant_accounts), 'invitation : code jamais stocké en clair');
select tests.fails($q$ insert into public.tenant_accounts (user_id, tenant_id, email) values ('f0000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 'x@y.fr') $q$, 'invitation : écriture directe refusée');
commit;

-- ---------- Intrus : code d'un autre, mauvais code
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select tests.fails(format('select public.iz_accept_tenant_invite(%L)', :'code'), 'acceptation : refusée pour une autre adresse e-mail');
select tests.fails($q$ select public.iz_accept_tenant_invite('ABCDEF123456') $q$, 'acceptation : code inconnu refusé');
select tests.ok((select count(*) from public.tenant_accounts) = 0, 'isolation : accès locataires d''un autre bailleur invisibles');
select tests.fails($q$ select public.iz_invite_tenant('f2000000-0000-0000-0000-000000000001') $q$, 'invitation : impossible pour le locataire d''un autre');
commit;

-- ---------- Locataire : acceptation puis consultation
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select tests.ok(jsonb_array_length(public.iz_tenant_portal() -> 'accounts') = 0, 'espace locataire : vide avant acceptation');
select public.iz_accept_tenant_invite(lower(:'code'));
select tests.ok(jsonb_array_length(public.iz_tenant_portal() -> 'accounts') = 1, 'acceptation : espace locataire ouvert (code insensible à la casse)');
select tests.ok((select (public.iz_tenant_portal() -> 'accounts' -> 0 -> 'leases' -> 0 ->> 'property_address') = '3 rue des Lilas 69003 Lyon'), 'espace locataire : bail et adresse du logement');
select tests.ok((select jsonb_array_length(public.iz_tenant_portal() -> 'accounts' -> 0 -> 'receipts')) = 1, 'espace locataire : quittance émise visible');
select tests.ok((select (public.iz_tenant_portal() -> 'accounts' -> 0 -> 'documents' -> 0 ->> 'title') = 'Bail signé'
  and jsonb_array_length(public.iz_tenant_portal() -> 'accounts' -> 0 -> 'documents') = 1), 'espace locataire : seuls les documents partagés');
select tests.ok((select count(*) from storage.objects where name = 'f0000000-0000-0000-0000-000000000001/bail.pdf') = 1, 'fichiers : document partagé lisible');
select tests.ok((select count(*) from storage.objects where name = 'f0000000-0000-0000-0000-000000000001/facture.pdf') = 0, 'fichiers : document non partagé illisible');
select tests.ok((select count(*) from public.leases) + (select count(*) from public.receipts) + (select count(*) from public.tenants) + (select count(*) from public.documents) = 0,
  'lecture seule : aucune table du bailleur lisible directement');
select tests.fails(format('select public.iz_accept_tenant_invite(%L)', :'code'), 'acceptation : code à usage unique');
commit;

-- ---------- Bailleur : statut, document partagé ensuite, révocation
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select tests.ok((select account_user_id = 'f0000000-0000-0000-0000-000000000002' and accepted_at is not null from public.tenant_accounts), 'bailleur : accès actif visible');
update public.documents set shared_with_tenant = true where id = 'f5000000-0000-0000-0000-000000000002';
commit;
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select tests.ok(jsonb_array_length(public.iz_tenant_portal() -> 'accounts' -> 0 -> 'documents') = 2, 'partage : document ajouté à l''espace locataire');
commit;
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.iz_revoke_tenant_access('f2000000-0000-0000-0000-000000000001');
commit;
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select tests.ok(jsonb_array_length(public.iz_tenant_portal() -> 'accounts') = 0, 'révocation : espace locataire fermé');
select tests.ok((select count(*) from storage.objects where bucket_id = 'documents') = 0, 'révocation : fichiers illisibles');
commit;

-- ---------- Nouvelle invitation après révocation
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.iz_invite_tenant('f2000000-0000-0000-0000-000000000001') ->> 'code' as code2 \gset
commit;
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select tests.fails(format('select public.iz_accept_tenant_invite(%L)', :'code'), 'ancienne invitation inutilisable');
select public.iz_accept_tenant_invite(:'code2');
select tests.ok(jsonb_array_length(public.iz_tenant_portal() -> 'accounts') = 1, 'nouvelle invitation : accès rétabli');
commit;

-- ---------- Réédition d'une quittance (correction du bailleur, du locataire, de la date)
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select id as old_receipt from public.receipts where lease_id = 'f3000000-0000-0000-0000-000000000001' and cancelled_at is null and kind = 'quittance' \gset
select tests.fails(format('select public.iz_reissue_receipt(%L, %L)', :'old_receipt', '{"issued_on":"2099-01-01"}'), 'réédition : date d''émission future refusée');
select tests.fails(format('select public.iz_reissue_receipt(%L, %L)', :'old_receipt', '{"tenant_names":" "}'), 'réédition : locataire obligatoire');
select (public.iz_reissue_receipt(:'old_receipt', '{"landlord_name":"Paul Bailleur-Martin","issued_on":"2026-02-02"}'::jsonb)).id as new_receipt \gset
select tests.ok((select cancelled_at is not null and cancel_reason like 'Remplacé par la quittance n° Q-%' from public.receipts where id = :'old_receipt'), 'réédition : quittance d''origine annulée avec renvoi vers la nouvelle');
select tests.ok((select landlord_name = 'Paul Bailleur-Martin' and issued_on = '2026-02-02' and cancelled_at is null and number like 'Q-2026-%' from public.receipts where id = :'new_receipt'), 'réédition : nouvelle quittance corrigée, numérotée à la suite');
select tests.ok((select count(*) from public.receipts where charge_id = (select charge_id from public.receipts where id = :'new_receipt') and kind = 'quittance' and cancelled_at is null) = 1, 'réédition : une seule quittance valable pour la période');
select tests.fails(format('select public.iz_reissue_receipt(%L)', :'old_receipt'), 'réédition : document annulé non modifiable');
commit;
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select tests.fails(format('select public.iz_reissue_receipt(%L)', :'new_receipt'), 'réédition : impossible sur le document d''un autre compte');
commit;
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select tests.ok((select count(*) from jsonb_array_elements(public.iz_tenant_portal() -> 'accounts' -> 0 -> 'receipts') r where r ->> 'landlord_name' = 'Paul Bailleur-Martin') = 1
  and jsonb_array_length(public.iz_tenant_portal() -> 'accounts' -> 0 -> 'receipts') = 1, 'réédition : le locataire ne voit que la quittance corrigée');
commit;

select 'Tests SQL espace locataire passés' as fin;
