import { useState } from 'react';
import { useStore } from '../data/store.tsx';
import type { EstimateDetails, Property } from '../data/types.ts';
import { describeError } from '../data/repo.ts';
import { FunctionUnavailable } from '../data/platform.ts';
import { date, money, todayParis } from '../domain/format.ts';
import { valuate, ValuationError, type ValuationInput } from '../domain/valuation.ts';
import { Button, NumberInput } from './components.tsx';

export type EstimateFields = Pick<Property, 'estimate_low' | 'estimate_high' | 'estimate_median' | 'estimate_on' | 'estimate_source' | 'estimate_details'>;

/** Patch d'estimation à partir d'un résultat DVF. */
function fromDvf(e: Awaited<ReturnType<typeof valuate>>['estimate'], surface: number): EstimateFields {
  const details: EstimateDetails = {
    perM2: e.perM2, count: e.count, radius: e.radius, from: e.from, to: e.to, surface,
    comparables: e.comparables.map((c) => ({ date: c.date, address: c.address, surface: c.surface, value: c.value, perM2: Math.round(c.perM2), distance: c.distance === null ? null : Math.round(c.distance) })),
  };
  return { estimate_low: e.low, estimate_high: e.high, estimate_median: e.median, estimate_on: todayParis(), estimate_source: e.source, estimate_details: details };
}

/**
 * Fourchette d'estimation du prix actuel : calcul DVF (ventes publiques comparables) ou saisie manuelle.
 * `onChange` reçoit les champs d'estimation à enregistrer avec le bien.
 */
export function EstimatePanel({ value, input, onChange, compareTo, compareLabel, editable = true }: {
  value: EstimateFields; input: ValuationInput; onChange: (patch: EstimateFields) => void | Promise<void>;
  compareTo?: number | null; compareLabel?: string; editable?: boolean;
}) {
  const { repo } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSales, setShowSales] = useState(false);
  const d = value.estimate_details;

  async function run() {
    setBusy(true); setError(null);
    try {
      const server = repo.mode === 'demo' ? null : repo.platform.dvf.bind(repo.platform);
      const { estimate } = await valuate(input, todayParis(), server);
      await onChange(fromDvf(estimate, input.surface!));
    } catch (e) {
      setError(e instanceof ValuationError ? e.message : e instanceof FunctionUnavailable
        ? 'Données DVF inaccessibles depuis ce navigateur et fonction serveur « dvf » non déployée : saisissez la fourchette à la main.'
        : describeError(e));
    } finally { setBusy(false); }
  }

  const mid = value.estimate_median ?? (value.estimate_low != null && value.estimate_high != null ? Math.round((value.estimate_low + value.estimate_high) / 2) : null);
  const gap = compareTo && mid ? Math.round(((compareTo - mid) / mid) * 1000) / 10 : null;

  return (
    <div className="estimate">
      <div className="estimate-figures">
        <div>
          <span className="label" id="est-range">Estimation du prix actuel</span>
          <output className="computed" aria-labelledby="est-range">
            {value.estimate_low != null && value.estimate_high != null ? <>{money(value.estimate_low)} – {money(value.estimate_high)}</> : 'Non estimé'}
          </output>
          <small className="muted">
            {value.estimate_source ? `${value.estimate_source}${value.estimate_on ? `, calculée le ${date(value.estimate_on)}` : ''}.` : 'D’après les ventes publiques DVF du secteur, ou saisie à la main.'}
            {d?.perM2 && ` Prix au m² : ${money(d.perM2.p25)} à ${money(d.perM2.p75)} (médiane ${money(d.perM2.median)}).`}
          </small>
        </div>
        {gap !== null && (
          <p className={`estimate-gap ${gap > 5 ? 'neg' : gap < -5 ? 'pos' : ''}`}>
            {compareLabel ?? 'Prix'} {gap > 0 ? `${String(gap).replace('.', ',')} % au-dessus` : gap < 0 ? `${String(-gap).replace('.', ',')} % en dessous` : 'au niveau'} de l’estimation médiane ({money(mid)})
          </p>
        )}
      </div>
      {editable && (
        <div className="estimate-edit">
          <Button onClick={() => void run()} disabled={busy}>{busy ? 'Calcul en cours…' : value.estimate_low != null ? 'Recalculer avec les ventes DVF' : 'Estimer avec les ventes DVF'}</Button>
          <NumberInput label="Fourchette basse" suffix="€" value={value.estimate_low ?? null}
            onChange={(v) => void onChange({ ...value, estimate_low: v, estimate_median: null, estimate_on: todayParis(), estimate_source: 'Saisie manuelle' })} />
          <NumberInput label="Fourchette haute" suffix="€" value={value.estimate_high ?? null}
            onChange={(v) => void onChange({ ...value, estimate_high: v, estimate_median: null, estimate_on: todayParis(), estimate_source: 'Saisie manuelle' })} />
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      {d?.comparables && d.comparables.length > 0 && (
        <>
          <button type="button" className="link" aria-expanded={showSales} onClick={() => setShowSales(!showSales)}>{showSales ? 'Masquer' : 'Voir'} les ventes comparables ({d.comparables.length} plus proches sur {d.count})</button>
          {showSales && (
            <div className="dt-scroll"><table className="dt-table compact">
              <thead><tr><th>Date</th><th>Adresse</th><th className="num">Surface</th><th className="num">Prix</th><th className="num">€ / m²</th><th className="num">Distance</th></tr></thead>
              <tbody>{d.comparables.map((c, i) => (
                <tr key={i}><td>{date(c.date)}</td><td>{c.address}</td><td className="num">{String(c.surface).replace('.', ',')} m²</td><td className="num">{money(c.value)}</td><td className="num">{money(c.perM2)}</td><td className="num">{c.distance === null ? '—' : `${c.distance} m`}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      )}
      <p className="muted small">Source : Demandes de valeurs foncières (DGFiP, Etalab), ventes publiées jusqu’à fin 2025 ; prix non indexés sur l’évolution récente du marché. Repère indicatif, pas une expertise.</p>
    </div>
  );
}
