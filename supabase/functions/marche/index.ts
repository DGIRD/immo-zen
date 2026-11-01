// Edge Function « marche » (Deno) – mise à jour automatique des données de marché d'Immo-Zen.
//
// Appelée chaque nuit par la planification (pg_cron + pg_net, supabase/scheduling.sql, tâche « immozen-marche ») :
//   - Carte des loyers (data.gouv.fr) : nouveau millésime ou fichier republié, chargé segment par segment ;
//   - taux d'usure (page trimestrielle de la Banque de France) : trimestre en cours et suivant, dès publication ;
//   - plafonds d'encadrement de Paris (données ouvertes de la Ville de Paris) : nouvelle année au 1er juillet ;
//   - le 1er du mois : e-mail de rappel à l'adresse de support (barème des taux, arrêtés à vérifier).
// Aucune clé d'API n'est nécessaire. Jeton de la planification : coffre « immozen_cron_secret » (ou secret CRON_SECRET).
// Chaque exécution est inscrite dans job_runs (« marche ») ; une erreur apparaît dans Administration → Incidents
// et est signalée par e-mail (une fois par semaine au plus pour la même erreur).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { syncMarket, type UsuryRow } from '../_shared/marketSync.ts';
import type { RentCap, RentIndicator, RentSegment } from '../_shared/rentData.ts';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

const env = (k: string) => Deno.env.get(k) ?? '';
const log = (msg: string, data: Record<string, unknown> = {}) => console.log(JSON.stringify({ msg, ...data }));
const todayParis = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const CHUNK = 5000;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Méthode non autorisée', { status: 405 });
  const started = Date.now();
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const secret = env('CRON_SECRET');
  let allowed = !!token && !!secret && token === secret;
  if (!allowed && token) {
    const { data, error } = await sb.rpc('iz_cron_token_ok', { p_token: token });
    if (error) log('vérification du jeton impossible', { error: error.message });
    allowed = data === true;
  }
  if (!allowed) return new Response('Non autorisé', { status: 401 });
  const body = await req.json().catch(() => ({})) as { today?: string };
  const today = /^\d{4}-\d{2}-\d{2}$/.test(body.today ?? '') ? body.today! : todayParis();
  const check = <T,>(r: { data: T; error: { message: string } | null }, what: string): T => { if (r.error) throw new Error(`${what} : ${r.error.message}`); return r.data; };

  try {
    const res = await syncMarket({
      fetch, today, elapsed: () => Date.now() - started, budgetMs: 100_000,
      db: {
        async state() {
          const rows = check(await sb.from('market_sync').select('source, version'), 'État des chargements') as { source: string; version: string }[];
          return Object.fromEntries(rows.map((r) => [r.source, { version: r.version }]));
        },
        async setState(source, version, details) {
          check(await sb.from('market_sync').upsert({ source, version, details, loaded_at: new Date().toISOString() }), 'État des chargements');
        },
        async status() {
          const [b, u, v, c, cfg] = await Promise.all([
            sb.from('loan_rate_benchmarks').select('effective_on').order('effective_on', { ascending: false }).limit(1),
            sb.from('usury_rates').select('quarter'),
            sb.rpc('iz_rent_indicator_stats'),
            sb.from('rent_caps').select('territory, valid_from, valid_to'),
            sb.from('market_config').select('encadrement_end').maybeSingle(),
          ]);
          return {
            benchmarkOn: ((check(b, 'Barème') as { effective_on: string }[])[0]?.effective_on) ?? null,
            usuryQuarters: [...new Set((check(u, 'Taux d’usure') as { quarter: string }[]).map((x) => x.quarter))],
            vintages: [...new Set((check(v, 'Carte des loyers') as { vintage: number }[]).map((x) => Number(x.vintage)))],
            caps: check(c, 'Plafonds') as { territory: string; valid_from: string; valid_to: string | null }[],
            encadrementEnd: (cfg.data as { encadrement_end?: string | null } | null)?.encadrement_end ?? '2026-11-23',
          };
        },
        async replaceIndicators(vintage: number, segment: RentSegment, rows: RentIndicator[]) {
          let n = 0;
          for (let i = 0; i < rows.length; i += CHUNK) {
            const part = rows.slice(i, i + CHUNK).map(({ insee, libgeo, low, mid, high, level, r2, nb_obs_commune, nb_obs_maille }) => ({ insee, libgeo, low, mid, high, level, r2, nb_obs_commune, nb_obs_maille }));
            n += Number(check(await sb.rpc('iz_market_replace_indicators', { p_vintage: vintage, p_segment: segment, p_rows: part, p_reset: i === 0 }), 'Carte des loyers'));
          }
          return n;
        },
        async insertUsury(rows: UsuryRow[]) {
          check(await sb.from('usury_rates').upsert(rows, { onConflict: 'quarter,borrower,bracket', ignoreDuplicates: true }), 'Taux d’usure');
        },
        async replaceCaps(territory: string, rows: RentCap[]) {
          const payload = rows.map(({ insee, zone, rooms, year_min, year_max, furnished, ref, max, min, valid_from, valid_to }) => ({ insee, zone, rooms, year_min, year_max, furnished, ref, max, min, valid_from, valid_to }));
          return Number(check(await sb.rpc('iz_market_replace_caps', { p_territory: territory, p_rows: payload }), 'Plafonds'));
        },
        async queueReminder(subject, text, dedupe) {
          const cfg = await sb.from('app_config').select('support_email').maybeSingle();
          const to = ((cfg.data as { support_email?: string | null } | null)?.support_email ?? '').trim() || 'contact@immo-zen.fr';
          const r = await sb.from('email_outbox').insert({ user_id: null, kind: 'alerte_exploitation', to_emails: [to], subject, body_text: text, dedupe_key: dedupe });
          if (r.error && !/duplicate key|unique/i.test(r.error.message)) throw new Error(`Rappel mensuel : ${r.error.message}`);
          return !r.error;
        },
      },
    });

    // même erreur déjà signalée depuis moins de 7 jours : inscrite au journal sans nouvelle alerte
    let status: 'ok' | 'erreur' = res.errors.length ? 'erreur' : 'ok';
    if (res.errors.length) {
      const signature = res.errors.join(' | ').slice(0, 300);
      const prev = await sb.from('market_sync').select('version, loaded_at').eq('source', 'derniere-erreur').maybeSingle();
      const p = prev.data as { version: string; loaded_at: string } | null;
      if (p && p.version === signature && Date.now() - Date.parse(p.loaded_at) < 7 * 86_400_000) status = 'ok';
      else await sb.from('market_sync').upsert({ source: 'derniere-erreur', version: signature, details: { errors: res.errors }, loaded_at: new Date().toISOString() });
    }
    await sb.from('job_runs').insert({ job: 'marche', run_key: new Date().toISOString(), status, details: res, finished_at: new Date().toISOString() });
    log('Données de marché', { ...res });
    return Response.json({ ok: res.errors.length === 0, ...res });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log('Exécution en erreur', { error: message });
    await sb.from('job_runs').insert({ job: 'marche', run_key: new Date().toISOString(), status: 'erreur', details: { error: message }, finished_at: new Date().toISOString() });
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
});
