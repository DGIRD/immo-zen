-- Tests SQL : import des loyers, révision IRL, rappel de charges sur quittance. Exécuté après 50_plateforme.test.sql.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

insert into public.properties (id, title, status, city, dpe) values
  ('aaaaaaaa-6666-0000-0000-000000000001', 'T2 révision', 'acquis', 'Paris', 'D'),
  ('aaaaaaaa-6666-0000-0000-000000000002', 'Studio classé G', 'acquis', 'Paris', 'G');
insert into public.tenants (id, last_name) values ('bbbbbbbb-6666-0000-0000-000000000001', 'Durand');
insert into public.leases (id, property_id, start_date, rent_hc, charges_amount, payment_day) values
  ('cccccccc-6666-0000-0000-000000000001', 'aaaaaaaa-6666-0000-0000-000000000001', '2024-02-01', 700, 50, 5),
  ('cccccccc-6666-0000-0000-000000000002', 'aaaaaaaa-6666-0000-0000-000000000002', '2024-02-01', 500, 30, 5);
insert into public.lease_tenants (lease_id, tenant_id) values ('cccccccc-6666-0000-0000-000000000001', 'bbbbbbbb-6666-0000-0000-000000000001');
select public.iz_generate_rent_charges('cccccccc-6666-0000-0000-000000000001', '2025-03-31');

-- Import des loyers : anti-doublon
insert into public.payments (id, lease_id, amount, paid_on, source, import_ref) values
  ('dddddddd-6666-0000-0000-000000000001', 'cccccccc-6666-0000-0000-000000000001', 750, '2024-02-05', 'import', 'loy:abc:1');
select tests.fails($q$ insert into public.payments (lease_id, amount, paid_on, source, import_ref) values ('cccccccc-6666-0000-0000-000000000001', 750, '2024-02-05', 'import', 'loy:abc:1') $q$,
  'import loyers : même ligne refusée (anti-doublon)');

-- Révision IRL
select tests.fails($q$ select public.iz_revise_rent('cccccccc-6666-0000-0000-000000000001', '2025-02-01', '2023-T4', 142.06, '2024-T4', 144.64) $q$,
  'révision : refusée si le bail ne la prévoit pas');
update public.leases set irl_enabled = true, irl_base_label = '2023-T4', irl_base_value = 142.06 where id in ('cccccccc-6666-0000-0000-000000000001', 'cccccccc-6666-0000-0000-000000000002');
select tests.fails($q$ select public.iz_revise_rent('cccccccc-6666-0000-0000-000000000001', '2024-10-01', '2023-T4', 142.06, '2024-T4', 144.64) $q$,
  'révision : pas avant un an de bail');
select tests.fails($q$ select public.iz_revise_rent('cccccccc-6666-0000-0000-000000000002', '2025-02-01', '2023-T4', 142.06, '2024-T4', 144.64) $q$,
  'révision : interdite pour un logement classé G (gel des loyers)');
select tests.ok((select new_rent = 712.71 and charges_updated = 2 from public.iz_revise_rent('cccccccc-6666-0000-0000-000000000001', '2025-02-01', '2023-T4', 142.06, '2024-T4', 144.64)),
  'révision : 700 × 144,64 / 142,06 = 712,71, échéances de février et mars mises à jour');
select tests.ok((select rent_hc = 712.71 and irl_base_label = '2024-T4' and last_revision_on = '2025-02-01' from public.leases where id = 'cccccccc-6666-0000-0000-000000000001'),
  'révision : loyer et indice de référence du bail mis à jour');
select tests.ok((select rent_amount = 700 from public.rent_charges where lease_id = 'cccccccc-6666-0000-0000-000000000001' and period_start = '2025-01-01'),
  'révision : pas d''effet rétroactif sur les mois précédents');
select tests.fails($q$ select public.iz_revise_rent('cccccccc-6666-0000-0000-000000000001', '2025-06-01', '2024-T4', 144.64, '2025-T1', 145.47) $q$,
  'révision : une seule par année de bail');
