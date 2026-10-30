/**
 * Données de marché partagées par tous les comptes : Carte des loyers, plafonds d'encadrement,
 * barème des taux de crédit, taux d'usure, réglages. Lecture par tout compte connecté ;
 * chargement et mise à jour par les administrateurs (droits vérifiés par la base).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { RepoError } from './repo.ts';
import { DEFAULT_FURNISHED_COEF, DEFAULT_WIDE_THRESHOLD, type RentCap, type RentIndicator, type RentSegment } from '../domain/marketRent.ts';
import { DEFAULT_RENEGOTIATION_GAP, USURY_2026_Q4, type RateBenchmark, type UsuryRate } from '../domain/loanRates.ts';

export interface MarketConfig { rent_wide_threshold: number; furnished_coef: number; renegotiation_gap: number }
export const DEFAULT_MARKET_CONFIG: MarketConfig = { rent_wide_threshold: DEFAULT_WIDE_THRESHOLD, furnished_coef: DEFAULT_FURNISHED_COEF, renegotiation_gap: DEFAULT_RENEGOTIATION_GAP };

export interface RentData { indicators: RentIndicator[]; caps: RentCap[]; config: MarketConfig }
export interface LoanData { benchmarks: RateBenchmark[]; usury: UsuryRate[]; config: MarketConfig }
export interface StoredCap extends RentCap { id: number }
export interface IndicatorStat { vintage: number; segment: RentSegment; communes: number }

export interface MarketApi {
  /** Indicateurs et plafonds des communes données ; null : migration non appliquée. */
  rentData(insees: string[]): Promise<RentData | null>;
  loanData(): Promise<LoanData | null>;
  admin: {
    indicatorStats(): Promise<IndicatorStat[]>;
    /** Remplace le millésime d'un segment ; renvoie le nombre de communes enregistrées. */
    importIndicators(vintage: number, segment: RentSegment, rows: RentIndicator[], onProgress?: (done: number) => void): Promise<number>;
    caps(): Promise<StoredCap[]>;
    /** Ajoute des plafonds ; `replace` supprime d'abord ceux des territoires présents dans le fichier. */
    importCaps(rows: RentCap[], replace: boolean): Promise<number>;
    /** Prolonge ou avance la fin de validité des plafonds d'un territoire. */
    setCapsEnd(territory: string, validTo: string | null): Promise<void>;
    deleteCaps(territory: string): Promise<void>;
    saveBenchmarks(on: string, rows: { years: number; rate: number }[], source: string): Promise<void>;
    deleteBenchmarks(on: string): Promise<void>;
    saveUsury(rows: UsuryRate[]): Promise<void>;
    saveConfig(c: MarketConfig): Promise<void>;
  };
}

const n = (v: unknown): number => Number(v);
const nn = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const missing = (e: { code?: string; message?: string } | null) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202' || /schema cache|does not exist/i.test(e.message ?? ''));
function check<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw r.error;
  return r.data;
}
const toIndicator = (r: Record<string, unknown>): RentIndicator => ({
  vintage: n(r.vintage), segment: r.segment as RentSegment, insee: String(r.insee), libgeo: (r.libgeo as string | null) ?? null,
  low: n(r.low), mid: n(r.mid), high: n(r.high), level: r.level as RentIndicator['level'], r2: nn(r.r2), nb_obs_commune: nn(r.nb_obs_commune), nb_obs_maille: nn(r.nb_obs_maille),
});
const toCap = (r: Record<string, unknown>): StoredCap => ({
  id: n(r.id), territory: String(r.territory), insee: String(r.insee), zone: String(r.zone), rooms: n(r.rooms), year_min: nn(r.year_min), year_max: nn(r.year_max),
  furnished: !!r.furnished, ref: n(r.ref), max: n(r.max), min: n(r.min), valid_from: String(r.valid_from), valid_to: (r.valid_to as string | null) ?? null,
});
const toUsury = (r: Record<string, unknown>): UsuryRate => ({
  quarter: String(r.quarter), borrower: r.borrower as UsuryRate['borrower'], bracket: r.bracket as UsuryRate['bracket'], average: nn(r.average), usury: n(r.usury),
  valid_from: String(r.valid_from), valid_to: String(r.valid_to),
});
const toConfig = (r: Record<string, unknown> | null): MarketConfig => (r ? {
  rent_wide_threshold: n(r.rent_wide_threshold), furnished_coef: n(r.furnished_coef), renegotiation_gap: n(r.renegotiation_gap),
} : DEFAULT_MARKET_CONFIG);
const capRow = (c: RentCap) => ({ territory: c.territory, insee: c.insee, zone: c.zone, rooms: c.rooms, year_min: c.year_min, year_max: c.year_max, furnished: c.furnished, ref: c.ref, max: c.max, min: c.min, valid_from: c.valid_from, valid_to: c.valid_to });

