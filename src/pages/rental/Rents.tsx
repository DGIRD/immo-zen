import { useMemo, useState } from 'react';
import { useStore } from '../../data/store.tsx';
import type { Payment, Receipt } from '../../data/types.ts';
import { downloadBlob, stamp, toCsv, toXlsx, type ExportColumn } from '../../domain/exporting.ts';
import { date, money2 } from '../../domain/format.ts';
import { CHARGE_STATUS_LABELS, monthLabel, PAYMENT_METHOD_LABELS, type ChargeView } from '../../domain/rental.ts';
import { round2 } from '../../domain/simulator.ts';
import { DataTable, type Column } from '../../ui/DataTable.tsx';
import { Button, EmptyState, PageHeader, Section, Tabs } from '../../ui/components.tsx';
import { navigate } from '../../ui/router.ts';
import { RentImportDialog } from './RentImport.tsx';
import { ChargeActions, ChargeBadge, PaymentDialog, paymentAllocated, periodLabel, ReceiptDialog, ReceiptsTable, usePaymentActions, useRental } from './common.tsx';

type Filter = 'a_traiter' | 'impayee' | 'partielle' | 'payee' | 'a_venir' | 'toutes';

export function RentsPage() {
  const { data } = useStore();
  const { views, leaseById, leaseLabel, quittanceFor } = useRental();
  const [tab, setTab] = useState<'echeances' | 'paiements' | 'quittances'>('echeances');
  const [filter, setFilter] = useState<Filter>('a_traiter');
  const [month, setMonth] = useState('');
  const [leaseFilter, setLeaseFilter] = useState('');
  const [pay, setPay] = useState<{ chargeId?: string; leaseId?: string; mode: 'saisie' | 'confirmation' } | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [importing, setImporting] = useState(false);

  const months = useMemo(() => [...new Set(views.map((v) => v.charge.period_start.slice(0, 7)))].sort().reverse(), [views]);
  const rows = views.filter((v) => {
    if (leaseFilter && v.charge.lease_id !== leaseFilter) return false;
    if (month && !v.charge.period_start.startsWith(month)) return false;
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
    { id: 'status', label: 'Statut', value: (v) => CHARGE_STATUS_LABELS[v.status], render: (v) => <ChargeBadge v={v} />, mobile: true },
    { id: 'actions', label: 'Actions', value: () => null, sortable: false, searchable: false,
      render: (v) => <ChargeActions v={v} onPay={(x) => setPay({ chargeId: x.charge.id, leaseId: x.charge.lease_id, mode: 'saisie' })} onConfirm={(x) => setPay({ chargeId: x.charge.id, leaseId: x.charge.lease_id, mode: 'confirmation' })} onReceipt={setReceipt} />, mobile: true },
  ];

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
          <Button disabled={!data.leases.length} onClick={() => setImporting(true)}>Importer des loyers (Excel)</Button>
          <Button variant="primary" disabled={!data.leases.length} onClick={() => setPay({ mode: 'saisie' })}>Enregistrer un paiement</Button>
        </>} />
      <RentImportDialog open={importing} onClose={() => setImporting(false)} />
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
            ['quittances', `Quittances et reçus (${data.receipts.filter((r) => !r.cancelled_at && (!leaseFilter || r.lease_id === leaseFilter)).length})`]]} value={tab} onChange={setTab} />
          {tab === 'echeances' ? (
            <DataTable id="echeances" rows={rows} columns={columns} rowKey={(v) => v.charge.id} initialSort={{ id: 'due', dir: 'desc' }}
              onOpen={(v) => navigate(`/baux/${v.charge.lease_id}`)}
              toolbar={<>
                <label className="inline-select">Afficher
                  <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
                    <option value="a_traiter">À traiter</option><option value="impayee">Impayées</option><option value="partielle">Partiellement payées</option>
                    <option value="payee">Payées</option><option value="a_venir">À venir</option><option value="toutes">Toutes</option>
                  </select></label>
                <label className="inline-select">Mois
                  <select value={month} onChange={(e) => setMonth(e.target.value)}>
                    <option value="">Tous</option>{months.map((m) => <option key={m} value={m}>{monthLabel(`${m}-01`)}</option>)}
                  </select></label>
              </>}
              empty={<EmptyState title={filter === 'a_traiter' ? 'Rien à traiter' : 'Aucune échéance'}>{filter === 'a_traiter' ? 'Aucun impayé échu et aucune quittance en attente.' : 'Aucune échéance ne correspond.'}</EmptyState>} />
          ) : tab === 'paiements' ? <PaymentsTable leaseId={leaseFilter} />
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

function PaymentsTable({ leaseId }: { leaseId: string }) {
  const { data } = useStore();
  const { leaseById, leaseLabel } = useRental();
  const pay = usePaymentActions();
  const columns: Column<Payment>[] = [
    { id: 'date', label: 'Date', value: (p) => p.paid_on, kind: 'date', render: (p) => <>{date(p.paid_on)}{p.date_defaulted && <span className="pill pill-warn">date par défaut</span>}</>, primary: true },
    { id: 'lease', label: 'Bail', value: (p) => { const l = leaseById.get(p.lease_id); return l ? leaseLabel(l) : '—'; }, mobile: true },
    { id: 'amount', label: 'Montant', value: (p) => p.amount, kind: 'money', align: 'right', render: (p) => money2(p.amount), mobile: true },
    { id: 'method', label: 'Moyen', value: (p) => PAYMENT_METHOD_LABELS[p.method], mobile: true },
    { id: 'ref', label: 'Référence', value: (p) => p.reference },
    { id: 'free', label: 'Non affecté', value: (p) => round2(p.amount - paymentAllocated(p, data.allocations)), kind: 'money', align: 'right',
      render: (p) => { const f = round2(p.amount - paymentAllocated(p, data.allocations)); return f > 0 ? <span className="pos" title="Avance du locataire">{money2(f)}</span> : '—'; } },
  ];
  return (
    <Section>
      <DataTable id="paiements" rows={data.payments.filter((p) => !leaseId || p.lease_id === leaseId)} columns={columns} rowKey={(p) => p.id} initialSort={{ id: 'date', dir: 'desc' }}
        onOpen={(p) => navigate(`/baux/${p.lease_id}`)}
        rowActions={(p) => [
          { label: 'Modifier', onSelect: () => pay.edit(p) },
          { label: 'Voir le bail', onSelect: () => navigate(`/baux/${p.lease_id}`) },
          { label: 'Supprimer', danger: true, onSelect: () => pay.remove(p) },
        ]}
        empty={<EmptyState title="Aucun paiement" />} />
      {pay.ui}
    </Section>
  );
}
