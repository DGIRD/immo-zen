import { useState } from 'react';
import { useStore } from '../../data/store.tsx';
import { RepoError, type Repo } from '../../data/repo.ts';
import type { Receipt, RentCharge } from '../../data/types.ts';
import { date, money2 } from '../../domain/format.ts';
import { alignToPaid, chargePaymentRemoval, type ChargeView } from '../../domain/rental.ts';
import { round2 } from '../../domain/simulator.ts';
import { Button, Checkbox, Modal, NumberInput, TextInput } from '../../ui/components.tsx';
import { periodLabel } from './common.tsx';

/** Documents valables (quittance ou reçu) qui couvrent une échéance. */
export function documentsFor(chargeId: string, receipts: Receipt[]): Receipt[] {
  return receipts.filter((r) => !r.cancelled_at && (r.charge_id === chargeId || (r.extra_lines ?? []).some((x) => x.charge_id === chargeId)));
}

/** Mise à jour d'une échéance à partir de sa version la plus récente. */
async function updateCharge(repo: Repo, id: string, patch: Partial<RentCharge>): Promise<RentCharge> {
  const snap = await repo.loadAll();
  const c = snap.charges.find((x) => x.id === id);
  if (!c) throw new RepoError('Échéance introuvable : rechargez la page.');
  const res = await repo.update('rent_charges', id, c.version, patch);
  if (res.status !== 'ok') throw new RepoError('L’échéance a été modifiée entre-temps : rechargez la page et recommencez.');
  return res.row;
}

/**
 * Réémet, après une modification, le document d'une échéance annulé pendant l'opération :
 * quittance si l'échéance est désormais intégralement réglée, reçu partiel si elle l'était déjà.
 */
async function reissueAfter(repo: Repo, chargeId: string, old: Receipt[]): Promise<number> {
  const snap = await repo.loadAll();
  const c = snap.charges.find((x) => x.id === chargeId);
  if (!c || c.cancelled_at) return 0;
  const paid = round2(snap.allocations.filter((a) => a.charge_id === chargeId).reduce((s, a) => s + a.amount, 0));
  const total = round2(c.rent_amount + c.charges_amount);
  const own = old.find((r) => r.charge_id === chargeId);
  if (paid >= total && total > 0 && c.kind === 'loyer') {
    const extras = (own?.extra_lines ?? []).map((x) => x.charge_id);
    await (extras.length ? repo.issueReceiptWithExtras(chargeId, extras) : repo.issueReceipt(chargeId, 'quittance'));
    return 1;
  }
  if (paid > 0 && own?.kind === 'recu') { await repo.issueReceipt(chargeId, 'recu'); return 1; }
  return 0;
}

type EditForm = { due_date: string; rent_amount: number | null; charges_amount: number | null; label: string };

/**
 * Actions sur une échéance : modifier (date, montants, libellé), annuler le paiement,
 * annuler l'échéance, réactiver une échéance annulée.
 */
