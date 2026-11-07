-- Annulation de 20261107000100_tdfc.sql : supprime l'identité fiscale, les mandats et l'archive des interchanges.
drop function if exists public.iz_tdfc_next_sequence(date);
drop function if exists public.iz_tdfc_revoke_mandate();
drop table if exists public.tdfc_submissions;
drop table if exists public.tdfc_mandates;
drop table if exists public.tdfc_declarants;
drop table if exists public.tdfc_sequences;
drop function if exists public.iz_tdfc_touch();
notify pgrst, 'reload schema';
