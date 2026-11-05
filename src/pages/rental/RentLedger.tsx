import { useCallback, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { useStore } from '../../data/store.tsx';
import type { Payment, Receipt } from '../../data/types.ts';
import { downloadBlob, stamp, toCsv, toXlsx, type ExportColumn } from '../../domain/exporting.ts';
import { date, money2 } from '../../domain/format.ts';
import { ledgerRows, ledgerSettings, mmYYYY, monthQuittance, receiptsProposed, ROW_STATUS_LABELS, type LedgerRow, type RowStatus } from '../../domain/ledger.ts';
import { monthLabel, PAYMENT_METHOD_LABELS, type ChargeView } from '../../domain/rental.ts';
import { round2 } from '../../domain/simulator.ts';
import { chargeDuplicates, paymentDuplicates } from '../../domain/duplicates.ts';
import { DataTable, type Column, type RowAction } from '../../ui/DataTable.tsx';
import { GridEditor, type GridColumn } from '../../ui/GridEditor.tsx';
import { Button, EmptyState, Section } from '../../ui/components.tsx';
import { navigate } from '../../ui/router.ts';
import { useChargeEditing } from './ChargeEdit.tsx';
import { applyPaymentEdit, METHODS, PaymentDialog, ReceiptDialog, receiptsCovering, sendLabel, usePaymentActions, useReceiptActions, useRental } from './common.tsx';
import { saveLedgerGrid } from './gridSave.ts';
import { previewEdits } from '../../domain/gridEdits.ts';
import { issueMonthDocs, useExcessDialog } from './monthActions.tsx';

/**
 * Vues du tableau (menu « Afficher ») : regroupements de statuts, le statut précis restant affiché sur chaque ligne.
 * - reste_du : Impayé, Partiel, Partiel reporté ;
 * - anomalies : excédent à qualifier, doublon possible, paiement hors période ;
 * - toutes : les loyers annulés n'apparaissent qu'avec la case « Inclure les annulés ».
 */
export type Filter = 'a_traiter' | 'reste_du' | 'reglee' | 'a_venir' | 'anomalies' | 'toutes';

export const DupPill = ({ title }: { title: string }) => <span className="pill pill-warn dup-flag" title={title}>doublon possible</span>;

const TONE: Record<RowStatus, string> = { reglee: 'won', partielle: 'hot', reportee: 'closed', impayee: 'bad', a_venir: 'early', annulee: 'closed', hors_periode: 'closed' };
const RECEIVED_LABELS = { oui: 'Oui', partiel: 'Partiel', non: 'Non' } as const;
/** Statuts proposés dans la grille : Réglé, Impayé et Annulé s'appliquent ; les autres reflètent la ligne. */
const STATUS_OPTIONS = (['reglee', 'impayee', 'annulee', 'partielle', 'reportee', 'a_venir', 'hors_periode'] as const).map((k) => [k, ROW_STATUS_LABELS[k]] as const);

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
  const { viewById, leaseById, propertyById, leaseLabel, today } = useRental();
  const [filter, setFilter] = useState<Filter>(initialFilter);
  // fiche d'un bail : les mois annulés restent visibles (on vient souvent de les annuler) ; Loyers et paiements : sur demande
  const [withCancelled, setWithCancelled] = useState(fixedLease);
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
  /** Nom court du bail (bien), le libellé complet en infobulle. */
  const shortLease = (id: string) => { const l = leaseById.get(id); return l ? `${propertyById.get(l.property_id)?.title ?? 'Bien supprimé'}${l.label ? ` – ${l.label}` : ''}` : '—'; };

  const allRows = useMemo(() => ledgerRows(data, settings, today), [data, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const months = useMemo(() => [...new Set(allRows.map((r) => r.month))].sort().reverse(), [allRows]);
  const dupCharges = useMemo(() => chargeDuplicates(data.charges.filter((c) => c.kind !== 'report')), [data.charges]);
  const dupPays = useMemo(() => paymentDuplicates(data.payments), [data.payments]);
  const isDupRow = (r: LedgerRow) => (!!r.loyer && dupCharges.ids.has(r.loyer.id)) || r.payments.some((p) => dupPays.ids.has(p.id));
  const canQuittance = (r: LedgerRow) => !!monthQuittance(r, data.allocations, data.receipts);
  /** Quittance proposée (« à émettre ») : mois réglé sans quittance, hors mois anciens écartés dans les réglages. */
  const propose = (r: LedgerRow) => canQuittance(r) && receiptsProposed(settings, r.month);
  /** Cas à vérifier : excédent à qualifier, doublon possible, paiement daté d'un mois sans loyer. */
  const isAnomaly = (r: LedgerRow) => r.excessToQualify || isDupRow(r) || r.status === 'hors_periode';
  const overdue = (r: LedgerRow) => (r.status === 'impayee' || r.status === 'partielle' || r.status === 'reportee') && (r.month < today.slice(0, 7) || (r.loyer?.due_date ?? '') <= today);
  const rows = allRows.filter((r) => {
    if (leaseFilter && r.lease_id !== leaseFilter) return false;
    if (month && r.month !== month) return false;
    switch (filter) {
      case 'toutes': return withCancelled || r.status !== 'annulee';
      case 'a_traiter': return (overdue(r) && r.status !== 'reportee') || r.toConfirm || r.excessToQualify || propose(r) || r.status === 'hors_periode';
      case 'reste_du': return r.status === 'impayee' || r.status === 'partielle' || r.status === 'reportee';
      case 'anomalies': return isAnomaly(r);
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
  const unpaid = scope.filter((r) => overdue(r) && r.status !== 'reportee').length;
  const toConfirm = scope.filter((r) => r.toConfirm).length;
  const toReceipt = scope.filter(propose).length;
  const restOf = (list: LedgerRow[]) => round2(list.reduce((t, r) => t + (r.status === 'reportee' || r.status === 'a_venir' ? 0 : Math.max(0, r.due - r.allocated)), 0));

  // « À traiter » : trois blocs ; ailleurs, avec tous les baux, un bandeau par bail
  type Todo = 'impayes' | 'verifier' | 'quittances';
  const TODO: Record<Todo, { order: number; label: string }> = { impayes: { order: 0, label: 'Loyers impayés' }, verifier: { order: 1, label: 'À vérifier' }, quittances: { order: 2, label: 'Quittances à émettre' } };
  const todoOf = (r: LedgerRow): Todo => (overdue(r) && r.status !== 'reportee' ? 'impayes' : r.toConfirm || r.excessToQualify || r.status === 'hors_periode' ? 'verifier' : 'quittances');
  const groupMode: 'todo' | 'bail' | null = filter === 'a_traiter' ? 'todo' : !fixedLease && !leaseFilter ? 'bail' : null;
  const groupBy = groupMode === 'todo' ? (r: LedgerRow) => { const t = todoOf(r); return { key: t, order: TODO[t].order }; }
    : groupMode === 'bail' ? (r: LedgerRow) => ({ key: r.lease_id, order: labelOfLease(r.lease_id) }) : undefined;
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
      <button type="button" className="link" title={`Modifier le paiement du ${date(p.paid_on)} : ${money2(p.amount)}, ${PAYMENT_METHOD_LABELS[p.method]}${p.reference ? `, réf. ${p.reference}` : ''}`} aria-label={`${date(p.paid_on)} · ${money2(p.amount)}`} onClick={() => payActions.edit(p)}>{date(p.paid_on).slice(0, 5)} · {money2(p.amount)}</button>
      {/* moyen affiché seulement s'il n'est pas le virement habituel */}
      {(p.method !== 'virement' || p.reference) && <span className="muted small">{[p.method !== 'virement' ? PAYMENT_METHOD_LABELS[p.method] : '', p.reference ?? ''].filter(Boolean).join(' · ')}</span>}
      {p.period_month && p.period_month.slice(0, 7) !== p.paid_on.slice(0, 7) && <span className="pill pill-neutral" title="Paiement rattaché à ce mois, reçu un autre mois" aria-label="déplacé">⇄</span>}
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

  /** Détail du dû sous le total : loyer + charges + autres sommes + reste dû reporté. */
  const dueDetail = (r: LedgerRow) => [
    ...(r.loyer && !r.loyer.cancelled_at ? [`loyer ${money2(r.rent)}`, ...(r.charges ? [`charges ${money2(r.charges)}`] : [])] : []),
    ...otherLabels(r),
  ];
  const allColumns: Column<LedgerRow>[] = [
    { id: 'lease', label: 'Bail', value: (r) => labelOfLease(r.lease_id), primary: true,
      render: (r) => <span title={labelOfLease(r.lease_id)}>{shortLease(r.lease_id)}</span> },
    { id: 'period', label: 'Période', value: (r) => r.month, mobile: true,
      render: (r) => <>{monthLabel(`${r.month}-01`)}{r.loyer && !r.loyer.period_start.endsWith('-01') && <small className="muted block">à partir du {date(r.loyer.period_start)}</small>}
        {r.loyer?.cancelled_at && r.loyer.cancel_reason ? <small className="muted block">Annulé : {r.loyer.cancel_reason}</small> : null}</> },
    { id: 'due', label: 'Dû', value: (r) => r.due, kind: 'money', align: 'right', mobile: true,
      render: (r) => <><strong>{money2(r.due)}</strong>{dueDetail(r).length > 1 && <span className="amount-detail">{dueDetail(r).map((l, i) => <span key={i} className="block">{i ? '+ ' : ''}{l}</span>)}</span>}</> },
    { id: 'paid', label: 'Réglé', value: (r) => r.paid, kind: 'money', align: 'right', mobile: true,
      render: (r) => <>{r.paid ? <strong>{money2(r.paid)}</strong> : <span className="muted">{money2(0)}</span>}{r.payments.length > 0 && <div className="pay-lines amount-detail">{r.payments.map(payLine)}</div>}</> },
    { id: 'gap', label: 'Reste / écart', value: (r) => r.gap, kind: 'money', align: 'right', mobile: true,
      render: (r) => <><span className={r.gap < 0 && r.status !== 'reportee' && r.status !== 'a_venir' ? 'neg' : r.gap > 0 ? 'pos' : ''}>{r.gap > 0 ? '+' : ''}{money2(r.gap)}</span>{gapNote(r) && <small className="muted block">{gapNote(r)}</small>}</> },
    { id: 'status', label: 'Statut', value: (r) => ROW_STATUS_LABELS[r.status], mobile: true,
      render: (r) => <><RowBadge r={r} />{isDupRow(r) && <DupPill title="Paiement ou ligne en double possible" />}
        {r.toConfirm && <div><Button size="sm" variant="ghost" onClick={() => void confirmReceived([r])}>Confirmer la réception</Button></div>}</> },
    // quittance émise, ou la suite à donner (paiement reçu, émettre la quittance, qualifier l'écart) : une seule colonne
    { id: 'document', label: 'Quittance / suite', value: (r) => [r.quittance, ...r.recus].filter(Boolean).map((d) => docLabel(d!)).join(' ; ') || null, mobile: true, sortable: false,
      render: (r) => {
        const docs = [...(r.quittance ? [r.quittance] : []), ...r.recus];
        const next = (() => {
            const v = loyerView(r);
            if (r.loyer?.cancelled_at && !r.others.length && !r.report) return v ? <Button size="sm" onClick={() => chargeEdit.restore(v)}>Réactiver</Button> : null;
            return <div className="row">
              {(r.status === 'impayee' || r.status === 'partielle' || r.status === 'reportee' || r.status === 'a_venir') && r.loyer && <Button size="sm" onClick={() => setPay({ leaseId: r.lease_id, month: r.month, mode: overdue(r) ? 'confirmation' : 'saisie' })}>{overdue(r) ? 'Paiement reçu' : 'Enregistrer un paiement'}</Button>}
              {propose(r) && <Button size="sm" variant="primary" onClick={() => void issueQuittances([r])}>Émettre la quittance</Button>}
              {r.excessToQualify && <Button size="sm" onClick={() => excess.open(r)}>Qualifier l’écart</Button>}
              {inlineEdit && v && <>
                <Button size="sm" variant="ghost" onClick={() => chargeEdit.edit(v)}>Modifier</Button>
                {r.paid > 0 && <Button size="sm" variant="ghost" onClick={() => chargeEdit.unpay(v)}>Annuler le paiement</Button>}
                {r.paid === 0 && r.allocated === 0 && <Button size="sm" variant="ghost" onClick={() => chargeEdit.cancel(v)}>Annuler</Button>}
              </>}
            </div>;
        })();
        return <div className="doc-lines">
          {docs.map((d) => <div key={d.id}><button type="button" className="link" aria-label={docLabel(d)} onClick={() => setReceipt(d)}>{d.kind === 'recu' ? `Reçu ${d.number}` : d.number}</button><small className="muted block">{sendLabel(d)}</small></div>)}
          {r.cancelledDocs.length > 0 && <button type="button" className="link muted small" title={r.cancelledDocs.map((d) => `${docLabel(d)} : ${d.cancel_reason ?? 'annulé'}`).join('\n')} onClick={() => setReceipt(r.cancelledDocs[0]!)}
            aria-label={`${r.cancelledDocs.length} document${r.cancelledDocs.length > 1 ? 's' : ''} annulé${r.cancelledDocs.length > 1 ? 's' : ''}`}>
            + {r.cancelledDocs.length} annulé{r.cancelledDocs.length > 1 ? 's' : ''}</button>}
          {next}
        </div>;
      } },
    // colonnes détaillées, masquées par défaut (bouton « Colonnes »)
    { id: 'rent', label: 'Loyer dû (HC)', value: (r) => r.rent, kind: 'money', align: 'right', defaultHidden: true, render: (r) => (r.loyer ? money2(r.rent) : '—') },
    { id: 'charges', label: 'Charges dues', value: (r) => r.charges, kind: 'money', align: 'right', defaultHidden: true, render: (r) => (r.loyer ? money2(r.charges) : '—') },
    { id: 'other', label: 'Autre somme due', value: (r) => round2(r.other + r.carryIn), kind: 'money', align: 'right', defaultHidden: true,
      render: (r) => (r.other + r.carryIn > 0 ? <span title={otherLabels(r).join('\n')}>{money2(round2(r.other + r.carryIn))}</span> : <span className="muted">—</span>) },
    { id: 'paid_on', label: 'Date de règlement', value: (r) => r.lastPaidOn, kind: 'date', defaultHidden: true, render: (r) => (r.lastPaidOn ? date(r.lastPaidOn) : '—') },
    { id: 'received', label: 'Reçu', value: (r) => RECEIVED_LABELS[r.received], defaultHidden: true },
    { id: 'payments', label: 'Paiements (texte)', value: (r) => r.payments.map(payText).join(' ; ') || null, defaultHidden: true, sortable: false },
  ];
  // colonne « Bail » utile seulement quand plusieurs baux se mélangent (« À traiter », tous les baux)
  const showLease = !fixedLease && !leaseFilter && groupMode !== 'bail';
  const columns = showLease ? allColumns : allColumns.filter((c) => c.id !== 'lease');

  const rowActions = (r: LedgerRow): RowAction<LedgerRow>[] => {
    const v = loyerView(r);
    const out: RowAction<LedgerRow>[] = [];
    if (r.loyer && !r.loyer.cancelled_at) out.push({ label: 'Enregistrer un paiement pour ce mois', onSelect: () => setPay({ leaseId: r.lease_id, month: r.month, mode: 'saisie' }) });
    if (canQuittance(r)) out.push({ label: propose(r) ? 'Émettre la quittance' : 'Émettre la quittance (mois antérieur aux quittances proposées)', onSelect: () => void issueQuittances([r]) });
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

  // grille : toutes les colonnes du tableau ; sont modifiables l'échéance, le loyer, les charges, l'autre somme due
  // (une seule par mois), le réglé et la date de règlement (un seul paiement dans le mois) et la réception confirmée
  const gridRows = rows.filter((r) => r.loyer && !r.loyer.cancelled_at);
  const allocOf = (id: string) => round2(data.allocations.filter((a) => a.charge_id === id).reduce((t, a) => t + a.amount, 0));
  const oneOther = (r: LedgerRow) => (r.others.length === 1 ? r.others[0]! : null);
  const muted = (t: ReactNode) => <span className="muted">{t}</span>;
  const lineGrid: GridColumn<LedgerRow>[] = [
    ...(fixedLease ? [] : [{ id: 'lease', label: 'Bail', type: 'text' as const, get: () => null, fixed: (r: LedgerRow) => labelOfLease(r.lease_id) }]),
    { id: 'period', label: 'Période', type: 'text', get: () => null, fixed: (r) => monthLabel(`${r.month}-01`) },
    { id: 'due_date', label: 'Échéance', type: 'date', get: (r) => r.loyer!.due_date, validate: (x) => (x ? null : 'Date obligatoire') },
    { id: 'rent', label: 'Loyer dû (HC)', type: 'money', get: (r) => r.rent,
      validate: (x, r, all) => (x === null || (x as number) < 0 ? 'Montant positif ou nul'
        : round2((x as number) + Number(all.charges ?? r.charges)) < allocOf(r.loyer!.id) ? `Inférieur au déjà réglé (${money2(allocOf(r.loyer!.id))})` : null) },
    { id: 'charges', label: 'Charges dues', type: 'money', get: (r) => r.charges, validate: (x) => (x === null || (x as number) < 0 ? 'Montant positif ou nul' : null) },
    { id: 'other', label: 'Autre somme due', type: 'money', get: (r) => oneOther(r) ? round2(oneOther(r)!.rent_amount + oneOther(r)!.charges_amount) : r.others.length ? null : 0,
      fixed: (r) => (r.others.length > 1 ? <span title={otherLabels(r).join('\n')}>{money2(r.other)} <small className="muted">({r.others.length} sommes)</small></span> : false),
      validate: (x, r) => { const o = oneOther(r); return x !== null && (x as number) < 0 ? 'Montant positif ou nul' : o && Number(x ?? 0) < allocOf(o.id) ? `Inférieur au déjà réglé (${money2(allocOf(o.id))})` : null; } },
    { id: 'other_label', label: 'Libellé autre somme', type: 'text', width: '11rem', get: (r) => oneOther(r)?.label ?? null,
      fixed: (r) => (r.others.length > 1 ? muted('plusieurs') : false), validate: (x) => (String(x ?? '').length > 200 ? '200 caractères au plus' : null) },
    { id: 'carry', label: 'Reste dû reporté', type: 'text', get: () => null, fixed: (r) => (r.carryIn ? <span title={r.report?.label ?? ''}>{money2(r.carryIn)}</span> : muted('—')) },
    { id: 'due', label: 'Total dû', type: 'text', get: () => null, fixed: (r) => <strong>{money2(r.due)}</strong> },
    { id: 'paid', label: 'Réglé', type: 'money', get: (r) => (r.payments.length <= 1 ? r.paid : null),
      fixed: (r) => (r.payments.length > 1 ? <span title={r.payments.map(payText).join('\n')}>{money2(r.paid)} <small className="muted">({r.payments.length} paiements)</small></span> : false),
      validate: (x) => (x !== null && (x as number) < 0 ? 'Montant positif ou nul' : null) },
    { id: 'paid_on', label: 'Date de règlement', type: 'date', get: (r) => r.lastPaidOn,
      validate: (x, r, all) => (x && String(x) > today ? 'Date future'
        : x && !r.payments.length && !(Number(all.paid ?? 0) > 0) && all.status !== 'reglee' ? 'Saisissez aussi le réglé, ou le statut « Réglé »' : null) },
    { id: 'received', label: 'Reçu', type: 'select', options: [['oui', 'Oui'], ['non', 'Non']] as const, get: (r) => (r.loyer!.received_at ? 'oui' : 'non'),
      fixed: (r) => (settings.receivedMode === 'confirmation' ? false : RECEIVED_LABELS[r.received]) },
    { id: 'gap', label: 'Écart', type: 'text', get: () => null, fixed: (r) => <span className={r.gap < 0 && r.status !== 'reportee' ? 'neg' : r.gap > 0 ? 'pos' : ''}>{r.gap > 0 ? '+' : ''}{money2(r.gap)}</span> },
    { id: 'status', label: 'Statut', type: 'select', options: STATUS_OPTIONS, get: (r) => r.status,
      validate: (x, r) => (x === r.status || x === 'reglee' || x === 'impayee' ? null
        : x === 'annulee' ? (r.payments.length ? 'Supprimez d’abord les paiements du mois (statut « Impayé »)' : null)
        : 'Statut calculé : choisissez Réglé, Impayé ou Annulé, ou saisissez le réglé') },
    { id: 'doc', label: 'Quittance', type: 'text', get: () => null, fixed: (r) => [r.quittance, ...r.recus].filter(Boolean).map((d) => docLabel(d!)).join(' ; ') || muted('—') },
  ];
  async function saveLines(changes: { row: LedgerRow; values: Record<string, string | number | null> }[], opts?: { auto: boolean }) {
    // une ligne après l'autre, du mois le plus ancien au plus récent, reports recalculés entre deux lignes
    const edits = changes.map(({ row, values }) => ({ key: row.key, lease_id: row.lease_id, month: row.month, values }));
    const res = await store.call((repo) => saveLedgerGrid(repo, edits, today));
    if (!res) return { saved: [] as string[], failed: null };
    const docs = res.cancelled ? ` ${res.cancelled} document${res.cancelled > 1 ? 's' : ''} annulé${res.cancelled > 1 ? 's' : ''}${res.reissued ? `, ${res.reissued} réémis avec un nouveau numéro` : ', non réémis (mois plus intégralement réglé)'}.` : '';
    if (res.failed) {
      const row = changes.find((c) => c.row.key === res.failed!.key)?.row;
      const where = row ? `${monthLabel(`${row.month}-01`)}${fixedLease ? '' : ` (${labelOfLease(row.lease_id)})`}` : 'une ligne';
      store.notify(`${res.saved.length ? `${res.saved.length} ligne${res.saved.length > 1 ? 's' : ''} enregistrée${res.saved.length > 1 ? 's' : ''}. ` : ''}Non enregistré : ${where} – ${res.failed.message}${docs}`, 'error');
    } else if (!opts?.auto || docs) {
      store.notify(`${res.saved.length} ligne${res.saved.length > 1 ? 's' : ''} modifiée${res.saved.length > 1 ? 's' : ''}.${docs}`);
    }
    return { saved: res.saved, failed: res.failed };
  }
  // recalcul en direct : lignes telles qu'elles seront après l'enregistrement des saisies valides
  const deriveLines = useCallback((changes: { row: LedgerRow; values: Record<string, string | number | null> }[]) => {
    const prev = previewEdits(data, changes.map(({ row, values }) => ({ key: row.key, lease_id: row.lease_id, month: row.month, values })), settings, today);
    return (r: LedgerRow) => {
      const n = prev.get(r.key);
      return n && (n.due !== r.due || n.paid !== r.paid || n.gap !== r.gap || n.status !== r.status || n.carryIn !== r.carryIn || n.other !== r.other || n.carriedOut !== r.carriedOut) ? n : r;
    };
  }, [data, today]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Ligne quittancée : la quittance serait annulée puis réémise, on attend une confirmation explicite. */
  const lineNeedsConfirm = useCallback((r: LedgerRow) => (r.quittance || r.recus.length ? 'la quittance ou le reçu du mois sera annulé puis réémis' : null), []);

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

  // une seule entrée « Modifier en grille » : grille des mois ou grille des paiements
  const gridModes = { current: grid ?? 'lignes', options: [['lignes', 'Par mois'], ['paiements', 'Par paiement']] as const,
    onChange: (m: string) => setGrid(m === 'paiements' ? 'paiements' : 'lignes') };

  const groupHeader = (key: string, list: LedgerRow[]): ReactNode => {
    if (groupMode === 'bail') {
      const rest = restOf(list);
      return <>
        <button type="button" className="link dt-group-title" onClick={() => navigate(`/baux/${key}`)}>{labelOfLease(key)}</button>
        <span className="dt-group-meta">{list.length} mois{rest ? <> · reste dû <strong className="neg">{money2(rest)}</strong></> : ' · rien à régler'}</span>
      </>;
    }
    const t = key as Todo;
    const n = list.length;
    if (t === 'impayes') return <>
      <span className="dt-group-title">{TODO.impayes.label} ({n})</span>
      <span className="dt-group-meta">reste dû <strong className="neg">{money2(restOf(list))}</strong> · mois dont l’échéance est passée</span>
    </>;
    if (t === 'verifier') {
      const c = list.filter((r) => r.toConfirm);
      return <>
        <span className="dt-group-title">{TODO.verifier.label} ({n})</span>
        <span className="dt-group-meta">réceptions à confirmer, excédents à qualifier, paiements hors période</span>
        {c.length > 0 && <span className="dt-group-actions"><Button size="sm" onClick={() => void confirmReceived(c)}>Marquer comme reçu ({c.length})</Button></span>}
      </>;
    }
    return <>
      <span className="dt-group-title">{TODO.quittances.label} ({n})</span>
      <span className="dt-group-meta">mois intégralement réglés sans quittance</span>
      <span className="dt-group-actions">
        <Button size="sm" variant="primary" onClick={() => { if (window.confirm(`Émettre ${n > 1 ? `les ${n} quittances` : 'la quittance'} ? Elles ne sont pas envoyées au locataire.`)) void issueQuittances(list); }}>
          Émettre {n > 1 ? `les ${n} quittances` : 'la quittance'}</Button>
        <OldReceipts months={[...new Set(list.map((r) => r.month))].sort()} today={today} onApply={(m) => void hideOldReceipts(m)} />
      </span>
    </>;
  };
  /** Mois réglés antérieurs à `m` : plus proposés « à émettre » (réglage Quittances proposées à partir de). */
  const hideOldReceipts = async (m: string) => {
    const rs = data.settings?.rental_settings ?? {};
    if (await store.saveSettings({ rental_settings: { ...rs, receipts_from: m } }))
      store.notify(`Quittances proposées à partir de ${mmYYYY(m)}. Modifiable dans Paramètres → Gestion locative.`);
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
            <span className="figure-label">Loyers impayés</span><span className={`figure-value ${unpaid ? 'neg' : ''}`}>{unpaid}</span>
            <span className="figure-hint">mois échus non réglés{toConfirm ? ` · ${toConfirm} réception${toConfirm > 1 ? 's' : ''} à confirmer` : ''}</span>
          </button>
          <button type="button" className="figure link-figure" onClick={() => setFilter('a_traiter')}>
            <span className="figure-label">Quittances à émettre</span><span className="figure-value">{toReceipt}</span><span className="figure-hint">mois intégralement réglés{settings.receiptsFrom ? ` depuis ${mmYYYY(settings.receiptsFrom)}` : ''}</span>
          </button>
          <div className="figure"><span className="figure-label">Total dû (sélection)</span><span className="figure-value">{money2(totals.due)}</span><span className="figure-hint">réglé {money2(totals.paid)}</span></div>
          <div className="figure"><span className="figure-label">Reste dû (sélection)</span><span className={`figure-value ${totals.rest ? 'neg' : ''}`}>{money2(totals.rest)}</span>
            {toQualify > 0 ? <button type="button" className="figure-hint link" onClick={() => setFilter('anomalies')}>{toQualify} excédent{toQualify > 1 ? 's' : ''} à qualifier</button>
              : totals.over > 0 ? <span className="figure-hint">trop-perçu {money2(totals.over)}</span> : null}</div>
        </div>
      )}
      {scopeDupExtra.length > 0 && !grid && (
        <p className="note note-warn">{scopeDupExtra.length} paiement{scopeDupExtra.length > 1 ? 's semblent' : ' semble'} en double (même bail, même montant, à quelques jours d’écart).{' '}
          <button type="button" className="link" onClick={() => setFilter('anomalies')}>Afficher les doublons</button>{' · '}
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
        <GridEditor rows={gridRows} columns={lineGrid} rowKey={(r) => r.key} rowLabel={(r) => `${monthLabel(`${r.month}-01`)}${fixedLease ? '' : ` – ${labelOfLease(r.lease_id)}`}`}
          flag={(r) => (isDupRow(r) ? <DupPill title="Doublon possible" /> : null)}
          note={<>Toutes les colonnes du tableau, selon les filtres. Modifiables : échéance, loyer, charges, autre somme due (une par mois ; 0 la retire), réglé (un seul paiement dans le mois ; un montant saisi sur un mois sans paiement crée le paiement, 0 le supprime), date de règlement (celle du dernier paiement du mois), statut (« Réglé » ajoute le paiement manquant, « Impayé » supprime les paiements du mois, « Annulé » annule la ligne){settings.receivedMode === 'confirmation' ? ', reçu' : ''}. Le total, l’écart, le statut et les reports se recalculent pendant la saisie ; chaque ligne est enregistrée quand vous la quittez, du mois le plus ancien au plus récent. Une ligne quittancée reste modifiable mais attend le bouton « Enregistrer » : sa quittance est annulée, puis réémise avec un nouveau numéro si le mois est toujours intégralement réglé (l’ancienne reste dans l’historique).</>}
          onSave={saveLines} onClose={() => setGrid(null)} derive={deriveLines} autoSave={{ confirm: lineNeedsConfirm }}
          storageKey={`immozen:grille-loyers:${leaseFilter || 'tous'}`} modes={gridModes} />
      ) : grid === 'paiements' ? (
        <PaymentsGrid payments={scopePayments} dupIds={dupPays.ids} onClose={() => setGrid(null)} modes={gridModes} />
      ) : (
        <DataTable id={fixedLease ? 'loyers-bail-v3' : 'loyers-v3'} rows={rows} columns={columns} rowKey={(r) => r.key} initialSort={{ id: 'period', dir: 'desc' }}
          groupBy={groupBy} groupHeader={groupHeader}
          onOpen={showLease ? (r) => navigate(`/baux/${r.lease_id}`) : undefined}
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
                <option value="a_traiter">À traiter</option>
                <option value="reste_du">Reste dû (impayés et partiels)</option>
                <option value="reglee">Réglés</option>
                <option value="a_venir">À venir</option>
                <option value="anomalies">Anomalies ({scope.filter(isAnomaly).length})</option>
                <option value="toutes">Tous</option>
              </select></label>
            {filter === 'toutes' && (
              <label className="checkbox small"><input type="checkbox" checked={withCancelled} onChange={(e) => setWithCancelled(e.target.checked)} /><span>Inclure les annulés</span></label>
            )}
            <label className="inline-select">Mois
              <select value={month} onChange={(e) => setMonth(e.target.value)}>
                <option value="">Tous</option>{months.map((m) => <option key={m} value={m}>{monthLabel(`${m}-01`)}</option>)}
              </select></label>
            <Button size="sm" onClick={() => setGrid(gridRows.length ? 'lignes' : 'paiements')} disabled={!gridRows.length && !scopePayments.length}>Modifier en grille</Button>
            {toolbarExtra}
          </>}
          empty={<EmptyState title={filter === 'a_traiter' ? 'Rien à traiter' : filter === 'anomalies' ? 'Aucune anomalie' : filter === 'reste_du' ? 'Aucun reste dû' : 'Aucune ligne'}>
            {filter === 'a_traiter' ? 'Aucun impayé échu, aucun écart à qualifier et aucune quittance en attente.'
              : filter === 'anomalies' ? 'Aucun excédent à qualifier, aucun doublon possible et aucun paiement hors période.'
              : filter === 'reste_du' ? 'Tous les mois échus sont réglés.' : 'Aucune ligne ne correspond.'}</EmptyState>} />
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
function PaymentsGrid({ payments, dupIds, onClose, modes }: { payments: Payment[]; dupIds: Set<string>; onClose: () => void; modes?: ComponentProps<typeof GridEditor>['modes'] }) {
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
  async function saveGrid(changes: { row: Payment; values: Record<string, string | number | null> }[], opts?: { auto: boolean }) {
    const saved: string[] = [];
    let failed: { key: string; message: string } | null = null;
    const msgs: string[] = [];
    // paiements les plus anciens d'abord : les mois sont remis en conformité dans l'ordre
    for (const { row, values } of [...changes].sort((a, b) => a.row.paid_on.localeCompare(b.row.paid_on))) {
      const snap = await store.repo.loadAll().catch(() => null);
      if (!snap) { failed = { key: row.id, message: 'données indisponibles, réessayez' }; break; }
      const current = snap.payments.find((p) => p.id === row.id);
      if (!current) { failed = { key: row.id, message: 'paiement supprimé entre-temps' }; break; }
      const f = { amount: Number(values.amount ?? current.amount), paid_on: String(values.paid_on ?? current.paid_on), method: (values.method ?? current.method) as Payment['method'],
        reference: 'reference' in values ? (values.reference as string | null) : current.reference, comment: 'comment' in values ? (values.comment as string | null) : current.comment };
      const msg = await applyPaymentEdit(store, snap, current, f);
      if (!msg) { failed = { key: row.id, message: 'enregistrement refusé (voir le message)' }; break; }
      saved.push(row.id);
      if (/document/.test(msg)) msgs.push(msg);
    }
    await store.refresh();
    if (saved.length && (!opts?.auto || msgs.length)) store.notify(`${saved.length} paiement${saved.length > 1 ? 's' : ''} modifié${saved.length > 1 ? 's' : ''}.${msgs.length ? ' Les quittances concernées ont été rééditées ou annulées.' : ''}`);
    return { saved, failed };
  }
  /** Paiement couvert par une quittance : la quittance serait annulée, on attend une confirmation explicite. */
  const needsConfirm = (p: Payment) => (receiptsCovering(p, store.data).length ? 'la quittance qui couvre ce paiement sera annulée puis réémise' : null);
  return (
    <Section>
      <GridEditor rows={[...payments].sort((a, b) => b.paid_on.localeCompare(a.paid_on))} columns={gridCols} rowKey={(p) => p.id} rowLabel={(p) => `paiement du ${date(p.paid_on)}`}
        flag={(p) => (dupIds.has(p.id) ? <DupPill title="Doublon possible" /> : null)}
        note="Paiements du bail et du mois sélectionnés. Chaque paiement est enregistré quand vous quittez sa ligne. Une date ou un montant modifié range de nouveau le paiement dans son mois ; les quittances concernées sont annulées puis réémises si le mois reste réglé (après clic sur « Enregistrer »)."
        onSave={saveGrid} onClose={onClose} autoSave={{ confirm: needsConfirm }} storageKey="immozen:grille-paiements" modes={modes} />
    </Section>
  );
}

/** « Ne plus proposer avant… » : écarte les mois réglés anciens des quittances à émettre. */
function OldReceipts({ months, today, onApply }: { months: string[]; today: string; onApply: (month: string) => void }) {
  const cur = today.slice(0, 7);
  const options = [...new Set([...months.slice(1), cur])].sort();
  const [m, setM] = useState(cur);
  if (!months.length) return null;
  return (
    <span className="inline-select small">Ne plus proposer avant
      <select aria-label="Ne plus proposer les quittances avant" value={m} onChange={(e) => setM(e.target.value)}>
        {options.map((x) => <option key={x} value={x}>{mmYYYY(x)}</option>)}
      </select>
      <Button size="sm" variant="ghost" onClick={() => onApply(m)}>Appliquer</Button>
    </span>
  );
}
