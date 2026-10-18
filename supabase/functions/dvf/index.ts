// Immo-Zen – estimation DVF côté serveur (repli si le navigateur ne peut pas lire les fichiers publics DVF).
// Télécharge les fichiers communaux DVF des trois dernières années et renvoie la fourchette estimée.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { dvfYears, estimate, loadSales, type DvfType } from '../_shared/dvf.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: cors });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Méthode non autorisée' });
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const { data: auth } = await sb.auth.getUser(req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '');
  if (!auth.user) return reply(401, { error: 'Session expirée : reconnectez-vous.' });
  const b = await req.json().catch(() => ({})) as { citycode?: string; type?: DvfType; surface?: number; lat?: number | null; lon?: number | null };
  if (!/^[0-9][0-9AB][0-9]{3}$/.test(b.citycode ?? '') || (b.type !== 'Appartement' && b.type !== 'Maison') || !(Number(b.surface) > 0)) {
    return reply(400, { error: 'Commune, type ou surface manquants.' });
  }
  try {
    const sales = await loadSales(b.citycode!, dvfYears(new Date().toISOString().slice(0, 10)));
    return reply(200, { estimate: estimate(sales, { type: b.type, surface: Number(b.surface), lat: b.lat ?? null, lon: b.lon ?? null }) });
  } catch (e) {
    console.error('dvf', e instanceof Error ? e.message : e);
    return reply(502, { error: 'Données DVF momentanément indisponibles.' });
  }
});
