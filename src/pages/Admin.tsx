import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../data/store.tsx';
import { ACCESS_REASONS, STATUS_LABELS, type AdminUser, type AuditEntry, type Incident, type Lead, type LeadInput, type Plan, type StripeEventRow } from '../data/platform.ts';
import { describeError } from '../data/repo.ts';
import { date, dateTime, todayParis } from '../domain/format.ts';
import { Button, Checkbox, EmptyState, Modal, NotAvailable, NumberInput, PageHeader, Pill, Section, Select, Tabs, TextArea, TextInput, useConfirm } from '../ui/components.tsx';
import { planPrice } from './Subscription.tsx';
import { TIERS, tierDef, type TierCode } from '../domain/plans.ts';
import { MarketAdmin } from './MarketAdmin.tsx';

const TIER_OPTIONS = TIERS.map((t) => [t.code, t.label] as const);

type Tab = 'comptes' | 'offres' | 'acces' | 'marche' | 'incidents' | 'journal' | 'prospects';
const LEAD_STATUS: [Lead['status'], string][] = [['nouveau', 'Nouveau'], ['contacte', 'Contacté'], ['demo', 'Démonstration'], ['converti', 'Converti'], ['perdu', 'Perdu']];

export function AdminPage() {
  const { platform, refreshPlatform, repo, notify } = useStore();
  const [tab, setTab] = useState<Tab>('comptes');
  const run = useCallback(async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | null> => {
    try { const r = await fn(); if (ok) notify(ok); return r; } catch (e) { notify(describeError(e), 'error'); return null; }
  }, [notify]);

  if (platform === undefined) return <PageHeader title="Administration" subtitle="Chargement…" />;
  if (!platform?.access.is_admin) {
    return <><PageHeader title="Administration" /><NotAvailable>Rubrique réservée aux administrateurs de la plateforme.</NotAvailable></>;
  }
  const api = repo.platform.admin;
  return (
    <>
      <PageHeader title="Administration" subtitle="Comptes, offres, contrôle d’accès, incidents et journal. Aucune donnée immobilière des abonnés n’est visible ici." />
      <Tabs tabs={[['comptes', 'Comptes'], ['offres', 'Offres et tarifs'], ['acces', 'Application des formules'], ['marche', 'Données de marché'], ['incidents', 'Incidents'], ['journal', 'Journal'], ['prospects', 'Prospects commerciaux']]} value={tab} onChange={setTab} />
      {tab === 'comptes' && <Users run={run} api={api} />}
      {tab === 'offres' && <Plans plans={platform.plans} run={run} onSaved={refreshPlatform} api={api} />}
      {tab === 'acces' && <AccessConfig run={run} onSaved={refreshPlatform} api={api} />}
      {tab === 'marche' && <MarketAdmin run={run} />}
      {tab === 'incidents' && <Incidents run={run} api={api} />}
      {tab === 'journal' && <Journal run={run} api={api} />}
      {tab === 'prospects' && <Leads run={run} api={api} />}
    </>
  );
}

type Run = <T>(fn: () => Promise<T>, ok?: string) => Promise<T | null>;
type Api = ReturnType<typeof useStore>['repo']['platform']['admin'];

function useLoad<T>(load: () => Promise<T>, run: Run): [T | null, () => void] {
  const [v, setV] = useState<T | null>(null);
  const reload = useCallback(() => { void run(load).then(setV); }, [load, run]);
  useEffect(reload, [reload]);
  return [v, reload];
}

