-- =====================================================================
-- Immo-Zen – Séquence de bienvenue automatique des inscrits du site
--   Étape 1 : à la confirmation (double opt-in) d'un accord « conseils et offres » ;
--   étape 2 : 4 jours après (ce que coûterait une agence, lien vers le calculateur d'économies) ;
--   étape 3 : 10 jours après (essai gratuit), sauf pour une adresse qui a déjà un compte.
-- Envoyée par la file d'e-mails (type « bienvenue ») ; l'avancement est noté dans site_subscribers.welcome_step,
-- ce qui empêche tout second envoi. Une désinscription arrête la séquence.
-- Annulation : rollback/20261112000300_sequence_bienvenue.down.sql
-- =====================================================================

alter table public.site_subscribers add column if not exists welcome_step smallint not null default 0 check (welcome_step between 0 and 3);

alter table public.email_outbox drop constraint if exists email_outbox_kind_check;
alter table public.email_outbox add constraint email_outbox_kind_check
  check (kind in ('confirmation_paiement','quittance','relance','relance_a_valider','invitation_locataire','contact_site','facture_abonnement','alerte_exploitation','inscription_site','alerte_irl','bienvenue'));
alter table public.email_outbox drop constraint if exists email_outbox_user_check;
alter table public.email_outbox add constraint email_outbox_user_check
  check (user_id is not null or kind in ('contact_site', 'alerte_exploitation', 'inscription_site', 'alerte_irl', 'bienvenue'));

-- Texte d'une étape (1 à 3) de la séquence, avec le lien de désinscription de l'inscrit
create or replace function public.iz_welcome_message(p_step int, p_unsub uuid, out subject text, out body text)
language plpgsql immutable set search_path = public as $$
declare v_end text := chr(10) || chr(10) || 'David, fondateur d’Immo-Zen' || chr(10) || chr(10) ||
  'Vous recevez ce message parce que vous avez accepté de recevoir les conseils et offres d’Immo-Zen. Se désinscrire : https://immo-zen.fr/inscription.html?desinscrire=' || p_unsub;
begin
  if p_step = 1 then
    subject := 'Bienvenue chez Immo-Zen';
    body := 'Bonjour,' || chr(10) || chr(10) ||
      'Merci d’avoir confirmé votre inscription. Environ une fois par mois, vous recevrez une actualité, un calcul et un conseil pour les propriétaires bailleurs.' || chr(10) || chr(10) ||
      'Pour commencer : si vous avez un bien en vue, le simulateur de cash-flow vous donne en une minute ce qu’il vous coûtera ou rapportera chaque mois.' || chr(10) ||
      'https://immo-zen.fr/outils/simulateur-cash-flow.html' || chr(10) || chr(10) ||
      'Et pour un bien déjà loué, l’outil de révision de loyer calcule le nouveau loyer avec le dernier indice publié :' || chr(10) ||
      'https://immo-zen.fr/outils/revision-loyer-irl.html' || v_end;
  elsif p_step = 2 then
    subject := 'Combien vous coûterait une agence ?';
    body := 'Bonjour,' || chr(10) || chr(10) ||
      'Une agence facture la gestion d’un logement environ 7 à 12 % TTC des loyers, plus jusqu’à un mois de loyer à chaque nouveau locataire. Pour un logement loué 800 € par mois, c’est environ 1 070 € par an (8,4 % TTC, et un changement de locataire tous les 3 ans).' || chr(10) || chr(10) ||
      'Ce que vous payez surtout, c’est le suivi : échéances, encaissements, quittances, relances, révision du loyer. Immo-Zen le prépare à votre place, et rien n’est envoyé à vos locataires sans votre validation.' || chr(10) || chr(10) ||
      'Faites le calcul avec vos propres chiffres :' || chr(10) || 'https://immo-zen.fr/#economies' || chr(10) || chr(10) ||
      'Estimation indicative, avant impôts : ce n’est pas une garantie.' || v_end;
  else
    subject := '30 jours pour essayer Immo-Zen, sans carte bancaire';
    body := 'Bonjour,' || chr(10) || chr(10) ||
      'Le plus simple pour juger, c’est d’essayer avec vos propres biens : 30 jours gratuits, sans carte bancaire.' || chr(10) || chr(10) ||
      'En quelques minutes : vos biens et vos baux, les loyers rapprochés chaque mois, les quittances, et les montants à reporter sur votre déclaration. Vous exportez vos données quand vous voulez.' || chr(10) || chr(10) ||
      'Les 300 premiers abonnés gardent −30 % à vie sur l’abonnement annuel.' || chr(10) ||
      'https://immo-zen.fr/app/' || v_end;
  end if;
end $$;
revoke all on function public.iz_welcome_message(int, uuid) from public, anon, authenticated;

-- Confirmation : étape 1 de la séquence quand l'accord « conseils et offres » est donné
create or replace function public.iz_confirm_subscription(p_token uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_sub site_subscribers%rowtype; m record;
begin
  select * into v_sub from site_subscribers where confirm_token = p_token and unsubscribed_at is null;
  if v_sub.id is null then return 'inconnu'; end if;
  if v_sub.confirmed_at is not null then return 'deja'; end if;
  update site_subscribers set confirmed_at = now(), updated_at = now(),
         welcome_step = case when marketing_consent then 1 else welcome_step end
   where id = v_sub.id;
  if v_sub.marketing_consent and v_sub.welcome_step = 0 then
    select * into m from iz_welcome_message(1, v_sub.unsubscribe_token);
    insert into email_outbox (user_id, kind, to_emails, subject, body_text, dedupe_key)
    values (null, 'bienvenue', array[v_sub.email], m.subject, m.body, 'bienvenue:1:' || v_sub.id)
    on conflict (dedupe_key) do nothing;
  end if;
  return 'confirme';
end $$;
revoke all on function public.iz_confirm_subscription(uuid) from public;
grant execute on function public.iz_confirm_subscription(uuid) to anon, authenticated;

-- Une ré-inscription après désinscription repart de zéro
create or replace function public.iz_unsubscribe(p_token uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  update site_subscribers set unsubscribed_at = coalesce(unsubscribed_at, now()), marketing_consent = false,
         irl_alert_month = null, paris_alert = false, welcome_step = 0, updated_at = now()
   where unsubscribe_token = p_token returning id into v_id;
  return case when v_id is null then 'inconnu' else 'desinscrit' end;
end $$;
revoke all on function public.iz_unsubscribe(uuid) from public;
grant execute on function public.iz_unsubscribe(uuid) to anon, authenticated;

-- Tâche quotidienne : rappels IRL, étapes 2 et 3 de la séquence, effacement après 30 jours
create or replace function public.iz_site_alerts(p_today date default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_today date := coalesce(p_today, (now() at time zone 'Europe/Paris')::date);
  v_n int; v_w int := 0; r record; m record; v_next int;
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

  -- séquence de bienvenue : étape 2 à J+4, étape 3 à J+10 après la confirmation (une étape par jour au plus)
  for r in
    select ss.* from site_subscribers ss
     where ss.marketing_consent and ss.confirmed_at is not null and ss.unsubscribed_at is null
       and ((ss.welcome_step = 1 and (ss.confirmed_at at time zone 'Europe/Paris')::date <= v_today - 4)
         or (ss.welcome_step = 2 and (ss.confirmed_at at time zone 'Europe/Paris')::date <= v_today - 10))
     for update
  loop
    v_next := r.welcome_step + 1;
    -- l'invitation à l'essai n'a pas de sens pour une adresse qui a déjà un compte
    if v_next = 3 and ('essai' = any(r.sources) or exists (select 1 from auth.users u where lower(u.email) = r.email)) then
      update site_subscribers set welcome_step = 3 where id = r.id;
      continue;
    end if;
    select * into m from iz_welcome_message(v_next, r.unsubscribe_token);
    insert into email_outbox (user_id, kind, to_emails, subject, body_text, dedupe_key)
    values (null, 'bienvenue', array[r.email], m.subject, m.body, 'bienvenue:' || v_next || ':' || r.id)
    on conflict (dedupe_key) do nothing;
    update site_subscribers set welcome_step = v_next where id = r.id;
    v_w := v_w + 1;
  end loop;

  -- minimisation : les messages envoyés aux visiteurs (et donc leur adresse) sont effacés après 30 jours
  delete from email_outbox where kind in ('inscription_site', 'alerte_irl', 'bienvenue')
     and status in ('envoye', 'echec', 'annule') and created_at < now() - interval '30 days';
  raise log 'iz_site_alerts : % rappel(s) IRL, % e-mail(s) de bienvenue', v_n, v_w;
  return v_n;
end $$;
revoke all on function public.iz_site_alerts(date) from public, anon, authenticated;

notify pgrst, 'reload schema';
