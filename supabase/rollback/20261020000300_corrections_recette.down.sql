-- Annulation de 20261020000300_corrections_recette.sql (les droits retirés au rôle anonyme ne sont pas rétablis).
drop function if exists public.iz_cron_token_ok(text);
alter table if exists public.rent_charges drop constraint if exists rent_charges_cancel_reason_len;
alter table if exists public.rent_charges drop column if exists cancel_reason;
