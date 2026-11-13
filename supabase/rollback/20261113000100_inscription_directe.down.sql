-- Annulation de 20261113000100_inscription_directe.sql : retour à l'inscription avec lien de confirmation (fonction de 20261112000200_inscriptions_site.sql)
create or replace function public.iz_subscribe(
  p_email text, p_source text, p_marketing boolean default false, p_consent_text text default null,
  p_page text default null, p_params text default null, p_irl_month int default null,
  p_paris_alert boolean default false, p_website text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_site constant text := 'https://immo-zen.fr';
  v_email text := lower(trim(coalesce(p_email, '')));
  v_params text := nullif(trim(coalesce(p_params, '')), '');
  v_alert boolean := p_irl_month is not null or coalesce(p_paris_alert, false);
  v_keep boolean := coalesce(p_marketing, false) or v_alert;
  v_sub site_subscribers%rowtype;
  v_subject text; v_intro text; v_confirm text := ''; v_unsub text := '';
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
    insert into site_subscribers (email, first_source, sources) values (v_email, p_source, array[p_source])
    on conflict (email) do update set sources = case when p_source = any(site_subscribers.sources) then site_subscribers.sources
                                                     else site_subscribers.sources || p_source end,
                                      updated_at = now()
    returning * into v_sub;
    -- une adresse désinscrite qui recoche la case repart pour une nouvelle confirmation
    if v_sub.unsubscribed_at is not null then
      update site_subscribers set unsubscribed_at = null, confirmed_at = null, confirm_token = gen_random_uuid()
       where id = v_sub.id returning * into v_sub;
    end if;
    if coalesce(p_marketing, false) then
      update site_subscribers set marketing_consent = true,
        consent_text = left(coalesce(nullif(trim(p_consent_text), ''), 'J’accepte de recevoir les conseils et offres d’Immo-Zen.'), 500),
        consent_page = left(nullif(trim(coalesce(p_page, '')), ''), 300), consent_at = now()
       where id = v_sub.id returning * into v_sub;
    end if;
    if p_irl_month is not null then update site_subscribers set irl_alert_month = p_irl_month where id = v_sub.id returning * into v_sub; end if;
    if coalesce(p_paris_alert, false) then update site_subscribers set paris_alert = true where id = v_sub.id returning * into v_sub; end if;

    if v_sub.confirmed_at is null then
      v_confirm := chr(10) || chr(10) || 'Pour confirmer ' ||
        case when coalesce(p_marketing, false) and v_alert then 'votre alerte et votre accord pour recevoir les conseils et offres d’Immo-Zen (environ un e-mail par mois)'
             when coalesce(p_marketing, false) then 'votre accord pour recevoir les conseils et offres d’Immo-Zen (environ un e-mail par mois)'
             else 'votre alerte' end ||
        ', cliquez sur ce lien :' || chr(10) || v_site || '/inscription.html?confirmer=' || v_sub.confirm_token ||
        chr(10) || 'Sans clic de votre part, vous ne recevrez rien d’autre.';
    end if;
    v_unsub := chr(10) || chr(10) || 'Se désinscrire à tout moment : ' || v_site || '/inscription.html?desinscrire=' || v_sub.unsubscribe_token;
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
    v_subject := 'Confirmez votre inscription à la lettre Immo-Zen';
    v_intro := 'Merci pour votre inscription à la lettre Immo-Zen : une actualité, un calcul et un conseil pour les propriétaires bailleurs, environ une fois par mois.';
  else
    v_subject := 'Confirmez votre accord pour recevoir les conseils Immo-Zen';
    v_intro := 'Lors de la création de votre compte, vous avez accepté de recevoir les conseils et offres d’Immo-Zen.';
  end if;
  if p_irl_month is not null then
    v_intro := v_intro || chr(10) || chr(10) || 'Alerte demandée : un rappel chaque année en ' ||
      (array['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'])[p_irl_month] ||
      ', mois de révision de votre bail.';
  end if;
  if coalesce(p_paris_alert, false) then
    v_intro := v_intro || chr(10) || chr(10) || 'Alerte demandée : un message quand les plafonds de loyer de Paris changent.';
  end if;
  if p_source in ('lettre', 'essai') and not v_keep then return 'ok'; end if;   -- rien à envoyer sans case cochée

  insert into email_outbox (user_id, kind, to_emails, subject, body_text, dedupe_key)
  values (null, 'inscription_site', array[v_email], v_subject,
    'Bonjour,' || chr(10) || chr(10) || v_intro || v_confirm || chr(10) || chr(10) ||
    'Vous recevez ce message parce que cette demande a été faite sur immo-zen.fr avec votre adresse. Si ce n’est pas vous, ignorez-le : vous ne recevrez rien d’autre.' ||
    v_unsub, 'inscription:' || gen_random_uuid());
  return 'ok';
end $$;
revoke all on function public.iz_subscribe(text, text, boolean, text, text, text, int, boolean, text) from public;
grant execute on function public.iz_subscribe(text, text, boolean, text, text, text, int, boolean, text) to anon, authenticated;

notify pgrst, 'reload schema';
