import { useMemo, useState } from 'react';
import { useStore } from '../../data/store.tsx';
import type { ExpenseCategory } from '../../data/types.ts';
import { downloadBlob, toXlsx } from '../../domain/exporting.ts';
import { date, money2 } from '../../domain/format.ts';
import { buildImportRows, IMPORT_COLUMNS, parseDelimited, readImportFile, rowStatus, toExpense, type Cell, type ImportRow } from '../../domain/importing.ts';
import { EXPENSE_CATEGORY_LABELS, MAIN_EXPENSE_CATEGORIES, OTHER_EXPENSE_CATEGORIES } from '../../domain/rental.ts';
import { Button, Modal, NotAvailable } from '../../ui/components.tsx';

const CATEGORY_OPTIONS = [...MAIN_EXPENSE_CATEGORIES, ...OTHER_EXPENSE_CATEGORIES];
const BATCH = 200;

/** Modèle Excel vide avec les colonnes attendues. */
export async function downloadImportTemplate() {
  const example = [
    { d: '2023-04-27', l: 'VIREMENT A SYNDICAT – appel de charges', c: 'Compte courant', m: -319.35, k: 'Charges de copropriété (dont travaux)', n: '', a: '8 passage ruelle, 75018 Paris' },
    { d: '2023-05-05', l: 'VIR LOYER MAI', c: 'Compte courant', m: 850, k: 'Loyer', n: '', a: '8 passage ruelle, 75018 Paris' },
  ];
  type R = (typeof example)[number];
  const blob = await toXlsx([{ name: 'Relevé', rows: example, columns: [
    { label: IMPORT_COLUMNS[0], value: (r: R) => r.d, kind: 'date' }, { label: IMPORT_COLUMNS[1], value: (r: R) => r.l },
    { label: IMPORT_COLUMNS[2], value: (r: R) => r.c }, { label: IMPORT_COLUMNS[3], value: (r: R) => r.m, kind: 'money' },
    { label: IMPORT_COLUMNS[4], value: (r: R) => r.k }, { label: IMPORT_COLUMNS[5], value: (r: R) => r.n }, { label: IMPORT_COLUMNS[6], value: (r: R) => r.a },
  ] }, { name: 'Catégories', rows: CATEGORY_OPTIONS.map((k) => ({ k })), columns: [{ label: 'Catégories acceptées', value: (r: { k: ExpenseCategory }) => EXPENSE_CATEGORY_LABELS[r.k].replace(' (recette)', '') }] }]);
  downloadBlob(blob, 'immo-zen-modele-import-depenses.xlsx');
}

