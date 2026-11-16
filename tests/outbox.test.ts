import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pdfLib from 'pdf-lib';
import { logoUrl, processOutbox, renderEmailHtml, resendSender, type MailMessage, type OutboxDeps, type OutboxRow } from '../supabase/functions/_shared/outbox.ts';

const receipt = {
  kind: 'quittance' as const, number: 'Q-2026-0001', issued_on: '2026-02-05', period_start: '2026-01-01', period_end: '2026-01-31', rent_amount: 500, charges_amount: 40,
  paid_amount: 540, payments: [], tenant_names: 'Léa Martin', landlord_name: 'Alice', landlord_address: null, property_address: null, cancelled_at: null as string | null,
};

function deps(rows: OutboxRow[], over: Partial<OutboxDeps> = {}) {
  const sent: MailMessage[] = [];
  const results: { id: string; ok: boolean; error?: string }[] = [];
  const cancelled: string[] = [];
  const logs: string[] = [];
  const d: OutboxDeps = {
    enabled: true, pdfLib, log: (m, data) => logs.push(m + JSON.stringify(data ?? {})),
    claim: async () => rows, result: async (id, ok, error) => { results.push({ id, ok, error }); },
    receipt: async () => receipt, reminderStillDue: async () => 100, cancelReminder: async (id) => { cancelled.push(id); },
    send: async (m) => { sent.push(m); }, ...over,
  };
  return { d, sent, results, cancelled, logs };
}
const row = (o: Partial<OutboxRow>): OutboxRow => ({ id: 'o1', kind: 'confirmation_paiement', to_emails: ['a@b.fr'], subject: 's', body_text: 'b', receipt_id: null, reminder_id: null, ...o });

test('file d’e-mails : aucun envoi tant que l’envoi n’est pas activé', async () => {
  const { d, sent } = deps([row({})], { enabled: false });
  const r = await processOutbox(d);
  assert.equal(r.dryRun, true);
  assert.equal(r.claimed, 0, 'rien n’est même réservé');
  assert.equal(sent.length, 0);
});

test('file d’e-mails : quittance envoyée avec son PDF en pièce jointe', async () => {
  const { d, sent, results } = deps([row({ kind: 'quittance', receipt_id: 'r1' })]);
  const r = await processOutbox(d);
  assert.equal(r.sent, 1);
  assert.equal(sent[0]!.attachments[0]!.filename, 'quittance-Q-2026-0001.pdf');
  assert.equal(Buffer.from(sent[0]!.attachments[0]!.content.subarray(0, 5)).toString(), '%PDF-');
  assert.deepEqual(results, [{ id: 'o1', ok: true, error: undefined }]);
});

test('file d’e-mails : quittance annulée entre-temps → non envoyée, échec journalisé', async () => {
  const { d, sent, results } = deps([row({ kind: 'quittance', receipt_id: 'r1' })], { receipt: async () => ({ ...receipt, cancelled_at: '2026-02-06' }) });
  await processOutbox(d);
  assert.equal(sent.length, 0);
  assert.equal(results[0]!.ok, false);
  assert.match(results[0]!.error!, /annulée/);
});

test('file d’e-mails : relance abandonnée si la dette est réglée au moment de l’envoi', async () => {
  const { d, sent, cancelled } = deps([row({ kind: 'relance', reminder_id: 'm1' })], { reminderStillDue: async () => 0 });
  const r = await processOutbox(d);
  assert.equal(r.skipped, 1);
  assert.equal(sent.length, 0);
  assert.deepEqual(cancelled, ['m1']);
});

test('file d’e-mails : échec du fournisseur → nouvel essai programmé, journaux sans adresse e-mail', async () => {
  const { d, results, logs } = deps([row({ to_emails: ['secret@exemple.fr'] })], { send: async () => { throw new Error('HTTP 500'); } });
  const r = await processOutbox(d);
  assert.equal(r.failed, 1);
  assert.equal(results[0]!.ok, false);
  assert.ok(logs.every((l) => !l.includes('secret@exemple.fr')), 'aucune donnée personnelle dans les journaux');
});

test('file d’e-mails : adresse invalide refusée', async () => {
  const { d, sent, results } = deps([row({ to_emails: ['pas-une-adresse'] })]);
  await processOutbox(d);
  assert.equal(sent.length, 0);
  assert.match(results[0]!.error!, /adresse/);
});

