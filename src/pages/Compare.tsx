import { date, money, number, pct } from '../domain/format.ts';
import { STATUS_LABELS, TYPE_LABELS } from '../domain/labels.ts';
import { Modal } from '../ui/components.tsx';
import type { PropertyRow } from './propertyShared.tsx';

type Line = [label: string, show: (r: PropertyRow) => string, value?: (r: PropertyRow) => number | null, better?: 'high' | 'low'];
const LINES: Line[] = [
  ['Ville', (r) => r.p.city ?? '—'],
  ['Type', (r) => TYPE_LABELS[r.p.property_type]],
  ['Surface', (r) => (r.p.surface ? `${number(r.p.surface)} m²` : '—')],
  ['DPE', (r) => r.p.dpe ?? '—'],
  ['Prix affiché', (r) => money(r.p.asking_price)],
  ['Prix proposé', (r) => money(r.p.offer_price)],
  ['Prix / m²', (r) => money(r.m.pricePerM2), (r) => r.m.pricePerM2, 'low'],
  ['Coût total', (r) => money(r.m.result?.totalCost), (r) => r.m.result?.totalCost ?? null, 'low'],
  ['Mensualité (assurance incluse)', (r) => money(r.m.result?.monthlyPaymentWithInsurance)],
  ['Loyer mensuel', (r) => money(r.m.result?.annualRent !== undefined ? r.m.result.annualRent / 12 : null)],
  ['Rendement brut', (r) => pct(r.m.result?.grossYield), (r) => r.m.result?.grossYield ?? null, 'high'],
  ['Rendement après charges', (r) => pct(r.m.result?.netYield), (r) => r.m.result?.netYield ?? null, 'high'],
  ['Cash-flow / mois', (r) => money(r.m.result?.cashflowMonthlyYear1), (r) => r.m.result?.cashflowMonthlyYear1 ?? null, 'high'],
  ['Statut', (r) => STATUS_LABELS[r.p.status]],
  ['Relance', (r) => date(r.p.follow_up_date)],
  ['Simulation', (r) => (r.m.scenario ? 'Oui' : 'Aucune simulation')],
];

export function CompareDialog({ rows, onClose }: { rows: PropertyRow[] | null; onClose: () => void }) {
  return (
    <Modal open={!!rows} title="Comparer les biens" onClose={onClose} wide>
      {rows && (
        <div className="dt-scroll">
          <table className="compare">
            <thead><tr><th scope="col"><span className="sr-only">Critère</span></th>{rows.map((r) => <th key={r.p.id} scope="col">{r.p.title}</th>)}</tr></thead>
            <tbody>
              {LINES.map(([label, show, val, better]) => {
                const vals = val ? rows.map(val) : [];
                const valid = vals.filter((v): v is number => v !== null);
                const best = better && valid.length > 1 ? (better === 'high' ? Math.max(...valid) : Math.min(...valid)) : null;
                return (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    {rows.map((r, i) => <td key={r.p.id} className={best !== null && vals[i] === best ? 'best' : ''}>{show(r)}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small">La meilleure valeur de chaque critère chiffré est mise en évidence. Les calculs utilisent la simulation de chaque bien.</p>
        </div>
      )}
    </Modal>
  );
}
