import { useMemo, useState } from 'react';
import { useStore } from '../../data/store.tsx';
import { RepoError, type Repo } from '../../data/repo.ts';
import type { Lease } from '../../data/types.ts';
import { date, money2, todayParis } from '../../domain/format.ts';
import { coherence, type CoherenceChoice, type CoherenceRow } from '../../domain/coherence.ts';
import { receiptBacklog } from '../../domain/receiptBacklog.ts';
import { chargeViews, leaseState, monthLabel } from '../../domain/rental.ts';
import { Button, Checkbox, Modal } from '../../ui/components.tsx';
import { periodLabel, useRental } from './common.tsx';

/** Baux concernés (un bail précis, ou tous les baux en cours ou terminés). */
function useLeases(leaseId?: string): Lease[] {
  const { data } = useStore();
  return useMemo(() => data.leases.filter((l) => (leaseId ? l.id === leaseId : leaseState(l, todayParis()) !== 'a_venir')), [data.leases, leaseId]);
}

/** Nombre d'actions que la mise en cohérence propose par défaut (alignements et quittances). */
export function useCoherenceCount(leaseId?: string): number {
  const { data } = useStore();
  const leases = useLeases(leaseId);
  return useMemo(() => leases.reduce((n, l) => n + coherence(l, data, todayParis()).suggested, 0), [leases, data]);
}

/**
 * Exécute la mise en cohérence d'un bail sur les données à jour :
 * reçus partiels périmés annulés, répartition refaite mois par mois, montants alignés sur les paiements,
 * mois sans paiement annulés (si demandé), puis quittances émises des plus anciennes aux plus récentes.
 */
async function runLease(repo: Repo, lease: Lease, choices: Record<string, CoherenceChoice>): Promise<{ issued: number; aligned: number; cancelled: number }> {
  const snap = await repo.loadAll();
  const today = todayParis();
  const c = coherence(lease, snap, today, choices);
  const touched = new Set([...c.plan.remove.map((a) => a.charge_id), ...c.plan.updates.map((u) => u.charge.id), ...c.cancels.map((x) => x.id)]);
  for (const r of snap.receipts.filter((x) => x.kind === 'recu' && !x.cancelled_at && touched.has(x.charge_id))) await repo.cancelReceipt(r.id, 'Remplacé : le paiement fait foi');
  for (const a of c.plan.remove) await repo.remove('payment_allocations', a.id);
  const versions = new Map((c.plan.updates.length ? (await repo.loadAll()).charges : []).map((x) => [x.id, x.version]));
  for (const u of c.plan.updates) {
    const res = await repo.update('rent_charges', u.charge.id, versions.get(u.charge.id) ?? u.charge.version, { rent_amount: u.rent_amount, charges_amount: u.charges_amount });
    if (res.status !== 'ok') throw new RepoError('Une échéance a été modifiée entre-temps : rechargez la page et recommencez.');
  }
  for (const x of c.cancels) {
    const fresh = (await repo.loadAll()).charges.find((y) => y.id === x.id);
    if (!fresh) continue;
    const res = await repo.update('rent_charges', x.id, fresh.version, { cancelled_at: new Date().toISOString(), cancel_reason: 'Aucun paiement reçu ce mois-là' });
    if (res.status !== 'ok') throw new RepoError('Une échéance a été modifiée entre-temps : rechargez la page et recommencez.');
  }
  if (c.plan.add.length) await repo.insertMany('payment_allocations', c.plan.add);
  const after = await repo.loadAll();
  const wanted = new Set(c.issues);
  const items = receiptBacklog(chargeViews(after.charges, after.allocations, today), after.receipts, lease.id).items.filter((i) => wanted.has(i.view.charge.id));
  let issued = 0;
  for (const i of items) {
    const extras = i.extras.map((x) => x.charge.id);
    await (extras.length ? repo.issueReceiptWithExtras(i.view.charge.id, extras) : repo.issueReceipt(i.view.charge.id, 'quittance'));
    issued++;
  }
  return { issued, aligned: c.plan.updates.length, cancelled: c.cancels.length };
}

const KIND_LABEL: Record<CoherenceRow['kind'], string> = { baisse: 'Payé moins', hausse: 'Payé plus', egal: 'Payé', vide: 'Aucun paiement' };

/**
 * Mise en cohérence des paiements et des quittances. Le paiement fait foi :
 * chaque paiement règle le loyer du mois de sa date (jamais celui d'un autre mois) et la quittance
 * du mois reprend la somme des paiements reçus ce mois-là. Aucune quittance n'est envoyée au locataire.
 */
