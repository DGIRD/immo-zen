-- Date d'acquisition par défaut (ANO-014) : un bien ajouté directement dans « Mes biens » sans date prenait
-- la date du jour, et sortait des déclarations des années où son crédit courait déjà. On prend désormais la
-- première échéance du crédit quand elle est passée.
-- Correctif de sécurité (ANO-015) : chemin de recherche fixé sur iz_tdfc_touch.

create or replace function public.iz_property_status_rules()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  snap jsonb;
begin
  -- Archivage : mémoriser le statut précédent pour pouvoir désarchiver
  if new.status = 'archive' and (tg_op = 'INSERT' or old.status <> 'archive') then
    new.status_before_archive := coalesce(new.status_before_archive, case when tg_op = 'UPDATE' then old.status end, 'repere');
  elsif new.status <> 'archive' then
    new.status_before_archive := null;
  end if;

  -- Passage à « acquis » : le bien rejoint « Mes biens »
  if new.status = 'acquis' and (tg_op = 'INSERT' or old.status <> 'acquis') then
    -- sans date saisie : la 1re échéance du crédit si elle est passée, sinon aujourd'hui (ANO-014)
    new.acquired_at := coalesce(new.acquired_at, least(new.loan_start_date, current_date), current_date);
    new.occupation_status := coalesce(new.occupation_status, 'vacant');
    if new.acquisition_snapshot is null and new.primary_scenario_id is not null then
      select jsonb_build_object(
               'scenario_id', s.id, 'scenario_name', s.name, 'inputs', s.inputs,
               'results', s.results, 'engine_version', s.engine_version, 'taken_at', now())
        into snap
        from public.scenarios s
       where s.id = new.primary_scenario_id and s.user_id = new.user_id;
      new.acquisition_snapshot := snap;
    end if;
  end if;

  -- Un bien qui n'est plus détenu n'a pas de statut d'occupation
  if new.status <> 'acquis' then
    new.occupation_status := null;
  end if;
  return new;
end;
$$;

create or replace function public.iz_tdfc_touch() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
