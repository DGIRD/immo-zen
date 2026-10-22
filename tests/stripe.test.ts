import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fiscalPackFromSession, invoiceEmail, invoiceInfo, paymentFailedEmail, signStripePayload, subscriptionFields, subscriptionIdOf, verifyStripeSignature } from '../supabase/functions/_shared/stripe.ts';

const SECRET = 'whsec_test';
const body = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated', created: 1760000000, data: { object: { id: 'sub_1' } } });

test('webhook : signature valide, altérée, expirée ou absente', async () => {
  const now = 1760000100;
  const h = await signStripePayload(body, SECRET, now - 10);
  assert.equal(await verifyStripeSignature(body, h, SECRET, now), true);
  assert.equal(await verifyStripeSignature(body + ' ', h, SECRET, now), false, 'contenu modifié');
  assert.equal(await verifyStripeSignature(body, h, 'whsec_autre', now), false, 'mauvais secret');
  assert.equal(await verifyStripeSignature(body, h, SECRET, now + 3600), false, 'rejeu au-delà de 5 minutes');
  assert.equal(await verifyStripeSignature(body, null, SECRET, now), false);
  assert.equal(await verifyStripeSignature(body, `${h.split(',')[0]},v1=deadbeef,${h.split(',')[1]}`, SECRET, now), true, 'plusieurs signatures (rotation du secret)');
});

test('abonnement Stripe → ligne d’abonnement (offre, fin de période, résiliation programmée)', () => {
  const f = subscriptionFields({
    id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: true, canceled_at: null,
    items: { data: [{ price: { id: 'price_m' }, current_period_end: 1767225600 }] },
  }, { price_m: 'mensuel' }, 1760000000);
  assert.equal(f.status, 'active');
  assert.equal(f.plan_code, 'mensuel');
  assert.equal(f.current_period_end, '2026-01-01T00:00:00.000Z');
  assert.equal(f.cancel_at_period_end, true);
  assert.equal(f.stripe_updated_at, 1760000000);
  assert.equal(subscriptionFields({ id: 's', customer: 'c', status: 'bizarre', cancel_at_period_end: false, canceled_at: null }, {}, 1).status, 'incomplete');
});

test('événements : abonnement concerné', () => {
  const ev = (type: string, object: Record<string, unknown>) => ({ id: 'e', type, created: 1, data: { object } });
  assert.equal(subscriptionIdOf(ev('customer.subscription.deleted', { id: 'sub_9' })), 'sub_9');
  assert.equal(subscriptionIdOf(ev('checkout.session.completed', { subscription: 'sub_2' })), 'sub_2');
  assert.equal(subscriptionIdOf(ev('invoice.payment_failed', { subscription: 'sub_3' })), 'sub_3');
  assert.equal(subscriptionIdOf(ev('invoice.paid', { parent: { subscription_details: { subscription: 'sub_4' } } })), 'sub_4', 'format récent des factures');
  assert.equal(subscriptionIdOf(ev('charge.refunded', { id: 'ch_1' })), null);
});

test('formules : l’offre vient de la ligne de formule, pas d’une ligne annexe', () => {
  const f = subscriptionFields({
    id: 'sub_2', customer: 'cus_2', status: 'active', cancel_at_period_end: false, canceled_at: null,
    items: { data: [{ price: { id: 'price_autre' } }, { price: { id: 'price_pat_a' }, current_period_end: 1767225600 }] },
  }, { price_pat_a: 'patrimoine_annuel' }, 1);
  assert.equal(f.plan_code, 'patrimoine_annuel');
  assert.equal(f.current_period_end, '2026-01-01T00:00:00.000Z');
  assert.equal(subscriptionIdOf({ id: 'e', type: 'checkout.session.async_payment_succeeded', created: 1, data: { object: { subscription: 'sub_5' } } }), 'sub_5', 'abonnement réglé par prélèvement SEPA');
});

test('pack fiscal : crédité seulement une fois le paiement encaissé', () => {
  const ev = (type: string, object: Record<string, unknown>) => ({ id: 'e', type, created: 1, data: { object } });
  const paid = { mode: 'payment', payment_status: 'paid', client_reference_id: 'u1', metadata: { addon: 'pack_fiscal', user_id: 'u1' } };
  assert.deepEqual(fiscalPackFromSession(ev('checkout.session.completed', paid)), { userId: 'u1' });
  assert.equal(fiscalPackFromSession(ev('checkout.session.completed', { ...paid, payment_status: 'unpaid' })), null, 'prélèvement SEPA pas encore confirmé');
  assert.deepEqual(fiscalPackFromSession(ev('checkout.session.async_payment_succeeded', paid)), { userId: 'u1' }, 'prélèvement SEPA confirmé');
  assert.equal(fiscalPackFromSession(ev('checkout.session.completed', { ...paid, mode: 'subscription' })), null, 'abonnement, pas un pack');
  assert.equal(fiscalPackFromSession(ev('checkout.session.completed', { ...paid, metadata: {} })), null, 'autre paiement ponctuel');
  assert.deepEqual(fiscalPackFromSession(ev('checkout.session.completed', { ...paid, client_reference_id: null })), { userId: 'u1' }, 'compte retrouvé par les métadonnées');
  assert.equal(fiscalPackFromSession(ev('invoice.paid', paid)), null);
});

