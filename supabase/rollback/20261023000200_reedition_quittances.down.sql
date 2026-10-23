-- Annulation de 20261023000200_reedition_quittances.sql (les documents déjà réédités restent tels quels).
drop function if exists public.iz_reissue_receipt(uuid, jsonb);
notify pgrst, 'reload schema';
