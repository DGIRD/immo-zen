import { useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../../data/store.tsx';
import type { Payment, Receipt } from '../../data/types.ts';
import { downloadBlob, stamp, toCsv, toXlsx, type ExportColumn } from '../../domain/exporting.ts';
import { date, money2 } from '../../domain/format.ts';
import { ledgerRows, ledgerSettings, mmYYYY, monthQuittance, ROW_STATUS_LABELS, type LedgerRow, type RowStatus } from '../../domain/ledger.ts';
import { monthLabel, PAYMENT_METHOD_LABELS, type ChargeView } from '../../domain/rental.ts';
import { round2 } from '../../domain/simulator.ts';
import { chargeDuplicates, paymentDuplicates } from '../../domain/duplicates.ts';
import { DataTable, type Column, type RowAction } from '../../ui/DataTable.tsx';
import { GridEditor, type GridColumn } from '../../ui/GridEditor.tsx';
import { Button, EmptyState, Section } from '../../ui/components.tsx';
import { navigate } from '../../ui/router.ts';
import { useChargeEditing } from './ChargeEdit.tsx';
import { applyPaymentEdit, METHODS, PaymentDialog, ReceiptDialog, sendLabel, usePaymentActions, useReceiptActions, useRental } from './common.tsx';
import { syncLedgerWith } from './ledgerSync.ts';
import { issueMonthDocs, useExcessDialog } from './monthActions.tsx';

export type Filter = 'a_traiter' | 'impayee' | 'partielle' | 'reportee' | 'reglee' | 'a_venir' | 'ecarts' | 'annulee' | 'hors_periode' | 'doublons' | 'toutes';

export const DupPill = ({ title }: { title: string }) => <span className="pill pill-warn dup-flag" title={title}>doublon possible</span>;

const TONE: Record<RowStatus, string> = { reglee: 'won', partielle: 'hot', reportee: 'closed', impayee: 'bad', a_venir: 'early', annulee: 'closed', hors_periode: 'closed' };
const RECEIVED_LABELS = { oui: 'Oui', partiel: 'Partiel', non: 'Non' } as const;

export function RowBadge({ r }: { r: LedgerRow }) {
  const title = r.status === 'reportee' ? `${money2(r.carriedOut)} reportés sur ${mmYYYY(addMonth(r.month))}` : r.status === 'hors_periode' ? 'Paiement daté d’un mois sans loyer (avant le point de départ ou hors du bail)' : undefined;
  const label = r.status === 'reportee' && r.allocated === 0 ? 'Impayé reporté' : ROW_STATUS_LABELS[r.status];
  return <span className={`status status-${TONE[r.status]}`} title={title}>{label}</span>;
}
const addMonth = (m: string) => { const y = Number(m.slice(0, 4)); const n = Number(m.slice(5, 7)); return n === 12 ? `${y + 1}-01` : `${y}-${String(n + 1).padStart(2, '0')}`; };

/** Libellés des autres sommes dues du mois (rappel, régularisation, reste dû reporté). */
const otherLabels = (r: LedgerRow) => [...(r.report ? [`${r.report.label ?? 'Reste dû reporté'} ${money2(r.carryIn)}`] : []), ...r.others.map((c) => `${c.label ?? (c.kind === 'regularisation' ? 'Régularisation de charges' : 'Autre somme due')} ${money2(c.rent_amount + c.charges_amount)}`)];

/**
 * Tableau unique « Loyers et paiements » : une ligne par bail et par mois, avec le dû (loyer, charges, autres sommes,
 * reste dû reporté), le réglé (paiements du mois), le reçu, l'écart, le statut et la quittance.
 * Utilisé par l'écran Loyers et paiements (tous les baux) et par la fiche du bail.
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
  /** Boutons Modifier / Annuler visibles sur chaque ligne (fiche du bail). */
  inlineEdit?: boolean;
}) {
  const { viewById, leaseById, leaseLabel, today } = useRental();
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [month, setMonth] = useState('');
  const [pay, setPay] = useState<{ leaseId?: string; month?: string; mode: 'saisie' | 'confirmation' } | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [grid, setGrid] = useState<null | 'lignes' | 'paiements'>(null);
  const store = useStore();
  const chargeEdit = useChargeEditing();
  const payActions = usePaymentActions();
  const docActions = useReceiptActions(setReceipt);
  const excess = useExcessDialog();

  const data = store.data;
  const settings = ledgerSettings(data.settings?.rental_settings);
  const labelOfLease = (id: string) => { const l = leaseById.get(id); return l ? leaseLabel(l) : '—'; };

  const allRows = useMemo(() => ledgerRows(data, settings, today), [data, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const months = useMemo(() => [...new Set(allRows.map((r) => r.month))].sort().reverse(), [allRows]);
  const dupCharges = useMemo(() => chargeDuplicates(data.charges.filter((c) => c.kind !== 'report')), [data.charges]);
  const dupPays = useMemo(() => paymentDuplicates(data.payments), [data.payments]);
  const isDupRow = (r: LedgerRow) => (!!r.loyer && dupCharges.ids.has(r.loyer.id)) || r.payments.some((p) => dupPays.ids.has(p.id));
  const canQuittance = (r: LedgerRow) => !!monthQuittance(r, data.allocations, data.receipts);
  const overdue = (r: LedgerRow) => (r.status === 'impayee' || r.status === 'partielle' || r.status === 'reportee') && (r.month < today.slice(0, 7) || (r.loyer?.due_date ?? '') <= today);
  const rows = allRows.filter((r) => {
    if (leaseFilter && r.lease_id !== leaseFilter) return false;
    if (month && r.month !== month) return false;
    switch (filter) {
      case 'toutes': return true;
      case 'doublons': return isDupRow(r);
      case 'a_traiter': return (overdue(r) && r.status !== 'reportee') || r.toConfirm || r.excessToQualify || canQuittance(r) || r.status === 'hors_periode';
      case 'ecarts': return r.excessToQualify || (r.gap !== 0 && r.status !== 'reportee' && r.status !== 'a_venir' && r.status !== 'annulee');
      default: return r.status === filter;
    }
  });
  const scope = allRows.filter((r) => !leaseFilter || r.lease_id === leaseFilter);
  const totals = rows.reduce((t, r) => ({
    due: round2(t.due + r.due), paid: round2(t.paid + r.paid),
    rest: round2(t.rest + (r.status === 'reportee' || r.status === 'a_venir' ? 0 : Math.max(0, r.due - r.allocated))),
    over: round2(t.over + (r.excessToQualify || r.loyer?.excess_mode === 'trop_percu' ? Math.max(0, r.gap) : 0)),
  }), { due: 0, paid: 0, rest: 0, over: 0 });
  const scopePayments = data.payments.filter((p) => (!leaseFilter || p.lease_id === leaseFilter) && (!month || rows.some((r) => r.payments.includes(p))));
  const scopeDupExtra = dupPays.extra.filter((p) => scopePayments.includes(p));
  const toConfirm = scope.filter((r) => (overdue(r) && r.status !== 'reportee') || r.toConfirm).length;
  const toReceipt = scope.filter(canQuittance).length;
  const toQualify = scope.filter((r) => r.excessToQualify).length;

  const loyerView = (r: LedgerRow): ChargeView | null => (r.loyer ? viewById.get(r.loyer.id) ?? null : null);
  const issueQuittances = async (list: LedgerRow[]) => {
    const months = list.filter(canQuittance).map((r) => ({ lease_id: r.lease_id, month: r.month, kind: 'quittance' as const }));
    if (!months.length) { store.notify('Aucun mois sélectionné n’est intégralement réglé sans quittance.', 'error'); return false; }
    const n = await store.call((repo) => issueMonthDocs(repo, months));
    if (n) store.notify(n.q > 1 ? `${n.q} quittances émises.` : 'Quittance émise.');
    if (n && list.length === 1 && n.issued[0]) setReceipt(n.issued[0]);
    return !!n;
  };
  const issueRecu = async (r: LedgerRow) => {
    const n = await store.call((repo) => issueMonthDocs(repo, [{ lease_id: r.lease_id, month: r.month, kind: 'recu' }]));
    if (n?.r) { store.notify('Reçu partiel émis.'); if (n.issued[0]) setReceipt(n.issued[0]); }
  };
  const confirmReceived = async (list: LedgerRow[]) => {
    const targets = list.filter((r) => r.toConfirm && r.loyer);
    if (!targets.length) return false;
    const ok = await store.call(async (repo) => {
      const snap = await repo.loadAll();
      for (const r of targets) {
        const c = snap.charges.find((x) => x.id === r.loyer!.id);
        if (c) await repo.update('rent_charges', c.id, c.version, { received_at: new Date().toISOString() });
      }
      return true;
    }, targets.length > 1 ? `${targets.length} réceptions confirmées.` : 'Réception confirmée.');
    return !!ok;
  };

  const payText = (p: Payment) => `${date(p.paid_on)} ${money2(p.amount)} ${PAYMENT_METHOD_LABELS[p.method]}${p.reference ? ` ${p.reference}` : ''}`;
  const payLine = (p: Payment) => (
    <div key={p.id} className="pay-line">
      <button type="button" className="link" title="Modifier le paiement" onClick={() => payActions.edit(p)}>{date(p.paid_on)} · {money2(p.amount)}</button>
      <span className="muted small"> · {PAYMENT_METHOD_LABELS[p.method]}{p.reference ? ` · ${p.reference}` : ''}</span>
      {p.period_month && p.period_month.slice(0, 7) !== p.paid_on.slice(0, 7) && <span className="pill pill-neutral" title="Paiement rattaché à ce mois, reçu un autre mois">déplacé</span>}
      {p.date_defaulted && <span className="pill pill-warn" title="Date du jour utilisée par défaut lors de la confirmation">date par défaut</span>}
      {dupPays.ids.has(p.id) && <DupPill title="Même bail, même montant, à quelques jours d’un autre paiement" />}
      <button type="button" className="icon-btn row-delete" aria-label={`Supprimer le paiement du ${date(p.paid_on)} (${money2(p.amount)})`} title="Supprimer le paiement" onClick={() => payActions.remove(p)}>🗑</button>
    </div>
  );
  const docLabel = (r: Receipt) => `${r.kind === 'quittance' ? 'Quittance' : 'Reçu'} ${r.number}`;
  const gapNote = (r: LedgerRow) => (r.status === 'reportee' ? `reporté sur ${mmYYYY(addMonth(r.month))}`
    : r.advanceOut > 0 ? `${money2(r.advanceOut)} en avance sur ${mmYYYY(addMonth(r.month))}`
    : r.advanceIn > 0 ? `dont avance ${money2(r.advanceIn)}`
    : r.excessToQualify ? 'à qualifier'
    : r.gap > 0 && r.loyer?.excess_mode === 'trop_percu' ? 'trop-perçu' : '');

  const allColumns: Column<LedgerRow>[] = [
    { id: 'lease', label: 'Bail', value: (r) => labelOfLease(r.lease_id), primary: true },
    { id: 'period', label: 'Période', value: (r) => r.month, mobile: true,
      render: (r) => <>{monthLabel(`${r.month}-01`)}{r.loyer && !r.loyer.period_start.endsWith('-01') && <small className="muted block">à partir du {date(r.loyer.period_start)}</small>}
        {r.loyer?.cancelled_at && r.loyer.cancel_reason ? <small className="muted block">Annulé : {r.loyer.cancel_reason}</small> : null}</> },
    { id: 'rent', label: 'Loyer dû (HC)', value: (r) => r.rent, kind: 'money', align: 'right', render: (r) => (r.loyer ? money2(r.rent) : '—') },
    { id: 'charges', label: 'Charges dues', value: (r) => r.charges, kind: 'money', align: 'right', render: (r) => (r.loyer ? money2(r.charges) : '—') },
    { id: 'other', label: 'Autre somme due', value: (r) => round2(r.other + r.carryIn), kind: 'money', align: 'right',
      render: (r) => (r.other + r.carryIn > 0 ? <span title={otherLabels(r).join('\n')}>{money2(round2(r.other + r.carryIn))}{otherLabels(r).map((l) => <small key={l} className="muted block">{l}</small>)}</span> : <span className="muted">—</span>) },
    { id: 'due', label: 'Total dû', value: (r) => r.due, kind: 'money', align: 'right', render: (r) => <strong>{money2(r.due)}</strong>, mobile: true },
    { id: 'paid', label: 'Réglé', value: (r) => r.paid, kind: 'money', align: 'right', mobile: true,
      render: (r) => <>{money2(r.paid)}{r.payments.length > 0 && <div className="pay-lines">{r.payments.map(payLine)}</div>}</> },
    { id: 'payments', label: 'Paiements (détail)', value: (r) => r.payments.map(payText).join(' ; ') || null, defaultHidden: true, sortable: false },
    { id: 'paid_on', label: 'Date de règlement', value: (r) => r.lastPaidOn, kind: 'date', render: (r) => (r.lastPaidOn ? date(r.lastPaidOn) : '—') },
    { id: 'received', label: 'Reçu', value: (r) => RECEIVED_LABELS[r.received], mobile: true,
      render: (r) => <>{RECEIVED_LABELS[r.received]}{r.toConfirm && <Button size="sm" variant="ghost" onClick={() => void confirmReceived([r])}>Confirmer</Button>}</> },
    { id: 'gap', label: 'Écart', value: (r) => r.gap, kind: 'money', align: 'right', mobile: true,
      render: (r) => <><span className={r.gap < 0 && r.status !== 'reportee' && r.status !== 'a_venir' ? 'neg' : r.gap > 0 ? 'pos' : ''}>{r.gap > 0 ? '+' : ''}{money2(r.gap)}</span>{gapNote(r) && <small className="muted block">{gapNote(r)}</small>}</> },
    { id: 'status', label: 'Statut', value: (r) => ROW_STATUS_LABELS[r.status], mobile: true,
      render: (r) => <><RowBadge r={r} />{isDupRow(r) && <DupPill title="Paiement ou ligne en double possible" />}</> },
    { id: 'document', label: 'Quittance', value: (r) => [r.quittance, ...r.recus].filter(Boolean).map((d) => docLabel(d!)).join(' ; ') || null, mobile: true,
      render: (r) => <div className="doc-lines">
        {[...(r.quittance ? [r.quittance] : []), ...r.recus].map((d) => <div key={d.id}><button type="button" className="link" onClick={() => setReceipt(d)}>{docLabel(d)}</button> <span className="muted small">{sendLabel(d)}</span></div>)}
        {r.cancelledDocs.length > 0 && <button type="button" className="link muted small" title={r.cancelledDocs.map((d) => `${docLabel(d)} : ${d.cancel_reason ?? 'annulé'}`).join('\n')} onClick={() => setReceipt(r.cancelledDocs[0]!)}>
          {r.cancelledDocs.length} document{r.cancelledDocs.length > 1 ? 's' : ''} annulé{r.cancelledDocs.length > 1 ? 's' : ''}</button>}
        {!r.quittance && !r.recus.length && !r.cancelledDocs.length && (canQuittance(r) ? <span className="muted">à émettre</span> : <span className="muted">—</span>)}
      </div> },
    { id: 'actions', label: 'Actions', value: () => null, sortable: false, searchable: false, mobile: true,
      render: (r) => {
        const v = loyerView(r);
        if (r.loyer?.cancelled_at && !r.others.length && !r.report) return v ? <Button size="sm" onClick={() => chargeEdit.restore(v)}>Réactiver</Button> : null;
        return <div className="row">
          {(r.status === 'impayee' || r.status === 'partielle' || r.status === 'reportee' || r.status === 'a_venir') && r.loyer && <Button size="sm" onClick={() => setPay({ leaseId: r.lease_id, month: r.month, mode: overdue(r) ? 'confirmation' : 'saisie' })}>{overdue(r) ? 'Paiement reçu' : 'Enregistrer un paiement'}</Button>}
          {canQuittance(r) && <Button size="sm" variant="primary" onClick={() => void issueQuittances([r])}>Émettre la quittance</Button>}
          {r.excessToQualify && <Button size="sm" onClick={() => excess.open(r)}>Qualifier l’écart</Button>}
          {inlineEdit && v && <>
            <Button size="sm" variant="ghost" onClick={() => chargeEdit.edit(v)}>Modifier</Button>
            {r.paid > 0 && <Button size="sm" variant="ghost" onClick={() => chargeEdit.unpay(v)}>Annuler le paiement</Button>}
            {r.paid === 0 && r.allocated === 0 && <Button size="sm" variant="ghost" onClick={() => chargeEdit.cancel(v)}>Annuler</Button>}
          </>}
        </div>;
      } },
  ];
  const columns = fixedLease ? allColumns.filter((c) => c.id !== 'lease') : allColumns;

  const rowActions = (r: LedgerRow): RowAction<LedgerRow>[] => {
    const v = loyerView(r);
    const out: RowAction<LedgerRow>[] = [];
    if (r.loyer && !r.loyer.cancelled_at) out.push({ label: 'Enregistrer un paiement pour ce mois', onSelect: () => setPay({ leaseId: r.lease_id, month: r.month, mode: 'saisie' }) });
    if (canQuittance(r)) out.push({ label: 'Émettre la quittance', onSelect: () => void issueQuittances([r]) });
    if (r.loyer && !r.quittance && r.allocated > 0 && r.status !== 'reglee') out.push({ label: 'Émettre un reçu partiel', onSelect: () => void issueRecu(r) });
    if (r.excessToQualify || (r.gap > 0 && r.loyer?.excess_mode)) out.push({ label: 'Qualifier l’écart', onSelect: () => excess.open(r) });
    if (r.toConfirm) out.push({ label: 'Confirmer la réception', onSelect: () => void confirmReceived([r]) });
    if (v) out.push(...chargeEdit.actionsFor(v));
    for (const p of r.payments) out.push(
      { label: `Modifier le paiement du ${date(p.paid_on)}`, onSelect: () => payActions.edit(p) },
      { label: `Supprimer le paiement du ${date(p.paid_on)}`, danger: true, onSelect: () => payActions.remove(p) },
    );
    for (const d of [...(r.quittance ? [r.quittance] : []), ...r.recus]) out.push(
      { label: `Ouvrir ${docLabel(d)}`, onSelect: () => setReceipt(d) },
      { label: `Modifier ${d.kind === 'quittance' ? 'la quittance' : 'le reçu'} ${d.number}`, onSelect: () => docActions.edit(d) },
      { label: `Rééditer ${d.kind === 'quittance' ? 'la quittance' : 'le reçu'} ${d.number}`, onSelect: () => void docActions.reissue(d) },
      { label: `Supprimer ${d.kind === 'quittance' ? 'la quittance' : 'le reçu'} ${d.number}`, danger: true, onSelect: () => docActions.remove(d) },
    );
    for (const d of r.cancelledDocs) out.push({ label: `Voir ${docLabel(d)} (annulé)`, onSelect: () => setReceipt(d) });
    if (!fixedLease) out.push({ label: 'Voir le bail', onSelect: () => navigate(`/baux/${r.lease_id}`) });
    return out;
  };

  // grille : loyer et charges dus des lignes affichées
  const gridRows = rows.map(loyerView).filter((v): v is ChargeView => !!v && !v.charge.cancelled_at);
  const chargeGrid: GridColumn<ChargeView>[] = [
    { id: 'lease', label: 'Bail', type: 'text', get: () => null, fixed: (v) => labelOfLease(v.charge.lease_id) },
    { id: 'period', label: 'Période', type: 'text', get: () => null, fixed: (v) => monthLabel(v.charge.period_start) },
    { id: 'due_date', label: 'Échéance', type: 'date', get: (v) => v.charge.due_date, validate: (x) => (x ? null : 'Date obligatoire') },
    { id: 'rent_amount', label: 'Loyer dû (HC)', type: 'money', get: (v) => v.charge.rent_amount,
      validate: (x, v, all) => (x === null || (x as number) < 0 ? 'Montant positif ou nul' : round2((x as number) + Number(all.charges_amount ?? 0)) < v.paid ? `Inférieur au déjà réglé (${money2(v.paid)})` : null) },
    { id: 'charges_amount', label: 'Charges dues', type: 'money', get: (v) => v.charge.charges_amount,
      validate: (x) => (x === null || (x as number) < 0 ? 'Montant positif ou nul' : null) },
  ];
  async function saveCharges(changes: { row: ChargeView; values: Record<string, string | number | null> }[]) {
    let n = 0;
    for (const { row, values } of changes) {
      const patch: Record<string, unknown> = {};
      if ('due_date' in values) patch.due_date = values.due_date;
      if ('rent_amount' in values) patch.rent_amount = round2(Number(values.rent_amount));
      if ('charges_amount' in values) patch.charges_amount = round2(Number(values.charges_amount));
      if (await store.update('rent_charges', row.charge, patch, `La ligne de ${monthLabel(row.charge.period_start)}`)) n++;
    }
    if (n) { await store.call((r) => syncLedgerWith(r, { leaseIds: [...new Set(changes.map((c) => c.row.charge.lease_id))] })); store.notify(`${n} ligne${n > 1 ? 's' : ''} modifiée${n > 1 ? 's' : ''}.`); }
    return n;
  }

  const exportCols: ExportColumn<LedgerRow>[] = [
    ...(fixedLease ? [] : [{ label: 'Bail', value: (r: LedgerRow) => labelOfLease(r.lease_id) }]),
    { label: 'Période', value: (r) => monthLabel(`${r.month}-01`) },
    { label: 'Loyer dû (HC)', value: (r) => r.rent, kind: 'money' },
    { label: 'Charges dues', value: (r) => r.charges, kind: 'money' },
    { label: 'Autre somme due', value: (r) => round2(r.other + r.carryIn), kind: 'money' },
    { label: 'Détail autre somme due', value: (r) => otherLabels(r).join(' ; ') || null },
    { label: 'Total dû', value: (r) => r.due, kind: 'money' },
    { label: 'Réglé', value: (r) => r.paid, kind: 'money' },
    { label: 'Paiements', value: (r) => r.payments.map(payText).join(' ; ') || null },
    { label: 'Date de règlement', value: (r) => r.lastPaidOn, kind: 'date' },
    { label: 'Reçu', value: (r) => RECEIVED_LABELS[r.received] },
    { label: 'Écart', value: (r) => r.gap, kind: 'money' },
    { label: 'Statut', value: (r) => ROW_STATUS_LABELS[r.status] },
    { label: 'Quittance', value: (r) => [r.quittance, ...r.recus].filter(Boolean).map((d) => docLabel(d!)).join(' ; ') || null },
  ];
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
      {chargeEdit.ui}
      {payActions.ui}
      {docActions.ui}
      {excess.ui}
      {figures && (
        <div className="figures">
          <button type="button" className="figure link-figure" onClick={() => setFilter('a_traiter')}>
            <span className="figure-label">Paiements à confirmer</span><span className={`figure-value ${toConfirm ? 'neg' : ''}`}>{toConfirm}</span><span className="figure-hint">mois échus non réglés{settings.receivedMode === 'confirmation' ? ', réceptions à confirmer' : ''}</span>
          </button>
          <button type="button" className="figure link-figure" onClick={() => setFilter('reglee')}>
            <span className="figure-label">Quittances à émettre</span><span className="figure-value">{toReceipt}</span><span className="figure-hint">mois intégralement réglés</span>
          </button>
          <div className="figure"><span className="figure-label">Total dû (sélection)</span><span className="figure-value">{money2(totals.due)}</span><span className="figure-hint">réglé {money2(totals.paid)}</span></div>
          <div className="figure"><span className="figure-label">Reste dû (sélection)</span><span className={`figure-value ${totals.rest ? 'neg' : ''}`}>{money2(totals.rest)}</span>
            {toQualify > 0 ? <button type="button" className="figure-hint link" onClick={() => setFilter('ecarts')}>{toQualify} excédent{toQualify > 1 ? 's' : ''} à qualifier</button>
              : totals.over > 0 ? <span className="figure-hint">trop-perçu {money2(totals.over)}</span> : null}</div>
        </div>
      )}
      {scopeDupExtra.length > 0 && !grid && (
        <p className="note note-warn">{scopeDupExtra.length} paiement{scopeDupExtra.length > 1 ? 's semblent' : ' semble'} en double (même bail, même montant, à quelques jours d’écart).{' '}
          <button type="button" className="link" onClick={() => setFilter('doublons')}>Afficher les doublons</button>{' · '}
          <button type="button" className="link" onClick={() => payActions.removeMany(scopeDupExtra)}>Supprimer les doublons (garder le premier enregistré)</button></p>
      )}
      {fixedLease && <p className="muted small">Une ligne par mois : le réglé additionne les paiements du mois. Un mois échu partiellement réglé reporte son reste dû dans « Autre somme due » du mois suivant. L’absence de réponse à l’e-mail de confirmation ne vaut jamais paiement.</p>}
      {onLeaseFilter && (
        <div className="row lease-filter">
          <label className="inline-select">Bail
            <select value={leaseFilter} onChange={(e) => onLeaseFilter!(e.target.value)} aria-label="Filtrer par bail">
              <option value="">Tous les baux</option>
              {[...data.leases].sort((a, b) => leaseLabel(a).localeCompare(leaseLabel(b))).map((l) => <option key={l.id} value={l.id}>{leaseLabel(l)}</option>)}
            </select></label>
        </div>
      )}
      {grid === 'lignes' ? (
        <GridEditor rows={gridRows} columns={chargeGrid} rowKey={(v) => v.charge.id} rowLabel={(v) => monthLabel(v.charge.period_start)}
          lock={(v) => { const q = allRows.find((r) => r.loyer?.id === v.charge.id)?.quittance; return q ? `Quittance ${q.number} : supprimez-la pour modifier` : null; }}
          flag={(v) => (dupCharges.ids.has(v.charge.id) ? <DupPill title="Doublon possible" /> : null)}
          note="Lignes affichées selon les filtres. Une ligne quittancée n’est pas modifiable ; le montant dû ne peut pas descendre sous ce qui est déjà réglé."
          onSave={saveCharges} onClose={() => setGrid(null)} />
      ) : grid === 'paiements' ? (
        <PaymentsGrid payments={scopePayments} dupIds={dupPays.ids} onClose={() => setGrid(null)} />
      ) : (
        <DataTable id={fixedLease ? 'loyers-bail-v2' : 'loyers-v2'} rows={rows} columns={columns} rowKey={(r) => r.key} initialSort={{ id: 'period', dir: 'desc' }}
          onOpen={fixedLease ? undefined : (r) => navigate(`/baux/${r.lease_id}`)}
          rowActions={rowActions}
          bulkActions={(sel, clear) => {
            const pays = [...new Map(sel.flatMap((r) => r.payments).map((p) => [p.id, p])).values()];
            const q = sel.filter(canQuittance);
            const c = sel.filter((r) => r.toConfirm);
            return <>
              {q.length > 0 && <Button size="sm" variant="primary" onClick={async () => { if (await issueQuittances(q)) clear(); }}>Émettre les quittances ({q.length})</Button>}
              {c.length > 0 && <Button size="sm" onClick={async () => { if (await confirmReceived(c)) clear(); }}>Marquer comme reçu ({c.length})</Button>}
              {pays.length > 0 && <Button size="sm" variant="danger" onClick={() => payActions.removeMany(pays, clear)}>Supprimer les paiements ({pays.length})</Button>}
            </>;
          }}
          toolbar={<>
            <label className="inline-select">Afficher
              <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
                <option value="a_traiter">À traiter</option><option value="impayee">Impayés</option><option value="partielle">Partiels</option>
                <option value="reportee">Partiels reportés</option><option value="reglee">Réglés</option><option value="a_venir">À venir</option>
                <option value="ecarts">Écarts ({allRows.filter((r) => r.excessToQualify).length} à qualifier)</option>
                <option value="annulee">Annulés</option><option value="hors_periode">Hors période</option>
                <option value="doublons">Doublons possibles ({allRows.filter(isDupRow).length})</option><option value="toutes">Tous</option>
              </select></label>
            <label className="inline-select">Mois
              <select value={month} onChange={(e) => setMonth(e.target.value)}>
                <option value="">Tous</option>{months.map((m) => <option key={m} value={m}>{monthLabel(`${m}-01`)}</option>)}
              </select></label>
            <Button size="sm" onClick={() => setGrid('lignes')} disabled={!gridRows.length}>Modifier les lignes en grille</Button>
            <Button size="sm" onClick={() => setGrid('paiements')} disabled={!scopePayments.length}>Modifier les paiements en grille</Button>
            {toolbarExtra}
          </>}
          empty={<EmptyState title={filter === 'a_traiter' ? 'Rien à traiter' : filter === 'doublons' ? 'Aucun doublon' : 'Aucune ligne'}>
            {filter === 'a_traiter' ? 'Aucun impayé échu, aucun écart à qualifier et aucune quittance en attente.' : filter === 'doublons' ? 'Aucune ligne ni aucun paiement ne fait doublon.' : 'Aucune ligne ne correspond.'}</EmptyState>} />
      )}
      <div className="export-row">
        <span className="muted">Exporter :</span>
        <Button size="sm" onClick={() => void exp('xlsx')}>Excel (.xlsx)</Button>
        <Button size="sm" onClick={() => void exp('csv')}>CSV</Button>
      </div>
      <PaymentDialog open={!!pay} onClose={() => setPay(null)} leaseId={pay?.leaseId} month={pay?.month} mode={pay?.mode} />
      <ReceiptDialog receipt={receipt} onClose={() => setReceipt(null)} onReplaced={setReceipt} />
    </>
  );
}

function paymentExport(labelOf: (leaseId: string) => string | null): ExportColumn<Payment>[] {
  return [
    { label: 'Date', value: (p) => p.paid_on, kind: 'date' },
    { label: 'Mois concerné', value: (p) => monthLabel(p.period_month ?? p.paid_on) },
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
      const snap = await store.repo.loadAll().catch(() => null);
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
        note="Paiements du bail et du mois sélectionnés. Une date ou un montant modifié range de nouveau le paiement dans son mois ; les quittances concernées sont annulées puis réémises si le mois reste réglé."
        onSave={saveGrid} onClose={onClose} />
    </Section>
  );
}
