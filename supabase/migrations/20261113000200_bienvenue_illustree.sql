-- =====================================================================
-- Immo-Zen – E-mails de bienvenue illustrés
--   La file d'e-mails reçoit un gabarit (« bienvenue ») et ses données (étape, document, alertes,
--   lien de désinscription) : la fonction d'envoi en tire une version HTML illustrée (bandeau, captures
--   de l'application, boutons, lien LinkedIn) ; la version texte reste celle de body_text, réécrite
--   pour être plus directe.
-- Annulation : rollback/20261113000200_bienvenue_illustree.down.sql
-- =====================================================================

alter table public.email_outbox add column if not exists template text check (template is null or template in ('bienvenue'));
alter table public.email_outbox add column if not exists template_data jsonb;

-- Texte d'une étape (1 à 3) de la séquence, avec le lien de désinscription de l'inscrit
create or replace function public.iz_welcome_message(p_step int, p_unsub uuid, out subject text, out body text)
language plpgsql immutable set search_path = public as $$
declare v_end text := chr(10) || chr(10) || 'Suivez Immo-Zen sur LinkedIn : https://www.linkedin.com/company/immo-zen-investissement/' || chr(10) || chr(10) || 'David, fondateur d’Immo-Zen' || chr(10) || chr(10) ||
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
    subject := '800 € de loyer : combien vous coûterait une agence ?';
    body := 'Bonjour,' || chr(10) || chr(10) ||
      'Une agence vous coûterait environ 1 070 € par an, pour un seul logement loué 800 € par mois (8,4 % TTC des loyers, et un changement de locataire tous les 3 ans). Et si vous gardiez cet argent ?' || chr(10) || chr(10) ||
      'Avec Immo-Zen : 69 € par an, jusqu’à 3 biens (formule Essentiel en annuel, −30 % à vie pour les 300 premiers abonnés).' || chr(10) || chr(10) ||
      'Ce que vous payez vraiment à une agence, c’est le suivi. Immo-Zen le prépare pour vous :' || chr(10) ||
      '✓ les échéances de chaque bail, suivies automatiquement' || chr(10) ||
      '✓ les loyers encaissés, rapprochés chaque mois' || chr(10) ||
      '✓ les quittances, générées et envoyées en PDF' || chr(10) ||
      '✓ les relances d’impayés, prêtes à partir' || chr(10) ||
      '✓ la révision annuelle du loyer, calculée avec le bon indice' || chr(10) || chr(10) ||
      'Et vous gardez la main : aucune relance ne part à vos locataires sans votre accord.' || chr(10) || chr(10) ||
      'Faites le calcul avec vos loyers, en 30 secondes :' || chr(10) || 'https://immo-zen.fr/#economies' || chr(10) || chr(10) ||
      'Estimation indicative, avant impôts.' || chr(10) || chr(10) ||
      'P.-S. Vous gérez déjà vous-même ? Alors vous connaissez le temps que ça prend. C’est exactement ce temps qu’Immo-Zen vous rend.' || v_end;
  else
    subject := 'Votre essai de 30 jours vous attend (sans carte bancaire)';
    body := 'Bonjour,' || chr(10) || chr(10) ||
      '30 jours pour voir la différence, avec vos vrais biens. Sans carte bancaire, sans engagement.' || chr(10) || chr(10) ||
      'En quelques minutes, vous avez :' || chr(10) ||
      '✓ vos biens et vos baux, tout au même endroit' || chr(10) ||
      '✓ vos loyers rapprochés : payé, en retard, partiel, vous savez' || chr(10) ||
      '✓ vos quittances, générées et envoyées en un clic' || chr(10) ||
      '✓ les montants à reporter sur votre déclaration' || chr(10) || chr(10) ||
      'Offre fondateurs : −30 % à vie sur l’abonnement annuel pour les 300 premiers abonnés, dès 69 € par an.' || chr(10) || chr(10) ||
      'Démarrer mon essai gratuit : https://immo-zen.fr/app/' || chr(10) ||
      'Vos données restent exportables à tout moment, et à la fin de l’essai rien n’est supprimé.' || chr(10) || chr(10) ||
      'P.-S. Besoin d’un coup de main pour démarrer ? Répondez à cet e-mail : je vous aide à saisir votre premier bien.' || v_end;
  end if;
end $$;
revoke all on function public.iz_welcome_message(int, uuid) from public, anon, authenticated;


