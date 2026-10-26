import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from './components.tsx';

/** Colonne modifiable de la grille. Les valeurs sont saisies en texte puis converties à l'enregistrement. */
export interface GridColumn<T> {
  id: string;
  label: string;
  type: 'date' | 'money' | 'text' | 'select';
  /** Valeur actuelle de la ligne. */
  get: (row: T) => string | number | null | undefined;
  options?: readonly (readonly [string, string])[];
  /** Colonne non modifiable pour cette ligne (ex. libellé d'un loyer) : texte affiché à la place. */
  fixed?: (row: T) => ReactNode | false;
  /** Contrôle d'une valeur saisie (déjà convertie) : message d'erreur ou null. */
  validate?: (value: GridValue, row: T, draft: Record<string, GridValue>) => string | null;
  width?: string;
}

export type GridValue = string | number | null;
export interface GridChange<T> { row: T; values: Record<string, GridValue> }

interface Props<T> {
  rows: T[];
  columns: GridColumn<T>[];
  rowKey: (row: T) => string;
  /** Intitulé de la ligne, lu par les lecteurs d'écran (« Paiement du 05/10/2026 »). */
  rowLabel: (row: T) => string;
  /** Ligne verrouillée : motif affiché, aucune saisie possible. */
  lock?: (row: T) => string | null;
  /** Information en fin de ligne (ex. doublon probable). */
  flag?: (row: T) => ReactNode;
  /** Enregistre les lignes modifiées ; renvoie le nombre de lignes enregistrées. */
  onSave: (changes: GridChange<T>[]) => Promise<number>;
  onClose: () => void;
  note?: ReactNode;
  max?: number;
}

