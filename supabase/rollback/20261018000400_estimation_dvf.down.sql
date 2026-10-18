alter table if exists public.properties drop constraint if exists properties_estimate_range_check;
alter table if exists public.properties drop column if exists estimate_low, drop column if exists estimate_high, drop column if exists estimate_median,
  drop column if exists estimate_on, drop column if exists estimate_source, drop column if exists estimate_details;
notify pgrst, 'reload schema';
