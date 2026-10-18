/**
 * Plateforme (lot 3) : accès, abonnement, offres, administration, accès support, prospects commerciaux.
 * Les droits sont vérifiés par la base (RLS et fonctions « security definer ») ; l'interface ne fait qu'afficher.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { RepoError } from './repo.ts';
import type { DvfEstimate, DvfType } from '../../supabase/functions/_shared/dvf.ts';

export type SubscriptionStatus = 'none' | 'trialing' | 'active' | 'past_due' | 'unpaid' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'paused';

export interface AccessState { has_access: boolean; reason: string; until: string | null; is_admin: boolean; enforce: boolean }
export interface AppConfig { enforce_subscription: boolean; trial_days: number; support_email: string | null; updated_at: string }
export interface Plan { code: 'mensuel' | 'annuel'; label: string; amount_cents: number; currency: string; billing_interval: 'month' | 'year'; stripe_price_id: string | null; active: boolean }
export interface Subscription {
  user_id: string; source: 'stripe' | 'manuel'; status: SubscriptionStatus; plan_code: string | null; stripe_customer_id: string | null;
  current_period_end: string | null; cancel_at_period_end: boolean; canceled_at: string | null; note: string | null; updated_at: string;
}
export interface PlatformState { access: AccessState; config: AppConfig | null; plans: Plan[]; subscription: Subscription | null; supportUntil: string | null }

export interface AdminUser {
  user_id: string; email: string; created_at: string; last_sign_in_at: string | null; is_admin: boolean; status: SubscriptionStatus; source: string | null;
  plan_code: string | null; current_period_end: string | null; cancel_at_period_end: boolean; has_access: boolean; access_reason: string; support_until: string | null;
}
export interface Incident { kind: 'email' | 'tache' | 'stripe'; at: string; status: string; detail: string; user_id: string | null }
export interface AuditEntry { id: number; admin_id: string | null; action: string; target_user: string | null; details: Record<string, unknown>; at: string }
export interface StripeEventRow { id: string; type: string; received_at: string; status: string; user_id: string | null; error: string | null }
export interface Lead {
  id: string; name: string; email: string | null; phone: string | null; source: string | null; status: 'nouveau' | 'contacte' | 'demo' | 'converti' | 'perdu';
  notes: string | null; next_follow_up: string | null; version: number; created_at: string; updated_at: string;
}
export type LeadInput = Pick<Lead, 'name' | 'email' | 'phone' | 'source' | 'status' | 'notes' | 'next_follow_up'>;

/** Assistant conversationnel non configuré (pas de clé d'API) ou indisponible en mode démonstration. */
export class AssistantUnavailable extends Error {}
/** Fonction serveur non déployée ou indisponible (mode démonstration). */
export class FunctionUnavailable extends Error {}
export interface ChatMessage { role: 'user' | 'assistant'; content: string }

export interface PlatformApi {
  /** Réponse de l'assistant conversationnel (fonction « assistant »). */
  ask(messages: ChatMessage[], page: string): Promise<string>;
  /** Estimation DVF calculée par la fonction serveur « dvf » (repli). */
  dvf(payload: { citycode: string; type: DvfType; surface: number; lat: number | null; lon: number | null }): Promise<DvfEstimate | null>;
  /** null : tables du lot 3 absentes (migration non exécutée). */
  state(): Promise<PlatformState | null>;
  checkout(plan: Plan['code']): Promise<string>;
  portal(): Promise<string>;
  setSupportAccess(until: string | null): Promise<void>;
  admin: {
    users(): Promise<AdminUser[]>;
    setManualAccess(userId: string, until: string | null, note: string): Promise<void>;
    setConfig(enforce: boolean, trialDays: number, supportEmail: string): Promise<void>;
    updatePlan(code: Plan['code'], patch: Partial<Pick<Plan, 'label' | 'amount_cents' | 'stripe_price_id' | 'active'>>): Promise<void>;
    incidents(): Promise<Incident[]>;
    audit(): Promise<AuditEntry[]>;
    stripeEvents(): Promise<StripeEventRow[]>;
    supportSummary(userId: string): Promise<Record<string, number>>;
    invite(email: string): Promise<void>;
    leads(): Promise<Lead[]>;
    saveLead(id: string | null, input: LeadInput): Promise<void>;
    deleteLead(id: string): Promise<void>;
  };
}