function Users({ run, api }: { run: Run; api: Api }) {
  const [users, reload] = useLoad(useCallback(() => api.users(), [api]), run);
  const [manual, setManual] = useState<AdminUser | null>(null);
  const [until, setUntil] = useState('');
  const [note, setNote] = useState('');
  const [tier, setTier] = useState<TierCode>('pro');
  const [invite, setInvite] = useState('');
  const [summary, setSummary] = useState<{ user: AdminUser; data: Record<string, number> } | null>(null);
  const [q, setQ] = useState('');
  const list = (users ?? []).filter((u) => !q || u.email.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <Section title="Inviter un utilisateur">
        <div className="row">
          <input aria-label="E-mail à inviter" type="email" value={invite} placeholder="adresse@exemple.fr" onChange={(e) => setInvite(e.target.value)} />
          <Button variant="primary" disabled={!invite.trim()} onClick={async () => { if (await run(() => api.invite(invite), `Invitation envoyée à ${invite}.`) !== null) setInvite(''); }}>Envoyer l’invitation</Button>
        </div>
        <p className="muted small">L’invité reçoit un lien et choisit lui-même son mot de passe : aucun mot de passe ne transite par e-mail.</p>
      </Section>
      <Section title={`Comptes (${users?.length ?? '…'})`} actions={<input aria-label="Rechercher un compte" placeholder="Rechercher un e-mail" value={q} onChange={(e) => setQ(e.target.value)} />}>
        {!users ? <p className="muted">Chargement…</p> : (
          <div className="dt-scroll"><table className="dt-table compact">
            <thead><tr><th>E-mail</th><th>Créé le</th><th>Dernière connexion</th><th>Formule</th><th>Abonnement</th><th>Accès</th><th>Support</th><th /></tr></thead>
            <tbody>{list.map((u) => (
              <tr key={u.user_id}>
                <td>{u.email}{u.is_admin && <Pill>admin</Pill>}</td>
                <td>{date(u.created_at)}</td>
                <td>{u.last_sign_in_at ? dateTime(u.last_sign_in_at) : '—'}</td>
                <td>{u.tier ? tierDef(u.tier).label : '—'}{u.fiscal_pack_until && new Date(u.fiscal_pack_until) > new Date() ? ' + pack fiscal' : ''}</td>
                <td>{STATUS_LABELS[u.status]}{u.source === 'manuel' ? ' (manuel)' : ''}{u.current_period_end ? ` · ${u.cancel_at_period_end ? 'fin' : 'échéance'} ${date(u.current_period_end)}` : ''}</td>
                <td><Pill tone={u.has_access ? 'ok' : 'bad'}>{ACCESS_REASONS[u.access_reason] ?? u.access_reason}</Pill></td>
                <td>{u.support_until ? <Button size="sm" onClick={async () => { const d = await run(() => api.supportSummary(u.user_id)); if (d) setSummary({ user: u, data: d }); }}>Consulter (jusqu’au {date(u.support_until)})</Button> : <span className="muted">non autorisé</span>}</td>
                <td>{!u.is_admin && <Button size="sm" onClick={() => { setManual(u); setUntil(''); setNote(''); setTier('pro'); }}>Accès manuel</Button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Section>
      <Modal open={!!manual} title={`Accès manuel — ${manual?.email ?? ''}`} onClose={() => setManual(null)}
        footer={<>
          <Button onClick={() => setManual(null)}>Annuler</Button>
          <Button variant="danger" onClick={async () => { if (await run(() => api.setManualAccess(manual!.user_id, null, note || 'Accès retiré'), 'Accès manuel retiré.') !== null) { setManual(null); reload(); } }}>Retirer</Button>
          <Button variant="primary" disabled={!until} onClick={async () => { if (await run(() => api.setManualAccess(manual!.user_id, new Date(`${until}T23:59:59`).toISOString(), note, tier), 'Accès accordé.') !== null) { setManual(null); reload(); } }}>Accorder</Button>
        </>}>
        <p>Formule offerte sans paiement (partenaire, geste commercial). Impossible pour un compte ayant un abonnement Stripe en cours. L’action est journalisée.</p>
        <div className="grid">
          <Select label="Formule offerte" value={tier} onChange={(v) => setTier(v ?? 'pro')} options={TIER_OPTIONS.filter(([c]) => c !== 'decouverte')} />
          <TextInput label="Jusqu’au" type="date" value={until} onChange={setUntil} />
          <TextInput label="Motif" value={note} onChange={setNote} maxLength={300} />
        </div>
      </Modal>
      <Modal open={!!summary} title={`Accès support — ${summary?.user.email ?? ''}`} onClose={() => setSummary(null)} footer={<Button onClick={() => setSummary(null)}>Fermer</Button>}>
        <p className="muted small">Résumé chiffré autorisé par l’abonné ; cette consultation est inscrite au journal.</p>
        <ul>{summary && Object.entries(summary.data).map(([k, v]) => <li key={k}>{k.replaceAll('_', ' ')} : <strong>{v}</strong></li>)}</ul>
      </Modal>
    </>
  );
}

const LEGACY_PLANS = ['mensuel', 'annuel'];

function Plans({ plans, run, onSaved, api }: { plans: Plan[]; run: Run; onSaved: () => Promise<void>; api: Api }) {
  // anciennes offres d'avant les formules : jamais affichées (supprimées en base si aucun abonnement ne s'y rattache)
  const [draft, setDraft] = useState<Record<string, Plan>>(() => Object.fromEntries(plans.filter((p) => !LEGACY_PLANS.includes(p.code)).map((p) => [p.code, { ...p }])));
  return (
    <Section title="Offres">
      <p className="muted">Dans Stripe, créez un produit par formule (Essentiel, Patrimoine, Pro) avec deux prix récurrents, mensuel et annuel, et un produit « Pack fiscal » avec un prix <strong>ponctuel</strong>. Collez ici chaque identifiant <code>price_…</code>. Le montant affiché doit correspondre au prix Stripe, qui seul fait foi pour le paiement. Les limites de chaque formule sont dans la table <code>plan_tiers</code> (SQL).</p>
      <div className="plans">
        {Object.values(draft).map((p) => (
          <div key={p.code} className="plan">
            <p className="muted small">{p.kind === 'option' ? 'Option (paiement ponctuel)' : p.tier ? `Formule ${tierDef(p.tier).label} · ${p.billing_interval === 'month' ? 'mensuel' : 'annuel'}` : ''}</p>
            <TextInput label="Libellé" value={p.label} onChange={(v) => setDraft((d) => ({ ...d, [p.code]: { ...p, label: v } }))} maxLength={80} />
            <NumberInput label={p.kind === 'option' ? 'Prix TTC (12 mois)' : `Prix TTC par ${p.billing_interval === 'month' ? 'mois' : 'an'}`} suffix="€" value={p.amount_cents / 100} onChange={(v) => setDraft((d) => ({ ...d, [p.code]: { ...p, amount_cents: Math.round((v ?? 0) * 100) } }))} />
            <TextInput label="Identifiant du prix Stripe" value={p.stripe_price_id ?? ''} onChange={(v) => setDraft((d) => ({ ...d, [p.code]: { ...p, stripe_price_id: v.trim() || null } }))} placeholder="price_…" />
            <Checkbox label="Offre ouverte aux abonnements" checked={p.active} onChange={(v) => setDraft((d) => ({ ...d, [p.code]: { ...p, active: v } }))} />
            <p className="muted small">Affiché : {planPrice(p)}</p>
            <Button variant="primary" onClick={async () => {
              if (p.active && (!p.stripe_price_id || !p.amount_cents)) { await run(async () => { throw new Error('Une offre ouverte doit avoir un prix et un identifiant Stripe.'); }); return; }
              if (await run(() => api.updatePlan(p.code, { label: p.label, amount_cents: p.amount_cents, stripe_price_id: p.stripe_price_id, active: p.active }), 'Offre enregistrée.') !== null) await onSaved();
            }}>Enregistrer</Button>
          </div>
        ))}
      </div>
    </Section>
  );
}

function AccessConfig({ run, onSaved, api }: { run: Run; onSaved: () => Promise<void>; api: Api }) {
  const { platform } = useStore();
  const c = platform?.config;
  const { ask, dialog } = useConfirm();
  const [enforce, setEnforce] = useState(c?.enforce_subscription ?? false);
  const [trial, setTrial] = useState<number | null>(c?.trial_days ?? 30);
  const [email, setEmail] = useState(c?.support_email ?? '');
  const [trialTier, setTrialTier] = useState<TierCode>(c?.trial_tier ?? 'decouverte');
  const [demoTier, setDemoTier] = useState<TierCode>(c?.demo_tier ?? 'pro');
  const demo = useStore().repo.mode === 'demo';
  return (
    <Section title="Application des formules">
      <Checkbox label="Appliquer les limites des formules" checked={enforce} onChange={setEnforce} />
      <p className="muted small">Désactivé (phase de lancement) : tout le monde dispose de toutes les fonctions. Activé : chaque compte a les limites de sa formule. Un nouveau compte dispose de l’offre Découverte (1 bien détenu, 5 en prospection) pendant la durée ci-dessous ; ensuite, sans abonnement ni accès manuel, il passe en consultation seule (données consultables et exportables, plus de modification). Les administrateurs ont toujours la formule Pro.</p>
      <div className="grid">
        <NumberInput label="Durée de l’offre Découverte" suffix="jours" value={trial} onChange={setTrial} hint="Comptée depuis la création du compte (30 jours annoncés sur le site)" />
        <Select label="Formule pendant cette période" value={trialTier} onChange={(v) => setTrialTier(v ?? 'decouverte')} options={TIER_OPTIONS} />
        <TextInput label="E-mail du support" type="email" value={email} onChange={setEmail} />
        {demo && <Select label="Formule simulée (démonstration)" value={demoTier} onChange={(v) => setDemoTier(v ?? 'pro')} options={TIER_OPTIONS} hint="Mode démonstration : formule appliquée au compte local quand les limites sont activées." />}
      </div>
      <Button variant="primary" onClick={async () => {
        const days = Math.round(trial ?? 0);
        if (days < 0 || days > 365) { await run(async () => { throw new Error('Essai entre 0 et 365 jours.'); }); return; }
        if (enforce && !c?.enforce_subscription && !(await ask('Appliquer les formules', 'Les comptes de moins de 30 jours auront les limites de l’offre Découverte ; les comptes plus anciens sans abonnement passeront immédiatement en consultation seule. Vérifiez d’abord que les offres sont ouvertes et que le webhook Stripe fonctionne.', 'Appliquer'))) return;
        if (await run(() => api.setConfig(enforce, days, email, trialTier, demoTier), 'Configuration enregistrée.') !== null) await onSaved();
      }}>Enregistrer</Button>
      {dialog}
    </Section>
  );
}

function Incidents({ run, api }: { run: Run; api: Api }) {
  const [list, reload] = useLoad(useCallback(() => api.incidents(), [api]), run);
  return (
    <Section title="Incidents" actions={<Button size="sm" onClick={reload}>Actualiser</Button>}>
      {!list ? <p className="muted">Chargement…</p> : list.length === 0 ? <EmptyState title="Aucun incident">E-mails en échec, tâches serveur en erreur et événements Stripe non traités apparaîtront ici.</EmptyState> : (
        <div className="dt-scroll"><table className="dt-table compact">
          <thead><tr><th>Date</th><th>Type</th><th>État</th><th>Détail</th></tr></thead>
          <tbody>{list.map((i: Incident, n) => <tr key={n}><td>{dateTime(i.at)}</td><td>{{ email: 'E-mail', tache: 'Tâche serveur', stripe: 'Stripe' }[i.kind]}</td><td>{i.status}</td><td className="wrap">{i.detail}</td></tr>)}</tbody>
        </table></div>
      )}
    </Section>
  );
}

function Journal({ run, api }: { run: Run; api: Api }) {
  const [audit] = useLoad(useCallback(() => api.audit(), [api]), run);
  const [events] = useLoad(useCallback(() => api.stripeEvents(), [api]), run);
  return (
    <>
      <Section title="Actions d’administration et accès support">
        {!audit?.length ? <p className="muted">Aucune action enregistrée.</p> : (
          <div className="dt-scroll"><table className="dt-table compact">
            <thead><tr><th>Date</th><th>Action</th><th>Détails</th></tr></thead>
            <tbody>{audit.map((a: AuditEntry) => <tr key={a.id}><td>{dateTime(a.at)}</td><td>{a.action.replaceAll('_', ' ')}</td><td className="wrap"><code>{JSON.stringify(a.details)}</code></td></tr>)}</tbody>
          </table></div>
        )}
      </Section>
      <Section title="Événements Stripe reçus">
        {!events?.length ? <p className="muted">Aucun événement reçu (webhook non configuré ou aucun paiement).</p> : (
          <div className="dt-scroll"><table className="dt-table compact">
            <thead><tr><th>Reçu le</th><th>Type</th><th>Traitement</th><th>Erreur</th></tr></thead>
            <tbody>{events.map((e: StripeEventRow) => <tr key={e.id}><td>{dateTime(e.received_at)}</td><td>{e.type}</td><td>{e.status}</td><td>{e.error ?? ''}</td></tr>)}</tbody>
          </table></div>
        )}
      </Section>
    </>
  );
}

const EMPTY_LEAD: LeadInput = { name: '', email: null, phone: null, source: null, status: 'nouveau', notes: null, next_follow_up: null };

function Leads({ run, api }: { run: Run; api: Api }) {
  const [list, reload] = useLoad(useCallback(() => api.leads(), [api]), run);
  const [edit, setEdit] = useState<{ id: string | null; v: LeadInput } | null>(null);
  const { ask, dialog } = useConfirm();
  const today = todayParis();
  return (
    <Section title="Prospects commerciaux" actions={<Button variant="primary" onClick={() => setEdit({ id: null, v: { ...EMPTY_LEAD } })}>Ajouter</Button>}>
      <p className="muted small">Personnes intéressées par Immo-Zen (salons, démonstrations, partenaires). Ces fiches sont séparées des contacts des abonnés.</p>
      {!list ? <p className="muted">Chargement…</p> : list.length === 0 ? <EmptyState title="Aucun prospect" /> : (
        <div className="dt-scroll"><table className="dt-table compact">
          <thead><tr><th>Nom</th><th>Contact</th><th>Origine</th><th>Statut</th><th>Relance</th><th /></tr></thead>
          <tbody>{list.map((l) => (
            <tr key={l.id}>
              <td><button type="button" className="link" onClick={() => setEdit({ id: l.id, v: { name: l.name, email: l.email, phone: l.phone, source: l.source, status: l.status, notes: l.notes, next_follow_up: l.next_follow_up } })}>{l.name}</button></td>
              <td>{[l.email, l.phone].filter(Boolean).join(' · ') || '—'}</td>
              <td>{l.source ?? '—'}</td>
              <td>{LEAD_STATUS.find(([k]) => k === l.status)?.[1]}</td>
              <td className={l.next_follow_up && l.next_follow_up <= today ? 'neg' : ''}>{date(l.next_follow_up)}</td>
              <td><Button size="sm" variant="ghost" onClick={async () => { if (await ask('Supprimer le prospect', `« ${l.name} » sera supprimé.`, 'Supprimer') && (await run(() => api.deleteLead(l.id), 'Prospect supprimé.')) !== null) reload(); }}>Supprimer</Button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <Modal open={!!edit} title={edit?.id ? 'Modifier le prospect' : 'Nouveau prospect'} onClose={() => setEdit(null)}
        footer={<><Button onClick={() => setEdit(null)}>Annuler</Button><Button variant="primary" disabled={!edit?.v.name.trim()} onClick={async () => {
          if (!edit) return;
          if (await run(() => api.saveLead(edit.id, { ...edit.v, name: edit.v.name.trim() }), 'Prospect enregistré.') !== null) { setEdit(null); reload(); }
        }}>Enregistrer</Button></>}>
        {edit && (
          <div className="grid">
            <TextInput label="Nom" required value={edit.v.name} onChange={(v) => setEdit({ ...edit, v: { ...edit.v, name: v } })} maxLength={200} />
            <TextInput label="E-mail" type="email" value={edit.v.email} onChange={(v) => setEdit({ ...edit, v: { ...edit.v, email: v || null } })} />
            <TextInput label="Téléphone" value={edit.v.phone} onChange={(v) => setEdit({ ...edit, v: { ...edit.v, phone: v || null } })} maxLength={40} />
            <TextInput label="Origine" value={edit.v.source} onChange={(v) => setEdit({ ...edit, v: { ...edit.v, source: v || null } })} maxLength={120} />
            <Select label="Statut" value={edit.v.status} onChange={(v) => setEdit({ ...edit, v: { ...edit.v, status: v ?? 'nouveau' } })} options={LEAD_STATUS} />
            <TextInput label="Date de relance" type="date" value={edit.v.next_follow_up} onChange={(v) => setEdit({ ...edit, v: { ...edit.v, next_follow_up: v || null } })} />
            <TextArea label="Notes" value={edit.v.notes} onChange={(v) => setEdit({ ...edit, v: { ...edit.v, notes: v || null } })} rows={3} />
          </div>
        )}
      </Modal>
      {dialog}
    </Section>
  );
}
