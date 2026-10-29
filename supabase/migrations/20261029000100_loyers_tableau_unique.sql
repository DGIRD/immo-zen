-- =====================================================================
-- Loyers et paiements : un seul tableau, une ligne par bail et par mois (29/10/2026)
-- Expression de besoin « Loyers et paiements » du 29/10/2026.
--
-- La ligne d'un mois regroupe le loyer (kind 'loyer'), les autres sommes dues
-- du mois (régularisation, autre) et le reste dû reporté du mois précédent
-- (kind 'report'). Les paiements sont rattachés à un mois (period_month, par
-- défaut le mois de leur date) et ne règlent que les sommes de ce mois.
--
-- Règles appliquées par l'application (src/domain/ledger.ts) :
--   * reste dû d'un mois échu → ligne 'report' du mois suivant (« Reste dû MM/AAAA »),
--     les sommes d'origine portent carried_to et ne comptent plus dans la dette ;
--   * report en cascade : le reste dû cumulé passe au mois suivant ;
--   * dernier mois du bail : pas de report, le reste dû reste sur sa ligne ;
--   * excédent : trop-perçu sur sa ligne, ou avance sur le mois suivant (excess_mode).
-- Ici : colonnes, contraintes, point de départ des lignes (réglage général),
-- dette hors sommes reportées, mention « Reste dû MM/AAAA réglé » sur la quittance.
-- =====================================================================

-- Sommes dues : report du reste dû, trop-perçu, confirmation de réception
alter table public.rent_charges drop constraint if exists rent_charges_kind_check;
alter table public.rent_charges add constraint rent_charges_kind_check check (kind in ('loyer','regularisation','autre','report'));
alter table public.rent_charges add column if not exists carry_from date;
alter table public.rent_charges add column if not exists carried_to uuid references public.rent_charges(id) on delete set null;
alter table public.rent_charges add column if not exists excess_mode text check (excess_mode in ('trop_percu','avance'));
alter table public.rent_charges add column if not exists received_at timestamptz;
create unique index if not exists rent_charges_one_report_per_month on public.rent_charges(lease_id, period_start) where kind = 'report' and cancelled_at is null;
create index if not exists rent_charges_carried_idx on public.rent_charges(carried_to) where carried_to is not null;

-- Paiements : mois de rattachement (par défaut, le mois de la date)
alter table public.payments add column if not exists period_month date check (period_month is null or extract(day from period_month) = 1);
-- Reprise : un paiement saisi ou confirmé sur une échéance de loyer garde le mois de cette échéance ;
-- un paiement importé (ou sans répartition) va dans le mois de sa date.
update public.payments p set period_month = coalesce(
  case when p.source <> 'import' then (
    select date_trunc('month', c.period_start)::date from public.payment_allocations a join public.rent_charges c on c.id = a.charge_id
     where a.payment_id = p.id and c.kind = 'loyer' order by a.amount desc, c.period_start limit 1) end,
  date_trunc('month', p.paid_on)::date)
 where p.period_month is null;

-- Génération des lignes mensuelles : à partir du début du bail, ou de la date choisie dans le
-- réglage général du compte (rental_settings.ledger_start_mode = 'date', ledger_start_date)
create or replace function public.iz_generate_rent_charges(p_lease uuid, p_until date default null)
returns int language plpgsql security invoker set search_path = public as $$
declare
  l leases%rowtype; m date; me date; ps date; pe date; dim int; ratio numeric; v_until date; v_due date; v_from date; n int := 0; k int;
