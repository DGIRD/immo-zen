import { useMemo, useState } from 'react';
import { useStore } from '../data/store.tsx';
import type { Channel, Insert, PropertyStatus, PropertyTask, Scenario, TimelineEvent } from '../data/types.ts';
import { date, dateTime, money, money2, number, pct, todayParis } from '../domain/format.ts';
import { CHANNEL_LABELS, EVENT_LABELS, OCCUPATION_LABELS, OWNERSHIP_LABELS, STATUS_LABELS, STATUS_ORDER, TAX_REGIME_LABELS, TYPE_LABELS } from '../domain/labels.ts';
import { ANNUAL_CHARGE_FIELDS, annualChargesTotal, dpeAlerts, isOwned, loanInfo, metrics, ownedCashflow, rentWithCharges, scenarioResult, primaryScenario } from '../domain/property.ts';
import { cfTitle } from './propertyShared.tsx';
import { EstimatePanel } from '../ui/EstimatePanel.tsx';
import { normalizeInputs, simulate, simulatedCashflow } from '../domain/simulator.ts';
import { Button, EmptyState, KeyValue, PageHeader, Section, StatusBadge, Tabs, TextInput, useConfirm } from '../ui/components.tsx';
import { href, navigate } from '../ui/router.ts';
import { usePropertyActions } from './useActions.tsx';
import { DocumentList } from './rental/Documents.tsx';
import { LeaseBadge } from './rental/common.tsx';
import { EXPENSE_CATEGORY_LABELS, leaseTenants, propertyRentalSummary, tenantName } from '../domain/rental.ts';

type Tab = 'synthese' | 'simulations' | 'historique' | 'taches' | 'documents' | 'gestion';

