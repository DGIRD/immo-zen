-- =====================================================================
-- Date de début d'un bail (26/10/2026)
-- Une date de début saisie par erreur (ex. 1990 au lieu de 2024) laissait les
-- échéances des années fausses, et les vrais paiements s'y répartissaient.
-- Désormais, quand la date change (ou à la demande, iz_clean_lease_schedule) :
--   * les échéances de loyer antérieures à la date de début sont supprimées,
--     ainsi que celle du premier mois incomplet si la date recule (prorata) ;
--   * leurs paiements restent enregistrés ; l'application les réaffecte aux
--     nouvelles échéances, du plus ancien au plus récent ;
--   * refus si l'une d'elles est couverte par une quittance ou un reçu non annulé ;
--   * l'application régénère ensuite l'échéancier (iz_generate_rent_charges).
-- Une date de début antérieure à 1950 est refusée (erreur de frappe).
-- Même règle côté application : src/domain/rental.ts (startChangeImpact).
-- =====================================================================

-- Suppression des échéances de loyer antérieures au début du bail (nombre supprimé)
create or replace function public.iz__purge_lease_charges(p_lease uuid, p_start date, p_old_start date)
returns int language plpgsql security invoker set search_path = public as $$
declare v_ids uuid[]; v_blocked int;
begin
  select coalesce(array_agg(c.id), '{}') into v_ids from rent_charges c
   where c.lease_id = p_lease and c.kind = 'loyer'
     and (c.period_start < p_start
          or (p_start < p_old_start and extract(day from p_old_start) <> 1 and c.period_start = p_old_start));
  if cardinality(v_ids) = 0 then return 0; end if;
  select count(*) into v_blocked from rent_charges c
   where c.id = any(v_ids) and exists (select 1 from receipts r where r.charge_id = c.id and r.cancelled_at is null);
  if v_blocked > 0 then
    raise exception '% échéance(s) antérieure(s) à la date de début sont couvertes par une quittance ou un reçu : annulez-les avant de modifier la date.', v_blocked
      using errcode = 'check_violation';
  end if;
  update reminders r set charge_ids = array(select x from unnest(r.charge_ids) x where x <> all(v_ids))
   where r.lease_id = p_lease and r.charge_ids && v_ids;
  -- les paiements restent enregistrés ; leur répartition sur ces échéances est retirée (réaffectée ensuite)
  delete from payment_allocations a where a.charge_id = any(v_ids);
  delete from rent_charges c where c.id = any(v_ids);
  return cardinality(v_ids);
end $$;
revoke all on function public.iz__purge_lease_charges(uuid, date, date) from public, anon;
grant execute on function public.iz__purge_lease_charges(uuid, date, date) to authenticated;  -- sécurité de l'appelant : RLS appliquée

-- Nettoyage à la demande d'un bail dont la date est déjà correcte (échéances d'avant restées)
create or replace function public.iz_clean_lease_schedule(p_lease uuid)
returns int language plpgsql security invoker set search_path = public as $$
declare l leases%rowtype;
begin
  select * into l from leases where id = p_lease;   -- RLS : seul le propriétaire du bail le voit
  if not found then raise exception 'Bail introuvable.'; end if;
  return iz__purge_lease_charges(l.id, l.start_date, l.start_date);
end $$;
revoke all on function public.iz_clean_lease_schedule(uuid) from public, anon;
grant execute on function public.iz_clean_lease_schedule(uuid) to authenticated;

create or replace function public.iz_lease_rules()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.property_id <> old.property_id then
    if not exists (select 1 from properties p where p.id = new.property_id and p.user_id = new.user_id and p.status = 'acquis') then
      raise exception 'Un bail ne peut concerner qu''un bien détenu (rubrique Mes biens).' using errcode = 'check_violation';
    end if;
  end if;
  if (tg_op = 'INSERT' or new.start_date <> old.start_date) and new.start_date < date '1950-01-01' then
    raise exception 'Date de début improbable (avant 1950) : vérifiez l''année.' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and new.property_id <> old.property_id
     and exists (select 1 from rent_charges c where c.lease_id = old.id) then
    raise exception 'Le bien d''un bail ayant des échéances ne peut pas être changé.' using errcode = 'check_violation';
  end if;
  -- Nouvelle date de début : échéances devenues fausses supprimées (régénérées ensuite)
  if tg_op = 'UPDATE' and new.start_date <> old.start_date then
    perform iz__purge_lease_charges(new.id, new.start_date, old.start_date);
  end if;
  -- Fin de bail avancée : les échéances futures sans paiement sont annulées
  if tg_op = 'UPDATE' and new.end_date is not null and (old.end_date is null or new.end_date < old.end_date) then
    update rent_charges c set cancelled_at = now()
     where c.lease_id = new.id and c.kind = 'loyer' and c.period_start > new.end_date and c.cancelled_at is null
       and not exists (select 1 from payment_allocations a where a.charge_id = c.id);
  end if;
  return new;
end $$;
