/**
 * Actions sur une ligne mensuelle de Loyers et paiements : qualifier un excédent, émettre la quittance du mois,
 * confirmer la réception, et remise en conformité après chaque écriture.
 */
import { useState } from 'react';
import { useStore } from '../../data/store.tsx';
import { RepoError, type Repo } from '../../data/repo.ts';
import type { Lease, Receipt, RentCharge } from '../../data/types.ts';
import { money2, todayParis } from '../../domain/format.ts';
import { EXCESS_LABELS, ledgerRows, ledgerSettings, mmYYYY, monthQuittance, type ExcessChoice, type LedgerRow } from '../../domain/ledger.ts';
import { monthLabel } from '../../domain/rental.ts';
import { round2 } from '../../domain/simulator.ts';
import { Button, Checkbox, Modal, TextInput } from '../../ui/components.tsx';
import { syncLedgerWith, type SyncOptions } from './ledgerSync.ts';

/** Remise en conformité des lignes (création des lignes manquantes, répartition, reports). */
export function useLedgerSync() {
  const store = useStore();
  return (opts: SyncOptions = {}) => store.call((r) => syncLedgerWith(r, opts));
}

export interface ExcessDecision {
  choice: ExcessChoice;
  /** Autre somme due : libellé. */
  label?: string;
  /** Loyer supérieur : appliquer aussi le nouveau loyer au bail (mois suivants). */
  applyToLease?: boolean;
  /** Trop-perçu : reporter en avance sur le mois suivant. */
  advance?: boolean;
}

async function fresh(repo: Repo, id: string): Promise<RentCharge> {
  const c = (await repo.loadAll()).charges.find((x) => x.id === id);
  if (!c) throw new RepoError('Ligne introuvable : rechargez la page.');
  return c;
}

/**
 * Qualifie l'excédent `amount` reçu sur le mois du loyer `loyerId` :
 * autre somme due (ajoutée au mois), loyer supérieur (loyer du mois porté au montant reçu, et du bail si demandé)
 * ou trop-perçu (laissé sur la ligne, ou reporté en avance sur le mois suivant).
 */
export async function applyExcess(repo: Repo, loyerId: string, amount: number, d: ExcessDecision): Promise<void> {
  const loyer = await fresh(repo, loyerId);
  const excess = round2(amount);
  if (!(excess > 0)) return;
  if (d.choice === 'autre') {
    await repo.insert('rent_charges', {
      lease_id: loyer.lease_id, kind: 'autre', period_start: loyer.period_start, period_end: loyer.period_end, due_date: loyer.due_date,
      rent_amount: excess, charges_amount: 0, label: d.label?.trim().slice(0, 200) || `Autre somme due ${mmYYYY(loyer.period_start.slice(0, 7))}`,
    });
  } else if (d.choice === 'loyer') {
    const rent = round2(loyer.rent_amount + excess);
    const res = await repo.update('rent_charges', loyer.id, loyer.version, { rent_amount: rent, excess_mode: null });
    if (res.status !== 'ok') throw new RepoError('La ligne a été modifiée entre-temps : rechargez la page.');
    if (d.applyToLease) {
      const snap = await repo.loadAll();
      const l = snap.leases.find((x) => x.id === loyer.lease_id);
      // loyer d'un mois complet : il devient celui du bail (mois suivants)
      const full = loyer.period_start.endsWith('-01') && Number(loyer.period_end.slice(8)) >= 28;
      if (l && full) {
        const r = await repo.update('leases', l.id, l.version, { rent_hc: rent } as Partial<Lease>);
        if (r.status !== 'ok') throw new RepoError('Le bail a été modifié entre-temps : rechargez la page.');
      }
    }
  } else {
    const res = await repo.update('rent_charges', loyer.id, loyer.version, { excess_mode: d.advance ? 'avance' : 'trop_percu' });
    if (res.status !== 'ok') throw new RepoError('La ligne a été modifiée entre-temps : rechargez la page.');
  }
}

