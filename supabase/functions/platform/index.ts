// Immo-Zen – fonctions de la plateforme appelées par l'application (utilisateur connecté).
//  * checkout : page de paiement Stripe pour la formule choisie (l'abonnement n'est activé que par le webhook) ;
//  * pack     : paiement ponctuel du pack fiscal (12 mois), pour un abonné Essentiel ou Patrimoine ;
//  * portal   : espace client Stripe (factures, moyen de paiement, résiliation) ;
//  * invite   : invitation d'un utilisateur par e-mail (administrateurs) — l'invité choisit lui-même son mot de passe.
// Secrets : STRIPE_SECRET_KEY, APP_URL (+ SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY fournis par Supabase).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { stripeRequest } from '../_shared/stripe.ts';

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
  const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const { data: auth } = await admin.auth.getUser(jwt);
  const user = auth.user;
  if (!user) return reply(401, { error: 'Session expirée : reconnectez-vous.' });

  const body = await req.json().catch(() => ({})) as { action?: string; plan?: string; email?: string };
  const appUrl = env('APP_URL').replace(/\/?$/, '/');

  try {
    if (body.action === 'invite') {
      const { data: isAdmin } = await admin.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
      if (!isAdmin) return reply(403, { error: 'Réservé aux administrateurs.' });
      const email = String(body.email ?? '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply(400, { error: 'Adresse e-mail invalide.' });
      const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${appUrl}#/nouveau-mot-de-passe` });
      if (error) return reply(400, { error: error.message });
      await admin.from('admin_audit').insert({ admin_id: user.id, action: 'invitation', details: { email } });
      return reply(200, { ok: true });
    }

    const secret = env('STRIPE_SECRET_KEY');
    if (!secret || !env('APP_URL')) return reply(503, { error: 'Le paiement en ligne n’est pas encore configuré.' });
    const { data: sub } = await admin.from('subscriptions').select('*').eq('user_id', user.id).maybeSingle();

    if (body.action === 'portal') {
      if (!sub?.stripe_customer_id) return reply(400, { error: 'Aucun abonnement Stripe pour ce compte.' });
      const s = await stripeRequest<{ url: string }>(secret, 'POST', 'billing_portal/sessions', { customer: sub.stripe_customer_id, return_url: `${appUrl}#/abonnement` });
      return reply(200, { url: s.url });
    }

    if (body.action === 'checkout') {
      const { data: plan } = await admin.from('plans').select('*').eq('code', body.plan ?? '').eq('active', true).eq('kind', 'formule').maybeSingle();
      if (!plan?.stripe_price_id) return reply(400, { error: 'Offre indisponible.' });
      if (sub?.source === 'stripe' && ['active', 'trialing', 'past_due'].includes(sub.status)) return reply(409, { error: 'Un abonnement est déjà en cours : gérez-le depuis l’espace client.' });
      let customer = sub?.stripe_customer_id as string | undefined;
      if (!customer) {
        const c = await stripeRequest<{ id: string }>(secret, 'POST', 'customers', { email: user.email ?? '', 'metadata[user_id]': user.id });
        customer = c.id;
        await admin.from('subscriptions').upsert({ user_id: user.id, stripe_customer_id: customer, source: 'stripe' }, { onConflict: 'user_id' });
      }
      const s = await stripeRequest<{ url: string }>(secret, 'POST', 'checkout/sessions', {
        mode: 'subscription', customer, client_reference_id: user.id,
        'line_items[0][price]': plan.stripe_price_id, 'line_items[0][quantity]': 1,
        'subscription_data[metadata][user_id]': user.id, allow_promotion_codes: true, locale: 'fr',
        success_url: `${appUrl}#/abonnement?retour=ok`, cancel_url: `${appUrl}#/abonnement?retour=annule`,
      });
      return reply(200, { url: s.url });
    }
    if (body.action === 'pack') {
      const { data: pack } = await admin.from('plans').select('*').eq('code', 'pack_fiscal').eq('active', true).maybeSingle();
      if (!pack?.stripe_price_id) return reply(400, { error: 'Le pack fiscal n’est pas encore proposé.' });
      const { data: tier } = await admin.rpc('iz_user_tier', { p_user: user.id });
      if (tier === 'pro') return reply(409, { error: 'La déclaration fiscale est déjà incluse dans la formule Pro.' });
      const paying = sub?.source === 'stripe' && ['active', 'trialing', 'past_due'].includes(sub.status);
      if (!paying || !['essentiel', 'patrimoine'].includes(String(tier))) return reply(409, { error: 'Le pack fiscal complète une formule Essentiel ou Patrimoine : abonnez-vous d’abord.' });
      const s = await stripeRequest<{ url: string }>(secret, 'POST', 'checkout/sessions', {
        mode: 'payment', customer: sub.stripe_customer_id, client_reference_id: user.id,
        'line_items[0][price]': pack.stripe_price_id, 'line_items[0][quantity]': 1,
        'metadata[addon]': 'pack_fiscal', 'metadata[user_id]': user.id, 'payment_intent_data[metadata][addon]': 'pack_fiscal',
        allow_promotion_codes: true, locale: 'fr',
        success_url: `${appUrl}#/abonnement?retour=pack`, cancel_url: `${appUrl}#/abonnement?retour=annule`,
      });
      return reply(200, { url: s.url });
    }
    return reply(400, { error: 'Action inconnue.' });
  } catch (e) {
    console.error('platform', body.action, e instanceof Error ? e.message : e);
    return reply(502, { error: 'Le service de paiement n’a pas répondu. Réessayez dans quelques minutes.' });
  }
});
