-- =====================================================================
-- Immo-Zen – Modification et réédition des quittances et reçus.
-- Une quittance émise n'est jamais modifiée en place : la réédition annule le document d'origine
-- (motif « Remplacé par … ») et en émet un nouveau, numéroté à la suite, avec les données actuelles du
-- bail et des locataires, éventuellement corrigées (bailleur, locataires, logement, date d'émission).
-- Annulation : rollback/20261023000200_reedition_quittances.down.sql
-- =====================================================================
create or replace function public.iz_reissue_receipt(p_receipt uuid, p_changes jsonb default '{}'::jsonb)
returns public.receipts language plpgsql security definer set search_path = public as $$
declare
  o receipts%rowtype;
  n receipts%rowtype;
  v_extras uuid[];
  v_issued date;
  c jsonb := coalesce(p_changes, '{}'::jsonb);
begin
  select * into o from receipts where id = p_receipt and user_id = auth.uid() for update;
  if not found then raise exception 'Document introuvable.' using errcode = 'P0002'; end if;
  if o.cancelled_at is not null then raise exception 'Document annulé : il ne peut plus être modifié.' using errcode = 'check_violation'; end if;
  if jsonb_typeof(c) <> 'object' then raise exception 'Modifications invalides.' using errcode = 'check_violation'; end if;
  if char_length(coalesce(c->>'landlord_name', '')) > 200 or char_length(coalesce(c->>'landlord_address', '')) > 500
     or char_length(coalesce(c->>'tenant_names', '')) > 500 or char_length(coalesce(c->>'property_address', '')) > 500 then
    raise exception 'Texte trop long.' using errcode = 'check_violation';
  end if;
  if c ? 'tenant_names' and trim(coalesce(c->>'tenant_names', '')) = '' then
    raise exception 'Indiquez le nom du ou des locataires.' using errcode = 'check_violation';
  end if;
  if nullif(c->>'issued_on', '') is not null then
    begin v_issued := (c->>'issued_on')::date;
    exception when others then raise exception 'Date d''émission invalide.' using errcode = 'check_violation'; end;
    if v_issued > (now() at time zone 'Europe/Paris')::date then raise exception 'La date d''émission ne peut pas être dans le futur.' using errcode = 'check_violation'; end if;
    if v_issued < o.period_start - 31 then raise exception 'La date d''émission précède la période.' using errcode = 'check_violation'; end if;
  end if;

  -- annulation du document d'origine (et de son envoi s'il était encore en file)
  update receipts set cancelled_at = now(), cancel_reason = 'Réédition' where id = o.id;
  update email_outbox set status = 'annule' where receipt_id = o.id and status = 'a_envoyer';

  -- nouveau document avec les données actuelles (rappels de charges conservés)
  if o.kind = 'quittance' and jsonb_array_length(coalesce(o.extra_lines, '[]'::jsonb)) > 0 then
    select array_agg((e->>'charge_id')::uuid) into v_extras from jsonb_array_elements(o.extra_lines) e;
    n := iz_issue_receipt_with_extras(o.charge_id, v_extras);
  else
    n := iz__issue_receipt(o.charge_id, o.kind);
  end if;

  update receipts set
    landlord_name = case when c ? 'landlord_name' then nullif(trim(c->>'landlord_name'), '') else landlord_name end,
    landlord_address = case when c ? 'landlord_address' then nullif(trim(c->>'landlord_address'), '') else landlord_address end,
    tenant_names = case when c ? 'tenant_names' then trim(c->>'tenant_names') else tenant_names end,
    property_address = case when c ? 'property_address' then nullif(trim(c->>'property_address'), '') else property_address end,
    issued_on = coalesce(v_issued, issued_on)
  where id = n.id returning * into n;
  update receipts set cancel_reason = 'Remplacé par ' || case n.kind when 'quittance' then 'la quittance' else 'le reçu' end || ' n° ' || n.number
   where id = o.id;
  return n;
end $$;
revoke all on function public.iz_reissue_receipt(uuid, jsonb) from public, anon;
grant execute on function public.iz_reissue_receipt(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
