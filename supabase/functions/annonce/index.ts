// Immo-Zen – lecture d'une annonce immobilière à partir de son lien (Supabase Edge Function, Deno).
// Télécharge la page de l'annonce, en extrait les caractéristiques du bien (données structurées, balises,
// texte) et, si une clé d'API Claude est configurée et que des informations clés manquent, complète par une
// lecture assistée du texte de l'annonce. Aucune donnée de l'utilisateur n'est transmise : seulement la page publique.
// Secrets facultatifs : ANTHROPIC_API_KEY, LISTING_MODEL (défaut claude-haiku-5-5), ASSISTANT_DAILY_LIMIT (quota partagé avec l'assistant).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { htmlToText, LISTING_AI_PROMPT, listingScore, mergeListing, parseListing, sanitizeListing } from '../_shared/listing.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: cors });
const MAX_BYTES = 3_000_000;
const BLOCKED_MSG = 'Le site de l’annonce refuse la lecture automatique. Copiez le texte de l’annonce (Ctrl+A, Ctrl+C sur la page) et collez-le dans « Coller le texte de l’annonce ».';

/** Adresse IP privée, locale ou réservée : jamais appelée (protection contre l'accès au réseau interne). */
function privateIp(ip: string): boolean {
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('::ffff:');
}

async function safeUrl(raw: string): Promise<URL | null> {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || (u.port && !['80', '443'].includes(u.port))) return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host.includes('.') || /^(localhost|.*\.local|.*\.internal|metadata\..*)$/i.test(host) || privateIp(host)) return null;
  try {
    const ips = [...await Deno.resolveDns(host, 'A').catch(() => [] as string[]), ...await Deno.resolveDns(host, 'AAAA').catch(() => [] as string[])];
    if (ips.some(privateIp)) return null;
  } catch { /* résolution indisponible : contrôles ci-dessus seulement */ }
  return u;
}

async function download(start: URL): Promise<{ html: string; url: string } | { status: number }> {
  let url = start;
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(12_000),
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; Immo-Zen/1.0; +https://immo-zen.fr) lecture d’annonce à la demande de l’utilisateur',
        'accept': 'text/html,application/xhtml+xml', 'accept-language': 'fr-FR,fr;q=0.9',
      },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = await safeUrl(new URL(res.headers.get('location')!, url).toString());
      if (!next) return { status: 400 };
      url = next;
      continue;
    }
    if (!res.ok) return { status: res.status };
    const type = res.headers.get('content-type') ?? '';
    if (!/html|xml|text\/plain/i.test(type)) return { status: 415 };
    const reader = res.body?.getReader();
    if (!reader) return { status: 502 };
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) { await reader.cancel(); break; }
      chunks.push(value);
    }
    const buf = new Uint8Array(size > MAX_BYTES ? MAX_BYTES : size);
    let o = 0; for (const c of chunks) { if (o + c.length > buf.length) { buf.set(c.subarray(0, buf.length - o), o); break; } buf.set(c, o); o += c.length; }
    const charset = type.match(/charset=([\w-]+)/i)?.[1] ?? 'utf-8';
    let html: string;
    try { html = new TextDecoder(charset).decode(buf); } catch { html = new TextDecoder().decode(buf); }
    return { html, url: url.toString() };
  }
  return { status: 508 };
}

/** Lecture assistée par Claude : JSON des caractéristiques, validé avant usage. */
async function aiRead(text: string, key: string): Promise<Record<string, unknown> | null> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(25_000),
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: env('LISTING_MODEL') || 'claude-haiku-5-5',
      max_tokens: 500,
      system: LISTING_AI_PROMPT,
      messages: [{ role: 'user', content: `Annonce :\n${text.slice(0, 15_000)}` }],
    }),
  });
  if (!res.ok) { console.error('annonce ia', res.status, (await res.text()).slice(0, 200)); return null; }
  const json = await res.json() as { content?: { type: string; text?: string }[] };
  const out = (json.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const m = out.match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) as Record<string, unknown> : null; } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Méthode non autorisée' });
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const { data: auth } = await sb.auth.getUser(req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '');
  if (!auth.user) return reply(401, { error: 'Session expirée : reconnectez-vous.' });

  const body = await req.json().catch(() => ({})) as { url?: string; text?: string };
  // quota quotidien partagé avec l'assistant : chaque lecture d'annonce compte pour une demande
  const limit = Number(env('ASSISTANT_DAILY_LIMIT') || 40);
  const { data: allowed, error: qErr } = await sb.rpc('iz_assistant_take', { p_user: auth.user.id, p_limit: limit });
  if (!qErr && allowed === false) return reply(429, { error: `Limite de ${limit} lectures par jour atteinte : réessayez demain, ou collez le texte de l’annonce.` });

  let text = typeof body.text === 'string' ? body.text.slice(0, 50_000) : '';
  let listing = parseListing({ text });
  let finalUrl: string | null = null;
  if (!text) {
    const url = typeof body.url === 'string' ? await safeUrl(body.url.trim()) : null;
    if (!url) return reply(400, { error: 'Lien d’annonce invalide : adresse web publique commençant par https://.' });
    let page: Awaited<ReturnType<typeof download>>;
    try { page = await download(url); } catch (e) {
      console.error('annonce', e instanceof Error ? e.message : e);
      return reply(504, { error: 'Le site de l’annonce ne répond pas. Réessayez, ou collez le texte de l’annonce.', blocked: true });
    }
    if ('status' in page) {
      const blocked = [401, 403, 429, 451, 503].includes(page.status);
      return reply(422, { error: blocked ? BLOCKED_MSG : page.status === 404 || page.status === 410 ? 'Annonce introuvable : elle a peut-être été retirée.' : `Page illisible (erreur ${page.status}). Collez le texte de l’annonce.`, blocked: true });
    }
    finalUrl = page.url;
    text = htmlToText(page.html);
    listing = parseListing({ html: page.html });
    // page de protection anti-robot (captcha) : rien d'exploitable
    if (listingScore(listing) === 0 && /captcha|datadome|cloudflare|access denied|are you a robot|vérification/i.test(text.slice(0, 3000))) {
      return reply(422, { error: BLOCKED_MSG, blocked: true });
    }
  }

  // lecture assistée seulement si des informations clés manquent et si la clé est configurée
  const key = env('ANTHROPIC_API_KEY');
  let assisted = false;
  if (key && !qErr && text.length > 80 && (listing.price === null || listing.surface === null || listingScore(listing) < 5)) {
    const raw = await aiRead(text, key).catch(() => null);
    if (raw) { listing = mergeListing(listing, sanitizeListing(raw), 'lecture assistée'); assisted = true; }
  }
  return reply(200, { listing, url: finalUrl, assisted });
});