test('Resend : requête conforme, pièce jointe en base64', async () => {
  let body: Record<string, unknown> = {};
  let auth = '';
  const fake = (async (_u: string, init: RequestInit) => {
    body = JSON.parse(String(init.body));
    auth = (init.headers as Record<string, string>).Authorization!;
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  await resendSender('k', 'Immo-Zen <a@b.fr>', undefined, fake)({ to: ['x@y.fr'], subject: 's', text: 't', attachments: [{ filename: 'q.pdf', content: new Uint8Array([37, 80, 68, 70]), contentType: 'application/pdf' }] });
  assert.equal(auth, 'Bearer k');
  assert.deepEqual((body.attachments as { content: string }[])[0]!.content, 'JVBERg==');
  const failing = (async () => new Response('quota', { status: 429 })) as unknown as typeof fetch;
  await assert.rejects(resendSender('k', 'a@b.fr', undefined, failing)({ to: ['x@y.fr'], subject: 's', text: 't', attachments: [] }), /429/);
});

test('file d’e-mails : invitation à l’espace locataire avec le lien de l’application', async () => {
  const body = 'Ouvrez ce lien : {{APP_URL}}#/espace-locataire?code=ABC123DEF456';
  const ok = deps([row({ kind: 'invitation_locataire', body_text: body })], { appUrl: 'https://immo-zen.fr/app' });
  assert.equal((await processOutbox(ok.d)).sent, 1);
  assert.match(ok.sent[0]!.text, /^Ouvrez ce lien : https:\/\/immo-zen\.fr\/app\/#\/espace-locataire\?code=ABC123DEF456\n\n--\n/);
  assert.match(ok.sent[0]!.text, /L’équipe Immo-Zen se tient à votre disposition .* contact@immo-zen\.fr$/);
  assert.equal(ok.sent[0]!.attachments.length, 0);
  // adresse de l'application absente : échec explicite, rien n'est envoyé
  const ko = deps([row({ kind: 'invitation_locataire', body_text: body })]);
  const r = await processOutbox(ko.d);
  assert.equal(r.sent, 0);
  assert.match(ko.results[0]!.error ?? '', /APP_URL/);
});

test('file d’e-mails : demande du site envoyée à contact@ avec l’adresse du visiteur en réponse', async () => {
  const { d, sent } = deps([row({ kind: 'contact_site', to_emails: ['contact@immo-zen.fr'], body_text: 'Nom : Marie', reply_to: 'marie@example.test' })]);
  assert.equal((await processOutbox(d)).sent, 1);
  assert.equal(sent[0]!.replyTo, 'marie@example.test');
  assert.equal(sent[0]!.text, 'Nom : Marie', 'pas de pied de message pour un e-mail interne');
  let body: Record<string, unknown> = {};
  const send = resendSender('re_test', 'Immo-Zen <contact@mail.immo-zen.fr>', 'contact@immo-zen.fr', (async (_u: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return new Response('{}'); }) as typeof fetch);
  await send(sent[0]!);
  assert.equal(body.reply_to, 'marie@example.test');
  await send({ ...sent[0]!, replyTo: undefined });
  assert.equal(body.reply_to, 'contact@immo-zen.fr', 'adresse de réponse par défaut');
});

test('file d’e-mails : confirmation d’abonnement avec la facture PDF jointe, envoi maintenu sans PDF', async () => {
  const pdf = new Uint8Array([37, 80, 68, 70, 45]);
  const r1 = deps([row({ kind: 'facture_abonnement', stripe_invoice_id: 'in_1', body_text: 'Factures : {{APP_URL}}#/abonnement' })], {
    appUrl: 'https://immo-zen.fr/app/', invoicePdf: async () => ({ filename: 'facture-immo-zen-A1-0001.pdf', content: pdf }),
  });
  await processOutbox(r1.d);
  assert.equal(r1.sent[0]!.attachments[0]!.filename, 'facture-immo-zen-A1-0001.pdf');
  assert.match(r1.sent[0]!.text, /https:\/\/immo-zen\.fr\/app\/#\/abonnement/);
  const r2 = deps([row({ kind: 'facture_abonnement', stripe_invoice_id: 'in_2', body_text: 'b' })], { invoicePdf: async () => { throw new Error('Stripe 500'); } });
  const rep = await processOutbox(r2.d);
  assert.equal(rep.sent, 1, 'envoyé quand même, avec le lien');
  assert.equal(r2.sent[0]!.attachments.length, 0);
  assert.ok(r2.logs.some((l) => l.startsWith('Facture PDF indisponible')));
});

test('e-mails : version HTML avec le logo Immo-Zen, liens cliquables, texte échappé', async () => {
  assert.equal(logoUrl('https://immo-zen.fr/app/'), 'https://immo-zen.fr/icon-192.png');
  assert.equal(logoUrl(undefined), 'https://immo-zen.fr/icon-192.png');
  const html = renderEmailHtml('Objet', 'Bonjour <Léa>,\n\nVoir https://immo-zen.fr/app/#/abonnement.\n\n--\nContact : contact@immo-zen.fr', 'https://immo-zen.fr/icon-192.png');
  assert.match(html, /<img src="https:\/\/immo-zen\.fr\/icon-192\.png"[^>]*alt="Immo-Zen"/);
  assert.match(html, /Bonjour &lt;Léa&gt;,/);
  assert.match(html, /<a href="https:\/\/immo-zen\.fr\/app\/#\/abonnement"/);
  assert.match(html, /href="mailto:contact@immo-zen\.fr"/);
  const { d, sent } = deps([row({ body_text: 'Bonjour' })], { appUrl: 'https://immo-zen.fr/app/' });
  await processOutbox(d);
  assert.match(sent[0]!.html ?? '', /icon-192\.png/);
  let posted: Record<string, unknown> = {};
  const fakeFetch = (async (_u: string, init: { body: string }) => { posted = JSON.parse(init.body); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
  await resendSender('k', 'Immo-Zen <a@b.fr>', undefined, fakeFetch)(sent[0]!);
  assert.ok(String(posted.html).includes('Immo-Zen') && posted.text === sent[0]!.text, 'HTML et texte transmis à Resend');
});

test('file d’e-mails : séquence de bienvenue en HTML illustré, version texte conservée', async () => {
  const unsub = 'https://immo-zen.fr/inscription.html?desinscrire=11111111-1111-1111-1111-111111111111';
  const rows = [
    row({ id: 'w1', kind: 'inscription_site', subject: 'Votre guide est prêt', body_text: 'Bonjour, guide', template: 'bienvenue',
      template_data: { step: 1, source: 'guide', doc_url: 'https://immo-zen.fr/ressources/guide-10-verifications-avant-achat.pdf', alerts: ['Un rappel en <mars>'], unsub } }),
    row({ id: 'w2', kind: 'bienvenue', subject: 'Agence', body_text: 'Bonjour, agence', template: 'bienvenue', template_data: { step: 2, unsub } }),
    row({ id: 'w3', kind: 'bienvenue', subject: 'Essai', body_text: 'Bonjour, essai', template: 'bienvenue', template_data: { step: 3, unsub } }),
    row({ id: 'w4', kind: 'bienvenue', subject: 'Cassé', body_text: 'Bonjour, texte seul', template: 'bienvenue', template_data: { step: 2 } }),
  ];
  const { d, sent, logs } = deps(rows);
  const r = await processOutbox(d);
  assert.equal(r.sent, 4);
  const [m1, m2, m3, m4] = sent.map((m) => m.html ?? '');
  assert.match(m1!, /Télécharger le guide \(PDF\)/);
  assert.match(m1!, /href="https:\/\/immo-zen\.fr\/ressources\/guide-10-verifications-avant-achat\.pdf"/);
  assert.match(m1!, /Un rappel en &lt;mars&gt;/, 'alertes échappées');
  assert.match(m1!, /img\/email\/simulation\.jpg/);
  assert.match(m2!, /1&nbsp;070&nbsp;€/);
  assert.match(m2!, /#economies/);
  assert.match(m3!, /Démarrer mon essai gratuit/);
  assert.match(m3!, /img\/email\/quittance\.jpg/);
  for (const h of [m1!, m2!, m3!]) {
    assert.ok(h.includes(unsub), 'désinscription');
    assert.match(h, /linkedin\.com\/company\/immo-zen-investissement/);
  }
  assert.equal(sent[0]!.text.startsWith('Bonjour, guide'), true, 'texte inchangé');
  assert.match(m4!, /Bonjour, texte seul/, 'données incomplètes : version simple');
  assert.ok(logs.some((l) => l.startsWith('Gabarit de bienvenue inutilisable')));
});
