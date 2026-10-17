-- =====================================================================
-- Immo-Zen : import des loyers, révision annuelle selon l'IRL, rappel de charges sur quittance.
-- Additive et idempotente. Annulation : supabase/rollback/20261017000300_loyers_irl_rappels.down.sql
-- =====================================================================

-- ---------- Import des loyers : empreinte anti-doublon
alter table public.payments add column if not exists import_ref text check (char_length(import_ref) <= 128);
create unique index if not exists payments_import_ref_uq on public.payments(user_id, import_ref) where import_ref is not null;

-- ---------- Révision IRL
alter table public.leases
  add column if not exists irl_enabled boolean not null default false,
  -- trimestre de référence au format AAAA-Tn (ex. 2025-T2) et sa valeur figurant au bail ou à la dernière révision
  add column if not exists irl_base_label text check (irl_base_label ~ '^\d{4}-T[1-4]$'),
  add column if not exists irl_base_value numeric(7,2) check (irl_base_value > 0),
  add column if not exists last_revision_on date;

create table if not exists public.lease_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lease_id uuid not null,
  effective_on date not null,
  old_rent numeric(12,2) not null,
  new_rent numeric(12,2) not null check (new_rent > 0),
  old_index_label text not null,
  old_index numeric(7,2) not null check (old_index > 0),
  new_index_label text not null,
  new_index numeric(7,2) not null check (new_index > 0),
  charges_updated int not null default 0,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (lease_id, user_id) references public.leases(id, user_id) on delete cascade
);
create index if not exists lease_revisions_lease_idx on public.lease_revisions(user_id, lease_id, effective_on desc);
alter table public.lease_revisions enable row level security;
drop policy if exists lease_revisions_select on public.lease_revisions;
create policy lease_revisions_select on public.lease_revisions for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete on public.lease_revisions from authenticated, anon;
grant select on public.lease_revisions to authenticated;

-- Révision : vérifie le bail, le DPE, l'année écoulée et l'augmentation ; met à jour le loyer, l'indice de référence
-- et les échéances non encore réglées à partir de la date d'effet ; trace la révision.
create or replace function public.iz_revise_rent(p_lease uuid, p_effective date, p_old_label text, p_old_index numeric, p_new_label text, p_new_index numeric)
returns public.lease_revisions language plpgsql security definer set search_path = public as $$
declare l leases%rowtype; p properties%rowtype; v_new numeric; v_count int; r lease_revisions%rowtype;
begin
  select * into l from leases where id = p_lease and user_id = auth.uid() for update;
  if not found then raise exception 'Bail introuvable.' using errcode = 'insufficient_privilege'; end if;
  if to_regprocedure('public.iz_has_access()') is not null and not public.iz_has_access() then
    raise exception 'Accès en consultation seule : abonnement requis.' using errcode = 'insufficient_privilege';
  end if;
  if not l.irl_enabled then raise exception 'La révision annuelle n''est pas prévue dans ce bail.' using errcode = 'check_violation'; end if;
  select * into p from properties where id = l.property_id;
  if p.dpe in ('F', 'G') then
    raise exception 'Logement classé % au DPE : révision du loyer interdite (gel des loyers).', p.dpe using errcode = 'check_violation';
  end if;
  if p_old_index is null or p_new_index is null or p_old_index <= 0 or p_new_index <= 0 then
    raise exception 'Indices IRL manquants.' using errcode = 'check_violation';
  end if;
  if p_effective < l.start_date + interval '1 year' then
    raise exception 'Première révision possible un an après le début du bail.' using errcode = 'check_violation';
  end if;
  -- une révision par année de bail (comptée depuis la date anniversaire)
  if l.last_revision_on is not null
     and l.last_revision_on >= (l.start_date + make_interval(years => date_part('year', age(p_effective, l.start_date))::int))::date then
    raise exception 'Le loyer a déjà été révisé le % pour cette année de bail.', to_char(l.last_revision_on, 'DD/MM/YYYY') using errcode = 'check_violation';
  end if;
  if p_effective > iz_today_paris() + 31 then
    raise exception 'Date d''effet trop lointaine.' using errcode = 'check_violation';
  end if;
  v_new := round(l.rent_hc * p_new_index / p_old_index, 2);
  update leases set rent_hc = v_new, irl_base_label = p_new_label, irl_base_value = p_new_index, last_revision_on = p_effective where id = l.id;
  -- échéances de loyer de mois entiers, non annulées et sans paiement, à partir de la date d'effet
  update rent_charges c set rent_amount = v_new
   where c.lease_id = l.id and c.kind = 'loyer' and c.cancelled_at is null and c.period_start >= p_effective
     and extract(day from c.period_start) = 1 and c.period_end = (date_trunc('month', c.period_start) + interval '1 month - 1 day')::date
     and not exists (select 1 from payment_allocations a where a.charge_id = c.id);
  get diagnostics v_count = row_count;
  insert into lease_revisions (user_id, lease_id, effective_on, old_rent, new_rent, old_index_label, old_index, new_index_label, new_index, charges_updated)
  values (l.user_id, l.id, p_effective, l.rent_hc, v_new, p_old_label, p_old_index, p_new_label, p_new_index, v_count)
  returning * into r;
  insert into timeline_events (user_id, property_id, kind, summary, data)
  values (l.user_id, l.property_id, 'note', 'Loyer révisé (IRL) : ' || iz_eur(l.rent_hc) || ' → ' || iz_eur(v_new) || ' à compter du ' || to_char(p_effective, 'DD/MM/YYYY'),
          jsonb_build_object('lease_id', l.id, 'revision_id', r.id));
  return r;