create or replace function public.iz_subscribe(
  p_email text, p_source text, p_marketing boolean default false, p_consent_text text default null,
  p_page text default null, p_params text default null, p_irl_month int default null,
  p_paris_alert boolean default false, p_website text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_site constant text := 'https://immo-zen.fr';
  v_email text := lower(trim(coalesce(p_email, '')));
  v_params text := nullif(trim(coalesce(p_params, '')), '');
  v_marketing boolean := coalesce(p_marketing, false);
  v_alert boolean := p_irl_month is not null or coalesce(p_paris_alert, false);
  v_keep boolean := v_marketing or v_alert;
  v_welcome boolean := false;
  v_sub site_subscribers%rowtype;
  v_subject text; v_intro text; v_extra text := ''; v_footer text;
  v_tool text; v_doc text; v_alerts text[] := '{}';
  v_li constant text := 'https://www.linkedin.com/company/immo-zen-investissement/';
begin
  if coalesce(p_website, '') <> '' then return 'ok'; end if;           -- champ piège rempli : robot, ignoré sans erreur
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 200 then
    raise exception 'Adresse e-mail invalide.' using errcode = 'check_violation';
  end if;
  if p_source is null or p_source not in ('calcul-cash-flow','calcul-plafond','calcul-irl','calcul-economies','guide','checklist','lettre','essai') then
    raise exception 'Demande inconnue.' using errcode = 'check_violation';
  end if;
  if p_irl_month is not null and p_irl_month not between 1 and 12 then
    raise exception 'Mois de révision invalide.' using errcode = 'check_violation';
  end if;
  -- paramètres du calcul : caractères d'une chaîne de requête seulement (aucun texte libre dans l'e-mail)
  if v_params is not null and (char_length(v_params) > 400 or v_params !~ '^[A-Za-z0-9_=&.%+,-]+$') then v_params := null; end if;
  -- limites : 3 messages par adresse et par jour, 120 par heure au total
  if (select count(*) from email_outbox where kind = 'inscription_site' and to_emails[1] = v_email and created_at > now() - interval '1 day') >= 3
     or (select count(*) from email_outbox where kind = 'inscription_site' and created_at > now() - interval '1 hour') >= 120 then
    raise exception 'Trop de demandes : réessayez plus tard.' using errcode = 'check_violation';
  end if;

  if v_keep then
    insert into site_subscribers (email, first_source, sources, confirmed_at) values (v_email, p_source, array[p_source], now())
    on conflict (email) do update set sources = case when p_source = any(site_subscribers.sources) then site_subscribers.sources
                                                     else site_subscribers.sources || p_source end,
                                      updated_at = now()
    returning * into v_sub;
    -- active tout de suite, y compris une adresse désinscrite qui se réinscrit
    update site_subscribers set unsubscribed_at = null, confirmed_at = coalesce(confirmed_at, now())
     where id = v_sub.id returning * into v_sub;
    if v_marketing then
      update site_subscribers set marketing_consent = true,
        consent_text = left(coalesce(nullif(trim(p_consent_text), ''), 'J’accepte de recevoir les conseils et offres d’Immo-Zen.'), 500),
        consent_page = left(nullif(trim(coalesce(p_page, '')), ''), 300), consent_at = now()
       where id = v_sub.id returning * into v_sub;
      -- premier accord : ce message tient lieu d'e-mail de bienvenue (étape 1)
      if v_sub.welcome_step = 0 then
        v_welcome := true;
        update site_subscribers set welcome_step = 1 where id = v_sub.id returning * into v_sub;
      end if;
    end if;
    if p_irl_month is not null then update site_subscribers set irl_alert_month = p_irl_month where id = v_sub.id returning * into v_sub; end if;
    if coalesce(p_paris_alert, false) then update site_subscribers set paris_alert = true where id = v_sub.id returning * into v_sub; end if;
  end if;

  v_tool := case p_source when 'calcul-cash-flow' then '/outils/simulateur-cash-flow.html'
                          when 'calcul-plafond' then '/outils/plafond-loyer-paris.html'
                          when 'calcul-irl' then '/outils/revision-loyer-irl.html'
                          when 'calcul-economies' then '/' end;
  if p_source like 'calcul-%' then
    v_doc := v_site || v_tool || coalesce('?' || v_params, '') || case when p_source = 'calcul-economies' then '#economies' else '' end;
    v_subject := case when v_welcome then 'Votre calcul est sauvegardé (et bienvenue chez Immo-Zen)' else 'Votre calcul Immo-Zen' end;
    v_intro := 'Voici le lien vers votre calcul, à rouvrir à tout moment avec les mêmes valeurs :' || chr(10) || v_doc ||
      chr(10) || chr(10) || 'Ce résultat est une estimation indicative, pas un conseil financier ou fiscal.';
  elsif p_source = 'guide' then
    v_doc := v_site || '/ressources/guide-10-verifications-avant-achat.pdf';
    v_subject := 'Votre guide est prêt : les 10 vérifications avant d’acheter';
    v_intro := 'Votre guide « Les 10 vérifications avant d’acheter un bien locatif » est prêt. Téléchargez-le ici :' || chr(10) || v_doc;
  elsif p_source = 'checklist' then
    v_doc := v_site || '/ressources/checklist-mise-en-location.pdf';
    v_subject := 'Votre checklist de mise en location est prête';
    v_intro := 'Votre checklist de mise en location est prête, à imprimer et à cocher du bail à la première quittance :' || chr(10) || v_doc;
  elsif p_source = 'lettre' then
    v_subject := 'Bienvenue chez Immo-Zen : voici ce qui vous attend';
    v_intro := 'Bienvenue ! Votre inscription à la lettre Immo-Zen est faite : vous n’avez rien d’autre à faire.';
  else
    v_subject := 'Bienvenue chez Immo-Zen : voici ce qui vous attend';
    v_intro := 'Bienvenue ! Vous avez accepté de recevoir les conseils et offres d’Immo-Zen : c’est noté.';
  end if;

  if p_irl_month is not null then
    v_alerts := v_alerts || ('Un rappel chaque année en ' ||
      (array['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'])[p_irl_month] ||
      ', mois de révision de votre bail.');
  end if;
  if coalesce(p_paris_alert, false) then
    v_alerts := v_alerts || 'Un message quand les plafonds de loyer de Paris changent.'::text;
  end if;
  if array_length(v_alerts, 1) > 0 then
    v_extra := v_extra || chr(10) || chr(10) || 'Alerte enregistrée : ' || array_to_string(v_alerts, ' ');
  end if;
  if v_welcome then
    v_extra := v_extra || chr(10) || chr(10) ||
      case when p_source in ('lettre', 'essai') then '' else 'Et bienvenue chez Immo-Zen : vous êtes inscrit à notre lettre. ' end ||
      'Une fois par mois, pas plus : l’actualité qui compte pour les bailleurs, un calcul concret à refaire avec vos chiffres, et un conseil applicable tout de suite.' || chr(10) || chr(10) ||
      'Passez à l’action dès maintenant : un bien en vue ? Le simulateur vous dit en une minute s’il vous coûtera ou vous rapportera de l’argent chaque mois, avant de signer.' || chr(10) ||
      v_site || '/outils/simulateur-cash-flow.html' || chr(10) || chr(10) ||
      'Déjà propriétaire ? Calculez la révision de votre loyer avec le dernier indice publié :' || chr(10) ||
      v_site || '/outils/revision-loyer-irl.html' || chr(10) || chr(10) ||
      'Et quand vous voulez aller plus loin : Immo-Zen gère vos loyers, vos quittances et prépare votre déclaration. 30 jours gratuits, sans carte bancaire :' || chr(10) ||
      v_site || '/app/' || chr(10) || chr(10) ||
      'Suivez Immo-Zen sur LinkedIn : ' || v_li || chr(10) || chr(10) ||
      'À très vite,';
  end if;
  if p_source in ('lettre', 'essai') and not v_keep then return 'ok'; end if;   -- rien à envoyer sans case cochée
  -- compte d'essai déjà inscrit : pas de second message de bienvenue
  if p_source = 'essai' and not v_welcome and not v_alert then return 'ok'; end if;

  if v_keep then
    v_footer := 'David, fondateur d’Immo-Zen' || chr(10) || chr(10) ||
      case when v_welcome then 'P.-S. Une question sur votre projet ? Répondez simplement à cet e-mail, je lis tout.' || chr(10) || chr(10) else '' end ||
      'Vous recevez ce message parce que cette demande a été faite sur immo-zen.fr avec votre adresse. ' ||
      'Ce n’est pas vous, ou vous changez d’avis ? Un clic suffit pour vous désinscrire : ' ||
      v_site || '/inscription.html?desinscrire=' || v_sub.unsubscribe_token;
  else
    v_footer := 'Vous recevez ce message parce que cette demande a été faite sur immo-zen.fr avec votre adresse. Si ce n’est pas vous, ignorez-le : vous ne recevrez rien d’autre.';
  end if;

  insert into email_outbox (user_id, kind, to_emails, subject, body_text, dedupe_key, template, template_data)
  values (null, 'inscription_site', array[v_email], v_subject,
    'Bonjour,' || chr(10) || chr(10) || v_intro || v_extra || chr(10) || chr(10) || v_footer,
    'inscription:' || gen_random_uuid(),
    case when v_welcome then 'bienvenue' end,
    case when v_welcome then jsonb_build_object('step', 1, 'source', p_source, 'doc_url', v_doc, 'alerts', to_jsonb(v_alerts),
      'unsub', v_site || '/inscription.html?desinscrire=' || v_sub.unsubscribe_token) end);
  return 'ok';
end $$;
revoke all on function public.iz_subscribe(text, text, boolean, text, text, text, int, boolean, text) from public;
grant execute on function public.iz_subscribe(text, text, boolean, text, text, text, int, boolean, text) to anon, authenticated;

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
    insert into email_outbox (user_id, kind, to_emails, subject, body_text, dedupe_key, template, template_data)
    values (null, 'bienvenue', array[r.email], m.subject, m.body, 'bienvenue:' || v_next || ':' || r.id,
      'bienvenue', jsonb_build_object('step', v_next, 'unsub', 'https://immo-zen.fr/inscription.html?desinscrire=' || r.unsubscribe_token))
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
