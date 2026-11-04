/**
 * Enregistrement de la grille de Loyers et paiements (sans React, testable avec le dépôt de démonstration).
 *
 * - les lignes sont enregistrées bail par bail, du mois le plus ancien au plus récent ;
 * - après chaque ligne, le bail est remis en conformité (reports, répartition), si bien que la ligne suivante
 *   part des montants à jour ;
 * - une erreur arrête la saisie à la ligne concernée : les lignes précédentes restent enregistrées et
 *   recalculées, les suivantes restent à enregistrer (aucune saisie perdue) ;
 * - les documents annulés pour permettre la modification sont réémis à la fin si le mois le permet encore.
 */
import { RepoError, type Repo, type Snapshot } from '../../data/repo.ts';
import type { Payment, RentCharge } from '../../data/types.ts';
import { GridEditError, planLineEdit, sortEdits, type GridOp, type LineEdit } from '../../domain/gridEdits.ts';
import { ledgerSettings } from '../../domain/ledger.ts';
import { issueMonthDocs, syncLedgerSnapshot } from './ledgerSync.ts';

export interface GridSaveResult {
  /** Clés des lignes enregistrées. */
  saved: string[];
  /** Ligne non enregistrée et motif (les lignes suivantes ne sont pas tentées). */
  failed: { key: string; message: string } | null;
  cancelled: number;
  reissued: number;
}

/** Exécute les opérations d'une ligne en base ; les versions suivent les modifications successives. */
async function runOps(repo: Repo, snap: Snapshot, ops: GridOp[], reissue: Map<string, { lease_id: string; month: string; kind: 'quittance' | 'recu' }>): Promise<number> {
  const versions = new Map<string, number>();
  for (const c of snap.charges) versions.set(c.id, c.version);
  for (const p of snap.payments) versions.set(p.id, p.version);
  let cancelled = 0;
  const conflict = (what: string) => new RepoError(`${what} a été modifié entre-temps : rechargez la page, votre saisie est conservée.`);
  for (const o of ops) {
    switch (o.op) {
      case 'cancelReceipt': {
        await repo.cancelReceipt(o.id, o.reason);
        cancelled++;
        const k = `${o.lease_id}|${o.month}`;
        reissue.set(k, { lease_id: o.lease_id, month: o.month, kind: o.kind === 'quittance' || reissue.get(k)?.kind === 'quittance' ? 'quittance' : 'recu' });
        break;
      }
      case 'updateCharge': {
        const res = await repo.update('rent_charges', o.id, versions.get(o.id) ?? 1, o.patch);
        if (res.status !== 'ok') throw conflict('Une somme due');
        versions.set(o.id, (res.row as RentCharge).version);
        break;
      }
      case 'insertCharge': await repo.insert('rent_charges', { ...o.row, cancelled_at: null }); break;
      case 'removeCharge': await repo.remove('rent_charges', o.id); break;
      case 'updatePayment': {
        const res = await repo.update('payments', o.id, versions.get(o.id) ?? 1, o.patch);
        if (res.status !== 'ok') throw conflict('Un paiement');
        versions.set(o.id, (res.row as Payment).version);
        break;
      }
      case 'insertPayment': await repo.insert('payments', o.row); break;
      case 'removePayment': await repo.remove('payments', o.id); break;
      case 'removePaymentAllocations': await repo.removeWhere('payment_allocations', { payment_id: o.paymentId }); break;
    }
  }
  return cancelled;
}

export async function saveLedgerGrid(repo: Repo, edits: LineEdit[], today: string): Promise<GridSaveResult> {
  const out: GridSaveResult = { saved: [], failed: null, cancelled: 0, reissued: 0 };
  if (!edits.length) return out;
  const reissue = new Map<string, { lease_id: string; month: string; kind: 'quittance' | 'recu' }>();
  const touched = new Set<string>();
  let snap = await repo.loadAll();
  let dirty = false;
  for (const e of sortEdits(edits)) {
    try {
      const settings = ledgerSettings(snap.settings?.rental_settings);
      const ops = planLineEdit(snap, e, settings, today);
      touched.add(e.lease_id);
      dirty = true;
      out.cancelled += await runOps(repo, snap, ops, reissue);
      // remise en conformité du bail : la ligne suivante part des reports à jour
      snap = (await syncLedgerSnapshot(repo, { leaseIds: [e.lease_id] })).snap;
      dirty = false;
      out.saved.push(e.key);
    } catch (err) {
      out.failed = { key: e.key, message: err instanceof GridEditError || err instanceof RepoError ? err.message : `Enregistrement interrompu : ${(err as Error).message}` };
      break;
    }
  }
  // après une erreur au milieu d'une ligne : les baux touchés sont remis en conformité quand même
  if (dirty && touched.size) {
    try { snap = (await syncLedgerSnapshot(repo, { leaseIds: [...touched] })).snap; } catch { /* signalé par l'erreur d'origine */ }
  }
  if (reissue.size) {
    try { const again = await issueMonthDocs(repo, [...reissue.values()]); out.reissued = again.q + again.r; } catch { /* documents à réémettre depuis le tableau */ }
  }
  return out;
}
