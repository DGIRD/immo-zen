import { useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../../data/store.tsx';
import type { Payment, Receipt } from '../../data/types.ts';
import { downloadBlob, stamp, toCsv, toXlsx, type ExportColumn } from '../../domain/exporting.ts';
import { date, money2 } from '../../domain/format.ts';
import { CHARGE_STATUS_LABELS, monthLabel, PAYMENT_METHOD_LABELS, type ChargeView } from '../../domain/rental.ts';
import { round2 } from '../../domain/simulator.ts';
import { chargeDuplicates, paymentDuplicates } from '../../domain/duplicates.ts';
import { DataTable, type Column, type RowAction } from '../../ui/DataTable.tsx';
import { GridEditor, type GridColumn } from '../../ui/GridEditor.tsx';
import { Button, EmptyState, Section, useConfirm } from '../../ui/components.tsx';
import { navigate } from '../../ui/router.ts';
import { useChargeEditing } from './ChargeEdit.tsx';
import { applyPaymentEdit, ChargeActions, ChargeBadge, METHODS, PaymentDialog, paymentAllocated, periodLabel, ReceiptDialog, sendLabel, usePaymentActions, useReceiptActions, useRental } from './common.tsx';

export type Filter = 'a_traiter' | 'impayee' | 'partielle' | 'payee' | 'a_venir' | 'annulee' | 'avances' | 'doublons' | 'toutes';

export const DupPill = ({ title }: { title: string }) => <span className="pill pill-warn dup-flag" title={title}>doublon possible</span>;

/**
 * Une ligne du tableau unique : une échéance avec ses paiements et ses documents (quittance, reçus),
 * ou la part d'un paiement restée en avance (affectée à aucune échéance).
 */
export type Row =
  | { key: string; type: 'echeance'; lease_id: string; v: ChargeView; pays: { p: Payment; amount: number }[]; docs: Receipt[]; cancelledDocs: Receipt[] }
  | { key: string; type: 'avance'; lease_id: string; p: Payment; free: number };

const isEch = (r: Row): r is Extract<Row, { type: 'echeance' }> => r.type === 'echeance';
export const rowMonth = (r: Row) => (isEch(r) ? r.v.charge.period_start : r.p.paid_on).slice(0, 7);
const rowPayments = (r: Row) => (isEch(r) ? r.pays.map((x) => x.p) : [r.p]);

/**
 * Tableau unique « Loyers et paiements » : une ligne par échéance avec ses paiements et sa quittance ou ses reçus,
 * plus les avances non affectées. Utilisé par l'écran Loyers et paiements (tous les baux) et par la fiche du bail.
 */
export function RentLedger({ leaseFilter = '', onLeaseFilter, fixedLease = false, figures = true, toolbarExtra, initialFilter = 'a_traiter', inlineEdit = false }: {
  /** Bail affiché ('' : tous les baux). */
  leaseFilter?: string;
  /** Sélecteur de bail affiché si fourni. */
  onLeaseFilter?: (id: string) => void;
  /** Bail imposé (fiche du bail) : colonne « Bail » masquée. */
  fixedLease?: boolean;
  figures?: boolean;
  toolbarExtra?: ReactNode;
  initialFilter?: Filter;
  /** Boutons Modifier / Annuler le paiement / Annuler visibles sur chaque échéance (fiche du bail). */
  inlineEdit?: boolean;
}) {
  const { views, leaseById, leaseLabel, quittanceFor } = useRental();
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [month, setMonth] = useState('');
  const [pay, setPay] = useState<{ chargeId?: string; leaseId?: string; mode: 'saisie' | 'confirmation' } | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [grid, setGrid] = useState<null | 'echeances' | 'paiements'>(null);
  const store = useStore();
  const { ask, dialog } = useConfirm();
  const chargeEdit = useChargeEditing();
  const payActions = usePaymentActions();
  const docActions = useReceiptActions(setReceipt);

  const data = store.data;
  const labelOfLease = (id: string) => { const l = leaseById.get(id); return l ? leaseLabel(l) : '—'; };

  // ----- lignes : échéances + paiements affectés + documents ; avances à part
  const allRows = useMemo<Row[]>(() => {
    const payById = new Map(data.payments.map((p) => [p.id, p]));
    const byCharge = new Map<string, { p: Payment; amount: number }[]>();
    for (const a of data.allocations) {
      const p = payById.get(a.payment_id);
      if (!p) continue;
      const cur = byCharge.get(a.charge_id) ?? [];
      const same = cur.find((x) => x.p.id === p.id);
      if (same) same.amount = round2(same.amount + a.amount); else cur.push({ p, amount: a.amount });
      byCharge.set(a.charge_id, cur);
    }
    const covers = (r: Receipt, id: string) => r.charge_id === id || (r.extra_lines ?? []).some((x) => x.charge_id === id);
    const out: Row[] = views.map((v) => {
      const docs = data.receipts.filter((r) => covers(r, v.charge.id)).sort((a, b) => b.issued_on.localeCompare(a.issued_on) || b.number.localeCompare(a.number));
      return {
        key: v.charge.id, type: 'echeance', lease_id: v.charge.lease_id, v,
        pays: (byCharge.get(v.charge.id) ?? []).sort((a, b) => a.p.paid_on.localeCompare(b.p.paid_on)),
        docs: docs.filter((r) => !r.cancelled_at), cancelledDocs: docs.filter((r) => r.cancelled_at),
      };
    });
    for (const p of data.payments) {
      const free = round2(p.amount - paymentAllocated(p, data.allocations));
      if (free > 0) out.push({ key: `avance:${p.id}`, type: 'avance', lease_id: p.lease_id, p, free });
    }
    return out;
  }, [views, data.payments, data.allocations, data.receipts]);

  const months = useMemo(() => [...new Set(allRows.map(rowMonth))].sort().reverse(), [allRows]);
  const dupCharges = useMemo(() => chargeDuplicates(data.charges), [data.charges]);
  const dupPays = useMemo(() => paymentDuplicates(data.payments), [data.payments]);
  const isDupRow = (r: Row) => (isEch(r) && dupCharges.ids.has(r.v.charge.id)) || rowPayments(r).some((p) => dupPays.ids.has(p.id));
  const rows = allRows.filter((r) => {
    if (leaseFilter && r.lease_id !== leaseFilter) return false;
    if (month && rowMonth(r) !== month) return false;
    if (filter === 'doublons') return isDupRow(r);
    if (filter === 'toutes') return true;
    if (filter === 'avances') return r.type === 'avance';
    if (!isEch(r)) return false;
    const v = r.v;
    if (filter === 'a_traiter') return v.overdue || (v.status === 'payee' && !quittanceFor(v.charge.id) && !v.charge.cancelled_at);
    return v.status === filter;
  });
  const echRows = rows.filter(isEch);
  const totals = echRows.reduce((t, { v }) => ({ due: round2(t.due + (v.charge.cancelled_at ? 0 : v.total)), paid: round2(t.paid + v.paid), rest: round2(t.rest + v.remaining) }), { due: 0, paid: 0, rest: 0 });
  // paiements du périmètre affiché (bail, mois) : grille et doublons
  const scopePayments = data.payments.filter((p) => (!leaseFilter || p.lease_id === leaseFilter) && (!month || p.paid_on.startsWith(month)));
  const scopeDupExtra = dupPays.extra.filter((p) => scopePayments.includes(p));
  const scopeViews = views.filter((v) => !leaseFilter || v.charge.lease_id === leaseFilter);
  const toConfirm = scopeViews.filter((v) => v.overdue).length;
  const toReceipt = scopeViews.filter((v) => v.status === 'payee' && !v.charge.cancelled_at && !quittanceFor(v.charge.id)).length;
  const advanceTotal = round2(allRows.filter((r): r is Extract<Row, { type: 'avance' }> => r.type === 'avance' && (!leaseFilter || r.lease_id === leaseFilter)).reduce((s, r) => s + r.free, 0));

  const payText = (p: Payment, amount: number) => `${date(p.paid_on)} ${money2(amount)}${amount !== p.amount ? ` (sur ${money2(p.amount)})` : ''} ${PAYMENT_METHOD_LABELS[p.method]}${p.reference ? ` ${p.reference}` : ''}`;
  const payLine = (p: Payment, amount: number) => (
    <div key={p.id} className="pay-line">
      <button type="button" className="link" title="Modifier le paiement" onClick={() => payActions.edit(p)}>{date(p.paid_on)} · {money2(amount)}</button>
      {amount !== p.amount && <span className="muted small"> sur {money2(p.amount)}</span>}
      <span className="muted small"> · {PAYMENT_METHOD_LABELS[p.method]}{p.reference ? ` · ${p.reference}` : ''}</span>
      {p.date_defaulted && <span className="pill pill-warn" title="Date du jour utilisée par défaut lors de la confirmation">date par défaut</span>}
      {dupPays.ids.has(p.id) && <DupPill title="Même bail, même montant, à quelques jours d’un autre paiement" />}
      <button type="button" className="icon-btn row-delete" aria-label={`Supprimer le paiement du ${date(p.paid_on)} (${money2(p.amount)})`} title="Supprimer le paiement" onClick={() => payActions.remove(p)}>🗑</button>
    </div>
  );
  const docLabel = (r: Receipt) => `${r.kind === 'quittance' ? 'Quittance' : 'Reçu'} ${r.number}`;

  const allColumns: Column<Row>[] = [
    { id: 'lease', label: 'Bail', value: (r) => labelOfLease(r.lease_id), primary: true },
    { id: 'period', label: 'Période', value: (r) => (isEch(r) ? r.v.charge.period_start : r.p.paid_on),
      render: (r) => (isEch(r) ? <>{periodLabel(r.v.charge)}{r.v.charge.cancelled_at && r.v.charge.cancel_reason ? <small className="muted block">Annulée : {r.v.charge.cancel_reason}</small> : null}</> : <>Avance <span className="muted small">({monthLabel(r.p.paid_on)})</span></>), mobile: true },
    { id: 'due', label: 'Échéance', value: (r) => (isEch(r) ? r.v.charge.due_date : r.p.paid_on), kind: 'date', render: (r) => (isEch(r) ? date(r.v.charge.due_date) : '—'), mobile: true },
    { id: 'total', label: 'Dû', value: (r) => (isEch(r) ? r.v.total : null), kind: 'money', align: 'right', render: (r) => (isEch(r) ? money2(r.v.total) : '—') },
    { id: 'payments', label: 'Paiements', value: (r) => (isEch(r) ? r.pays.map((x) => payText(x.p, x.amount)).join(' ; ') : payText(r.p, r.free)), sortable: false,
      render: (r) => (isEch(r)
        ? (r.pays.length ? <div className="pay-lines">{r.pays.map((x) => payLine(x.p, x.amount))}</div> : <span className="muted">—</span>)
        : <div className="pay-lines">{payLine(r.p, r.free)}</div>), mobile: true },
    { id: 'paid', label: 'Réglé', value: (r) => (isEch(r) ? r.v.paid : r.free), kind: 'money', align: 'right', render: (r) => money2(isEch(r) ? r.v.paid : r.free) },
    { id: 'rest', label: 'Reste', value: (r) => (isEch(r) ? r.v.remaining : null), kind: 'money', align: 'right',
      render: (r) => (isEch(r) ? <span className={r.v.overdue ? 'neg' : ''}>{money2(r.v.remaining)}</span> : '—'), mobile: true },
    { id: 'status', label: 'Statut', value: (r) => (isEch(r) ? CHARGE_STATUS_LABELS[r.v.status] : 'Avance'),
      render: (r) => (isEch(r)
        ? <><ChargeBadge v={r.v} />{dupCharges.ids.has(r.v.charge.id) && <DupPill title="Une autre échéance du même bail couvre la même période (ou le même montant à la même date)" />}</>
        : <span className="status status-early" title="Montant reçu non affecté à une échéance, conservé au crédit du locataire">Avance</span>), mobile: true },
    { id: 'document', label: 'Quittance / reçu', value: (r) => (isEch(r) ? r.docs.map(docLabel).join(' ; ') || null : null),
      render: (r) => (!isEch(r) ? '—' : <div className="doc-lines">
        {r.docs.map((d) => <div key={d.id}><button type="button" className="link" onClick={() => setReceipt(d)}>{docLabel(d)}</button> <span className="muted small">{sendLabel(d)}</span></div>)}
        {r.cancelledDocs.length > 0 && <button type="button" className="link muted small" title={r.cancelledDocs.map((d) => `${docLabel(d)} : ${d.cancel_reason ?? 'annulé'}`).join('\n')} onClick={() => setReceipt(r.cancelledDocs[0]!)}>
          {r.cancelledDocs.length} document{r.cancelledDocs.length > 1 ? 's' : ''} annulé{r.cancelledDocs.length > 1 ? 's' : ''}</button>}
        {!r.docs.length && !r.cancelledDocs.length && <span className="muted">—</span>}
      </div>), mobile: true },
    { id: 'actions', label: 'Actions', value: () => null, sortable: false, searchable: false,
      render: (r) => (!isEch(r) ? null : r.v.charge.cancelled_at
        ? <Button size="sm" onClick={() => chargeEdit.restore(r.v)} title={r.v.charge.cancel_reason ? `Annulée : ${r.v.charge.cancel_reason}` : 'Annulée'}>Réactiver</Button>
        : <div className="row">
          <ChargeActions v={r.v} hideIssued onPay={(x) => setPay({ chargeId: x.charge.id, leaseId: x.charge.lease_id, mode: 'saisie' })} onConfirm={(x) => setPay({ chargeId: x.charge.id, leaseId: x.charge.lease_id, mode: 'confirmation' })} onReceipt={setReceipt} />
          {inlineEdit && <>
            <Button size="sm" variant="ghost" onClick={() => chargeEdit.edit(r.v)}>Modifier</Button>
            {r.v.paid > 0 && <Button size="sm" variant="ghost" onClick={() => chargeEdit.unpay(r.v)}>Annuler le paiement</Button>}
            {r.v.paid === 0 && <Button size="sm" variant="ghost" onClick={() => chargeEdit.cancel(r.v)}>Annuler</Button>}
          </>}
        </div>), mobile: true },
  ];

  const columns = fixedLease ? allColumns.filter((c) => c.id !== 'lease') : allColumns;

  const rowActions = (r: Row): RowAction<Row>[] => {
    const payItems = rowPayments(r).flatMap((p): RowAction<Row>[] => [
      { label: `Modifier le paiement du ${date(p.paid_on)}`, onSelect: () => payActions.edit(p) },
      { label: `Supprimer le paiement du ${date(p.paid_on)}`, danger: true, onSelect: () => payActions.remove(p) },
    ]);
    const lease: RowAction<Row>[] = fixedLease ? [] : [{ label: 'Voir le bail', onSelect: () => navigate(`/baux/${r.lease_id}`) }];
    if (!isEch(r)) return [...payItems, ...lease];
    const docItems = r.docs.flatMap((d): RowAction<Row>[] => [
      { label: `Ouvrir ${docLabel(d)}`, onSelect: () => setReceipt(d) },
      { label: `Modifier ${d.kind === 'quittance' ? 'la quittance' : 'le reçu'} ${d.number}`, onSelect: () => docActions.edit(d) },
      { label: `Rééditer ${d.kind === 'quittance' ? 'la quittance' : 'le reçu'} ${d.number}`, onSelect: () => void docActions.reissue(d) },
      { label: `Supprimer ${d.kind === 'quittance' ? 'la quittance' : 'le reçu'} ${d.number}`, danger: true, onSelect: () => docActions.remove(d) },
    ]);
    const cancelled = r.cancelledDocs.map((d): RowAction<Row> => ({ label: `Voir ${docLabel(d)} (annulé)`, onSelect: () => setReceipt(d) }));
    return [...chargeEdit.actionsFor(r.v), ...payItems, ...docItems, ...cancelled, ...lease];
  };

  const chargeGrid: GridColumn<ChargeView>[] = [
    { id: 'lease', label: 'Bail', type: 'text', get: () => null, fixed: (v) => labelOfLease(v.charge.lease_id) },
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

  const exportCols: ExportColumn<Row>[] = columns.filter((c) => c.id !== 'actions').map((c) => ({ label: c.label, value: c.value, kind: c.kind }));
  const exp = async (f: 'xlsx' | 'csv') => {
    const name = `immo-zen-loyers-${stamp()}`;
    if (f === 'csv') downloadBlob(new Blob([toCsv(exportCols, rows)], { type: 'text/csv;charset=utf-8' }), `${name}.csv`);
    else downloadBlob(await toXlsx([
      { name: 'Loyers et paiements', columns: exportCols, rows },
      { name: 'Paiements', columns: paymentExport((id) => labelOfLease(id)), rows: scopePayments },
      { name: 'Quittances et reçus', columns: receiptExport((id) => labelOfLease(id)), rows: data.receipts.filter((r) => !leaseFilter || r.lease_id === leaseFilter) },
    ]), `${name}.xlsx`);
  };

  return (
    <>
      {dialog}
      {chargeEdit.ui}
      {payActions.ui}
      {docActions.ui}
      {figures && (
        <div className="figures">
            <button type="button" className="figure link-figure" onClick={() => setFilter('impayee')}>
              <span className="figure-label">Paiements à confirmer</span><span className={`figure-value ${toConfirm ? 'neg' : ''}`}>{toConfirm}</span><span className="figure-hint">échéances passées non réglées</span>
            </button>
            <button type="button" className="figure link-figure" onClick={() => setFilter('payee')}>
              <span className="figure-label">Quittances à émettre</span><span className="figure-value">{toReceipt}</span><span className="figure-hint">périodes intégralement réglées</span>
            </button>
            <div className="figure"><span className="figure-label">Dû (sélection)</span><span className="figure-value">{money2(totals.due)}</span><span className="figure-hint">réglé {money2(totals.paid)}</span></div>
            <div className="figure"><span className="figure-label">Reste dû (sélection)</span><span className={`figure-value ${totals.rest ? 'neg' : ''}`}>{money2(totals.rest)}</span>
              {advanceTotal > 0 && <button type="button" className="figure-hint link" onClick={() => setFilter('avances')}>avances non affectées : {money2(advanceTotal)}</button>}</div>
          </div>
      )}
          {scopeDupExtra.length > 0 && !grid && (
            <p className="note note-warn">{scopeDupExtra.length} paiement{scopeDupExtra.length > 1 ? 's semblent' : ' semble'} en double (même bail, même montant, à quelques jours d’écart).{' '}
              <button type="button" className="link" onClick={() => setFilter('doublons')}>Afficher les doublons</button>{' · '}
              <button type="button" className="link" onClick={() => payActions.removeMany(scopeDupExtra)}>Supprimer les doublons (garder le premier enregistré)</button></p>
          )}
          <p className="muted small">L’absence de réponse à l’e-mail de confirmation ne vaut jamais paiement : une échéance reste impayée tant que vous n’avez pas confirmé ou saisi le paiement.</p>
      {onLeaseFilter && (
          <div className="row lease-filter">
            <label className="inline-select">Bail
              <select value={leaseFilter} onChange={(e) => onLeaseFilter!(e.target.value)} aria-label="Filtrer par bail">
                <option value="">Tous les baux</option>
                {[...data.leases].sort((a, b) => leaseLabel(a).localeCompare(leaseLabel(b))).map((l) => <option key={l.id} value={l.id}>{leaseLabel(l)}</option>)}
              </select></label>
          </div>
      )}
          {grid === 'echeances' ? (
            <GridEditor rows={echRows.map((r) => r.v).filter((v) => !v.charge.cancelled_at)} columns={chargeGrid} rowKey={(v) => v.charge.id} rowLabel={(v) => periodLabel(v.charge)}
              lock={(v) => { const q = quittanceFor(v.charge.id); return q ? `Quittance ${q.number} : supprimez-la pour modifier` : null; }}
              flag={(v) => (dupCharges.ids.has(v.charge.id) ? <DupPill title="Doublon possible" /> : null)}
              note="Échéances affichées selon les filtres. Une échéance quittancée n’est pas modifiable ; le montant dû ne peut pas descendre sous ce qui est déjà réglé."
              onSave={saveCharges} onClose={() => setGrid(null)} />
          ) : grid === 'paiements' ? (
            <PaymentsGrid payments={scopePayments} dupIds={dupPays.ids} onClose={() => setGrid(null)} />
          ) : (
            <DataTable id={fixedLease ? 'loyers-bail' : 'loyers'} rows={rows} columns={columns} rowKey={(r) => r.key} initialSort={{ id: 'due', dir: 'desc' }}
              onOpen={fixedLease ? undefined : (r) => navigate(`/baux/${r.lease_id}`)}
              rowActions={rowActions}
              bulkActions={(sel, clear) => {
                const charges = sel.filter(isEch).map((r) => r.v);
                const pays = [...new Map(sel.flatMap(rowPayments).map((p) => [p.id, p])).values()];
                return <>
                  {charges.length > 0 && <Button size="sm" variant="danger" onClick={async () => { if (await cancelDuplicates(charges)) clear(); }}>Annuler comme doublons ({charges.length})</Button>}
                  {pays.length > 0 && <Button size="sm" variant="danger" onClick={() => payActions.removeMany(pays, clear)}>Supprimer les paiements ({pays.length})</Button>}
                </>;
              }}
              toolbar={<>
                <label className="inline-select">Afficher
                  <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
                    <option value="a_traiter">À traiter</option><option value="impayee">Impayées</option><option value="partielle">Partiellement payées</option>
                    <option value="payee">Payées</option><option value="a_venir">À venir</option><option value="annulee">Annulées</option>
                    <option value="avances">Avances non affectées</option>
                    <option value="doublons">Doublons possibles ({allRows.filter(isDupRow).length})</option><option value="toutes">Toutes</option>
                  </select></label>
                <label className="inline-select">Mois
                  <select value={month} onChange={(e) => setMonth(e.target.value)}>
                    <option value="">Tous</option>{months.map((m) => <option key={m} value={m}>{monthLabel(`${m}-01`)}</option>)}
                  </select></label>
                <Button size="sm" onClick={() => setGrid('echeances')} disabled={!echRows.length}>Modifier les échéances en grille</Button>
                <Button size="sm" onClick={() => setGrid('paiements')} disabled={!scopePayments.length}>Modifier les paiements en grille</Button>
                {toolbarExtra}
              </>}
              empty={<EmptyState title={filter === 'a_traiter' ? 'Rien à traiter' : filter === 'doublons' ? 'Aucun doublon' : filter === 'avances' ? 'Aucune avance' : 'Aucune ligne'}>
                {filter === 'a_traiter' ? 'Aucun impayé échu et aucune quittance en attente.' : filter === 'doublons' ? 'Aucune échéance ni aucun paiement ne fait doublon.' : filter === 'avances' ? 'Tous les paiements sont affectés à une échéance.' : 'Aucune échéance ne correspond.'}</EmptyState>} />
          )}
          <div className="export-row">
            <span className="muted">Exporter :</span>
            <Button size="sm" onClick={() => void exp('xlsx')}>Excel (.xlsx)</Button>
            <Button size="sm" onClick={() => void exp('csv')}>CSV</Button>
          </div>
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

function receiptExport(labelOf: (leaseId: string) => string | null): ExportColumn<Receipt>[] {
  return [
    { label: 'N°', value: (r) => r.number },
    { label: 'Type', value: (r) => (r.kind === 'quittance' ? 'Quittance' : 'Reçu partiel') },
    { label: 'Bail', value: (r) => labelOf(r.lease_id) },
    { label: 'Période', value: (r) => monthLabel(r.period_start) },
    { label: 'Émis le', value: (r) => r.issued_on, kind: 'date' },
    { label: 'Montant', value: (r) => r.paid_amount, kind: 'money' },
    { label: 'État', value: (r) => (r.cancelled_at ? r.cancel_reason ?? 'Annulé' : sendLabel(r)) },
  ];
}

/** Modification en grille des paiements du périmètre affiché (bail, mois). */
function PaymentsGrid({ payments, dupIds, onClose }: { payments: Payment[]; dupIds: Set<string>; onClose: () => void }) {
  const store = useStore();
  const { data } = store;
  const { leaseById, leaseLabel, today } = useRental();
  const labelOf = (p: Payment) => { const l = leaseById.get(p.lease_id); return l ? leaseLabel(l) : '—'; };
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
  return (
    <Section>
      <GridEditor rows={[...payments].sort((a, b) => b.paid_on.localeCompare(a.paid_on))} columns={gridCols} rowKey={(p) => p.id} rowLabel={(p) => `paiement du ${date(p.paid_on)}`}
        flag={(p) => (dupIds.has(p.id) ? <DupPill title="Doublon possible" /> : null)}
        note="Paiements du bail et du mois sélectionnés. Un montant modifié refait la répartition sur les échéances ; les quittances concernées sont annulées puis rééditées si la période reste réglée."
        onSave={saveGrid} onClose={onClose} />
    </Section>
  );
}
