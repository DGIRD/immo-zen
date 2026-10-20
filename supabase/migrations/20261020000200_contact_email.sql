-- =====================================================================
-- Immo-Zen – Formulaire « Être recontacté » du site : chaque demande est aussi envoyée par e-mail
-- à l'adresse de contact (app_config.support_email, sinon contact@immo-zen.fr), avec l'adresse
-- du visiteur en « répondre à ». Annulation : rollback/20261020000200_contact_email.down.sql
-- =====================================================================

-- Messages sans compte utilisateur (demande d'un visiteur) et adresse de réponse par message
alter table public.email_outbox alter column user_id drop not null;
alter table public.email_outbox add column if not exists reply_to text check (reply_to is null or (reply_to ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(reply_to) <= 200));
alter table public.email_outbox drop constraint if exists email_outbox_kind_check;
alter table public.email_outbox add constraint email_outbox_kind_check
  check (kind in ('confirmation_paiement','quittance','relance','relance_a_valider','invitation_locataire','contact_site'));
alter table public.email_outbox drop constraint if exists email_outbox_user_check;
alter table public.email_outbox add constraint email_outbox_user_check check (user_id is not null or kind = 'contact_site');

create or replace function public.iz_submit_lead(p_name text, p_email text, p_phone text, p_message text, p_topic text default null, p_website text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_to text; v_topic text;
begin
  if coalesce(p_website, '') <> '' then return true; end if;            -- champ piège rempli : robot, ignoré sans erreur
  p_name := trim(coalesce(p_name, '')); p_email := lower(trim(coalesce(p_email, '')));
  if char_length(p_name) not between 2 and 200 then raise exception 'Indiquez votre nom.' using errcode = 'check_violation'; end if;
  if p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(p_email) > 200 then raise exception 'Adresse e-mail invalide.' using errcode = 'check_violation'; end if;
  if char_length(coalesce(p_message, '')) > 4000 or char_length(coalesce(p_phone, '')) > 40 then raise exception 'Message trop long.' using errcode = 'check_violation'; end if;
  if (select count(*) from platform_leads where email = p_email and created_at > now() - interval '1 day') >= 3
     or (select count(*) from platform_leads where source like 'Site%' and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Trop de demandes : réessayez plus tard.' using errcode = 'check_violation';
  end if;
  v_topic := nullif(trim(coalesce(p_topic, '')), '');
  insert into platform_leads (name, email, phone, source, status, notes)
  values (left(p_name, 200), p_email, nullif(left(trim(coalesce(p_phone, '')), 40), ''),
          left('Site' || coalesce(' – ' || v_topic, ''), 120), 'nouveau', nullif(left(trim(coalesce(p_message, '')), 4000), ''))
  returning id into v_id;

  -- notification à l'équipe (adresse de support réglée en administration, sinon contact@immo-zen.fr)
  select coalesce(nullif(trim(support_email), ''), 'contact@immo-zen.fr') into v_to from app_config limit 1;
  insert into email_outbox (user_id, kind, to_emails, subject, body_text, reply_to, dedupe_key)
  values (null, 'contact_site', array[coalesce(v_to, 'contact@immo-zen.fr')],
    left('Site Immo-Zen – ' || coalesce(v_topic, 'Demande de contact') || ' – ' || left(p_name, 200), 200),
    'Nouvelle demande reçue depuis le formulaire « Être recontacté » du site.' || chr(10) || chr(10) ||
    'Nom : ' || left(p_name, 200) || chr(10) ||
    'E-mail : ' || p_email || chr(10) ||
    'Téléphone : ' || coalesce(nullif(left(trim(coalesce(p_phone, '')), 40), ''), '—') || chr(10) ||
    'Sujet : ' || coalesce(v_topic, '—') || chr(10) || chr(10) ||
    'Message :' || chr(10) || coalesce(nullif(left(trim(coalesce(p_message, '')), 4000), ''), '(aucun message)') || chr(10) || chr(10) ||
    'Répondez directement à cet e-mail pour écrire au visiteur. La demande figure aussi dans Administration → Prospects commerciaux.',
    p_email, 'contact:' || v_id);
  return true;
end $$;
revoke all on function public.iz_submit_lead(text, text, text, text, text, text) from public;
grant execute on function public.iz_submit_lead(text, text, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
