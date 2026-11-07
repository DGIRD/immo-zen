/**
 * Télétransmission EDI-TDFC : identité fiscale, mandat, aperçu, préparation signée et historique.
 * En ligne, l'aperçu et la préparation sont calculés par la fonction serveur « tdfc » à partir des données
 * enregistrées (jamais à partir de ce que le navigateur envoie). En démonstration, l'aperçu est calculé
 * localement et la préparation signée n'est pas possible (aucune clé de signature).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { RepoError } from './repo.ts';
import type { PostalAddress, TdfcCheck } from '../domain/edi/tdfc.ts';
import { validSiren } from '../domain/edi/tdfc.ts';
import { partnerFromEnv, preview as computePreview, type Preview, type TdfcSnapshot } from '../../supabase/functions/tdfc/core.ts';

export type { Preview };

/**
 * Ouverture du service aux abonnés. Tant qu'elle vaut false (habilitation DGFiP et relecture du mandat
 * en cours), le bouton « Télétransmettre la liasse » et la page sont masqués. Pour tester l'écran avant
 * l'ouverture : localStorage.setItem('iz-tdfc-preview', '1') dans la console du navigateur.
 */
export const TDFC_OPEN = false;
export function tdfcVisible(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): boolean {
  if (TDFC_OPEN) return true;
  try { return storage?.getItem('iz-tdfc-preview') === '1'; } catch { return false; }
}

/** Version du texte du mandat présenté à l'abonné (enregistrée avec la signature). */
export const MANDATE_VERSION = '2026-11';

export interface TdfcDeclarant {
  siren: string;
  rof: string;
  name: string;
  address: PostalAddress;
  home: PostalAddress | null;
  naf: string | null;
  activity: string | null;
}
export interface TdfcMandate { id: string; text_version: string; signed_at: string; revoked_at: string | null }
export interface TdfcSubmission {
  id: string; year: number; test: boolean; reference: string; document_ref: string;
  status: 'preparee' | 'transmise' | 'acceptee' | 'rejetee' | 'annulee'; sha256: string;
  summary: { fiscalResult?: number; turnover?: number; assetsNet?: number; items?: number; properties?: number };
  prepared_at: string; status_at: string | null; status_detail: string | null;
}
export interface PreparedFile { id: string; reference: string; test: boolean; sha256: string; checks: TdfcCheck[]; fileName: string; bytes: Uint8Array }

export const SUBMISSION_STATUS: Record<TdfcSubmission['status'], string> = {
  preparee: 'Préparée (non transmise)', transmise: 'Transmise', acceptee: 'Acceptée par la DGFiP', rejetee: 'Rejetée', annulee: 'Annulée',
};

/** Préparation signée impossible ici (démonstration, ou fonction serveur non déployée). */
export class TdfcUnavailable extends Error {}
/** Préparation refusée : contrôles bloquants. */
export class TdfcBlocked extends Error {
  constructor(message: string, readonly checks: TdfcCheck[]) { super(message); }
}

export interface TdfcApi {
  /** false : migration de la télétransmission non exécutée. */
  ready(): Promise<boolean>;
  declarant(): Promise<TdfcDeclarant | null>;
  saveDeclarant(d: TdfcDeclarant): Promise<void>;
  mandates(): Promise<TdfcMandate[]>;
  signMandate(): Promise<void>;
  revokeMandate(): Promise<void>;
  submissions(): Promise<TdfcSubmission[]>;
  /** Aperçu ; `local` ne sert qu'en démonstration (en ligne, le serveur lit la base). */
  preview(year: number, local: TdfcSnapshot): Promise<{ preview: Preview; test: boolean }>;
  prepare(year: number): Promise<PreparedFile>;
  download(id: string): Promise<{ fileName: string; bytes: Uint8Array }>;
}

