import { useEffect, useState } from 'react';
import { usePlan, useStore } from '../data/store.tsx';
import { ACCESS_REASONS, STATUS_LABELS, type Plan } from '../data/platform.ts';
import { describeError } from '../data/repo.ts';
import { date, money2 } from '../domain/format.ts';
import { FISCAL_PACK_PRICE, planUsage, sizeLabel, TIERS, tierDef, type TierDef } from '../domain/plans.ts';
import { Button, KeyValue, NotAvailable, PageHeader, Pill, Section, Tabs } from '../ui/components.tsx';
import { useRoute } from '../ui/router.ts';

export const planPrice = (p: Plan) => `${money2(p.amount_cents / 100)} / ${p.billing_interval === 'month' ? 'mois' : 'an'}`;

/** Ce que comprend une formule, en quelques lignes. */
export function tierHighlights(t: TierDef): string[] {
  const l = t.limits, f = t.features;
  return [
    l.owned === null ? 'Biens détenus illimités' : l.owned === 1 ? '1 bien détenu' : `Jusqu’à ${l.owned} biens détenus`,
    l.prospects === null ? 'Prospection illimitée' : `${l.prospects} biens en prospection`,
    l.scenarios === null ? 'Scénarios de simulation illimités' : `${l.scenarios} scénarios par bien`,
    f.contacts ? 'Contacts, relances agence, comparaison de biens' : 'Sans contacts ni comparaison',
    f.automations ? 'Quittances envoyées automatiquement, relances d’impayés' : 'Quittances PDF à la main',
    ...(f.consolidated ? ['Cash-flow consolidé'] : []),
    f.fiscal ? 'Déclaration fiscale incluse' : t.code === 'decouverte' ? '' : `Déclaration fiscale en option (${FISCAL_PACK_PRICE} €/an)`,
    ...(f.sharing ? ['Plusieurs SCI et accès partagé (bientôt)'] : []),
    `${sizeLabel(l.storage_mb ?? 0)} de documents`,
  ].filter(Boolean);
}

function Meter({ label, used, max, format = String }: { label: string; used: number; max: number | null; format?: (n: number) => string }) {
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <div className="meter">
      <div className="meter-head"><span>{label}</span><span className="muted small">{format(used)}{max === null ? ' · illimité' : ` sur ${format(max)}`}</span></div>
      {max !== null && <div className="meter-bar" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span className={pct >= 100 ? 'full' : ''} style={{ width: `${pct}%` }} /></div>}
    </div>
  );
}

