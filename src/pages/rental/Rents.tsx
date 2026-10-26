import { useMemo, useState } from 'react';
import { useStore } from '../../data/store.tsx';
import type { Payment, Receipt } from '../../data/types.ts';
import { downloadBlob, stamp, toCsv, toXlsx, type ExportColumn } from '../../domain/exporting.ts';
import { date, money2 } from '../../domain/format.ts';
import { CHARGE_STATUS_LABELS, monthLabel, PAYMENT_METHOD_LABELS, type ChargeView } from '../../domain/rental.ts';
import { round2 } from '../../domain/simulator.ts';
import { chargeDuplicates, paymentDuplicates } from '../../domain/duplicates.ts';
import { receiptBacklog } from '../../domain/receiptBacklog.ts';
import { DataTable, type Column } from '../../ui/DataTable.tsx';
import { GridEditor, type GridColumn } from '../../ui/GridEditor.tsx';
import { Button, Checkbox, EmptyState, PageHeader, Section, Tabs, useConfirm } from '../../ui/components.tsx';
import { navigate } from '../../ui/router.ts';
import { RentImportDialog } from './RentImport.tsx';
import { ReceiptBacklogDialog } from './ReceiptBacklog.tsx';
import { applyPaymentEdit, ChargeActions, ChargeBadge, METHODS, PaymentDialog, paymentAllocated, periodLabel, ReceiptDialog, ReceiptsTable, usePaymentActions, useRental } from './common.tsx';

type Filter = 'a_traiter' | 'impayee' | 'partielle' | 'payee' | 'a_venir' | 'doublons' | 'toutes';

export const DupPill = ({ title }: { title: string }) => <span className="pill pill-warn dup-flag" title={title}>doublon possible</span>;

