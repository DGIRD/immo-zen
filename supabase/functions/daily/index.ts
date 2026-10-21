// Edge Function « daily » (Deno) – tâches serveur d'Immo-Zen, sans dépendre de l'ouverture de l'application.
//
// Appelée par la planification (pg_cron + pg_net, voir docs/TACHES-SERVEUR.md), par exemple :
//   - chaque jour à 6 h (Paris) avec {"tasks": ["daily","outbox","storage"]}
//   - toutes les 15 minutes avec {"tasks": ["outbox"]} pour vider la file d'e-mails
//
// Secrets (supabase secrets set …) :
//   CRON_SECRET     (facultatif) jeton accepté en plus de celui du coffre « immozen_cron_secret », qui fait foi
//   EMAIL_ENABLED   « true » pour envoyer réellement ; toute autre valeur = aucun envoi
//   RESEND_API_KEY  clé du fournisseur d'e-mail (Resend)
//   EMAIL_FROM      expéditeur vérifié, ex. « Immo-Zen <loyers@votre-domaine.fr> »
//   EMAIL_REPLY_TO  (facultatif) adresse de réponse
//   APP_URL         adresse de l'application (lien des invitations à l'espace locataire)
// Fournies automatiquement par Supabase : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as pdfLib from 'npm:pdf-lib@1.17.1';
import { processOutbox, resendSender, type OutboxRow } from '../_shared/outbox.ts';
import { stripeRequest } from '../_shared/stripe.ts';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

const env = (k: string) => Deno.env.get(k) ?? '';
const log = (msg: string, data: Record<string, unknown> = {}) => console.log(JSON.stringify({ msg, ...data }));

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Méthode non autorisée', { status: 405 });
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  // Jeton de la planification : celui du coffre de la base (« immozen_cron_secret ») fait foi ;
  // CRON_SECRET reste accepté s'il est défini (appels manuels, anciennes configurations).
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const secret = env('CRON_SECRET');
  let allowed = !!token && !!secret && token === secret;
  if (!allowed && token) {
    const { data, error } = await sb.rpc('iz_cron_token_ok', { p_token: token });
    if (error) log('vérification du jeton impossible', { error: error.message });
    allowed = data === true;
  }
  if (!allowed) return new Response('Non autorisé', { status: 401 });
  const body = await req.json().catch(() => ({})) as { tasks?: string[]; today?: string };
  const tasks = body.tasks?.length ? body.tasks : ['daily', 'outbox', 'storage'];
  const out: Record<string, unknown> = {};

  try {
    if (tasks.includes('daily')) {
      const { data, error } = await sb.rpc('iz_daily_tasks', body.today ? { p_today: body.today } : {});
      if (error) throw new Error(`Tâches quotidiennes : ${error.message}`);
      out.daily = data;
    }

    if (tasks.includes('outbox')) {
      // réglages manquants (noms seulement, jamais les valeurs) : affichés dans la réponse pour le diagnostic
      const missing = [
        ...(env('EMAIL_ENABLED').trim().toLowerCase() === 'true' ? [] : [`EMAIL_ENABLED (≠ « true »${env('EMAIL_ENABLED') ? '' : ', absente'})`]),
        ...(env('RESEND_API_KEY').trim() ? [] : ['RESEND_API_KEY']),
        ...(env('EMAIL_FROM').trim() ? [] : ['EMAIL_FROM']),
        ...(/^https:\/\//.test(env('APP_URL').trim()) ? [] : ['APP_URL']),
      ];
      const enabled = env('EMAIL_ENABLED').trim().toLowerCase() === 'true' && !!env('RESEND_API_KEY').trim() && !!env('EMAIL_FROM').trim();
      if (missing.length) out.emailSettingsMissing = missing;
      out.outbox = await processOutbox({
        enabled,
        pdfLib,
        appUrl: env('APP_URL').trim(),
        log,
        claim: async (limit) => {
          const { data, error } = await sb.rpc('iz_claim_outbox', { p_limit: limit });
          if (error) throw new Error(`File d’e-mails : ${error.message}`);
          return (data ?? []) as OutboxRow[];
        },
        result: async (id, ok, err) => {
          const { error } = await sb.rpc('iz_outbox_result', { p_id: id, p_ok: ok, p_error: err ?? null });
          if (error) throw new Error(`Résultat d’envoi : ${error.message}`);
        },
        receipt: async (id) => {
          const { data } = await sb.from('receipts').select('*, leases(charges_mode)').eq('id', id).maybeSingle();
          return data ? { ...data, charges_mode: (data as { leases?: { charges_mode?: string } }).leases?.charges_mode } : null;
        },
        reminderStillDue: async (id) => {
          const { data: r } = await sb.from('reminders').select('charge_ids').eq('id', id).maybeSingle();
          if (!r) return 0;
          const { data } = await sb.rpc('iz_charges_remaining', { p_charges: (r as { charge_ids: string[] }).charge_ids });
          return Number(data ?? 0);
        },
        cancelReminder: async (id, reason) => {
          await sb.from('reminders').update({ status: 'annule', error: reason }).eq('id', id);
          await sb.from('email_outbox').update({ status: 'annule' }).eq('reminder_id', id).in('status', ['a_envoyer', 'en_cours']);
        },
        invoicePdf: async (id) => {
          const key = env('STRIPE_SECRET_KEY').trim();
          if (!key) return null;
          const inv = await stripeRequest<{ number?: string | null; invoice_pdf?: string | null }>(key, 'GET', `invoices/${id}`);
          if (!inv.invoice_pdf) return null;
          const res = await fetch(inv.invoice_pdf);
          if (!res.ok) throw new Error(`PDF de la facture : HTTP ${res.status}`);
          return { filename: `facture-immo-zen-${inv.number ?? id}.pdf`, content: new Uint8Array(await res.arrayBuffer()) };
        },
        send: resendSender(env('RESEND_API_KEY').trim(), env('EMAIL_FROM').trim(), env('EMAIL_REPLY_TO').trim() || undefined),
      });
    }

    if (tasks.includes('storage')) {
      const { data: rows } = await sb.from('storage_deletions').select('storage_path, attempts').lt('attempts', 5).limit(100);
      let removed = 0;
      for (const r of (rows ?? []) as { storage_path: string; attempts: number }[]) {
        const { error } = await sb.storage.from('documents').remove([r.storage_path]);
        if (error) await sb.from('storage_deletions').update({ attempts: r.attempts + 1, last_error: error.message }).eq('storage_path', r.storage_path);
        else { await sb.from('storage_deletions').delete().eq('storage_path', r.storage_path); removed++; }
      }
      out.storage = { removed };
    }

    log('Exécution terminée', out);
    return Response.json({ ok: true, ...out });
  } catch (e) {
    // erreurs Supabase (objets) : message lisible plutôt que « [object Object] »
    const message = e instanceof Error ? e.message : typeof e === 'object' && e ? String((e as { message?: string }).message ?? JSON.stringify(e)) : String(e);
    log('Exécution en erreur', { error: message });
    await sb.from('job_runs').insert({ job: 'edge-daily', run_key: new Date().toISOString(), status: 'erreur', details: { error: message, tasks }, finished_at: new Date().toISOString() });
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
});
