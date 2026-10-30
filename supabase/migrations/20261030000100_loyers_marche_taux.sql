-- Immo-Zen : loyers de marché (Carte des loyers, plafonds d'encadrement) et taux de crédit
-- (barème par durée, taux d'usure de la Banque de France). Expression de besoin du 29-30/10/2026.
-- Données de référence publiques, communes à tous les comptes : lecture par tout compte connecté,
-- écriture réservée aux administrateurs. Annulation : rollback/20261030000100_loyers_marche_taux.down.sql

-- ---------------------------------------------------------------------
-- Carte des loyers (ANIL, ministère chargé du Logement) : une ligne par millésime, segment et commune
-- ---------------------------------------------------------------------
create table if not exists public.rent_market_indicators (
  vintage smallint not null check (vintage between 2018 and 2100),
  segment text not null check (segment in ('appart', 'appart_t1t2', 'appart_t3plus', 'maison')),
  insee text not null check (insee ~ '^[0-9AB]{5}$'),
  libgeo text check (char_length(libgeo) <= 200),
  -- €/m²/mois, charges comprises, bien non meublé
  low numeric(8,2) not null check (low > 0),
  mid numeric(8,2) not null check (mid > 0),
  high numeric(8,2) not null check (high > 0),
  level text not null check (level in ('commune', 'epci', 'maille')),
  r2 numeric(5,3),
  nb_obs_commune int check (nb_obs_commune >= 0),
  nb_obs_maille int check (nb_obs_maille >= 0),
  primary key (vintage, segment, insee),
  check (low <= mid and mid <= high)
);
create index if not exists rent_market_indicators_insee on public.rent_market_indicators (insee, vintage desc);

-- ---------------------------------------------------------------------
-- Plafonds d'encadrement du niveau des loyers (arrêtés préfectoraux), €/m²/mois hors charges
-- ---------------------------------------------------------------------
create table if not exists public.rent_caps (
  id bigint generated always as identity primary key,
  territory text not null check (char_length(territory) between 1 and 100),
  insee text not null check (insee ~ '^[0-9AB]{5}$'),
  zone text not null default 'Unique' check (char_length(zone) between 1 and 100),
  rooms smallint not null check (rooms between 1 and 4),
  year_min smallint check (year_min between 1000 and 2100),
  year_max smallint check (year_max between 1000 and 2100),
  furnished boolean not null default false,
  ref numeric(6,2) not null check (ref > 0),
  max numeric(6,2) not null,
  min numeric(6,2) not null check (min > 0),
  valid_from date not null,
  -- fin de l'expérimentation au 23/11/2026, sauf prolongation enregistrée par l'administrateur
  valid_to date,
  created_at timestamptz not null default now(),
  check (min <= ref and ref <= max),
  check (year_min is null or year_max is null or year_min <= year_max),
  check (valid_to is null or valid_from <= valid_to)
);
create index if not exists rent_caps_insee on public.rent_caps (insee, valid_from);

-- ---------------------------------------------------------------------
-- Barème des taux nominaux hors assurance, par durée (mis à jour chaque mois par l'administrateur)
-- ---------------------------------------------------------------------
create table if not exists public.loan_rate_benchmarks (
  effective_on date not null,
  years smallint not null check (years between 1 and 40),
  rate numeric(5,2) not null check (rate >= 0 and rate < 20),
  source text not null default 'Administrateur' check (char_length(source) between 1 and 200),
  updated_at timestamptz not null default now(),
  primary key (effective_on, years)
);

-- ---------------------------------------------------------------------
-- Taux effectifs moyens et taux d'usure (Banque de France, trimestriels)
-- ---------------------------------------------------------------------
create table if not exists public.usury_rates (
  quarter text not null check (quarter ~ '^\d{4}-Q[1-4]$'),
  borrower text not null check (borrower in ('particulier', 'personne_morale')),
  bracket text not null check (bracket in ('moins_10', '10_20', '20_plus', 'variable', 'relais')),
  average numeric(5,2) check (average >= 0),
  usury numeric(5,2) not null check (usury > 0 and usury < 30),
  valid_from date not null,
  valid_to date not null check (valid_from <= valid_to),
  updated_at timestamptz not null default now(),
  primary key (quarter, borrower, bracket)
);
-- Banque de France, Taux d'usure 2026-Q4 (mis en ligne le 28/09/2026), taux effectifs moyens du 3e trimestre 2026
insert into public.usury_rates (quarter, borrower, bracket, average, usury, valid_from, valid_to) values
  ('2026-Q4', 'particulier', 'moins_10', 3.07, 4.09, '2026-10-01', '2026-12-31'),
  ('2026-Q4', 'particulier', '10_20', 3.51, 4.68, '2026-10-01', '2026-12-31'),
  ('2026-Q4', 'particulier', '20_plus', 4.05, 5.40, '2026-10-01', '2026-12-31'),
  ('2026-Q4', 'particulier', 'variable', 4.14, 5.52, '2026-10-01', '2026-12-31'),
  ('2026-Q4', 'particulier', 'relais', 4.87, 6.49, '2026-10-01', '2026-12-31'),
  ('2026-Q4', 'personne_morale', 'moins_10', 4.47, 5.96, '2026-10-01', '2026-12-31'),
  ('2026-Q4', 'personne_morale', '10_20', 4.45, 5.93, '2026-10-01', '2026-12-31'),
  ('2026-Q4', 'personne_morale', '20_plus', 4.37, 5.83, '2026-10-01', '2026-12-31')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Réglages (une ligne) : seuil de fourchette trop large, écart de renégociation
-- ---------------------------------------------------------------------
create table if not exists public.market_config (
  id boolean primary key default true check (id),
  rent_wide_threshold numeric(4,2) not null default 0.60 check (rent_wide_threshold > 0 and rent_wide_threshold <= 2),
  furnished_coef numeric(4,2) not null default 1.15 check (furnished_coef >= 1 and furnished_coef <= 2),
  renegotiation_gap numeric(4,2) not null default 0.70 check (renegotiation_gap > 0 and renegotiation_gap <= 5),
  updated_at timestamptz not null default now()
);
insert into public.market_config (id) values (true) on conflict do nothing;

-- ---------------------------------------------------------------------
-- Droits : lecture par les comptes connectés, écriture par les administrateurs
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['rent_market_indicators', 'rent_caps', 'loan_rate_benchmarks', 'usury_rates', 'market_config'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.iz_is_admin()) with check (public.iz_is_admin())', t || '_admin', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
grant usage on sequence public.rent_caps_id_seq to authenticated;

-- Nombre de communes chargées par millésime et segment (écran d'administration)
create or replace function public.iz_rent_indicator_stats()
returns table (vintage smallint, segment text, communes bigint)
language sql stable security invoker set search_path = public as $$
  select vintage, segment, count(*) from rent_market_indicators group by vintage, segment order by vintage desc, segment
$$;
revoke execute on function public.iz_rent_indicator_stats() from public, anon;
grant execute on function public.iz_rent_indicator_stats() to authenticated;

-- ---------------------------------------------------------------------
-- Bien : caractéristiques utiles au loyer de marché et fourchette enregistrée
-- ---------------------------------------------------------------------
alter table public.properties
  add column if not exists furnished boolean,
  add column if not exists construction_year smallint check (construction_year is null or construction_year between 1000 and 2100),
  -- zone d'encadrement choisie (commune à plusieurs zones), ou « __hors_zone__ »
  add column if not exists rent_zone text check (char_length(rent_zone) <= 100),
  -- fourchette bas / central / haut, plafond, millésime, fiabilité, date (photographie)
  add column if not exists market_rent jsonb check (market_rent is null or jsonb_typeof(market_rent) = 'object');

notify pgrst, 'reload schema';