end $$;
revoke all on function public.iz_revise_rent(uuid, date, text, numeric, text, numeric) from public, anon;
grant execute on function public.iz_revise_rent(uuid, date, text, numeric, text, numeric) to authenticated;

-- ---------- Rappel de charges repris sur la quittance du mois
alter table public.receipts add column if not exists extra_lines jsonb not null default '[]'::jsonb;

-- Une somme due déjà reprise sur une quittance (comme rappel) ne peut pas être quittancée une seconde fois
create or replace function public.iz_charge_receipted(p_charge uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from receipts r where r.cancelled_at is null and r.kind = 'quittance'
                  and (r.charge_id = p_charge or r.extra_lines @> jsonb_build_array(jsonb_build_object('charge_id', p_charge::text))))
$$;
revoke all on function public.iz_charge_receipted(uuid) from public, anon;

create or replace function public.iz_issue_receipt_with_extras(p_charge uuid, p_extras uuid[])
returns public.receipts language plpgsql security definer set search_path = public as $$
declare c rent_charges%rowtype; x rent_charges%rowtype; r receipts%rowtype; v_lines jsonb := '[]'::jsonb; v_sum numeric := 0; v_id uuid;
begin
  select * into c from rent_charges where id = p_charge and user_id = auth.uid() for update;
  if not found then raise exception 'Échéance introuvable.' using errcode = 'insufficient_privilege'; end if;
  if iz_charge_receipted(c.id) then
    raise exception 'Une quittance existe déjà pour cette période : annulez-la pour en émettre une avec le rappel de charges.' using errcode = 'check_violation';
  end if;
  foreach v_id in array coalesce(p_extras, '{}') loop
    select * into x from rent_charges where id = v_id and user_id = auth.uid() for update;
    if not found or x.lease_id <> c.lease_id or x.id = c.id or x.kind = 'loyer' then
      raise exception 'Rappel de charges invalide (autre bail ou échéance de loyer).' using errcode = 'check_violation';
    end if;
    if x.cancelled_at is not null then raise exception 'Somme due annulée.' using errcode = 'check_violation'; end if;
    if iz_charge_allocated(x.id) < x.rent_amount + x.charges_amount then
      raise exception 'Le rappel « % » n''est pas intégralement réglé.', coalesce(x.label, 'Régularisation') using errcode = 'check_violation';
    end if;
    if iz_charge_receipted(x.id) then raise exception 'Le rappel « % » figure déjà sur une quittance.', coalesce(x.label, 'Régularisation') using errcode = 'check_violation'; end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('charge_id', x.id::text, 'label', coalesce(x.label, 'Rappel de charges'), 'amount', x.rent_amount + x.charges_amount));
    v_sum := v_sum + x.rent_amount + x.charges_amount;
  end loop;
  r := iz__issue_receipt(c.id, 'quittance');
  update receipts set extra_lines = v_lines, paid_amount = paid_amount + v_sum where id = r.id returning * into r;
  return r;
end $$;
revoke all on function public.iz_issue_receipt_with_extras(uuid, uuid[]) from public, anon;
grant execute on function public.iz_issue_receipt_with_extras(uuid, uuid[]) to authenticated;

-- Quittance seule d'une somme due : refusée si elle figure déjà en rappel sur une autre quittance
create or replace function public.iz_issue_receipt(p_charge uuid, p_kind text default 'quittance')
returns public.receipts language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from rent_charges where id = p_charge and user_id = auth.uid()) then
    raise exception 'Échéance introuvable.' using errcode = 'insufficient_privilege';
  end if;
  if p_kind = 'quittance' and exists (select 1 from receipts r where r.cancelled_at is null and r.kind = 'quittance'
       and r.extra_lines @> jsonb_build_array(jsonb_build_object('charge_id', p_charge::text))) then
    raise exception 'Cette somme figure déjà en rappel de charges sur une quittance.' using errcode = 'check_violation';
  end if;
  return iz__issue_receipt(p_charge, p_kind);
end $$;

notify pgrst, 'reload schema';