export function PropertyDetailPage({ id }: { id: string }) {
  const store = useStore();
  const { data, simulatorDefaults, update, remove, create, notify } = store;
  const { ask, dialog } = useConfirm();
  const actions = usePropertyActions(ask);
  const [tab, setTab] = useState<Tab>('synthese');
  const p = data.properties.find((x) => x.id === id);
  const m = useMemo(() => (p ? metrics(p, data.scenarios, simulatorDefaults) : null), [p, data.scenarios, simulatorDefaults]);
  if (!p || !m) {
    return <EmptyState title="Bien introuvable" action={<Button onClick={() => navigate('/prospection')}>Retour à la prospection</Button>}>Il a peut-être été supprimé sur un autre appareil.</EmptyState>;
  }
  const owned = isOwned(p);
  const agency = data.contacts.find((c) => c.id === p.agency_id);
  const agent = data.contacts.find((c) => c.id === p.agent_id);
  const scenarios = data.scenarios.filter((s) => s.property_id === p.id);
  const events = data.events.filter((e) => e.property_id === p.id).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const tasks = data.tasks.filter((t) => t.property_id === p.id);
  const openTasks = tasks.filter((t) => !t.done_at).length;
  const r = m.result;
  const today = todayParis();
  const cf = owned ? ownedCashflow(p, propertyRentalSummary(p.id, Number(today.slice(0, 4)), today, data).activeLeases, r, today) : null;
  const loan = owned ? loanInfo(p, today) : null;

  const tabs: [Tab, string][] = [
    ['synthese', 'Synthèse'],
    ...(owned ? [] : [['simulations', 'Simulation'] as [Tab, string]]),
    ['historique', `Historique et échanges (${events.length})`],
    ['taches', `Tâches (${openTasks})`],
    ['documents', 'Photos et documents'],
    ...(owned ? [['gestion', 'Baux, loyers, dépenses'] as [Tab, string]] : []),
  ];

  return (
    <>
      <p className="crumbs"><a href={href(owned ? '/biens' : '/prospection')}>{owned ? 'Mes biens' : 'Prospection'}</a></p>
      <PageHeader
        title={p.title}
        subtitle={<>{[TYPE_LABELS[p.property_type], p.surface ? `${number(p.surface)} m²` : null, p.rooms ? `${p.rooms} pièces` : null, [p.zip, p.city].filter(Boolean).join(' ') || null].filter(Boolean).join(', ')}</>}
        actions={<>
          {owned
            ? <Button onClick={() => navigate(`/bien/${p.id}/modifier`)}>Modifier</Button>
            : <Button onClick={() => navigate(`/bien/${p.id}/modifier`)}>Modifier la fiche et la simulation</Button>}
          {!owned && p.status !== 'archive' && <Button variant="primary" onClick={() => void actions.setStatus(p, 'acquis')}>Marquer comme acquis</Button>}
          <details className="menu menu-right">
            <summary className="btn btn-secondary">Plus</summary>
            <div className="menu-list">
              <button type="button" onClick={() => void actions.dup(p)}>Dupliquer</button>
              {!owned && <button type="button" onClick={() => void actions.toggleArchive(p)}>{p.status === 'archive' ? 'Désarchiver' : 'Archiver'}</button>}
              {owned && <button type="button" onClick={() => void actions.setStatus(p, 'sous_compromis')}>Revenir en prospection</button>}
              <button type="button" className="danger" onClick={async () => { if (await actions.del(p)) navigate(owned ? '/biens' : '/prospection'); }}>Supprimer</button>
            </div>
          </details>
        </>}
      />

      <div className="status-line">
        <StatusBadge status={p.status} />
        {owned && p.occupation_status && <span className="pill pill-neutral">{OCCUPATION_LABELS[p.occupation_status]}</span>}
        {!owned && (
          <label className="inline-select">Changer le statut
            <select value={p.status} onChange={(e) => void actions.setStatus(p, e.target.value as PropertyStatus)}>
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </label>
        )}
        {p.listing_url && <a href={p.listing_url} target="_blank" rel="noopener noreferrer">Voir l’annonce</a>}
      </div>

      <div className="figures">
        {owned ? (
          <Figure label="Estimation du prix actuel" value={p.estimate_low != null && p.estimate_high != null ? `${money(p.estimate_low)} – ${money(p.estimate_high)}` : '—'}
            hint={p.estimate_source ?? 'Fiche du bien → Modifier'} />
        ) : (
          <>
            <Figure label="Prix de présentation FAI" value={money(p.asking_price)} />
            <Figure label="Prix proposé" value={money(p.offer_price)} hint={r?.negotiationAmount != null ? `négociation ${money(r.negotiationAmount)} (${pct(r.negotiationPct)})` : undefined} />
            <Figure label="Estimation DVF" value={p.estimate_low != null && p.estimate_high != null ? `${money(p.estimate_low)} – ${money(p.estimate_high)}` : '—'} />
          </>
        )}
        <Figure label="Rendement brut" value={pct(r?.grossYield)} />
        {owned
          ? <Figure label="Cash-flow / mois" value={money(cf?.monthly)} tone={cf ? (cf.monthly >= 0 ? 'pos' : 'neg') : undefined} hint={cfTitle(cf)} />
          : <Figure label="Cash-flow / mois" value={money(simulatedCashflow(r))} tone={simulatedCashflow(r) === null ? undefined : simulatedCashflow(r)! >= 0 ? 'pos' : 'neg'} hint={r && simulatedCashflow(r) === null ? 'renseignez le loyer au m²' : 'avant fiscalité, année 1'} />}
      </div>

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'synthese' && (
        <div className="two-col">
          <Section title="Caractéristiques">
            <KeyValue items={[
              ['Adresse', [p.address, p.zip, p.city].filter(Boolean).join(' ') || '—'],
              ['DPE renseigné', p.dpe ?? 'Non renseigné'],
              ...(owned ? [
                ['Loyer hors charges', p.estimated_rent != null ? `${money2(p.estimated_rent)} / mois` : '—'],
                ['Provision sur charges', p.charges_provision != null ? `${money2(p.charges_provision)} / mois` : '—'],
                ['Loyer charges comprises', rentWithCharges(p) != null ? `${money2(rentWithCharges(p))} / mois` : '—'],
                ...ANNUAL_CHARGE_FIELDS.filter(([k]) => p[k] != null).map(([k, label]) => [`${label}`, `${money2(p[k]!)} / an`] as [string, string]),
                ...(annualChargesTotal(p) != null ? [['Total des charges', `${money2(annualChargesTotal(p))} / an`] as [string, string]] : []),
                ...(loan ? [
                  ['Crédit', `${money(p.loan_amount ?? null)}${p.loan_rate != null ? ` à ${String(p.loan_rate).replace('.', ',')} %` : ''}${p.loan_years ? ` sur ${String(p.loan_years).replace('.', ',')} ans` : ''}`],
                  ['Mensualité de crédit', loan.finished ? 'Crédit remboursé' : `${money2(loan.payment + loan.insurance)} / mois (dont assurance ${money2(loan.insurance)})`],
                  ...(loan.remaining != null ? [['Capital restant dû', `${money2(loan.remaining)}${loan.endDate ? ` (fin le ${date(loan.endDate)})` : ''}`]] : []),
                ] as [string, string][] : [['Crédit', 'Non renseigné']] as [string, string][]),
              ] as [string, string][] : [
                ['Surface du logement', p.surface ? `${number(p.surface)} m²` : '—'],
                ['Travaux', money(p.works_budget)],
                ['Loyer hors charges', p.estimated_rent ? `${money(p.estimated_rent)} / mois` : '—'],
              ] as [string, string][]),
              ['Agence', agency ? <a href={href(`/contacts/${agency.id}`)}>{agency.name}</a> : '—'],
              ['Agent', agent ? <a href={href(`/contacts/${agent.id}`)}>{agent.name}</a> : '—'],
              ...(owned ? [
                ['Mode de détention', p.ownership_mode ? OWNERSHIP_LABELS[p.ownership_mode] : 'Non renseigné'],
                ['Régime fiscal renseigné', p.tax_regime ? TAX_REGIME_LABELS[p.tax_regime] : 'Non renseigné'],
                ['Acquis le', date(p.acquired_at)],
                ['Coût d’acquisition', money(p.acquisition_cost ?? p.acquisition_snapshot?.results?.totalCost ?? null)],
              ] as [string, string][] : [
                ['Prochaine action', p.next_action ?? '—'],
                ['Relance', p.follow_up_date ? <span className={p.follow_up_date <= todayParis() ? 'neg' : ''}>{date(p.follow_up_date)}</span> : '—'],
                ['Visite', dateTime(p.visit_at)],
              ] as [string, React.ReactNode][]),
              ...(p.legacy_ref ? [['Origine', `Reprise de l’ancienne version (${p.legacy_ref})`] as [string, string]] : []),
            ]} />
          </Section>
          <div>
            {(p.vigilance.length > 0 || dpeAlerts(p.dpe, todayParis()).length > 0) && (
              <Section title="Éléments de vigilance" className="vigilance">
                <ul>
                  {dpeAlerts(p.dpe, todayParis()).map((v, i) => <li key={`dpe${i}`} className="auto">{v}</li>)}
                  {p.vigilance.map((v, i) => <li key={i}>{v}</li>)}
                </ul>
              </Section>
            )}
            <Section title={owned ? 'Estimation du prix actuel' : 'Estimation DVF'}>
              <EstimatePanel value={p} input={p} onChange={async (patch) => { await update('properties', p, patch, `Le bien « ${p.title} »`); }}
                compareTo={owned ? (p.acquisition_cost ?? p.acquisition_snapshot?.results?.totalCost ?? null) : (r?.offerFai ?? p.offer_price)}
                compareLabel={owned ? 'Coût d’acquisition' : 'Prix proposé (frais d’agence inclus)'} />
            </Section>
            <Section title="Commentaires">
              {p.comments ? <p className="prewrap">{p.comments}</p> : <p className="muted">Aucun commentaire.</p>}
            </Section>
            {owned && p.acquisition_snapshot && (
              <Section title="Photographie à l’acquisition">
                <p className="muted small">Hypothèses figées le {dateTime(p.acquisition_snapshot.taken_at)} depuis « {p.acquisition_snapshot.scenario_name} ». Elles ne changent plus si le scénario est modifié.</p>
                <SnapshotFigures inputs={p.acquisition_snapshot.inputs} />
              </Section>
            )}
          </div>
        </div>
      )}

      {tab === 'simulations' && <SimulationPanel propertyId={p.id} main={primaryScenario(p, scenarios) ?? undefined} scenarios={scenarios}
        onUse={async (s) => { await update('properties', p, { primary_scenario_id: s.id }, `Le bien « ${p.title} »`); notify('Simulation du bien remplacée.'); }}
        onDelete={async (s) => { if (await ask('Supprimer l’ancienne simulation', `« ${s.name} » sera supprimée. La simulation du bien n’est pas modifiée.`, 'Supprimer')) await remove('scenarios', s.id); }}
      />}

      {tab === 'historique' && <Timeline propertyId={p.id} events={events} />}
      {tab === 'taches' && <Tasks propertyId={p.id} tasks={tasks} />}
      {tab === 'documents' && <DocumentList filter={{ property_id: p.id }} />}
      {tab === 'gestion' && <PropertyRental propertyId={p.id} />}
      {dialog}
    </>
  );
}

