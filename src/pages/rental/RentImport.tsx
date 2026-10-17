import { useMemo, useState } from 'react';
import { useStore } from '../../data/store.tsx';
import type { PaymentMethod } from '../../data/types.ts';
import { downloadBlob, toXlsx } from '../../domain/exporting.ts';
import { date, money2 } from '../../domain/format.ts';
import { parseDelimited, readImportFile, type Cell } from '../../domain/importing.ts';
import { PAYMENT_METHOD_LABELS } from '../../domain/rental.ts';
import { buildRentImportRows, planAllocations, RENT_IMPORT_COLUMNS, rentRowStatus, toPayment, type RentImportRow } from '../../domain/rentImport.ts';
import { Button, Modal, NotAvailable } from '../../ui/components.tsx';
import { useRental } from './common.tsx';

export async function downloadRentTemplate() {
  type R = { d: string; m: number; t: string; a: string; p: string; r: string; c: string };
  const rows: R[] = [
    { d: '2026-01-05', m: 850, t: 'Léa Martin', a: '8 passage Ruelle, 75018 Paris', p: 'Virement', r: 'VIR LOYER JANVIER', c: '' },
    { d: '2026-02-05', m: 850, t: 'Léa Martin', a: '8 passage Ruelle, 75018 Paris', p: 'Virement', r: 'VIR LOYER FEVRIER', c: '' },
  ];
  const cols: [string, (r: R) => string | number, ('date' | 'money')?][] = [['Date', (r) => r.d, 'date'], ['Montant', (r) => r.m, 'money'], ['Locataire', (r) => r.t], ['Appartement', (r) => r.a], ['Moyen', (r) => r.p], ['Référence', (r) => r.r], ['Commentaire', (r) => r.c]];
  downloadBlob(await toXlsx([{ name: 'Loyers', rows, columns: cols.map(([label, value, kind]) => ({ label, value, kind })) }]), 'immo-zen-modele-import-loyers.xlsx');
}

