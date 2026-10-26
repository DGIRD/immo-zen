-- =====================================================================
-- Changement de la date de début d'un bail (26/10/2026)
-- Une date de début saisie par erreur (ex. 1990 au lieu de 2024) laissait les
-- échéances des années fausses. Désormais, quand la date change :
--   * les échéances de loyer antérieures à la nouvelle date sont supprimées,
--     ainsi que celle du premier mois incomplet si la date recule (prorata) ;
--   * la modification est refusée si l'une d'elles a reçu un paiement ou une
--     quittance / un reçu non annulé ;
--   * l'application régénère ensuite l'échéancier (iz_generate_rent_charges).
-- Une date de début antérieure à 1950 est refusée (erreur de frappe).
-- Même règle côté application : src/domain/rental.ts (startChangeImpact).
-- =====================================================================

create or replace function public.iz_lease_rules()
returns trigger language plpgsql set search_path = public as $$
declare v_ids uuid[]; v_blocked int;
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
    select coalesce(array_agg(c.id), '{}') into v_ids from rent_charges c
     where c.lease_id = new.id and c.kind = 'loyer'
       and (c.period_start < new.start_date
            or (new.start_date < old.start_date and extract(day from old.start_date) <> 1 and c.period_start = old.start_date));
    if cardinality(v_ids) > 0 then
      select count(*) into v_blocked from rent_charges c
       where c.id = any(v_ids)
         and (exists (select 1 from payment_allocations a where a.charge_id = c.id and a.amount > 0)
              or exists (select 1 from receipts r where r.charge_id = c.id and r.cancelled_at is null));
      if v_blocked > 0 then
        raise exception '% échéance(s) concernée(s) par la nouvelle date de début ont reçu un paiement ou une quittance : retirez-les avant de modifier la date.', v_blocked
          using errcode = 'check_violation';
      end if;
      update reminders r set charge_ids = array(select x from unnest(r.charge_ids) x where x <> all(v_ids))
       where r.lease_id = new.id and r.charge_ids && v_ids;
      delete from rent_charges c where c.id = any(v_ids);
    end if;
  end if;
  -- Fin de bail avancée : les échéances futures sans paiement sont annulées
  if tg_op = 'UPDATE' and new.end_date is not null and (old.end_date is null or new.end_date < old.end_date) then
    update rent_charges c set cancelled_at = now()
     where c.lease_id = new.id and c.kind = 'loyer' and c.period_start > new.end_date and c.cancelled_at is null
       and not exists (select 1 from payment_allocations a where a.charge_id = c.id);
  end if;
  return new;
end $$;
