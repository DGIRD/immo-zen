drop function if exists public.iz_market_replace_indicators(smallint, text, jsonb, boolean);
drop function if exists public.iz_market_replace_caps(text, jsonb);
alter table if exists public.market_config drop column if exists encadrement_end;
drop table if exists public.market_sync;
notify pgrst, 'reload schema';
