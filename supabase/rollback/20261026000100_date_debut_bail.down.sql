-- Annulation de 20261026000100_date_debut_bail.sql : règles du bail du lot 2.
create or replace function public.iz_lease_rules()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.property_id <> old.property_id then
    if not exists (select 1 from properties p where p.id = new.property_id and p.user_id = new.user_id and p.status = 'acquis') then
      raise exception 'Un bail ne peut concerner qu''un bien détenu (rubrique Mes biens).' using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.property_id <> old.property_id
     and exists (select 1 from rent_charges c where c.lease_id = old.id) then
    raise exception 'Le bien d''un bail ayant des échéances ne peut pas être changé.' using errcode = 'check_violation';
  end if;
  -- Fin de bail avancée : les échéances futures sans paiement sont annulées
  if tg_op = 'UPDATE' and new.end_date is not null and (old.end_date is null or new.end_date < old.end_date) then
    update rent_charges c set cancelled_at = now()
     where c.lease_id = new.id and c.kind = 'loyer' and c.period_start > new.end_date and c.cancelled_at is null
       and not exists (select 1 from payment_allocations a where a.charge_id = c.id);
  end if;
  return new;
end $$;
drop function if exists public.iz_clean_lease_schedule(uuid);
drop function if exists public.iz__purge_lease_charges(uuid, date, date);
