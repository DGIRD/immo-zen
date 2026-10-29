import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../data/store.tsx';
import { buildBackup } from '../../domain/backup.ts';
import { downloadBlob, stamp } from '../../domain/exporting.ts';
import { planSize } from '../../domain/ledger.ts';
import { Button, EmptyState, Modal, PageHeader } from '../../ui/components.tsx';
import { navigate } from '../../ui/router.ts';
import { RentImportDialog } from './RentImport.tsx';
import { RentLedger } from './RentLedger.tsx';
import { PaymentDialog } from './common.tsx';
import { ledgerPlans, syncLedgerWith } from './ledgerSync.ts';

/**
 * Loyers et paiements de tous les baux : un seul tableau, une ligne par bail et par mois.
 * À l'ouverture, les lignes manquantes sont créées et les paiements rangés dans leur mois (reports compris).
 * Le premier passage au tableau unique (reprise des échéances et paiements existants) est validé par l'utilisateur,
 * après une sauvegarde.
 */
export function RentsPage() {
  const [leaseFilter, setLeaseFilter] = useState('');
  const [pay, setPay] = useState(false);
  const [importing, setImporting] = useState(false);
  const [converting, setConverting] = useState(false);
  const [busy, setBusy] = useState(false);
  const store = useStore();
  const data = store.data;
  const rs = data.settings?.rental_settings ?? {};
  const converted = !!rs.ledger_unified_at;
  // reprise : écritures nécessaires pour passer au tableau unique
  const reprise = useMemo(() => (converted ? [] : ledgerPlans(data, { restoreCancelled: true })), [data, converted]);
  const repriseSize = reprise.reduce((s, x) => s + planSize(x.plan), 0);

  // mise en conformité automatique (après la reprise), une fois par ouverture de l'écran
  const synced = useRef(false);
  useEffect(() => {
    if (synced.current || !data.loadedAt || !data.leases.length) return;
    if (!converted && repriseSize > 0) return;
    synced.current = true;
    void (async () => {
      const n = await store.call((r) => syncLedgerWith(r));
      if (!converted && n !== null) await store.saveSettings({ rental_settings: { ...rs, ledger_unified_at: new Date().toISOString() } });
    })();
  }, [data.loadedAt, data.leases.length, converted, repriseSize]); // eslint-disable-line react-hooks/exhaustive-deps

  async function convert() {
    setBusy(true);
    try {
      downloadBlob(new Blob([JSON.stringify(buildBackup(data, store.session?.email ?? ''), null, 2)], { type: 'application/json' }), `immo-zen-sauvegarde-avant-loyers-${stamp()}.json`);
      const n = await store.call((r) => syncLedgerWith(r, { restoreCancelled: true }));
      if (n !== null) {
        await store.saveSettings({ rental_settings: { ...rs, ledger_unified_at: new Date().toISOString() } });
        store.notify(`Tableau unique en place : ${n} écriture${n > 1 ? 's' : ''} (paiements rangés dans leur mois, restes dus reportés).`);
        synced.current = true;
        setConverting(false);
      }
    } finally { setBusy(false); }
  }

  const counts = useMemo(() => reprise.reduce((t, { plan }) => ({
    alloc: t.alloc + plan.createAllocations.length + plan.deleteAllocations.length,
    reports: t.reports + plan.createCharges.length,
    removed: t.removed + plan.deleteCharges.filter((c) => c.kind === 'loyer').length,
    restored: t.restored + plan.updateCharges.filter((u) => 'cancelled_at' in u.patch).length,
  }), { alloc: 0, reports: 0, removed: 0, restored: 0 }), [reprise]);

  return (
    <>
      <PageHeader title="Loyers et paiements" subtitle="Une ligne par bail et par mois : ce qui est dû (loyer, charges, autres sommes, reste dû reporté) et ce qui a été réglé. Le statut découle uniquement des sommes dues et des paiements enregistrés."
        actions={<>
          <Button disabled={!data.leases.length} onClick={() => setImporting(true)}>Importer un relevé (Excel, CSV)</Button>
          <Button variant="primary" disabled={!data.leases.length} onClick={() => setPay(true)}>Enregistrer un paiement</Button>
        </>} />
      <RentImportDialog open={importing} onClose={() => setImporting(false)} />
      {!data.leases.length ? (
        <EmptyState title="Aucun bail" action={<Button variant="primary" onClick={() => navigate('/baux/nouveau')}>Créer un bail</Button>}>Les lignes mensuelles sont créées à partir des dates des baux.</EmptyState>
      ) : (
        <>
          {!converted && repriseSize > 0 && (
            <div className="note note-warn" role="status">
              <strong>Passage au tableau unique.</strong> Vos échéances et paiements existants doivent être repris : chaque paiement est rangé dans le mois de sa date, et le reste dû d’un mois échu est reporté sur le mois suivant.{' '}
              <Button size="sm" variant="primary" onClick={() => setConverting(true)}>Voir et appliquer la reprise</Button>
            </div>
          )}
          <RentLedger leaseFilter={leaseFilter} onLeaseFilter={setLeaseFilter} />
        </>
      )}
      <Modal open={converting} title="Reprise des loyers et paiements" onClose={() => setConverting(false)}
        footer={<><Button onClick={() => setConverting(false)}>Plus tard</Button><Button variant="primary" disabled={busy} onClick={() => void convert()}>{busy ? 'Reprise…' : 'Télécharger une sauvegarde et appliquer'}</Button></>}>
        <p>La reprise met {reprise.length} bail{reprise.length > 1 ? 'x' : ''} en conformité avec le tableau unique :</p>
        <ul>
          <li>{counts.alloc} répartition{counts.alloc > 1 ? 's' : ''} de paiement modifiée{counts.alloc > 1 ? 's' : ''} : chaque paiement règle le mois de sa date (ou le mois de l’échéance sur laquelle vous l’aviez confirmé) ;</li>
          <li>{counts.reports} reste{counts.reports > 1 ? 's' : ''} dû{counts.reports > 1 ? 's' : ''} reporté{counts.reports > 1 ? 's' : ''} dans « Autre somme due » du mois suivant ;</li>
          {counts.removed > 0 && <li>{counts.removed} ligne{counts.removed > 1 ? 's' : ''} hors de la période du bail supprimée{counts.removed > 1 ? 's' : ''} (sans paiement ni quittance) ;</li>}
          {counts.restored > 0 && <li>{counts.restored} loyer{counts.restored > 1 ? 's' : ''} annulé{counts.restored > 1 ? 's' : ''} sans motif rétabli{counts.restored > 1 ? 's' : ''} ;</li>}
          <li>les quittances déjà émises restent attachées à leur mois, sans modification.</li>
        </ul>
        <p className="muted small">Une sauvegarde complète (JSON) est téléchargée avant la reprise. Ensuite, le tableau signale les mois dont le réglé diffère du dû (filtre « Écarts ») pour que vous qualifiiez chaque écart.</p>
      </Modal>
      <PaymentDialog open={pay} onClose={() => setPay(false)} mode="saisie" />
    </>
  );
}