/** Émet la quittance (ou le reçu partiel) des mois indiqués, à partir des données à jour. Renvoie le nombre émis. */
export async function issueMonthDocs(repo: Repo, months: { lease_id: string; month: string; kind: 'quittance' | 'recu' }[]): Promise<{ q: number; r: number; issued: Receipt[] }> {
  const snap = await repo.loadAll();
  const rows = ledgerRows(snap, ledgerSettings(snap.settings?.rental_settings), todayParis());
  let q = 0, r = 0;
  const issued: Receipt[] = [];
  for (const m of months) {
    const row = rows.find((x) => x.lease_id === m.lease_id && x.month === m.month);
    if (!row?.loyer || row.loyer.cancelled_at) continue;
    if (m.kind === 'quittance') {
      const plan = monthQuittance(row, snap.allocations, snap.receipts);
      if (!plan) continue;
      issued.push(await (plan.extras.length ? repo.issueReceiptWithExtras(plan.chargeId, plan.extras) : repo.issueReceipt(plan.chargeId, 'quittance')));
      q++;
    } else {
      const paidOnLoyer = round2(snap.allocations.filter((a) => a.charge_id === row.loyer!.id).reduce((s, a) => s + a.amount, 0));
      if (paidOnLoyer <= 0 || paidOnLoyer >= round2(row.loyer.rent_amount + row.loyer.charges_amount)) continue;
      issued.push(await repo.issueReceipt(row.loyer.id, 'recu'));
      r++;
    }
  }
  return { q, r, issued };
}

/** Choix proposé pour un excédent : nature, libellé, options. */
export function ExcessFields({ value, onChange, excess, month, allowLater = false }: {
  value: ExcessDecision | null; onChange: (d: ExcessDecision | null) => void; excess: number; month: string; allowLater?: boolean;
}) {
  const choice = value?.choice ?? '';
  return (
    <div className="excess-fields">
      <label className="inline-select">Excédent de {money2(excess)} sur {monthLabel(`${month}-01`)}
        <select aria-label={`Nature de l’excédent de ${monthLabel(`${month}-01`)}`} value={choice} onChange={(e) => {
          const c = e.target.value as ExcessChoice | '';
          onChange(c ? { choice: c, label: c === 'autre' ? value?.label ?? 'Régularisation de charges' : undefined, applyToLease: false, advance: false } : null);
        }}>
          <option value="">{allowLater ? 'À qualifier plus tard' : 'Choisir…'}</option>
          {(Object.entries(EXCESS_LABELS) as [ExcessChoice, string][]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      {value?.choice === 'autre' && <TextInput label="Libellé de la somme due" value={value.label ?? ''} onChange={(v) => onChange({ ...value, label: v })} maxLength={200} />}
      {value?.choice === 'loyer' && <Checkbox label="Appliquer ce loyer au bail pour les mois suivants" checked={!!value.applyToLease} onChange={(on) => onChange({ ...value, applyToLease: on })} />}
      {value?.choice === 'trop_percu' && <Checkbox label="Reporter en avance sur le mois suivant" checked={!!value.advance} onChange={(on) => onChange({ ...value, advance: on })} />}
    </div>
  );
}

/** Fenêtre « Qualifier l'écart » d'une ligne dont le réglé dépasse le dû. */
export function useExcessDialog() {
  const store = useStore();
  const [row, setRow] = useState<LedgerRow | null>(null);
  const [d, setD] = useState<ExcessDecision | null>(null);
  const [busy, setBusy] = useState(false);
  const open = (r: LedgerRow) => { setRow(r); setD(null); };
  const save = async () => {
    if (!row?.loyer || !d) return;
    setBusy(true);
    try {
      const ok = await store.call(async (repo) => { await applyExcess(repo, row.loyer!.id, row.gap, d); await syncLedgerWith(repo, { leaseIds: [row.lease_id] }); return true; },
        d.choice === 'autre' ? 'Autre somme due ajoutée au mois.' : d.choice === 'loyer' ? 'Loyer du mois porté au montant reçu.' : d.advance ? 'Trop-perçu reporté en avance sur le mois suivant.' : 'Trop-perçu conservé sur la ligne.');
      if (ok) setRow(null);
    } finally { setBusy(false); }
  };
  const ui = (
    <Modal open={!!row} title={row ? `Qualifier l’écart de ${monthLabel(`${row.month}-01`)}` : ''} onClose={() => setRow(null)}
      footer={<><Button onClick={() => setRow(null)}>Annuler</Button><Button variant="primary" disabled={busy || !d} onClick={() => void save()}>{busy ? 'Enregistrement…' : 'Enregistrer'}</Button></>}>
      {row && <>
        <p>Réglé ce mois-ci : <strong>{money2(row.paid)}</strong> pour {money2(row.due)} dus, soit {money2(row.gap)} de plus. S’agit-il d’une autre somme due, d’un loyer supérieur ou d’un trop-perçu ?</p>
        <ExcessFields value={d} onChange={setD} excess={row.gap} month={row.month} />
      </>}
    </Modal>
  );
  return { open, ui };
}
