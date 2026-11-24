-- Mon compte > Informations personnelles : emprunteur(s), situation, revenus, épargne et crédits hors biens.
-- Pré-remplissent le dossier banque et l'offre d'achat. Accès réservé au titulaire du compte (RLS de user_settings).
alter table public.user_settings add column if not exists personal_info jsonb not null default '{}'::jsonb;
comment on column public.user_settings.personal_info is 'Informations personnelles (dossier banque, offre d''achat) : visibles du seul titulaire';
