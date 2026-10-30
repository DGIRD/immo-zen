import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../data/store.tsx';
import { describeError } from '../data/repo.ts';
import type { RentData } from '../data/market.ts';
import { date, money, todayParis } from '../domain/format.ts';
import {
  HORS_ZONE, RELIABILITY_LABELS, rentPosition, SEGMENT_LABELS, snapshotOf, SOURCE_MENTION, DEFAULT_FURNISHED_COEF,
  type MarketRent, type MarketRentSnapshot,
} from '../domain/marketRent.ts';
import { lookupKey, lookupMarketRent, MarketRentError, missingForLookup, type LookupInput, type LookupResult } from '../domain/marketRentLookup.ts';
import { locate } from '../domain/valuation.ts';
import { Button, NumberInput, Pill, Select } from './components.tsx';

// mémoire de la session : une commune n'est lue qu'une fois
const placeCache = new Map<string, ReturnType<typeof locate>>();
const dataCache = new Map<string, Promise<RentData | null>>();
/** Après un chargement par l'administrateur : les données sont relues. */
export function resetMarketRentCache() { dataCache.clear(); }
const cachedLocate = (a: string | null | undefined, z: string | null | undefined, c: string | null | undefined) => {
  const k = [a, z, c].join('|');
  if (!placeCache.has(k)) placeCache.set(k, locate(a, z, c).catch((e) => { placeCache.delete(k); throw e; }));
  return placeCache.get(k)!;
};

export interface MarketRentFields {
  onFurnished?: (v: boolean) => void;
  onYear?: (v: number | null) => void;
  onZone?: (v: string | null) => void;
}

/**
 * Loyer de marché d'un bien : fourchette bas / central / haut (Carte des loyers), plafond légal en zone encadrée,
 * fiabilité, position du loyer saisi. `auto` : calcul dès que les caractéristiques changent (formulaires) ;
 * sinon sur demande (fiche). La fourchette n'est jamais reprise dans la simulation ou le bail sans clic (`actions`).
 */
