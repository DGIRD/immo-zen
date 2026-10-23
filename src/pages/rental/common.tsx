import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../data/store.tsx';
import type { Lease, Payment, PaymentMethod, Receipt, RentCharge } from '../../data/types.ts';
import type { ReceiptChanges } from '../../data/repo.ts';
import { date, dateTime, money2, todayParis } from '../../domain/format.ts';
import {
  autoAllocate, CHARGE_STATUS_LABELS, chargeViews, checkAllocation, leaseState, leaseTenants, LEASE_STATE_LABELS, monthLabel,
  PAYMENT_METHOD_LABELS, tenantName, type ChargeStatus, type ChargeView, type LeaseState,
} from '../../domain/rental.ts';
import { round2 } from '../../domain/simulator.ts';
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

const STATUS_TONE: Record<ChargeStatus, string> = { payee: 'won', partielle: 'hot', impayee: 'bad', a_venir: 'early', annulee: 'closed' };
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
// Enregistrer un paiement (avec répartition sur les échéances)
// ---------------------------------------------------------------------
export function PaymentDialog({ open, onClose, leaseId, chargeId, mode = 'saisie' }: {
  open: boolean; onClose: () => void; leaseId?: string; chargeId?: string; mode?: 'saisie' | 'confirmation';
}) {
  const store = useStore();
  const { data } = store;
  const { views, leaseLabel, today } = useRental();
  const [lease, setLease] = useState<string>(leaseId ?? '');
  const [amount, setAmount] = useState<number | null>(null);
  const [paidOn, setPaidOn] = useState(today);
  const [dateTouched, setDateTouched] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('virement');
  const [reference, setReference] = useState('');
  const [comment, setComment] = useState('');
  const [manual, setManual] = useState<Record<string, number | null> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open_ = useMemo(() => views.filter((v) => v.charge.lease_id === lease && v.remaining > 0 && !v.charge.cancelled_at), [views, lease]);
  const target = chargeId ? open_.find((v) => v.charge.id === chargeId) : undefined;

  useEffect(() => {
    if (!open) return;
    setLease(leaseId ?? (data.leases.length === 1 ? data.leases[0]!.id : ''));
    setPaidOn(today); setDateTouched(false); setMethod('virement'); setReference(''); setComment(''); setManual(null); setError(null);
    const v = chargeId ? views.find((x) => x.charge.id === chargeId) : undefined;
    setAmount(v ? v.remaining : null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const auto = useMemo(() => {
    if (!amount || !(amount > 0)) return { allocations: [], remainder: 0 };
    // une échéance ciblée est servie en premier
    const ordered = target ? [target, ...open_.filter((v) => v !== target)] : open_;
    if (target) {
      const first = Math.min(amount, target.remaining);
      const rest = autoAllocate(round2(amount - first), open_.filter((v) => v !== target));
      return { allocations: [{ charge_id: target.charge.id, amount: round2(first) }, ...rest.allocations], remainder: rest.remainder };
    }
    return autoAllocate(amount, ordered);
  }, [amount, open_, target]);

  const plan = manual
    ? Object.entries(manual).filter(([, a]) => a && a > 0).map(([charge_id, a]) => ({ charge_id, amount: round2(a!) }))
    : auto.allocations;
  const allocatedSum = round2(plan.reduce((s, a) => s + a.amount, 0));
  const remainder = amount ? round2(amount - allocatedSum) : 0;

  async function save() {
    setError(null);
    if (!lease) { setError('Choisissez le bail.'); return; }
    if (!amount || !(amount > 0)) { setError('Indiquez un montant positif.'); return; }
    if (!paidOn) { setError('Indiquez la date de réception.'); return; }
    const err = checkAllocation(amount, plan, open_);
    if (err) { setError(err); return; }
    setBusy(true);
    try {
      const p = await store.create('payments', {
        lease_id: lease, amount: round2(amount), paid_on: paidOn, method, reference: reference || null, comment: comment || null,
        source: mode === 'confirmation' ? 'confirmation' : 'saisie', date_defaulted: mode === 'confirmation' && !dateTouched,
      });
      if (!p) return;
      if (plan.length) {
        const ok = await store.createMany('payment_allocations', plan.map((a) => ({ payment_id: p.id, charge_id: a.charge_id, amount: a.amount })));
        if (!ok) { setError('Paiement enregistré, mais sa répartition a été refusée : reprenez-la depuis le bail.'); return; }
      }
      await store.refresh();
      store.notify(mode === 'confirmation' ? 'Paiement confirmé.' : 'Paiement enregistré.');
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const activeLeases = data.leases.filter((l) => leaseState(l, today) !== 'a_venir' || l.id === leaseId);
  const title = mode === 'confirmation' ? 'Confirmer un paiement reçu' : 'Enregistrer un paiement';

  return (
    <Modal open={open} title={title} onClose={onClose} wide
      footer={<><Button onClick={onClose}>Annuler</Button><Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Enregistrement…' : mode === 'confirmation' ? 'Confirmer le paiement' : 'Enregistrer le paiement'}</Button></>}>
      {mode === 'confirmation' && target && (
        <p className="note">Échéance de {periodLabel(target.charge)} : {money2(target.total)} dus le {date(target.charge.due_date)}, reste {money2(target.remaining)}. Seul un paiement que vous confirmez ici est enregistré : sans confirmation, le loyer reste impayé.</p>
      )}
      <div className="grid">
        {!leaseId && (
          <Select label="Bail" wide value={lease || null} onChange={(v) => { setLease(v ?? ''); setManual(null); }} allowEmpty="Choisir…"
            options={activeLeases.map((l) => [l.id, leaseLabel(l)] as const)} />
        )}
        <NumberInput label="Montant reçu" suffix="€" value={amount} onChange={(v) => { setAmount(v); setManual(null); }} />
        <Field2 label="Date de réception" hint={mode === 'confirmation' && !dateTouched ? 'Date du jour proposée par défaut : modifiez-la si vous la connaissez.' : undefined}>
          {(id) => <input id={id} type="date" value={paidOn} max={today} onChange={(e) => { setPaidOn(e.target.value); setDateTouched(true); }} />}
        </Field2>
        <Select label="Moyen de paiement" value={method} onChange={(v) => setMethod(v ?? 'virement')} options={METHODS} />
        <TextInput label="Référence" value={reference} onChange={setReference} maxLength={200} placeholder="N° de chèque, libellé du virement…" />
        <TextInput label="Commentaire" wide value={comment} onChange={setComment} maxLength={2000} />
      </div>

      {lease && (
        <div className="alloc">
          <div className="section-head">
            <h3>Répartition sur les échéances</h3>
            {manual ? <Button size="sm" variant="ghost" onClick={() => setManual(null)}>Répartition automatique</Button>
              : <Button size="sm" variant="ghost" disabled={!open_.length} onClick={() => setManual(Object.fromEntries(open_.map((v) => [v.charge.id, auto.allocations.find((a) => a.charge_id === v.charge.id)?.amount ?? null])))}>Répartir à la main</Button>}
          </div>
          {open_.length === 0 ? <p className="muted small">Aucune échéance ouverte : le montant sera conservé comme avance du locataire.</p> : (
            <table className="dt-table compact">
              <thead><tr><th>Échéance</th><th className="num">Reste dû</th><th className="num">Affecté</th></tr></thead>
              <tbody>
                {open_.map((v) => {
                  const a = plan.find((x) => x.charge_id === v.charge.id)?.amount ?? 0;
                  return (
                    <tr key={v.charge.id}>
                      <td>{periodLabel(v.charge)} <span className="muted small">dû le {date(v.charge.due_date)}</span></td>
                      <td className="num">{money2(v.remaining)}</td>
                      <td className="num">{manual ? (
                        <input className="alloc-input" aria-label={`Montant affecté à ${periodLabel(v.charge)}`} inputMode="decimal" value={manual[v.charge.id] ?? ''}
                          onChange={(e) => { const t = e.target.value.replace(',', '.').trim(); setManual({ ...manual, [v.charge.id]: t === '' ? null : Number(t) }); }} />
                      ) : money2(a)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {remainder > 0 && <p className="small">Non affecté : <strong>{money2(remainder)}</strong>, conservé comme avance (trop-perçu) au crédit du locataire.</p>}
          {remainder < 0 && <p className="form-error small">La répartition dépasse le montant reçu de {money2(-remainder)}.</p>}
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
      {(live.extra_lines ?? []).length > 0 && <p className="note">Rappel de charges inclus : {live.extra_lines!.map((x) => `${x.label} (${money2(x.amount)})`).join(', ')}.</p>}
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
export function ChargeActions({ v, onPay, onConfirm, onReceipt }: {
  v: ChargeView; onPay: (v: ChargeView) => void; onConfirm: (v: ChargeView) => void; onReceipt: (r: Receipt) => void;
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
        ? <Button size="sm" variant="ghost" onClick={() => onReceipt(q)}>Quittance {q.number}</Button>
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
export function usePaymentActions() {
  const store = useStore();
  const { data } = store;
  const { views } = useRental();
  const [editing, setEditing] = useState<Payment | null>(null);
  const [f, setF] = useState<{ amount: number | null; paid_on: string; method: PaymentMethod; reference: string; comment: string } | null>(null);
  const [removing, setRemoving] = useState<Payment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Quittances et reçus valables couvrant une échéance réglée par ce paiement. */
  const coveredBy = (p: Payment) => {
    const ids = new Set(data.allocations.filter((a) => a.payment_id === p.id).map((a) => a.charge_id));
    return data.receipts.filter((r) => !r.cancelled_at && (ids.has(r.charge_id) || (r.extra_lines ?? []).some((x) => ids.has(x.charge_id))));
  };
  const numbers = (rs: Receipt[]) => rs.map((r) => r.number).join(', ');
  const edit = (p: Payment) => {
    setEditing(p); setError(null);
    setF({ amount: p.amount, paid_on: p.paid_on, method: p.method, reference: p.reference ?? '', comment: p.comment ?? '' });
  };

  async function save() {
    if (!editing || !f) return;
    if (!f.amount || !(f.amount > 0)) { setError('Indiquez un montant positif.'); return; }
    if (!f.paid_on) { setError('Indiquez la date de réception.'); return; }
    setBusy(true); setError(null);
    try {
      const p = editing;
      const covered = coveredBy(p);
      const old = data.allocations.filter((a) => a.payment_id === p.id);
      const patch = { amount: round2(f.amount), paid_on: f.paid_on, method: f.method, reference: f.reference.trim() || null, comment: f.comment.trim() || null, date_defaulted: false };
      if (round2(f.amount) !== p.amount) {
        // montant modifié : quittances concernées annulées, répartition refaite, quittances rééditées si la période reste réglée
        for (const r of covered) if ((await store.call((x) => x.cancelReceipt(r.id, 'Paiement modifié'))) === null) return;
        if (old.length && !(await store.removeWhere('payment_allocations', { payment_id: p.id }))) return;
        const row = await store.update('payments', p, patch, 'Le paiement');
        if (!row) return;
        const freed = new Map(old.map((a) => [a.charge_id, a.amount]));
        const open = views.filter((v) => v.charge.lease_id === p.lease_id && !v.charge.cancelled_at)
          .map((v) => ({ ...v, remaining: round2(v.remaining + (freed.get(v.charge.id) ?? 0)) }))
          .filter((v) => v.remaining > 0);
        // les échéances réglées auparavant par ce paiement sont servies en premier
        const first = autoAllocate(round2(f.amount), open.filter((v) => freed.has(v.charge.id)));
        const rest = autoAllocate(first.remainder, open.filter((v) => !freed.has(v.charge.id)));
        const plan = [...first.allocations, ...rest.allocations];
        if (plan.length && !(await store.createMany('payment_allocations', plan.map((a) => ({ payment_id: p.id, ...a }))))) return;
        let reissued = 0;
        for (const r of covered) {
          const v = open.find((x) => x.charge.id === r.charge_id);
          const paidNow = plan.filter((a) => a.charge_id === r.charge_id).reduce((s, a) => s + a.amount, 0);
          const extras = (r.extra_lines ?? []).map((x) => x.charge_id);
          if (r.kind === 'quittance' && v && round2(paidNow) >= v.remaining) {
            const n = await store.call((x) => (extras.length ? x.issueReceiptWithExtras(r.charge_id, extras) : x.issueReceipt(r.charge_id, 'quittance')));
            if (n) reissued++;
          }
        }
        store.notify(covered.length
          ? `Paiement modifié. ${covered.length} document(s) annulé(s)${reissued ? `, ${reissued} quittance(s) rééditée(s)` : ''}${reissued < covered.length ? ' ; émettez un nouveau document depuis l’échéance si besoin' : ''}.`
          : 'Paiement modifié et réparti de nouveau.');
      } else {
        const row = await store.update('payments', p, patch, 'Le paiement');
        if (!row) return;
        // date ou moyen de paiement corrigés : les quittances qui les mentionnent sont rééditées
        let n = 0;
        if (patch.paid_on !== p.paid_on || patch.method !== p.method) for (const r of covered) if (await store.call((x) => x.reissueReceipt(r.id))) n++;
        store.notify(n ? `Paiement modifié, ${n} document(s) réédité(s).` : 'Paiement modifié.');
      }
      setEditing(null);
    } finally { setBusy(false); }
  }

  async function confirmRemove() {
    if (!removing) return;
    setBusy(true);
    try {
      for (const r of coveredBy(removing)) if ((await store.call((x) => x.cancelReceipt(r.id, 'Paiement supprimé'))) === null) return;
      if (await store.remove('payments', removing.id)) store.notify('Paiement supprimé.');
      setRemoving(null);
    } finally { setBusy(false); }
  }

  const ui = (
    <>
      <Modal open={!!editing} title="Modifier le paiement" onClose={() => setEditing(null)}
        footer={<><Button onClick={() => setEditing(null)}>Annuler</Button><Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Enregistrement…' : 'Enregistrer'}</Button></>}>
        {f && editing && <>
          <div className="grid">
            <NumberInput label="Montant reçu" suffix="€" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
            <TextInput label="Date de réception" type="date" value={f.paid_on} onChange={(v) => setF({ ...f, paid_on: v })} />
            <Select label="Moyen de paiement" value={f.method} onChange={(v) => setF({ ...f, method: v ?? 'virement' })} options={METHODS} />
            <TextInput label="Référence" value={f.reference} onChange={(v) => setF({ ...f, reference: v })} maxLength={200} />
            <TextInput label="Commentaire" wide value={f.comment} onChange={(v) => setF({ ...f, comment: v })} maxLength={2000} />
          </div>
          {coveredBy(editing).length > 0 && <p className="note">Ce paiement figure sur {coveredBy(editing).length > 1 ? 'les documents' : 'le document'} n° {numbers(coveredBy(editing))}. Si le montant, la date ou le moyen change, {coveredBy(editing).length > 1 ? 'ils seront annulés et réédités' : 'il sera annulé et réédité'} automatiquement.</p>}
          {round2(f.amount ?? 0) !== editing.amount && <p className="muted small">Le montant change : la répartition sur les échéances est refaite (échéances réglées par ce paiement d’abord, puis les plus anciennes impayées).</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
        </>}
      </Modal>
      <Modal open={!!removing} title="Supprimer le paiement" onClose={() => setRemoving(null)}
        footer={<><Button onClick={() => setRemoving(null)}>Annuler</Button><Button variant="danger" disabled={busy} onClick={() => void confirmRemove()}>Supprimer</Button></>}>
        {removing && <>
          <p>Le paiement de {money2(removing.amount)} du {date(removing.paid_on)} et sa répartition seront supprimés ; les échéances concernées redeviennent dues.</p>
          {coveredBy(removing).length > 0 && <p className="note">{coveredBy(removing).length > 1 ? 'Les documents' : 'Le document'} n° {numbers(coveredBy(removing))} {coveredBy(removing).length > 1 ? 'seront annulés' : 'sera annulé'} (conservé{coveredBy(removing).length > 1 ? 's' : ''} dans l’historique).</p>}
        </>}
      </Modal>
    </>
  );
  return { edit, remove: (p: Payment) => setRemoving(p), ui };
}

/** Liste des quittances et reçus : documents annulés masqués par défaut ; ouvrir, modifier, rééditer. */
export function ReceiptsTable({ receipts, onOpen, leaseLabelOf }: { receipts: Receipt[]; onOpen: (r: Receipt) => void; leaseLabelOf?: (leaseId: string) => string }) {
  const [showCancelled, setShowCancelled] = useState(false);
  const actions = useReceiptActions(onOpen);
  const cancelled = receipts.filter((r) => r.cancelled_at).length;
  const rows = receipts.filter((r) => showCancelled || !r.cancelled_at);
  return (
    <>
      {cancelled > 0 && <Checkbox label={`Afficher les documents annulés ou remplacés (${cancelled})`} checked={showCancelled} onChange={setShowCancelled} />}
      {rows.length === 0 ? <p className="muted">Aucun document. Une quittance s’émet depuis une échéance intégralement réglée ; un reçu depuis une échéance partiellement réglée.</p> : (
        <div className="dt-scroll"><table className="dt-table receipts-table">
          <thead><tr><th>N°</th><th>Type</th>{leaseLabelOf && <th>Bail</th>}<th>Période</th><th>Émis le</th><th className="num">Montant</th><th>Envoi</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className={r.cancelled_at ? 'muted' : ''}>
              <td>{r.number}</td><td>{r.kind === 'quittance' ? 'Quittance' : 'Reçu partiel'}</td>{leaseLabelOf && <td>{leaseLabelOf(r.lease_id)}</td>}
              <td>{monthLabel(r.period_start)}</td><td>{date(r.issued_on)}</td>
              <td className="num">{money2(r.paid_amount)}</td><td>{r.cancelled_at ? <span title={r.cancel_reason ?? undefined}>{r.cancel_reason?.startsWith('Remplacé') ? r.cancel_reason : 'Annulé'}</span> : sendLabel(r)}</td>
              <td><div className="row">
                <Button size="sm" onClick={() => onOpen(r)}>Ouvrir</Button>
                {!r.cancelled_at && <Button size="sm" variant="ghost" onClick={() => actions.edit(r)}>Modifier</Button>}
                {!r.cancelled_at && <Button size="sm" variant="ghost" onClick={() => void actions.reissue(r)}>Rééditer</Button>}
                {!r.cancelled_at && <Button size="sm" variant="ghost" onClick={() => actions.remove(r)}>Supprimer</Button>}
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {actions.ui}
    </>
  );
}
