// Immo-Zen – assistant conversationnel (Supabase Edge Function, Deno).
// Explique le fonctionnement de l'application à partir de la base de connaissances partagée (_shared/help.ts).
// Aucune donnée de l'utilisateur n'est transmise au modèle : seulement ses questions et la rubrique affichée.
// Secrets : ANTHROPIC_API_KEY (obligatoire), ASSISTANT_MODEL (défaut claude-haiku-5-5), ASSISTANT_DAILY_LIMIT (défaut 40).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { ASSISTANT_SYSTEM, helpCorpus } from '../_shared/help.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: cors });
const SYSTEM = ASSISTANT_SYSTEM + helpCorpus();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Méthode non autorisée' });
  const key = env('ANTHROPIC_API_KEY');
  if (!key) return reply(503, { error: 'Assistant non configuré.' });

  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const { data: auth } = await sb.auth.getUser(jwt);
  if (!auth.user) return reply(401, { error: 'Session expirée : reconnectez-vous.' });

  const body = await req.json().catch(() => ({})) as { messages?: { role: string; content: string }[]; page?: string };
  const messages = (body.messages ?? []).slice(-12)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content.slice(0, 2000) }));
  while (messages.length && messages[0]!.role !== 'user') messages.shift();
  if (!messages.length || messages.at(-1)!.role !== 'user') return reply(400, { error: 'Question manquante.' });

  // quota quotidien par compte (fuseau de Paris)
  const limit = Number(env('ASSISTANT_DAILY_LIMIT') || 40);
  const { data: used, error: qErr } = await sb.rpc('iz_assistant_take', { p_user: auth.user.id, p_limit: limit });
  if (qErr) return reply(500, { error: 'Quota indisponible.' });
  if (used === false) return reply(429, { error: `Limite de ${limit} questions par jour atteinte : réessayez demain, ou consultez l’aide intégrée.` });

  const page = typeof body.page === 'string' ? body.page.slice(0, 40) : '';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: env('ASSISTANT_MODEL') || 'claude-haiku-5-5',
      max_tokens: 700,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }, { type: 'text', text: page ? `Rubrique actuellement affichée : ${page}.` : 'Rubrique affichée inconnue.' }],
      messages,
    }),
  });
  if (!res.ok) {
    console.error('assistant', res.status, (await res.text()).slice(0, 300));
    return reply(502, { error: 'L’assistant n’a pas répondu. Réessayez dans un instant.' });
  }
  const json = await res.json() as { content?: { type: string; text?: string }[] };
  const answer = (json.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
  return reply(200, { answer: answer || 'Je n’ai pas de réponse à cette question.' });
});