select tests.ok((select count(*) from public.lease_revisions) = 1, 'révision : historique conservé');
select tests.fails($q$ insert into public.lease_revisions (lease_id, effective_on, old_rent, new_rent, old_index_label, old_index, new_index_label, new_index)
  values ('cccccccc-6666-0000-0000-000000000001', '2026-02-01', 1, 2, 'x', 1, 'y', 1) $q$, 'révision : historique non modifiable directement');

-- Rappel de charges repris sur la quittance du mois
insert into public.rent_charges (id, lease_id, kind, label, period_start, period_end, due_date, rent_amount, charges_amount) values
  ('eeeeeeee-6666-0000-0000-000000000001', 'cccccccc-6666-0000-0000-000000000001', 'regularisation', 'Rappel de charges 2024', '2024-01-01', '2024-12-31', '2025-03-01', 0, 120);
insert into public.payments (id, lease_id, amount, paid_on) values ('dddddddd-6666-0000-0000-000000000002', 'cccccccc-6666-0000-0000-000000000001', 882.71, '2025-03-05');
insert into public.payment_allocations (payment_id, charge_id, amount)
  select 'dddddddd-6666-0000-0000-000000000002', id, 762.71 from public.rent_charges where lease_id = 'cccccccc-6666-0000-0000-000000000001' and kind = 'loyer' and period_start = '2025-03-01';
insert into public.payment_allocations (payment_id, charge_id, amount) values ('dddddddd-6666-0000-0000-000000000002', 'eeeeeeee-6666-0000-0000-000000000001', 120);
select tests.ok((select jsonb_array_length(extra_lines) = 1 and paid_amount = 882.71
                   from public.iz_issue_receipt_with_extras((select id from public.rent_charges where lease_id = 'cccccccc-6666-0000-0000-000000000001' and kind = 'loyer' and period_start = '2025-03-01'),
                                                            array['eeeeeeee-6666-0000-0000-000000000001'::uuid])),
  'quittance : rappel de charges 2024 ajouté sur une ligne distincte');
select tests.fails($q$ select public.iz_issue_receipt('eeeeeeee-6666-0000-0000-000000000001', 'quittance') $q$, 'rappel : pas de seconde quittance pour la même somme');
select tests.fails($q$ select public.iz_issue_receipt_with_extras((select id from public.rent_charges where lease_id = 'cccccccc-6666-0000-0000-000000000001' and kind = 'loyer' and period_start = '2024-02-01'),
  array['eeeeeeee-6666-0000-0000-000000000001'::uuid]) $q$, 'rappel : impossible de le reprendre sur une autre quittance');
-- Durée d'amortissement personnalisée sur une dépense
insert into public.expenses (property_id, expense_date, amount, category, nature, payment_status, paid_on, amortization_years)
values ('aaaaaaaa-6666-0000-0000-000000000001', '2025-05-01', 3000, 'entretien', 'immobilisation', 'paye', '2025-05-01', 8);
select tests.ok((select amortization_years = 8 from public.expenses where amount = 3000 and property_id = 'aaaaaaaa-6666-0000-0000-000000000001'), 'amortissement : durée personnalisée enregistrée');
select tests.fails($q$ insert into public.expenses (property_id, expense_date, amount, category, payment_status, paid_on, amortization_years)
  values ('aaaaaaaa-6666-0000-0000-000000000001', '2025-05-01', 10, 'mobilier', 'paye', '2025-05-01', 0) $q$, 'amortissement : durée nulle refusée');
commit;

-- Isolation : Bob ne peut ni réviser ni quittancer pour Alice
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select tests.fails($q$ select public.iz_revise_rent('cccccccc-6666-0000-0000-000000000001', '2026-02-01', '2024-T4', 144.64, '2025-T4', 145.78) $q$, 'révision : refusée sur le bail d''un autre compte');
select tests.ok((select count(*) from public.lease_revisions) = 0, 'révision : historique invisible pour un autre compte');
commit;