export function ReceiptBacklogDialog({ open, onClose, leaseId }: { open: boolean; onClose: () => void; leaseId?: string }) {
  const store = useStore();
  const { data } = store;
  const { leaseLabel } = useRental();
  const leases = useLeases(leaseId);
  const [choices, setChoices] = useState<Record<string, CoherenceChoice>>({});
  const [busy, setBusy] = useState(false);
  const today = todayParis();
  const all = useMemo(() => leases.map((l) => ({ l, c: coherence(l, data, today, choices) })).filter((x) => x.c.needed || x.c.rows.some((r) => r.kind === 'vide')), [leases, data, today, choices]);
  const set = (id: string, p: CoherenceChoice) => setChoices((c) => ({ ...c, [id]: { ...c[id], ...p } }));
  const issues = all.reduce((n, x) => n + x.c.issues.length, 0);
  const needed = all.some((x) => x.c.needed);

  async function run() {
    setBusy(true);
    let issued = 0, aligned = 0, cancelled = 0, failed = 0;
    try {
      for (const { l, c } of all) {
        if (!c.needed) continue;
        const r = await store.call((repo) => runLease(repo, l, choices));
        if (r) { issued += r.issued; aligned += r.aligned; cancelled += r.cancelled; } else failed++;
      }
      await store.refresh();
      const parts = [issued && `${issued} quittance${issued > 1 ? 's' : ''} émise${issued > 1 ? 's' : ''}`, aligned && `${aligned} échéance${aligned > 1 ? 's' : ''} alignée${aligned > 1 ? 's' : ''} sur le montant payé`,
        cancelled && `${cancelled} mois sans paiement annulé${cancelled > 1 ? 's' : ''}`].filter(Boolean).join(', ');
      store.notify(failed ? `${parts || 'Aucune modification'} ; ${failed} bail(s) en échec : rechargez la page et recommencez.` : `Paiements et quittances en cohérence${parts ? ` : ${parts}` : ''}.`, failed ? 'error' : undefined);
      if (!failed) { setChoices({}); onClose(); }
    } finally { setBusy(false); }
  }

  return (
    <Modal open={open} wide title="Mettre en cohérence paiements et quittances" onClose={() => { if (!busy) onClose(); }}
      footer={<>
        <Button disabled={busy} onClick={onClose}>Fermer</Button>
        <Button variant="primary" disabled={busy || !needed} onClick={() => void run()}>
          {busy ? 'Mise en cohérence…' : issues ? `Mettre en cohérence et émettre ${issues} quittance${issues > 1 ? 's' : ''}` : 'Mettre en cohérence'}
        </Button>
      </>}>
      {!all.length ? <p>Chaque paiement règle déjà le mois de sa date et chaque mois réglé a sa quittance : rien à faire.</p> : <>
        <p><strong>Le paiement fait foi</strong> : chaque paiement règle le loyer du mois de sa date, jamais celui d’un autre mois, et la quittance d’un mois reprend la somme des paiements reçus ce mois-là.</p>
        <ul className="muted small">
          <li><strong>Payé moins</strong> que l’échéance (ancien loyer, historique importé) : l’échéance est ramenée au montant payé — décochez si le locataire doit réellement le reste.</li>
          <li><strong>Payé plus</strong> : proposé si la somme ne dépasse pas le loyer du bail ; au-delà (rattrapage, doublon), à cocher vous-même, sinon l’excédent reste en avance.</li>
          <li><strong>Aucun paiement</strong> enregistré pour un mois passé : l’échéance reste due ; cochez « Annuler » si ce mois est antérieur à votre suivi dans Immo-Zen.</li>
          <li>Les mois déjà quittancés ne sont pas modifiés. Rien n’est envoyé aux locataires.</li>
        </ul>
        {all.map(({ l, c }) => (
          <div key={l.id} className="backlog-lease">
            <h3>{leaseLabel(l)}</h3>
            <div className="dt-scroll"><table className="dt-table compact">
              <thead><tr><th>Mois</th><th className="num">Reçu dans le mois</th><th className="num">Échéance</th><th>Situation</th><th>Aligner sur le payé</th><th className="num">Dû après</th><th>Quittance</th></tr></thead>
              <tbody>{c.rows.map((r) => {
                const id = r.m.charge.id;
                const ml = periodLabel(r.m.charge);
                return (
                  <tr key={id} className={r.kind === 'vide' && !r.cancel ? 'row-warn' : r.cancel ? 'muted' : ''}>
                    <td>{ml}{!r.m.past && <small className="muted block">mois en cours</small>}</td>
                    <td className="num"><strong>{money2(r.m.received)}</strong></td>
                    <td className="num">{money2(r.m.total)}</td>
                    <td><span className={`pill pill-${r.kind === 'egal' ? 'ok' : r.kind === 'vide' ? 'warn' : 'neutral'}`}>{KIND_LABEL[r.kind]}</span></td>
                    <td>{r.kind === 'baisse' || r.kind === 'hausse'
                      ? <Checkbox label={`Aligner ${ml} sur ${money2(r.m.received)}`} checked={r.align} onChange={(on) => set(id, { align: on })} />
                      : r.kind === 'vide' && r.m.past
                        ? <Checkbox label={`Annuler l’échéance de ${ml}`} checked={r.cancel} onChange={(on) => set(id, { cancel: on })} />
                        : '—'}</td>
                    <td className="num">{r.cancel ? 'annulée' : <>{money2(r.target)}{r.paidAfter < r.target && <small className="neg block">reste {money2(r.target - r.paidAfter)}</small>}</>}</td>
                    <td>{r.canIssue ? <Checkbox label={`Quittance ${ml}`} checked={r.issue} onChange={(on) => set(id, { issue: on })} /> : <span className="muted small">{r.cancel ? '—' : r.paidAfter > 0 ? 'partiel' : 'non réglé'}</span>}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
            <p className="small">{[c.frozen > 0 && `${c.frozen} mois déjà quittancé${c.frozen > 1 ? 's' : ''}, inchangé${c.frozen > 1 ? 's' : ''}`,
              c.advance > 0 && `avance au crédit du locataire après l’opération : ${money2(c.advance)}`].filter(Boolean).join(' · ')}</p>
            {c.orphans.length > 0 && <p className="note small">{c.orphans.length} paiement{c.orphans.length > 1 ? 's' : ''} daté{c.orphans.length > 1 ? 's' : ''} d’un mois sans échéance de loyer (avant le début du bail ou mois annulé) : {c.orphans.slice(0, 6).map((p) => `${money2(p.amount)} le ${date(p.paid_on)}`).join(', ')}{c.orphans.length > 6 ? '…' : ''}. {c.orphans.length > 1 ? 'Ils restent' : 'Il reste'} en avance ; vérifiez la date de début du bail ({monthLabel(l.start_date)}).</p>}
          </div>
        ))}
      </>}
    </Modal>
  );
}
