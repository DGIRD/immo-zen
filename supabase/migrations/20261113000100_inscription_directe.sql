-- =====================================================================
-- Immo-Zen – Inscription directe (sans lien de confirmation)
--   L'inscription à la lettre, aux conseils et offres ou à une alerte est active dès l'envoi du formulaire :
--   plus de lien « confirmer » à cliquer. Le consentement reste donné par une case non cochée, distincte
--   du service demandé, et sa preuve est conservée (texte, page, date). Chaque e-mail porte le lien de
--   désinscription, mis en avant dans le premier message (« ce n'est pas vous ? »).
--   Le premier e-mail fait office d'étape 1 de la séquence de bienvenue (document demandé + bienvenue
--   dans un seul message) ; les étapes 2 et 3 suivent à J+4 et J+10 comme avant.
--   Les anciens liens « confirmer » restent reconnus (réponse « déjà confirmée »).
--   Les inscriptions encore en attente sont activées, avec leur e-mail de bienvenue.
-- Annulation : rollback/20261113000100_inscription_directe.down.sql
-- =====================================================================

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

-- Inscriptions encore en attente de confirmation : activées, avec leur e-mail de bienvenue
do $$
declare r record; m record;
begin
  for r in select * from public.site_subscribers where confirmed_at is null and unsubscribed_at is null for update loop
    update public.site_subscribers set confirmed_at = now(), updated_at = now(),
           welcome_step = case when marketing_consent and welcome_step = 0 then 1 else welcome_step end
     where id = r.id;
    if r.marketing_consent and r.welcome_step = 0 then
      select * into m from public.iz_welcome_message(1, r.unsubscribe_token);
      insert into public.email_outbox (user_id, kind, to_emails, subject, body_text, dedupe_key)
      values (null, 'bienvenue', array[r.email], m.subject,
        replace(m.body, 'Merci d’avoir confirmé votre inscription.', 'Votre inscription est active : vous n’avez rien d’autre à faire.'),
        'bienvenue:1:' || r.id)
      on conflict (dedupe_key) do nothing;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
