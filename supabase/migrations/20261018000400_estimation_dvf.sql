-- Immo-Zen : fourchette d'estimation de la valeur d'un bien (prospection et Mes biens),
-- calculée d'après les ventes publiques DVF ou saisie à la main. Annulation : rollback/20261018000400_estimation_dvf.down.sql
alter table public.properties
  add column if not exists estimate_low numeric(12,0) check (estimate_low is null or estimate_low >= 0),
  add column if not exists estimate_high numeric(12,0) check (estimate_high is null or estimate_high >= 0),
  add column if not exists estimate_median numeric(12,0) check (estimate_median is null or estimate_median >= 0),
  add column if not exists estimate_on date,
  -- « DVF 2023–2025, 24 ventes d'appartements à moins de 500 m » ou « Saisie manuelle »
  add column if not exists estimate_source text check (char_length(estimate_source) <= 300),
  -- prix au m² (quartiles), nombre de ventes, rayon, période et ventes comparables retenues
  add column if not exists estimate_details jsonb;
alter table public.properties drop constraint if exists properties_estimate_range_check;
alter table public.properties add constraint properties_estimate_range_check check (estimate_low is null or estimate_high is null or estimate_low <= estimate_high);
notify pgrst, 'reload schema';
