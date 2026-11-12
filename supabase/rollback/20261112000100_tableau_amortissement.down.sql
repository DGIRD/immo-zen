-- Annule 20261112000100_tableau_amortissement.sql
alter table public.properties drop column if exists loan_schedule;
notify pgrst, 'reload schema';
