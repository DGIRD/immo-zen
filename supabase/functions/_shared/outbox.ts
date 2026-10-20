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
  kind: 'confirmation_paiement' | 'quittance' | 'relance' | 'relance_a_valider' | 'invitation_locataire';
  to_emails: string[];
  subject: string;
  body_text: string;
  receipt_id: string | null;
  reminder_id: string | null;
}

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
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

export async function buildMessage(row: OutboxRow, deps: Pick<OutboxDeps, 'receipt' | 'pdfLib' | 'appUrl'>): Promise<MailMessage> {
  const to = row.to_emails.filter((e) => EMAIL.test(e));
  if (!to.length) throw new Error('Aucune adresse e-mail valide.');
  let text = row.body_text;
  if (text.includes('{{APP_URL}}')) {
    const url = deps.appUrl?.trim();
    if (!url || !/^https:\/\//.test(url)) throw new Error('Adresse de l’application (APP_URL) non configurée : lien d’invitation impossible.');
    text = text.split('{{APP_URL}}').join(url.endsWith('/') ? url : url + '/');
  }
  if (!text.includes(CONTACT_EMAIL)) text = `${text.trimEnd()}\n\n${MAIL_FOOTER}`;
  const m: MailMessage = { to, subject: row.subject, text, attachments: [] };
  if (row.kind === 'quittance') {
    if (!row.receipt_id) throw new Error('Quittance absente.');
    const r = await deps.receipt(row.receipt_id);
    if (!r) throw new Error('Quittance introuvable.');
    if (r.cancelled_at) throw new Error('Quittance annulée : envoi abandonné.');
    const pdf = await buildReceiptPdf(deps.pdfLib, { ...r, charges_label: r.charges_mode === 'forfait' ? 'Forfait de charges' : 'Provision pour charges' });
    m.attachments.push({ filename: `${r.kind === 'quittance' ? 'quittance' : 'recu'}-${r.number}.pdf`, content: pdf, contentType: 'application/pdf' });
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
        from, to: m.to, subject: m.subject, text: m.text, ...(replyTo ? { reply_to: replyTo } : {}),
        attachments: m.attachments.map((a) => ({ filename: a.filename, content: b64(a.content) })),
      }),
    });
    if (!res.ok) throw new Error(`Fournisseur d’e-mail : HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  };
}