export function RentsPage() {
  const { views, leaseById, leaseLabel, quittanceFor } = useRental();
  const [tab, setTab] = useState<'echeances' | 'paiements' | 'quittances'>('echeances');
  const [filter, setFilter] = useState<Filter>('a_traiter');
  const [month, setMonth] = useState('');
  const [leaseFilter, setLeaseFilter] = useState('');
  const [pay, setPay] = useState<{ chargeId?: string; leaseId?: string; mode: 'saisie' | 'confirmation' } | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [importing, setImporting] = useState(false);
  const [grid, setGrid] = useState(false);
  const [backlogOpen, setBacklogOpen] = useState(false);
  const store = useStore();
  const { ask, dialog } = useConfirm();

  const months = useMemo(() => [...new Set(views.map((v) => v.charge.period_start.slice(0, 7)))].sort().reverse(), [views]);
  const data = store.data;
  const dupCharges = useMemo(() => chargeDuplicates(data.charges), [data.charges]);
  const backlog = useMemo(() => receiptBacklog(views, data.receipts, leaseFilter || undefined), [views, data.receipts, leaseFilter]);
  const rows = views.filter((v) => {
    if (leaseFilter && v.charge.lease_id !== leaseFilter) return false;
    if (month && !v.charge.period_start.startsWith(month)) return false;
    if (filter === 'doublons') return dupCharges.ids.has(v.charge.id);
    if (filter === 'a_traiter') return v.overdue || (v.status === 'payee' && !quittanceFor(v.charge.id) && !v.charge.cancelled_at);
    if (filter === 'toutes') return true;
    return v.status === filter;
  });
  const totals = rows.reduce((t, v) => ({ due: round2(t.due + (v.charge.cancelled_at ? 0 : v.total)), paid: round2(t.paid + v.paid), rest: round2(t.rest + v.remaining) }), { due: 0, paid: 0, rest: 0 });
  const toConfirm = views.filter((v) => v.overdue).length;
  const toReceipt = views.filter((v) => v.status === 'payee' && !v.charge.cancelled_at && !quittanceFor(v.charge.id)).length;

  const columns: Column<ChargeView>[] = [
    { id: 'lease', label: 'Bail', value: (v) => { const l = leaseById.get(v.charge.lease_id); return l ? leaseLabel(l) : '—'; }, primary: true },
    { id: 'period', label: 'Période', value: (v) => v.charge.period_start, render: (v) => periodLabel(v.charge), mobile: true },
    { id: 'due', label: 'Échéance', value: (v) => v.charge.due_date, kind: 'date', render: (v) => date(v.charge.due_date), mobile: true },
    { id: 'total', label: 'Dû', value: (v) => v.total, kind: 'money', align: 'right', render: (v) => money2(v.total) },
    { id: 'paid', label: 'Réglé', value: (v) => v.paid, kind: 'money', align: 'right', render: (v) => money2(v.paid) },
    { id: 'rest', label: 'Reste', value: (v) => v.remaining, kind: 'money', align: 'right', render: (v) => <span className={v.overdue ? 'neg' : ''}>{money2(v.remaining)}</span>, mobile: true },
    { id: 'status', label: 'Statut', value: (v) => CHARGE_STATUS_LABELS[v.status], render: (v) => <><ChargeBadge v={v} />{dupCharges.ids.has(v.charge.id) && <DupPill title="Une autre échéance du même bail couvre la même période (ou le même montant à la même date)" />}</>, mobile: true },
    { id: 'actions', label: 'Actions', value: () => null, sortable: false, searchable: false,
      render: (v) => <ChargeActions v={v} onPay={(x) => setPay({ chargeId: x.charge.id, leaseId: x.charge.lease_id, mode: 'saisie' })} onConfirm={(x) => setPay({ chargeId: x.charge.id, leaseId: x.charge.lease_id, mode: 'confirmation' })} onReceipt={setReceipt} />, mobile: true },
  ];

  const chargeGrid: GridColumn<ChargeView>[] = [
    { id: 'lease', label: 'Bail', type: 'text', get: () => null, fixed: (v) => { const l = leaseById.get(v.charge.lease_id); return l ? leaseLabel(l) : '—'; } },
    { id: 'period', label: 'Période', type: 'text', get: () => null, fixed: (v) => periodLabel(v.charge) },
    { id: 'due_date', label: 'Échéance', type: 'date', get: (v) => v.charge.due_date, validate: (x) => (x ? null : 'Date obligatoire') },
    { id: 'rent_amount', label: 'Loyer', type: 'money', get: (v) => v.charge.rent_amount,
      validate: (x, v, all) => (x === null || (x as number) < 0 ? 'Montant positif ou nul' : round2((x as number) + Number(all.charges_amount ?? 0)) < v.paid ? `Inférieur au déjà réglé (${money2(v.paid)})` : null) },
    { id: 'charges_amount', label: 'Charges', type: 'money', get: (v) => v.charge.charges_amount,
      validate: (x) => (x === null || (x as number) < 0 ? 'Montant positif ou nul' : null) },
    { id: 'label', label: 'Libellé', type: 'text', get: (v) => v.charge.label, fixed: (v) => (v.charge.kind === 'loyer' ? <span className="muted">loyer du mois</span> : false) },
  ];
  async function saveCharges(changes: { row: ChargeView; values: Record<string, string | number | null> }[]) {
    let n = 0;
    for (const { row, values } of changes) {
      const patch: Record<string, unknown> = {};
      if ('due_date' in values) patch.due_date = values.due_date;
      if ('rent_amount' in values) patch.rent_amount = round2(Number(values.rent_amount));
      if ('charges_amount' in values) patch.charges_amount = round2(Number(values.charges_amount));
      if ('label' in values) patch.label = values.label;
      if (await store.update('rent_charges', row.charge, patch, `L’échéance de ${periodLabel(row.charge)}`)) n++;
    }
    if (n) store.notify(`${n} échéance${n > 1 ? 's' : ''} modifiée${n > 1 ? 's' : ''}.`);
    return n;
  }
  /** Annule les échéances sélectionnées comme doublons : seulement celles sans paiement ni quittance. */
  async function cancelDuplicates(sel: ChargeView[]) {
    const ok = sel.filter((v) => v.paid === 0 && !v.charge.cancelled_at && !quittanceFor(v.charge.id));
    const kept = sel.length - ok.length;
    if (!ok.length) { store.notify('Les échéances sélectionnées ont reçu des paiements : retirez ou déplacez d’abord les paiements.', 'error'); return false; }
    if (!(await ask('Annuler comme doublons', <>{ok.length} échéance{ok.length > 1 ? 's' : ''} ser{ok.length > 1 ? 'ont annulées' : 'a annulée'} avec le motif « Doublon » et ne ser{ok.length > 1 ? 'ont' : 'a'} plus due{ok.length > 1 ? 's' : ''}.{kept > 0 && <> {kept} autre{kept > 1 ? 's' : ''}, déjà réglée{kept > 1 ? 's' : ''} ou quittancée{kept > 1 ? 's' : ''}, ser{kept > 1 ? 'ont conservées' : 'a conservée'}.</>}</>, 'Annuler les échéances'))) return false;
    let n = 0;
    for (const v of ok) if (await store.update('rent_charges', v.charge, { cancelled_at: new Date().toISOString(), cancel_reason: 'Doublon' }, 'L’échéance')) n++;
    if (n) store.notify(`${n} échéance${n > 1 ? 's' : ''} annulée${n > 1 ? 's' : ''} (doublon).`);
    return n > 0;
  }

  const exportCols: ExportColumn<ChargeView>[] = [
    ...columns.filter((c) => c.id !== 'actions').map((c) => ({ label: c.label, value: c.value, kind: c.kind })),
    { label: 'Quittance', value: (v) => quittanceFor(v.charge.id)?.number ?? null },
  ];
  const exp = async (f: 'xlsx' | 'csv') => {
    const name = `immo-zen-echeances-${stamp()}`;
    if (f === 'csv') downloadBlob(new Blob([toCsv(exportCols, rows)], { type: 'text/csv;charset=utf-8' }), `${name}.csv`);
    else downloadBlob(await toXlsx([{ name: 'Échéances', columns: exportCols, rows }, { name: 'Paiements', columns: paymentExport((id) => { const l = leaseById.get(id); return l ? leaseLabel(l) : null; }), rows: data.payments }]), `${name}.xlsx`);
  };

  return (
    <>
      <PageHeader title="Loyers et paiements" subtitle="Échéances de tous vos baux. Le solde découle uniquement des échéances et des paiements enregistrés."
        actions={<>
          <Button disabled={!data.leases.length} onClick={() => setBacklogOpen(true)} title="Émettre les quittances manquantes des périodes déjà réglées">
            Mettre en cohérence les quittances{backlog.items.length ? ` (${backlog.items.length})` : ''}</Button>
          <Button disabled={!data.leases.length} onClick={() => setImporting(true)}>Importer des loyers (Excel)</Button>
          <Button variant="primary" disabled={!data.leases.length} onClick={() => setPay({ mode: 'saisie' })}>Enregistrer un paiement</Button>
        </>} />
      <RentImportDialog open={importing} onClose={() => setImporting(false)} />
      <ReceiptBacklogDialog open={backlogOpen} onClose={() => setBacklogOpen(false)} leaseId={leaseFilter || undefined} />
      {dialog}
      {!data.leases.length ? (
        <EmptyState title="Aucun bail" action={<Button variant="primary" onClick={() => navigate('/baux/nouveau')}>Créer un bail</Button>}>Les échéances de loyer sont générées à partir des baux.</EmptyState>
      ) : (
        <>
          <div className="figures">
            <button type="button" className="figure link-figure" onClick={() => { setFilter('impayee'); setTab('echeances'); }}>
              <span className="figure-label">Paiements à confirmer</span><span className={`figure-value ${toConfirm ? 'neg' : ''}`}>{toConfirm}</span><span className="figure-hint">échéances passées non réglées</span>
            </button>
            <button type="button" className="figure link-figure" onClick={() => { setFilter('payee'); setTab('echeances'); }}>
              <span className="figure-label">Quittances à émettre</span><span className="figure-value">{toReceipt}</span><span className="figure-hint">périodes intégralement réglées</span>
            </button>
            <div className="figure"><span className="figure-label">Dû (sélection)</span><span className="figure-value">{money2(totals.due)}</span><span className="figure-hint">réglé {money2(totals.paid)}</span></div>
            <div className="figure"><span className="figure-label">Reste dû (sélection)</span><span className={`figure-value ${totals.rest ? 'neg' : ''}`}>{money2(totals.rest)}</span></div>
          </div>
          <p className="muted small">L’absence de réponse à l’e-mail de confirmation ne vaut jamais paiement : une échéance reste impayée tant que vous n’avez pas confirmé ou saisi le paiement.</p>
          <div className="row lease-filter">
            <label className="inline-select">Bail
              <select value={leaseFilter} onChange={(e) => setLeaseFilter(e.target.value)} aria-label="Filtrer par bail">
                <option value="">Tous les baux</option>
                {[...data.leases].sort((a, b) => leaseLabel(a).localeCompare(leaseLabel(b))).map((l) => <option key={l.id} value={l.id}>{leaseLabel(l)}</option>)}
              </select></label>
          </div>
          <Tabs tabs={[['echeances', 'Échéances'], ['paiements', `Paiements (${data.payments.filter((p) => !leaseFilter || p.lease_id === leaseFilter).length})`],
            ['quittances', `Quittances et reçus (${data.receipts.filter((r) => !r.cancelled_at && (!leaseFilter || r.lease_id === leaseFilter)).length})`]]} value={tab} onChange={(t) => { setTab(t); setGrid(false); }} />
          {tab === 'echeances' && backlog.items.length > 0 && !grid && (
            <p className="note">{backlog.items.length} période{backlog.items.length > 1 ? 's' : ''} intégralement réglée{backlog.items.length > 1 ? 's' : ''} sans quittance.{' '}
              <button type="button" className="link" onClick={() => setBacklogOpen(true)}>Mettre en cohérence les quittances</button></p>
          )}
          {tab === 'echeances' && grid ? (
            <GridEditor rows={rows.filter((v) => !v.charge.cancelled_at)} columns={chargeGrid} rowKey={(v) => v.charge.id} rowLabel={(v) => periodLabel(v.charge)}
              lock={(v) => { const q = quittanceFor(v.charge.id); return q ? `Quittance ${q.number} : supprimez-la pour modifier` : null; }}
              flag={(v) => (dupCharges.ids.has(v.charge.id) ? <DupPill title="Doublon possible" /> : null)}
              note="Échéances affichées selon les filtres. Une échéance quittancée n’est pas modifiable ; le montant dû ne peut pas descendre sous ce qui est déjà réglé."
              onSave={saveCharges} onClose={() => setGrid(false)} />
          ) : tab === 'echeances' ? (
            <DataTable id="echeances" rows={rows} columns={columns} rowKey={(v) => v.charge.id} initialSort={{ id: 'due', dir: 'desc' }}
              onOpen={(v) => navigate(`/baux/${v.charge.lease_id}`)}
              bulkActions={(sel, clear) => <Button size="sm" variant="danger" onClick={async () => { if (await cancelDuplicates(sel)) clear(); }}>Annuler comme doublons ({sel.length})</Button>}
              toolbar={<>
                <label className="inline-select">Afficher
                  <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
                    <option value="a_traiter">À traiter</option><option value="impayee">Impayées</option><option value="partielle">Partiellement payées</option>
                    <option value="payee">Payées</option><option value="a_venir">À venir</option>
                    <option value="doublons">Doublons possibles ({dupCharges.ids.size})</option><option value="toutes">Toutes</option>
                  </select></label>
                <Button size="sm" onClick={() => setGrid(true)} disabled={!rows.length}>Modifier en grille</Button>
                <label className="inline-select">Mois
                  <select value={month} onChange={(e) => setMonth(e.target.value)}>
                    <option value="">Tous</option>{months.map((m) => <option key={m} value={m}>{monthLabel(`${m}-01`)}</option>)}
                  </select></label>
              </>}
              empty={<EmptyState title={filter === 'a_traiter' ? 'Rien à traiter' : filter === 'doublons' ? 'Aucun doublon' : 'Aucune échéance'}>{filter === 'a_traiter' ? 'Aucun impayé échu et aucune quittance en attente.' : filter === 'doublons' ? 'Aucune échéance ne fait doublon avec une autre.' : 'Aucune échéance ne correspond.'}</EmptyState>} />
          ) : tab === 'paiements' ? <PaymentsTable leaseId={leaseFilter} grid={grid} setGrid={setGrid} />
            : <Section><ReceiptsTable receipts={data.receipts.filter((r) => !leaseFilter || r.lease_id === leaseFilter).sort((a, b) => b.period_start.localeCompare(a.period_start) || b.number.localeCompare(a.number))}
                onOpen={setReceipt} leaseLabelOf={(id) => { const l = leaseById.get(id); return l ? leaseLabel(l) : '—'; }} /></Section>}
          <div className="export-row">
            <span className="muted">Exporter :</span>
            <Button size="sm" onClick={() => void exp('xlsx')}>Excel (.xlsx)</Button>
            <Button size="sm" onClick={() => void exp('csv')}>CSV</Button>
          </div>
        </>
      )}
      <PaymentDialog open={!!pay} onClose={() => setPay(null)} leaseId={pay?.leaseId} chargeId={pay?.chargeId} mode={pay?.mode} />
      <ReceiptDialog receipt={receipt} onClose={() => setReceipt(null)} onReplaced={setReceipt} />
    </>
  );
}

