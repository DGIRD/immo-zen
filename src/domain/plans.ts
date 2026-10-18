/**
 * Formules Immo-Zen (grille du 18/10/2026) : limites, fonctions, prix affichés.
 * La base fait foi (table plan_tiers et déclencheurs, migration 20261018000500_formules.sql) ;
 * ce module sert à l'affichage, au mode démonstration et aux vérifications faites avant l'envoi.
 */
import type { Snapshot } from '../data/repo.ts';

export type TierCode = 'decouverte' | 'essentiel' | 'patrimoine' | 'pro';
export interface TierLimits { owned: number | null; prospects: number | null; scenarios: number | null; storage_mb: number | null }
export interface TierFeatures { contacts: boolean; automations: boolean; consolidated: boolean; fiscal: boolean; sharing: boolean }

export interface TierDef {
  code: TierCode;
  label: string;
  /** Prix TTC affichés, en euros (le prix Stripe fait foi). */
  monthly: number;
  annual: number;
  pitch: string;
  limits: TierLimits;
  features: TierFeatures;
}

export const TIERS: TierDef[] = [
  { code: 'decouverte', label: 'Découverte', monthly: 0, annual: 0, pitch: 'Pour découvrir Immo-Zen avec un premier bien.',
    limits: { owned: 1, prospects: 5, scenarios: 2, storage_mb: 100 },
    features: { contacts: false, automations: false, consolidated: false, fiscal: false, sharing: false } },
  { code: 'essentiel', label: 'Essentiel', monthly: 9.9, annual: 99, pitch: 'Pour l’investisseur qui prospecte et gère jusqu’à 3 biens.',
    limits: { owned: 3, prospects: null, scenarios: null, storage_mb: 1024 },
    features: { contacts: true, automations: true, consolidated: false, fiscal: false, sharing: false } },
  { code: 'patrimoine', label: 'Patrimoine', monthly: 19.9, annual: 199, pitch: 'Pour piloter un patrimoine jusqu’à 10 biens.',
    limits: { owned: 10, prospects: null, scenarios: null, storage_mb: 5120 },
    features: { contacts: true, automations: true, consolidated: true, fiscal: false, sharing: false } },
  { code: 'pro', label: 'Pro', monthly: 39.9, annual: 399, pitch: 'Pour les grands patrimoines, avec la déclaration fiscale incluse.',
    limits: { owned: null, prospects: null, scenarios: null, storage_mb: 20480 },
    features: { contacts: true, automations: true, consolidated: true, fiscal: true, sharing: true } },
];
const PRO = TIERS[TIERS.length - 1] as TierDef;
export const tierDef = (code: string | null | undefined): TierDef => TIERS.find((t) => t.code === code) ?? PRO;
export const FISCAL_PACK_PRICE = 49;

/** Formule du compte connecté, telle que renvoyée par iz_my_plan(). */
export interface PlanInfo {
  tier: TierCode;
  label: string;
  /** false : phase de lancement, toutes les fonctions sont ouvertes. */
  enforce: boolean;
  reason: string;
  until: string | null;
  trial_tier: TierCode | null;
  fiscal_pack_until: string | null;
  limits: TierLimits;
  features: TierFeatures;
}

/** Sans migration des formules : aucune limite. */
export const UNLIMITED_PLAN: PlanInfo = {
  tier: 'pro', label: 'Pro', enforce: false, reason: 'acces_libre', until: null, trial_tier: null, fiscal_pack_until: null,
  limits: PRO.limits, features: PRO.features,
};

/** Formule simulée (mode démonstration) : mêmes règles que la base. */
export function demoPlan(tier: TierCode, enforce: boolean): PlanInfo {
  const t = tierDef(enforce ? tier : 'pro');
  return { tier: t.code, label: t.label, enforce, reason: enforce ? (t.code === 'decouverte' ? 'decouverte' : 'abonnement_active') : 'acces_libre',
    until: null, trial_tier: 'patrimoine', fiscal_pack_until: null, limits: t.limits, features: t.features };
}

/** Bien compté dans la limite de prospection : ni détenu, ni archivé, ni refusé, ni abandonné (même règle que la base). */
export const countsAsProspect = (status: string | null | undefined) => !!status && !['acquis', 'archive', 'refuse', 'abandonne'].includes(status);

