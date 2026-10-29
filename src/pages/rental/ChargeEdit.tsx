import { useState } from 'react';
import { useStore } from '../../data/store.tsx';
import { RepoError, type Repo } from '../../data/repo.ts';
import type { Receipt, RentCharge } from '../../data/types.ts';
import { date, money2 } from '../../domain/format.ts';
import { alignToPaid, monthOf, type ChargeView } from '../../domain/rental.ts';
import { paymentMonth } from '../../domain/ledger.ts';
import type { Allocation, Payment } from '../../data/types.ts';
import { syncLedgerWith } from './ledgerSync.ts';
import { issueMonthDocs } from './monthActions.tsx';
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

/** Réémet, après une modification, les documents annulés pendant l'opération (si le mois reste réglé). */
async function reissueAfter(repo: Repo, old: Receipt[]): Promise<number> {
  const months = [...new Map(old.map((r) => [`${r.lease_id}|${r.period_start.slice(0, 7)}`, { lease_id: r.lease_id, month: r.period_start.slice(0, 7), kind: r.kind }])).values()];
  const n = await issueMonthDocs(repo, months);
  return n.q + n.r;
}

/** Paiements du mois d'une ligne : rattachés à ce mois, ou affectés à cette somme. */
export function monthPayments(c: Pick<RentCharge, 'id' | 'lease_id' | 'period_start'>, payments: Payment[], allocations: Allocation[]): Payment[] {
  const m = monthOf(c.period_start);
  const onIt = new Set(allocations.filter((a) => a.charge_id === c.id).map((a) => a.payment_id));
  return payments.filter((p) => p.lease_id === c.lease_id && (paymentMonth(p) === m || onIt.has(p.id)));
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
        await syncLedgerWith(repo, { leaseIds: [editing.charge.lease_id] });
        const n = amountChanged && docs.length ? await reissueAfter(repo, docs) : 0;
        return { n };
      });
      if (ok) {
        store.notify(`Ligne de ${periodLabel(editing.charge)} modifiée.${amountChanged && docs.length ? ` Document${docs.length > 1 ? 's' : ''} n° ${numbers(docs)} annulé${docs.length > 1 ? 's' : ''}${ok.n ? ', nouveau document émis' : ''}.` : ''}`);
        setEditing(null);
      } else await store.refresh();
    } finally { setBusy(false); }
  }

  /** Retire les paiements du mois d'une ligne (documents annulés d'abord). */
  async function removePaymentsOf(repo: Repo, v: ChargeView) {
    const snap = await repo.loadAll();
    const remove = monthPayments(v.charge, snap.payments, snap.allocations);
    const pids = new Set(remove.map((p) => p.id));
    const ids = new Set([v.charge.id, ...snap.allocations.filter((a) => pids.has(a.payment_id)).map((a) => a.charge_id)]);
    for (const r of snap.receipts.filter((r) => !r.cancelled_at && (ids.has(r.charge_id) || (r.extra_lines ?? []).some((x) => ids.has(x.charge_id))))) {
      await repo.cancelReceipt(r.id, 'Paiement annulé');
    }
    for (const p of remove) await repo.remove('payments', p.id);
    await syncLedgerWith(repo, { leaseIds: [v.charge.lease_id] });
    return { remove };
  }

  async function confirmUnpay() {
    if (!unpaying) return;
    setBusy(true);
    try {
      const plan = await store.call((repo) => removePaymentsOf(repo, unpaying));
      if (plan) {
        store.notify(`Paiement de ${periodLabel(unpaying.charge)} annulé : ${plan.remove.length} paiement${plan.remove.length > 1 ? 's' : ''} supprimé${plan.remove.length > 1 ? 's' : ''}. Le mois est de nouveau dû.`);
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
        await syncLedgerWith(repo, { leaseIds: [v.charge.lease_id] });
        return true;
      }, `Ligne de ${periodLabel(v.charge)} annulée : elle n’est plus due.`);
      if (ok) setCancelling(null); else await store.refresh();
    } finally { setBusy(false); }
  }

  async function confirmRestore() {
    if (!restoring) return;
    setBusy(true);
    try {
      const ok = await store.call(async (repo) => { await updateCharge(repo, restoring.charge.id, { cancelled_at: null, cancel_reason: null }); await syncLedgerWith(repo, { leaseIds: [restoring.charge.lease_id] }); return true; },
        `Ligne de ${periodLabel(restoring.charge)} réactivée : elle est de nouveau due.`);
      if (ok) setRestoring(null);
    } finally { setBusy(false); }
  }

  const unpayPlan = unpaying ? { remove: monthPayments(unpaying.charge, data.payments, data.allocations) } : null;
  const editTotal = form ? round2((form.rent_amount ?? 0) + (form.charges_amount ?? 0)) : 0;
  const ui = (
    <>
      <Modal open={!!editing} title={editing ? `Modifier la ligne de ${periodLabel(editing.charge)}` : ''} onClose={() => setEditing(null)}
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
          <p className="muted small">La modification ne touche que ce mois ; pour changer le loyer des mois suivants, modifiez le bail ou utilisez la révision du loyer.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
        </>}
      </Modal>

      <Modal open={!!unpaying} title={unpaying ? `Annuler le paiement de ${periodLabel(unpaying.charge)}` : ''} onClose={() => setUnpaying(null)}
        footer={<><Button onClick={() => setUnpaying(null)}>Retour</Button><Button variant="danger" disabled={busy} onClick={() => void confirmUnpay()}>{busy ? 'Annulation…' : 'Annuler le paiement'}</Button></>}>
        {unpaying && unpayPlan && <>
          <p>Le mois redevient dû ({money2(unpaying.total)}).</p>
          <ul>
            {unpayPlan.remove.map((p) => <li key={p.id}>Paiement de {money2(p.amount)} du {date(p.paid_on)} : supprimé.</li>)}
          </ul>
          {docsOf(unpaying).length > 0 && <p className="note">Document{docsOf(unpaying).length > 1 ? 's' : ''} n° {numbers(docsOf(unpaying))} annulé{docsOf(unpaying).length > 1 ? 's' : ''} (conservé{docsOf(unpaying).length > 1 ? 's' : ''} dans l’historique).</p>}
        </>}
      </Modal>

      <Modal open={!!cancelling} title="Annuler la ligne" onClose={() => setCancelling(null)}
        footer={<><Button onClick={() => setCancelling(null)}>Retour</Button>
          <Button variant="danger" disabled={busy || !cancelling?.reason.trim() || (!!cancelling && cancelling.v.paid > 0 && !cancelling.withPayments)} onClick={() => void confirmCancel()}>Annuler la ligne</Button></>}>
        {cancelling && <>
          <p>La ligne de {periodLabel(cancelling.v.charge)} ({money2(cancelling.v.total)}) sera annulée et ne sera plus due. Vous pourrez la réactiver plus tard.</p>
          {cancelling.v.paid > 0 && (
            <Checkbox label={`Annuler aussi le paiement (${money2(cancelling.v.paid)} réglés sur cette échéance)`} checked={cancelling.withPayments} onChange={(on) => setCancelling({ ...cancelling, withPayments: on })} />
          )}
          <TextInput label="Motif d’annulation" value={cancelling.reason} onChange={(r) => setCancelling({ ...cancelling, reason: r })} maxLength={500} placeholder="Ex. mois offert pendant les travaux" />
        </>}
      </Modal>

      <Modal open={!!restoring} title="Réactiver la ligne" onClose={() => setRestoring(null)}
        footer={<><Button onClick={() => setRestoring(null)}>Retour</Button><Button variant="primary" disabled={busy} onClick={() => void confirmRestore()}>Réactiver</Button></>}>
        {restoring && <p>La ligne de {periodLabel(restoring.charge)} ({money2(restoring.total)}, dû le {date(restoring.charge.due_date)}) redevient due.{restoring.charge.cancel_reason ? ` Motif d’annulation retiré : « ${restoring.charge.cancel_reason} ».` : ''} Vous pourrez ensuite confirmer son paiement ou modifier son montant.</p>}
      </Modal>
    </>
  );

  /** Actions proposées pour une échéance, selon son état. */
  const actionsFor = (v: ChargeView) => (v.charge.cancelled_at
    ? [{ label: 'Réactiver la ligne', onSelect: () => setRestoring(v) }]
    : [
      { label: 'Modifier la ligne', onSelect: () => edit(v) },
      ...(v.paid > 0 ? [{ label: 'Annuler le paiement', danger: true, onSelect: () => setUnpaying(v) }] : []),
      { label: 'Annuler la ligne', danger: true, onSelect: () => setCancelling({ v, reason: '', withPayments: false }) },
    ]);

  return { edit, actionsFor, unpay: setUnpaying, cancel: (v: ChargeView) => setCancelling({ v, reason: '', withPayments: false }), restore: setRestoring, ui };
}
