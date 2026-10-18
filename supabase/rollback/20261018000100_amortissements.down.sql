alter table if exists public.expenses drop column if exists amortization_years;
notify pgrst, 'reload schema';