const BATCH = 1000;

export function createSupabaseMarket(sb: SupabaseClient): MarketApi {
  const config = async () => {
    const r = await sb.from('market_config').select('*').maybeSingle();
    return r.error ? DEFAULT_MARKET_CONFIG : toConfig(r.data as Record<string, unknown> | null);
  };
  return {
    async rentData(insees) {
      const codes = [...new Set(insees.filter(Boolean))];
      const [ind, caps] = await Promise.all([
        sb.from('rent_market_indicators').select('*').in('insee', codes).order('vintage', { ascending: false }),
        sb.from('rent_caps').select('*').in('insee', codes),
      ]);
      if (missing(ind.error)) return null;
      return { indicators: (check(ind) as Record<string, unknown>[]).map(toIndicator), caps: caps.error ? [] : (caps.data as Record<string, unknown>[]).map(toCap), config: await config() };
    },
    async loanData() {
      const [b, u] = await Promise.all([
        sb.from('loan_rate_benchmarks').select('*').order('effective_on', { ascending: false }).limit(400),
        sb.from('usury_rates').select('*').order('valid_from', { ascending: false }).limit(200),
      ]);
      if (missing(b.error)) return null;
      return {
        benchmarks: (check(b) as Record<string, unknown>[]).map((r) => ({ effective_on: String(r.effective_on), years: n(r.years), rate: n(r.rate), source: String(r.source) })),
        usury: (check(u) as Record<string, unknown>[]).map(toUsury), config: await config(),
      };
    },
    admin: {
      async indicatorStats() {
        return (check(await sb.rpc('iz_rent_indicator_stats')) as Record<string, unknown>[]).map((r) => ({ vintage: n(r.vintage), segment: r.segment as RentSegment, communes: n(r.communes) }));
      },
      async importIndicators(vintage, segment, rows, onProgress) {
        if (!rows.length) throw new RepoError('Aucune commune lue dans le fichier.');
        check(await sb.from('rent_market_indicators').delete().eq('vintage', vintage).eq('segment', segment));
        let done = 0;
        for (let i = 0; i < rows.length; i += BATCH) {
          const part = rows.slice(i, i + BATCH).map((r) => ({ ...r, vintage, segment }));
          check(await sb.from('rent_market_indicators').upsert(part, { onConflict: 'vintage,segment,insee' }));
          done += part.length;
          onProgress?.(done);
        }
        return done;
      },
      async caps() { return (check(await sb.from('rent_caps').select('*').order('territory').order('insee').limit(20000)) as Record<string, unknown>[]).map(toCap); },
      async importCaps(rows, replace) {
        if (replace) for (const t of new Set(rows.map((r) => r.territory))) check(await sb.from('rent_caps').delete().eq('territory', t));
        for (let i = 0; i < rows.length; i += BATCH) check(await sb.from('rent_caps').insert(rows.slice(i, i + BATCH).map(capRow)));
        return rows.length;
      },
      async setCapsEnd(territory, validTo) { check(await sb.from('rent_caps').update({ valid_to: validTo }).eq('territory', territory)); },
      async deleteCaps(territory) { check(await sb.from('rent_caps').delete().eq('territory', territory)); },
      async saveBenchmarks(on, rows, source) {
        check(await sb.from('loan_rate_benchmarks').delete().eq('effective_on', on));
        if (rows.length) check(await sb.from('loan_rate_benchmarks').insert(rows.map((r) => ({ effective_on: on, years: r.years, rate: r.rate, source }))));
      },
      async deleteBenchmarks(on) { check(await sb.from('loan_rate_benchmarks').delete().eq('effective_on', on)); },
      async saveUsury(rows) { check(await sb.from('usury_rates').upsert(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: 'quarter,borrower,bracket' })); },
      async saveConfig(c) { check(await sb.from('market_config').update({ ...c, updated_at: new Date().toISOString() }).eq('id', true)); },
    },
  };
}

