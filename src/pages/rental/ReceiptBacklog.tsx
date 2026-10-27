import { useMemo, useState } from 'react';
import { useStore } from '../../data/store.tsx';
import { RepoError } from '../../data/repo.ts';
import { money2, todayParis } from '../../domain/format.ts';
import { receiptBacklog } from '../../domain/receiptBacklog.ts';
import { alignToPaid, chargeViews, paidAlignments } from '../../domain/rental.ts';
import { Button, Checkbox, Modal } from '../../ui/components.tsx';
import { periodLabel, useRental } from './common.tsx';

/** Nombre de quittances que la mise en cohérence propose (périodes réglées + mois alignés sur le payé). */
export function useCoherenceCount(leaseId?: string): number {
  const { data } = useStore();
  const { views, today } = useRental();
  return useMemo(() => receiptBacklog(views, data.receipts, leaseId).items.length + paidAlignments(views, data.receipts, today, leaseId).filter((a) => a.suggested).length,
    [views, data.receipts, today, leaseId]);
}

/**
 * Mise en cohérence des paiements et des quittances. Le paiement fait foi :
 * 1. les mois réglés pour un montant inférieur à l'échéance (historique importé, ancien loyer)
 *    voient leur échéance ramenée au montant réellement payé, au choix mois par mois ;
 * 2. les quittances manquantes des périodes intégralement réglées sont émises en une fois,
 *    des plus anciennes aux plus récentes, rappels de charges réglés compris.
 * Aucune quittance n'est envoyée au locataire : l'envoi reste un choix, document par document.
 */
