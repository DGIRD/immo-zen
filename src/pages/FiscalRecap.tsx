import type { Property, TaxPropertyInputs } from '../data/types.ts';
import { money2 } from '../domain/format.ts';
import type { Foncier2044, Liasse2033B, ReelBic } from '../domain/fiscal.ts';
import { round2 } from '../domain/simulator.ts';
import { NumberInput } from '../ui/components.tsx';

/**
 * Tableaux récapitulatifs de la déclaration (forme des liasses LMNP) :
 * résultat comptable par bien, suivi des amortissements excédentaires reportables, détail des immobilisations.
 */

const eur = (v: number) => money2(v);
const shortDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
const sumOf = <T,>(list: T[], f: (x: T) => number) => round2(list.reduce((a, x) => a + f(x), 0));

function PropertyCell({ p, fallback }: { p: Property | undefined; fallback: string }) {
  const addr = p ? [p.address, [p.zip, p.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';
  return <td><strong>{p?.title ?? fallback}</strong>{addr && <span className="muted small recap-address">{addr}</span>}</td>;
}

export interface RecapRow { propertyId: string; receipts: number; charges: number; interest: number; depreciation: number; result: number }

/** Lignes du récapitulatif pour la location meublée au réel (intérêts, assurance et frais d'emprunt regroupés, comme la liasse). */
export function recapFromReelBic(list: ReelBic[]): RecapRow[] {
  return list.map((r) => ({ propertyId: r.propertyId, receipts: r.receipts, charges: r.chargesTotal, interest: r.interest, depreciation: r.depreciationYear,
    result: round2(r.resultBeforeDepreciation - r.depreciationYear) }));
}

/** Lignes du récapitulatif pour la location nue au réel (2044 : recettes 215, frais 240, intérêts 250, résultat 263). */
export function recapFromFoncier(list: Foncier2044[]): RecapRow[] {
  return list.map((f) => ({ propertyId: f.propertyId, receipts: f.r215, charges: f.r240, interest: f.r250, depreciation: 0, result: f.r263 }));
}

/** Récapitulatif du résultat comptable par bien ; la colonne Amortissement n'apparaît que s'il y en a. */
export function ResultRecap({ rows, properties, title, footer }: { rows: RecapRow[]; properties: Property[]; title: string; footer?: [string, number][] }) {
  const withDep = rows.some((r) => r.depreciation !== 0);
  const total = { receipts: sumOf(rows, (r) => r.receipts), charges: sumOf(rows, (r) => r.charges), interest: sumOf(rows, (r) => r.interest), depreciation: sumOf(rows, (r) => r.depreciation), result: sumOf(rows, (r) => r.result) };
  const signed = (v: number) => <td className={`num ${v < 0 ? 'neg' : ''}`}>{eur(v)}</td>;
  const cost = (v: number) => <td className="num">{v ? eur(-v) : eur(0)}</td>;
  return (
    <div className="tax-recap">
      <h3>{title}</h3>
      <div className="dt-scroll"><table className="dt-table compact tax-recap-table">
        <thead><tr><th>Bien</th><th className="num">Recettes</th><th className="num">Charges</th><th className="num">Intérêts d’emprunt</th>{withDep && <th className="num">Amortissement</th>}<th className="num">Résultat</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.propertyId}>
            <PropertyCell p={properties.find((p) => p.id === r.propertyId)} fallback={r.propertyId} />
            <td className="num">{eur(r.receipts)}</td>{cost(r.charges)}{cost(r.interest)}{withDep && cost(r.depreciation)}{signed(r.result)}
          </tr>
        ))}</tbody>
        <tfoot><tr className="total"><td>Total global</td><td className="num">{eur(total.receipts)}</td>{cost(total.charges)}{cost(total.interest)}{withDep && cost(total.depreciation)}{signed(total.result)}</tr></tfoot>
      </table></div>
      <dl className="tax-recap-result">
        <div><dt>Résultat avant imputation des déficits antérieurs</dt><dd className={total.result < 0 ? 'neg' : 'pos'}>{eur(total.result)}</dd></div>
        {footer?.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{eur(v)}</dd></div>)}
      </dl>
    </div>
  );
}

