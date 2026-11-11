-- Annulation de 20261111000100_decomposition_acquisition.sql
alter table public.properties drop column if exists acquisition_breakdown;
notify pgrst, 'reload schema';
