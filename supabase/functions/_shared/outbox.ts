/**
 * Traitement de la file d'e-mails (module partagé, sans dépendance à Deno : testé sous Node).
 *
 * Garde-fous :
 *  - aucun envoi tant que EMAIL_ENABLED ne vaut pas exactement « true » (mode « à blanc » :
 *    les messages restent en file, rien ne part) ;
 *  - un message n'est jamais envoyé deux fois : la file a une clé anti-doublon et chaque
 *    message est réservé (statut « en_cours ») avant l'envoi ;
 *  - une quittance n'est jointe que si elle existe et n'est pas annulée ;
 *  - une relance est re-vérifiée juste avant l'envoi : si la dette est réglée, elle est annulée.
 */
import { buildReceiptPdf, type ReceiptData } from './receiptPdf.ts';

export interface OutboxRow {
  id: string;
  kind: 'confirmation_paiement' | 'quittance' | 'relance' | 'relance_a_valider' | 'invitation_locataire' | 'contact_site' | 'facture_abonnement';
  to_emails: string[];
  subject: string;
  body_text: string;
  receipt_id: string | null;
  reminder_id: string | null;
  /** Adresse de réponse propre au message (demande du site : adresse du visiteur). */
  reply_to?: string | null;
  /** Facture Stripe à joindre (confirmation d'abonnement ou de pack). */
  stripe_invoice_id?: string | null;
}

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
  /** Version HTML (logo Immo-Zen en en-tête), envoyée avec la version texte. */
  html?: string;
  replyTo?: string;
  attachments: { filename: string; content: Uint8Array; contentType: string }[];
}

/** Accès aux données et services nécessaires (injectés : base Supabase en production, simulacres en test). */
export interface OutboxDeps {
  claim(limit: number): Promise<OutboxRow[]>;
  result(id: string, ok: boolean, error?: string): Promise<void>;
  receipt(id: string): Promise<(ReceiptData & { cancelled_at: string | null; charges_mode?: string }) | null>;
  /** Reste dû des échéances visées par une relance (0 si réglée). */
  reminderStillDue(id: string): Promise<number>;
  cancelReminder(id: string, reason: string): Promise<void>;
  send(m: MailMessage): Promise<void>;
  /** PDF d'une facture Stripe (null si indisponible : l'e-mail part alors avec le lien seulement). */
  invoicePdf?(id: string): Promise<{ filename: string; content: Uint8Array } | null>;
  pdfLib: Parameters<typeof buildReceiptPdf>[0];
  enabled: boolean;
  /** Adresse publique de l'application (lien des invitations à l'espace locataire, « {{APP_URL}} » dans le texte). */
  appUrl?: string;
  log(msg: string, data?: Record<string, unknown>): void;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const CONTACT_EMAIL = 'contact@immo-zen.fr';
/** Pied de tous les e-mails envoyés par Immo-Zen. */
export const MAIL_FOOTER = `--\nMessage envoyé avec Immo-Zen. L’équipe Immo-Zen se tient à votre disposition pour toute question sur le service : ${CONTACT_EMAIL}`;

/** Logo publié avec le site (icône Immo-Zen), déduit de l'adresse de l'application. */
export function logoUrl(appUrl?: string): string {
  try { if (appUrl && /^https:\/\//.test(appUrl.trim())) return new URL('../icon-192.png', appUrl.trim().replace(/\/?$/, '/')).toString(); } catch { /* adresse invalide */ }
  return 'https://immo-zen.fr/icon-192.png';
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Texte → HTML : paragraphes, retours à la ligne et liens cliquables. */
function textToHtml(text: string): string {
  return text.trim().split(/\n{2,}/).map((para) => {
    const html = escapeHtml(para)
      .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)»])/g, (u) => `<a href="${u}" style="color:#1f4a45;word-break:break-all;">${u}</a>`)
      .replace(/([\w.+-]+@[\w-]+\.[\w.-]+)/g, (m, e, off, all) => (/href="[^"]*$/.test(all.slice(0, off)) ? m : `<a href="mailto:${e}" style="color:#1f4a45;">${e}</a>`))
      .replace(/\n/g, '<br>');
    return `<p style="margin:0 0 14px;">${html}</p>`;
  }).join('');
}