// ---------------------------------------------------------------- mode démonstration

const DEMO_KEY = 'immozen:demo:market';
interface DemoMarket { indicators: RentIndicator[]; caps: StoredCap[]; benchmarks: RateBenchmark[]; usury: UsuryRate[]; config: MarketConfig }

const di = (insee: string, libgeo: string, segment: RentSegment, low: number, mid: number, high: number, level: RentIndicator['level'] = 'commune', nb = 400): RentIndicator =>
  ({ vintage: 2025, segment, insee, libgeo, low, mid, high, level, r2: 0.7, nb_obs_commune: nb, nb_obs_maille: nb });

/** Valeurs de démonstration, non officielles (quelques communes d'Île-de-France et de Lyon). */
function demoSeed(today: string): DemoMarket {
  const ind: RentIndicator[] = [];
  const add = (insee: string, lib: string, base: number, level: RentIndicator['level'] = 'commune') => {
    ind.push(di(insee, lib, 'appart', base * 0.82, base, base * 1.22, level), di(insee, lib, 'appart_t1t2', base * 0.9, base * 1.1, base * 1.34, level),
      di(insee, lib, 'appart_t3plus', base * 0.76, base * 0.92, base * 1.12, level), di(insee, lib, 'maison', base * 0.6, base * 0.75, base * 0.95, level, 80));
  };
  add('94033', 'Fontenay-sous-Bois', 19.5); add('94080', 'Vincennes', 25.2); add('93048', 'Montreuil', 21.1); add('94017', 'Champigny-sur-Marne', 17.4);
  add('94019', 'Chennevières-sur-Marne', 16.2, 'maille'); add('75111', 'Paris 11e Arrondissement', 31.5); add('69383', 'Lyon 3e Arrondissement', 15.8);
  for (const r of ind) { r.low = Math.round(r.low * 100) / 100; r.mid = Math.round(r.mid * 100) / 100; r.high = Math.round(r.high * 100) / 100; }
  let id = 1;
  const caps: StoredCap[] = [];
  const cap = (territory: string, insee: string, zone: string, base: number) => {
    for (const rooms of [1, 2, 3, 4]) for (const [ymin, ymax, k] of [[null, 1945, 1], [1946, 1970, 0.95], [1971, 1990, 0.9], [1991, null, 0.97]] as const) for (const furnished of [false, true]) {
      const ref = Math.round(base * k * (1.25 - rooms * 0.07) * (furnished ? 1.14 : 1) * 10) / 10;
      caps.push({ id: id++, territory, insee, zone, rooms, year_min: ymin, year_max: ymax, furnished, ref, max: Math.round(ref * 12) / 10, min: Math.round(ref * 7) / 10, valid_from: '2026-06-01', valid_to: '2026-11-23' });
    }
  };
  cap('Est Ensemble (démonstration)', '93048', '1', 21); cap('Est Ensemble (démonstration)', '93048', '2', 19.5); cap('Paris (démonstration)', '75111', '5', 29);
  const month = `${today.slice(0, 7)}-01`;
  const benchmarks = ([[10, 3.2], [15, 3.4], [20, 3.55], [25, 3.7]] as const).map(([years, rate]) => ({ effective_on: month, years, rate, source: 'Démonstration' }));
  return { indicators: ind, caps, benchmarks, usury: USURY_2026_Q4.map((u) => ({ ...u })), config: { ...DEFAULT_MARKET_CONFIG } };
}

