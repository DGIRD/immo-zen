import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Button, InfoTip } from './components.tsx';

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
/** Résultat d'un enregistrement : nombre de lignes enregistrées, ou clés des lignes enregistrées et ligne en échec. */
export type GridSaveOutcome = number | { saved: string[]; failed?: { key: string; message: string } | null };

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
  /** Enregistre les lignes modifiées. `auto` : enregistrement automatique (messages de réussite à éviter). */
  onSave: (changes: GridChange<T>[], opts?: { auto: boolean }) => Promise<GridSaveOutcome>;
  onClose: () => void;
  note?: ReactNode;
  max?: number;
  /**
   * Recalcul en direct : à partir des modifications valides, renvoie pour chaque ligne la version recalculée
   * (ou la ligne d'origine si rien ne change). Les colonnes non modifiables affichent la ligne recalculée.
   */
  derive?: (changes: GridChange<T>[]) => (row: T) => T;
  /**
   * Enregistrement automatique d'une ligne quand on la quitte (après `delay` ms sans saisie).
   * `confirm` : motif pour lequel une ligne attend le bouton « Enregistrer » (ex. quittance à annuler).
   */
  autoSave?: { delay?: number; confirm?: (row: T) => string | null };
  /** Brouillon conservé sur l'appareil (saisie retrouvée après un rechargement). */
  storageKey?: string;
  /** Choix de grille affiché dans la barre (ex. Par mois / Par paiement) ; changer de grille passe par la fermeture. */
  modes?: { current: string; options: readonly (readonly [string, string])[]; onChange: (mode: string) => void };
}

type RowState = { state: 'saving' | 'saved' | 'error'; message?: string };

