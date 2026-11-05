import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from './components.tsx';

export type CellKind = 'text' | 'money' | 'percent' | 'number' | 'date' | 'url';

export interface Column<T> {
  id: string;
  label: string;
  /** Valeur brute : tri, recherche et export. */
  value: (row: T) => string | number | null | undefined;
  render?: (row: T) => ReactNode;
  kind?: CellKind;
  align?: 'right';
  defaultHidden?: boolean;
  /** Affichée sur la carte mobile. */
  mobile?: boolean;
  /** Colonne titre de la carte mobile. */
  primary?: boolean;
  searchable?: boolean;
  sortable?: boolean;
}

export interface RowAction<T> {
  label: string;
  onSelect: (row: T) => void;
  danger?: boolean;
}

interface Props<T> {
  id: string;
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onOpen?: (row: T) => void;
  rowActions?: (row: T) => RowAction<T>[];
  bulkActions?: (selected: T[], clear: () => void) => ReactNode;
  toolbar?: ReactNode;
  searchPlaceholder?: string;
  empty: ReactNode;
  initialSort?: { id: string; dir: 'asc' | 'desc' };
  pageSize?: number;
  /**
   * Regroupement des lignes sous des bandeaux repliables (ex. un bandeau par bail).
   * `order` range les groupes ; à l'intérieur d'un groupe, le tri choisi s'applique.
   */
  groupBy?: (row: T) => { key: string; order: string | number };
  /** Contenu du bandeau d'un groupe (titre, totaux, actions), calculé sur toutes ses lignes filtrées. */
  groupHeader?: (key: string, rows: T[]) => ReactNode;
}

type Item<T> = { type: 'group'; key: string; rows: T[]; cont?: boolean } | { type: 'row'; row: T };

const PREFS = 'immozen:ui:table:';

