import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../data/store.tsx';
import type { Lease, Payment, PaymentMethod, Receipt, RentCharge } from '../../data/types.ts';
import { RepoError, type ReceiptChanges, type Snapshot } from '../../data/repo.ts';
import { date, dateTime, money2, todayParis } from '../../domain/format.ts';
import {
  CHARGE_STATUS_LABELS, chargeViews, leaseState, leaseTenants, LEASE_STATE_LABELS, monthLabel, monthOf,
  PAYMENT_METHOD_LABELS, tenantName, type ChargeStatus, type ChargeView, type LeaseState,
} from '../../domain/rental.ts';
import { ledgerRows, ledgerSettings } from '../../domain/ledger.ts';
import { syncLedgerWith } from './ledgerSync.ts';
import { applyExcess, ExcessFields, issueMonthDocs, type ExcessDecision } from './monthActions.tsx';
import { round2 } from '../../domain/simulator.ts';
import { findDuplicates, samePayment } from '../../domain/duplicates.ts';
import { downloadBlob } from '../../domain/exporting.ts';
import { Button, Checkbox, Modal, NumberInput, Select, TextInput } from '../../ui/components.tsx';
import { buildReceiptPdf } from '../../../supabase/functions/_shared/receiptPdf.ts';

export const METHODS = Object.entries(PAYMENT_METHOD_LABELS) as [PaymentMethod, string][];

/** Données de gestion locative dérivées du Snapshot. */
export function useRental() {
  const { data } = useStore();
  const today = todayParis();
  return useMemo(() => {
    const views = chargeViews(data.charges, data.allocations, today);
    const viewById = new Map(views.map((v) => [v.charge.id, v]));
    const leaseById = new Map(data.leases.map((l) => [l.id, l]));
    const propertyById = new Map(data.properties.map((p) => [p.id, p]));
    const leaseLabel = (l: Lease) => {
      const p = propertyById.get(l.property_id);
      const names = leaseTenants(l.id, data.leaseTenants, data.tenants).map(tenantName).join(', ');
      return `${p?.title ?? 'Bien supprimé'}${l.label ? ` – ${l.label}` : ''}${names ? ` (${names})` : ''}`;
    };
    // quittance de l'échéance, ou quittance d'un autre mois qui la reprend en rappel de charges
    const quittanceFor = (chargeId: string) => data.receipts.find((r) => r.kind === 'quittance' && !r.cancelled_at
      && (r.charge_id === chargeId || (r.extra_lines ?? []).some((x) => x.charge_id === chargeId))) ?? null;
    return { today, views, viewById, leaseById, propertyById, leaseLabel, quittanceFor };
  }, [data, today]);
}

const STATUS_TONE: Record<ChargeStatus, string> = { payee: 'won', partielle: 'hot', impayee: 'bad', a_venir: 'early', annulee: 'closed', reportee: 'closed' };
export function ChargeBadge({ v }: { v: ChargeView }) {
  const label = v.overdue && v.status === 'partielle' ? 'Partielle, en retard' : CHARGE_STATUS_LABELS[v.status];
  return <span className={`status status-${STATUS_TONE[v.status]}`} title={v.overdue ? `${v.daysLate} jour(s) de retard` : undefined}>{label}</span>;
}

const LEASE_TONE: Record<LeaseState, string> = { a_venir: 'early', actif: 'active', termine: 'closed' };
export function LeaseBadge({ lease }: { lease: Pick<Lease, 'start_date' | 'end_date'> }) {
  const s = leaseState(lease, todayParis());
  return <span className={`status status-${LEASE_TONE[s]}`}>{LEASE_STATE_LABELS[s]}</span>;
}

export const periodLabel = (c: Pick<RentCharge, 'period_start' | 'period_end' | 'kind' | 'label'>) =>
  c.kind === 'loyer' ? monthLabel(c.period_start) + (c.period_start.endsWith('-01') ? '' : ` (à partir du ${date(c.period_start)})`) : (c.label ?? (c.kind === 'regularisation' ? 'Régularisation de charges' : 'Autre somme due'));