export function useChargeEditing() {
  const store = useStore();
  const { data } = store;
  const [editing, setEditing] = useState<ChargeView | null>(null);
  const [form, setForm] = useState<EditForm | null>(null);
  const [unpaying, setUnpaying] = useState<ChargeView | null>(null);
  const [cancelling, setCancelling] = useState<{ v: ChargeView; reason: string; withPayments: boolean } | null>(null);
  const [restoring, setRestoring] = useState<ChargeView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const docsOf = (v: ChargeView) => documentsFor(v.charge.id, data.receipts);
  const numbers = (rs: Receipt[]) => rs.map((r) => r.number).join(', ');

  const edit = (v: ChargeView) => {
    setError(null); setEditing(v);
    setForm({ due_date: v.charge.due_date, rent_amount: v.charge.rent_amount, charges_amount: v.charge.charges_amount, label: v.charge.label ?? '' });
  };

  async function saveEdit() {
    if (!editing || !form) return;
    const rent = round2(form.rent_amount ?? 0), charges = round2(form.charges_amount ?? 0);
    if (!form.due_date) { setError('Indiquez la date d’échéance.'); return; }
    if (rent < 0 || charges < 0) { setError('Les montants doivent être positifs ou nuls.'); return; }
    const total = round2(rent + charges);
    if (total < editing.paid) {
      setError(`Le montant dû (${money2(total)}) est inférieur à ce qui est déjà réglé (${money2(editing.paid)}) : utilisez « Aligner sur le montant payé » ou annulez d’abord le paiement.`);
      return;
    }
    const docs = docsOf(editing);
    const amountChanged = rent !== editing.charge.rent_amount || charges !== editing.charge.charges_amount;
    setBusy(true); setError(null);
    try {
      const ok = await store.call(async (repo) => {
        // un document émis n'est jamais modifié en place : il est annulé puis réémis sur les nouveaux montants
        if (amountChanged) for (const r of docs) await repo.cancelReceipt(r.id, 'Échéance modifiée');
        await updateCharge(repo, editing.charge.id, {
          due_date: form.due_date, rent_amount: rent, charges_amount: charges,
          ...(editing.charge.kind !== 'loyer' ? { label: form.label.trim() || null } : {}),
        });
        const n = amountChanged && docs.length ? await reissueAfter(repo, editing.charge.id, docs) : 0;
        return { n };
      });
      if (ok) {
        store.notify(`Échéance de ${periodLabel(editing.charge)} modifiée.${amountChanged && docs.length ? ` Document${docs.length > 1 ? 's' : ''} n° ${numbers(docs)} annulé${docs.length > 1 ? 's' : ''}${ok.n ? ', nouveau document émis' : ''}.` : ''}`);
        setEditing(null);
      } else await store.refresh();
    } finally { setBusy(false); }
  }

  /** Retire les paiements d'une échéance (documents annulés d'abord). Renvoie false en cas d'échec. */
  async function removePaymentsOf(repo: Repo, v: ChargeView) {
    const snap = await repo.loadAll();
    const plan = chargePaymentRemoval(v.charge.id, snap.payments, snap.allocations);
    const ids = new Set([v.charge.id, ...plan.remove.flatMap((p) => snap.allocations.filter((a) => a.payment_id === p.id).map((a) => a.charge_id))]);
    for (const r of snap.receipts.filter((r) => !r.cancelled_at && (ids.has(r.charge_id) || (r.extra_lines ?? []).some((x) => ids.has(x.charge_id))))) {
      await repo.cancelReceipt(r.id, 'Paiement annulé');
    }
    for (const a of plan.detach) await repo.remove('payment_allocations', a.id);
    for (const p of plan.remove) await repo.remove('payments', p.id);
    return plan;
  }

  async function confirmUnpay() {
    if (!unpaying) return;
    setBusy(true);
    try {
      const plan = await store.call((repo) => removePaymentsOf(repo, unpaying));
      if (plan) {
        const parts = [plan.remove.length && `${plan.remove.length} paiement${plan.remove.length > 1 ? 's' : ''} supprimé${plan.remove.length > 1 ? 's' : ''}`,
          plan.detach.length && `${plan.detach.length} paiement${plan.detach.length > 1 ? 's' : ''} détaché${plan.detach.length > 1 ? 's' : ''} (montant gardé en avance)`].filter(Boolean).join(', ');
        store.notify(`Paiement de ${periodLabel(unpaying.charge)} annulé : ${parts}. L’échéance est de nouveau due.`);
        setUnpaying(null);
      } else await store.refresh();
    } finally { setBusy(false); }
  }

  async function confirmCancel() {
    if (!cancelling) return;
    const { v, reason, withPayments } = cancelling;
    setBusy(true);
    try {
      const ok = await store.call(async (repo) => {
        if (v.paid > 0) {
          if (!withPayments) throw new RepoError('Cette échéance a reçu des paiements : cochez « Annuler aussi le paiement ».');
          await removePaymentsOf(repo, v);
        } else for (const r of documentsFor(v.charge.id, (await repo.loadAll()).receipts)) await repo.cancelReceipt(r.id, 'Échéance annulée');
        await updateCharge(repo, v.charge.id, { cancelled_at: new Date().toISOString(), cancel_reason: reason.trim().slice(0, 500) });
        return true;
      }, `Échéance de ${periodLabel(v.charge)} annulée : elle n’est plus due.`);
      if (ok) setCancelling(null); else await store.refresh();
    } finally { setBusy(false); }
  }

  async function confirmRestore() {
    if (!restoring) return;
    setBusy(true);
    try {
      const ok = await store.call((repo) => updateCharge(repo, restoring.charge.id, { cancelled_at: null, cancel_reason: null }),
        `Échéance de ${periodLabel(restoring.charge)} réactivée : elle est de nouveau due.`);
      if (ok) setRestoring(null);
    } finally { setBusy(false); }
  }

  const unpayPlan = unpaying ? chargePaymentRemoval(unpaying.charge.id, data.payments, data.allocations) : null;
  const editTotal = form ? round2((form.rent_amount ?? 0) + (form.charges_amount ?? 0)) : 0;
  const ui = (
    <>
      <Modal open={!!editing} title={editing ? `Modifier l’échéance de ${periodLabel(editing.charge)}` : ''} onClose={() => setEditing(null)}
        footer={<><Button onClick={() => setEditing(null)}>Annuler</Button><Button variant="primary" disabled={busy} onClick={() => void saveEdit()}>{busy ? 'Enregistrement…' : 'Enregistrer'}</Button></>}>
        {editing && form && <>
          <div className="grid">
            <TextInput label="Date d’échéance" type="date" value={form.due_date} onChange={(v) => setForm({ ...form, due_date: v })} />
            {editing.charge.kind !== 'loyer' && <TextInput label="Libellé" value={form.label} onChange={(v) => setForm({ ...form, label: v })} maxLength={200} />}
            <NumberInput label={editing.charge.kind === 'loyer' ? 'Loyer hors charges' : 'Montant'} suffix="€" value={form.rent_amount} onChange={(v) => setForm({ ...form, rent_amount: v })} />
            <NumberInput label="Charges" suffix="€" value={form.charges_amount} onChange={(v) => setForm({ ...form, charges_amount: v })} />
          </div>
          <p className="small">Total dû : <strong>{money2(editTotal)}</strong> · déjà réglé : {money2(editing.paid)}{editTotal > editing.paid ? ` · reste ${money2(round2(editTotal - editing.paid))}` : ''}</p>
          {editing.paid > 0 && editTotal !== editing.paid && (
            <p><Button size="sm" onClick={() => setForm({ ...form, ...alignToPaid(editing.charge, editing.paid) })}>Aligner sur le montant payé ({money2(editing.paid)})</Button>{' '}
              <span className="muted small">Le paiement fait foi : la quittance reprendra ce montant.</span></p>
          )}
          {docsOf(editing).length > 0 && <p className="note">Document{docsOf(editing).length > 1 ? 's' : ''} n° {numbers(docsOf(editing))} : si le montant change, {docsOf(editing).length > 1 ? 'ils seront annulés' : 'il sera annulé'} puis réémis sur le nouveau montant.</p>}
          <p className="muted small">La modification ne touche que cette échéance ; pour changer le loyer des mois suivants, modifiez le bail ou utilisez la révision du loyer.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
        </>}
      </Modal>

      <Modal open={!!unpaying} title={unpaying ? `Annuler le paiement de ${periodLabel(unpaying.charge)}` : ''} onClose={() => setUnpaying(null)}
        footer={<><Button onClick={() => setUnpaying(null)}>Retour</Button><Button variant="danger" disabled={busy} onClick={() => void confirmUnpay()}>{busy ? 'Annulation…' : 'Annuler le paiement'}</Button></>}>
        {unpaying && unpayPlan && <>
          <p>L’échéance redevient due ({money2(unpaying.total)}).</p>
          <ul>
            {unpayPlan.remove.map((p) => <li key={p.id}>Paiement de {money2(p.amount)} du {date(p.paid_on)} : supprimé.</li>)}
            {unpayPlan.detach.map((a) => { const p = data.payments.find((x) => x.id === a.payment_id); return <li key={a.id}>Paiement {p ? `de ${money2(p.amount)} du ${date(p.paid_on)}` : ''} : {money2(a.amount)} retiré de cette échéance, conservé en avance (il règle aussi d’autres échéances).</li>; })}
          </ul>
          {docsOf(unpaying).length > 0 && <p className="note">Document{docsOf(unpaying).length > 1 ? 's' : ''} n° {numbers(docsOf(unpaying))} annulé{docsOf(unpaying).length > 1 ? 's' : ''} (conservé{docsOf(unpaying).length > 1 ? 's' : ''} dans l’historique).</p>}
        </>}
      </Modal>

      <Modal open={!!cancelling} title="Annuler l’échéance" onClose={() => setCancelling(null)}
        footer={<><Button onClick={() => setCancelling(null)}>Retour</Button>
          <Button variant="danger" disabled={busy || !cancelling?.reason.trim() || (!!cancelling && cancelling.v.paid > 0 && !cancelling.withPayments)} onClick={() => void confirmCancel()}>Annuler l’échéance</Button></>}>
        {cancelling && <>
          <p>L’échéance de {periodLabel(cancelling.v.charge)} ({money2(cancelling.v.total)}) sera annulée et ne sera plus due. Vous pourrez la réactiver plus tard.</p>
          {cancelling.v.paid > 0 && (
            <Checkbox label={`Annuler aussi le paiement (${money2(cancelling.v.paid)} réglés sur cette échéance)`} checked={cancelling.withPayments} onChange={(on) => setCancelling({ ...cancelling, withPayments: on })} />
          )}
          <TextInput label="Motif d’annulation" value={cancelling.reason} onChange={(r) => setCancelling({ ...cancelling, reason: r })} maxLength={500} placeholder="Ex. mois offert pendant les travaux" />
        </>}
      </Modal>

      <Modal open={!!restoring} title="Réactiver l’échéance" onClose={() => setRestoring(null)}
        footer={<><Button onClick={() => setRestoring(null)}>Retour</Button><Button variant="primary" disabled={busy} onClick={() => void confirmRestore()}>Réactiver</Button></>}>
        {restoring && <p>L’échéance de {periodLabel(restoring.charge)} ({money2(restoring.total)}, dû le {date(restoring.charge.due_date)}) redevient due.{restoring.charge.cancel_reason ? ` Motif d’annulation retiré : « ${restoring.charge.cancel_reason} ».` : ''} Vous pourrez ensuite confirmer son paiement ou modifier son montant.</p>}
      </Modal>
    </>
  );

  /** Actions proposées pour une échéance, selon son état. */
  const actionsFor = (v: ChargeView) => (v.charge.cancelled_at
    ? [{ label: 'Réactiver l’échéance', onSelect: () => setRestoring(v) }]
    : [
      { label: 'Modifier l’échéance', onSelect: () => edit(v) },
      ...(v.paid > 0 ? [{ label: 'Annuler le paiement', danger: true, onSelect: () => setUnpaying(v) }] : []),
      { label: 'Annuler l’échéance', danger: true, onSelect: () => setCancelling({ v, reason: '', withPayments: false }) },
    ]);

  return { edit, actionsFor, unpay: setUnpaying, cancel: (v: ChargeView) => setCancelling({ v, reason: '', withPayments: false }), restore: setRestoring, ui };
}
