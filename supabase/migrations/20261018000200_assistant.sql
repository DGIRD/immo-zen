-- Immo-Zen : quota quotidien de l'assistant conversationnel (compteur par compte et par jour, fuseau de Paris).
-- Annulation : supabase/rollback/20261018000200_assistant.down.sql
create table if not exists public.assistant_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  questions int not null default 0,
  primary key (user_id, day)
);
alter table public.assistant_usage enable row level security;
revoke all on public.assistant_usage from anon, authenticated;

-- Réserve une question : vrai si le quota du jour n'est pas atteint (appelée par la fonction serveur uniquement)
create or replace function public.iz_assistant_take(p_user uuid, p_limit int)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into assistant_usage (user_id, day, questions) values (p_user, iz_today_paris(), 1)
  on conflict (user_id, day) do update set questions = assistant_usage.questions + 1
  returning questions into n;
  return n <= p_limit;
end $$;
revoke all on function public.iz_assistant_take(uuid, int) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.iz_assistant_take(uuid, int) to service_role';
  end if;
end $$;
notify pgrst, 'reload schema';