export function RentImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useStore();
  const { data } = store;
  const { views, leaseLabel } = useRental();
  const existing = useMemo(() => new Set(data.payments.map((p) => p.import_ref).filter((x): x is string => !!x)), [data.payments]);
  const [rows, setRows] = useState<RentImportRow[] | null>(null);
  const [source, setSource] = useState('');
  const [paste, setPaste] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reset = () => { setRows(null); setSource(''); setPaste(''); setError(null); };
  const close = () => { reset(); onClose(); };

  function load(cells: Cell[][], name: string) {
    const out = buildRentImportRows(cells, { leases: data.leases, properties: data.properties, links: data.leaseTenants, tenants: data.tenants });
    if (out.error) { setError(out.error); return; }
    if (!out.rows.length) { setError('Aucune ligne sous les en-têtes.'); return; }
    setError(null); setRows(out.rows); setSource(name);
  }

  const statuses = rows?.map((r) => rentRowStatus(r, existing)) ?? [];
  const ready = rows?.filter((_, i) => statuses[i]!.status === 'ok') ?? [];
  const count = (s: string) => statuses.filter((x) => x.status === s).length;
  const total = ready.reduce((a, r) => a + r.amount!, 0);
  const patch = (i: number, p: Partial<RentImportRow>) => setRows((rs) => rs && rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  async function doImport() {
    setBusy(true);
    try {
      let n = 0;
      const byLease = new Map<string, RentImportRow[]>();
      for (const r of ready) byLease.set(r.leaseId!, [...(byLease.get(r.leaseId!) ?? []), r]);
      for (const [leaseId, list] of byLease) {
        list.sort((a, b) => a.date!.localeCompare(b.date!));
        const created = await store.createMany('payments', list.map(toPayment));
        if (!created) break;
        n += created.length;
        // répartition sur les échéances encore dues du bail, dans l'ordre chronologique
        const open = views.filter((v) => v.charge.lease_id === leaseId && v.remaining > 0 && !v.charge.cancelled_at);
        const byRef = new Map(created.map((p) => [p.import_ref ?? '', p]));
        const plans = planAllocations(list.map((r) => ({ key: r.ref, amount: r.amount! })), open);
        const allocs = list.flatMap((r) => (plans.get(r.ref) ?? []).map((a) => ({ payment_id: byRef.get(r.ref)!.id, charge_id: a.charge_id, amount: a.amount })));
        if (allocs.length && !(await store.createMany('payment_allocations', allocs))) {
          store.notify('Paiements importés, mais leur répartition a été refusée : reprenez-la depuis le bail.', 'error');
          break;
        }
      }
      await store.refresh();
      if (n) { store.notify(`${n} loyer(s) importé(s) depuis ${source}.`); close(); }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} wide title="Importer des loyers" onClose={close}
      footer={rows ? <><Button onClick={reset}>Autre fichier</Button><Button variant="primary" disabled={busy || !ready.length} onClick={() => void doImport()}>{busy ? 'Import…' : `Importer ${ready.length} paiement(s)`}</Button></> : <Button onClick={close}>Fermer</Button>}>
      {!data.leases.length ? <NotAvailable>Créez d’abord le bail de chaque logement (Locataires et baux) : les loyers importés y sont rattachés.</NotAvailable> : !rows ? (
        <div className="import-start">
          <p>Fichier Excel (.xlsx) ou CSV avec les colonnes <strong>{RENT_IMPORT_COLUMNS.join(' · ')}</strong>. Seules « Date » et « Montant » sont obligatoires ; le bail est retrouvé d’après le locataire ou le logement, sinon choisi ligne par ligne.</p>
          <div className="row">
            <label className="btn btn-primary file-btn">Choisir un fichier
              <input type="file" accept=".xlsx,.xlsm,.csv,.txt,.xls" aria-label="Fichier de loyers" onChange={async (e) => {
                const f = e.target.files?.[0]; e.target.value = '';
                if (!f) return;
                try { load(await readImportFile(f), f.name); } catch (x) { setError(x instanceof Error ? x.message : 'Fichier illisible.'); }
              }} />
            </label>
            <Button onClick={() => void downloadRentTemplate()}>Télécharger le modèle Excel</Button>
          </div>
          <div className="field field-full">
            <label htmlFor="rent-paste">… ou collez les lignes copiées depuis Excel (en-têtes compris)</label>
            <textarea id="rent-paste" rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={RENT_IMPORT_COLUMNS.join('\t')} />
          </div>
          <Button disabled={!paste.trim()} onClick={() => load(parseDelimited(paste), 'le texte collé')}>Analyser le texte collé</Button>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
      ) : (
        <>
          <div className="import-summary" role="status">
            <span><strong>{rows.length}</strong> ligne(s) lue(s) dans {source}</span>
            <span className="pill pill-ok">{ready.length} prête(s)</span>
            {count('incomplet') > 0 && <span className="pill pill-warn">{count('incomplet')} à compléter</span>}
            {count('signe') > 0 && <span className="pill pill-warn">{count('signe')} écartée(s)</span>}
            {count('doublon') > 0 && <span className="pill pill-neutral">{count('doublon')} déjà importée(s)</span>}
            <span className="muted">Total {money2(total)}</span>
          </div>
          <div className="dt-scroll tall">
            <table className="dt-table compact import-table">
              <thead><tr><th>Ligne</th><th>Date</th><th className="num">Montant</th><th>Locataire / logement</th><th>Bail</th><th>Moyen</th><th>État</th></tr></thead>
              <tbody>{rows.map((r, i) => {
                const st = statuses[i]!;
                return (
                  <tr key={r.ref + i} className={st.status === 'ok' ? '' : st.status === 'doublon' ? 'muted' : 'row-warn'}>
                    <td>{r.line}</td>
                    <td>{r.date ? date(r.date) : '—'}</td>
                    <td className="num">{r.amount === null ? '—' : money2(r.amount)}</td>
                    <td className="wrap">{[r.rawTenant, r.rawProperty].filter(Boolean).join(' · ') || '—'}{r.reference && <small className="muted"> · {r.reference}</small>}</td>
                    <td><select aria-label={`Bail ligne ${r.line}`} value={r.leaseId ?? ''} disabled={st.status === 'doublon'} onChange={(e) => patch(i, { leaseId: e.target.value || null })}>
                      <option value="">Choisir…</option>{data.leases.map((l) => <option key={l.id} value={l.id}>{leaseLabel(l)}</option>)}
                    </select></td>
                    <td><select aria-label={`Moyen ligne ${r.line}`} value={r.method} onChange={(e) => patch(i, { method: e.target.value as PaymentMethod })}>
                      {(Object.entries(PAYMENT_METHOD_LABELS) as [PaymentMethod, string][]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select></td>
                    <td><span className={`pill pill-${st.status === 'ok' ? 'ok' : st.status === 'doublon' ? 'neutral' : 'warn'}`}>{st.message}</span></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          <p className="muted small">Chaque ligne devient un paiement du bail, réparti automatiquement sur les échéances dues les plus anciennes ; un excédent reste en avance. Un fichier réimporté ne crée pas de doublon. Les quittances ne sont émises qu’à votre demande (ou automatiquement si l’option du bail est active).</p>
        </>
      )}
    </Modal>
  );
}