export function SubscriptionPage() {
  const { platform, refreshPlatform, repo, notify, data } = useStore();
  const plan = usePlan();
  const route = useRoute();
  const [busy, setBusy] = useState<string | null>(null);
  const [period, setPeriod] = useState<'year' | 'month'>('year');
  const back = route.query.get('retour');
  useEffect(() => { void refreshPlatform(); }, [refreshPlatform]);

  async function go(kind: 'checkout' | 'portal' | 'pack', code?: Plan['code']) {
    setBusy(kind + (code ?? ''));
    try {
      const url = kind === 'checkout' ? await repo.platform.checkout(code!) : kind === 'pack' ? await repo.platform.buyFiscalPack() : await repo.platform.portal();
      location.assign(url);
    } catch (e) {
      notify(describeError(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  if (platform === undefined) return <PageHeader title="Mon abonnement" subtitle="Chargement…" />;
  if (platform === null) {
    return (
      <>
        <PageHeader title="Mon abonnement" />
        <NotAvailable>La base de données n’est pas encore à jour pour les abonnements (migration du lot 3 à exécuter). Votre accès n’est pas limité.</NotAvailable>
      </>
    );
  }
  const { access, subscription: s, plans, config } = platform;
  const running = s?.source === 'stripe' && ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'].includes(s.status);
  const usage = planUsage(data);
  const current = tierDef(plan.tier);
  const offer = (tier: string) => plans.find((p) => p.tier === tier && p.kind !== 'option' && p.billing_interval === period && p.code !== 'mensuel' && p.code !== 'annuel');
  const pack = plans.find((p) => p.code === 'pack_fiscal');
  const packOpen = !!pack?.active && !!pack.stripe_price_id;
  const packValid = s?.fiscal_pack_until && new Date(s.fiscal_pack_until) > new Date() ? s.fiscal_pack_until : null;
  const subPlan = s?.plan_code ? plans.find((p) => p.code === s.plan_code) : undefined;

  return (
    <>
      <PageHeader title="Mon abonnement" subtitle="Votre formule, ce qu’elle comprend, et le passage à une autre formule." />
      {back === 'ok' && <p className="note" role="status">Paiement transmis. L’abonnement s’active dès que Stripe le confirme : quelques secondes par carte, jusqu’à quelques jours ouvrés par prélèvement SEPA. Rechargez la page si besoin.</p>}
      {back === 'pack' && <p className="note" role="status">Paiement du pack fiscal transmis : la déclaration fiscale s’ouvre dès que Stripe confirme le paiement.</p>}
      {back === 'annule' && <p className="note" role="status">Paiement annulé : aucun montant n’a été prélevé.</p>}

      <Section title="Ma formule">
        <p className="current-tier"><Pill tone={plan.tier === 'decouverte' ? 'neutral' : 'ok'}>{current.label}</Pill> {ACCESS_REASONS[plan.reason] ?? ACCESS_REASONS[access.reason] ?? access.reason}</p>
        {!plan.enforce ? (
          <p className="muted small">Phase de lancement : toutes les fonctions sont ouvertes sans abonnement pour l’instant. Les limites ci-dessous s’appliqueront à l’ouverture des abonnements.</p>
        ) : (
          <div className="meters">
            <Meter label="Biens détenus" used={usage.owned} max={plan.limits.owned} />
            <Meter label="Biens en prospection" used={usage.prospects} max={plan.limits.prospects} />
            <Meter label="Documents" used={Math.round(usage.storage_bytes / 1048576)} max={plan.limits.storage_mb} format={(n) => sizeLabel(n)} />
          </div>
        )}
        <KeyValue items={[
          ['Abonnement', s ? `${STATUS_LABELS[s.status]}${s.source === 'manuel' ? ' (accordé par Immo-Zen)' : ''}` : STATUS_LABELS.none],
          ...(subPlan ? [['Offre', subPlan.label] as [string, string]] : []),
          ...(access.until ? [[access.reason === 'essai' ? 'Fin de l’offre Découverte' : access.reason === 'decouverte_terminee' ? 'Offre Découverte terminée le' : 'Accès jusqu’au', date(access.until)] as [string, string]] : []),
          ...(s?.current_period_end && running ? [[s.cancel_at_period_end ? 'Fin d’accès' : 'Prochaine échéance', date(s.current_period_end)] as [string, string]] : []),
          ...(packValid ? [['Pack fiscal', `valable jusqu’au ${date(packValid)}`] as [string, string]] : []),
        ]} />
        {access.reason === 'essai' && plan.enforce && <p className="muted">Offre {tierDef(plan.trial_tier ?? 'decouverte').label} : 30 jours gratuits, sans carte bancaire. À son terme, sans abonnement, vos données restent consultables et exportables mais ne sont plus modifiables : rien n’est supprimé.</p>}
        {access.reason === 'decouverte_terminee' && <p className="form-error">Votre offre Découverte de 30 jours est terminée : vos données restent consultables et exportables. Choisissez une formule pour continuer à les modifier.</p>}
        {s?.cancel_at_period_end && s.status !== 'canceled' && <p className="muted">Résiliation programmée : l’abonnement reste actif jusqu’au {date(s.current_period_end)}, puis le compte passe en consultation seule, sans nouveau prélèvement.</p>}
        {s?.status === 'past_due' && <p className="form-error">Le dernier prélèvement a échoué. Stripe va le retenter ; mettez à jour votre moyen de paiement pour éviter l’interruption.</p>}
        {plan.enforce && plan.tier === 'decouverte' && access.has_access && <p>Pendant l’offre Découverte, les ajouts au-delà des limites sont bloqués ; vos données restent modifiables et exportables.</p>}
      </Section>

      {running ? (
        <Section title="Gérer mon abonnement">
          <p>Factures, moyen de paiement, changement de formule ou de périodicité et résiliation se font dans l’espace client sécurisé de Stripe. Un changement de formule prend effet immédiatement, au prorata.</p>
          <Button variant="primary" disabled={!!busy} onClick={() => void go('portal')}>{busy === 'portal' ? 'Ouverture…' : 'Ouvrir l’espace client'}</Button>
        </Section>
      ) : (
        <Section title="Choisir une formule" actions={<Tabs tabs={[['year', 'Annuel : 2 mois offerts'], ['month', 'Mensuel']]} value={period} onChange={setPeriod} />}>
          <div className="plans tiers">
            {TIERS.filter((t) => t.code !== 'decouverte').map((t) => {
              const o = offer(t.code);
              const open = !!o?.active && !!o.stripe_price_id && (o.amount_cents ?? 0) > 0;
              const euros = o?.amount_cents ? o.amount_cents / 100 : period === 'year' ? t.annual : t.monthly;
              return (
                <div key={t.code} className={`plan${t.code === 'patrimoine' ? ' plan-featured' : ''}${t.code === plan.tier && plan.enforce ? ' plan-current' : ''}`}>
                  <h3>{t.label}</h3>
                  <p className="plan-price">{money2(euros)} <span className="muted small">TTC / {period === 'year' ? 'an' : 'mois'}</span></p>
                  {period === 'year' && <p className="muted small">soit {money2(euros / 12)} par mois</p>}
                  <p className="small">{t.pitch}</p>
                  <ul className="plan-list">{tierHighlights(t).map((h) => <li key={h}>{h}</li>)}</ul>
                  <Button variant={t.code === 'patrimoine' ? 'primary' : 'secondary'} disabled={!open || !!busy || repo.mode === 'demo'} onClick={() => void go('checkout', o!.code)}>
                    {busy === 'checkout' + o?.code ? 'Redirection…' : open ? `Choisir ${t.label}` : 'Bientôt disponible'}
                  </Button>
                </div>
              );
            })}
          </div>
          {!plans.some((p) => p.tier && p.active && p.stripe_price_id) && (
            <NotAvailable>Le paiement en ligne n’est pas encore ouvert.{config?.support_email ? <> Contact : <a href={`mailto:${config.support_email}`}>{config.support_email}</a>.</> : null}</NotAvailable>
          )}
          <p className="muted small">Offre Découverte gratuite pendant 30 jours à la création du compte : 1 bien détenu, 5 biens en prospection, 2 scénarios par bien, 100 Mo de documents ; ensuite, sans abonnement, consultation et export seulement. Paiement sécurisé par Stripe (carte bancaire, Apple Pay, Google Pay ou prélèvement SEPA) : Immo-Zen ne voit jamais vos coordonnées bancaires. Sans engagement : résiliation en ligne à tout moment, effective à la fin de la période payée.</p>
          {s?.stripe_customer_id && <Button size="sm" disabled={!!busy} onClick={() => void go('portal')}>Mes factures</Button>}
        </Section>
      )}

      {(plan.tier === 'essentiel' || plan.tier === 'patrimoine' || packValid) && plan.enforce && (
        <Section title="Pack fiscal">
          <p>Déclaration des revenus fonciers (2044, micro-foncier) et des locations meublées (micro-BIC, LMNP au réel avec amortissements), cases à reporter et export Excel, pendant 12 mois : <strong>{money2((pack?.amount_cents ?? FISCAL_PACK_PRICE * 100) / 100)} TTC</strong>, paiement unique. Inclus dans la formule Pro.</p>
          {packValid ? <p><Pill tone="ok">Actif</Pill> jusqu’au {date(packValid)}</p> : (
            <Button variant="primary" disabled={!packOpen || !running || !!busy || repo.mode === 'demo'} onClick={() => void go('pack')}>
              {busy === 'pack' ? 'Redirection…' : !packOpen ? 'Bientôt disponible' : 'Ajouter le pack fiscal'}
            </Button>
          )}
        </Section>
      )}
    </>
  );
}