export interface PlanUsage { owned: number; prospects: number; storage_bytes: number }
export function planUsage(data: Snapshot): PlanUsage {
  return {
    owned: data.properties.filter((p) => p.status === 'acquis').length,
    prospects: data.properties.filter((p) => countsAsProspect(p.status)).length,
    storage_bytes: data.documents.reduce((a, d) => a + Number(d.size_bytes ?? 0), 0),
  };
}

export const sizeLabel = (mb: number) => (mb >= 1024 ? `${mb / 1024} Go` : `${mb} Mo`);
export const limitLabel = (n: number | null, unit: string) => (n === null ? `${unit} illimités` : `${n} ${unit}`);
export const refusal = (plan: PlanInfo, what: string) =>
  `Formule ${plan.label} : ${what}. Choisissez une formule supérieure dans « Mon abonnement ».`;

type Row = Record<string, unknown>;
/** Écriture envisagée : création (une ou plusieurs lignes) ou modification d'une ligne existante. */
export type PlanOp = { table: string; rows: object[] } | { table: string; current: object; patch: object };

/**
 * Message de refus si l'écriture dépasse la formule (même règle que la base), sinon null.
 * Les données déjà présentes au-delà d'une limite restent modifiables : seuls les ajouts sont contrôlés.
 */
export function planViolation(plan: PlanInfo | null | undefined, data: Snapshot, op: PlanOp): string | null {
  if (!plan || !plan.enforce) return null;
  const { limits: l, features: f } = plan;
  const created = 'rows' in op;
  const items: { before: Row | null; after: Row }[] = created
    ? op.rows.map((r) => ({ before: null, after: r as Row }))
    : [{ before: op.current as Row, after: { ...op.current, ...op.patch } as Row }];

  if (op.table === 'properties') {
    const others = data.properties.filter((p) => !items.some((i) => i.before && i.before.id === p.id));
    let owned = others.filter((p) => p.status === 'acquis').length;
    let prospects = others.filter((p) => countsAsProspect(p.status)).length;
    for (const { before, after } of items) {
      const st = String(after.status ?? 'repere');
      if (st === 'acquis' && before?.status !== 'acquis') {
        if (l.owned !== null && owned >= l.owned) return refusal(plan, l.owned === 1 ? '1 bien détenu au plus' : `${l.owned} biens détenus au plus`);
        owned++;
      } else if (st === 'acquis') owned++;
      if (countsAsProspect(st) && !countsAsProspect(before?.status as string)) {
        if (l.prospects !== null && prospects >= l.prospects) return refusal(plan, `${l.prospects} biens en prospection au plus (hors biens archivés, refusés ou abandonnés)`);
        prospects++;
      } else if (countsAsProspect(st)) prospects++;
    }
  }
  if (op.table === 'scenarios' && l.scenarios !== null) {
    const added = new Map<string, number>();
    for (const { before, after } of items) {
      const pid = after.property_id as string | null | undefined;
      if (!pid || after.archived_at) continue;
      if (before && before.property_id === pid && !before.archived_at) continue;
      const n = data.scenarios.filter((s) => s.property_id === pid && !s.archived_at && s.id !== before?.id).length + (added.get(pid) ?? 0);
      if (n >= l.scenarios) return refusal(plan, `${l.scenarios} scénarios de simulation par bien au plus`);
      added.set(pid, (added.get(pid) ?? 0) + 1);
    }
  }
  if (op.table === 'pro_contacts' && created && !f.contacts) return refusal(plan, 'les contacts immobiliers (agences, agents, relances) ne sont pas inclus');
  if (op.table === 'documents' && created && l.storage_mb !== null) {
    const used = planUsage(data).storage_bytes + items.reduce((a, i) => a + Number(i.after.size_bytes ?? 0), 0);
    if (used > l.storage_mb * 1048576) return refusal(plan, `${sizeLabel(l.storage_mb)} d’espace pour les documents au plus`);
  }
  if (op.table === 'leases' && !f.automations) {
    const flags = ['receipt_auto_send', 'reminder_enabled', 'owner_confirmation_email'];
    if (items.some(({ before, after }) => flags.some((k) => after[k] === true && before?.[k] !== true))) {
      return refusal(plan, 'l’envoi automatique des quittances, les relances d’impayés et l’e-mail mensuel de confirmation ne sont pas inclus');
    }
  }
  if (op.table === 'reminders' && created && !f.automations) return refusal(plan, 'les relances d’impayés ne sont pas incluses');
  return null;
}

/** Formule minimale incluant une fonction (affichage des verrous). */
export function tierFor(feature: keyof TierFeatures): TierDef {
  return TIERS.find((t) => t.features[feature])!;
}
