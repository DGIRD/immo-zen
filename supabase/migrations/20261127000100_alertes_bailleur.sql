-- Alertes e-mail au propriétaire (27/11/2026) :
--   * révision annuelle du loyer (IRL) : un mois avant la date anniversaire du bail, jusqu'à un mois après ;
--   * échéance du bail (loi de 1989) : deux mois avant la date limite pour donner congé
--     (bail vide : 3 ans, congé 6 mois avant ; meublé : 1 an, congé 3 mois avant ; bail à date de fin : 1 mois avant).
-- Une alerte par bail et par date (clé de déduplication). Désactivables dans Paramètres (rental_settings.owner_alerts).
alter table public.email_outbox drop constraint if exists email_outbox_kind_check;
alter table public.email_outbox add constraint email_outbox_kind_check
  check (kind in ('confirmation_paiement','quittance','relance','relance_a_valider','invitation_locataire','contact_site','facture_abonnement','alerte_exploitation','inscription_site','alerte_irl','bienvenue','alerte_bailleur'));

create or replace function public.iz_owner_alerts(p_today date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_today date := coalesce(p_today, iz_today_paris());
  l record; v_anniv date; v_kind text; v_term int; v_notice interval; v_end date; v_deadline date;
  v_irl int := 0; v_fin int := 0; k int; v_lead int;
begin
  for l in
    select le.*, p.title as property_title, p.dpe, u.email as owner_email,
           coalesce((s.rental_settings -> 'owner_alerts' ->> 'irl')::boolean, true) as want_irl,
           coalesce((s.rental_settings -> 'owner_alerts' ->> 'fin_bail')::boolean, true) as want_fin
      from leases le
      join properties p on p.id = le.property_id
      join auth.users u on u.id = le.user_id
      left join user_settings s on s.user_id = le.user_id
     where le.start_date <= v_today and (le.end_date is null or le.end_date >= v_today) and u.email is not null
  loop
    -- 1. révision IRL : prochaine date anniversaire après la dernière révision
    if l.want_irl and coalesce(l.irl_enabled, false) and coalesce(l.dpe, '') not in ('F', 'G') then
      v_anniv := (l.start_date + interval '1 year')::date;
      -- année non réclamée dépassée depuis plus d'un mois : on passe à la suivante
      while v_anniv <= coalesce(l.last_revision_on, l.start_date) or v_anniv + 30 < v_today loop v_anniv := (v_anniv + interval '1 year')::date; end loop;
      if v_today between v_anniv - 30 and v_anniv + 30 then
        insert into email_outbox (user_id, kind, to_emails, subject, body_text, lease_id, dedupe_key)
        values (l.user_id, 'alerte_bailleur', array[l.owner_email],
                'Révision du loyer à prévoir – ' || l.property_title,
                'Bonjour,' || chr(10) || chr(10)
                || 'La révision annuelle du loyer de « ' || l.property_title || ' » est possible à partir du ' || to_char(v_anniv, 'DD/MM/YYYY')
                || ' (date anniversaire du bail), selon l''indice de référence des loyers (IRL).' || chr(10) || chr(10)
                || 'Ouvrez Immo-Zen (Locataires et baux, fiche du bail) pour calculer le nouveau loyer et préparer le courrier au locataire.' || chr(10)
                || 'La révision ne s''applique pas rétroactivement, et elle n''est plus possible un an après la date anniversaire.' || chr(10) || chr(10)
                || 'Vous pouvez désactiver cette alerte dans Immo-Zen (Paramètres, Alertes par e-mail).',
                l.id, 'alerte-irl:' || l.id || ':' || v_anniv)
        on conflict (dedupe_key) do nothing;
        get diagnostics k = row_count; v_irl := v_irl + k;
      end if;
    end if;

    -- 2. échéance du bail : date limite pour donner congé
    if l.want_fin then
      v_kind := coalesce(l.contract ->> 'kind', 'vide');
      v_end := null; v_notice := null;
      if l.end_date is not null then
        v_end := l.end_date; v_notice := interval '0 day';
      elsif v_kind in ('vide', 'meuble') then
        v_term := case v_kind when 'meuble' then 1 else 3 end;
        v_notice := case v_kind when 'meuble' then interval '3 months' else interval '6 months' end;
        v_end := (l.start_date + make_interval(years => v_term))::date - 1;
        while (v_end - v_notice)::date < v_today loop v_end := (v_end + 1 + make_interval(years => v_term))::date - 1; end loop;
      end if;
      if v_end is not null then
        v_deadline := (v_end - v_notice)::date;
        v_lead := case when v_notice = interval '0 day' then 30 else 60 end;
        if v_today between v_deadline - v_lead and v_deadline then
          insert into email_outbox (user_id, kind, to_emails, subject, body_text, lease_id, dedupe_key)
          values (l.user_id, 'alerte_bailleur', array[l.owner_email],
                  case when v_notice = interval '0 day' then 'Fin du bail le ' || to_char(v_end, 'DD/MM/YYYY') else 'Échéance du bail le ' || to_char(v_end, 'DD/MM/YYYY') end || ' – ' || l.property_title,
                  'Bonjour,' || chr(10) || chr(10)
                  || case when v_notice = interval '0 day' then
                       'Le bail de « ' || l.property_title || ' » se termine le ' || to_char(v_end, 'DD/MM/YYYY') || '.' || chr(10)
                       || 'Pensez à l''état des lieux de sortie et à la restitution du dépôt de garantie (un mois après la remise des clés si l''état des lieux est conforme, deux mois sinon).'
                     else
                       'Le bail ' || case v_kind when 'meuble' then 'meublé' else 'vide' end || ' de « ' || l.property_title || ' » arrive à échéance le ' || to_char(v_end, 'DD/MM/YYYY')
                       || '. Sans congé, il se renouvelle automatiquement pour ' || case v_kind when 'meuble' then 'un an' else 'trois ans' end || '.' || chr(10) || chr(10)
                       || 'Si vous souhaitez y mettre fin (reprise pour habiter, vente ou motif légitime et sérieux), le congé doit parvenir au locataire au plus tard le '
                       || to_char(v_deadline, 'DD/MM/YYYY') || ' (' || case v_kind when 'meuble' then 'trois' else 'six' end || ' mois avant l''échéance), par lettre recommandée, acte de commissaire de justice ou remise en main propre contre signature.'
                     end
                  || chr(10) || chr(10) || 'Vous pouvez désactiver cette alerte dans Immo-Zen (Paramètres, Alertes par e-mail).',
                  l.id, 'alerte-fin-bail:' || l.id || ':' || v_end)
          on conflict (dedupe_key) do nothing;
          get diagnostics k = row_count; v_fin := v_fin + k;
        end if;
      end if;
    end if;
  end loop;
  return jsonb_build_object('today', v_today, 'revisions', v_irl, 'echeances', v_fin);
end $$;
revoke all on function public.iz_owner_alerts(date) from public, anon, authenticated;

-- planification quotidienne (6 h 40, Paris ≈ 5 h 40 UTC) si pg_cron est installé ; la file d'e-mails part ensuite
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'immozen-alertes-bailleur';
    perform cron.schedule('immozen-alertes-bailleur', '40 5 * * *', 'select public.iz_owner_alerts()');
  end if;
end $$;
