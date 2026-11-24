-- Tests SQL : informations personnelles (Mon compte), visibles du seul titulaire (24/11/2026).
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

insert into auth.users (id, email, created_at) values
  ('f9a00000-0000-0000-0000-000000000001', 'infos-a@example.test', now()),
  ('f9a00000-0000-0000-0000-000000000002', 'infos-b@example.test', now());
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f9a00000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select tests.ok((select personal_info = '{}'::jsonb from public.user_settings), 'vide par défaut');
update public.user_settings set personal_info = '{"borrower":{"first_name":"Alex","income":3800},"savings":60000}' where user_id = 'f9a00000-0000-0000-0000-000000000001';
select tests.ok((select personal_info #>> '{borrower,first_name}' = 'Alex' from public.user_settings), 'enregistrées par le titulaire');
select set_config('request.jwt.claims', '{"sub":"f9a00000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select tests.ok((select count(*) from public.user_settings where user_id = 'f9a00000-0000-0000-0000-000000000001') = 0, 'invisibles d’un autre compte');
update public.user_settings set personal_info = '{}' where user_id = 'f9a00000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims', '{"sub":"f9a00000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select tests.ok((select personal_info ->> 'savings' = '60000' from public.user_settings), 'non modifiables par un autre compte');
commit;
delete from auth.users where email like 'infos-_@example.test';
select 'Tests SQL informations personnelles passés' as fin;