export const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  none: 'Aucun abonnement', trialing: 'Période d’essai', active: 'Actif', past_due: 'Paiement en retard', unpaid: 'Impayé',
  canceled: 'Résilié', incomplete: 'Paiement à finaliser', incomplete_expired: 'Paiement abandonné', paused: 'Suspendu',
};
export const ACCESS_REASONS: Record<string, string> = {
  administrateur: 'Administrateur', essai: 'Période d’essai', acces_libre: 'Accès libre (contrôle désactivé)',
  resilie_fin_de_periode: 'Résilié, accès jusqu’à la fin de la période payée', sans_abonnement: 'Sans abonnement',
  abonnement_active: 'Abonnement actif', abonnement_trialing: 'Essai Stripe', abonnement_past_due: 'Paiement en retard (accès maintenu pendant les relances)',
  abonnement_canceled: 'Abonnement terminé', abonnement_unpaid: 'Impayé', abonnement_incomplete: 'Paiement à finaliser', abonnement_paused: 'Suspendu',
  abonnement_incomplete_expired: 'Paiement abandonné',
};

const missing = (e: { code?: string; message?: string } | null) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202' || /schema cache|does not exist/i.test(e.message ?? ''));
function check<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw r.error;
  return r.data;
}

export function createSupabasePlatform(sb: SupabaseClient): PlatformApi {
  async function invoke(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { data, error } = await sb.functions.invoke('platform', { body });
    if (error) {
      // message renvoyé par la fonction (ex. paiement non configuré)
      const ctx = (error as { context?: Response }).context;
      let msg = 'Service indisponible : la fonction « platform » n’est peut-être pas encore déployée.';
      try { const j = await ctx?.json(); if (j?.error) msg = j.error; } catch { /* corps illisible */ }
      throw new RepoError(msg);
    }
    return data as Record<string, unknown>;
  }
  return {
    async ask(messages, page) {
      const { data, error } = await sb.functions.invoke('assistant', { body: { messages, page } });
      if (error) {
        const ctx = (error as { context?: Response }).context;
        if (!ctx || ctx.status === 503 || ctx.status === 404) throw new AssistantUnavailable('Assistant non configuré.');
        let msg = 'L’assistant n’a pas répondu.';
        try { const j = await ctx.json(); if (j?.error) msg = j.error; } catch { /* corps illisible */ }
        throw new RepoError(msg);
      }
      return String((data as { answer?: string }).answer ?? '');
    },
    async dvf(payload) {
      const { data, error } = await sb.functions.invoke('dvf', { body: payload });
      if (error) {
        const ctx = (error as { context?: Response }).context;
        if (!ctx || ctx.status === 404 || ctx.status === 503) throw new FunctionUnavailable('Fonction d’estimation non déployée.');
        let msg = 'Données DVF momentanément indisponibles.';
        try { const j = await ctx.json(); if (j?.error) msg = j.error; } catch { /* corps illisible */ }
        throw new RepoError(msg);
      }
      return (data as { estimate: DvfEstimate | null }).estimate;
    },
    async state() {
      const acc = await sb.rpc('iz_my_access').maybeSingle();
      if (missing(acc.error)) return null;
      const access = check(acc) as AccessState;
      const [config, plans, sub, support] = await Promise.all([
        sb.from('app_config').select('*').maybeSingle(),
        sb.from('plans').select('*').order('billing_interval'),
        sb.from('subscriptions').select('*').maybeSingle(),
        sb.from('support_access').select('granted_until').maybeSingle(),
      ]);
      return {
        access, config: check(config) as AppConfig | null, plans: check(plans) as Plan[], subscription: check(sub) as Subscription | null,
        supportUntil: (check(support) as { granted_until: string } | null)?.granted_until ?? null,
      };
    },
    async checkout(plan) { return String((await invoke({ action: 'checkout', plan })).url); },
    async portal() { return String((await invoke({ action: 'portal' })).url); },
    async setSupportAccess(until) {
      const { data: s } = await sb.auth.getSession();
      const uid = s.session?.user.id;
      if (!uid) throw new RepoError('Session expirée.');
      if (until) check(await sb.from('support_access').upsert({ user_id: uid, granted_until: until }));
      else check(await sb.from('support_access').delete().eq('user_id', uid));
    },
    admin: {
      async users() { return check(await sb.rpc('iz_admin_users')) as AdminUser[]; },
      async setManualAccess(userId, until, note) { check(await sb.rpc('iz_admin_set_manual_access', { p_user: userId, p_until: until, p_note: note })); },
      async setConfig(enforce, trialDays, email) { check(await sb.rpc('iz_admin_set_config', { p_enforce: enforce, p_trial_days: trialDays, p_support_email: email })); },
      async updatePlan(code, patch) { check(await sb.from('plans').update({ ...patch, updated_at: new Date().toISOString() }).eq('code', code)); },
      async incidents() { return check(await sb.rpc('iz_admin_incidents')) as Incident[]; },
      async audit() { return check(await sb.from('admin_audit').select('*').order('at', { ascending: false }).limit(300)) as AuditEntry[]; },
      async stripeEvents() { return check(await sb.from('stripe_events').select('*').order('received_at', { ascending: false }).limit(300)) as StripeEventRow[]; },
      async supportSummary(userId) { return check(await sb.rpc('iz_admin_support_summary', { p_user: userId })) as Record<string, number>; },
      async invite(email) { await invoke({ action: 'invite', email }); },
      async leads() { return check(await sb.from('platform_leads').select('*').order('created_at', { ascending: false })) as Lead[]; },
      async saveLead(id, input) {
        if (id) check(await sb.from('platform_leads').update(input).eq('id', id));
        else check(await sb.from('platform_leads').insert(input));
      },
      async deleteLead(id) { check(await sb.from('platform_leads').delete().eq('id', id)); },
    },
  };
}

