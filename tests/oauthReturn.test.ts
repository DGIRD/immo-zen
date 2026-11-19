import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripOAuthParams } from '../src/domain/oauthReturn.ts';

test('retour de Google : code retiré, route du routeur conservée', () => {
  const r = stripOAuthParams('https://immo-zen.fr/app/?code=4b1d2c3e-aaaa-bbbb-cccc-123456789012#/biens');
  assert.equal(r.changed, true);
  assert.equal(r.error, null);
  assert.equal(r.url, 'https://immo-zen.fr/app/#/biens');
});

test('retour de Google : annulation traduite, invitation locataire du routeur intacte', () => {
  const r = stripOAuthParams('https://immo-zen.fr/app/?error=access_denied&error_description=The+user+denied#/locataire?code=ABC123');
  assert.equal(r.changed, true);
  assert.equal(r.error, 'Connexion avec Google annulée.');
  assert.equal(r.url, 'https://immo-zen.fr/app/#/locataire?code=ABC123');
});

test('adresse sans retour de Google : inchangée', () => {
  const r = stripOAuthParams('https://immo-zen.fr/app/?utm=x#/');
  assert.equal(r.changed, false);
  assert.equal(r.url, 'https://immo-zen.fr/app/?utm=x#/');
});

test('fournisseur non activé : message clair', () => {
  const r = stripOAuthParams('https://immo-zen.fr/app/?error=validation_failed&error_description=Unsupported+provider%3A+provider+is+not+enabled');
  assert.equal(r.error, 'La connexion avec Google n’est pas encore activée.');
});

import { shouldProposeNewsletter } from '../src/ui/NewsletterPrompt.tsx';

test('proposition newsletter : compte Google récent, sans réponse, case non vue à l’inscription', () => {
  const now = Date.parse('2026-11-19T15:00:00Z');
  const base = { mode: 'supabase', providers: ['google'], createdAt: '2026-11-19T14:59:00Z', answer: undefined, askedOnSignup: false, now };
  assert.equal(shouldProposeNewsletter(base), true);
  assert.equal(shouldProposeNewsletter({ ...base, answer: 'non' }), false);
  assert.equal(shouldProposeNewsletter({ ...base, askedOnSignup: true }), false);
  assert.equal(shouldProposeNewsletter({ ...base, providers: ['email'] }), false);
  assert.equal(shouldProposeNewsletter({ ...base, createdAt: '2026-09-01T00:00:00Z' }), false);
  assert.equal(shouldProposeNewsletter({ ...base, mode: 'demo' }), false);
});
