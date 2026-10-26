import { useMemo, useState } from 'react';
import { useStore } from '../../data/store.tsx';
import { money2 } from '../../domain/format.ts';
import { receiptBacklog } from '../../domain/receiptBacklog.ts';
import { Button, Checkbox, Modal } from '../../ui/components.tsx';
import { periodLabel, useRental } from './common.tsx';

/**
 * Mise en cohérence des quittances avec les paiements déjà enregistrés : émet en une fois les quittances
 * des périodes intégralement réglées qui n'en ont pas (antériorité), rappels de charges réglés compris.
 * Aucune quittance n'est envoyée au locataire : l'envoi reste un choix, document par document.
 */
export function ReceiptBacklogDialog({ open, onClose, leaseId }: { open: boolean; onClose: () => void; leaseId?: string }) {
  const store = useStore();
  const { data } = store;
  const { views, leaseById, leaseLabel } = useRental();
  const backlog = useMemo(() => receiptBacklog(views, data.receipts, leaseId || undefined), [views, data.receipts, leaseId]);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; failed: number } | null>(null);
  const chosen = backlog.items.filter((i) => !skip.has(i.view.charge.id));

  async function run() {
    setBusy(true); setProgress({ done: 0, failed: 0 });
    let done = 0, failed = 0;
    try {
      for (const i of chosen) {
        const extras = i.extras.map((x) => x.charge.id);
        // une erreur sur une période n'arrête pas les suivantes ; elle est signalée à la fin
        const r = await store.call((repo) => (extras.length ? repo.issueReceiptWithExtras(i.view.charge.id, extras) : repo.issueReceipt(i.view.charge.id, 'quittance')));
        if (r) done++; else failed++;
        setProgress({ done, failed });
      }
      store.notify(failed
        ? `${done} quittance(s) émise(s), ${failed} en échec : reprenez-les depuis l’échéance concernée.`
        : `${done} quittance${done > 1 ? 's' : ''} émise${done > 1 ? 's' : ''} : quittances et paiements sont en cohérence.`, failed ? 'error' : undefined);
      if (!failed) { setSkip(new Set()); onClose(); }
    } finally { setBusy(false); setProgress(null); }
  }

  const byLease = new Map<string, typeof backlog.items>();
  for (const i of backlog.items) byLease.set(i.view.charge.lease_id, [...(byLease.get(i.view.charge.lease_id) ?? []), i]);
  const labelOf = (id: string) => { const l = leaseById.get(id); return l ? leaseLabel(l) : 'Bail supprimé'; };

  return (
    <Modal open={open} wide title="Mettre en cohérence les quittances" onClose={() => { if (!busy) onClose(); }}
      footer={<>
        <Button disabled={busy} onClick={onClose}>Fermer</Button>
        <Button variant="primary" disabled={busy || !chosen.length} onClick={() => void run()}>
          {busy && progress ? `Émission… ${progress.done + progress.failed}/${chosen.length}` : `Émettre ${chosen.length} quittance${chosen.length > 1 ? 's' : ''}`}
        </Button>
      </>}>
      {backlog.items.length === 0 ? (
        <p>Toutes les périodes intégralement réglées ont déjà leur quittance : rien à faire.</p>
      ) : (
        <>
          <p>Les paiements déjà enregistrés règlent intégralement <strong>{backlog.items.length} période{backlog.items.length > 1 ? 's' : ''}</strong> sans quittance. Immo-Zen peut émettre les quittances manquantes en une fois, des plus anciennes aux plus récentes, avec leur numérotation.</p>
          <ul className="muted small">
            <li>Chaque quittance reprend les paiements reçus et leurs dates ; elle est datée d’aujourd’hui.</li>
            <li>Les rappels de charges réglés sont repris sur la quittance du mois où ils sont exigibles.</li>
            <li>Rien n’est envoyé aux locataires : envoyez ensuite les quittances voulues depuis « Quittances et reçus ».</li>
          </ul>
          {[...byLease.entries()].map(([id, items]) => (
            <div key={id} className="backlog-lease">
              <h3>{labelOf(id)}</h3>
              <table className="dt-table compact">
                <thead><tr><th><span className="sr-only">Inclure</span></th><th>Période</th><th className="num">Montant</th><th>Rappel repris</th></tr></thead>
                <tbody>{items.map((i) => (
                  <tr key={i.view.charge.id}>
                    <td><Checkbox label={`Inclure ${periodLabel(i.view.charge)}`} checked={!skip.has(i.view.charge.id)}
                      onChange={(on) => setSkip((s) => { const n = new Set(s); if (on) n.delete(i.view.charge.id); else n.add(i.view.charge.id); return n; })} /></td>
                    <td>{periodLabel(i.view.charge)}</td>
                    <td className="num">{money2(i.view.total + i.extras.reduce((t, x) => t + x.total, 0))}</td>
                    <td className="small">{i.extras.map((x) => `${periodLabel(x.charge)} (${money2(x.total)})`).join(', ') || '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ))}
          <p><strong>Total quittancé : {money2(chosen.reduce((s, i) => s + i.view.total + i.extras.reduce((t, x) => t + x.total, 0), 0))}</strong></p>
        </>
      )}
      {backlog.orphans.length > 0 && (
        <p className="note">{backlog.orphans.length} rappel{backlog.orphans.length > 1 ? 's' : ''} de charges réglé{backlog.orphans.length > 1 ? 's' : ''} sans loyer à quittancer sur le même bail ({backlog.orphans.map((x) => `${periodLabel(x.charge)}, ${labelOf(x.charge.lease_id)}`).join(' ; ')}) : {backlog.orphans.length > 1 ? 'ils seront repris' : 'il sera repris'} sur la prochaine quittance de loyer.</p>
      )}
    </Modal>
  );
}
