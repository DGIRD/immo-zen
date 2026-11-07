-- Tests SQL : télétransmission EDI-TDFC (identité fiscale, mandat, archive, compteur journalier).
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

grant usage on schema tests to service_role;
grant execute on all functions in schema tests to service_role;

insert into auth.users (id, email, created_at) values
  ('d0000000-0000-0000-0000-000000000001', 'tdfc-lmnp@example.test', now()),
  ('d0000000-0000-0000-0000-000000000002', 'tdfc-autre@example.test', now());

-- ---------- abonné : identité fiscale et mandat
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
insert into public.tdfc_declarants (siren, rof, name, address) values ('079555934', 'BIC1', 'MONSIEUR 01', '{"street":"252 RUE ALPHANUMERIQUE","zip":"44001","city":"NANTES"}');
select tests.ok((select user_id from public.tdfc_declarants) = 'd0000000-0000-0000-0000-000000000001', 'déclarant : rattaché à l''abonné');
select tests.fails($q$ update public.tdfc_declarants set siren = '12345' $q$, 'déclarant : SIREN de 9 chiffres exigé');
select tests.fails($q$ update public.tdfc_declarants set rof = 'BIC01' $q$, 'déclarant : ROF sans zéro initial');
select tests.fails($q$ update public.tdfc_declarants set name = repeat('x', 36) $q$, 'déclarant : nom de 35 caractères au plus');
update public.tdfc_declarants set naf = '6820A';
select tests.ok((select updated_at >= created_at from public.tdfc_declarants), 'déclarant : date de modification tenue');

insert into public.tdfc_mandates (text_version) values ('2026-11');
select tests.ok((select count(*) from public.tdfc_mandates where revoked_at is null) = 1, 'mandat : signé');
select tests.fails($q$ update public.tdfc_mandates set signed_at = now() - interval '1 year' $q$, 'mandat : non modifiable');
select tests.fails($q$ delete from public.tdfc_mandates $q$, 'mandat : non supprimable');
select tests.fails($q$ insert into public.tdfc_mandates (text_version, signed_at) values ('2026-11', now() - interval '1 day') $q$, 'mandat : antidatage refusé');
select tests.fails($q$ insert into public.tdfc_mandates (text_version, revoked_at) values ('2026-11', now()) $q$, 'mandat : création déjà révoquée refusée');

-- l'archive et le compteur sont réservés à la fonction serveur
select tests.fails($q$ insert into public.tdfc_submissions (user_id, year, test, reference, document_ref, interchange_b64, sha256, signature_hex)
  values (auth.uid(), 2025, true, '44001016105001', 'X', 'AA==', repeat('a', 64), repeat('A', 512)) $q$, 'archive : écriture refusée à l''abonné');
select tests.fails($q$ select public.iz_tdfc_next_sequence(current_date) $q$, 'compteur : refusé à l''abonné');
select tests.fails($q$ select * from public.tdfc_sequences $q$, 'compteur : illisible pour l''abonné');
commit;

-- ---------- fonction serveur : compteur et archive
begin;
set local role service_role;
select tests.ok(public.iz_tdfc_next_sequence('2026-04-15') = 1, 'compteur : premier numéro du jour');
select tests.ok(public.iz_tdfc_next_sequence('2026-04-15') = 2, 'compteur : numéro suivant');
select tests.ok(public.iz_tdfc_next_sequence('2026-04-16') = 1, 'compteur : remis à 1 chaque jour');
update public.tdfc_sequences set last = 999 where day = '2026-04-15';
select tests.fails($q$ select public.iz_tdfc_next_sequence('2026-04-15') $q$, 'compteur : 999 interchanges par jour au plus');
insert into public.tdfc_submissions (user_id, year, test, reference, document_ref, interchange_b64, sha256, signature_hex, mandate_id)
  values ('d0000000-0000-0000-0000-000000000001', 2025, true, '44001016105001', 'IZ2025-A', 'VU5BOg==', repeat('a', 64), repeat('A', 512),
    (select id from public.tdfc_mandates limit 1));
select tests.fails($q$ insert into public.tdfc_submissions (user_id, year, test, reference, document_ref, interchange_b64, sha256, signature_hex)
  values ('d0000000-0000-0000-0000-000000000001', 2025, true, '44001016105001', 'IZ2025-B', 'AA==', repeat('a', 64), repeat('A', 512)) $q$, 'archive : référence d''interchange unique');
select tests.fails($q$ insert into public.tdfc_submissions (user_id, year, test, reference, document_ref, interchange_b64, sha256, signature_hex)
  values ('d0000000-0000-0000-0000-000000000001', 2025, true, '44001016105002', 'IZ2025-C', 'AA==', repeat('a', 64), 'abc') $q$, 'archive : signature de 512 caractères hexadécimaux');
commit;

-- ---------- lecture : chacun ne voit que ses propres lignes ; révocation conservée
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select tests.ok((select count(*) from public.tdfc_submissions) = 1, 'archive : lisible par l''abonné');
select public.iz_tdfc_revoke_mandate();
select tests.ok((select count(*) from public.tdfc_mandates where revoked_at is not null) = 1, 'mandat : révoqué et conservé');
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select tests.ok((select count(*) from public.tdfc_submissions) = 0, 'archive : invisible pour un autre abonné');
select tests.ok((select count(*) from public.tdfc_declarants) = 0, 'déclarant : invisible pour un autre abonné');
select tests.ok((select count(*) from public.tdfc_mandates) = 0, 'mandat : invisible pour un autre abonné');
select public.iz_tdfc_revoke_mandate();
commit;
select tests.ok((select count(*) from public.tdfc_mandates where revoked_at is not null) = 1, 'mandat : un autre abonné ne peut pas le révoquer');

select 'Tests SQL télétransmission passés' as fin;
