-- Immo-Zen : mise à jour automatique des données de marché (fonction serveur « marche », chaque nuit).
-- Carte des loyers, taux d'usure, plafonds de Paris ; rappel mensuel à l'administrateur.
-- Annulation : rollback/20261030000200_donnees_marche_auto.down.sql

-- Dernière version chargée de chaque source (fichier, trimestre, année) : évite de recharger la même donnée
create table if not exists public.market_sync (
  source text primary key check (char_length(source) between 1 and 100),
  version text not null check (char_length(version) <= 300),
  details jsonb not null default '{}'::jsonb,
  loaded_at timestamptz not null default now()
);
alter table public.market_sync enable row level security;
drop policy if exists market_sync_admin_read on public.market_sync;
create policy market_sync_admin_read on public.market_sync for select to authenticated using (public.iz_is_admin());
revoke all on public.market_sync from anon;
revoke insert, update, delete on public.market_sync from authenticated;
grant select on public.market_sync to authenticated;

-- Fin de l'encadrement des loyers (appliquée aux plafonds chargés automatiquement) ; modifiable si la loi le prolonge
alter table public.market_config add column if not exists encadrement_end date default '2026-11-23';

-- Remplacement d'un segment de la Carte des loyers (par lots : le premier lot vide le segment)
create or replace function public.iz_market_replace_indicators(p_vintage smallint, p_segment text, p_rows jsonb, p_reset boolean)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_reset then delete from rent_market_indicators where vintage = p_vintage and segment = p_segment; end if;
  insert into rent_market_indicators (vintage, segment, insee, libgeo, low, mid, high, level, r2, nb_obs_commune, nb_obs_maille)
  select p_vintage, p_segment, r.insee, r.libgeo, r.low, r.mid, r.high, r.level, r.r2, r.nb_obs_commune, r.nb_obs_maille
    from jsonb_to_recordset(p_rows) as r(insee text, libgeo text, low numeric, mid numeric, high numeric, level text, r2 numeric, nb_obs_commune int, nb_obs_maille int)
  on conflict (vintage, segment, insee) do update set libgeo = excluded.libgeo, low = excluded.low, mid = excluded.mid, high = excluded.high,
    level = excluded.level, r2 = excluded.r2, nb_obs_commune = excluded.nb_obs_commune, nb_obs_maille = excluded.nb_obs_maille;
  get diagnostics n = row_count;
  return n;
end $$;

-- Remplacement des plafonds d'un territoire, en une transaction
create or replace function public.iz_market_replace_caps(p_territory text, p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from rent_caps where territory = p_territory;
  insert into rent_caps (territory, insee, zone, rooms, year_min, year_max, furnished, ref, max, min, valid_from, valid_to)
  select p_territory, r.insee, r.zone, r.rooms, r.year_min, r.year_max, r.furnished, r.ref, r.max, r.min, r.valid_from, r.valid_to
    from jsonb_to_recordset(p_rows) as r(insee text, zone text, rooms smallint, year_min smallint, year_max smallint, furnished boolean,
      ref numeric, max numeric, min numeric, valid_from date, valid_to date);
  get diagnostics n = row_count;
  return n;
end $$;

-- Réservées à la fonction serveur (rôle service)
revoke all on function public.iz_market_replace_indicators(smallint, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.iz_market_replace_caps(text, jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.iz_market_replace_indicators(smallint, text, jsonb, boolean) to service_role';
    execute 'grant execute on function public.iz_market_replace_caps(text, jsonb) to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';
