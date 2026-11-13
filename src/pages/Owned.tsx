import { useMemo, useState } from 'react';
import { useStore } from '../data/store.tsx';
import type { OccupationStatus } from '../data/types.ts';
import { OCCUPATION_LABELS } from '../domain/labels.ts';
import { isOwned } from '../domain/property.ts';
import { DataTable } from '../ui/DataTable.tsx';
import { Button, EmptyState, Help, PageHeader, useConfirm } from '../ui/components.tsx';
import { navigate } from '../ui/router.ts';
import { exportRows, occupationLabel, ownedColumns, usePropertyRows } from './propertyShared.tsx';
import { usePropertyActions } from './useActions.tsx';
import { PropertyCards, useViewMode, ViewToggle } from './PropertyCards.tsx';
import type { PropertyRow } from './propertyShared.tsx';

export function OwnedPage() {
  const { data, update } = useStore();
  const { ask, dialog } = useConfirm();
  const actions = usePropertyActions(ask);
  const [occ, setOcc] = useState<OccupationStatus | ''>('');
  const all = usePropertyRows(isOwned);
  const columns = useMemo(() => ownedColumns(), []);
  const rows = all.filter((r) => !occ || occupationLabel(r) === OCCUPATION_LABELS[occ]);
  const [view, setView] = useViewMode('mes-biens');
  const [search, setSearch] = useState('');
  const occFilter = (
    <label className="inline-select">Occupation
      <select value={occ} onChange={(e) => setOcc(e.target.value as OccupationStatus | '')}>
        <option value="">Toutes</option>
        {(Object.keys(OCCUPATION_LABELS) as OccupationStatus[]).map((o) => <option key={o} value={o}>{OCCUPATION_LABELS[o]}</option>)}
      </select>
    </label>
  );
  const rowActions = (r: PropertyRow) => [
    { label: 'Ouvrir la fiche', onSelect: () => navigate(`/bien/${r.p.id}`) },
    { label: 'Modifier', onSelect: () => navigate(`/bien/${r.p.id}/modifier`) },
    { label: 'Nouveau bail', onSelect: () => navigate(`/baux/nouveau?bien=${r.p.id}`) },
    { label: 'Ajouter une dépense', onSelect: () => navigate(`/depenses?bien=${r.p.id}`) },
    ...(Object.keys(OCCUPATION_LABELS) as OccupationStatus[]).filter((o) => o !== r.p.occupation_status && o !== 'loue' && !r.rs.activeLeases.length)
      .map((o) => ({ label: `Occupation : ${OCCUPATION_LABELS[o]}`, onSelect: () => void update('properties', r.p, { occupation_status: o }, `Le bien « ${r.p.title} »`) })),
    { label: 'Revenir en prospection', onSelect: () => void actions.setStatus(r.p, 'sous_compromis') },
    { label: 'Supprimer', danger: true, onSelect: () => void actions.del(r.p) },
  ];
  const empty = (
    <EmptyState title="Aucun bien détenu pour l’instant"
      action={<Button variant="primary" onClick={() => navigate('/bien/nouveau?mode=owned')}>Ajouter un bien détenu</Button>}>
      Un bien passé au statut « Acquis » en prospection apparaît ici automatiquement, avec son historique.
    </EmptyState>
  );

  return (
    <>
      <PageHeader title="Mes biens" subtitle="Les biens que vous détenez : acquis depuis la prospection ou ajoutés directement."
        actions={<Button variant="primary" onClick={() => navigate('/bien/nouveau?mode=owned')}>Ajouter un bien détenu</Button>} />
      <div className="list-bar">{view === 'cartes' && occFilter}<ViewToggle value={view} onChange={setView} /></div>
      {view === 'cartes' ? (
        <PropertyCards rows={rows} kind="owned" onOpen={(r) => navigate(`/bien/${r.p.id}`)} actions={rowActions} search={search} onSearch={setSearch} empty={empty} />
      ) : (
      <DataTable
        id="mes-biens"
        rows={rows}
        columns={columns}
        rowKey={(r) => r.p.id}
        initialSort={{ id: 'acquired', dir: 'desc' }}
        onOpen={(r) => navigate(`/bien/${r.p.id}`)}
        searchPlaceholder="Rechercher un bien, une adresse…"
        toolbar={occFilter}
        rowActions={rowActions}
        bulkActions={(sel) => <>
          <Button size="sm" onClick={() => void exportRows('xlsx', 'mes-biens', columns, sel, data.scenarios)}>Excel</Button>
          <Button size="sm" onClick={() => void exportRows('csv', 'mes-biens', columns, sel, data.scenarios)}>CSV</Button>
          <Button size="sm" onClick={() => void exportRows('json', 'mes-biens', columns, sel, data.scenarios)}>JSON</Button>
        </>}
        empty={empty}
      />
      )}
      <Help>« Loué » et le locataire actif découlent des baux en cours. Encaissements, dépenses et cash-flow réel portent sur l’année en cours (loyers encaissés − dépenses payées, hors dépôt de garantie, avant impôts). Le cash-flow prévu de la simulation peut être affiché via « Colonnes ».</Help>
      <div className="export-row">
        <span className="muted">Exporter la liste affichée :</span>
        <Button size="sm" onClick={() => void exportRows('xlsx', 'mes-biens', columns, rows, data.scenarios)}>Excel (.xlsx)</Button>
        <Button size="sm" onClick={() => void exportRows('csv', 'mes-biens', columns, rows, data.scenarios)}>CSV</Button>
        <Button size="sm" onClick={() => void exportRows('json', 'mes-biens', columns, rows, data.scenarios)}>JSON</Button>
      </div>
      {dialog}
    </>
  );
}
