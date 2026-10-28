import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../data/store.tsx';
import { todayParis } from '../../domain/format.ts';
import { leaseState, monthOf, monthRepairPlan, restorableCharges, startChangeImpact } from '../../domain/rental.ts';
import { Button, EmptyState, PageHeader } from '../../ui/components.tsx';
import { navigate } from '../../ui/router.ts';
import { RentImportDialog } from './RentImport.tsx';
import { ReceiptBacklogDialog, useCoherenceCount } from './ReceiptBacklog.tsx';
import { MonthRepairDialog } from './MonthRepair.tsx';
import { RentLedger } from './RentLedger.tsx';
import { PaymentDialog } from './common.tsx';

/** Loyers et paiements de tous les baux : un seul tableau (échéances, paiements, quittances et reçus). */
export function RentsPage() {
  const [leaseFilter, setLeaseFilter] = useState('');
  const [pay, setPay] = useState<{ mode: 'saisie' } | null>(null);
  const [importing, setImporting] = useState(false);
  const [backlogOpen, setBacklogOpen] = useState(false);
  const [repairOpen, setRepairOpen] = useState(false);
  const store = useStore();
  const data = store.data;

  // Une échéance par mois : si la tâche quotidienne n'a pas encore créé celle du mois en cours, on la crée ici.
  const today = todayParis();
  const generated = useRef(false);
  useEffect(() => {
    if (generated.current) return;
    const missing = store.data.leases.filter((l) => leaseState(l, today) === 'actif'
      && !store.data.charges.some((c) => c.lease_id === l.id && c.kind === 'loyer' && monthOf(c.period_start) === monthOf(today)));
    if (!missing.length) return;
    generated.current = true;
    void (async () => {
      let n = 0;
      for (const l of missing) n += (await store.call((r) => r.generateCharges(l.id))) ?? 0;
      if (n) { await store.refresh(); store.notify(`${n} échéance(s) du mois créée(s).`); }
    })();
  }, [store, today]);

  const coherence = useCoherenceCount(leaseFilter || undefined);
  // baux dont les paiements ne sont pas affectés à l'échéance de leur mois (ancienne répartition, échéances parasites)
  const toRepair = useMemo(() => data.leases.filter((l) => {
    const stale = startChangeImpact(l, l.start_date, data.charges, data.allocations, data.receipts);
    if (stale.remove.length || restorableCharges(l, data.charges, data.payments).length) return true;
    const p = monthRepairPlan(l, data.charges, data.payments, data.allocations, data.receipts, today);
    return p.add.length > 0 || p.remove.length > 0;
  }).map((l) => l.id), [data, today]);

  return (
    <>
      <PageHeader title="Loyers et paiements" subtitle="Une ligne par échéance, avec les paiements reçus et la quittance ou le reçu émis. Le solde découle uniquement des échéances et des paiements enregistrés."
        actions={<>
          <Button disabled={!data.leases.length} onClick={() => setBacklogOpen(true)} title="Le paiement fait foi : quittances au montant réellement payé, émises pour les périodes déjà réglées">
            Mettre en cohérence paiements et quittances{coherence ? ` (${coherence})` : ''}</Button>
          {toRepair.length > 0 && <Button onClick={() => setRepairOpen(true)} title="Affecter chaque paiement à l’échéance de son mois">Répartir les paiements par mois ({toRepair.length})</Button>}
          <Button disabled={!data.leases.length} onClick={() => setImporting(true)}>Importer des loyers (Excel)</Button>
          <Button variant="primary" disabled={!data.leases.length} onClick={() => setPay({ mode: 'saisie' })}>Enregistrer un paiement</Button>
        </>} />
      <RentImportDialog open={importing} onClose={() => setImporting(false)} />
      <MonthRepairDialog open={repairOpen} onClose={() => setRepairOpen(false)} leaseIds={leaseFilter ? toRepair.filter((id) => id === leaseFilter) : toRepair} />
      <ReceiptBacklogDialog open={backlogOpen} onClose={() => setBacklogOpen(false)} leaseId={leaseFilter || undefined} />
      {!data.leases.length ? (
        <EmptyState title="Aucun bail" action={<Button variant="primary" onClick={() => navigate('/baux/nouveau')}>Créer un bail</Button>}>Les échéances de loyer sont générées à partir des baux.</EmptyState>
      ) : (
        <>
          {toRepair.length > 0 && (
            <p className="note note-warn">{toRepair.length} bail{toRepair.length > 1 ? 'x ont' : ' a'} des paiements qui ne règlent pas l’échéance de leur mois (répartition d’un ancien import ou échéances antérieures au bail).{' '}
              <button type="button" className="link" onClick={() => setRepairOpen(true)}>Répartir les paiements par mois</button></p>
          )}
          {coherence > 0 && (
            <p className="note">{coherence} action{coherence > 1 ? 's' : ''} proposée{coherence > 1 ? 's' : ''} pour que chaque mois reprenne les paiements reçus ce mois-là (le paiement fait foi) et ait sa quittance.{' '}
              <button type="button" className="link" onClick={() => setBacklogOpen(true)}>Mettre en cohérence paiements et quittances</button></p>
          )}
          <RentLedger leaseFilter={leaseFilter} onLeaseFilter={setLeaseFilter} />
        </>
      )}
      <PaymentDialog open={!!pay} onClose={() => setPay(null)} mode="saisie" />
    </>
  );
}
