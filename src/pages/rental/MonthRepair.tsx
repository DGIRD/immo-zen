import { useMemo, useState } from 'react';
import { useStore } from '../../data/store.tsx';
import type { Lease } from '../../data/types.ts';
import { todayParis } from '../../domain/format.ts';
import { monthLabel, monthRepairPlan, restorableCharges, startChangeImpact } from '../../domain/rental.ts';
import { Button, Checkbox, Modal } from '../../ui/components.tsx';
import { useRental } from './common.tsx';

/** État d'un bail au regard de la règle « un paiement règle l'échéance de son mois ». */
export function useLeaseRepair(lease: Lease) {
  const { data } = useStore();
  return useMemo(() => {
    const today = todayParis();
    const stale = startChangeImpact(lease, lease.start_date, data.charges, data.allocations, data.receipts);
    const restore = restorableCharges(lease, data.charges, data.payments);
    const plan = monthRepairPlan(lease, data.charges.filter((c) => !stale.remove.includes(c)), data.payments,
      data.allocations.filter((a) => !stale.remove.some((c) => c.id === a.charge_id)), data.receipts, today);
    const needed = stale.remove.length > 0 || restore.length > 0 || plan.add.length > 0 || plan.remove.length > 0;
    return { stale, restore, plan, needed };
  }, [lease, data]);
}

/**
 * Remise en ordre d'un ou plusieurs baux :
 * 1. suppression des échéances antérieures au début du bail (sans quittance) ;
 * 2. rétablissement des échéances annulées sans motif dont le mois a reçu un paiement (option) ;
 * 3. échéancier complété jusqu'au mois en cours ;
 * 4. paiements réaffectés : chacun règle l'échéance du mois de sa date, puis les arriérés.
 * Les échéances couvertes par une quittance ou un reçu valable ne sont pas touchées.
 */
export function MonthRepairDialog({ open, onClose, leaseIds }: { open: boolean; onClose: () => void; leaseIds: string[] }) {
  const store = useStore();
  const { data } = store;
  const { leaseLabel } = useRental();
  const [restore, setRestore] = useState(true);
  const [busy, setBusy] = useState(false);
  const leases = data.leases.filter((l) => leaseIds.includes(l.id));
  const today = todayParis();
  const rows = leases.map((l) => {
    const stale = startChangeImpact(l, l.start_date, data.charges, data.allocations, data.receipts);
    const rest = restorableCharges(l, data.charges, data.payments);
    const plan = monthRepairPlan(l, data.charges.filter((c) => !stale.remove.includes(c)), data.payments,
      data.allocations.filter((a) => !stale.remove.some((c) => c.id === a.charge_id)), data.receipts, today);
    return { l, stale, rest, plan };
  }).filter((r) => r.stale.remove.length || r.rest.length || r.plan.add.length || r.plan.remove.length);

  async function run() {
    setBusy(true);
    try {
      let done = 0;
      for (const { l, stale, rest } of rows) {
        const ok = await store.call(async (repo) => {
          if (stale.remove.length && !stale.blocked.length) await repo.cleanLeaseSchedule(l.id);
          if (restore) for (const c of rest) await repo.update('rent_charges', c.id, c.version, { cancelled_at: null, cancel_reason: null });
          await repo.generateCharges(l.id);
          // plan recalculé sur les données à jour
          const snap = await repo.loadAll();
          const lease = snap.leases.find((x) => x.id === l.id) ?? l;
          const plan = monthRepairPlan(lease, snap.charges, snap.payments, snap.allocations, snap.receipts, todayParis());
          for (const a of plan.remove) await repo.remove('payment_allocations', a.id);
          if (plan.add.length) await repo.insertMany('payment_allocations', plan.add);
          return true;
        });
        if (ok) done++; else break;
      }
      await store.refresh();
      if (done) { store.notify(`${done} bail${done > 1 ? 'x remis' : ' remis'} en ordre : chaque paiement règle désormais l’échéance de son mois.`); onClose(); }
    } finally {
      setBusy(false);
    }
  }

  const restoreCount = rows.reduce((s, r) => s + r.rest.length, 0);
  return (
    <Modal open={open} wide title="Répartir les paiements par mois" onClose={onClose}
      footer={<><Button onClick={onClose}>Annuler</Button><Button variant="primary" disabled={busy || !rows.length} onClick={() => void run()}>{busy ? 'Remise en ordre…' : 'Remettre en ordre'}</Button></>}>
      {!rows.length ? <p>Les paiements sont déjà affectés aux échéances de leur mois : rien à corriger.</p> : <>
        <p>Chaque paiement est affecté à l’échéance du mois de sa date ; un excédent règle les mois précédents restés dus, sinon il reste en avance. Les paiements ne sont jamais supprimés. Les mois déjà quittancés ne sont pas modifiés.</p>
        <ul className="repair-list">
          {rows.map(({ l, stale, rest, plan }) => (
            <li key={l.id}><strong>{leaseLabel(l)}</strong>
              <ul>
                {stale.remove.length > 0 && (stale.blocked.length
                  ? <li className="neg">{stale.remove.length} échéance(s) antérieure(s) au début du bail, dont {stale.blocked.length} quittancée(s) : annulez ces documents pour les supprimer.</li>
                  : <li>{stale.remove.length} échéance(s) antérieure(s) au début du bail ({monthLabel(stale.remove[0]!.period_start)} – {monthLabel(stale.remove.at(-1)!.period_start)}) supprimée(s).</li>)}
                {rest.length > 0 && <li>{rest.length} échéance(s) annulée(s) sans motif alors qu’un paiement a été reçu ce mois-là ({rest.map((c) => monthLabel(c.period_start)).join(', ')}).</li>}
                {(plan.add.length > 0 || plan.remove.length > 0) && <li>Répartition des paiements recalculée{plan.changed ? ` : ${plan.changed} échéance(s) changent d’état` : ''}.</li>}
              </ul>
            </li>
          ))}
        </ul>
        {restoreCount > 0 && <Checkbox label={`Rétablir les ${restoreCount} échéance(s) annulée(s) sans motif`} checked={restore} onChange={setRestore} />}
      </>}
    </Modal>
  );
}
