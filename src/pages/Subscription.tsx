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
    'Simulation de rentabilité pour chaque bien',
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
  // périodicité affichée par défaut : celle de l'abonnement en cours
  const currentInterval = platform?.subscription?.plan_code ? platform.plans.find((p) => p.code === platform.subscription?.plan_code)?.billing_interval : undefined;
  useEffect(() => { if (currentInterval) setPeriod(currentInterval === 'month' ? 'month' : 'year'); }, [currentInterval]);

  async function download(id: string) {
    setBusy('facture' + id);
    try { window.open(await repo.platform.invoiceUrl(id), '_blank', 'noopener'); }
    catch (e) { notify(describeError(e), 'error'); }
    finally { setBusy(null); }
  }

  async function go(kind: 'checkout' | 'portal' | 'pack', code?: Plan['code']) {
    setBusy(kind + (code ?? ''));
    try {
      const url = kind === 'checkout' ? await repo.platform.checkout(code!) : kind === 'pack' ? await repo.platform.buyFiscalPack() : await repo.platform.portal(code);
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
  const invoices = platform.invoices ?? [];
  const running = s?.source === 'stripe' && ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'].includes(s.status);
  const usage = planUsage(data);
  const current = tierDef(plan.tier);
  const offer = (tier: string) => plans.find((p) => p.tier === tier && p.kind !== 'option' && p.billing_interval === period && p.code !== 'mensuel' && p.code !== 'annuel');
  const pack = plans.find((p) => p.code === 'pack_fiscal');
  const packOpen = !!pack?.active && !!pack.stripe_price_id;
  const packValid = s?.fiscal_pack_until && new Date(s.fiscal_pack_until) > new Date() ? s.fiscal_pack_until : null;
  const subPlan = s?.plan_code ? plans.find((p) => p.code === s.plan_code) : undefined;
  // formule payée (indépendante de l'accès effectif, ouvert à tous pendant la phase de lancement)
  const paidTier = running ? subPlan?.tier ?? null : null;
  const rank = (code: string | null | undefined) => TIERS.findIndex((t) => t.code === code);
  const showPack = !!packValid || paidTier === 'essentiel' || paidTier === 'patrimoine' || (plan.enforce && (plan.tier === 'essentiel' || plan.tier === 'patrimoine'));

  return (
    <>
      <PageHeader title="Mon abonnement" subtitle="Votre formule, ce qu’elle comprend, et le passage à une autre formule." />
      {back === 'ok' && <p className="note" role="status">Paiement transmis. L’abonnement s’active dès que Stripe le confirme : quelques secondes par carte, jusqu’à quelques jours ouvrés par prélèvement SEPA. Rechargez la page si besoin.</p>}
      {back === 'pack' && <p className="note" role="status">Paiement du pack fiscal transmis : la déclaration fiscale s’ouvre dès que Stripe confirme le paiement.</p>}
      {back === 'annule' && <p className="note" role="status">Paiement annulé : aucun montant n’a été prélevé.</p>}
      {back === 'formule' && <p className="note" role="status">Changement de formule transmis à Stripe : votre nouvelle formule s’affiche dès sa confirmation (quelques secondes). Rechargez la page si besoin.</p>}

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

      {running && (
        <Section title="Gérer mon abonnement">
          <p>Factures, moyen de paiement et résiliation se font dans l’espace client sécurisé de Stripe. Pour changer de formule, choisissez-la ci-dessous : une formule supérieure s’applique immédiatement, au prorata ; une formule inférieure prend effet à la fin de la période payée.</p>
          <Button variant="primary" disabled={!!busy} onClick={() => void go('portal')}>{busy === 'portal' ? 'Ouverture…' : 'Ouvrir l’espace client'}</Button>
        </Section>
      )}
      <Section title={running ? 'Changer de formule' : 'Choisir une formule'} actions={<Tabs tabs={[['year', 'Annuel : 2 mois offerts'], ['month', 'Mensuel']]} value={period} onChange={setPeriod} />}>
        <div className="plans tiers">
          {TIERS.filter((t) => t.code !== 'decouverte').map((t) => {
            const o = offer(t.code);
            const open = !!o?.active && !!o.stripe_price_id && (o.amount_cents ?? 0) > 0;
            const euros = o?.amount_cents ? o.amount_cents / 100 : period === 'year' ? t.annual : t.monthly;
            const isCurrent = running ? subPlan?.code === o?.code : t.code === plan.tier && plan.enforce;
            const sameTier = running && paidTier === t.code;
            const label = !open ? 'Bientôt disponible'
              : isCurrent ? 'Votre formule actuelle'
              : !running ? `Choisir ${t.label}`
              : sameTier ? `Passer en ${period === 'year' ? 'annuel' : 'mensuel'}`
              : rank(t.code) > rank(paidTier) ? `Passer à ${t.label}` : `Changer pour ${t.label}`;
            return (
              <div key={t.code} className={`plan${t.code === 'patrimoine' ? ' plan-featured' : ''}${isCurrent || (!running && t.code === plan.tier && plan.enforce) ? ' plan-current' : ''}`}>
                <h3>{t.label}</h3>
                <p className="plan-price">{money2(euros)} <span className="muted small">TTC / {period === 'year' ? 'an' : 'mois'}</span></p>
                {period === 'year' && <p className="muted small">soit {money2(euros / 12)} par mois</p>}
                <p className="small">{t.pitch}</p>
                <ul className="plan-list">{tierHighlights(t).map((h) => <li key={h}>{h}</li>)}</ul>
                <Button variant={isCurrent ? 'secondary' : t.code === 'patrimoine' ? 'primary' : 'secondary'} disabled={!open || isCurrent || !!busy || repo.mode === 'demo'}
                  onClick={() => void go(running ? 'portal' : 'checkout', o!.code)}>
                  {busy === (running ? 'portal' : 'checkout') + o?.code ? 'Redirection…' : label}
                </Button>
                {running && open && !isCurrent && !sameTier && rank(t.code) < rank(paidTier) && <p className="muted small">Prend effet à la fin de la période payée.</p>}
              </div>
            );
          })}
        </div>
        {!plans.some((p) => p.tier && p.active && p.stripe_price_id) && (
          <NotAvailable>Le paiement en ligne n’est pas encore ouvert.{config?.support_email ? <> Contact : <a href={`mailto:${config.support_email}`}>{config.support_email}</a>.</> : null}</NotAvailable>
        )}
        {!running && <p className="muted small">Offre Découverte gratuite pendant 30 jours à la création du compte : 1 bien détenu, 5 biens en prospection avec leur simulation, 100 Mo de documents ; ensuite, sans abonnement, consultation et export seulement. Paiement sécurisé par Stripe (carte bancaire, Apple Pay, Google Pay ou prélèvement SEPA) : Immo-Zen ne voit jamais vos coordonnées bancaires. Sans engagement : résiliation en ligne à tout moment, effective à la fin de la période payée.</p>}
        {!running && s?.stripe_customer_id && <Button size="sm" disabled={!!busy} onClick={() => void go('portal')}>Mes factures</Button>}
      </Section>

      {showPack && (
        <Section title="Pack fiscal">
          <p>Déclaration des revenus fonciers (2044, micro-foncier) et des locations meublées (micro-BIC, LMNP au réel avec amortissements), cases à reporter et export Excel, pendant 12 mois : <strong>{money2((pack?.amount_cents ?? FISCAL_PACK_PRICE * 100) / 100)} TTC</strong>, paiement unique. Inclus dans la formule Pro.</p>
          {packValid ? <p><Pill tone="ok">Actif</Pill> jusqu’au {date(packValid)}</p> : (
            <Button variant="primary" disabled={!packOpen || !running || !!busy || repo.mode === 'demo'} onClick={() => void go('pack')}>
              {busy === 'pack' ? 'Redirection…' : !packOpen ? 'Bientôt disponible' : 'Ajouter le pack fiscal'}
            </Button>
          )}
        </Section>
      )}

      {(invoices.length > 0 || !!s?.stripe_customer_id) && (
        <Section title="Mes factures">
          {invoices.length === 0 ? <p className="muted">Aucune facture pour l’instant. Chaque paiement (abonnement, renouvellement, changement de formule, pack fiscal) produit une facture, envoyée par e-mail et disponible ici.</p> : (
            <div className="dt-scroll"><table className="dt-table">
              <thead><tr><th>Date</th><th>Objet</th><th>Période</th><th>N°</th><th className="num">Montant TTC</th><th><span className="sr-only">Télécharger</span></th></tr></thead>
              <tbody>
                {invoices.map((f) => (
                  <tr key={f.id}>
                    <td>{date(f.invoice_date)}</td>
                    <td>{f.description ?? 'Immo-Zen'}</td>
                    <td>{f.period_start && f.period_end && f.plan_code !== 'pack_fiscal' ? `${date(f.period_start)} – ${date(f.period_end)}` : '—'}</td>
                    <td>{f.number ?? '—'}</td>
                    <td className="num">{money2(f.amount_paid_cents / 100)}</td>
                    <td><Button size="sm" disabled={!!busy || repo.mode === 'demo'} onClick={() => void download(f.id)}>{busy === 'facture' + f.id ? 'Ouverture…' : 'Télécharger (PDF)'}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
          <p className="muted small">Les factures sont aussi envoyées par e-mail à chaque paiement et restent consultables dans l’espace client Stripe.</p>
        </Section>
      )}
    </>
  );
}
