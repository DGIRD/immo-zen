-- Immo-Zen : formulaire de contact du site vitrine → prospects commerciaux (Administration).
-- Nécessite 20261017000200_lot3_plateforme.sql. Annulation : rollback/20261018000300_site_contact.down.sql
-- Appel public (anonyme) limité : validation, champ piège anti-robot, 3 demandes par adresse et par jour, 60 par heure au total.
create or replace function public.iz_submit_lead(p_name text, p_email text, p_phone text, p_message text, p_topic text default null, p_website text default null)
returns boolean language plpgsql security definer set search_path = public as $$
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
  insert into platform_leads (name, email, phone, source, status, notes)
  values (left(p_name, 200), p_email, nullif(left(trim(coalesce(p_phone, '')), 40), ''),
          left('Site' || coalesce(' – ' || nullif(trim(p_topic), ''), ''), 120), 'nouveau', nullif(left(trim(coalesce(p_message, '')), 4000), ''));
  return true;
end $$;
revoke all on function public.iz_submit_lead(text, text, text, text, text, text) from public;
grant execute on function public.iz_submit_lead(text, text, text, text, text, text) to anon, authenticated;
notify pgrst, 'reload schema';