// ---------------------------------------------------------------- mode démonstration

const DEMO_KEY = 'immozen:demo:platform';
interface DemoPlatform { config: AppConfig; plans: Plan[]; leads: Lead[]; audit: AuditEntry[]; supportUntil: string | null }

/** Mode démonstration : l'utilisateur local est administrateur ; aucun paiement possible. */
export function createDemoPlatform(storage: Storage, userId: () => string | null, email: () => string): PlatformApi {
  const read = (): DemoPlatform => {
    try { const v = storage.getItem(DEMO_KEY); if (v) return JSON.parse(v) as DemoPlatform; } catch { /* stockage indisponible */ }
    return {
      config: { enforce_subscription: false, trial_days: 30, support_email: null, updated_at: new Date().toISOString() },
      plans: [
        { code: 'mensuel', label: 'Abonnement mensuel', amount_cents: 0, currency: 'eur', billing_interval: 'month', stripe_price_id: null, active: false },
        { code: 'annuel', label: 'Abonnement annuel', amount_cents: 0, currency: 'eur', billing_interval: 'year', stripe_price_id: null, active: false },
      ],
      leads: [], audit: [], supportUntil: null,
    };
  };
  const write = (d: DemoPlatform) => { try { storage.setItem(DEMO_KEY, JSON.stringify(d)); } catch { /* stockage indisponible */ } };
  const log = (d: DemoPlatform, action: string, details: Record<string, unknown> = {}) =>
    d.audit.unshift({ id: d.audit.length + 1, admin_id: userId(), action, target_user: null, details, at: new Date().toISOString() });
  const noPay = () => { throw new RepoError('Mode démonstration : aucun paiement n’est possible.'); };
  return {
    async ask() { throw new AssistantUnavailable('Mode démonstration : aide intégrée seulement.'); },
    async dvf() { throw new FunctionUnavailable('Mode démonstration.'); },
    async state() {
      const d = read();
      return { access: { has_access: true, reason: 'administrateur', until: null, is_admin: true, enforce: d.config.enforce_subscription }, config: d.config, plans: d.plans, subscription: null, supportUntil: d.supportUntil };
    },
    checkout: async () => noPay(),
    portal: async () => noPay(),
    async setSupportAccess(until) { const d = read(); d.supportUntil = until; write(d); },
    admin: {
      async users() {
        const id = userId() ?? 'demo';
        return [{ user_id: id, email: email(), created_at: new Date().toISOString(), last_sign_in_at: new Date().toISOString(), is_admin: true, status: 'none', source: null,
          plan_code: null, current_period_end: null, cancel_at_period_end: false, has_access: true, access_reason: 'administrateur', support_until: read().supportUntil }];
      },
      async setManualAccess() { throw new RepoError('Mode démonstration : un seul compte local.'); },
      async setConfig(enforce, trialDays, supportEmail) {
        const d = read();
        d.config = { enforce_subscription: enforce, trial_days: trialDays, support_email: supportEmail.trim() || null, updated_at: new Date().toISOString() };
        log(d, 'configuration', { ...d.config });
        write(d);
      },
      async updatePlan(code, patch) {
        const d = read();
        if (patch.stripe_price_id && !/^price_[A-Za-z0-9]+$/.test(patch.stripe_price_id)) throw new RepoError('Identifiant de prix Stripe invalide (price_…).');
        d.plans = d.plans.map((p) => (p.code === code ? { ...p, ...patch } : p));
        write(d);
      },
      async incidents() { return []; },
      async audit() { return read().audit; },
      async stripeEvents() { return []; },
      async supportSummary() { throw new RepoError('Mode démonstration : pas d’autre compte.'); },
      async invite() { throw new RepoError('Mode démonstration : aucune invitation n’est envoyée.'); },
      async leads() { return read().leads; },
      async saveLead(id, input) {
        const d = read();
        if (!input.name.trim()) throw new RepoError('Le nom est obligatoire.');
        const now = new Date().toISOString();
        if (id) d.leads = d.leads.map((l) => (l.id === id ? { ...l, ...input, version: l.version + 1, updated_at: now } : l));
        else d.leads.unshift({ id: crypto.randomUUID(), ...input, version: 1, created_at: now, updated_at: now });
        write(d);
      },
      async deleteLead(id) { const d = read(); d.leads = d.leads.filter((l) => l.id !== id); write(d); },
    },
  };
}
