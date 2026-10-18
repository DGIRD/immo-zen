-- Immo-Zen : durée d'amortissement personnalisée par dépense (meubles, travaux, autres immobilisations).
-- Vide : durée par défaut de la catégorie (réglable dans la déclaration fiscale). Annulation : rollback/20261018000100_amortissements.down.sql
alter table public.expenses add column if not exists amortization_years numeric(4,1)
  check (amortization_years is null or (amortization_years > 0 and amortization_years <= 50));
notify pgrst, 'reload schema';