/** Contrôles de saisie de l'identité fiscale (mêmes règles que la base). */
export function declarantErrors(d: TdfcDeclarant): Partial<Record<'siren' | 'rof' | 'name' | 'street' | 'zip' | 'city' | 'naf' | 'homeStreet' | 'homeZip' | 'homeCity', string>> {
  const e: ReturnType<typeof declarantErrors> = {};
  if (!/^\d{9}$/.test(d.siren)) e.siren = 'Le SIREN compte 9 chiffres.';
  else if (!validSiren(d.siren)) e.siren = 'SIREN invalide (clé de contrôle).';
  if (!/^BIC[1-9]\d{0,4}$/.test(d.rof)) e.rof = 'Format attendu : BIC suivi d’un numéro sans zéro initial (ex. BIC1).';
  if (!d.name.trim()) e.name = 'Nom requis.'; else if (d.name.trim().length > 35) e.name = '35 caractères au plus.';
  if (!d.address.street.trim()) e.street = 'Adresse requise.'; else if (d.address.street.trim().length > 35) e.street = '35 caractères au plus.';
  if (!/^\d{5}$/.test(d.address.zip)) e.zip = 'Code postal à 5 chiffres.';
  if (!d.address.city.trim()) e.city = 'Ville requise.'; else if (d.address.city.trim().length > 35) e.city = '35 caractères au plus.';
  if (d.naf && !/^\d{4}[A-Z]$/.test(d.naf)) e.naf = 'Format attendu : 4 chiffres et une lettre (ex. 6820A).';
  if (d.home) {
    if (!d.home.street.trim()) e.homeStreet = 'Adresse requise.'; else if (d.home.street.trim().length > 35) e.homeStreet = '35 caractères au plus.';
    if (!/^\d{5}$/.test(d.home.zip)) e.homeZip = 'Code postal à 5 chiffres.';
    if (!d.home.city.trim()) e.homeCity = 'Ville requise.';
  }
  return e;
}

const clean = (a: PostalAddress): PostalAddress => ({
  street: a.street.trim(), zip: a.zip.trim(), city: a.city.trim(),
  ...(a.complement?.trim() ? { complement: a.complement.trim() } : {}),
});
function normalize(d: TdfcDeclarant): TdfcDeclarant {
  return { siren: d.siren.replace(/\s/g, ''), rof: d.rof.trim().toUpperCase(), name: d.name.trim(), address: clean(d.address), home: d.home ? clean(d.home) : null,
    naf: d.naf?.trim().toUpperCase().replace('.', '') || null, activity: d.activity?.trim() || null };
}
function assertValid(d: TdfcDeclarant) {
  const e = declarantErrors(d);
  const first = Object.values(e)[0];
  if (first) throw new RepoError(first);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const fileName = (reference: string, test: boolean) => `TDFC_${reference}${test ? '_TEST' : ''}.edi`;

// ------------------------------------------------------------------ en ligne

const missing = (e: { code?: string; message?: string } | null) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /schema cache|does not exist/i.test(e.message ?? ''));
function check<T>(r: { data: T; error: { message: string; code?: string } | null }): T {
  if (r.error) throw missing(r.error) ? new RepoError('Mise à jour de la base requise pour la télétransmission.') : new RepoError(r.error.message);
  return r.data;
}