test('facture Stripe : formes d’API récente et ancienne, e-mail de confirmation', () => {
  const recent = invoiceInfo({ id: 'in_1', number: 'A1-0001', customer: 'cus_1', amount_paid: 9900, currency: 'eur', created: 1792610447, billing_reason: 'subscription_create',
    hosted_invoice_url: 'https://invoice.stripe.com/i/x', parent: { subscription_details: { subscription: 'sub_1', metadata: { user_id: 'u1' } } },
    lines: { data: [{ description: '1 × Immo-Zen Essentiel', period: { start: 1792610447, end: 1824146447 }, pricing: { price_details: { price: 'price_A' } } }] } });
  assert.equal(recent.subscriptionId, 'sub_1');
  assert.equal(recent.userIdHint, 'u1');
  assert.deepEqual(recent.priceIds, ['price_A']);
  const legacy = invoiceInfo({ id: 'in_2', subscription: 'sub_2', subscription_details: { metadata: { user_id: 'u2' } }, amount_paid: 4900, lines: { data: [{ price: { id: 'price_P' } }] } });
  assert.equal(legacy.subscriptionId, 'sub_2');
  assert.equal(legacy.userIdHint, 'u2');
  assert.deepEqual(legacy.priceIds, ['price_P']);
  const m = invoiceEmail(recent, { label: 'Essentiel (annuel)', kind: 'formule' });
  assert.equal(m.subject, 'Bienvenue : votre abonnement Immo-Zen Essentiel (annuel) est actif');
  assert.match(m.body, /Montant réglé : 99,00 € TTC/);
  assert.match(m.body, /Facture n° A1-0001/);
  assert.match(m.body, /Période : du 21\/10\/2026 au 21\/10\/2027/);
  assert.match(m.body, /facture est jointe/);
  assert.match(m.body, /\{\{APP_URL\}\}#\/abonnement/);
  assert.equal(invoiceEmail({ ...recent, billingReason: 'subscription_cycle' }, { label: 'Pro', kind: 'formule' }).subject, 'Renouvellement de votre abonnement Immo-Zen Pro');
  const pack = invoiceEmail({ ...legacy, billingReason: 'manual' }, { label: 'Pack fiscal (12 mois)', kind: 'option' });
  assert.equal(pack.subject, 'Votre pack fiscal Immo-Zen est activé');
  assert.doesNotMatch(pack.body, /Période/);
});

test('facture de changement de formule : nouvelle formule en tête, motif « subscription_update »', () => {
  const inv = invoiceInfo({
    id: 'in_3', customer: 'cus_1', amount_paid: 29958, amount_due: 29958, billing_reason: 'manual',
    lines: { data: [
      { amount: -19872, pricing: { price_details: { price: 'price_E' } }, parent: { invoice_item_details: { proration: true } } },
      { amount: 39844, pricing: { price_details: { price: 'price_P' } }, parent: { invoice_item_details: { proration: true } } },
    ] },
  });
  assert.equal(inv.billingReason, 'subscription_update');
  assert.equal(inv.priceIds[0], 'price_P', 'la ligne au montant le plus élevé (nouvelle formule) vient en premier');
  assert.equal(invoiceInfo({ id: 'in_4', billing_reason: 'manual', lines: { data: [{ amount: 4900 }] } }).billingReason, 'manual', 'pack fiscal : motif conservé');
});

test('paiement échoué : e-mail avec montant dû et date de la prochaine tentative', () => {
  const inv = invoiceInfo({ id: 'in_5', amount_paid: 0, amount_due: 9900, billing_reason: 'subscription_cycle' });
  const m = paymentFailedEmail(inv, 'Essentiel (annuel)', 1792610447);
  assert.match(m.subject, /paiement n’a pas abouti/);
  assert.match(m.body, /99,00\s€ TTC/);
  assert.match(m.body, /Essentiel \(annuel\)/);
  assert.match(m.body, /nouvelle tentative aura lieu automatiquement le \d{2}\/\d{2}\/\d{4}/);
  assert.match(paymentFailedEmail(inv, null, null).body, /suspendu/);
});
