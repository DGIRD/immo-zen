-- Tests SQL : changement de la date de début d'un bail (26/10/2026).
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

insert into auth.users (id, email, created_at) values ('f9700000-0000-0000-0000-000000000001', 'debut@example.test', now());
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f9700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
insert into public.properties (id, title, status) values ('f9710000-0000-0000-0000-000000000001', 'F3 Paris 19', 'acquis');

-- année improbable refusée
select tests.fails($q$ insert into public.leases (property_id, start_date, rent_hc, charges_amount) values ('f9710000-0000-0000-0000-000000000001', '0090-03-01', 900, 50) $q$, 'date de début : année improbable refusée à la création');

-- bail saisi par erreur en 1990
insert into public.leases (id, property_id, start_date, rent_hc, charges_amount) values ('f9730000-0000-0000-0000-000000000001', 'f9710000-0000-0000-0000-000000000001', '1990-03-01', 900, 50);
select public.iz_generate_rent_charges('f9730000-0000-0000-0000-000000000001', '2024-06-30');
select tests.ok((select count(*) from public.rent_charges where lease_id = 'f9730000-0000-0000-0000-000000000001') = 412, 'bail 1990 : 412 échéances générées');
select tests.fails($q$ update public.leases set start_date = '0024-03-15' where id = 'f9730000-0000-0000-0000-000000000001' $q$, 'date de début : année improbable refusée à la modification');

-- un paiement réparti à tort sur une échéance de 1995 : conservé, sa répartition retirée
insert into public.payments (id, lease_id, amount, paid_on) values ('f9740000-0000-0000-0000-000000000001', 'f9730000-0000-0000-0000-000000000001', 100, '2024-01-10');
insert into public.payment_allocations (payment_id, charge_id, amount)
  select 'f9740000-0000-0000-0000-000000000001', id, 100 from public.rent_charges where lease_id = 'f9730000-0000-0000-0000-000000000001' and period_start = '1995-01-01';
-- une quittance non annulée sur une échéance à supprimer bloque la correction
reset role;
insert into public.receipts (user_id, lease_id, charge_id, kind, number, issued_on, period_start, period_end, rent_amount, charges_amount, paid_amount, tenant_names)
  select user_id, lease_id, id, 'recu', 'R-T-0001', '2024-01-10', period_start, period_end, rent_amount, charges_amount, 100, 'X'
    from public.rent_charges where lease_id = 'f9730000-0000-0000-0000-000000000001' and period_start = '1995-01-01';
set local role authenticated;
select tests.fails($q$ update public.leases set start_date = '2024-03-15' where id = 'f9730000-0000-0000-0000-000000000001' $q$, 'nouvelle date : refusée si une échéance supprimée est couverte par un reçu');
select tests.ok((select start_date from public.leases where id = 'f9730000-0000-0000-0000-000000000001') = '1990-03-01', 'nouvelle date : bail inchangé après refus');
reset role;
update public.receipts set cancelled_at = now(), cancel_reason = 'Erreur de date' where number = 'R-T-0001';
set local role authenticated;

-- correction : 1990 → 15/03/2024
update public.leases set start_date = '2024-03-15' where id = 'f9730000-0000-0000-0000-000000000001';
select tests.ok((select count(*) from public.rent_charges where lease_id = 'f9730000-0000-0000-0000-000000000001') = 3, 'nouvelle date : échéances antérieures supprimées (avril à juin 2024 conservées)');
select tests.ok(exists (select 1 from public.payments where id = 'f9740000-0000-0000-0000-000000000001')
  and not exists (select 1 from public.payment_allocations where payment_id = 'f9740000-0000-0000-0000-000000000001'), 'nouvelle date : paiement conservé, répartition erronée retirée');
select public.iz_generate_rent_charges('f9730000-0000-0000-0000-000000000001', '2024-06-30');
select tests.ok((select rent_amount from public.rent_charges where lease_id = 'f9730000-0000-0000-0000-000000000001' and period_start = '2024-03-15') = 493.55, 'nouvelle date : premier mois régénéré au prorata (17/31)');
select tests.ok((select count(*) from public.rent_charges where lease_id = 'f9730000-0000-0000-0000-000000000001') = 4, 'nouvelle date : échéancier mars à juin 2024');

-- la date recule : premier mois incomplet recalculé
update public.leases set start_date = '2024-03-01' where id = 'f9730000-0000-0000-0000-000000000001';
select public.iz_generate_rent_charges('f9730000-0000-0000-0000-000000000001', '2024-06-30');
select tests.ok((select rent_amount from public.rent_charges where lease_id = 'f9730000-0000-0000-0000-000000000001' and period_start = '2024-03-01') = 900
  and not exists (select 1 from public.rent_charges where lease_id = 'f9730000-0000-0000-0000-000000000001' and period_start = '2024-03-15'), 'date avancée : premier mois complet, ancien prorata supprimé');

-- bail déjà corrigé mais échéances d'avant restées : nettoyage à la demande
insert into public.leases (id, property_id, start_date, rent_hc, charges_amount) values ('f9730000-0000-0000-0000-000000000002', 'f9710000-0000-0000-0000-000000000001', '1990-04-01', 800, 0);
select public.iz_generate_rent_charges('f9730000-0000-0000-0000-000000000002', '2024-12-31');
commit;

-- simulation de l'état antérieur au correctif : date corrigée sans purge (fonction d'origine)
begin;
alter table public.leases disable trigger iz_lease_rules;
update public.leases set start_date = '2024-09-01' where id = 'f9730000-0000-0000-0000-000000000002';
alter table public.leases enable trigger iz_lease_rules;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f9700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select tests.ok(public.iz_clean_lease_schedule('f9730000-0000-0000-0000-000000000002') = 413, 'nettoyage : 413 échéances antérieures au bail supprimées');
select tests.ok((select min(period_start) from public.rent_charges where lease_id = 'f9730000-0000-0000-0000-000000000002') = '2024-09-01', 'nettoyage : échéancier à partir du début du bail');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select tests.fails($q$ select public.iz_clean_lease_schedule('f9730000-0000-0000-0000-000000000002') $q$, 'nettoyage : bail d''un autre compte inaccessible');
commit;

select 'Tests SQL date de début passés' as fin;
