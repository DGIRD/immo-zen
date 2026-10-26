import { useMemo, useState } from 'react';
import { usePlan, useStore } from '../data/store.tsx';
import { refusal } from '../domain/plans.ts';
import type { PropertyStatus } from '../data/types.ts';
import { todayParis } from '../domain/format.ts';
import { STATUS_LABELS, STATUS_ORDER } from '../domain/labels.ts';
import { isProspect } from '../domain/property.ts';
import { DataTable } from '../ui/DataTable.tsx';
import { Button, Checkbox, EmptyState, PageHeader, useConfirm } from '../ui/components.tsx';
import { navigate, useRoute } from '../ui/router.ts';
import { CompareDialog } from './Compare.tsx';
import { exportRows, prospectColumns, usePropertyRows, type PropertyRow } from './propertyShared.tsx';
import { usePropertyActions } from './useActions.tsx';

type Scope = 'en_cours' | 'clos' | 'archive' | 'tous' | PropertyStatus;
const CLOSED: PropertyStatus[] = ['refuse', 'abandonne'];

export function ProspectionPage() {
  const { data, notify } = useStore();
  const plan = usePlan();
  const { ask, dialog } = useConfirm();
  const actions = usePropertyActions(ask);
  // filtre initial depuis l'adresse (ex. #/prospection?statut=visite, depuis le parcours du tableau de bord)
  const initial = useRoute().query.get('statut');
  const [scope, setScope] = useState<Scope>(() => (initial && (STATUS_ORDER as string[]).includes(initial) && initial !== 'acquis' ? initial as PropertyStatus : 'en_cours'));
  const [dueOnly, setDueOnly] = useState(false);
  const [compare, setCompare] = useState<PropertyRow[] | null>(null);
  const all = usePropertyRows(isProspect);
  const columns = useMemo(() => prospectColumns(), []);
  const today = todayParis();

  const rows = all.filter(({ p }) => {
    if (scope === 'en_cours' && (p.status === 'archive' || CLOSED.includes(p.status))) return false;
    if (scope === 'clos' && !CLOSED.includes(p.status)) return false;
    if (scope === 'archive' && p.status !== 'archive') return false;
    if (!['en_cours', 'clos', 'archive', 'tous'].includes(scope) && p.status !== scope) return false;
    if (dueOnly && !(p.follow_up_date && p.follow_up_date <= today)) return false;
    return true;
  });
  const due = all.filter(({ p }) => p.follow_up_date && p.follow_up_date <= today && p.status !== 'archive').length;

  return (
    <>
      <PageHeader title="Prospection" subtitle="Les biens que vous étudiez et qui ne sont pas encore acquis."
        actions={<Button variant="primary" onClick={() => navigate('/bien/nouveau')}>Ajouter un bien</Button>} />
      <DataTable
        id="prospection"
        rows={rows}
        columns={columns}
        rowKey={(r) => r.p.id}
        initialSort={{ id: 'updated', dir: 'desc' }}
        onOpen={(r) => navigate(`/bien/${r.p.id}`)}
        searchPlaceholder="Rechercher un titre, une ville, une agence…"
        toolbar={<>
          <label className="inline-select">Afficher
            <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
              <option value="en_cours">En cours</option>
              <option value="clos">Refusés et abandonnés</option>
              <option value="archive">Archivés</option>
              <option value="tous">Tous</option>
              <optgroup label="Par statut">
                {STATUS_ORDER.filter((s) => s !== 'acquis').map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </optgroup>
            </select>
          </label>
          <Checkbox label={`Relances à faire (${due})`} checked={dueOnly} onChange={setDueOnly} />
        </>}
        rowActions={(r) => [
          { label: 'Ouvrir la fiche', onSelect: () => navigate(`/bien/${r.p.id}`) },
          { label: 'Modifier', onSelect: () => navigate(`/bien/${r.p.id}/modifier`) },
          { label: 'Modifier la fiche et la simulation', onSelect: () => navigate(`/bien/${r.p.id}/modifier`) },
          { label: 'Dupliquer', onSelect: () => void actions.dup(r.p) },
          { label: 'Marquer comme acquis', onSelect: () => void actions.setStatus(r.p, 'acquis') },
          { label: r.p.status === 'archive' ? 'Désarchiver' : 'Archiver', onSelect: () => void actions.toggleArchive(r.p) },
          { label: 'Supprimer', danger: true, onSelect: () => void actions.del(r.p) },
        ]}
        bulkActions={(sel, clear) => <>
          <label className="inline-select">Statut
            <select value="" onChange={async (e) => {
              const s = e.target.value as PropertyStatus;
              if (!s) return;
              if (s === 'acquis' && sel.length > 1) { await ask('Une acquisition à la fois', 'Marquez les biens acquis un par un pour vérifier chaque transfert.', 'Compris', false); return; }
              for (const r of sel) await actions.setStatus(r.p, s);
              clear();
            }}>
              <option value="">Changer…</option>
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </label>
          <Button size="sm" disabled={sel.length < 2 || sel.length > 4} title="Entre 2 et 4 biens" onClick={() => plan.features.contacts ? setCompare(sel) : notify(refusal(plan, 'la comparaison de biens n’est pas incluse'), 'error')}>Comparer</Button>
          <Button size="sm" onClick={() => void exportRows('xlsx', 'prospection', columns, sel, data.scenarios)}>Excel</Button>
          <Button size="sm" onClick={() => void exportRows('csv', 'prospection', columns, sel, data.scenarios)}>CSV</Button>
          <Button size="sm" onClick={() => void exportRows('json', 'prospection', columns, sel, data.scenarios)}>JSON</Button>
        </>}
        empty={<EmptyState title="Aucun bien en prospection" action={<Button variant="primary" onClick={() => navigate('/bien/nouveau')}>Ajouter un premier bien</Button>}>
          Saisissez le bien et sa simulation dans un seul écran, puis suivez-le jusqu’à l’offre.
        </EmptyState>}
      />
      <div className="export-row">
        <span className="muted">Exporter la liste affichée :</span>
        <Button size="sm" onClick={() => void exportRows('xlsx', 'prospection', columns, rows, data.scenarios)}>Excel (.xlsx)</Button>
        <Button size="sm" onClick={() => void exportRows('csv', 'prospection', columns, rows, data.scenarios)}>CSV</Button>
        <Button size="sm" onClick={() => void exportRows('json', 'prospection', columns, rows, data.scenarios)}>JSON</Button>
      </div>
      <CompareDialog rows={compare} onClose={() => setCompare(null)} />
      {dialog}
    </>
  );
}