export function ReceiptBacklogDialog({ open, onClose, leaseId }: { open: boolean; onClose: () => void; leaseId?: string }) {
  const store = useStore();
  const { data } = store;
  const { views, leaseById, leaseLabel, today } = useRental();
  const backlog = useMemo(() => receiptBacklog(views, data.receipts, leaseId || undefined), [views, data.receipts, leaseId]);
  const aligns = useMemo(() => paidAlignments(views, data.receipts, today, leaseId || undefined), [views, data.receipts, today, leaseId]);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  /** Choix explicites pour l'alignement (sinon : proposé pour les mois échus). */
  const [alignPick, setAlignPick] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; failed: number; total: number } | null>(null);
  const chosen = backlog.items.filter((i) => !skip.has(i.view.charge.id));
  const alignOn = (id: string, suggested: boolean) => alignPick[id] ?? suggested;
  const chosenAligns = aligns.filter((a) => alignOn(a.view.charge.id, a.suggested));
  const count = chosen.length + chosenAligns.length;

  async function run() {
    setBusy(true);
    let done = 0, failed = 0, aligned = 0;
    try {
      // 1. échéances ramenées au montant payé
      for (const a of chosenAligns) {
        const ok = await store.call(async (repo) => {
          const snap = await repo.loadAll();
          const c = snap.charges.find((x) => x.id === a.view.charge.id);
          if (!c) throw new RepoError('Échéance introuvable.');
          const paid = snap.allocations.filter((x) => x.charge_id === c.id).reduce((s, x) => s + x.amount, 0);
          // un reçu partiel du mois est remplacé par la quittance du montant payé
          for (const r of snap.receipts.filter((x) => x.charge_id === c.id && x.kind === 'recu' && !x.cancelled_at)) await repo.cancelReceipt(r.id, 'Remplacé par la quittance du montant payé');
          const res = await repo.update('rent_charges', c.id, c.version, alignToPaid(c, paid));
          if (res.status !== 'ok') throw new RepoError('Échéance modifiée entre-temps : rechargez la page.');
          return true;
        });
        if (ok) aligned++; else failed++;
      }
      // 2. quittances, sur les données à jour, des plus anciennes aux plus récentes
      const snap = await store.repo.loadAll();
      const wanted = new Set([...chosen.map((i) => i.view.charge.id), ...chosenAligns.map((a) => a.view.charge.id)]);
      const fresh = receiptBacklog(chargeViews(snap.charges, snap.allocations, todayParis()), snap.receipts, leaseId || undefined).items.filter((i) => wanted.has(i.view.charge.id));
      setProgress({ done: 0, failed, total: fresh.length });
      for (const i of fresh) {
        const extras = i.extras.map((x) => x.charge.id);
        // une erreur sur une période n'arrête pas les suivantes ; elle est signalée à la fin
        const r = await store.call((repo) => (extras.length ? repo.issueReceiptWithExtras(i.view.charge.id, extras) : repo.issueReceipt(i.view.charge.id, 'quittance')));
        if (r) done++; else failed++;
        setProgress({ done, failed, total: fresh.length });
      }
      await store.refresh();
      const al = aligned ? ` ${aligned} échéance${aligned > 1 ? 's' : ''} alignée${aligned > 1 ? 's' : ''} sur le montant payé.` : '';
      store.notify(failed
        ? `${done} quittance(s) émise(s), ${failed} en échec : reprenez-les depuis l’échéance concernée.${al}`
        : `${done} quittance${done > 1 ? 's' : ''} émise${done > 1 ? 's' : ''} : paiements et quittances sont en cohérence.${al}`, failed ? 'error' : undefined);
      if (!failed) { setSkip(new Set()); setAlignPick({}); onClose(); }
    } finally { setBusy(false); setProgress(null); }
  }

  const byLease = new Map<string, typeof backlog.items>();
  for (const i of backlog.items) byLease.set(i.view.charge.lease_id, [...(byLease.get(i.view.charge.lease_id) ?? []), i]);
  const labelOf = (id: string) => { const l = leaseById.get(id); return l ? leaseLabel(l) : 'Bail supprimé'; };
  const nothing = backlog.items.length === 0 && aligns.length === 0;

  return (
    <Modal open={open} wide title="Mettre en cohérence paiements et quittances" onClose={() => { if (!busy) onClose(); }}
      footer={<>
        <Button disabled={busy} onClick={onClose}>Fermer</Button>
        <Button variant="primary" disabled={busy || !count} onClick={() => void run()}>
          {busy ? (progress ? `Émission… ${progress.done + progress.failed}/${progress.total}` : 'Alignement…') : `Émettre ${count} quittance${count > 1 ? 's' : ''}`}
        </Button>
      </>}>
      {nothing ? (
        <p>Toutes les périodes réglées ont déjà leur quittance : rien à faire.</p>
      ) : (
        <>
          <p><strong>Le paiement fait foi</strong> : chaque quittance reprend le montant réellement payé dans le mois, pas le loyer saisi sur le bail.</p>
          {aligns.length > 0 && (
            <div className="backlog-lease">
              <h3>Mois payés pour un montant inférieur à l’échéance</h3>
              <p className="muted small">Cas typique : paiements d’avant votre arrivée dans Immo-Zen, alors que le bail porte le loyer actuel. Cochés, ces mois sont ramenés au montant payé (l’écart n’est plus dû) puis quittancés. Décochez un mois si le locataire doit réellement le reste (il restera en reçu partiel).</p>
              <table className="dt-table compact">
                <thead><tr><th><span className="sr-only">Aligner</span></th>{!leaseId && <th>Bail</th>}<th>Période</th><th className="num">Échéance</th><th className="num">Payé</th><th className="num">Écart abandonné</th></tr></thead>
                <tbody>{aligns.map((a) => (
                  <tr key={a.view.charge.id}>
                    <td><Checkbox label={`Aligner ${periodLabel(a.view.charge)} sur le montant payé`} checked={alignOn(a.view.charge.id, a.suggested)}
                      onChange={(on) => setAlignPick((p) => ({ ...p, [a.view.charge.id]: on }))} /></td>
                    {!leaseId && <td className="wrap">{labelOf(a.view.charge.lease_id)}</td>}
                    <td>{periodLabel(a.view.charge)}{!a.suggested && <small className="muted block">mois en cours</small>}</td>
                    <td className="num">{money2(a.view.total)}</td>
                    <td className="num"><strong>{money2(a.paid)}</strong></td>
                    <td className="num">{money2(a.gap)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {backlog.items.length > 0 && <>
            <h3>Périodes intégralement réglées sans quittance</h3>
            <ul className="muted small">
              <li>Chaque quittance reprend les paiements reçus et leurs dates ; elle est datée d’aujourd’hui.</li>
              <li>Les rappels de charges réglés sont repris sur la quittance du mois où ils sont exigibles.</li>
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
          </>}
          <p><strong>Total quittancé : {money2(chosen.reduce((s, i) => s + i.view.total + i.extras.reduce((t, x) => t + x.total, 0), 0) + chosenAligns.reduce((s, a) => s + a.paid, 0))}</strong></p>
          <p className="muted small">Rien n’est envoyé aux locataires : envoyez ensuite les quittances voulues depuis « Quittances et reçus ».</p>
        </>
      )}
      {backlog.orphans.length > 0 && (
        <p className="note">{backlog.orphans.length} rappel{backlog.orphans.length > 1 ? 's' : ''} de charges réglé{backlog.orphans.length > 1 ? 's' : ''} sans loyer à quittancer sur le même bail ({backlog.orphans.map((x) => `${periodLabel(x.charge)}, ${labelOf(x.charge.lease_id)}`).join(' ; ')}) : {backlog.orphans.length > 1 ? 'ils seront repris' : 'il sera repris'} sur la prochaine quittance de loyer.</p>
      )}
    </Modal>
  );
}