-- Quota de l'assistant : réservé au serveur, limite quotidienne respectée
select tests.ok(public.iz_assistant_take('11111111-1111-1111-1111-111111111111', 2) and public.iz_assistant_take('11111111-1111-1111-1111-111111111111', 2)
  and not public.iz_assistant_take('11111111-1111-1111-1111-111111111111', 2), 'assistant : quota quotidien appliqué');
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select tests.fails($q$ select public.iz_assistant_take('11111111-1111-1111-1111-111111111111', 1000) $q$, 'assistant : quota non manipulable par l''utilisateur');
commit;

-- Formulaire de contact du site (visiteur anonyme)
begin;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select tests.ok(public.iz_submit_lead('Marie Dupont', 'Marie@Example.test', '0600000000', 'Je souhaite être accompagnée.', 'Accompagnement'), 'site : demande de contact enregistrée');
select tests.fails($q$ select public.iz_submit_lead('X', 'pas-un-email', null, null) $q$, 'site : adresse invalide refusée');
select tests.ok(public.iz_submit_lead('Robot', 'robot@spam.test', null, 'pub', null, 'http://spam'), 'site : champ piège accepté sans enregistrement');
select public.iz_submit_lead('Marie Dupont', 'marie@example.test', null, 'relance');
select public.iz_submit_lead('Marie Dupont', 'marie@example.test', null, 'relance');
select tests.fails($q$ select public.iz_submit_lead('Marie Dupont', 'marie@example.test', null, 'encore') $q$, 'site : 3 demandes par adresse et par jour');
select tests.fails($q$ select count(*) from public.platform_leads $q$, 'site : prospects illisibles pour un visiteur');
commit;
select tests.ok((select count(*) from public.platform_leads where email = 'marie@example.test' and source = 'Site – Accompagnement') = 1
  and not exists (select 1 from public.platform_leads where email = 'robot@spam.test'), 'site : prospect visible en administration, robot écarté');
select tests.ok((select count(*) from public.email_outbox where kind = 'contact_site' and to_emails = array['contact@immo-zen.fr']
  and reply_to = 'marie@example.test' and user_id is null and body_text like '%Je souhaite être accompagnée.%') = 1, 'site : demande envoyée par e-mail à contact@immo-zen.fr, réponse au visiteur');
select tests.ok(not exists (select 1 from public.email_outbox where kind = 'contact_site' and reply_to = 'robot@spam.test'), 'site : aucun e-mail pour un robot');
select tests.fails($q$ insert into public.email_outbox (user_id, kind, to_emails, subject, body_text, dedupe_key) values (null, 'quittance', array['a@b.fr'], 's', 'b', 'x') $q$, 'file : message sans compte réservé aux demandes du site');

-- Estimation du prix (DVF ou saisie manuelle)
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
update public.properties set estimate_low = 380000, estimate_high = 430000, estimate_median = 405000, estimate_on = '2026-10-18',
  estimate_source = 'DVF 2023–2025, 24 ventes d''appartements à moins de 500 m', estimate_details = '{"count":24,"radius":500}'
  where id = 'aaaaaaaa-6666-0000-0000-000000000001';
select tests.ok((select estimate_median = 405000 and estimate_details->>'radius' = '500' from public.properties where id = 'aaaaaaaa-6666-0000-0000-000000000001'), 'estimation : fourchette enregistrée avec sa source');
select tests.fails($q$ update public.properties set estimate_low = 500000, estimate_high = 400000 where id = 'aaaaaaaa-6666-0000-0000-000000000001' $q$, 'estimation : fourchette basse supérieure à la haute refusée');
select tests.fails($q$ update public.properties set estimate_low = -1 where id = 'aaaaaaaa-6666-0000-0000-000000000001' $q$, 'estimation : montant négatif refusé');
commit;

select 'Tests SQL loyers, IRL et rappels passés' as fin;
