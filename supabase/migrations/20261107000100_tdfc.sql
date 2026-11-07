-- =====================================================================
-- Immo-Zen – Télétransmission EDI-TDFC de la liasse LMNP (fonction serveur « tdfc »).
--   tdfc_declarants   : identité fiscale du déclarant (SIREN, ROF, adresses), modifiable par l'abonné ;
--   tdfc_mandates     : mandat donné à Immo-Zen pour télétransmettre, horodaté, jamais modifié ni supprimé ;
--   tdfc_submissions  : archive de chaque interchange préparé et signé (écrite par la fonction serveur seule) ;
--   tdfc_sequences    : numéro séquentiel journalier des interchanges (1 à 999 par jour, heure de Paris).
-- Annulation : rollback/20261107000100_tdfc.down.sql
-- =====================================================================

create table if not exists public.tdfc_declarants (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  siren text not null check (siren ~ '^\d{9}$'),
  rof text not null default 'BIC1' check (rof ~ '^BIC[1-9]\d{0,4}$'),
  name text not null check (char_length(trim(name)) between 1 and 35),
  -- { street, complement?, locality?, zip, city, country? }
  address jsonb not null check (jsonb_typeof(address) = 'object'),
  home jsonb check (home is null or jsonb_typeof(home) = 'object'),
  naf text check (naf is null or naf ~ '^\d{4}[A-Z]$'),
  activity text check (activity is null or char_length(activity) <= 70),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tdfc_mandates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- version du texte du mandat présenté à l'abonné (ex. « 2026-11 »)
  text_version text not null check (char_length(text_version) between 1 and 20),
  signed_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists tdfc_mandates_user on public.tdfc_mandates (user_id, signed_at desc);

create table if not exists public.tdfc_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  year int not null check (year between 2020 and 2100),
  test boolean not null,
  -- référence d'interchange n14 (agrément + année + quantième + séquence)
  reference text not null unique check (reference ~ '^\d{14}$'),
  document_ref text not null,
  status text not null default 'preparee' check (status in ('preparee', 'transmise', 'acceptee', 'rejetee', 'annulee')),
  -- interchange signé, encodé en base 64 (octets ISO 8859-15 transmis)
  interchange_b64 text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  signature_hex text not null check (char_length(signature_hex) = 512 and signature_hex ~ '^[0-9A-F]+$'),
  -- montants et contrôles au moment de la préparation (pour la relecture et le support)
  summary jsonb not null default '{}'::jsonb,
  checks jsonb not null default '[]'::jsonb,
  mandate_id uuid references public.tdfc_mandates(id),
  prepared_at timestamptz not null default now(),
  status_at timestamptz,
  status_detail text
);
create index if not exists tdfc_submissions_user on public.tdfc_submissions (user_id, year, prepared_at desc);

create table if not exists public.tdfc_sequences (
  day date primary key,
  last int not null check (last between 0 and 999)
);

alter table public.tdfc_declarants enable row level security;
alter table public.tdfc_mandates enable row level security;
alter table public.tdfc_submissions enable row level security;
alter table public.tdfc_sequences enable row level security;

-- déclarant : l'abonné gère son identité fiscale
drop policy if exists tdfc_declarants_own on public.tdfc_declarants;
create policy tdfc_declarants_own on public.tdfc_declarants for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- mandat : lecture et signature seulement ; la révocation passe par iz_tdfc_revoke_mandate
drop policy if exists tdfc_mandates_read on public.tdfc_mandates;
create policy tdfc_mandates_read on public.tdfc_mandates for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists tdfc_mandates_sign on public.tdfc_mandates;
create policy tdfc_mandates_sign on public.tdfc_mandates for insert to authenticated
  with check (user_id = (select auth.uid()) and revoked_at is null and signed_at between now() - interval '5 minutes' and now() + interval '5 minutes');

-- archive : lecture seule pour l'abonné ; écrite par la fonction serveur (rôle service)
drop policy if exists tdfc_submissions_read on public.tdfc_submissions;
create policy tdfc_submissions_read on public.tdfc_submissions for select to authenticated using (user_id = (select auth.uid()));
-- tdfc_sequences : aucune politique, réservé au rôle service

grant select, insert, update, delete on public.tdfc_declarants to authenticated;
grant select, insert on public.tdfc_mandates to authenticated;
grant select on public.tdfc_submissions to authenticated;
revoke all on public.tdfc_sequences from authenticated, anon;
grant select, insert, update on public.tdfc_submissions, public.tdfc_sequences to service_role;
grant select on public.tdfc_declarants, public.tdfc_mandates to service_role;

create or replace function public.iz_tdfc_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists tdfc_declarants_touch on public.tdfc_declarants;
create trigger tdfc_declarants_touch before update on public.tdfc_declarants for each row execute function public.iz_tdfc_touch();

-- Révocation du mandat en vigueur (le mandat reste dans l'historique).
create or replace function public.iz_tdfc_revoke_mandate() returns void
language plpgsql security definer set search_path = public as $$
begin
  update tdfc_mandates set revoked_at = now() where user_id = auth.uid() and revoked_at is null;
end $$;
revoke all on function public.iz_tdfc_revoke_mandate() from public, anon;
grant execute on function public.iz_tdfc_revoke_mandate() to authenticated;

-- Numéro séquentiel suivant pour la journée (heure de Paris), atomique ; erreur au-delà de 999.
create or replace function public.iz_tdfc_next_sequence(p_day date) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into tdfc_sequences (day, last) values (p_day, 1)
  on conflict (day) do update set last = tdfc_sequences.last + 1
  returning last into n;
  return n;
exception when check_violation then
  raise exception 'Plus de 999 interchanges préparés ce jour : réessayez demain.' using errcode = 'check_violation';
end $$;
revoke all on function public.iz_tdfc_next_sequence(date) from public, anon, authenticated;
grant execute on function public.iz_tdfc_next_sequence(date) to service_role;

notify pgrst, 'reload schema';
