drop function if exists public.iz_assistant_take(uuid, int);
drop table if exists public.assistant_usage;
notify pgrst, 'reload schema';
