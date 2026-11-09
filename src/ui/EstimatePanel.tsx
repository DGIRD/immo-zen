import { useState } from 'react';
import { useStore } from '../data/store.tsx';
import type { EstimateDetails, Property } from '../data/types.ts';
import { describeError } from '../data/repo.ts';
import { FunctionUnavailable } from '../data/platform.ts';
import { date, money, todayParis } from '../domain/format.ts';
import { valuate, ValuationError, type ValuationInput } from '../domain/valuation.ts';
import { applyFeatures, dpeRentalWarning, featureAdjustments, type EstimateFeatures } from '../domain/valuationFeatures.ts';
import { Button, NumberInput, Select } from './components.tsx';

export type EstimateFields = Pick<Property, 'estimate_low' | 'estimate_high' | 'estimate_median' | 'estimate_on' | 'estimate_source' | 'estimate_details'>;

type Ctx = { apartment: boolean; paris: boolean };
const ctxOf = (input: ValuationInput): Ctx => ({ apartment: input.property_type === 'appartement', paris: /^75/.test(input.zip ?? '') });

/** Fourchette affichée = estimation DVF de base × écarts des caractéristiques déclarées. */
function withFeatures(details: EstimateDetails, base: { low: number; median: number; high: number }, features: EstimateFeatures | undefined, ctx: Ctx): EstimateFields {
  const adjustments = featureAdjustments(features, ctx);
  const r = applyFeatures(base, adjustments);
  return { estimate_low: r.low, estimate_median: r.median, estimate_high: r.high, estimate_details: { ...details, base, features, adjustments } } as EstimateFields;
}

/** Patch d'estimation à partir d'un résultat DVF. */
function fromDvf(e: Awaited<ReturnType<typeof valuate>>['estimate'], surface: number, features: EstimateFeatures | undefined, ctx: Ctx): EstimateFields {
  const details: EstimateDetails = {
    perM2: e.perM2, count: e.count, radius: e.radius, from: e.from, to: e.to, surface,
    comparables: e.comparables.map((c) => ({ date: c.date, address: c.address, surface: c.surface, value: c.value, perM2: Math.round(c.perM2), distance: c.distance === null ? null : Math.round(c.distance), adjPerM2: c.adjPerM2, weight: c.weight })),
    confidence: e.confidence, method: e.method,
  };
  return { ...withFeatures(details, { low: e.low, median: e.median, high: e.high }, features, ctx), estimate_on: todayParis(), estimate_source: e.source };
}