export function MarketRentPanel({ input, value, onChange, fields, rentHc, rentLabel = 'Loyer saisi', actions, auto = true, editable = true }: {
  input: LookupInput;
  value: MarketRentSnapshot | null | undefined;
  onChange: (v: MarketRentSnapshot | null) => void | Promise<void>;
  fields?: MarketRentFields;
  rentHc?: number | null;
  rentLabel?: string;
  actions?: (v: MarketRentSnapshot) => ReactNode;
  auto?: boolean;
  editable?: boolean;
}) {
  const { repo } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<LookupResult | null>(null);
  const [coef, setCoef] = useState<number>(value?.coef && value.coef > 1 ? value.coef : DEFAULT_FURNISHED_COEF);
  const [showWhy, setShowWhy] = useState(false);
  const full: LookupInput = { ...input, furnishedCoef: input.furnished ? coef : null };
  const key = lookupKey(full);
  const today = todayParis();
  const valueRef = useRef(value);
  valueRef.current = value;

  async function run(save: boolean) {
    const missing = missingForLookup(full);
    if (missing) { setLive(null); setError(missing); return; }
    setBusy(true); setError(null);
    try {
      const r = await lookupMarketRent(full, today, {
        locate: cachedLocate,
        rentData: (codes) => {
          const k = codes.join(',');
          if (!dataCache.has(k)) dataCache.set(k, repo.platform.market.rentData(codes).catch((e) => { dataCache.delete(k); throw e; }));
          return dataCache.get(k)!;
        },
      });
      setLive(r);
      const cur = valueRef.current;
      // photographie : remplacée si les caractéristiques ont changé (ou sur demande), jamais une saisie manuelle
      if (save || !cur || (cur.source === 'auto' && cur.key !== key)) await onChange({ ...snapshotOf(r.mr, today), key, cap_status: r.capStatus });
    } catch (e) {
      setLive(null);
      setError(e instanceof MarketRentError ? e.message : describeError(e));
    } finally { setBusy(false); }
  }

  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => { void run(false); }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, auto]);

  const v = value ?? null;
  const pos = v && live ? rentPosition(rentHc, live.mr) : v ? rentPositionFromSnapshot(rentHc, v) : null;
  const newer = v && live && v.source === 'auto' && v.key === key && v.vintage !== live.mr.vintage;
  const zones = live?.zones ?? [];

  function manual(patch: Partial<Pick<MarketRentSnapshot, 'low' | 'mid' | 'high'>>) {
    const base: MarketRentSnapshot = v ?? { low: 0, mid: 0, high: 0, hc: null, cap_hc: null, cap_territory: null, vintage: null, segment: null, level: null, reliability: null, reasons: [], coef: 1, surface: input.surface ?? 0, source: 'manuel', on: today };
    const next = { ...base, ...patch, source: 'manuel' as const, on: today, reliability: null, reasons: [] };
    // le plafond légal ne peut pas être relevé
    const capCc = base.cap_hc !== null ? base.cap_hc + (input.chargesMonthly ?? 0) : null;
    if (capCc !== null && next.high > capCc) { next.high = capCc; setError(`Loyer haut ramené au plafond légal (${money(base.cap_hc)} hors charges).`); }
    const ch = input.chargesMonthly;
    next.hc = ch != null ? { low: Math.max(0, next.low - ch), mid: Math.max(0, next.mid - ch), high: base.cap_hc ?? Math.max(0, next.high - ch) } : null;
    void onChange(next);
  }

  return (
    <div className="market-rent">
      {fields && (
        <div className="grid">
          {fields.onFurnished && <Select label="Location envisagée" value={input.furnished ? 'meuble' : 'vide'} onChange={(x) => fields.onFurnished!(x === 'meuble')} options={[['vide', 'Vide'], ['meuble', 'Meublée']] as const} />}
          {fields.onFurnished && input.furnished && (
            <NumberInput label="Coefficient meublé" value={coef} onChange={(x) => setCoef(x && x >= 1 && x <= 2 ? x : DEFAULT_FURNISHED_COEF)} hint="Appliqué au loyer d’une location vide (1,15 = +15 %)" />
          )}
          {fields.onYear && <NumberInput label="Année de construction" value={input.construction_year ?? null} onChange={(x) => fields.onYear!(x === null ? null : Math.round(x))} hint="Sert au plafond en zone encadrée" />}
          {fields.onZone && zones.length > 1 && (
            <Select label="Zone d’encadrement" value={input.rent_zone ?? null} onChange={fields.onZone} allowEmpty="À choisir"
              options={[...zones.map((z) => [z, `Zone ${z}`] as const), [HORS_ZONE, 'Hors zone encadrée'] as const]}
              hint="Voir la carte de l’arrêté préfectoral de la commune" />
          )}
        </div>
      )}
      <div className="estimate-figures">
        <div>
          <span className="label" id="mr-range">Loyer de marché, charges comprises</span>
          <output className="market-figure" aria-labelledby="mr-range">
            {v && v.high > 0 ? <>{money(v.low)} · <strong>{money(v.mid)}</strong> · {money(v.high)}<small> / mois</small></> : 'Non calculé'}
          </output>
          {v && v.high > 0 && (
            <small className="muted">
              Bas · central · haut{v.surface ? `, soit ${eurM2(v.low, v.surface)} à ${eurM2(v.high, v.surface)} le m²` : ''}.
              {v.hc ? ` Hors charges : ${money(v.hc.low)} · ${money(v.hc.mid)} · ${money(v.hc.high)}.` : ' Hors charges : renseignez les charges du bien.'}
              {v.coef > 1 ? ` Meublé : coefficient ${String(v.coef).replace('.', ',')}.` : ''}
            </small>
          )}
          {v?.cap_hc != null && (
            <p className="market-cap"><Pill tone="warn">Plafond légal</Pill> {money(v.cap_hc)} hors charges / mois{v.cap_territory ? ` (${v.cap_territory})` : ''} : loyer de référence majoré × surface. Il sert de loyer haut.</p>
          )}
        </div>
        <div>
          {v?.reliability && (
            <span>Fiabilité <Pill tone={v.reliability === 'bonne' ? 'ok' : v.reliability === 'moyenne' ? 'warn' : 'bad'}>{RELIABILITY_LABELS[v.reliability]}</Pill>
              {v.reasons.length > 0 && <button type="button" className="link" aria-expanded={showWhy} onClick={() => setShowWhy(!showWhy)}>{showWhy ? 'Masquer' : 'Pourquoi ?'}</button>}
            </span>
          )}
          {v?.source === 'manuel' && <Pill>Saisie manuelle</Pill>}
          {pos && pos.position !== 'dans' && (
            <p className={`estimate-gap ${pos.position === 'dessous' ? '' : 'neg'}`} role="status">
              {pos.position === 'plafond' ? `${rentLabel} au-dessus du plafond légal (+${frPct(pos.gapPct)} %) : non autorisé sans complément de loyer justifié.`
                : pos.position === 'dessus' ? `${rentLabel} au-dessus du haut de marché (+${frPct(pos.gapPct)} %).`
                  : `${rentLabel} sous le bas de marché (${frPct(pos.gapPct)} %).`}
            </p>
          )}
          {pos?.position === 'dans' && <p className="estimate-gap pos" role="status">{rentLabel} dans la fourchette de marché.</p>}
        </div>
      </div>
      {showWhy && v && <ul className="small">{v.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      {live?.capMessage && <p className="note-warn note" role="status">{live.capMessage}{live.capStatus === 'expired' ? '.' : ''}</p>}
      {live?.encadreSansPlafond && <p className="note-warn note" role="status">Commune encadrée ({live.encadreSansPlafond}) : plafonds pas encore chargés dans Immo-Zen, le loyer haut ne tient pas compte du plafond légal. Vérifiez sur le simulateur officiel de la commune.</p>}
      {newer && <p className="note">Un millésime plus récent de la Carte des loyers est disponible ({live!.mr.vintage}). <Button size="sm" onClick={() => void run(true)}>Mettre à jour</Button></p>}
      {editable && (
        <div className="estimate-edit market-edit">
          <Button onClick={() => void run(true)} disabled={busy}>{busy ? 'Calcul en cours…' : v?.source === 'manuel' ? 'Revenir au calcul automatique' : v ? 'Recalculer' : 'Calculer le loyer de marché'}</Button>
          <NumberInput label="Bas (CC)" suffix="€" value={v?.low ?? null} onChange={(x) => manual({ low: x ?? 0 })} />
          <NumberInput label="Central (CC)" suffix="€" value={v?.mid ?? null} onChange={(x) => manual({ mid: x ?? 0 })} />
          <NumberInput label="Haut (CC)" suffix="€" value={v?.high ?? null} onChange={(x) => manual({ high: x ?? 0 })} />
        </div>
      )}
      {v && v.high > 0 && actions && <div className="row">{actions(v)}</div>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="muted small">
        Source : Carte des loyers {v?.vintage ?? ''} ({SOURCE_MENTION}){v?.segment ? `, ${SEGMENT_LABELS[v.segment].toLowerCase()}` : ''}{v?.on ? `, calculée le ${date(v.on)}` : ''}.
        {' '}Loyers d’annonce d’une location vide, charges comprises, pour un bien type : repère indicatif, sans prise en compte de l’étage, du DPE, de l’état ou des extérieurs. Ne remplace ni l’avis d’un professionnel ni le plafond légal.
      </p>
    </div>
  );
}

const eurM2 = (x: number, s: number) => `${(Math.round((x / s) * 10) / 10).toLocaleString('fr-FR')} €`;
const frPct = (x: number) => String(x).replace('.', ',');

/** Position d'un loyer d'après la fourchette enregistrée (sans nouveau calcul). */
function rentPositionFromSnapshot(rentHc: number | null | undefined, v: MarketRentSnapshot) {
  const fake = { capHc: v.cap_hc, hc: v.hc, low: v.low, high: v.high } as MarketRent;
  return v.high > 0 ? rentPosition(rentHc, fake) : null;
}

