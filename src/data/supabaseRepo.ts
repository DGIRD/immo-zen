import { createSupabasePlatform } from './platform.ts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { EMPTY_SNAPSHOT, RepoError, type Repo, type SessionInfo, type Snapshot, type TenantPortal, type UpdateResult } from './repo.ts';
import type { Insert, Patch, Receipt, Reminder, Tables, TableName, UserSettings, VersionedTable } from './types.ts';

const PAGE = 1000;
const BUCKET = 'documents';

export function createSupabaseRepo(url: string, anonKey: string): Repo {
  const sb: SupabaseClient = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  });

  const toSession = (s: { user: { id: string; email?: string } } | null): SessionInfo | null =>
    s ? { userId: s.user.id, email: s.user.email ?? '' } : null;

  function check<R extends { data: unknown; error: { message: string } | null }>(res: R): R['data'] {
    if (res.error) throw new RepoError(res.error.message, res.error, !navigator.onLine);
    return res.data;
  }

  async function selectAll<T>(table: string, order = 'created_at'): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const rows = check(await sb.from(table).select('*').order(order, { ascending: true }).range(from, from + PAGE - 1)) as T[];
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }

  /** Lecture tolérante : une table du lot 2 absente (migration non appliquée) ne bloque pas l'application. */
  async function optional<T>(table: string, missing: string[], order = 'created_at'): Promise<T[]> {
    try {
      return await selectAll<T>(table, order);
    } catch (e) {
      if (/schema cache|does not exist/i.test((e as Error).message)) { missing.push(table); return []; }
      throw e;
    }
  }

  return {
    mode: 'supabase',
    platform: createSupabasePlatform(sb),

    async getSession() {
      const { data } = await sb.auth.getSession();
      return toSession(data.session);
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((event, session) => cb(toSession(session), event));
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password) {
      check(await sb.auth.signInWithPassword({ email, password }));
    },
    async signUp(email, password) {
      const data = check(await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } }));
      return data?.session ? 'session' : 'confirm_email';
    },
    async signOut() {
      await sb.auth.signOut({ scope: 'local' });
    },
    async requestPasswordReset(email) {
      check(await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${location.pathname}#/nouveau-mot-de-passe` }));
    },
    async updatePassword(password) {
      check(await sb.auth.updateUser({ password }));
    },

    async loadAll(): Promise<Snapshot> {
      const missing: string[] = [];
      const [properties, scenarios, contacts, tasks, events, settings, tenants, leases, leaseTenants, charges, payments, allocations, deposits,
        receipts, reminders, documents, expenses, outbox, revisions, tenantAccounts] = await Promise.all([
        selectAll<Tables['properties']>('properties'),
        selectAll<Tables['scenarios']>('scenarios'),
        selectAll<Tables['pro_contacts']>('pro_contacts'),
        selectAll<Tables['property_tasks']>('property_tasks'),
        selectAll<Tables['timeline_events']>('timeline_events', 'occurred_at'),
        sb.from('user_settings').select('*').maybeSingle().then((r) => check(r) as UserSettings | null),
        optional<Snapshot['tenants'][number]>('tenants', missing),
        optional<Snapshot['leases'][number]>('leases', missing),
        optional<Snapshot['leaseTenants'][number]>('lease_tenants', missing),
        optional<Snapshot['charges'][number]>('rent_charges', missing, 'due_date'),
        optional<Snapshot['payments'][number]>('payments', missing, 'paid_on'),
        optional<Snapshot['allocations'][number]>('payment_allocations', missing),
        optional<Snapshot['deposits'][number]>('deposit_movements', missing, 'occurred_on'),
        optional<Snapshot['receipts'][number]>('receipts', missing),
        optional<Snapshot['reminders'][number]>('reminders', missing),
        optional<Snapshot['documents'][number]>('documents', missing),
        optional<Snapshot['expenses'][number]>('expenses', missing, 'expense_date'),
        optional<Snapshot['outbox'][number]>('email_outbox', missing),
        optional<Snapshot['revisions'][number]>('lease_revisions', [], 'effective_on'),
        optional<Snapshot['tenantAccounts'][number]>('tenant_accounts', []),
      ]);
      return {
        ...EMPTY_SNAPSHOT, properties, scenarios, contacts, tasks, events, settings, tenants, leases, leaseTenants, charges, payments, allocations,
        deposits, receipts, reminders, documents, expenses, outbox, revisions, tenantAccounts, missingTables: [...new Set(missing)], loadedAt: new Date().toISOString(),
      };
    },

    async insert(table, row) {
      return check(await sb.from(table).insert(row as never).select('*').single()) as never;
    },
    async insertMany(table, rows) {
      if (!rows.length) return [];
      return check(await sb.from(table).insert(rows as never).select('*')) as never;
    },

    async update<T extends VersionedTable>(table: T, id: string, version: number, patch: Patch<Tables[T]>): Promise<UpdateResult<Tables[T]>> {
      const row = check(await sb.from(table).update(patch as never).eq('id', id).eq('version', version).select('*').maybeSingle()) as Tables[T] | null;
      if (row) return { status: 'ok', row };
      const current = check(await sb.from(table).select('*').eq('id', id).maybeSingle()) as Tables[T] | null;
      return current ? { status: 'conflict', current } : { status: 'missing' };
    },
    async updateWhere<T extends TableName>(table: T, match: Record<string, string>, patch: Patch<Tables[T]>) {
      check(await sb.from(table).update(patch as never).match(match));
    },

    async remove(table, id) {
      check(await sb.from(table).delete().eq('id', id));
    },
    async removeWhere(table, match) {
      check(await sb.from(table).delete().match(match));
    },

    async saveSettings(version, patch) {
      const session = await this.getSession();
      if (!session) throw new RepoError('Session expirée.');
      const row = check(await sb.from('user_settings').update(patch).eq('user_id', session.userId).eq('version', version).select('*').maybeSingle()) as UserSettings | null;
      if (row) return { status: 'ok', row };
      const current = check(await sb.from('user_settings').select('*').eq('user_id', session.userId).maybeSingle()) as UserSettings | null;
      if (current) return { status: 'conflict', current };
      const created = check(await sb.from('user_settings').insert({ user_id: session.userId, ...patch }).select('*').single()) as UserSettings;
      return { status: 'ok', row: created };
    },

    async generateCharges(leaseId, until) {
      return check(await sb.rpc('iz_generate_rent_charges', { p_lease: leaseId, ...(until ? { p_until: until } : {}) })) as number;
    },
    async issueReceiptWithExtras(chargeId, extras) {
      return check(await sb.rpc('iz_issue_receipt_with_extras', { p_charge: chargeId, p_extras: extras }).single()) as Receipt;
    },
    async reviseRent(a) {
      return check(await sb.rpc('iz_revise_rent', { p_lease: a.leaseId, p_effective: a.effective, p_old_label: a.oldLabel, p_old_index: a.oldIndex, p_new_label: a.newLabel, p_new_index: a.newIndex }).single()) as never;
    },
    async inviteTenant(tenantId) {
      const r = check(await sb.rpc('iz_invite_tenant', { p_tenant: tenantId })) as { code: string; email: string };
      return { code: r.code, email: r.email };
    },
    async revokeTenant(tenantId) {
      check(await sb.rpc('iz_revoke_tenant_access', { p_tenant: tenantId }));
    },
    async acceptTenantInvite(code) {
      check(await sb.rpc('iz_accept_tenant_invite', { p_code: code }));
    },
    async tenantPortal() {
      const res = await sb.rpc('iz_tenant_portal');
      if (res.error && (res.error.code === 'PGRST202' || /schema cache|does not exist/i.test(res.error.message))) return null;
      return check(res) as TenantPortal;
    },
    async issueReceipt(chargeId, kind) {
      return check(await sb.rpc('iz_issue_receipt', { p_charge: chargeId, p_kind: kind }).single()) as Receipt;
    },
    async cancelReceipt(receiptId, reason) {
      return check(await sb.rpc('iz_cancel_receipt', { p_receipt: receiptId, p_reason: reason }).single()) as Receipt;
    },
    async queueReceiptEmail(receiptId) {
      check(await sb.rpc('iz_queue_receipt_email', { p_receipt: receiptId }));
    },
    async queueReminder(reminderId) {
      return check(await sb.rpc('iz_queue_reminder', { p_reminder: reminderId }).single()) as Reminder;
    },

    async uploadFile(path, file, contentType) {
      check(await sb.storage.from(BUCKET).upload(path, file, { contentType, upsert: false }));
    },
    async fileUrl(path, seconds) {
      const data = check(await sb.storage.from(BUCKET).createSignedUrl(path, seconds)) as { signedUrl: string };
      return data.signedUrl;
    },
    async removeFile(path) {
      check(await sb.storage.from(BUCKET).remove([path]));
    },
  };
}

export type { Insert };
