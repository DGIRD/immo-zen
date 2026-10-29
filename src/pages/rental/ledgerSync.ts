/**
 * Mise en conformité des lignes mensuelles (src/domain/ledger.ts) : applique le plan calculé pour chaque bail.
 * Appelée à l'ouverture de Loyers et paiements et après chaque paiement, import ou modification d'une somme due.
 */
import type { Repo, Snapshot } from '../../data/repo.ts';
import { RepoError } from '../../data/repo.ts';
import type { RentCharge } from '../../data/types.ts';
import { todayParis } from '../../domain/format.ts';
import { emptyPlan, ledgerPlan, ledgerSettings, planSize, type LedgerPlan } from '../../domain/ledger.ts';
import { leaseState, monthOf } from '../../domain/rental.ts';

export interface SyncOptions {
  /** Baux concernés (tous par défaut). */
  leaseIds?: string[];
  /** Reprise : rétablir les loyers annulés sans motif. */
  restoreCancelled?: boolean;
}

/** Plans de tous les baux à partir d'un instantané (sans rien écrire). */
export function ledgerPlans(snap: Snapshot, opts: SyncOptions = {}, today = todayParis()): { leaseId: string; plan: LedgerPlan }[] {
  const settings = ledgerSettings(snap.settings?.rental_settings);
  return snap.leases.filter((l) => !opts.leaseIds || opts.leaseIds.includes(l.id)).map((l) => ({
    leaseId: l.id,
    plan: ledgerPlan({ lease: l, charges: snap.charges, payments: snap.payments, allocations: snap.allocations, receipts: snap.receipts, settings, today, restoreCancelled: opts.restoreCancelled }),
  })).filter((x) => !emptyPlan(x.plan));
}

/** Applique un plan : affectations retirées, sommes supprimées, reports créés, sommes modifiées, affectations créées. */
export async function applyLedgerPlan(repo: Repo, plan: LedgerPlan): Promise<number> {
  for (const a of plan.deleteAllocations) await repo.remove('payment_allocations', a.id);
  for (const c of plan.deleteCharges) await repo.remove('rent_charges', c.id);
  const ids = new Map<string, string>();
  const versions = new Map<string, number>();
  if (plan.createCharges.length) {
    const created = await repo.insertMany('rent_charges', plan.createCharges.map((x) => ({ ...x.row, carried_to: null })));
    for (const x of plan.createCharges) {
      const c = created.find((y) => y.lease_id === x.row.lease_id && y.kind === 'report' && y.period_start === x.row.period_start);
      if (!c) throw new RepoError('Le report du reste dû n’a pas pu être créé : rechargez la page.');
      ids.set(x.key, c.id); versions.set(c.id, c.version);
    }
  }
  const ref = (r: string | null | undefined) => (r && r.startsWith('new:') ? ids.get(r) ?? null : r ?? null);
  const update = async (id: string, version: number, patch: Partial<RentCharge>) => {
    const res = await repo.update('rent_charges', id, version, patch);
    if (res.status !== 'ok') throw new RepoError('Une somme due a été modifiée entre-temps : rechargez la page puis réessayez.');
  };
  for (const x of plan.createCharges) if (x.row.carried_to) {
    const id = ids.get(x.key)!;
    await update(id, versions.get(id)!, { carried_to: ref(x.row.carried_to) });
  }
  for (const u of plan.updateCharges) {
    const patch: Partial<RentCharge> = { ...u.patch };
    if ('carried_to' in u.patch) patch.carried_to = ref(u.patch.carried_to);
    await update(u.charge.id, u.charge.version, patch);
  }
  if (plan.createAllocations.length) {
    await repo.insertMany('payment_allocations', plan.createAllocations.map((a) => ({ payment_id: a.payment_id, charge_id: ref(a.charge)!, amount: a.amount })));
  }
  return planSize(plan);
}

/**
 * Crée les lignes manquantes (jusqu'au mois en cours) puis met les baux en conformité.
 * Renvoie le nombre d'écritures. Deux passes au plus : la première peut créer un report que la seconde complète.
 */
export async function syncLedgerWith(repo: Repo, opts: SyncOptions = {}): Promise<number> {
  const today = todayParis();
  let snap = await repo.loadAll();
  let n = 0;
  const missing = snap.leases.filter((l) => (!opts.leaseIds || opts.leaseIds.includes(l.id)) && leaseState(l, today) !== 'a_venir'
    && (leaseState(l, today) === 'actif' || !snap.charges.some((c) => c.lease_id === l.id && c.kind === 'loyer'))
    && !snap.charges.some((c) => c.lease_id === l.id && c.kind === 'loyer' && monthOf(c.period_start) === monthOf(l.end_date && l.end_date < today ? l.end_date : today)));
  for (const l of missing) n += await repo.generateCharges(l.id);
  if (n) snap = await repo.loadAll();
  for (let pass = 0; pass < 2; pass++) {
    const plans = ledgerPlans(snap, opts, today);
    if (!plans.length) break;
    for (const { plan } of plans) n += await applyLedgerPlan(repo, plan);
    snap = await repo.loadAll();
  }
  return n;
}