const FLOOR = [['rdc', 'Rez-de-chaussée'], ['bas', '1er à 3e étage'], ['haut', '4e étage ou plus']] as const;
const OUTDOOR = [['aucun', 'Aucun'], ['balcon', 'Balcon ou terrasse'], ['jardin', 'Jardin privatif']] as const;
const CONDITION = [['a_renover', 'Travaux importants à prévoir'], ['bon', 'Bon état'], ['renove', 'Rénové récemment']] as const;
const YESNO = [['oui', 'Oui'], ['non', 'Non']] as const;
const DPES = (['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const).map((x) => [x, x] as const);
const yn = (b: boolean | null | undefined) => (b === true ? 'oui' : b === false ? 'non' : null);

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
  const ctx = ctxOf(input);
  const features: EstimateFeatures = { dpe: input.dpe ?? null, ...(d?.features ?? {}) };
  const base = d?.base ?? (d && value.estimate_low != null && value.estimate_high != null && value.estimate_median != null
    ? { low: value.estimate_low, median: value.estimate_median, high: value.estimate_high } : null);
  const fromDvfData = !!d?.perM2 && value.estimate_source !== 'Saisie manuelle';
  const setFeature = (patch: Partial<EstimateFeatures>) => {
    const next = { ...features, ...patch };
    if (fromDvfData && base && d) void onChange({ ...value, ...withFeatures(d, base, next, ctx) });
    else void onChange({ ...value, estimate_details: { ...(d ?? {}), features: next } });
  };
  const adjustments = d?.adjustments ?? [];
  const totalPct = base && value.estimate_median ? Math.round((value.estimate_median / base.median - 1) * 1000) / 10 : 0;
  const rentWarning = dpeRentalWarning(features.dpe);

  async function run() {
    setBusy(true); setError(null);
    try {
      const server = repo.mode === 'demo' ? null : repo.platform.dvf.bind(repo.platform);
      const { estimate } = await valuate(input, todayParis(), server);
      await onChange(fromDvf(estimate, input.surface!, features, ctx));
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
      {d?.confidence && fromDvfData && (
        <div className="estimate-confidence">
          <span className="label">Indice de confiance</span>
          <span className={`confidence c${d.confidence.score}`} aria-label={`${d.confidence.score} sur 5`}>{'●'.repeat(d.confidence.score)}{'○'.repeat(5 - d.confidence.score)}</span>
          <strong>{d.confidence.label}</strong>
          {d.confidence.reasons.length > 0 && <small className="muted">{d.confidence.reasons.join(' ')}</small>}
        </div>
      )}
      <details className="estimate-features" open={adjustments.length > 0}>
        <summary>Affiner avec les caractéristiques du bien{adjustments.length > 0 ? ` (${totalPct > 0 ? '+' : ''}${String(totalPct).replace('.', ',')} %)` : ''}</summary>
        <p className="muted small">Les ventes publiques ne décrivent ni l’étage, ni l’état, ni l’extérieur, ni le DPE : l’estimation de base vaut pour un bien moyen du secteur. Chaque caractéristique applique un écart publié par une étude (total plafonné à ±25 %).</p>
        <div className="grid">
          <Select label="DPE" value={features.dpe ?? null} allowEmpty="Non renseigné" options={DPES} onChange={(v) => editable && setFeature({ dpe: v })} />
          <Select label="État" value={features.condition ?? null} allowEmpty="Non renseigné" options={CONDITION} onChange={(v) => editable && setFeature({ condition: v })} />
          {ctx.apartment && <Select label="Étage" value={features.floor ?? null} allowEmpty="Non renseigné" options={FLOOR} onChange={(v) => editable && setFeature({ floor: v })} />}
          {ctx.apartment && <Select label="Ascenseur" value={yn(features.elevator)} allowEmpty="Non renseigné" options={YESNO} onChange={(v) => editable && setFeature({ elevator: v === null ? null : v === 'oui' })} />}
          {ctx.apartment && <Select label="Extérieur" value={features.outdoor ?? null} allowEmpty="Non renseigné" options={OUTDOOR} onChange={(v) => editable && setFeature({ outdoor: v })} />}
          {ctx.apartment && <Select label="Parking ou garage" value={yn(features.parking)} allowEmpty="Non renseigné" options={YESNO} onChange={(v) => editable && setFeature({ parking: v === null ? null : v === 'oui' })} />}
        </div>
        {adjustments.length > 0 && (
          <div className="dt-scroll"><table className="dt-table compact estimate-adj">
            <thead><tr><th>Caractéristique</th><th className="num">Écart</th><th>Source</th></tr></thead>
            <tbody>{adjustments.map((a) => (
              <tr key={a.label}><td>{a.label}</td><td className="num">{a.pct > 0 ? '+' : '−'} {String(Math.abs(a.pct)).replace('.', ',')} %</td><td className="muted small">{a.source}</td></tr>
            ))}</tbody>
          </table></div>
        )}
        {base && adjustments.length > 0 && <p className="muted small">Estimation de base (ventes DVF) : {money(base.low)} – {money(base.high)}, médiane {money(base.median)}.</p>}
        {ctx.apartment && ctx.paris && features.parking && <p className="muted small">À Paris, les études ne montrent pas d’effet net d’un parking sur le prix d’un appartement : aucun écart appliqué.</p>}
        {rentWarning && <p className="estimate-warning" role="note">{rentWarning}</p>}
      </details>
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
          <button type="button" className="link" aria-expanded={showSales} onClick={() => setShowSales(!showSales)}>{showSales ? 'Masquer' : 'Voir'} les ventes comparables ({d.comparables.length} plus représentatives sur {d.count})</button>
          {showSales && (
            <div className="dt-scroll"><table className="dt-table compact">
              <thead><tr><th>Date</th><th>Adresse</th><th className="num">Surface</th><th className="num">Prix</th><th className="num">€ / m²</th><th className="num">€ / m² corrigé</th><th className="num">Distance</th><th className="num">Poids</th></tr></thead>
              <tbody>{d.comparables.map((c, i) => (
                <tr key={i}><td>{date(c.date)}</td><td>{c.address}</td><td className="num">{String(c.surface).replace('.', ',')} m²</td><td className="num">{money(c.value)}</td><td className="num">{money(c.perM2)}</td><td className="num">{c.adjPerM2 != null ? money(c.adjPerM2) : '—'}</td><td className="num">{c.distance === null ? '—' : `${c.distance} m`}</td><td className="num">{c.weight != null ? `${Math.round(c.weight * 100)} %` : '—'}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      )}
      <p className="muted small">Source : Demandes de valeurs foncières (DGFiP, Etalab), ventes publiées jusqu’à fin 2025. Chaque vente est ramenée à aujourd’hui selon l’évolution des prix de la commune{d?.method && d.method.trendPerYear !== 0 ? ` (${d.method.trendPerYear > 0 ? '+' : '−'}${String(Math.abs(Math.round(d.method.trendPerYear * 1000) / 10)).replace('.', ',')} % par an)` : ''} et à la surface du bien, puis pondérée selon sa distance, sa date, sa surface et son nombre de pièces. Repère indicatif, pas une expertise.</p>
    </div>
  );
}
