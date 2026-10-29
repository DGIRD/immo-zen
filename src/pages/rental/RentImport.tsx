import { useMemo, useState } from 'react';
import { useStore } from '../../data/store.tsx';
import type { PaymentMethod } from '../../data/types.ts';
import { downloadBlob, toXlsx } from '../../domain/exporting.ts';
import { date, money2, todayParis } from '../../domain/format.ts';
import { parseDelimited, readImportFile, type Cell } from '../../domain/importing.ts';
import { ledgerRows, ledgerSettings, mmYYYY } from '../../domain/ledger.ts';
import { monthLabel, PAYMENT_METHOD_LABELS } from '../../domain/rental.ts';
import { buildRentImportRows, importMonth, importMonths, RENT_IMPORT_COLUMNS, rentRowStatus, toPayment, type ImportMonth, type RentImportRow } from '../../domain/rentImport.ts';
import { round2 } from '../../domain/simulator.ts';
import { Button, Checkbox, Modal, NotAvailable } from '../../ui/components.tsx';
import { useRental } from './common.tsx';
import { syncLedgerWith } from './ledgerSync.ts';
import { applyExcess, ExcessFields, issueMonthDocs, type ExcessDecision } from './monthActions.tsx';

type DocChoice = 'quittance' | 'recu' | 'aucun';

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
  const { leaseLabel, leaseById } = useRental();
  const today = todayParis();
  const existing = useMemo(() => new Set(data.payments.map((p) => p.import_ref).filter((x): x is string => !!x)), [data.payments]);
  const [rows, setRows] = useState<RentImportRow[] | null>(null);
  const [source, setSource] = useState('');
  const [paste, setPaste] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Document choisi par bail et par mois (clé bail|AAAA-MM). */
  const [docs, setDocs] = useState<Record<string, DocChoice>>({});
  /** Nature de l'excédent par bail et par mois. */
  const [excess, setExcess] = useState<Record<string, ExcessDecision | null>>({});
  const reset = () => { setRows(null); setSource(''); setPaste(''); setError(null); setDocs({}); setExcess({}); };
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
  const ledger = useMemo(() => ledgerRows(data, ledgerSettings(data.settings?.rental_settings), today), [data, today]);
  const months = useMemo(() => importMonths(ready, ledger), [ready, ledger]);
  const keyOf = (m: { lease_id: string; month: string }) => `${m.lease_id}|${m.month}`;
  // quittance proposée (cochée) pour un mois intégralement réglé ; reçu partiel au choix sinon
  const choice = (m: ImportMonth): DocChoice => docs[keyOf(m)] ?? (m.settles ? 'quittance' : 'aucun');
  const toIssue = months.filter((m) => m.row?.loyer && choice(m) !== 'aucun');

  async function doImport() {
    setBusy(true);
    try {
      const out = await store.call(async (repo) => {
        let n = 0;
        const byLease = new Map<string, RentImportRow[]>();
        for (const r of ready) byLease.set(r.leaseId!, [...(byLease.get(r.leaseId!) ?? []), r]);
        for (const list of byLease.values()) {
          list.sort((a, b) => a.date!.localeCompare(b.date!));
          n += (await repo.insertMany('payments', list.map(toPayment))).length;
        }
        const leaseIds = [...byLease.keys()];
        await syncLedgerWith(repo, { leaseIds });
        // excédents qualifiés : autre somme due, loyer supérieur ou trop-perçu
        let x = 0;
        for (const m of months) {
          const d = excess[keyOf(m)];
          if (d && m.over > 0 && m.row?.loyer) { await applyExcess(repo, m.row.loyer.id, m.over, d); x++; }
        }
        if (x) await syncLedgerWith(repo, { leaseIds });
        const docsOut = await issueMonthDocs(repo, toIssue.map((m) => ({ lease_id: m.lease_id, month: m.month, kind: choice(m) === 'recu' ? 'recu' as const : 'quittance' as const })));
        return { n, x, ...docsOut };
      });
      if (out?.n) {
        const extra = [out.q && `${out.q} quittance(s)`, out.r && `${out.r} reçu(s) partiel(s)`, out.x && `${out.x} excédent(s) qualifié(s)`].filter(Boolean);
        store.notify(`${out.n} paiement(s) importé(s) depuis ${source}${extra.map((e) => ` ; ${e}`).join('')}.`);
        close();
      }
    } finally {
      setBusy(false);
    }
  }

  const monthOptions = (leaseId: string | null, d: string | null) => {
    const own = [...new Set(ledger.filter((r) => r.lease_id === leaseId && r.loyer).map((r) => r.month))];
    return [...new Set([...(d ? [d.slice(0, 7)] : []), ...own])].sort().reverse();
  };

  return (
    <Modal open={open} wide title="Importer un relevé de loyers" onClose={close}
      footer={rows ? <><Button onClick={reset}>Autre fichier</Button><Button variant="primary" disabled={busy || !ready.length} onClick={() => void doImport()}>{busy ? 'Import…' : `Importer ${ready.length} paiement(s)${toIssue.length ? ` et émettre ${toIssue.length} document(s)` : ''}`}</Button></> : <Button onClick={close}>Fermer</Button>}>
      {!data.leases.length ? <NotAvailable>Créez d’abord le bail de chaque logement (Locataires et baux) : les loyers importés y sont rattachés.</NotAvailable> : !rows ? (
        <div className="import-start">
          <p>Relevé bancaire ou fichier Excel (.xlsx), CSV, avec les colonnes <strong>{RENT_IMPORT_COLUMNS.join(' · ')}</strong>. Seules « Date » et « Montant » sont obligatoires ; le bail est retrouvé d’après le locataire ou le logement, sinon choisi ligne par ligne. Chaque paiement remplit la colonne « Réglé » de la ligne du mois de sa date.</p>
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
              <thead><tr><th>Ligne</th><th>Date</th><th className="num">Montant</th><th>Locataire / logement</th><th>Bail</th><th>Mois concerné</th><th>Moyen</th><th>État</th></tr></thead>
              <tbody>{rows.map((r, i) => {
                const st = statuses[i]!;
                const m = importMonth(r);
                return (
                  <tr key={r.ref + i} className={st.status === 'ok' ? '' : st.status === 'doublon' ? 'muted' : 'row-warn'}>
                    <td>{r.line}</td>
                    <td>{r.date ? date(r.date) : '—'}</td>
                    <td className="num">{r.amount === null ? '—' : money2(r.amount)}</td>
                    <td className="wrap">{[r.rawTenant, r.rawProperty].filter(Boolean).join(' · ') || '—'}{r.reference && <small className="muted"> · {r.reference}</small>}</td>
                    <td><select aria-label={`Bail ligne ${r.line}`} value={r.leaseId ?? ''} disabled={st.status === 'doublon'} onChange={(e) => patch(i, { leaseId: e.target.value || null })}>
                      <option value="">Choisir…</option>{data.leases.map((l) => <option key={l.id} value={l.id}>{leaseLabel(l)}</option>)}
                    </select></td>
                    <td>{r.date ? <select aria-label={`Mois concerné ligne ${r.line}`} value={m ?? ''} disabled={st.status === 'doublon'}
                      onChange={(e) => patch(i, { month: e.target.value === r.date!.slice(0, 7) ? null : e.target.value })}>
                      {monthOptions(r.leaseId, r.date).map((x) => <option key={x} value={x}>{monthLabel(`${x}-01`)}{x === r.date!.slice(0, 7) ? '' : ' (déplacé)'}</option>)}
                    </select> : '—'}</td>
                    <td><select aria-label={`Moyen ligne ${r.line}`} value={r.method} onChange={(e) => patch(i, { method: e.target.value as PaymentMethod })}>
                      {(Object.entries(PAYMENT_METHOD_LABELS) as [PaymentMethod, string][]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select></td>
                    <td><span className={`pill pill-${st.status === 'ok' ? 'ok' : st.status === 'doublon' ? 'neutral' : 'warn'}`}>{st.message}</span></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          {months.length > 0 && (
            <div className="month-proposals">
              <h3>Aperçu par mois</h3>
              <p className="muted small">Les paiements d’un même mois sont additionnés dans la colonne « Réglé » de la ligne de ce mois. Un paiement reçu un autre mois (loyer payé en retard ou en avance) peut être déplacé ci-dessus. Si le réglé dépasse le dû, précisez la nature de l’excédent ; un mois échu resté partiel reporte son reste dû sur le mois suivant.</p>
              <div className="dt-scroll">
                <table className="dt-table compact">
                  <thead><tr><th>Bail</th><th>Mois</th><th className="num">Importé</th><th className="num">Dû</th><th className="num">Réglé avant</th><th className="num">Réglé après</th><th className="num">Écart</th><th>Excédent / document</th></tr></thead>
                  <tbody>{months.map((m) => {
                    const l = leaseById.get(m.lease_id);
                    const ml = monthLabel(`${m.month}-01`);
                    const gap = round2(m.after - m.due);
                    return (
                      <tr key={keyOf(m)} className={!m.row?.loyer || (m.over > 0 && !excess[keyOf(m)]) ? 'row-warn' : ''}>
                        <td className="wrap">{l ? leaseLabel(l) : '—'}</td>
                        <td>{ml}{m.count > 1 && <small className="muted block">{m.count} paiements additionnés</small>}</td>
                        <td className="num">{money2(m.received)}</td>
                        <td className="num">{m.row?.loyer ? money2(m.due) : '—'}</td>
                        <td className="num">{money2(m.before)}</td>
                        <td className="num">{money2(m.after)}</td>
                        <td className="num"><span className={gap < 0 ? 'neg' : gap > 0 ? 'pos' : ''}>{gap > 0 ? '+' : ''}{money2(gap)}</span></td>
                        <td>
                          {!m.row?.loyer ? <span className="pill pill-warn">Aucune ligne de loyer ce mois-là : paiement hors période</span> : <>
                            {m.over > 0 && <ExcessFields value={excess[keyOf(m)] ?? null} onChange={(d) => setExcess((x) => ({ ...x, [keyOf(m)]: d }))} excess={m.over} month={m.month} allowLater />}
                            {m.row.quittance ? <span className="pill pill-neutral">Quittance déjà émise</span>
                              : m.settles ? <Checkbox label={`Quittance de ${ml}`} checked={choice(m) === 'quittance'} onChange={(on) => setDocs((d) => ({ ...d, [keyOf(m)]: on ? 'quittance' : 'aucun' }))} />
                              : m.after > 0 ? <><Checkbox label={`Reçu partiel de ${ml}`} checked={choice(m) === 'recu'} onChange={(on) => setDocs((d) => ({ ...d, [keyOf(m)]: on ? 'recu' : 'aucun' }))} />
                                {m.month < today.slice(0, 7) && <small className="muted block">Reste dû {money2(round2(m.due - m.after))} reporté sur {mmYYYY(nextMonth(m.month))}</small>}</> : null}
                          </>}
                        </td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            </div>
          )}
          <p className="muted small">Chaque ligne devient un paiement du bail, à sa date. Un fichier réimporté ne crée pas de doublon. Une quittance n’est émise que pour un mois intégralement réglé.</p>
        </>
      )}
    </Modal>
  );
}

const nextMonth = (m: string) => { const y = Number(m.slice(0, 4)); const n = Number(m.slice(5, 7)); return n === 12 ? `${y + 1}-01` : `${y}-${String(n + 1).padStart(2, '0')}`; };
