alter table if exists public.properties drop column if exists furnished, drop column if exists construction_year,
  drop column if exists rent_zone, drop column if exists market_rent;
drop function if exists public.iz_rent_indicator_stats();
drop table if exists public.market_config;
drop table if exists public.usury_rates;
drop table if exists public.loan_rate_benchmarks;
drop table if exists public.rent_caps;
drop table if exists public.rent_market_indicators;
notify pgrst, 'reload schema';
