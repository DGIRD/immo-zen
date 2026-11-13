-- Annulation de 20261113000200_bienvenue_illustree.sql : textes et fonctions de 20261112000300 et 20261113000100
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
  v_tool text;
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
    v_subject := 'Votre calcul Immo-Zen';
    v_intro := 'Voici le lien vers votre calcul, à rouvrir à tout moment avec les mêmes valeurs :' || chr(10) ||
      v_site || v_tool || coalesce('?' || v_params, '') || case when p_source = 'calcul-economies' then '#economies' else '' end ||
      chr(10) || chr(10) || 'Ce résultat est une estimation indicative, pas un conseil financier ou fiscal.';
  elsif p_source = 'guide' then
    v_subject := 'Votre guide : les 10 vérifications avant d’acheter un bien locatif';
    v_intro := 'Voici votre guide « Les 10 vérifications avant d’acheter un bien locatif » :' || chr(10) || v_site || '/ressources/guide-10-verifications-avant-achat.pdf';
  elsif p_source = 'checklist' then
    v_subject := 'Votre checklist de mise en location';
    v_intro := 'Voici votre checklist de mise en location, à imprimer :' || chr(10) || v_site || '/ressources/checklist-mise-en-location.pdf';
  elsif p_source = 'lettre' then
    v_subject := 'Bienvenue dans la lettre Immo-Zen';
    v_intro := 'Merci, votre inscription à la lettre Immo-Zen est faite : vous n’avez rien d’autre à faire.';
  else
    v_subject := 'Bienvenue chez Immo-Zen';
    v_intro := 'Lors de la création de votre compte, vous avez accepté de recevoir les conseils et offres d’Immo-Zen : c’est noté.';
  end if;

  if v_welcome then
    v_extra := v_extra || chr(10) || chr(10) ||
      case when p_source in ('lettre', 'essai') then '' else 'Vous êtes aussi inscrit à la lettre Immo-Zen, comme vous l’avez demandé. ' end ||
      'Environ une fois par mois, vous recevrez une actualité, un calcul et un conseil pour les propriétaires bailleurs.' || chr(10) || chr(10) ||
      'Pour commencer : si vous avez un bien en vue, le simulateur de cash-flow vous donne en une minute ce qu’il vous coûtera ou rapportera chaque mois.' || chr(10) ||
      v_site || '/outils/simulateur-cash-flow.html' || chr(10) || chr(10) ||
      'Et pour un bien déjà loué, l’outil de révision de loyer calcule le nouveau loyer avec le dernier indice publié :' || chr(10) ||
      v_site || '/outils/revision-loyer-irl.html';
  end if;
  if p_irl_month is not null then
    v_extra := v_extra || chr(10) || chr(10) || 'Alerte enregistrée : un rappel chaque année en ' ||
      (array['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'])[p_irl_month] ||
      ', mois de révision de votre bail.';
  end if;
  if coalesce(p_paris_alert, false) then
    v_extra := v_extra || chr(10) || chr(10) || 'Alerte enregistrée : un message quand les plafonds de loyer de Paris changent.';
  end if;
  if p_source in ('lettre', 'essai') and not v_keep then return 'ok'; end if;   -- rien à envoyer sans case cochée
  -- compte d'essai déjà inscrit : pas de second message de bienvenue
  if p_source = 'essai' and not v_welcome and not v_alert then return 'ok'; end if;

  if v_keep then
    v_footer := 'David, fondateur d’Immo-Zen' || chr(10) || chr(10) ||
      'Vous recevez ce message parce que cette demande a été faite sur immo-zen.fr avec votre adresse. ' ||
      'Ce n’est pas vous, ou vous changez d’avis ? Un clic suffit pour vous désinscrire : ' ||
      v_site || '/inscription.html?desinscrire=' || v_sub.unsubscribe_token;
  else
    v_footer := 'Vous recevez ce message parce que cette demande a été faite sur immo-zen.fr avec votre adresse. Si ce n’est pas vous, ignorez-le : vous ne recevrez rien d’autre.';
  end if;

  insert into email_outbox (user_id, kind, to_emails, subject, body_text, dedupe_key)
  values (null, 'inscription_site', array[v_email], v_subject,
    'Bonjour,' || chr(10) || chr(10) || v_intro || v_extra || chr(10) || chr(10) || v_footer,
    'inscription:' || gen_random_uuid());
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

alter table public.email_outbox drop column if exists template_data;
alter table public.email_outbox drop column if exists template;
notify pgrst, 'reload schema';
