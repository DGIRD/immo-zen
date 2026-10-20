import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pdfLib from 'pdf-lib';
import { processOutbox, resendSender, type MailMessage, type OutboxDeps, type OutboxRow } from '../supabase/functions/_shared/outbox.ts';

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
  assert.equal(ok.sent[0]!.text, 'Ouvrez ce lien : https://immo-zen.fr/app/#/espace-locataire?code=ABC123DEF456');
  assert.equal(ok.sent[0]!.attachments.length, 0);
  // adresse de l'application absente : échec explicite, rien n'est envoyé
  const ko = deps([row({ kind: 'invitation_locataire', body_text: body })]);
  const r = await processOutbox(ko.d);
  assert.equal(r.sent, 0);
  assert.match(ko.results[0]!.error ?? '', /APP_URL/);
});
