import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../data/store.tsx';
import { date, money2 } from '../../domain/format.ts';
import { incomeDate, MATCH_DAYS, type IncomeDuplicate } from '../../domain/incomeOverlap.ts';
import { round2 } from '../../domain/simulator.ts';
import { Button, Modal, useConfirm } from '../../ui/components.tsx';

/**
 * Nettoyage des recettes de relevé en double d'un paiement saisi sur le bail (ANO-013, volet 3).
 * Rien n'est supprimé sans confirmation ; les lignes au montant identique sont cochées par défaut,
 * les autres (même mois, montant différent) restent à cocher à la main.
 */
export function IncomeCleanupDialog({ open, items, titles, onClose }: { open: boolean; items: IncomeDuplicate[]; titles: Map<string, string>; onClose: () => void }) {
  const store = useStore();
  const { ask, dialog } = useConfirm();
  /** Choix faits à la main ; à défaut, les montants identiques sont cochés. */
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setOverrides(new Map()); }, [open]);
  const isPicked = (x: IncomeDuplicate) => overrides.get(x.expense.id) ?? x.identical;
  const setAll = (f: (x: IncomeDuplicate) => boolean) => setOverrides(new Map(items.map((x) => [x.expense.id, f(x)])));

  const chosen = items.filter(isPicked);
  const total = round2(chosen.reduce((a, x) => a + x.expense.amount, 0));
  const byProperty = useMemo(() => {
    const m = new Map<string, { n: number; amount: number }>();
    for (const x of items) {
      const t = m.get(x.expense.property_id) ?? { n: 0, amount: 0 };
      m.set(x.expense.property_id, { n: t.n + 1, amount: round2(t.amount + x.expense.amount) });
    }
    return [...m.entries()];
  }, [items]);
  const toggle = (id: string, on: boolean) => setOverrides((s) => new Map(s).set(id, on));

  async function run() {
    if (!chosen.length) return;
    const ok = await ask('Supprimer les recettes en double',
      `${chosen.length} recette${chosen.length > 1 ? 's' : ''} importée${chosen.length > 1 ? 's' : ''} (${money2(total)}) ${chosen.length > 1 ? 'seront supprimées' : 'sera supprimée'} de Dépenses. Les paiements saisis sur les baux ne changent pas. Un relevé réimporté ne les recréera pas en recettes.`,
      'Supprimer');
    if (!ok) return;
    setBusy(true);
    try {
      const n = await store.call(async (repo) => {
        let k = 0;
        for (const x of chosen) { await repo.remove('expenses', x.expense.id); k++; }
        return k;
      });
      if (n) { store.notify(`${n} recette${n > 1 ? 's' : ''} en double supprimée${n > 1 ? 's' : ''}.`); onClose(); }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} wide title="Recettes importées en double des loyers" onClose={onClose}
      footer={<>
        <Button onClick={onClose}>Fermer</Button>
        <Button variant="danger" disabled={busy || !chosen.length} onClick={() => void run()}>{busy ? 'Suppression…' : `Supprimer ${chosen.length} recette${chosen.length > 1 ? 's' : ''} (${money2(total)})`}</Button>
      </>}>
      <p>Ces recettes « Loyer » importées d’un relevé correspondent à des paiements déjà saisis sur le bail. Elles ne sont plus additionnées aux loyers, mais vous pouvez les supprimer pour que Dépenses ne garde que les vraies dépenses et recettes.</p>
      <ul className="income-cleanup-summary">
        {byProperty.map(([pid, t]) => <li key={pid}>{titles.get(pid) ?? '—'} : {t.n} recette{t.n > 1 ? 's' : ''}, {money2(t.amount)}</li>)}
      </ul>
      <p className="muted small">Cochées par défaut : même montant qu’un paiement saisi (à {MATCH_DAYS} jours près) ou que le total du mois. Les autres coïncident seulement par le mois : vérifiez-les avant de les cocher.</p>
      <div className="row">
        <Button size="sm" onClick={() => setAll(() => true)}>Tout cocher</Button>
        <Button size="sm" onClick={() => setAll((x) => x.identical)}>Montants identiques seulement</Button>
        <Button size="sm" onClick={() => setAll(() => false)}>Tout décocher</Button>
      </div>
      <div className="dt-scroll tall">
        <table className="dt-table compact income-cleanup-table">
          <thead><tr><th><span className="sr-only">Supprimer</span></th><th>Date</th><th>Bien</th><th>Libellé du relevé</th><th className="num">Recette importée</th><th>Paiement saisi sur le bail</th></tr></thead>
          <tbody>
            {items.map((x) => (
              <tr key={x.expense.id} className={x.identical ? '' : 'row-warn'}>
                <td><input type="checkbox" aria-label={`Supprimer la recette du ${date(incomeDate(x.expense))} (${money2(x.expense.amount)})`} checked={isPicked(x)} onChange={(e) => toggle(x.expense.id, e.target.checked)} /></td>
                <td>{date(incomeDate(x.expense))}</td>
                <td>{titles.get(x.expense.property_id) ?? '—'}</td>
                <td className="wrap">{x.expense.label || '—'}</td>
                <td className="num">{money2(x.expense.amount)}</td>
                <td>{x.payment ? `${money2(x.payment.amount)} le ${date(x.payment.paid_on)}` : x.identical ? 'même montant sur le mois' : <span className="pill pill-warn">même mois, montant différent</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dialog}
    </Modal>
  );
}