const parseMoney = (s: string): number | null => {
  const t = s.replace(/[\s  €]/g, '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};
const toText = (v: string | number | null | undefined, type: GridColumn<unknown>['type']) =>
  v === null || v === undefined ? '' : type === 'money' ? String(v).replace('.', ',') : String(v);

export function GridEditor<T>({ rows, columns, rowKey, rowLabel, lock, flag, onSave, onClose, note, max = 300 }: Props<T>) {
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const table = useRef<HTMLTableElement>(null);
  const shown = rows.slice(0, max);

  const parsed = (c: GridColumn<T>, text: string): GridValue => (c.type === 'money' ? parseMoney(text) : text.trim() === '' ? null : text.trim());
  const original = (c: GridColumn<T>, r: T): GridValue => { const v = c.get(r); return v === undefined ? null : v; };

  /** Lignes réellement modifiées, avec leurs valeurs converties et leurs erreurs. */
  const changes = useMemo(() => {
    const out: (GridChange<T> & { errors: Record<string, string> })[] = [];
    for (const r of shown) {
      const d = draft[rowKey(r)];
      if (!d) continue;
      const values: Record<string, GridValue> = {};
      const all: Record<string, GridValue> = {};
      for (const c of columns) {
        const v = c.id in d ? parsed(c, d[c.id]!) : original(c, r);
        all[c.id] = v;
        if (c.id in d && v !== original(c, r)) values[c.id] = v;
      }
      if (!Object.keys(values).length) continue;
      const errors: Record<string, string> = {};
      for (const c of columns) {
        const v = all[c.id] ?? null;
        if (typeof v === 'number' && Number.isNaN(v)) errors[c.id] = 'Montant illisible';
        else if (c.validate) { const e = c.validate(v, r, all); if (e) errors[c.id] = e; }
      }
      out.push({ row: r, values, errors });
    }
    return out;
  }, [draft, shown, columns]); // eslint-disable-line react-hooks/exhaustive-deps

  const errorCount = changes.reduce((n, c) => n + Object.keys(c.errors).length, 0);
  const errorsOf = (r: T) => changes.find((c) => c.row === r)?.errors ?? {};
  const edited = (r: T, c: GridColumn<T>) => changes.some((x) => x.row === r && c.id in x.values);

  const set = (r: T, c: GridColumn<T>, text: string) => setDraft((d) => ({ ...d, [rowKey(r)]: { ...(d[rowKey(r)] ?? {}), [c.id]: text } }));

  // Entrée : cellule de la ligne suivante (ou précédente avec Maj), même colonne
  const onKey = (e: KeyboardEvent<HTMLElement>, row: number, col: number) => {
    if (e.key !== 'Enter' || (e.target as HTMLElement).tagName === 'SELECT') return;
    e.preventDefault();
    const next = table.current?.querySelector<HTMLElement>(`[data-cell="${row + (e.shiftKey ? -1 : 1)}-${col}"]`);
    next?.focus();
  };

  async function save() {
    if (errorCount || !changes.length) return;
    setBusy(true);
    try {
      const n = await onSave(changes.map(({ row, values }) => ({ row, values })));
      if (n === changes.length) { setDraft({}); onClose(); }
      else setDraft({}); // les lignes non enregistrées sont signalées par un message ; la grille repart des données actuelles
    } finally { setBusy(false); }
  }

  return (
    <div className="grid-edit">
      <div className="grid-edit-bar" role="region" aria-label="Modification en grille">
        <strong>Modification en grille</strong>
        <span className="muted small">{changes.length ? `${changes.length} ligne${changes.length > 1 ? 's' : ''} modifiée${changes.length > 1 ? 's' : ''}` : 'Modifiez les cellules, puis enregistrez. Entrée passe à la ligne suivante.'}</span>
        {errorCount > 0 && <span className="form-error small">{errorCount} valeur{errorCount > 1 ? 's' : ''} à corriger</span>}
        <span className="grid-edit-actions">
          <Button size="sm" onClick={() => { if (!changes.length || window.confirm('Abandonner les modifications non enregistrées ?')) onClose(); }}>Fermer la grille</Button>
          <Button size="sm" variant="primary" disabled={busy || !changes.length || errorCount > 0} onClick={() => void save()}>
            {busy ? 'Enregistrement…' : `Enregistrer${changes.length ? ` (${changes.length})` : ''}`}
          </Button>
        </span>
      </div>
      {note && <p className="muted small">{note}</p>}
      <div className="dt-scroll">
        <table className="dt-table grid-table" ref={table}>
          <thead><tr>{columns.map((c) => <th key={c.id} style={c.width ? { minWidth: c.width } : undefined} className={c.type === 'money' ? 'num' : ''}>{c.label}</th>)}{flag && <th><span className="sr-only">Remarque</span></th>}</tr></thead>
          <tbody>
            {shown.map((r, i) => {
              const k = rowKey(r);
              const locked = lock?.(r) ?? null;
              const errs = errorsOf(r);
              return (
                <tr key={k} className={locked ? 'muted' : ''} title={locked ?? undefined}>
                  {columns.map((c, j) => {
                    const fixed = c.fixed?.(r);
                    const value = draft[k]?.[c.id] ?? toText(c.get(r), c.type);
                    const label = `${c.label} – ${rowLabel(r)}`;
                    if (locked || (fixed !== undefined && fixed !== false)) {
                      return <td key={c.id} className={c.type === 'money' ? 'num' : ''}>{fixed !== undefined && fixed !== false ? fixed : c.type === 'select' ? (c.options?.find(([v]) => v === value)?.[1] ?? value) : value || '—'}</td>;
                    }
                    const cls = `grid-cell${edited(r, c) ? ' changed' : ''}${errs[c.id] ? ' invalid' : ''}`;
                    return (
                      <td key={c.id} className={c.type === 'money' ? 'num' : ''}>
                        {c.type === 'select' ? (
                          <select className={cls} aria-label={label} data-cell={`${i}-${j}`} value={value} onChange={(e) => set(r, c, e.target.value)}>
                            {c.options?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                        ) : (
                          <input className={cls} aria-label={label} aria-invalid={errs[c.id] ? true : undefined} title={errs[c.id]} data-cell={`${i}-${j}`}
                            type={c.type === 'date' ? 'date' : 'text'} inputMode={c.type === 'money' ? 'decimal' : undefined}
                            value={value} onChange={(e) => set(r, c, e.target.value)} onKeyDown={(e) => onKey(e, i, j)} />
                        )}
                        {errs[c.id] && <small className="form-error grid-err">{errs[c.id]}</small>}
                      </td>
                    );
                  })}
                  {flag && <td>{locked ? <span className="small">{locked}</span> : flag(r)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > max && <p className="muted small">Seules les {max} premières lignes sont modifiables en grille : filtrez la liste (mois, bail, bien, année) pour atteindre les autres.</p>}
    </div>
  );
}