const parseMoney = (s: string): number | null => {
  const t = s.replace(/[\s  €]/g, '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};
const toText = (v: string | number | null | undefined, type: GridColumn<unknown>['type']) =>
  v === null || v === undefined ? '' : type === 'money' ? String(v).replace('.', ',') : String(v);

function readDraft(key: string | undefined): Record<string, Record<string, string>> {
  if (!key) return {};
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as Record<string, Record<string, string>> : {}; } catch { return {}; }
}
function writeDraft(key: string | undefined, d: Record<string, Record<string, string>>) {
  if (!key) return;
  try { if (Object.keys(d).length) localStorage.setItem(key, JSON.stringify(d)); else localStorage.removeItem(key); } catch { /* stockage indisponible : brouillon en mémoire seulement */ }
}

export function GridEditor<T>({ rows, columns, rowKey, rowLabel, lock, flag, onSave, onClose, note, max = 300, derive, autoSave, storageKey, modes }: Props<T>) {
  const shown = useMemo(() => rows.slice(0, max), [rows, max]);
  const [draft, setDraftState] = useState<Record<string, Record<string, string>>>(() => {
    // brouillon retrouvé : seulement pour les lignes encore affichées
    const keys = new Set(shown.map(rowKey));
    return Object.fromEntries(Object.entries(readDraft(storageKey)).filter(([k]) => keys.has(k)));
  });
  const [restored] = useState(() => Object.keys(draft).length);
  const [busy, setBusy] = useState(false);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const table = useRef<HTMLTableElement>(null);
  const draftRef = useRef(draft);
  const focused = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const inFlight = useRef(new Set<string>());

  const setDraft = useCallback((fn: (d: Record<string, Record<string, string>>) => Record<string, Record<string, string>>) => {
    // référence mise à jour tout de suite : les enregistrements en cours lisent l'état réel du brouillon
    const n = fn(draftRef.current);
    draftRef.current = n;
    writeDraft(storageKey, n);
    setDraftState(n);
  }, [storageKey]);

  const parsed = (c: GridColumn<T>, text: string): GridValue => (c.type === 'money' ? parseMoney(text) : text.trim() === '' ? null : text.trim());
  const original = (c: GridColumn<T>, r: T): GridValue => { const v = c.get(r); return v === undefined ? null : v; };

  /** Lignes réellement modifiées, avec leurs valeurs converties et leurs erreurs. */
  const changes = useMemo(() => {
    const out: (GridChange<T> & { key: string; errors: Record<string, string> })[] = [];
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
      out.push({ row: r, key: rowKey(r), values, errors });
    }
    return out;
  }, [draft, shown, columns]); // eslint-disable-line react-hooks/exhaustive-deps
  const changesRef = useRef(changes);
  changesRef.current = changes;

  const valid = useMemo(() => changes.filter((c) => !Object.keys(c.errors).length), [changes]);
  // recalcul en direct (total, écart, statut, reports) d'après les saisies valides
  const view = useMemo(() => (derive && valid.length ? derive(valid.map(({ row, values }) => ({ row, values }))) : null), [derive, valid]);

  const errorCount = changes.reduce((n, c) => n + Object.keys(c.errors).length, 0);
  const errorsOf = (r: T) => changes.find((c) => c.row === r)?.errors ?? {};
  const edited = (r: T, c: GridColumn<T>) => changes.some((x) => x.row === r && c.id in x.values);
  const waiting = (r: T) => (autoSave?.confirm ? autoSave.confirm(r) : null);

  /** Enregistre une liste de lignes (file d'attente : jamais deux enregistrements en même temps). */
  const saveList = useCallback((list: (GridChange<T> & { key: string })[], auto: boolean): Promise<boolean> => {
    const keys = list.map((c) => c.key);
    const sent = new Map(keys.map((k) => [k, draftRef.current[k]]));
    for (const k of keys) inFlight.current.add(k);
    setRowState((s) => ({ ...s, ...Object.fromEntries(keys.map((k) => [k, { state: 'saving' } as RowState])) }));
    const run = async () => {
      let saved: string[] = [];
      let failed: { key: string; message: string } | null = null;
      try {
        const res = await onSave(list.map(({ row, values }) => ({ row, values })), { auto });
        if (typeof res === 'number') saved = res === list.length ? keys : [];
        else { saved = res.saved; failed = res.failed ?? null; }
      } catch (e) {
        failed = { key: keys[0]!, message: (e as Error).message };
      } finally {
        for (const k of keys) inFlight.current.delete(k);
      }
      const ok = new Set(saved);
      // saisie retirée du brouillon seulement si elle n'a pas changé pendant l'enregistrement
      setDraft((d) => {
        const n = { ...d };
        for (const k of ok) if (n[k] === sent.get(k)) delete n[k];
        return n;
      });
      setRowState((s) => {
        const n = { ...s };
        for (const k of keys) {
          if (ok.has(k)) n[k] = { state: 'saved' };
          else if (failed?.key === k) n[k] = { state: 'error', message: failed.message };
          else delete n[k];
        }
        return n;
      });
      return ok.size === keys.length;
    };
    const p = queue.current.then(run, run);
    queue.current = p;
    return p;
  }, [onSave, setDraft]);

  /** Enregistrement automatique : lignes valides que l'on a quittées. */
  const flush = useCallback(() => {
    if (!autoSave) return;
    const list = changesRef.current.filter((c) => !Object.keys(c.errors).length && c.key !== focused.current && !inFlight.current.has(c.key) && !autoSave.confirm?.(c.row));
    if (list.length) void saveList(list, true);
  }, [autoSave, saveList]);
  const schedule = useCallback(() => {
    if (!autoSave) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, autoSave.delay ?? 1500);
  }, [autoSave, flush]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // modifications non enregistrées : avertissement en quittant la page
  useEffect(() => {
    if (!changes.length) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changes.length]);

  const set = (r: T, c: GridColumn<T>, text: string) => {
    const k = rowKey(r);
    setDraft((d) => ({ ...d, [k]: { ...(d[k] ?? {}), [c.id]: text } }));
    setRowState((s) => { if (!s[k] || s[k].state === 'saving') return s; const n = { ...s }; delete n[k]; return n; });
    schedule();
  };
  const onFocusRow = (k: string) => { if (focused.current !== k) { focused.current = k; schedule(); } };
  const onBlurTable = (e: FocusEvent<HTMLTableElement>) => {
    if (!table.current?.contains(e.relatedTarget as Node | null)) { focused.current = null; schedule(); }
  };

  // Entrée : cellule de la ligne suivante (ou précédente avec Maj), même colonne
  const onKey = (e: KeyboardEvent<HTMLElement>, row: number, col: number) => {
    if (e.key !== 'Enter' || (e.target as HTMLElement).tagName === 'SELECT') return;
    e.preventDefault();
    const next = table.current?.querySelector<HTMLElement>(`[data-cell="${row + (e.shiftKey ? -1 : 1)}-${col}"]`);
    next?.focus();
  };

  async function save() {
    if (errorCount || !changes.length) return;
    if (timer.current) clearTimeout(timer.current);
    setBusy(true);
    try {
      const ok = await saveList(changes.filter((c) => !inFlight.current.has(c.key)), false);
      await queue.current;
      if (ok) onClose();
    } finally { setBusy(false); }
  }
  /** Quitter la grille (fermeture ou changement de grille) : saisie en attente enregistrée ou abandonnée. */
  async function close(after: () => void = onClose) {
    if (timer.current) clearTimeout(timer.current);
    await queue.current;
    // lignes encore au brouillon (les lignes enregistrées en ont été retirées)
    const left = changesRef.current.filter((c) => c.key in draftRef.current);
    if (!left.length) { after(); return; }
    const savable = left.filter((c) => !Object.keys(c.errors).length);
    if (savable.length === left.length && window.confirm(`Enregistrer ${savable.length > 1 ? `les ${savable.length} lignes modifiées` : 'la ligne modifiée'} avant de quitter la grille ?`)) {
      setBusy(true);
      try { if (await saveList(savable, false)) after(); } finally { setBusy(false); }
      return;
    }
    if (window.confirm('Abandonner les modifications non enregistrées ?')) { setDraft(() => ({})); after(); }
  }

  const savingCount = Object.values(rowState).filter((s) => s.state === 'saving').length;
  const pendingCount = changes.filter((c) => !inFlight.current.has(c.key)).length;
  const status = savingCount ? `Enregistrement de ${savingCount} ligne${savingCount > 1 ? 's' : ''}…`
    : pendingCount ? `${pendingCount} ligne${pendingCount > 1 ? 's' : ''} modifiée${pendingCount > 1 ? 's' : ''}${autoSave ? ' – enregistrement automatique en quittant la ligne' : ''}`
    : autoSave ? 'Enregistrement automatique : chaque ligne est enregistrée quand vous la quittez. Entrée passe à la ligne suivante.'
    : 'Modifiez les cellules, puis enregistrez. Entrée passe à la ligne suivante.';

  return (
    <div className="grid-edit">
      <div className="grid-edit-bar" role="region" aria-label="Modification en grille">
        <strong>Modification en grille</strong>
        {modes && (
          <span className="seg" role="group" aria-label="Grille">
            {modes.options.map(([k, l]) => (
              <button key={k} type="button" aria-pressed={modes.current === k} disabled={busy}
                onClick={() => { if (modes.current !== k) void close(() => modes.onChange(k)); }}>{l}</button>
            ))}
          </span>
        )}
        <span className="muted small" aria-live="polite">{status}</span>
        {errorCount > 0 && <span className="form-error small">{errorCount} valeur{errorCount > 1 ? 's' : ''} à corriger</span>}
        <span className="grid-edit-actions">
          <Button size="sm" disabled={busy} onClick={() => void close()}>Fermer la grille</Button>
          <Button size="sm" variant="primary" disabled={busy || !pendingCount || errorCount > 0} onClick={() => void save()}>
            {busy ? 'Enregistrement…' : `Enregistrer${pendingCount ? ` (${pendingCount})` : ''}`}
          </Button>
        </span>
      </div>
      {restored > 0 && <p className="note">Saisie non enregistrée retrouvée sur cet appareil ({restored} ligne{restored > 1 ? 's' : ''}) : vérifiez-la puis enregistrez, ou{' '}
        <button type="button" className="link" onClick={() => setDraft(() => ({}))}>effacez-la</button>.</p>}
      {note && <p className="help-line"><InfoTip label="Mode d’emploi de la grille" text="Mode d’emploi de la grille">{note}</InfoTip></p>}
      {derive && <p className="muted small">Les montants <em className="grid-recalc">en italique</em> sont recalculés d’après votre saisie (total dû, reports, écart, statut) ; ils deviennent définitifs à l’enregistrement.</p>}
      <div className="dt-scroll">
        <table className="dt-table grid-table" ref={table} onBlur={onBlurTable}>
          <thead><tr>{columns.map((c) => <th key={c.id} style={c.width ? { minWidth: c.width } : undefined} className={c.type === 'money' ? 'num' : ''}>{c.label}</th>)}{(flag || autoSave) && <th><span className="sr-only">Remarque</span></th>}</tr></thead>
          <tbody>
            {shown.map((r, i) => {
              const k = rowKey(r);
              const v = view ? view(r) : r;
              const recalc = v !== r;
              const locked = lock?.(r) ?? null;
              const errs = errorsOf(r);
              const st = rowState[k];
              const pending = changes.some((c) => c.key === k);
              const wait = pending && !Object.keys(errs).length ? waiting(r) : null;
              return (
                <tr key={k} className={locked ? 'muted' : ''} title={locked ?? undefined} onFocus={() => onFocusRow(k)}>
                  {columns.map((c, j) => {
                    const fixed = c.fixed?.(v);
                    const value = draft[k]?.[c.id] ?? toText(c.get(v), c.type);
                    const label = `${c.label} – ${rowLabel(r)}`;
                    const recalcCell = recalc && !(draft[k] && c.id in draft[k]!) && (fixed !== undefined && fixed !== false ? true : toText(c.get(v), c.type) !== toText(c.get(r), c.type));
                    if (locked || (fixed !== undefined && fixed !== false)) {
                      return <td key={c.id} className={`${c.type === 'money' ? 'num' : ''}${recalcCell ? ' grid-recalc' : ''}`} title={recalcCell ? 'Recalculé d’après votre saisie' : undefined}>
                        {fixed !== undefined && fixed !== false ? fixed : c.type === 'select' ? (c.options?.find(([o]) => o === value)?.[1] ?? value) : value || '—'}</td>;
                    }
                    const cls = `grid-cell${edited(r, c) ? ' changed' : ''}${errs[c.id] ? ' invalid' : ''}${recalcCell ? ' grid-recalc' : ''}`;
                    return (
                      <td key={c.id} className={c.type === 'money' ? 'num' : ''}>
                        {c.type === 'select' ? (
                          <select className={cls} aria-label={label} data-cell={`${i}-${j}`} value={value} onChange={(e) => set(r, c, e.target.value)}>
                            {c.options?.map(([o, l]) => <option key={o} value={o}>{l}</option>)}
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
                  {(flag || autoSave) && (
                    <td className="grid-state">
                      {locked ? <span className="small">{locked}</span> : flag?.(r)}
                      {st?.state === 'saving' && <span className="small muted"> Enregistrement…</span>}
                      {st?.state === 'saved' && !pending && <span className="small pos"> Enregistrée</span>}
                      {st?.state === 'error' && <span className="small form-error" role="alert"> Non enregistrée : {st.message}</span>}
                      {wait && st?.state !== 'saving' && <span className="small" title={wait}> À enregistrer (bouton « Enregistrer ») : {wait}</span>}
                    </td>
                  )}
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