function loadHidden(id: string, columns: { id: string; defaultHidden?: boolean }[]): Set<string> {
  try {
    const raw = localStorage.getItem(PREFS + id);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch { /* préférences illisibles */ }
  return new Set(columns.filter((c) => c.defaultHidden).map((c) => c.id));
}

const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function DataTable<T>({ id, rows, columns, rowKey, onOpen, rowActions, bulkActions, toolbar, searchPlaceholder = 'Rechercher…', empty, initialSort, pageSize = 25, groupBy, groupHeader }: Props<T>) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);
  const [hidden, setHidden] = useState(() => loadHidden(id, columns));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [size, setSize] = useState(pageSize);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    try { localStorage.setItem(PREFS + id, JSON.stringify([...hidden])); } catch { /* quota */ }
  }, [id, hidden]);

  const visible = columns.filter((c) => !hidden.has(c.id));

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    let out = rows;
    if (q) {
      const searchCols = columns.filter((c) => c.searchable !== false);
      out = rows.filter((r) => searchCols.some((c) => {
        const v = c.value(r);
        return v !== null && v !== undefined && normalize(String(v)).includes(q);
      }));
    }
    if (sort) {
      const col = columns.find((c) => c.id === sort.id);
      if (col) {
        const dir = sort.dir === 'asc' ? 1 : -1;
        out = [...out].sort((a, b) => {
          const va = col.value(a), vb = col.value(b);
          const ea = va === null || va === undefined || va === '', eb = vb === null || vb === undefined || vb === '';
          if (ea && eb) return 0;
          if (ea) return 1; // valeurs vides toujours en fin de liste
          if (eb) return -1;
          if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
          return collator.compare(String(va), String(vb)) * dir;
        });
      }
    }
    if (groupBy) {
      // groupes dans leur ordre, tri choisi conservé à l'intérieur (tri stable)
      const g = new Map(out.map((r) => [r, groupBy(r)]));
      out = [...out].sort((a, b) => {
        const x = g.get(a)!.order, y = g.get(b)!.order;
        return typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y));
      });
    }
    return out;
  }, [rows, columns, query, sort, groupBy]);

  // pages : `size` lignes par page ; un groupe coupé entre deux pages reprend son bandeau (« suite »)
  const pageItems = useMemo(() => {
    if (!groupBy) {
      const out: Item<T>[][] = [];
      for (let i = 0; i < filtered.length; i += size) out.push(filtered.slice(i, i + size).map((row) => ({ type: 'row', row })));
      return out.length ? out : [[]];
    }
    const groups = new Map<string, T[]>();
    for (const r of filtered) { const k = groupBy(r).key; const l = groups.get(k); if (l) l.push(r); else groups.set(k, [r]); }
    const out: Item<T>[][] = [];
    let cur: Item<T>[] = [];
    let n = 0;
    for (const [key, list] of groups) {
      if (n >= size) { out.push(cur); cur = []; n = 0; }
      cur.push({ type: 'group', key, rows: list });
      if (collapsed.has(key)) continue;
      for (const row of list) {
        if (n >= size) { out.push(cur); cur = [{ type: 'group', key, rows: list, cont: true }]; n = 0; }
        cur.push({ type: 'row', row });
        n++;
      }
    }
    out.push(cur);
    return out;
  }, [filtered, size, groupBy, collapsed]);
  const pages = pageItems.length;
  const current = Math.min(page, pages - 1);
  const items = pageItems[current] ?? [];
  const slice = items.flatMap((it) => (it.type === 'row' ? [it.row] : []));
  const toggleGroup = (k: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const span = visible.length + (bulkActions ? 1 : 0) + (rowActions ? 1 : 0);
  const groupBand = (it: Extract<Item<T>, { type: 'group' }>) => (
    <div className="dt-group-band">
      <button type="button" className="dt-group-toggle" aria-expanded={!collapsed.has(it.key)} onClick={() => toggleGroup(it.key)}
        aria-label={collapsed.has(it.key) ? 'Déplier le groupe' : 'Replier le groupe'}>{collapsed.has(it.key) ? '▸' : '▾'}</button>
      <div className="dt-group-body">{groupHeader ? groupHeader(it.key, it.rows) : it.key}{it.cont && <span className="muted small"> (suite)</span>}</div>
    </div>
  );
  const selectedRows = rows.filter((r) => selected.has(rowKey(r)));
  const allOnPage = slice.length > 0 && slice.every((r) => selected.has(rowKey(r)));

  useEffect(() => { setPage(0); }, [query, rows.length]);
  // la sélection ne conserve que des lignes encore présentes
  useEffect(() => {
    setSelected((s) => {
      const keys = new Set(rows.map(rowKey));
      const next = new Set([...s].filter((k) => keys.has(k)));
      return next.size === s.size ? s : next;
    });
  }, [rows, rowKey]);

  const toggleSort = (c: Column<T>) => {
    if (c.sortable === false) return;
    setSort((s) => (s?.id === c.id ? (s.dir === 'asc' ? { id: c.id, dir: 'desc' } : null) : { id: c.id, dir: 'asc' }));
  };
  const toggle = (k: string) => setSelected((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const togglePage = () => setSelected((s) => {
    const n = new Set(s);
    if (allOnPage) slice.forEach((r) => n.delete(rowKey(r))); else slice.forEach((r) => n.add(rowKey(r)));
    return n;
  });
  const clear = () => setSelected(new Set());

  const cell = (c: Column<T>, r: T) => (c.render ? c.render(r) : (c.value(r) ?? '—'));

  return (
    <div className="datatable">
      <div className="dt-toolbar">
        <input className="dt-search" type="search" aria-label="Rechercher dans le tableau" placeholder={searchPlaceholder} value={query} onChange={(e) => setQuery(e.target.value)} />
        {toolbar}
        <ColumnPicker columns={columns} hidden={hidden} setHidden={setHidden} />
      </div>

      {selectedRows.length > 0 && bulkActions && (
        <div className="dt-bulk" role="region" aria-label="Actions sur la sélection">
          <span>{selectedRows.length} sélectionné{selectedRows.length > 1 ? 's' : ''}</span>
          {bulkActions(selectedRows, clear)}
          <Button variant="ghost" size="sm" onClick={clear}>Désélectionner</Button>
        </div>
      )}

      {rows.length === 0 ? empty : filtered.length === 0 ? (
        <p className="dt-none">Aucun résultat pour « {query} ».</p>
      ) : (
        <>
          <div className="dt-scroll">
            <table className="dt-table">
              <thead>
                <tr>
                  {bulkActions && (
                    <th className="dt-check"><input type="checkbox" aria-label="Tout sélectionner sur cette page" checked={allOnPage} onChange={togglePage} /></th>
                  )}
                  {visible.map((c) => (
                    <th key={c.id} className={c.align === 'right' ? 'num' : ''} aria-sort={sort?.id === c.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                      {c.sortable === false ? c.label : (
                        <button type="button" className="dt-sort" onClick={() => toggleSort(c)}>
                          {c.label}<span aria-hidden="true" className="dt-arrow">{sort?.id === c.id ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
                        </button>
                      )}
                    </th>
                  ))}
                  {rowActions && <th className="dt-actions-col"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  if (it.type === 'group') return <tr key={`g:${it.key}${it.cont ? ':suite' : ''}`} className="dt-group"><td colSpan={span}>{groupBand(it)}</td></tr>;
                  const r = it.row;
                  const k = rowKey(r);
                  return (
                    <tr key={k} className={selected.has(k) ? 'selected' : ''}>
                      {bulkActions && <td className="dt-check"><input type="checkbox" aria-label="Sélectionner la ligne" checked={selected.has(k)} onChange={() => toggle(k)} /></td>}
                      {visible.map((c, i) => (
                        <td key={c.id} className={c.align === 'right' ? 'num' : ''}>
                          {i === 0 && onOpen ? <button type="button" className="dt-open" onClick={() => onOpen(r)}>{cell(c, r)}</button> : cell(c, r)}
                        </td>
                      ))}
                      {rowActions && <td className="dt-actions-col"><RowMenu actions={rowActions(r)} row={r} /></td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="dt-cards">
            {items.map((it) => {
              if (it.type === 'group') return <li key={`g:${it.key}${it.cont ? ':suite' : ''}`} className="dt-card-group">{groupBand(it)}</li>;
              const r = it.row;
              const k = rowKey(r);
              const primary = columns.find((c) => c.primary) ?? columns[0]!;
              return (
                <li key={k} className={`dt-card${selected.has(k) ? ' selected' : ''}`}>
                  <div className="dt-card-head">
                    {bulkActions && <input type="checkbox" aria-label="Sélectionner" checked={selected.has(k)} onChange={() => toggle(k)} />}
                    {onOpen ? <button type="button" className="dt-open" onClick={() => onOpen(r)}>{cell(primary, r)}</button> : <strong>{cell(primary, r)}</strong>}
                    {rowActions && <RowMenu actions={rowActions(r)} row={r} />}
                  </div>
                  <dl>
                    {visible.filter((c) => c.mobile && c.id !== primary.id).map((c) => (
                      <div key={c.id}><dt>{c.label}</dt><dd>{cell(c, r)}</dd></div>
                    ))}
                  </dl>
                </li>
              );
            })}
          </ul>

          <div className="dt-pager">
            <span className="muted">{filtered.length} ligne{filtered.length > 1 ? 's' : ''}{filtered.length !== rows.length ? ` sur ${rows.length}` : ''}</span>
            <label className="dt-size">Par page
              <select value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }}>
                {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <div className="row">
              <Button size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>Précédent</Button>
              <span aria-live="polite">Page {current + 1} / {pages}</span>
              <Button size="sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Suivant</Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RowMenu<T>({ actions, row }: { actions: RowAction<T>[]; row: T }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) ref.current.open = false; };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);
  if (!actions.length) return null;
  return (
    <details className="menu" ref={ref}>
      <summary aria-label="Actions" className="icon-btn">⋯</summary>
      <div className="menu-list" role="menu">
        {actions.map((a) => (
          <button key={a.label} type="button" role="menuitem" className={a.danger ? 'danger' : ''}
            onClick={() => { if (ref.current) ref.current.open = false; a.onSelect(row); }}>{a.label}</button>
        ))}
      </div>
    </details>
  );
}

function ColumnPicker<T>({ columns, hidden, setHidden }: { columns: Column<T>[]; hidden: Set<string>; setHidden: (s: Set<string>) => void }) {
  return (
    <details className="menu menu-right">
      <summary className="btn btn-secondary btn-sm">Colonnes</summary>
      <div className="menu-list menu-columns">
        {columns.map((c, i) => (
          <label key={c.id} className="checkbox">
            <input type="checkbox" disabled={i === 0} checked={!hidden.has(c.id)}
              onChange={(e) => { const n = new Set(hidden); if (e.target.checked) n.delete(c.id); else n.add(c.id); setHidden(n); }} />
            <span>{c.label}</span>
          </label>
        ))}
        <button type="button" className="link" onClick={() => setHidden(new Set(columns.filter((c) => c.defaultHidden).map((c) => c.id)))}>Colonnes par défaut</button>
      </div>
    </details>
  );
}