function Figure({ label, value, tone, hint }: { label: string; value: string; tone?: 'pos' | 'neg'; hint?: string }) {
  return (
    <div className="figure">
      <span className="figure-label">{label}</span>
      <span className={`figure-value ${tone ?? ''}`}>{value}</span>
      {hint && <span className="figure-hint">{hint}</span>}
    </div>
  );
}

function SnapshotFigures({ inputs }: { inputs: Scenario['inputs'] }) {
  const out = simulate(normalizeInputs(inputs));
  if (!out.ok) return <p className="muted">Hypothèses incomplètes.</p>;
  const r = out.result;
  return <KeyValue items={[
    ['Coût total', money(r.totalCost)], ['Emprunt', money(r.loanAmount)], ['Mensualité', money(r.monthlyPaymentWithInsurance)],
    ['Loyer mensuel', money(r.annualRent / 12)], ['Rendement brut', pct(r.grossYield)], ['Cash-flow / mois', money(simulatedCashflow(r))],
  ]} />;
}

/** Simulation unique du bien ; les simulations enregistrées avant ce fonctionnement restent consultables. */
function SimulationPanel({ propertyId, main, scenarios, onUse, onDelete }: {
  propertyId: string; main: Scenario | undefined; scenarios: Scenario[]; onUse: (s: Scenario) => void; onDelete: (s: Scenario) => void;
}) {
  const others = scenarios.filter((s) => s.id !== main?.id && !s.archived_at);
  const r = main ? scenarioResult(main) : null;
  return (
    <>
      <Section title="Simulation" actions={<Button variant="primary" size="sm" onClick={() => navigate(`/bien/${propertyId}/modifier`)}>{main ? 'Modifier la simulation' : 'Créer la simulation'}</Button>}>
        {!main ? <EmptyState title="Aucune simulation">Renseignez prix, financement, loyer et charges pour estimer le coût, le crédit, le rendement et le cash-flow de ce bien.</EmptyState>
          : r ? <KeyValue items={[
            ['Coût total', money(r.totalCost)], ['Emprunt', money(r.loanAmount)], ['Mensualité', money(r.monthlyPaymentWithInsurance)],
            ['Rendement brut', pct(r.grossYield)], ['Cash-flow / mois', money(simulatedCashflow(r))], ['Mise à jour', date(main.updated_at)],
          ]} />
          : <p className="muted">Hypothèses invalides : ouvrez la simulation pour les corriger.</p>}
        <p className="muted small">Une seule simulation par bien : modifiez-la autant que vous le souhaitez, elle met à jour la fiche (prix, surface, travaux, loyer).</p>
      </Section>
      {others.length > 0 && (
        <Section title={`Anciennes simulations (${others.length})`}>
          <p className="muted small">Enregistrées quand plusieurs simulations par bien étaient possibles. Elles ne sont plus utilisées : reprenez-en une comme simulation du bien, ou supprimez-les.</p>
          <ul className="scenario-list">
            {others.map((s) => {
              const x = scenarioResult(s);
              return (
                <li key={s.id}>
                  <div>
                    <strong>{s.name}</strong>
                    <p className="muted small">{x ? `Coût ${money(x.totalCost)}, mensualité ${money(x.monthlyPaymentWithInsurance)}, rendement ${pct(x.grossYield)}, cash-flow ${money(simulatedCashflow(x))}/mois` : 'Hypothèses invalides.'}</p>
                  </div>
                  <div className="row">
                    <Button size="sm" onClick={() => onUse(s)}>Utiliser comme simulation du bien</Button>
                    <Button size="sm" variant="ghost" onClick={() => onDelete(s)}>Supprimer</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </>
  );
}

function Timeline({ propertyId, events }: { propertyId: string; events: TimelineEvent[] }) {
  const { create, remove, data } = useStore();
  const [summary, setSummary] = useState('');
  const [channel, setChannel] = useState<Channel>('telephone');
  const [contactId, setContactId] = useState('');
  const [when, setWhen] = useState('');
  const contacts = data.contacts.filter((c) => !c.archived_at);
  async function add() {
    if (!summary.trim()) return;
    const row: Insert<TimelineEvent> = {
      property_id: propertyId, kind: 'exchange', channel, summary: summary.trim(), contact_id: contactId || null,
      occurred_at: when ? new Date(when).toISOString() : new Date().toISOString(),
    };
    if (await create('timeline_events', row)) { setSummary(''); setWhen(''); }
  }
  return (
    <Section title="Historique et échanges">
      <div className="exchange-form">
        <label className="inline-select">Canal
          <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
            {(Object.keys(CHANNEL_LABELS) as Channel[]).map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
          </select>
        </label>
        <label className="inline-select">Avec
          <select value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">—</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="inline-select">Le
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
        <textarea aria-label="Compte rendu de l’échange" rows={2} placeholder="Compte rendu : ce qui a été dit, ce qui a été promis…" value={summary} onChange={(e) => setSummary(e.target.value)} />
        <Button variant="primary" size="sm" disabled={!summary.trim()} onClick={() => void add()}>Ajouter l’échange</Button>
      </div>
      {events.length === 0 ? <p className="muted">Aucun événement.</p> : (
        <ol className="timeline">
          {events.map((e) => {
            const who = e.contact_id ? data.contacts.find((c) => c.id === e.contact_id) : null;
            const d = e.data as { from?: PropertyStatus; to?: PropertyStatus };
            return (
              <li key={e.id} className={`tl-${e.kind}`}>
                <time dateTime={e.occurred_at}>{dateTime(e.occurred_at)}</time>
                <div>
                  <span className="tl-kind">{EVENT_LABELS[e.kind]}{e.channel ? `, ${CHANNEL_LABELS[e.channel].toLowerCase()}` : ''}{who ? `, avec ${who.name}` : ''}</span>
                  <p className="prewrap">{e.summary}{d.from && d.to ? ` : ${STATUS_LABELS[d.from]} → ${STATUS_LABELS[d.to]}` : ''}</p>
                </div>
                {['exchange', 'note', 'visit'].includes(e.kind) && <button type="button" className="link danger" onClick={() => void remove('timeline_events', e.id)}>Supprimer</button>}
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}

function Tasks({ propertyId, tasks }: { propertyId: string; tasks: PropertyTask[] }) {
  const { create, update, remove } = useStore();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const today = todayParis();
  const sorted = [...tasks].sort((a, b) => Number(!!a.done_at) - Number(!!b.done_at) || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
  return (
    <Section title="Tâches">
      <div className="row task-form">
        <TextInput label="Nouvelle tâche" value={title} onChange={setTitle} maxLength={300} placeholder="Ex. Demander le diagnostic amiante" />
        <TextInput label="Échéance" type="date" value={due} onChange={setDue} />
        <Button variant="primary" size="sm" disabled={!title.trim()} onClick={async () => {
          if (await create('property_tasks', { property_id: propertyId, title: title.trim(), due_date: due || null })) { setTitle(''); setDue(''); }
        }}>Ajouter</Button>
      </div>
      {sorted.length === 0 ? <p className="muted">Aucune tâche.</p> : (
        <ul className="tasks">
          {sorted.map((t) => (
            <li key={t.id} className={t.done_at ? 'done' : ''}>
              <label className="checkbox">
                <input type="checkbox" checked={!!t.done_at} onChange={(e) => void update('property_tasks', t, { done_at: e.target.checked ? new Date().toISOString() : null }, 'La tâche')} />
                <span>{t.title}</span>
              </label>
              {t.due_date && <span className={!t.done_at && t.due_date < today ? 'neg small' : 'muted small'}>{date(t.due_date)}</span>}
              <button type="button" className="link danger" onClick={() => void remove('property_tasks', t.id)}>Supprimer</button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function PropertyRental({ propertyId }: { propertyId: string }) {
  const { data } = useStore();
  const today = todayParis();
  const year = today.slice(0, 4);
  const rs = propertyRentalSummary(propertyId, Number(year), today, { leases: data.leases, leaseTenants: data.leaseTenants, tenants: data.tenants, charges: data.charges, payments: data.payments, allocations: data.allocations, expenses: data.expenses });
  const leases = data.leases.filter((l) => l.property_id === propertyId).sort((a, b) => b.start_date.localeCompare(a.start_date));
  const expenses = data.expenses.filter((e) => e.property_id === propertyId).sort((a, b) => b.expense_date.localeCompare(a.expense_date)).slice(0, 8);
  return (
    <>
      <div className="figures">
        <Figure label={`Loyers encaissés ${year}`} value={money(rs.received)} />
        <Figure label={`Dépenses payées ${year}`} value={money(rs.expensesPaid)} />
        <Figure label={`Cash-flow réel ${year}`} value={money(rs.cashflow)} tone={rs.cashflow >= 0 ? 'pos' : 'neg'} hint="avant impôts, hors dépôt de garantie" />
        <Figure label="Solde locatif" value={money(rs.balance)} tone={rs.overdue ? 'neg' : undefined} hint={rs.overdue ? `dont impayé échu ${money(rs.overdue)}` : 'à jour'} />
      </div>
      <div className="two-col">
        <Section title="Baux" actions={<Button size="sm" variant="primary" onClick={() => navigate(`/baux/nouveau?bien=${propertyId}`)}>Nouveau bail</Button>}>
          {leases.length === 0 ? <p className="muted">Aucun bail. Le bien est considéré comme non loué.</p> : (
            <ul className="scenario-list">{leases.map((l) => (
              <li key={l.id}>
                <div>
                  <a className="strong" href={href(`/baux/${l.id}`)}>{leaseTenants(l.id, data.leaseTenants, data.tenants, false).map(tenantName).join(', ') || 'Sans titulaire'}</a>{' '}<LeaseBadge lease={l} />
                  <p className="muted small">Du {date(l.start_date)}{l.end_date ? ` au ${date(l.end_date)}` : ''}, {money(l.rent_hc + l.charges_amount)} charges comprises</p>
                </div>
              </li>
            ))}</ul>
          )}
        </Section>
        <Section title="Dernières dépenses" actions={<Button size="sm" onClick={() => navigate(`/depenses?bien=${propertyId}`)}>Voir et ajouter</Button>}>
          {expenses.length === 0 ? <p className="muted">Aucune dépense.</p> : (
            <ul className="plain">{expenses.map((e) => (
              <li key={e.id}>{date(e.expense_date)}, {EXPENSE_CATEGORY_LABELS[e.category]}{e.supplier ? ` (${e.supplier})` : ''} : <strong>{money(e.amount)}</strong>{e.payment_status === 'a_payer' ? ' à payer' : ''}</li>
            ))}</ul>
          )}
        </Section>
      </div>
    </>
  );
}
