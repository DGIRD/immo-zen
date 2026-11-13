import { useState, type ReactNode } from 'react';
import { money, pct, todayParis } from '../domain/format.ts';
import { simulatedCashflow } from '../domain/simulator.ts';
import { RowMenu, type RowAction } from '../ui/DataTable.tsx';
import { StatusBadge } from '../ui/components.tsx';
import { estimateRange, occupationLabel, type PropertyRow } from './propertyShared.tsx';

/** Vue « Cartes » ou « Tableau » d'une liste de biens, mémorisée sur cet appareil. */
export function useViewMode(key: string, initial: 'cartes' | 'tableau' = 'cartes'): ['cartes' | 'tableau', (v: 'cartes' | 'tableau') => void] {
  const storageKey = `immozen:vue:${key}`;
  const [v, setV] = useState<'cartes' | 'tableau'>(() => {
    try { const s = localStorage.getItem(storageKey); return s === 'cartes' || s === 'tableau' ? s : initial; } catch { return initial; }
  });
  return [v, (x) => { setV(x); try { localStorage.setItem(storageKey, x); } catch { /* préférence locale facultative */ } }];
}

export function ViewToggle({ value, onChange }: { value: 'cartes' | 'tableau'; onChange: (v: 'cartes' | 'tableau') => void }) {
  return (
    <div className="view-toggle" role="group" aria-label="Affichage">
      {(['cartes', 'tableau'] as const).map((v) => (
        <button key={v} type="button" aria-pressed={value === v} className={value === v ? 'active' : ''} onClick={() => onChange(v)}>{v === 'cartes' ? 'Cartes' : 'Tableau'}</button>
      ))}
    </div>
  );
}

const tone = (v: number | null | undefined) => (v == null ? '' : v < 0 ? 'neg' : 'pos');

/** Cartes de biens : l'essentiel d'un coup d'œil, la fiche au clic, les actions dans « ⋯ ». */
export function PropertyCards({ rows, kind, onOpen, actions, search, onSearch, empty }: {
  rows: PropertyRow[]; kind: 'owned' | 'prospect'; onOpen: (r: PropertyRow) => void; actions: (r: PropertyRow) => RowAction<PropertyRow>[];
  search: string; onSearch: (s: string) => void; empty: ReactNode;
}) {
  const y = todayParis().slice(0, 4);
  const q = search.trim().toLowerCase();
  const list = q ? rows.filter((r) => [r.p.title, r.p.address, r.p.city, r.rs.tenantNames].filter(Boolean).join(' ').toLowerCase().includes(q)) : rows;
  return (
    <>
      <input type="search" className="cards-search" placeholder="Rechercher un bien, une adresse…" aria-label="Rechercher" value={search} onChange={(e) => onSearch(e.target.value)} />
      {!list.length ? empty : (
        <ul className="prop-cards">
          {list.map((r) => {
            const occ = occupationLabel(r);
            const cf = kind === 'owned' ? r.rs.cashflow : simulatedCashflow(r.m.result);
            return (
              <li key={r.p.id} className="prop-card">
                <div className="prop-card-head">
                  <button type="button" className="prop-card-title" onClick={() => onOpen(r)}>{r.p.title}</button>
                  <RowMenu actions={actions(r)} row={r} />
                </div>
                <p className="muted small">{[r.p.address, [r.p.zip, r.p.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—'}</p>
                <p className="prop-card-tags">
                  {kind === 'owned' ? (occ && <span className={`pill ${occ === 'Loué' ? 'pill-ok' : 'pill-warn'}`}>{occ}</span>) : <StatusBadge status={r.p.status} />}
                  {kind === 'owned' && r.rs.tenantNames && <span className="muted small">{r.rs.tenantNames}</span>}
                  {r.rs.overdue > 0 && <span className="pill pill-bad">Impayé {money(r.rs.overdue)}</span>}
                </p>
                <dl className="prop-card-figures">
                  {kind === 'owned' ? <>
                    <div><dt>Loyer</dt><dd>{money(r.rs.activeLeases[0]?.rent_hc ?? r.p.estimated_rent)}</dd></div>
                    <div><dt>Cash-flow {y}</dt><dd className={tone(cf)}>{money(cf)}</dd></div>
                    <div><dt>Estimation</dt><dd>{estimateRange(r.p)}</dd></div>
                  </> : <>
                    <div><dt>Prix FAI</dt><dd>{money(r.p.asking_price)}</dd></div>
                    <div><dt>Rendement</dt><dd>{pct(r.m.result?.grossYield)}</dd></div>
                    <div><dt>Cash-flow / mois</dt><dd className={tone(cf)}>{money(cf)}</dd></div>
                  </>}
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