// ---------------------------------------------------------------------
// Enregistrer un paiement : rattaché à un mois (par défaut celui de sa date)
// ---------------------------------------------------------------------
export function PaymentDialog({ open, onClose, leaseId, month, mode = 'saisie' }: {
  open: boolean; onClose: () => void; leaseId?: string;
  /** Mois concerné (AAAA-MM) : la ligne depuis laquelle le paiement est saisi. */
  month?: string;
  mode?: 'saisie' | 'confirmation';
}) {
  const store = useStore();
  const { data } = store;
  const { leaseLabel, today } = useRental();
  const [lease, setLease] = useState<string>(leaseId ?? '');
  const [amount, setAmount] = useState<number | null>(null);
  const [paidOn, setPaidOn] = useState(today);
  const [dateTouched, setDateTouched] = useState(false);
  /** Mois choisi ('' : mois de la date). */
  const [target, setTarget] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('virement');
  const [reference, setReference] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Paiements déjà enregistrés qui ressemblent à celui-ci (avertissement anti-doublon). */
  const [dups, setDups] = useState<Payment[] | null>(null);
  const [issue, setIssue] = useState(false);
  const [excess, setExcess] = useState<ExcessDecision | null>(null);

  const settings = ledgerSettings(data.settings?.rental_settings);
  const rows = useMemo(() => ledgerRows(data, settings, today), [data, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const effMonth = target || monthOf(paidOn || today);
  const row = rows.find((r) => r.lease_id === lease && r.month === effMonth) ?? null;
  const leaseMonths = useMemo(() => [...new Set(rows.filter((r) => r.lease_id === lease && r.loyer).map((r) => r.month))].sort().reverse(), [rows, lease]);

  useEffect(() => {
    if (!open) return;
    setLease(leaseId ?? (data.leases.length === 1 ? data.leases[0]!.id : ''));
    setPaidOn(today); setDateTouched(false); setMethod('virement'); setReference(''); setComment(''); setError(null); setDups(null); setIssue(false); setExcess(null);
    setTarget(month && month !== monthOf(today) ? month : '');
    const r = month && leaseId ? rows.find((x) => x.lease_id === leaseId && x.month === month) : undefined;
    setAmount(r ? Math.max(0, round2(r.due - r.allocated)) || null : null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const before = row ? round2(row.paid + row.advanceIn - row.advanceOut) : 0;
  const after = round2(before + (amount ?? 0));
  const due = row?.due ?? 0;
  const over = row && row.loyer ? round2(after - due) : 0;
  const settles = !!row?.loyer && after >= due && due > 0 && !row.quittance;

  async function save() {
    setError(null);
    if (!lease) { setError('Choisissez le bail.'); return; }
    if (!amount || !(amount > 0)) { setError('Indiquez un montant positif.'); return; }
    if (!paidOn) { setError('Indiquez la date de réception.'); return; }
    if (!dups) {
      const same = findDuplicates({ lease_id: lease, amount: round2(amount), paid_on: paidOn, reference: reference || null, period_month: `${effMonth}-01` }, data.payments, samePayment);
      if (same.length) { setDups(same); return; }
    }
    setBusy(true);
    try {
      const done = await store.call(async (repo) => {
        await repo.insert('payments', {
          lease_id: lease, amount: round2(amount), paid_on: paidOn, period_month: `${effMonth}-01`, method, reference: reference || null, comment: comment || null,
          source: mode === 'confirmation' ? 'confirmation' : 'saisie', date_defaulted: mode === 'confirmation' && !dateTouched,
        });
        await syncLedgerWith(repo, { leaseIds: [lease] });
        if (over > 0 && excess && row?.loyer) { await applyExcess(repo, row.loyer.id, over, excess); await syncLedgerWith(repo, { leaseIds: [lease] }); }
        // la confirmation d'un paiement vaut confirmation de réception (colonne « Reçu »)
        if (settings.receivedMode === 'confirmation' && row?.loyer && !row.loyer.received_at) {
          const c = (await repo.loadAll()).charges.find((x) => x.id === row.loyer!.id);
          if (c) await repo.update('rent_charges', c.id, c.version, { received_at: new Date().toISOString() });
        }
        return issue ? await issueMonthDocs(repo, [{ lease_id: lease, month: effMonth, kind: 'quittance' }]) : { q: 0, r: 0 };
      });
      if (done) {
        store.notify(`${mode === 'confirmation' ? 'Paiement confirmé' : 'Paiement enregistré'} sur ${monthLabel(`${effMonth}-01`)}.${done.q ? ' Quittance émise.' : ''}`);
        onClose();
      }
    } finally {
      setBusy(false);
    }
  }

  const activeLeases = data.leases.filter((l) => leaseState(l, today) !== 'a_venir' || l.id === leaseId);
  const title = mode === 'confirmation' ? 'Confirmer un paiement reçu' : 'Enregistrer un paiement';
  const monthOptions = [...new Set([monthOf(paidOn || today), ...leaseMonths])].sort().reverse();

  return (
    <Modal open={open} title={title} onClose={onClose} wide
      footer={<><Button onClick={onClose}>Annuler</Button><Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Enregistrement…' : dups ? 'Enregistrer quand même' : mode === 'confirmation' ? 'Confirmer le paiement' : 'Enregistrer le paiement'}</Button></>}>
      {mode === 'confirmation' && <p className="note">Seul un paiement que vous confirmez ici est enregistré : sans confirmation, le loyer reste impayé.</p>}
      <div className="grid">
        {!leaseId && (
          <Select label="Bail" wide value={lease || null} onChange={(v) => { setLease(v ?? ''); setExcess(null); }} allowEmpty="Choisir…"
            options={activeLeases.map((l) => [l.id, leaseLabel(l)] as const)} />
        )}
        <NumberInput label="Montant reçu" suffix="€" value={amount} onChange={(v) => { setAmount(v); setDups(null); }} />
        <Field2 label="Date de réception" hint={mode === 'confirmation' && !dateTouched ? 'Date du jour proposée par défaut : modifiez-la si vous la connaissez.' : undefined}>
          {(id) => <input id={id} type="date" value={paidOn} max={today} onChange={(e) => { setPaidOn(e.target.value); setDateTouched(true); setDups(null); }} />}
        </Field2>
        <Field2 label="Mois concerné" hint="Par défaut, le mois de la date de réception.">
          {(id) => <select id={id} value={target || monthOf(paidOn || today)} onChange={(e) => { setTarget(e.target.value === monthOf(paidOn || today) ? '' : e.target.value); setExcess(null); }}>
            {monthOptions.map((m) => <option key={m} value={m}>{monthLabel(`${m}-01`)}{m === monthOf(paidOn || today) ? ' (mois de la date)' : ''}</option>)}
          </select>}
        </Field2>
        <Select label="Moyen de paiement" value={method} onChange={(v) => setMethod(v ?? 'virement')} options={METHODS} />
        <TextInput label="Référence" value={reference} onChange={setReference} maxLength={200} placeholder="N° de chèque, libellé du virement…" />
        <TextInput label="Commentaire" wide value={comment} onChange={setComment} maxLength={2000} />
      </div>

      {lease && (
        <div className="alloc">
          {row?.loyer ? (
            <p className="small">{monthLabel(`${effMonth}-01`)} : dû <strong>{money2(due)}</strong>{row.carryIn > 0 ? ` (dont ${row.report?.label ?? 'reste dû reporté'} ${money2(row.carryIn)})` : ''} · déjà réglé {money2(before)} · après ce paiement <strong>{money2(after)}</strong>
              {after < due ? ` · reste dû ${money2(round2(due - after))}` : after > due ? ` · excédent ${money2(over)}` : ''}</p>
          ) : <p className="muted small">Aucune ligne de loyer pour {monthLabel(`${effMonth}-01`)} : le paiement sera signalé hors période.</p>}
          {over > 0 && row && <ExcessFields value={excess} onChange={setExcess} excess={over} month={effMonth} allowLater />}
        </div>
      )}
      {row?.loyer && (settles || over > 0) && !row.quittance && (
        <Checkbox label={`Émettre la quittance de ${monthLabel(`${effMonth}-01`)} si le mois est intégralement réglé`} checked={issue} onChange={setIssue} />
      )}
      {dups && (
        <div className="note note-warn" role="alert">
          <strong>Doublon probable.</strong> {dups.length > 1 ? 'Des paiements du même montant sont déjà enregistrés' : 'Un paiement du même montant est déjà enregistré'} sur ce bail à quelques jours d’intervalle :
          <ul>{dups.map((p) => <li key={p.id}>{money2(p.amount)} le {date(p.paid_on)} ({PAYMENT_METHOD_LABELS[p.method]}{p.reference ? `, ${p.reference}` : ''})</li>)}</ul>
          S’il s’agit bien d’un second versement, enregistrez quand même ; sinon, annulez.
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </Modal>
  );
}

function Field2({ label, hint, children }: { label: string; hint?: string; children: (id: string) => React.ReactNode }) {
  const id = `f-${label.replace(/\W+/g, '-')}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <small className="muted">{hint}</small>}
    </div>
  );
}

// ---------------------------------------------------------------------
// Aperçu, téléchargement, envoi et annulation d'une quittance / d'un reçu
// ---------------------------------------------------------------------
export async function receiptBlob(r: Receipt, lease?: Lease): Promise<Blob> {
  const pdfLib = await import('pdf-lib');
  const bytes = await buildReceiptPdf(pdfLib, { ...r, charges_label: lease?.charges_mode === 'forfait' ? 'Forfait de charges' : 'Provision pour charges' });
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

export function receiptFileName(r: Receipt) {
  return `${r.kind === 'quittance' ? 'quittance' : 'recu'}-${r.number}-${r.period_start.slice(0, 7)}.pdf`;
}

const SEND_LABELS: Record<Receipt['send_status'], string> = { non_envoye: 'Non envoyé', a_envoyer: 'Envoi en attente', envoye: 'Envoyé', echec: 'Échec de l’envoi' };
export const sendLabel = (r: Receipt) => (r.cancelled_at ? 'Annulé'
  : r.send_status === 'envoye' && r.sent_at ? `Envoyé le ${dateTime(r.sent_at).replace(' ', ' à ')}`
  : SEND_LABELS[r.send_status]);

export function ReceiptDialog({ receipt, onClose, onReplaced }: { receipt: Receipt | null; onClose: () => void; onReplaced?: (r: Receipt) => void }) {
  const store = useStore();
  const actions = useReceiptActions((n) => { if (onReplaced) onReplaced(n); else onClose(); });
  const lease = receipt ? store.data.leases.find((l) => l.id === receipt.lease_id) : undefined;
  const [url, setUrl] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  const live = receipt ? store.data.receipts.find((r) => r.id === receipt.id) ?? receipt : null;

  useEffect(() => {
    if (!receipt) return;
    let u: string | null = null;
    void receiptBlob(receipt, lease).then((b) => { u = URL.createObjectURL(b); setUrl(u); });
    return () => { if (u) URL.revokeObjectURL(u); setUrl(null); setCancelReason(null); };
  }, [receipt?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!live) return null;
  const label = live.kind === 'quittance' ? 'Quittance' : 'Reçu';
  return (
    <Modal open={!!receipt} wide title={`${label} ${live.number}`} onClose={onClose}
      footer={<>
        {!live.cancelled_at && cancelReason === null && <Button variant="ghost" onClick={() => setCancelReason('')}>Supprimer</Button>}
        {!live.cancelled_at && <Button onClick={() => actions.edit(live)}>Modifier</Button>}
        {!live.cancelled_at && <Button onClick={() => void actions.reissue(live)}>Rééditer</Button>}
        <Button onClick={async () => downloadBlob(await receiptBlob(live, lease), receiptFileName(live))}>Télécharger le PDF</Button>
        {!live.cancelled_at && (
          <Button variant="primary" disabled={live.send_status === 'envoye' || live.send_status === 'a_envoyer'}
            title={live.tenant_emails.length ? `À : ${live.tenant_emails.join(', ')}` : 'Aucun e-mail de locataire'}
            onClick={() => {
              // la fenêtre se ferme tout de suite ; le résultat (ou l'erreur) s'affiche en message
              onClose();
              void store.call((r) => r.queueReceiptEmail(live.id), store.repo.mode === 'demo' ? 'Mis en file (mode démonstration : aucun e-mail n’est envoyé).' : 'Envoi programmé : la quittance part au locataire dans quelques minutes.');
            }}>
            {live.send_status === 'envoye' ? (live.sent_at ? `Envoyé le ${date(live.sent_at)}` : 'Envoyé') : live.send_status === 'a_envoyer' ? 'Envoi en attente' : 'Envoyer au locataire'}
          </Button>
        )}
      </>}>
      {(live.extra_lines ?? []).length > 0 && <p className="note">Autres sommes incluses : {live.extra_lines!.map((x) => `${x.label} (${money2(x.amount)})`).join(', ')}.</p>}
      <p className="muted small">
        {label} du {date(live.issued_on)} pour {periodLabel({ ...live, kind: 'loyer', label: null })}. Statut : {sendLabel(live)}
        {live.sent_at && live.send_status === 'envoye' && live.tenant_emails.length ? ` à ${live.tenant_emails.join(', ')}` : ''}{live.send_error && live.send_status !== 'envoye' ? ` (${live.send_error})` : ''}.
        {live.cancelled_at && <> Annulé le {date(live.cancelled_at)} : {live.cancel_reason}.</>}
      </p>
      {cancelReason !== null && (
        <div className="row cancel-row">
          <TextInput label="Motif de la suppression" value={cancelReason} onChange={setCancelReason} maxLength={500} />
          <Button variant="danger" disabled={!cancelReason.trim()} onClick={async () => {
            if (await store.call((r) => r.cancelReceipt(live.id, cancelReason), 'Document supprimé (annulé).')) { setCancelReason(null); onClose(); }
          }}>Supprimer le document</Button>
        </div>
      )}
      {cancelReason !== null && <p className="muted small">Le document est annulé et retiré des listes ; il reste consultable dans l’historique (« Afficher les documents annulés ») pour garder une numérotation continue. Les paiements de la période redeviennent modifiables.</p>}
      {actions.ui}
      {url ? <iframe className="pdf-frame" title={`Aperçu ${label}`} src={url} /> : <p className="muted">Préparation de l’aperçu…</p>}
      <p className="muted small">Modèle établi d’après les mentions usuelles d’une quittance ; relisez-le avant le premier envoi. Il n’a pas fait l’objet d’une validation juridique.</p>
    </Modal>
  );
}

/** Boutons d'action d'une échéance : payer, confirmer, quittance, reçu. */
export function ChargeActions({ v, onPay, onConfirm, onReceipt, hideIssued = false }: {
  v: ChargeView; onPay: (v: ChargeView) => void; onConfirm: (v: ChargeView) => void; onReceipt: (r: Receipt) => void;
  /** Ne pas répéter le bouton de la quittance déjà émise (affichée dans une colonne Document). */
  hideIssued?: boolean;
}) {
  const store = useStore();
  const { quittanceFor, views } = useRental();
  const [extras, setExtras] = useState<string[] | null>(null);
  const q = quittanceFor(v.charge.id);
  if (v.charge.cancelled_at) return null;
  // rappels de charges réglés et pas encore quittancés, proposés sur la quittance d'un loyer
  const pending = v.charge.kind === 'loyer' ? views.filter((x) => x.charge.lease_id === v.charge.lease_id && x.charge.kind !== 'loyer' && x.status === 'payee' && !x.charge.cancelled_at && !quittanceFor(x.charge.id)) : [];
  const issueQuittance = async (ids: string[]) => {
    const r = await store.call((repo) => (ids.length ? repo.issueReceiptWithExtras(v.charge.id, ids) : repo.issueReceipt(v.charge.id, 'quittance')), ids.length ? 'Quittance émise avec le rappel de charges.' : 'Quittance émise.');
    setExtras(null);
    if (r) onReceipt(r);
  };
  return (
    <div className="actions">
      <Modal open={extras !== null} title="Rappel de charges" onClose={() => setExtras(null)}
        footer={<><Button onClick={() => void issueQuittance([])}>Sans rappel</Button><Button variant="primary" disabled={!extras?.length} onClick={() => void issueQuittance(extras ?? [])}>Émettre avec le rappel</Button></>}>
        <p>Des sommes réglées n’ont pas encore de quittance. Les ajouter à la quittance de {periodLabel(v.charge)} ?</p>
        {pending.map((x) => (
          <Checkbox key={x.charge.id} label={`${periodLabel(x.charge)} — ${money2(x.total)}`} checked={!!extras?.includes(x.charge.id)}
            onChange={(on) => setExtras((e) => (on ? [...(e ?? []), x.charge.id] : (e ?? []).filter((id) => id !== x.charge.id)))} />
        ))}
        <p className="muted small">Le rappel figure sur la quittance comme une ligne distincte, après le loyer et les charges du mois.</p>
      </Modal>
      {v.remaining > 0 && <Button size="sm" onClick={() => (v.charge.due_date <= todayParis() ? onConfirm(v) : onPay(v))}>{v.charge.due_date <= todayParis() ? 'Confirmer le paiement' : 'Paiement anticipé'}</Button>}
      {v.status === 'payee' && (q
        ? (hideIssued ? null : <Button size="sm" variant="ghost" onClick={() => onReceipt(q)}>Quittance {q.number}</Button>)
        : <Button size="sm" variant="primary" onClick={() => (pending.length ? setExtras(pending.map((x) => x.charge.id)) : void issueQuittance([]))}>Émettre la quittance</Button>)}
      {v.status === 'partielle' && (
        <Button size="sm" variant="ghost" onClick={async () => { const r = await store.call((repo) => repo.issueReceipt(v.charge.id, 'recu'), 'Reçu émis.'); if (r) onReceipt(r); }}>Reçu partiel</Button>
      )}
    </div>
  );
}

export function paymentAllocated(p: Payment, allocations: { payment_id: string; amount: number }[]) {
  return round2(allocations.filter((a) => a.payment_id === p.id).reduce((s, a) => s + a.amount, 0));
}

// ---------------------------------------------------------------------
// Quittances : modifier (corriger), rééditer (données actuelles), supprimer
// ---------------------------------------------------------------------
type ReceiptFields = { landlord_name: string; landlord_address: string; tenant_names: string; property_address: string; issued_on: string };

export function useReceiptActions(onDone?: (r: Receipt) => void) {
  const store = useStore();
  const [editing, setEditing] = useState<Receipt | null>(null);
  const [form, setForm] = useState<ReceiptFields | null>(null);
  const [confirm, setConfirm] = useState<Receipt | null>(null);
  const [removing, setRemoving] = useState<Receipt | null>(null);
  const [reason, setReason] = useState('');
  const edit = (r: Receipt) => {
    setEditing(r);
    setForm({ landlord_name: r.landlord_name ?? '', landlord_address: r.landlord_address ?? '', tenant_names: r.tenant_names, property_address: r.property_address ?? '', issued_on: r.issued_on });
  };
  const label = (r: Receipt) => (r.kind === 'quittance' ? 'quittance' : 'reçu');
  async function run(r: Receipt, changes: ReceiptChanges | undefined, verb: string) {
    const n = await store.call((x) => x.reissueReceipt(r.id, changes), `${r.kind === 'quittance' ? `Quittance ${verb}e` : `Reçu ${verb}`} : un nouveau numéro est attribué, l’ancien document est annulé.`);
    if (n) { setEditing(null); setConfirm(null); onDone?.(n); }
    return n;
  }
  const reissue = async (r: Receipt) => { setConfirm(r); };
  const remove = (r: Receipt) => { setRemoving(r); setReason(''); };
  const ui = (
    <>
      <Modal open={!!removing} title={removing ? `Supprimer ${removing.kind === 'quittance' ? 'la quittance' : 'le reçu'} ${removing.number}` : ''} onClose={() => setRemoving(null)}
        footer={<><Button onClick={() => setRemoving(null)}>Annuler</Button><Button variant="danger" disabled={!reason.trim()} onClick={async () => {
          if (removing && await store.call((x) => x.cancelReceipt(removing.id, reason), 'Document supprimé (annulé).')) setRemoving(null);
        }}>Supprimer le document</Button></>}>
        <p>Le document est annulé et retiré des listes ; il reste consultable dans l’historique pour garder une numérotation continue. Les paiements de la période redeviennent modifiables et une nouvelle quittance pourra être émise.</p>
        <TextInput label="Motif de la suppression" value={reason} onChange={setReason} maxLength={500} />
      </Modal>
      <Modal open={!!editing} title={editing ? `Modifier ${editing.kind === 'quittance' ? 'la quittance' : 'le reçu'} ${editing.number}` : ''} onClose={() => setEditing(null)}
        footer={<><Button onClick={() => setEditing(null)}>Annuler</Button><Button variant="primary" disabled={!form?.tenant_names.trim()} onClick={() => {
          if (!editing || !form) return;
          void run(editing, {
            landlord_name: form.landlord_name, landlord_address: form.landlord_address, tenant_names: form.tenant_names,
            property_address: form.property_address, issued_on: form.issued_on || undefined,
          }, 'modifié');
        }}>Enregistrer la correction</Button></>}>
        {form && editing && <>
          <p className="muted small">Une {label(editing)} émise n’est jamais modifiée en place : la version corrigée reçoit un nouveau numéro et l’ancienne est annulée (elle reste dans l’historique). Montants et paiements viennent des échéances : pour les corriger, modifiez le paiement.</p>
          <div className="grid">
            <TextInput label="Nom du bailleur" value={form.landlord_name} onChange={(v) => setForm({ ...form, landlord_name: v })} maxLength={200} />
            <TextInput label="Date d’émission" type="date" value={form.issued_on} onChange={(v) => setForm({ ...form, issued_on: v })} />
            <TextInput label="Adresse du bailleur" wide value={form.landlord_address} onChange={(v) => setForm({ ...form, landlord_address: v })} maxLength={500} />
            <TextInput label="Locataire(s)" wide value={form.tenant_names} onChange={(v) => setForm({ ...form, tenant_names: v })} maxLength={500} />
            <TextInput label="Adresse du logement" wide value={form.property_address} onChange={(v) => setForm({ ...form, property_address: v })} maxLength={500} />
          </div>
        </>}
      </Modal>
      <Modal open={!!confirm} title={confirm ? `Rééditer ${confirm.kind === 'quittance' ? 'la quittance' : 'le reçu'} ${confirm.number}` : ''} onClose={() => setConfirm(null)}
        footer={<><Button onClick={() => setConfirm(null)}>Annuler</Button><Button variant="primary" onClick={() => { if (confirm) void run(confirm, undefined, 'réédité'); }}>Rééditer</Button></>}>
        <p>Le document est émis de nouveau avec les informations actuelles du bail, du bien, des locataires et des paiements (utile après une correction). Il reçoit un nouveau numéro ; l’ancien est annulé et reste dans l’historique.</p>
        {confirm?.send_status === 'envoye' && <p className="muted small">L’ancien document avait été envoyé au locataire : pensez à lui envoyer la nouvelle version.</p>}
      </Modal>
    </>
  );
  return { edit, reissue, remove, ui };
}

// ---------------------------------------------------------------------
// Paiements : modifier, supprimer (avec les quittances concernées)
// ---------------------------------------------------------------------
type Store = ReturnType<typeof useStore>;
type Ledger = Pick<Snapshot, 'allocations' | 'receipts' | 'charges'>;
export interface PaymentFields { amount: number; paid_on: string; method: PaymentMethod; reference: string | null; comment: string | null; period_month?: string | null }

/** Quittances et reçus valables couvrant une échéance réglée par ce paiement. */
export function receiptsCovering(p: Payment, d: Ledger) {
  const ids = new Set(d.allocations.filter((a) => a.payment_id === p.id).map((a) => a.charge_id));
  return d.receipts.filter((r) => !r.cancelled_at && (ids.has(r.charge_id) || (r.extra_lines ?? []).some((x) => ids.has(x.charge_id))));
}

/** Mois à retenir après modification d'un paiement : un mois choisi à la main est conservé, sinon celui de la nouvelle date. */
export function editedMonth(p: Pick<Payment, 'paid_on' | 'period_month'>, newDate: string, chosen?: string | null): string {
  if (chosen) return `${chosen.slice(0, 7)}-01`;
  const manual = p.period_month && p.period_month.slice(0, 7) !== p.paid_on.slice(0, 7);
  return manual ? p.period_month! : `${newDate.slice(0, 7)}-01`;
}

/**
 * Modification d'un paiement, à partir des données à jour `d` : montant, date ou mois modifiés → documents concernés
 * annulés, paiement mis à jour, lignes remises en conformité, quittances (ou reçus) réémises si le mois reste réglé ;
 * moyen ou référence seuls → documents réédités. Renvoie le message de résultat, ou null si l'enregistrement a échoué.
 */
export async function applyPaymentEdit(store: Store, d: Ledger, p: Payment, f: PaymentFields): Promise<string | null> {
  const covered = receiptsCovering(p, d);
  const month = editedMonth(p, f.paid_on, f.period_month);
  const patch = { amount: round2(f.amount), paid_on: f.paid_on, period_month: month, method: f.method, reference: f.reference?.trim() || null, comment: f.comment?.trim() || null, date_defaulted: false };
  const moved = round2(f.amount) !== p.amount || f.paid_on !== p.paid_on || month !== (p.period_month ?? `${p.paid_on.slice(0, 7)}-01`);
  const res = await store.call(async (repo) => {
    if (moved) for (const r of covered) await repo.cancelReceipt(r.id, 'Paiement modifié');
    if (moved) await repo.removeWhere('payment_allocations', { payment_id: p.id });
    const cur = (await repo.loadAll()).payments.find((x) => x.id === p.id);
    if (!cur) throw new RepoError('Paiement introuvable : rechargez la page.');
    const u = await repo.update('payments', p.id, cur.version, patch);
    if (u.status !== 'ok') throw new RepoError('Le paiement a été modifié entre-temps : rechargez la page.');
    await syncLedgerWith(repo, { leaseIds: [p.lease_id] });
    if (!moved) { let n = 0; if (patch.method !== p.method || patch.reference !== p.reference) for (const r of covered) { await repo.reissueReceipt(r.id); n++; } return { n, reissued: 0 }; }
    // documents réémis pour les mois qui restent réglés (ou partiellement réglés pour un reçu)
    const months = [...new Map(covered.map((r) => [`${r.lease_id}|${r.period_start.slice(0, 7)}`, { lease_id: r.lease_id, month: r.period_start.slice(0, 7), kind: r.kind }])).values()];
    const out = await issueMonthDocs(repo, months);
    return { n: 0, reissued: out.q + out.r };
  });
  if (!res) return null;
  if (!moved) return res.n ? `Paiement modifié, ${res.n} document(s) réédité(s).` : 'Paiement modifié.';
  return covered.length
    ? `Paiement modifié. ${covered.length} document(s) annulé(s)${res.reissued ? `, ${res.reissued} réémis` : ''}${res.reissued < covered.length ? ' ; émettez un nouveau document depuis la ligne du mois si besoin' : ''}.`
    : `Paiement modifié (${monthLabel(month)}).`;
}

/** Suppression de paiements : documents qui les couvrent annulés, lignes remises en conformité. Renvoie le nombre supprimé. */
export async function removePayments(store: Store, d: Ledger, list: Payment[]): Promise<number> {
  const res = await store.call(async (repo) => {
    let n = 0;
    const cancelled = new Set<string>();
    for (const p of list) {
      for (const r of receiptsCovering(p, d)) {
        if (cancelled.has(r.id)) continue;
        await repo.cancelReceipt(r.id, 'Paiement supprimé');
        cancelled.add(r.id);
      }
      await repo.remove('payments', p.id);
      n++;
    }
    await syncLedgerWith(repo, { leaseIds: [...new Set(list.map((p) => p.lease_id))] });
    return n;
  });
  return res ?? 0;
}

export function usePaymentActions() {
  const store = useStore();
  const { data } = store;
  const [editing, setEditing] = useState<Payment | null>(null);
  const [f, setF] = useState<{ amount: number | null; paid_on: string; method: PaymentMethod; reference: string; comment: string; month: string | null } | null>(null);
  const [removing, setRemoving] = useState<Payment[] | null>(null);
  const done = useRef<(() => void) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const coveredBy = (p: Payment) => receiptsCovering(p, data);
  const numbers = (rs: Receipt[]) => [...new Set(rs.map((r) => r.number))].join(', ');
  const edit = (p: Payment) => {
    setEditing(p); setError(null);
    setF({ amount: p.amount, paid_on: p.paid_on, method: p.method, reference: p.reference ?? '', comment: p.comment ?? '', month: null });
  };

  async function save() {
    if (!editing || !f) return;
    if (!f.amount || !(f.amount > 0)) { setError('Indiquez un montant positif.'); return; }
    if (!f.paid_on) { setError('Indiquez la date de réception.'); return; }
    setBusy(true); setError(null);
    try {
      const msg = await applyPaymentEdit(store, data, editing, { ...f, amount: f.amount, period_month: f.month });
      if (msg) { store.notify(msg); setEditing(null); }
    } finally { setBusy(false); }
  }

  async function confirmRemove() {
    if (!removing) return;
    setBusy(true);
    try {
      const n = await removePayments(store, data, removing);
      if (n) store.notify(n > 1 ? `${n} paiements supprimés.` : 'Paiement supprimé.');
      if (n === removing.length) done.current?.();
      setRemoving(null);
    } finally { setBusy(false); }
  }

  const removingCovered = removing ? removing.flatMap(coveredBy) : [];
  const total = removing ? round2(removing.reduce((s, p) => s + p.amount, 0)) : 0;
  const ui = (
    <>
      <Modal open={!!editing} title="Modifier le paiement" onClose={() => setEditing(null)}
        footer={<><Button onClick={() => setEditing(null)}>Annuler</Button><Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Enregistrement…' : 'Enregistrer'}</Button></>}>
        {f && editing && <>
          <div className="grid">
            <NumberInput label="Montant reçu" suffix="€" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
            <TextInput label="Date de réception" type="date" value={f.paid_on} onChange={(v) => setF({ ...f, paid_on: v })} />
            <TextInput label="Mois concerné" type="month" value={(f.month ?? editedMonth(editing, f.paid_on)).slice(0, 7)} onChange={(v) => setF({ ...f, month: v || null })} />
            <Select label="Moyen de paiement" value={f.method} onChange={(v) => setF({ ...f, method: v ?? 'virement' })} options={METHODS} />
            <TextInput label="Référence" value={f.reference} onChange={(v) => setF({ ...f, reference: v })} maxLength={200} />
            <TextInput label="Commentaire" wide value={f.comment} onChange={(v) => setF({ ...f, comment: v })} maxLength={2000} />
          </div>
          {coveredBy(editing).length > 0 && <p className="note">Ce paiement figure sur {coveredBy(editing).length > 1 ? 'les documents' : 'le document'} n° {numbers(coveredBy(editing))}. Si le montant, la date ou le moyen change, {coveredBy(editing).length > 1 ? 'ils seront annulés et réédités' : 'il sera annulé et réédité'} automatiquement.</p>}
          <p className="muted small">Le paiement est rattaché au mois choisi (par défaut, celui de sa date) et ne règle que les sommes de ce mois.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
        </>}
      </Modal>
      <Modal open={!!removing} title={removing && removing.length > 1 ? `Supprimer ${removing.length} paiements` : 'Supprimer le paiement'} onClose={() => setRemoving(null)}
        footer={<><Button onClick={() => setRemoving(null)}>Annuler</Button><Button variant="danger" disabled={busy} onClick={() => void confirmRemove()}>{busy ? 'Suppression…' : 'Supprimer'}</Button></>}>
        {removing && <>
          <p>{removing.length === 1
            ? <>Le paiement de {money2(removing[0]!.amount)} du {date(removing[0]!.paid_on)} sera supprimé ; le mois concerné redevient dû.</>
            : <>{removing.length} paiements ({money2(total)} au total) seront supprimés ; les mois concernés redeviennent dus.</>}</p>
          {removingCovered.length > 0 && <p className="note">{removingCovered.length > 1 ? 'Les documents' : 'Le document'} n° {numbers(removingCovered)} {removingCovered.length > 1 ? 'seront annulés' : 'sera annulé'} (conservé{removingCovered.length > 1 ? 's' : ''} dans l’historique).</p>}
        </>}
      </Modal>
    </>
  );
  return {
    edit,
    remove: (p: Payment) => { done.current = null; setRemoving([p]); },
    /** Suppression de plusieurs paiements ; `then` est appelé si tous ont été supprimés. */
    removeMany: (list: Payment[], then?: () => void) => { done.current = then ?? null; setRemoving(list); },
    ui,
  };
}
