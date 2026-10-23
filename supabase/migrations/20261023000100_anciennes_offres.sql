-- Immo-Zen – suppression des deux anciennes offres « Abonnement mensuel » et « Abonnement annuel » (avant les formules).
-- Une offre encore rattachée à un abonnement est conservée (masquée en administration) pour ne pas perdre l'historique.
-- Annulation : rollback/20261023000100_anciennes_offres.down.sql
delete from public.plans p
 where p.code in ('mensuel', 'annuel')
   and not exists (select 1 from public.subscriptions s where s.plan_code = p.code);
notify pgrst, 'reload schema';