begin
  select * into l from leases where id = p_lease;
  if not found then raise exception 'Bail introuvable.'; end if;
  v_until := coalesce(p_until, iz_today_paris());
  if l.end_date is not null then v_until := least(v_until, l.end_date); end if;
  select case when s.rental_settings ->> 'ledger_start_mode' = 'date' and coalesce(s.rental_settings ->> 'ledger_start_date', '') ~ '^\d{4}-\d{2}-\d{2}$'
              then (s.rental_settings ->> 'ledger_start_date')::date end
    into v_from from user_settings s where s.user_id = l.user_id;
  v_from := greatest(l.start_date, coalesce(v_from, l.start_date));
  m := date_trunc('month', v_from)::date;
  while m <= v_until loop
    me := (m + interval '1 month' - interval '1 day')::date;
    ps := greatest(m, l.start_date);
    pe := least(me, coalesce(l.end_date, me));
    dim := extract(day from me)::int;
    ratio := (pe - ps + 1)::numeric / dim;
    v_due := least(greatest(m + (l.payment_day - 1), ps), pe);
    insert into rent_charges (user_id, lease_id, kind, period_start, period_end, due_date, rent_amount, charges_amount)
    values (l.user_id, l.id, 'loyer', ps, pe, v_due, round(l.rent_hc * ratio, 2), round(l.charges_amount * ratio, 2))
    on conflict do nothing;
    get diagnostics k = row_count;
    n := n + k;
    m := (m + interval '1 month')::date;
  end loop;
  return n;
end $$;

-- Dette : une somme reportée sur le mois suivant ne compte plus (elle est due sur la ligne de report)
create or replace function public.iz_charges_remaining(p_charges uuid[])
returns numeric language sql stable set search_path = public as $$
  select coalesce(sum(greatest(c.rent_amount + c.charges_amount - iz_charge_allocated(c.id), 0)), 0)
    from rent_charges c where c.id = any(p_charges) and c.cancelled_at is null and c.carried_to is null
$$;

-- Quittance avec les autres sommes du mois : un reste dû reporté apparaît « Reste dû MM/AAAA réglé »
create or replace function public.iz_issue_receipt_with_extras(p_charge uuid, p_extras uuid[])
returns public.receipts language plpgsql security definer set search_path = public as $$
declare c rent_charges%rowtype; x rent_charges%rowtype; r receipts%rowtype; v_lines jsonb := '[]'::jsonb; v_sum numeric := 0; v_id uuid; v_label text;
begin
  select * into c from rent_charges where id = p_charge and user_id = auth.uid() for update;
  if not found then raise exception 'Échéance introuvable.' using errcode = 'insufficient_privilege'; end if;
  if iz_charge_receipted(c.id) then
    raise exception 'Une quittance existe déjà pour cette période : annulez-la pour en émettre une avec le rappel de charges.' using errcode = 'check_violation';
  end if;
  foreach v_id in array coalesce(p_extras, '{}') loop
    select * into x from rent_charges where id = v_id and user_id = auth.uid() for update;
    if not found or x.lease_id <> c.lease_id or x.id = c.id or x.kind = 'loyer' then
      raise exception 'Rappel de charges invalide (autre bail ou échéance de loyer).' using errcode = 'check_violation';
    end if;
    if x.cancelled_at is not null then raise exception 'Somme due annulée.' using errcode = 'check_violation'; end if;
    if iz_charge_allocated(x.id) < x.rent_amount + x.charges_amount then
      raise exception 'Le rappel « % » n''est pas intégralement réglé.', coalesce(x.label, 'Régularisation') using errcode = 'check_violation';
    end if;
    if iz_charge_receipted(x.id) then raise exception 'Le rappel « % » figure déjà sur une quittance.', coalesce(x.label, 'Régularisation') using errcode = 'check_violation'; end if;
    v_label := case when x.kind = 'report' then coalesce(x.label, 'Reste dû ' || to_char(coalesce(x.carry_from, x.period_start), 'MM/YYYY')) || ' réglé'
                    else coalesce(x.label, 'Rappel de charges') end;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('charge_id', x.id::text, 'label', v_label, 'amount', x.rent_amount + x.charges_amount));
    v_sum := v_sum + x.rent_amount + x.charges_amount;
  end loop;
  r := iz__issue_receipt(c.id, 'quittance');
  update receipts set extra_lines = v_lines, paid_amount = paid_amount + v_sum where id = r.id returning * into r;
  return r;
end $$;
revoke all on function public.iz_issue_receipt_with_extras(uuid, uuid[]) from public, anon;
grant execute on function public.iz_issue_receipt_with_extras(uuid, uuid[]) to authenticated;

