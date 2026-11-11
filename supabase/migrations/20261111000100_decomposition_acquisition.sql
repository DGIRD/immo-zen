-- Immo-Zen : décomposition du coût d'acquisition d'un bien détenu (Mes biens), pour l'amortissement au réel
-- et la liasse : prix (dont terrain), frais de notaire, frais d'agence, mobilier compris dans la vente, avec
-- leur durée d'amortissement. Facultatif : sans décomposition, le coût d'acquisition global reste utilisé.
-- Annulation : supabase/rollback/20261111000100_decomposition_acquisition.down.sql
alter table public.properties
  add column if not exists acquisition_breakdown jsonb
    check (acquisition_breakdown is null or jsonb_typeof(acquisition_breakdown) = 'object');

comment on column public.properties.acquisition_breakdown is
  'Décomposition du coût d''acquisition : price, land_pct, notary, agency, furniture, building_years, fees_years, furniture_years (montants en euros, durées en années).';

notify pgrst, 'reload schema';