export function createSupabaseTdfc(sb: SupabaseClient): TdfcApi {
  async function invoke(body: Record<string, unknown>) {
    const { data, error } = await sb.functions.invoke('tdfc', { body });
    if (error) {
      const ctx = (error as { context?: Response }).context;
      if (!ctx || ctx.status === 404) throw new TdfcUnavailable('La télétransmission n’est pas encore ouverte : le service de préparation n’est pas déployé.');
      let j: { error?: string; checks?: TdfcCheck[] } = {};
      try { j = await ctx.json(); } catch { /* corps illisible */ }
      if (ctx.status === 422 && j.checks) throw new TdfcBlocked(j.error ?? 'Contrôles bloquants.', j.checks);
      if (ctx.status === 503) throw new TdfcUnavailable(j.error ?? 'La télétransmission n’est pas encore ouverte.');
      throw new RepoError(j.error ?? 'Service de télétransmission indisponible.');
    }
    return data as Record<string, unknown>;
  }
  return {
    async ready() {
      const r = await sb.from('tdfc_declarants').select('user_id').limit(1);
      return !missing(r.error);
    },
    async declarant() {
      return check(await sb.from('tdfc_declarants').select('siren, rof, name, address, home, naf, activity').maybeSingle()) as TdfcDeclarant | null;
    },
    async saveDeclarant(input) {
      const d = normalize(input);
      assertValid(d);
      const { data: u } = await sb.auth.getUser();
      check(await sb.from('tdfc_declarants').upsert({ user_id: u.user?.id, ...d }, { onConflict: 'user_id' }));
    },
    async mandates() {
      return check(await sb.from('tdfc_mandates').select('id, text_version, signed_at, revoked_at').order('signed_at', { ascending: false })) as TdfcMandate[];
    },
    async signMandate() {
      check(await sb.from('tdfc_mandates').insert({ text_version: MANDATE_VERSION }));
    },
    async revokeMandate() {
      check(await sb.rpc('iz_tdfc_revoke_mandate'));
    },
    async submissions() {
      return check(await sb.from('tdfc_submissions').select('id, year, test, reference, document_ref, status, sha256, summary, prepared_at, status_at, status_detail')
        .order('prepared_at', { ascending: false })) as TdfcSubmission[];
    },
    async preview(year) {
      const r = await invoke({ action: 'preview', year });
      return { preview: r.preview as Preview, test: r.test !== false };
    },
    async prepare(year) {
      const r = await invoke({ action: 'prepare', year }) as { id: string; reference: string; test: boolean; sha256: string; checks: TdfcCheck[]; interchange_b64: string; file_name: string };
      return { id: r.id, reference: r.reference, test: r.test, sha256: r.sha256, checks: r.checks, fileName: r.file_name, bytes: b64ToBytes(r.interchange_b64) };
    },
    async download(id) {
      const row = check(await sb.from('tdfc_submissions').select('reference, test, interchange_b64').eq('id', id).single()) as { reference: string; test: boolean; interchange_b64: string };
      return { fileName: fileName(row.reference, row.test), bytes: b64ToBytes(row.interchange_b64) };
    },
  };
}

// ------------------------------------------------------------------ démonstration

const DEMO_KEY = 'izdemo-tdfc';
interface DemoTdfc { declarant: TdfcDeclarant | null; mandates: TdfcMandate[] }

/** Partenaire fictif de démonstration : non habilité (ni agrément ni accréditation), comme avant l'ouverture du service. */
const DEMO_PARTNER = partnerFromEnv((k) => ({ TDFC_PARTNER_NAME: 'IMMO-ZEN', TDFC_PARTNER_ADDRESS: '{"street":"1 avenue de Paris","zip":"94300","city":"Vincennes"}' } as Record<string, string>)[k]);

export function createDemoTdfc(storage: Storage): TdfcApi {
  const read = (): DemoTdfc => {
    try { const v = storage.getItem(DEMO_KEY); if (v) return JSON.parse(v) as DemoTdfc; } catch { /* stockage indisponible */ }
    return { declarant: null, mandates: [] };
  };
  const write = (d: DemoTdfc) => { try { storage.setItem(DEMO_KEY, JSON.stringify(d)); } catch { /* stockage indisponible */ } };
  return {
    async ready() { return true; },
    async declarant() { return read().declarant; },
    async saveDeclarant(input) {
      const d = normalize(input);
      assertValid(d);
      const s = read(); s.declarant = d; write(s);
    },
    async mandates() { return read().mandates; },
    async signMandate() {
      const s = read();
      if (s.mandates.some((m) => !m.revoked_at)) throw new RepoError('Un mandat est déjà en vigueur.');
      s.mandates.unshift({ id: crypto.randomUUID(), text_version: MANDATE_VERSION, signed_at: new Date().toISOString(), revoked_at: null });
      write(s);
    },
    async revokeMandate() {
      const s = read();
      s.mandates = s.mandates.map((m) => (m.revoked_at ? m : { ...m, revoked_at: new Date().toISOString() }));
      write(s);
    },
    async submissions() { return []; },
    async preview(year, local) {
      return { preview: computePreview(year, local, read().declarant, DEMO_PARTNER, new Date()), test: true };
    },
    async prepare() {
      throw new TdfcUnavailable('Mode démonstration : la préparation signée demande le service en ligne et la clé de signature d’Immo-Zen.');
    },
    async download() { throw new TdfcUnavailable('Mode démonstration : aucun fichier préparé.'); },
  };
}