-- Tâches quotidiennes : lignes du mois créées le 1er (point de départ respecté) ;
-- confirmations et relances hors sommes reportées (la dette est sur la ligne de report)
create or replace function public.iz_daily_tasks(p_today date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_today date := coalesce(p_today, iz_today_paris());
  v_run uuid; v_generated int := 0; v_confirm int := 0; v_drafts int := 0; v_cancelled int := 0; k int;
  l record; c record; v_charges uuid[]; v_debt numeric; v_level int; v_names text; v_emails text[]; v_owner text; v_subject text; v_body text; v_tpl jsonb; v_rid uuid;
begin
  insert into job_runs (job, run_key) values ('daily', v_today::text || ':' || to_char(clock_timestamp(), 'HH24MISSMS'))
  returning id into v_run;

  -- 1. Échéances du mois en cours pour tous les baux actifs
  for l in select id from leases where start_date <= v_today and (end_date is null or end_date >= date_trunc('month', v_today)::date) loop
    v_generated := v_generated + iz_generate_rent_charges(l.id, v_today);
  end loop;

  -- 2. E-mail au propriétaire le lendemain de l'échéance (et jusqu'à 3 jours après) pour confirmer le paiement.
  --    L'absence de réponse ne vaut jamais confirmation : rien n'est enregistré sans action du propriétaire.
  for c in
    select rc.*, le.user_id as owner_id, u.email as owner_email, p.title as property_title
      from rent_charges rc join leases le on le.id = rc.lease_id join properties p on p.id = le.property_id join auth.users u on u.id = le.user_id
     where le.owner_confirmation_email and rc.cancelled_at is null
       and rc.due_date between v_today - 3 and v_today - 1
       and iz_charge_allocated(rc.id) < rc.rent_amount + rc.charges_amount
       and rc.carried_to is null
       and u.email is not null
  loop
    insert into email_outbox (user_id, kind, to_emails, subject, body_text, lease_id, charge_id, dedupe_key)
    values (c.owner_id, 'confirmation_paiement', array[c.owner_email],
            'Loyer ' || to_char(c.period_start, 'MM/YYYY') || ' – ' || c.property_title || ' : avez-vous été payé ?',
            'Bonjour,' || chr(10) || chr(10) || 'Le loyer de ' || to_char(c.period_start, 'MM/YYYY') || ' pour « ' || c.property_title
              || ' » (' || iz_eur(c.rent_amount + c.charges_amount) || ' €) était dû le ' || to_char(c.due_date, 'DD/MM/YYYY') || '.'
              || chr(10) || 'Aucun paiement n''est encore enregistré dans Immo-Zen.' || chr(10) || chr(10)
              || 'Si vous l''avez reçu, confirmez-le dans Immo-Zen (Loyers et paiements). Sans confirmation de votre part, le loyer reste considéré comme non payé.',
            c.lease_id, c.id, 'confirmation:' || c.id)
    on conflict (dedupe_key) do nothing;
    get diagnostics k = row_count; v_confirm := v_confirm + k;
  end loop;

  -- 3. Relances : brouillon préparé quand le retard dépasse le délai choisi ; le propriétaire valide avant tout envoi.
  for l in select le.*, p.title as property_title, s.rental_settings
             from leases le join properties p on p.id = le.property_id left join user_settings s on s.user_id = le.user_id
            where le.reminder_enabled loop
    select coalesce(array_agg(rc.id order by rc.due_date), '{}') into v_charges
      from rent_charges rc
     where rc.lease_id = l.id and rc.cancelled_at is null and rc.carried_to is null and rc.due_date + l.reminder_delay_days <= v_today
       and iz_charge_allocated(rc.id) < rc.rent_amount + rc.charges_amount;
    continue when cardinality(v_charges) = 0;
    continue when exists (select 1 from reminders m where m.lease_id = l.id and m.status not in ('annule','echec')
                            and m.created_at > (v_today - l.reminder_delay_days)::timestamptz);
    v_debt := iz_charges_remaining(v_charges);
    select least(count(*) + 1, 3) into v_level from reminders m where m.lease_id = l.id and m.status in ('envoye','envoye_manuellement')
       and m.charge_ids && v_charges;
    select string_agg(trim(coalesce(t.first_name || ' ', '') || t.last_name), ', '),
           coalesce(array_agg(t.email) filter (where t.email is not null), '{}')
      into v_names, v_emails
      from lease_tenants lt join tenants t on t.id = lt.tenant_id where lt.lease_id = l.id and lt.left_on is null;
    v_tpl := coalesce(l.rental_settings -> 'reminder_templates' -> (v_level - 1), '{}'::jsonb);
    v_subject := coalesce(v_tpl ->> 'subject', case v_level when 1 then 'Rappel : loyer impayé' when 2 then 'Second rappel : loyer impayé' else 'Dernier rappel amiable : loyer impayé' end);
    v_body := coalesce(v_tpl ->> 'body',
      'Bonjour {locataires},' || chr(10) || chr(10)
      || 'Sauf erreur de notre part, la somme de {montant} € reste due au titre du logement {bien} (échéances : {periodes}).' || chr(10)
      || 'Pourriez-vous procéder au règlement ou nous contacter si une difficulté se présente ?' || chr(10) || chr(10)
      || 'Si le paiement a été effectué entre-temps, merci de ne pas tenir compte de ce message.' || chr(10) || chr(10)
      || 'Cordialement,' || chr(10) || '{bailleur}');
    v_body := replace(replace(replace(replace(replace(v_body,
      '{locataires}', coalesce(v_names, '')),
      '{montant}', iz_eur(v_debt)),
      '{bien}', l.property_title),
      '{bailleur}', coalesce(l.landlord_name, '')),
      '{periodes}', (select string_agg(to_char(period_start, 'MM/YYYY'), ', ' order by period_start) from rent_charges where id = any(v_charges)));
    insert into reminders (user_id, lease_id, level, charge_ids, debt_amount, subject, body, recipients, status, created_by)
    values (l.user_id, l.id, v_level, v_charges, v_debt, left(v_subject, 300), v_body, v_emails, 'brouillon', 'automatique')
    returning id into v_rid;
    insert into email_outbox (user_id, kind, to_emails, subject, body_text, reminder_id, lease_id, dedupe_key)
    select l.user_id, 'relance_a_valider', array[u.email], 'Relance à valider – ' || l.property_title,
           'Un loyer de « ' || l.property_title || ' » reste impayé (' || iz_eur(v_debt) || ' €).' || chr(10)
           || 'Une relance amiable a été préparée. Ouvrez Immo-Zen (Locataires et baux) pour la relire et l''envoyer : rien n''est envoyé au locataire sans votre validation.',
           v_rid, l.id, 'relance-a-valider:' || v_rid
      from auth.users u where u.id = l.user_id and u.email is not null
    on conflict (dedupe_key) do nothing;
    v_drafts := v_drafts + 1;
  end loop;

  -- 4. Arrêt des relances lorsque la dette est réglée
  update reminders m set status = 'annule', error = 'Dette réglée'
   where m.status in ('brouillon','a_envoyer') and iz_charges_remaining(m.charge_ids) <= 0;
  get diagnostics v_cancelled = row_count;
  update email_outbox o set status = 'annule'
   where o.status = 'a_envoyer' and o.kind in ('relance','relance_a_valider')
     and exists (select 1 from reminders m where m.id = o.reminder_id and m.status = 'annule');
  update email_outbox o set status = 'annule'
   where o.status = 'a_envoyer' and o.kind = 'confirmation_paiement'
     and exists (select 1 from rent_charges rc where rc.id = o.charge_id and iz_charge_allocated(rc.id) >= rc.rent_amount + rc.charges_amount);

  update job_runs set status = 'ok', finished_at = now(),
         details = jsonb_build_object('today', v_today, 'echeances', v_generated, 'confirmations', v_confirm, 'relances_preparees', v_drafts, 'relances_annulees', v_cancelled)
   where id = v_run;
  return (select details from job_runs where id = v_run);
end $$;
revoke all on function public.iz_daily_tasks(date) from public, anon, authenticated;

notify pgrst, 'reload schema';