/** Gabarit HTML commun des e-mails Immo-Zen (même présentation que les e-mails de connexion). */
export function renderEmailHtml(subject: string, text: string, logo: string): string {
  const [main, footer] = text.split(/\n--\n/);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f3f6f4;font-family:Arial,Helvetica,sans-serif;color:#18322f;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #d8e0dc;border-radius:6px;">
<tr><td style="padding:22px 28px 6px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:10px;vertical-align:middle;"><img src="${escapeHtml(logo)}" width="36" height="36" alt="Immo-Zen" style="display:block;border:0;border-radius:6px;"></td>
<td style="vertical-align:middle;font-family:Georgia,serif;font-size:22px;font-weight:bold;color:#1f4a45;">Immo-Zen</td>
</tr></table></td></tr>
<tr><td style="padding:12px 28px 14px;font-size:15px;line-height:1.55;">${textToHtml(main ?? '')}</td></tr>
${footer ? `<tr><td style="padding:14px 28px;border-top:1px solid #d8e0dc;font-size:13px;line-height:1.5;color:#4a5a57;">${textToHtml(footer).replace(/margin:0 0 14px/g, 'margin:0')}</td></tr>` : ''}
</table></td></tr></table></body></html>`;
}

export async function buildMessage(row: OutboxRow, deps: Pick<OutboxDeps, 'receipt' | 'pdfLib' | 'appUrl' | 'invoicePdf' | 'log'>): Promise<MailMessage> {
  const to = row.to_emails.filter((e) => EMAIL.test(e));
  if (!to.length) throw new Error('Aucune adresse e-mail valide.');
  let text = row.body_text;
  if (text.includes('{{APP_URL}}')) {
    const url = deps.appUrl?.trim();
    if (!url || !/^https:\/\//.test(url)) throw new Error('Adresse de l’application (APP_URL) non configurée : lien d’invitation impossible.');
    text = text.split('{{APP_URL}}').join(url.endsWith('/') ? url : url + '/');
  }
  if (row.kind !== 'contact_site' && !text.includes(CONTACT_EMAIL)) text = `${text.trimEnd()}\n\n${MAIL_FOOTER}`;
  const m: MailMessage = { to, subject: row.subject, text, html: renderEmailHtml(row.subject, text, logoUrl(deps.appUrl)), attachments: [], ...(row.reply_to && EMAIL.test(row.reply_to) ? { replyTo: row.reply_to } : {}) };
  if (row.kind === 'quittance') {
    if (!row.receipt_id) throw new Error('Quittance absente.');
    const r = await deps.receipt(row.receipt_id);
    if (!r) throw new Error('Quittance introuvable.');
    if (r.cancelled_at) throw new Error('Quittance annulée : envoi abandonné.');
    const pdf = await buildReceiptPdf(deps.pdfLib, { ...r, charges_label: r.charges_mode === 'forfait' ? 'Forfait de charges' : 'Provision pour charges' });
    m.attachments.push({ filename: `${r.kind === 'quittance' ? 'quittance' : 'recu'}-${r.number}.pdf`, content: pdf, contentType: 'application/pdf' });
  }
  if (row.kind === 'facture_abonnement' && row.stripe_invoice_id && deps.invoicePdf) {
    try {
      const f = await deps.invoicePdf(row.stripe_invoice_id);
      if (f) m.attachments.push({ filename: f.filename, content: f.content, contentType: 'application/pdf' });
    } catch (e) {
      // la facture reste consultable en ligne (lien dans le message) : l'envoi n'est pas bloqué
      deps.log?.('Facture PDF indisponible', { id: row.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return m;
}

export interface OutboxReport { claimed: number; sent: number; failed: number; skipped: number; dryRun: boolean }

export async function processOutbox(deps: OutboxDeps, limit = 20): Promise<OutboxReport> {
  const report: OutboxReport = { claimed: 0, sent: 0, failed: 0, skipped: 0, dryRun: !deps.enabled };
  if (!deps.enabled) {
    deps.log('Envoi désactivé (EMAIL_ENABLED différent de « true ») : aucun message traité.');
    return report;
  }
  const rows = await deps.claim(limit);
  report.claimed = rows.length;
  for (const row of rows) {
    try {
      if (row.kind === 'relance' && row.reminder_id) {
        const due = await deps.reminderStillDue(row.reminder_id);
        if (due <= 0) {
          await deps.cancelReminder(row.reminder_id, 'Dette réglée avant l’envoi');
          report.skipped++;
          continue;
        }
      }
      const msg = await buildMessage(row, deps);
      await deps.send(msg);
      await deps.result(row.id, true);
      report.sent++;
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      // pas d'adresse e-mail ni de contenu dans les journaux : seulement l'identifiant et l'erreur
      deps.log('Échec d’envoi', { id: row.id, kind: row.kind, error: err });
      await deps.result(row.id, false, err);
      report.failed++;
    }
  }
  return report;
}

/** Envoi via l'API HTTP de Resend (https://resend.com/docs/api-reference/emails/send-email). */
export function resendSender(apiKey: string, from: string, replyTo?: string, fetchImpl: typeof fetch = fetch) {
  return async (m: MailMessage) => {
    const b64 = (u: Uint8Array) => {
      let s = '';
      for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
      return btoa(s);
    };
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to: m.to, subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}), ...(m.replyTo || replyTo ? { reply_to: m.replyTo ?? replyTo } : {}),
        attachments: m.attachments.map((a) => ({ filename: a.filename, content: b64(a.content) })),
      }),
    });
    if (!res.ok) throw new Error(`Fournisseur d’e-mail : HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  };
}
