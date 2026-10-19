/**
 * Outils Stripe sans dépendance (Deno, navigateur, Node 20) : signature des webhooks,
 * appels REST, traduction d'un abonnement Stripe en ligne `subscriptions`.
 */

export interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end: boolean;
  canceled_at: number | null;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items?: { data: { price: { id: string }; current_period_end?: number }[] };
}

export interface StripeEvent {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
}

const enc = new TextEncoder();

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** En-tête « Stripe-Signature » : t=horodatage,v1=signature[,v1=…]. Tolérance de 5 minutes contre le rejeu. */
export async function verifyStripeSignature(payload: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000), tolerance = 300): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v ?? '');
  if (!Number.isFinite(t) || !sigs.length || Math.abs(nowSec - t) > tolerance) return false;
  const expected = await hmacHex(secret, `${t}.${payload}`);
  return sigs.some((s) => safeEqual(s, expected));
}

/** Signature de test (outil des tests unitaires). */
export async function signStripePayload(payload: string, secret: string, t: number): Promise<string> {
  return `t=${t},v1=${await hmacHex(secret, `${t}.${payload}`)}`;
}

const KNOWN = ['trialing', 'active', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused'];

/** Champs de la table `subscriptions` pour un abonnement Stripe. */
export function subscriptionFields(sub: StripeSubscription, planByPrice: Record<string, string>, eventCreated: number) {
  // ligne de la formule (une option éventuelle ne détermine pas l'offre)
  const item = sub.items?.data?.find((i) => planByPrice[i.price.id]) ?? sub.items?.data?.[0];
  const end = sub.current_period_end ?? item?.current_period_end ?? null;
  return {
    source: 'stripe' as const,
    status: KNOWN.includes(sub.status) ? sub.status : 'incomplete',
    plan_code: item ? planByPrice[item.price.id] ?? null : null,
    stripe_customer_id: sub.customer,
    stripe_subscription_id: sub.id,
    current_period_end: end ? new Date(end * 1000).toISOString() : null,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
    stripe_updated_at: eventCreated,
    updated_at: new Date().toISOString(),
  };
}

/** Identifiant d'abonnement concerné par un événement (ou null si l'événement est sans effet sur l'accès). */
export function subscriptionIdOf(ev: StripeEvent): string | null {
  const o = ev.data.object as Record<string, unknown>;
  if (ev.type.startsWith('customer.subscription.')) return String(o.id);
  if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') return (o.subscription as string) ?? null;
  if (ev.type.startsWith('invoice.')) {
    const parent = (o.parent as { subscription_details?: { subscription?: string } } | undefined)?.subscription_details?.subscription;
    return (o.subscription as string) ?? parent ?? null;
  }
  return null;
}

/**
 * Pack fiscal (paiement ponctuel) : compte à créditer, uniquement une fois le paiement encaissé.
 * Un prélèvement SEPA est confirmé plus tard (« checkout.session.async_payment_succeeded »).
 */
export function fiscalPackFromSession(ev: StripeEvent): { userId: string } | null {
  if (ev.type !== 'checkout.session.completed' && ev.type !== 'checkout.session.async_payment_succeeded') return null;
  const o = ev.data.object as { mode?: string; payment_status?: string; client_reference_id?: string | null; metadata?: Record<string, string> };
  if (o.mode !== 'payment' || o.metadata?.addon !== 'pack_fiscal' || o.payment_status !== 'paid') return null;
  const userId = o.client_reference_id ?? o.metadata?.user_id ?? null;
  return userId ? { userId } : null;
}

export const HANDLED_EVENTS = [
  'checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'customer.subscription.paused', 'customer.subscription.resumed',
  'invoice.paid', 'invoice.payment_failed', 'invoice.payment_succeeded',
  'charge.refunded',
];

/** Appel REST Stripe (paramètres encodés en formulaire, notation a[b][c]). */
export async function stripeRequest<T>(secret: string, method: 'GET' | 'POST', path: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
  const body = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const url = `https://api.stripe.com/v1/${path}${method === 'GET' && body.size ? `?${body}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20' },
    body: method === 'POST' ? body : undefined,
  });
  const json = await res.json() as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Stripe ${res.status} : ${json.error?.message ?? 'erreur'}`);
  return json;
}
