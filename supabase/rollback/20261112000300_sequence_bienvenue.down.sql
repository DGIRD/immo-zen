-- Annulation de 20261112000300_sequence_bienvenue.sql : retour aux fonctions de 20261112000200_inscriptions_site.sql
create or replace function public.iz_confirm_subscription(p_token uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_done timestamptz;
begin
  select id, confirmed_at into v_id, v_done from site_subscribers where confirm_token = p_token and unsubscribed_at is null;
  if v_id is null then return 'inconnu'; end if;
  if v_done is not null then return 'deja'; end if;
  update site_subscribers set confirmed_at = now(), updated_at = now() where id = v_id;
  return 'confirme';
end $$;
create or replace function public.iz_unsubscribe(p_token uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  update site_subscribers set unsubscribed_at = coalesce(unsubscribed_at, now()), marketing_consent = false,
         irl_alert_month = null, paris_alert = false, updated_at = now()
   where unsubscribe_token = p_token returning id into v_id;
  return case when v_id is null then 'inconnu' else 'desinscrit' end;
end $$;
create or replace function public.iz_site_alerts(p_today date default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_today date := coalesce(p_today, (now() at time zone 'Europe/Paris')::date); v_n int;
begin
  insert into email_outbox (user_id, kind, to_emails, subject, body_text, dedupe_key)
  select null, 'alerte_irl', array[s.email], 'Rappel : la révision annuelle de votre loyer',
    'Bonjour,' || chr(10) || chr(10) ||
    'Comme vous l’avez demandé, voici votre rappel : ce mois-ci, votre bail arrive à sa date de révision.' || chr(10) || chr(10) ||
    'Si votre bail prévoit la révision annuelle, calculez le nouveau loyer avec le dernier indice de référence des loyers (IRL) publié par l’Insee, et obtenez la lettre à envoyer au locataire :' || chr(10) ||
    'https://immo-zen.fr/outils/revision-loyer-irl.html' || chr(10) || chr(10) ||
    'À savoir : la révision n’est pas rétroactive, et le loyer d’un logement classé F ou G ne peut plus être augmenté.' || chr(10) || chr(10) ||
    'Ne plus recevoir ce rappel : https://immo-zen.fr/inscription.html?desinscrire=' || s.unsubscribe_token,
    'alerte-irl:' || s.id || ':' || extract(year from v_today)::int
  from site_subscribers s
  where s.irl_alert_month = extract(month from v_today)::int
    and s.confirmed_at is not null and s.unsubscribed_at is null
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  delete from email_outbox where kind in ('inscription_site', 'alerte_irl')
     and status in ('envoye', 'echec', 'annule') and created_at < now() - interval '30 days';
  return v_n;
end $$;
drop function if exists public.iz_welcome_message(int, uuid);
delete from public.email_outbox where kind = 'bienvenue';
alter table public.email_outbox drop constraint if exists email_outbox_kind_check;
alter table public.email_outbox add constraint email_outbox_kind_check
  check (kind in ('confirmation_paiement','quittance','relance','relance_a_valider','invitation_locataire','contact_site','facture_abonnement','alerte_exploitation','inscription_site','alerte_irl'));
alter table public.email_outbox drop constraint if exists email_outbox_user_check;
alter table public.email_outbox add constraint email_outbox_user_check
  check (user_id is not null or kind in ('contact_site', 'alerte_exploitation', 'inscription_site', 'alerte_irl'));
alter table public.site_subscribers drop column if exists welcome_step;
notify pgrst, 'reload schema';
