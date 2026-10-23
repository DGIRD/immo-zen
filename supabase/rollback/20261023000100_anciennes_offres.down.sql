-- Annulation de 20261023000100_anciennes_offres.sql : les anciennes offres reviennent, fermées.
insert into public.plans (code, label, billing_interval, tier, kind, active, sort)
values ('mensuel', 'Abonnement mensuel (ancienne offre)', 'month', 'patrimoine', 'formule', false, 99),
       ('annuel', 'Abonnement annuel (ancienne offre)', 'year', 'patrimoine', 'formule', false, 99)
on conflict (code) do nothing;
notify pgrst, 'reload schema';
