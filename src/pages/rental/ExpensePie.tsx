import { useState } from 'react';
import { money2 } from '../../domain/format.ts';
import { OTHERS, type BreakdownKey, type Slice } from '../../domain/expenseBreakdown.ts';

/**
 * Camembert (anneau) de la répartition des dépenses par catégorie. Un clic sur une part ou sur sa ligne
 * de légende filtre la liste ; un second clic retire le filtre. La légende porte libellé, montant et part :
 * la couleur n'est jamais seule à identifier une catégorie.
 */
const R = 88, r = 54, C = 100;
const pt = (a: number, rad: number) => [C + rad * Math.sin(a), C - rad * Math.cos(a)] as const;

function arc(a0: number, a1: number, outer: number): string {
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    // part unique : deux demi-anneaux
    return `${arc(0, Math.PI, outer)} ${arc(Math.PI, Math.PI * 2, outer)}`;
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = pt(a0, outer), [x1, y1] = pt(a1, outer), [x2, y2] = pt(a1, r), [x3, y3] = pt(a0, r);
  return `M${x0} ${y0}A${outer} ${outer} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r} ${r} 0 ${large} 0 ${x3} ${y3}Z`;
}

const pct = (v: number) => `${(v * 100).toLocaleString('fr-FR', { maximumFractionDigits: v < 0.1 ? 1 : 0 })} %`;
export const sliceColor = (s: Pick<Slice, 'key' | 'slot'>) => (s.key === OTHERS ? 'var(--viz-other)' : `var(--viz-${s.slot + 1})`);

export function ExpensePie({ slices, selected, onSelect, othersHint }: { slices: Slice[]; selected: '' | BreakdownKey; onSelect: (k: '' | BreakdownKey) => void; othersHint: string }) {
  const [hover, setHover] = useState<{ s: Slice; x: number; y: number } | null>(null);
  const total = slices.reduce((a, s) => a + s.amount, 0);
  if (!slices.length || total <= 0) return null;
  const pick = (k: BreakdownKey) => onSelect(selected === k ? '' : k);
  const sel = slices.find((s) => s.key === selected);
  let a = 0;
  const geo = slices.map((s) => { const a0 = a; a += s.share * Math.PI * 2; return { s, a0, a1: a }; });

  return (
    <section className="expense-pie" aria-labelledby="expense-pie-title">
      <div className="expense-pie-head">
        <h2 id="expense-pie-title">Répartition par catégorie</h2>
        {selected && <button type="button" className="link" onClick={() => onSelect('')}>Retirer le filtre</button>}
      </div>
      <div className="expense-pie-body">
        <div className="expense-pie-chart" onMouseLeave={() => setHover(null)}>
          <svg viewBox="0 0 200 200" role="img" aria-label={`Répartition des dépenses affichées : ${slices.map((s) => `${s.label} ${pct(s.share)}`).join(', ')}`}>
            {geo.map(({ s, a0, a1 }) => (
              <path key={s.key} d={arc(a0, a1, s.key === selected ? R + 6 : R)} fill={sliceColor(s)}
                className={`pie-slice${selected && s.key !== selected ? ' dim' : ''}`}
                onClick={() => pick(s.key)}
                onMouseMove={(e) => { const b = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect(); setHover({ s, x: e.clientX - b.left, y: e.clientY - b.top }); }} />
            ))}
            <text x={C} y={C - 4} textAnchor="middle" className="pie-center-value">{money2(sel ? sel.amount : total)}</text>
            <text x={C} y={C + 14} textAnchor="middle" className="pie-center-label">{sel ? pct(sel.share) : 'au total'}</text>
          </svg>
          {hover && (
            <div className="viz-tooltip" style={{ left: hover.x, top: hover.y }} role="status">
              <span className="viz-swatch" style={{ background: sliceColor(hover.s) }} /> <strong>{hover.s.label}</strong>
              <div>{money2(hover.s.amount)} · {pct(hover.s.share)}</div>
              <div className="muted small">{hover.s.count} ligne{hover.s.count > 1 ? 's' : ''}{hover.s.key === OTHERS ? ` · ${othersHint}` : ''}</div>
              <div className="muted small">{selected === hover.s.key ? 'Cliquer pour retirer le filtre' : 'Cliquer pour filtrer la liste'}</div>
            </div>
          )}
        </div>
        <ul className="pie-legend">
          {slices.map((s) => (
            <li key={s.key}>
              <button type="button" aria-pressed={selected === s.key} className={selected && s.key !== selected ? 'dim' : ''}
                title={s.key === OTHERS ? othersHint : undefined} onClick={() => pick(s.key)}>
                <span className="viz-swatch" style={{ background: sliceColor(s) }} aria-hidden="true" />
                <span className="pie-legend-label">{s.label}</span>
                <span className="pie-legend-value">{money2(s.amount)}</span>
                <span className="pie-legend-share muted">{pct(s.share)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