export function ExpenseImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useStore();
  const owned = useMemo(() => store.data.properties.filter((p) => p.status === 'acquis'), [store.data.properties]);
  const existingRefs = useMemo(() => new Set(store.data.expenses.map((e) => e.import_ref).filter((r): r is string => !!r)), [store.data.expenses]);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [source, setSource] = useState('');
  const [paste, setPaste] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [onlyIssues, setOnlyIssues] = useState(false);

  const reset = () => { setRows(null); setSource(''); setPaste(''); setError(null); setOnlyIssues(false); };
  const close = () => { reset(); onClose(); };

  function load(cells: Cell[][], name: string) {
    const out = buildImportRows(cells, owned);
    if (out.error) { setError(out.error); return; }
    if (!out.rows.length) { setError('Aucune ligne à importer sous les en-têtes.'); return; }
    setError(null);
    setRows(out.rows);
    setSource(name);
  }

  const statuses = rows?.map((r) => rowStatus(r, existingRefs)) ?? [];
  const ready = rows?.filter((_, i) => statuses[i]!.status === 'ok') ?? [];
  const count = (s: string) => statuses.filter((x) => x.status === s).length;
  const incomeSum = ready.filter((r) => r.category === 'loyer').reduce((a, r) => a + Math.abs(r.signed!), 0);
  const expenseSum = ready.filter((r) => r.category !== 'loyer').reduce((a, r) => a + Math.abs(r.signed!), 0);
  // valeurs distinctes de la colonne « Appartement » : un choix s'applique à toutes leurs lignes
  const places = rows ? [...new Map(rows.map((r) => [r.rawProperty ?? '', r])).keys()] : [];

  const patch = (i: number, p: Partial<ImportRow>) => setRows((rs) => rs && rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const patchPlace = (raw: string, propertyId: string | null) => setRows((rs) => rs && rs.map((r) => ((r.rawProperty ?? '') === raw ? { ...r, propertyId } : r)));

  async function doImport() {
    if (!ready.length) return;
    setBusy(true);
    try {
      let n = 0;
      for (let i = 0; i < ready.length; i += BATCH) {
        const created = await store.createMany('expenses', ready.slice(i, i + BATCH).map(toExpense));
        if (!created) break;
        n += created.length;
      }
      if (n) {
        store.notify(`${n} ligne(s) importée(s) depuis ${source}.`);
        close();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} wide title="Importer des dépenses depuis un relevé" onClose={close}
      footer={rows ? <>
        <Button onClick={reset}>Autre fichier</Button>
        <Button variant="primary" disabled={busy || !ready.length} onClick={() => void doImport()}>{busy ? 'Import…' : `Importer ${ready.length} ligne(s)`}</Button>
      </> : <Button onClick={close}>Fermer</Button>}>
      {!owned.length ? <NotAvailable>Ajoutez d’abord vos logements dans Mes biens : chaque ligne doit être rattachée à un bien.</NotAvailable> : !rows ? (
        <div className="import-start">
          <p>Fichier Excel (.xlsx) ou CSV avec les colonnes : <strong>{IMPORT_COLUMNS.join(' · ')}</strong>. Seules « Date » et « Montant » sont obligatoires ; les montants négatifs sont des dépenses, les positifs des recettes (catégorie Loyer). Colonne facultative « Durée d’amortissement » (en années) pour les meubles et travaux amortissables.</p>
          <div className="row">
            <label className="btn btn-primary file-btn">Choisir un fichier
              <input type="file" accept=".xlsx,.xlsm,.csv,.txt,.xls" aria-label="Fichier à importer" onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try { load(await readImportFile(f), f.name); } catch (x) { setError(x instanceof Error ? x.message : 'Fichier illisible.'); }
              }} />
            </label>
            <Button onClick={() => void downloadImportTemplate()}>Télécharger le modèle Excel</Button>
          </div>
          <div className="field field-full">
            <label htmlFor="import-paste">… ou collez les lignes copiées depuis Excel (en-têtes compris)</label>
            <textarea id="import-paste" rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={IMPORT_COLUMNS.join('\t')} />
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
            {count('signe') > 0 && <span className="pill pill-warn">{count('signe')} à vérifier</span>}
            {count('doublon') > 0 && <span className="pill pill-neutral">{count('doublon')} déjà importée(s)</span>}
            <span className="muted">Dépenses {money2(expenseSum)} · recettes {money2(incomeSum)}</span>
          </div>
          {places.length > 0 && (
            <fieldset className="import-places">
              <legend>Logement de chaque adresse du fichier</legend>
              {places.map((raw) => {
                const current = rows.find((r) => (r.rawProperty ?? '') === raw)?.propertyId ?? '';
                return (
                  <label key={raw} className="inline-select">{raw || '(colonne Appartement vide)'}
                    <select value={current} onChange={(e) => patchPlace(raw, e.target.value || null)}>
                      <option value="">Choisir…</option>
                      {owned.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                    </select>
                  </label>
                );
              })}
            </fieldset>
          )}
          <label className="checkbox"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /><span>Afficher seulement les lignes à compléter ou vérifier</span></label>
          <div className="dt-scroll tall">
            <table className="dt-table compact import-table">
              <thead><tr><th>Ligne</th><th>Date</th><th>Libellé</th><th className="num">Montant</th><th>Catégorie</th><th>Logement</th><th>État</th></tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const st = statuses[i]!;
                  if (onlyIssues && (st.status === 'ok' || st.status === 'doublon')) return null;
                  return (
                    <tr key={r.ref + i} className={st.status === 'ok' ? '' : st.status === 'doublon' ? 'muted' : 'row-warn'}>
                      <td>{r.line}</td>
                      <td>{r.date ? date(r.date) : '—'}</td>
                      <td className="wrap">{r.label || '—'}{r.notes && <small className="muted"> · {r.notes}</small>}</td>
                      <td className={`num ${r.signed !== null && r.signed > 0 ? 'pos' : ''}`}>{r.signed === null ? '—' : money2(r.signed)}</td>
                      <td>
                        <select aria-label={`Catégorie ligne ${r.line}`} value={r.category ?? ''} disabled={st.status === 'doublon'} onChange={(e) => patch(i, { category: (e.target.value || null) as ExpenseCategory | null })}>
                          <option value="">Choisir…</option>
                          {CATEGORY_OPTIONS.map((k) => <option key={k} value={k}>{EXPENSE_CATEGORY_LABELS[k]}</option>)}
                        </select>
                      </td>
                      <td>
                        <select aria-label={`Logement ligne ${r.line}`} value={r.propertyId ?? ''} disabled={st.status === 'doublon'} onChange={(e) => patch(i, { propertyId: e.target.value || null })}>
                          <option value="">Choisir…</option>
                          {owned.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                        </select>
                      </td>
                      <td><span className={`pill pill-${st.status === 'ok' ? 'ok' : st.status === 'doublon' ? 'neutral' : 'warn'}`}>{st.message}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">Chaque ligne devient une dépense payée à la date du relevé (ou une recette pour « Loyer »). Un relevé réimporté ne crée pas de doublon. Ajoutez ensuite, si besoin, la part récupérable (ex. taxe d’ordures ménagères) et le justificatif en modifiant la dépense.</p>
        </>
      )}
    </Modal>
  );
}
