// Immo-Zen – webhook Stripe (Supabase Edge Function, Deno).
// Seule source de vérité des abonnements Stripe : l'interface ne fait que lire `subscriptions`.
//  * signature vérifiée (STRIPE_WEBHOOK_SECRET), tolérance 5 min ;
//  * idempotence : chaque événement est enregistré une fois (stripe_events.id) ; un doublon est acquitté sans retraitement ;
//  * ordre : l'abonnement est relu chez Stripe à chaque événement, et un état plus ancien n'écrase jamais un plus récent ;
//  * en cas d'erreur, réponse 500 : Stripe renvoie l'événement plus tard.
// Secrets : STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (+ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY fournis par Supabase).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { fiscalPackFromSession, HANDLED_EVENTS, stripeRequest, subscriptionFields, subscriptionIdOf, verifyStripeSignature, type StripeEvent, type StripeSubscription } from '../_shared/stripe.ts';

const env = (k: string) => Deno.env.get(k) ?? '';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Méthode non autorisée', { status: 405 });
  const secret = env('STRIPE_SECRET_KEY');
  const whsec = env('STRIPE_WEBHOOK_SECRET');
  if (!secret || !whsec) return new Response('Paiement non configuré', { status: 503 });
  const payload = await req.text();
  if (!(await verifyStripeSignature(payload, req.headers.get('stripe-signature'), whsec))) return new Response('Signature invalide', { status: 400 });

  const ev = JSON.parse(payload) as StripeEvent;
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

  const { data: existing } = await sb.from('stripe_events').select('status').eq('id', ev.id).maybeSingle();
  if (existing && existing.status !== 'erreur') return Response.json({ received: true, duplicate: true });
  if (!existing) {
    const { error } = await sb.from('stripe_events').insert({ id: ev.id, type: ev.type });
    if (error && error.code !== '23505') return new Response('Erreur base', { status: 500 });
  }
  const done = (status: 'traite' | 'ignore' | 'erreur', extra: Record<string, unknown> = {}) =>
    sb.from('stripe_events').update({ status, processed_at: new Date().toISOString(), ...extra }).eq('id', ev.id);

  try {
    if (!HANDLED_EVENTS.includes(ev.type) || ev.type === 'charge.refunded') {
      // remboursement : l'accès dépend de l'état de l'abonnement, transmis par ses propres événements
      await done('ignore');
      return Response.json({ received: true });
    }
    const o = ev.data.object as Record<string, unknown>;
    // Paiement ponctuel (pack fiscal) : aucun abonnement concerné
    if (ev.type.startsWith('checkout.session.') && o.mode === 'payment') {
      const pack = fiscalPackFromSession(ev);
      if (!pack) { await done('ignore', { error: o.payment_status === 'unpaid' ? 'paiement en attente de confirmation' : null }); return Response.json({ received: true }); }
      const { error } = await sb.rpc('iz_grant_fiscal_pack', { p_user: pack.userId });
      if (error) throw new Error(error.message);
      await done('traite', { user_id: pack.userId });
      return Response.json({ received: true });
    }
    let userId: string | null = null;
    if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') {
      userId = (o.client_reference_id as string) ?? null;
      if (userId && o.customer) {
        await sb.from('subscriptions').upsert({ user_id: userId, stripe_customer_id: o.customer as string, source: 'stripe' }, { onConflict: 'user_id', ignoreDuplicates: false });
      }
    }
    const subId = subscriptionIdOf(ev);
    if (!subId) { await done('ignore'); return Response.json({ received: true }); }
    const sub = await stripeRequest<StripeSubscription>(secret, 'GET', `subscriptions/${subId}`);
    if (!userId) userId = sub.metadata?.user_id ?? null;
    if (!userId) {
      const { data } = await sb.from('subscriptions').select('user_id').eq('stripe_customer_id', sub.customer).maybeSingle();
      userId = data?.user_id ?? null;
    }
    if (!userId) throw new Error('Client Stripe non rattaché à un compte');

    const { data: plans } = await sb.from('plans').select('code, stripe_price_id, kind');
    // seules les formules déterminent l'offre d'un abonnement
    const planByPrice = Object.fromEntries((plans ?? []).filter((p) => p.stripe_price_id && (p.kind ?? 'formule') === 'formule').map((p) => [p.stripe_price_id, p.code]));
    const { data: current } = await sb.from('subscriptions').select('stripe_updated_at').eq('user_id', userId).maybeSingle();
    if (current?.stripe_updated_at && current.stripe_updated_at > ev.created) {
      await done('ignore', { user_id: userId, error: 'événement plus ancien que l’état enregistré' });
      return Response.json({ received: true });
    }
    const { error } = await sb.from('subscriptions').upsert({ user_id: userId, ...subscriptionFields(sub, planByPrice, ev.created) }, { onConflict: 'user_id' });
    if (error) throw new Error(error.message);
    await done('traite', { user_id: userId });
    return Response.json({ received: true });
  } catch (e) {
    await done('erreur', { error: String(e instanceof Error ? e.message : e).slice(0, 500) });
    return new Response('Erreur de traitement', { status: 500 });
  }
});