/** Suivi des amortissements excédentaires reportables par bien (art. 39 C du CGI). */
export function DeferredTracking({ list, properties, year, opening, setOpening }: {
  list: ReelBic[]; properties: Property[]; year: number;
  opening: (propertyId: string) => TaxPropertyInputs['deferred_opening']; setOpening: (propertyId: string, v: number | null) => void;
}) {
  const t = { before: sumOf(list, (r) => r.deferredBefore), used: sumOf(list, (r) => r.deferredUsed), added: sumOf(list, (r) => r.deferredAdded), after: sumOf(list, (r) => r.deferredAfter) };
  const cell = (v: number) => <td className="num">{v ? eur(v) : '—'}</td>;
  return (
    <div className="tax-recap">
      <h3>Suivi des amortissements excédentaires reportables par bien</h3>
      <div className="dt-scroll"><table className="dt-table compact tax-recap-table">
        <thead><tr><th>Bien</th><th className="num">Stock au 1er janvier</th><th className="num">Stock utilisé</th><th className="num">Report stocké</th><th className="num">Stock au 31 décembre</th></tr></thead>
        <tbody>{list.map((r) => (
          <tr key={r.propertyId}>
            <PropertyCell p={properties.find((p) => p.id === r.propertyId)} fallback={r.propertyId} />
            <td className="num">{eur(r.deferredBefore)}{opening(r.propertyId) != null && <span className="muted small recap-address">repris de la liasse</span>}</td>
            {cell(r.deferredUsed)}{cell(r.deferredAdded)}<td className="num"><strong>{eur(r.deferredAfter)}</strong></td>
          </tr>
        ))}</tbody>
        <tfoot><tr className="total"><td>Total suivi</td><td className="num">{eur(t.before)}</td>{cell(t.used)}{cell(t.added)}<td className="num">{eur(t.after)}</td></tr></tfoot>
      </table></div>
      <p className="muted small">L’amortissement ne peut ni créer ni augmenter le déficit de l’activité : la part non déduite s’ajoute au stock, réparti entre les biens au prorata de leurs dotations, et s’impute sans limite de durée sur les bénéfices des années suivantes.</p>
      <details className="tax-recap-opening">
        <summary>Reprendre le stock au 1er janvier {year} d’une liasse déposée ailleurs</summary>
        <p className="muted small">Indiquez le « stock de fin d’année » de votre liasse {year - 1} pour chaque bien ; il remplace le calcul de l’application. Laissez vide pour le calcul automatique.</p>
        <div className="grid tax-inputs">
          {list.map((r) => {
            const p = properties.find((x) => x.id === r.propertyId);
            return <NumberInput key={r.propertyId} label={p?.title ?? r.propertyId} suffix="€" value={opening(r.propertyId) ?? null} onChange={(v) => setOpening(r.propertyId, v)} />;
          })}
        </div>
      </details>
    </div>
  );
}

/** Détail des immobilisations par bien (2033-C) : valeur brute, dotation, amortissement annuel, restant et cumulé. */
export function AssetsDetail({ liasse, properties, year }: { liasse: Liasse2033B; properties: Property[]; year: number }) {
  const ids = [...new Set(liasse.assets.map((a) => a.propertyId).filter((x): x is string => !!x))];
  if (!ids.length) return null;
  return (
    <div className="tax-recap">
      <h3>Détail des immobilisations</h3>
      {ids.map((pid) => {
        const p = properties.find((x) => x.id === pid);
        const rows = liasse.assets.filter((a) => a.propertyId === pid).map((a) => {
          const annual = a.years ? round2(a.gross / a.years) : 0;
          const remainingEnd = a.kind === 'terrain' ? 0 : round2(a.gross - a.cumulated);
          return { ...a, name: p ? a.label.replace(`${p.title} – `, '') : a.label, annual, remainingStart: a.kind === 'terrain' ? 0 : round2(remainingEnd + a.dotation), remainingEnd };
        });
        const amort = rows.filter((r) => r.kind !== 'terrain');
        const dash = (v: number, terrain: boolean) => <td className="num">{terrain ? '—' : eur(v)}</td>;
        return (
          <div key={pid} className="tax-assets">
            <p className="label">{p?.title ?? pid}{p?.address ? <span className="muted small"> — {[p.address, p.zip, p.city].filter(Boolean).join(' ')}</span> : null}</p>
            <div className="dt-scroll"><table className="dt-table compact tax-recap-table">
              <thead><tr><th>Élément</th><th className="num">Valeur brute</th><th className="num">Dotation {year}</th><th className="num">Amort. annuel</th><th className="num" title="Reste à amortir en début d’exercice">Reste au 1/1</th><th className="num" title="Reste à amortir en fin d’exercice">Reste au 31/12</th><th className="num" title="Amortissements cumulés en fin d’exercice">Cumul au 31/12</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.label + r.start}>
                  <td>{r.name} <span className="muted small">({shortDate(r.start)}{r.years ? `, ${String(r.years).replace('.', ',')} ans` : ''})</span></td>
                  <td className="num">{eur(r.gross)}</td>{dash(r.dotation, r.kind === 'terrain')}{dash(r.annual, r.kind === 'terrain')}{dash(r.remainingStart, r.kind === 'terrain')}{dash(r.remainingEnd, r.kind === 'terrain')}{dash(r.cumulated, r.kind === 'terrain')}
                </tr>
              ))}</tbody>
              <tfoot><tr className="total"><td>Total</td><td className="num">{eur(sumOf(rows, (r) => r.gross))}</td><td className="num">{eur(sumOf(amort, (r) => r.dotation))}</td><td className="num">{eur(sumOf(amort, (r) => r.annual))}</td>
                <td className="num">{eur(sumOf(amort, (r) => r.remainingStart))}</td><td className="num">{eur(sumOf(amort, (r) => r.remainingEnd))}</td><td className="num">{eur(sumOf(amort, (r) => r.cumulated))}</td></tr></tfoot>
            </table></div>
          </div>
        );
      })}
      <p className="muted small">Terrain non amortissable. La dotation de l’année d’acquisition est calculée au prorata du temps ; « Amort. annuel » est la dotation d’une année pleine.</p>
    </div>
  );
}
