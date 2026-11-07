// Immo-Zen – télétransmission EDI-TDFC de la liasse LMNP (Supabase Edge Function, Deno).
//
// Actions (POST, session de l'abonné) :
//   { action: 'preview', year }  → données qui seraient transmises et contrôles (ni numéro, ni signature, ni archive)
//   { action: 'prepare', year }  → interchange signé, archivé dans tdfc_submissions, renvoyé en base 64
// Les données sont lues avec la session de l'abonné (règles RLS) ; l'archive et le compteur journalier sont
// écrits avec le rôle service. La clé privée ne quitte jamais la fonction.
//
// Secrets : TDFC_AGREMENT, TDFC_TRANSFER_ALIAS, TDFC_TRANSFER_MODE (T par défaut), TDFC_ATTESTATION,
//   TDFC_ACCREDITATION (1368 caractères), TDFC_PRIVATE_KEY (PEM), TDFC_PRIVATE_KEY_PASSPHRASE,
//   TDFC_PARTNER_NAME, TDFC_PARTNER_ADDRESS (JSON), TDFC_MODE (test par défaut ; « reel » pour la production).
//
// Le cœur (core.ts) réutilise src/domain : il est regroupé dans core.bundle.js par scripts/build-functions.mjs
// avant le déploiement.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Buffer } from 'node:buffer';
import { accreditationMatchesKey, loadPrivateKey, rawRsaSigner, recoverBlock } from '../_shared/tdfcSigner.ts';
// @ts-ignore fichier JavaScript généré (types : core.ts)
import { parseAccreditation, partnerFromEnv, prepare, preview } from './core.bundle.js';

const env = (k: string) => Deno.env.get(k) ?? '';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: cors });

// configuration et clé chargées une fois par instance ; une clé qui ne correspond pas à l'accréditation est refusée
const cfg = partnerFromEnv((k: string) => Deno.env.get(k));
let signerState: { signer: ReturnType<typeof rawRsaSigner> } | { error: string } | null = null;
function signer() {
  if (signerState) return signerState;
  try {
    // une clé collée sur une ligne avec des « \n » littéraux est acceptée
    const key = loadPrivateKey(env('TDFC_PRIVATE_KEY').replace(/\\n/g, '\n'), env('TDFC_PRIVATE_KEY_PASSPHRASE') || undefined);
    const certified = parseAccreditation(env('TDFC_ACCREDITATION')).publicKeySpki;
    signerState = accreditationMatchesKey(certified, key)
      ? { signer: rawRsaSigner(key) }
      : { error: 'La clé privée ne correspond pas à la clé certifiée par l’accréditation.' };
  } catch (e) {
    signerState = { error: `Clé de signature inutilisable : ${(e as Error).message}` };
  }
  return signerState;
}

// deno-lint-ignore no-explicit-any
type Client = { from: (table: string) => any };

/** Forme du résultat de prepare (voir core.ts). */
type PrepareResult =
  | { ok: true; prepared: { reference: string; documentRef: string; bytes: Uint8Array; sha256: string; signatureHex: string; test: boolean; checks: unknown[]; summary: Record<string, number> } }
  | { ok: false; checks: unknown[] };

async function selectAll<T>(sb: Client, table: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select('*').range(from, from + 999);
    if (error) throw new Error(`${table} : ${error.message}`);
    out.push(...(data as T[]));
    if (!data || data.length < 1000) return out;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Méthode non autorisée' });

  const authHeader = req.headers.get('authorization') ?? '';
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const { data: auth } = await admin.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
  if (!auth.user) return reply(401, { error: 'Session expirée : reconnectez-vous.' });
  const userId = auth.user.id;
  // lecture avec les droits de l'abonné : seules ses propres lignes sont visibles
  const asUser = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { auth: { persistSession: false }, global: { headers: { Authorization: authHeader } } });

  const body = await req.json().catch(() => ({})) as { action?: string; year?: number };
  const year = Number(body.year);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return reply(400, { error: 'Année invalide.' });
  if (body.action !== 'preview' && body.action !== 'prepare') return reply(400, { error: 'Action inconnue.' });

  let snap: Record<string, unknown>, declarant: Record<string, unknown> | null;
  try {
    const [properties, leases, charges, payments, allocations, expenses, deposits, settings, decl] = await Promise.all([
      selectAll(asUser, 'properties'), selectAll(asUser, 'leases'), selectAll(asUser, 'rent_charges'), selectAll(asUser, 'payments'),
      selectAll(asUser, 'payment_allocations'), selectAll(asUser, 'expenses'), selectAll(asUser, 'deposit_movements'),
      asUser.from('user_settings').select('tax_inputs').maybeSingle(), asUser.from('tdfc_declarants').select('*').maybeSingle(),
    ]);
    snap = { properties, leases, charges, payments, allocations, expenses, deposits, taxInputs: settings.data?.tax_inputs ?? {} };
    declarant = (decl.data ?? null) as Record<string, unknown> | null;
  } catch (e) {
    console.error('tdfc lecture', (e as Error).message);
    return reply(500, { error: 'Lecture des données impossible.' });
  }

  const now = new Date();
  if (body.action === 'preview') return reply(200, { preview: preview(year, snap, declarant, cfg, now), test: cfg.test });

  // préparation : mandat en vigueur et clé utilisable exigés
  const { data: mandate } = await asUser.from('tdfc_mandates').select('id').is('revoked_at', null).order('signed_at', { ascending: false }).limit(1).maybeSingle();
  if (!mandate) return reply(403, { error: 'Mandat de télétransmission non signé : signez-le avant de préparer la déclaration.' });
  const s = signer();
  if ('error' in s) { console.error('tdfc clé', s.error); return reply(503, { error: 'Télétransmission indisponible : configuration de la signature incomplète.' }); }

  const id = crypto.randomUUID();
  let result: PrepareResult;
  try {
    result = (await prepare(year, snap, declarant, cfg, now, async (day: string) => {
      const { data, error } = await admin.rpc('iz_tdfc_next_sequence', { p_day: day });
      if (error) throw new Error(error.message);
      return data as number;
    }, { signer: s.signer, recover: recoverBlock }, id)) as PrepareResult;
  } catch (e) {
    console.error('tdfc préparation', (e as Error).message);
    return reply(500, { error: (e as Error).message.startsWith('Plus de 999') ? (e as Error).message : 'Préparation impossible.' });
  }
  if (!result.ok) return reply(422, { error: 'Contrôles bloquants : corrigez-les avant de préparer la déclaration.', checks: result.checks });

  const p = result.prepared;
  const b64 = Buffer.from(p.bytes).toString('base64');
  const { error } = await admin.from('tdfc_submissions').insert({
    id, user_id: userId, year, test: p.test, reference: p.reference, document_ref: p.documentRef, interchange_b64: b64,
    sha256: p.sha256, signature_hex: p.signatureHex, summary: p.summary, checks: p.checks, mandate_id: mandate.id,
  });
  if (error) { console.error('tdfc archive', error.message); return reply(500, { error: 'Archivage impossible : rien n’a été transmis.' }); }
  return reply(200, { id, reference: p.reference, test: p.test, sha256: p.sha256, checks: p.checks, summary: p.summary, interchange_b64: b64,
    file_name: `TDFC_${p.reference}${p.test ? '_TEST' : ''}.edi` });
});
