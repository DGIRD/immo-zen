-- Renvoi par e-mail d'une quittance (ou d'un reçu) déjà envoyée ou dont l'envoi a échoué.
-- Adresses actuelles des locataires du bail (fiche locataire), à défaut celles du document.
-- Garde-fous : un seul envoi en attente par document, 5 envois au plus par document sur 24 heures.
create or replace function public.iz_resend_receipt_email(p_receipt uuid)
returns public.email_outbox language plpgsql security definer set search_path = public as $$
declare r receipts%rowtype; o email_outbox%rowtype; v_emails text[]; v_label text;
begin
  select * into r from receipts where id = p_receipt and user_id = auth.uid();
  if not found then raise exception 'Document introuvable.' using errcode = 'insufficient_privilege'; end if;
  if r.cancelled_at is not null then raise exception 'Document supprimé : il ne peut pas être renvoyé.' using errcode = 'check_violation'; end if;
  perform pg_advisory_xact_lock(hashtextextended('iz_renvoi:' || r.id::text, 0));
  select coalesce(array_agg(distinct trim(t.email)) filter (where nullif(trim(t.email), '') is not null), '{}')
    into v_emails
    from lease_tenants lt join tenants t on t.id = lt.tenant_id
   where lt.lease_id = r.lease_id and (lt.left_on is null or lt.left_on >= r.period_start);
  if cardinality(v_emails) = 0 then v_emails := r.tenant_emails; end if;
  if cardinality(v_emails) = 0 then
    raise exception 'Aucune adresse e-mail de locataire : renseignez-la dans la fiche locataire.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from email_outbox where receipt_id = r.id and status in ('a_envoyer', 'en_cours')) then
    raise exception 'Un envoi de ce document est déjà en attente : il part dans quelques minutes.' using errcode = 'check_violation';
  end if;
  if (select count(*) from email_outbox where receipt_id = r.id and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'Ce document a déjà été envoyé 5 fois en 24 heures : réessayez demain.' using errcode = 'check_violation';
  end if;
  v_label := case r.kind when 'quittance' then 'Quittance de loyer' else 'Reçu de paiement partiel' end;
  insert into email_outbox (user_id, kind, to_emails, subject, body_text, receipt_id, lease_id, charge_id, dedupe_key)
  values (r.user_id, 'quittance', v_emails,
          v_label || ' – ' || to_char(r.period_start, 'MM/YYYY'),
          'Bonjour,' || chr(10) || chr(10) || 'Veuillez trouver ci-joint, de nouveau, votre ' || lower(v_label) || ' n° ' || r.number
            || ' pour la période du ' || to_char(r.period_start, 'DD/MM/YYYY') || ' au ' || to_char(r.period_end, 'DD/MM/YYYY') || '.'
            || chr(10) || chr(10) || 'Cordialement,' || chr(10) || coalesce(r.landlord_name, ''),
          r.id, r.lease_id, r.charge_id, 'recu:' || r.id || ':renvoi:' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'))
  returning * into o;
  update receipts set tenant_emails = v_emails, send_status = 'a_envoyer', send_error = null where id = r.id;
  return o;
end $$;
revoke all on function public.iz_resend_receipt_email(uuid) from public, anon;
grant execute on function public.iz_resend_receipt_email(uuid) to authenticated;