function paymentExport(labelOf: (leaseId: string) => string | null): ExportColumn<Payment>[] {
  return [
    { label: 'Date', value: (p) => p.paid_on, kind: 'date' },
    { label: 'Bail', value: (p) => labelOf(p.lease_id) },
    { label: 'Montant', value: (p) => p.amount, kind: 'money' },
    { label: 'Moyen', value: (p) => PAYMENT_METHOD_LABELS[p.method] },
    { label: 'Référence', value: (p) => p.reference },
    { label: 'Date par défaut', value: (p) => (p.date_defaulted ? 'oui' : 'non') },
  ];
}

function PaymentsTable({ leaseId, grid, setGrid }: { leaseId: string; grid: boolean; setGrid: (b: boolean) => void }) {
  const store = useStore();
  const { data } = store;
  const { leaseById, leaseLabel, today } = useRental();
  const pay = usePaymentActions();
  const [onlyDups, setOnlyDups] = useState(false);
  const all = useMemo(() => paymentDuplicates(data.payments), [data.payments]);
  const dups = useMemo(() => (leaseId ? { ...all, extra: all.extra.filter((p) => p.lease_id === leaseId), ids: new Set([...all.ids].filter((id) => data.payments.find((p) => p.id === id)?.lease_id === leaseId)) } : all), [all, leaseId, data.payments]);
  const rows = data.payments.filter((p) => (!leaseId || p.lease_id === leaseId) && (!onlyDups || dups.ids.has(p.id)));
  const labelOf = (p: Payment) => { const l = leaseById.get(p.lease_id); return l ? leaseLabel(l) : '—'; };
  const columns: Column<Payment>[] = [
    { id: 'date', label: 'Date', value: (p) => p.paid_on, kind: 'date', render: (p) => <>{date(p.paid_on)}{p.date_defaulted && <span className="pill pill-warn">date par défaut</span>}</>, primary: true },
    { id: 'lease', label: 'Bail', value: labelOf, mobile: true },
    { id: 'amount', label: 'Montant', value: (p) => p.amount, kind: 'money', align: 'right', render: (p) => money2(p.amount), mobile: true },
    { id: 'method', label: 'Moyen', value: (p) => PAYMENT_METHOD_LABELS[p.method], mobile: true },
    { id: 'ref', label: 'Référence', value: (p) => p.reference, render: (p) => <>{p.reference ?? '—'}{dups.ids.has(p.id) && <DupPill title="Même bail, même montant, à quelques jours d’un autre paiement" />}</> },
    { id: 'free', label: 'Non affecté', value: (p) => round2(p.amount - paymentAllocated(p, data.allocations)), kind: 'money', align: 'right',
      render: (p) => { const f = round2(p.amount - paymentAllocated(p, data.allocations)); return f > 0 ? <span className="pos" title="Avance du locataire">{money2(f)}</span> : '—'; } },
    { id: 'delete', label: 'Supprimer', value: () => null, sortable: false, searchable: false, align: 'right', mobile: true,
      render: (p) => <button type="button" className="icon-btn row-delete" aria-label={`Supprimer le paiement du ${date(p.paid_on)} (${money2(p.amount)})`} title="Supprimer" onClick={() => pay.remove(p)}>🗑</button> },
  ];
  const gridCols: GridColumn<Payment>[] = [
    { id: 'lease', label: 'Bail', type: 'text', get: () => null, fixed: labelOf },
    { id: 'paid_on', label: 'Date', type: 'date', get: (p) => p.paid_on, validate: (x) => (!x ? 'Date obligatoire' : String(x) > today ? 'Date future' : null) },
    { id: 'amount', label: 'Montant', type: 'money', get: (p) => p.amount,
      validate: (x) => (x === null || !((x as number) > 0) ? 'Montant positif' : null) },
    { id: 'method', label: 'Moyen', type: 'select', options: METHODS, get: (p) => p.method },
    { id: 'reference', label: 'Référence', type: 'text', get: (p) => p.reference, validate: (x) => (String(x ?? '').length > 200 ? '200 caractères au plus' : null) },
    { id: 'comment', label: 'Commentaire', type: 'text', get: (p) => p.comment, width: '12rem' },
  ];
  async function saveGrid(changes: { row: Payment; values: Record<string, string | number | null> }[]) {
    let n = 0;
    const msgs: string[] = [];
    for (const { row, values } of changes) {
      // les modifications de montant refont la répartition : on repart des données à jour à chaque ligne
      const snap = 'amount' in values ? await store.repo.loadAll().catch(() => null) : data;
      if (!snap) { store.notify('Données indisponibles : réessayez.', 'error'); break; }
      const current = snap.payments.find((p) => p.id === row.id);
      if (!current) continue;
      const f = { amount: Number(values.amount ?? current.amount), paid_on: String(values.paid_on ?? current.paid_on), method: (values.method ?? current.method) as Payment['method'],
        reference: 'reference' in values ? (values.reference as string | null) : current.reference, comment: 'comment' in values ? (values.comment as string | null) : current.comment };
      const msg = await applyPaymentEdit(store, snap, current, f);
      if (msg) { n++; if (/document/.test(msg)) msgs.push(msg); }
    }
    await store.refresh();
    if (n) store.notify(`${n} paiement${n > 1 ? 's' : ''} modifié${n > 1 ? 's' : ''}.${msgs.length ? ' Les quittances concernées ont été rééditées ou annulées.' : ''}`);
    return n;
  }
  if (grid) {
    return (
      <Section>
        <GridEditor rows={[...rows].sort((a, b) => b.paid_on.localeCompare(a.paid_on))} columns={gridCols} rowKey={(p) => p.id} rowLabel={(p) => `paiement du ${date(p.paid_on)}`}
          flag={(p) => (dups.ids.has(p.id) ? <DupPill title="Doublon possible" /> : null)}
          note="Paiements affichés selon le filtre de bail. Un montant modifié refait la répartition sur les échéances ; les quittances concernées sont annulées puis rééditées si la période reste réglée."
          onSave={saveGrid} onClose={() => setGrid(false)} />
      </Section>
    );
  }
  return (
    <Section>
      <DataTable id="paiements" rows={rows} columns={columns} rowKey={(p) => p.id} initialSort={{ id: 'date', dir: 'desc' }}
        onOpen={(p) => navigate(`/baux/${p.lease_id}`)}
        toolbar={<>
          <Checkbox label={`Doublons possibles uniquement (${dups.ids.size})`} checked={onlyDups} onChange={setOnlyDups} />
          <Button size="sm" onClick={() => setGrid(true)} disabled={!rows.length}>Modifier en grille</Button>
        </>}
        rowActions={(p) => [
          { label: 'Modifier', onSelect: () => pay.edit(p) },
          { label: 'Voir le bail', onSelect: () => navigate(`/baux/${p.lease_id}`) },
          { label: 'Supprimer', danger: true, onSelect: () => pay.remove(p) },
        ]}
        bulkActions={(sel, clear) => <>
          <Button size="sm" variant="danger" onClick={() => pay.removeMany(sel, clear)}>Supprimer ({sel.length})</Button>
          {sel.some((p) => dups.extra.some((x) => x.id === p.id)) && <span className="muted small">dont {sel.filter((p) => dups.extra.some((x) => x.id === p.id)).length} doublon(s) probable(s)</span>}
        </>}
        empty={<EmptyState title={onlyDups ? 'Aucun doublon' : 'Aucun paiement'}>{onlyDups ? 'Aucun paiement ne ressemble à un autre.' : undefined}</EmptyState>} />
      {dups.extra.length > 0 && !onlyDups && (
        <p className="note note-warn">{dups.extra.length} paiement{dups.extra.length > 1 ? 's semblent' : ' semble'} en double (même bail, même montant, à quelques jours d’écart).{' '}
          <button type="button" className="link" onClick={() => setOnlyDups(true)}>Afficher les doublons</button>{' · '}
          <button type="button" className="link" onClick={() => pay.removeMany(dups.extra)}>Supprimer les doublons (garder le premier enregistré)</button></p>
      )}
      {pay.ui}
    </Section>
  );
}