export function createDemoMarket(storage: Storage, today: () => string): MarketApi {
  const read = (): DemoMarket => {
    try { const v = storage.getItem(DEMO_KEY); if (v) return JSON.parse(v) as DemoMarket; } catch { /* stockage indisponible */ }
    return demoSeed(today());
  };
  const write = (d: DemoMarket) => { try { storage.setItem(DEMO_KEY, JSON.stringify(d)); } catch { /* stockage indisponible */ } };
  const edit = (fn: (d: DemoMarket) => void) => { const d = read(); fn(d); write(d); };
  return {
    async rentData(insees) {
      const d = read();
      return { indicators: d.indicators.filter((r) => insees.includes(r.insee)), caps: d.caps.filter((c) => insees.includes(c.insee)), config: d.config };
    },
    async loanData() { const d = read(); return { benchmarks: d.benchmarks, usury: d.usury, config: d.config }; },
    admin: {
      async indicatorStats() {
        const m = new Map<string, IndicatorStat>();
        for (const r of read().indicators) { const k = `${r.vintage}|${r.segment}`; const s = m.get(k) ?? { vintage: r.vintage, segment: r.segment, communes: 0 }; s.communes++; m.set(k, s); }
        return [...m.values()].sort((a, b) => b.vintage - a.vintage || a.segment.localeCompare(b.segment));
      },
      async importIndicators(vintage, segment, rows, onProgress) {
        if (!rows.length) throw new RepoError('Aucune commune lue dans le fichier.');
        // stockage du navigateur limité : en démonstration, seules les communes déjà présentes sont remplacées
        edit((d) => {
          const keep = new Set(d.indicators.map((r) => r.insee));
          d.indicators = [...d.indicators.filter((r) => !(r.vintage === vintage && r.segment === segment)), ...rows.filter((r) => keep.has(r.insee)).map((r) => ({ ...r, vintage, segment }))];
        });
        onProgress?.(rows.length);
        return rows.length;
      },
      async caps() { return read().caps; },
      async importCaps(rows, replace) {
        edit((d) => {
          if (replace) { const t = new Set(rows.map((r) => r.territory)); d.caps = d.caps.filter((c) => !t.has(c.territory)); }
          let id = Math.max(0, ...d.caps.map((c) => c.id));
          d.caps.push(...rows.map((r) => ({ ...r, id: ++id })));
        });
        return rows.length;
      },
      async setCapsEnd(territory, validTo) { edit((d) => { d.caps = d.caps.map((c) => (c.territory === territory ? { ...c, valid_to: validTo } : c)); }); },
      async deleteCaps(territory) { edit((d) => { d.caps = d.caps.filter((c) => c.territory !== territory); }); },
      async saveBenchmarks(on, rows, source) {
        edit((d) => { d.benchmarks = [...d.benchmarks.filter((b) => b.effective_on !== on), ...rows.map((r) => ({ effective_on: on, years: r.years, rate: r.rate, source }))]; });
      },
      async deleteBenchmarks(on) { edit((d) => { d.benchmarks = d.benchmarks.filter((b) => b.effective_on !== on); }); },
      async saveUsury(rows) {
        edit((d) => {
          const key = (u: UsuryRate) => `${u.quarter}|${u.borrower}|${u.bracket}`;
          const k = new Set(rows.map(key));
          d.usury = [...d.usury.filter((u) => !k.has(key(u))), ...rows];
        });
      },
      async saveConfig(c) { edit((d) => { d.config = { ...c }; }); },
    },
  };
}
