-- Immo-Zen : tableau d'amortissement du crédit importé du document de la banque (Mes biens), pour retenir
-- les intérêts et l'assurance réellement échus chaque année et le capital restant dû au 31/12.
-- Facultatif : sans tableau, l'échéancier est calculé d'après le montant, le taux, la durée et la première échéance.
-- Annulation : supabase/rollback/20261112000100_tableau_amortissement.down.sql
alter table public.properties
  add column if not exists loan_schedule jsonb
    check (loan_schedule is null or (jsonb_typeof(loan_schedule) = 'object' and jsonb_typeof(loan_schedule -> 'rows') = 'array'));

comment on column public.properties.loan_schedule is
  'Tableau d''amortissement importé : source, imported_at, rows[] (date, payment, interest, principal, insurance, remaining, en euros).';

notify pgrst, 'reload schema';
