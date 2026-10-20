import { useMemo } from 'react';
import { usePlan, useStore } from '../data/store.tsx';
import type { PropertyStatus } from '../data/types.ts';
import { date, dateTime, money, todayParis } from '../domain/format.ts';
import { STATUS_LABELS, statusTone } from '../domain/labels.ts';
import { isOwned, metrics, ownedCashflow } from '../domain/property.ts';
import { revisionPlan } from '../domain/irl.ts';
import { chargeViews, propertyRentalSummary } from '../domain/rental.ts';
import { Button, EmptyState, PageHeader, Section } from '../ui/components.tsx';
import { href, navigate } from '../ui/router.ts';

const PIPELINE: PropertyStatus[] = ['repere', 'a_contacter', 'informations_demandees', 'visite_a_programmer', 'visite_programmee', 'visite', 'offre_envisagee', 'offre_transmise', 'negociation', 'offre_acceptee', 'sous_compromis'];

export function DashboardPage() {
  const { data, simulatorDefaults } = useStore();
  const consolidated = usePlan().features.consolidated;
  const today = todayParis();
  const in7 = todayParis(new Date(Date.now() + 7 * 86400000));

  const v = useMemo(() => {
    const prospects = data.properties.filter((p) => !isOwned(p) && PIPELINE.includes(p.status));
    const owned = data.properties.filter(isOwned);
    const counts = PIPELINE.map((s) => [s, prospects.filter((p) => p.status === s).length] as const).filter(([, n]) => n > 0);
    const followUps = data.properties.filter((p) => p.follow_up_date && p.follow_up_date <= today && p.status !== 'archive' && !isOwned(p))
      .sort((a, b) => a.follow_up_date!.localeCompare(b.follow_up_date!));
    const visits = data.properties.filter((p) => p.visit_at && p.visit_at.slice(0, 10) >= today && p.visit_at.slice(0, 10) <= in7)
      .sort((a, b) => a.visit_at!.localeCompare(b.visit_at!));
    const tasks = data.tasks.filter((t) => !t.done_at && t.due_date && t.due_date <= in7).sort((a, b) => a.due_date!.localeCompare(b.due_date!));
    const contactFollow = data.contacts.filter((c) => !c.archived_at && c.next_follow_up && c.next_follow_up <= today);
    // Cash-flow prévisionnel : loyer charges comprises − charges annuelles / 12 − crédit, par bien détenu
    const rental = { leases: data.leases, leaseTenants: data.leaseTenants, tenants: data.tenants, charges: data.charges, payments: data.payments, allocations: data.allocations, expenses: data.expenses };
    const flows = owned.map((p) => {
      const rs = propertyRentalSummary(p.id, Number(today.slice(0, 4)), today, rental);
      return { p, rs, cf: ownedCashflow(p, rs.activeLeases, metrics(p, data.scenarios, simulatorDefaults).result, today) };
    });
    const known = flows.filter((f) => f.cf);
    const ownedCash = Math.round(known.reduce((a, f) => a + f.cf!.monthly, 0) * 100) / 100;
    const ownedRent = flows.reduce((a, f) => a + (f.rs.activeLeases.length ? f.rs.activeLeases.reduce((x, l) => x + l.rent_hc, 0) : f.p.estimated_rent ?? 0), 0);
    const cashUnknown = owned.length - known.length;
    const offers = prospects.filter((p) => ['offre_transmise', 'negociation', 'offre_acceptee', 'sous_compromis'].includes(p.status)).length;
    const views = chargeViews(data.charges, data.allocations, today);
    const overdue = views.filter((v) => v.overdue);
    const overdueSum = overdue.reduce((a, v) => a + v.remaining, 0);
    const toReceipt = views.filter((v) => v.status === 'payee' && !v.charge.cancelled_at && !data.receipts.some((r) => r.charge_id === v.charge.id && r.kind === 'quittance' && !r.cancelled_at)).length;
    const drafts = data.reminders.filter((r) => r.status === 'brouillon');
    const y = today.slice(0, 4);
    const received = data.payments.filter((p) => p.paid_on.startsWith(y)).reduce((a, p) => a + p.amount, 0);
    const expensesToPay = data.expenses.filter((e) => e.payment_status === 'a_payer');
    const leaseTitle = (leaseId: string) => {
      const l = data.leases.find((x) => x.id === leaseId);
      return data.properties.find((p) => p.id === l?.property_id)?.title ?? 'Bail';
    };
    const revisions = data.leases.filter((l) => l.irl_enabled && !revisionPlan(l, today, data.properties.find((p) => p.id === l.property_id)?.dpe ?? null).block);
    return { revisions, cashUnknown, prospects, owned, counts, followUps, visits, tasks, contactFollow, ownedCash, ownedRent, offers, overdue, overdueSum, toReceipt, drafts, received, expensesToPay, leaseTitle };
  }, [data, today, in7, simulatorDefaults]);

  const max = Math.max(1, ...v.counts.map(([, n]) => n));
  const empty = data.properties.length === 0;

  return (
    <>
      <PageHeader title="Tableau de bord" subtitle={new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' })} />
      {empty ? (
        <EmptyState title="Commencez par un premier bien"
          action={<div className="row"><Button variant="primary" onClick={() => navigate('/simulateur')}>Ajouter un bien en prospection</Button></div>}>
          Repérez une annonce, lancez une simulation, puis suivez vos échanges jusqu’à l’acquisition. Vous aviez des simulations dans l’ancienne version ? Voir Paramètres.
        </EmptyState>
      ) : (
        <>
          <div className="figures">
            <a className="figure link-figure" href={href('/prospection')}><span className="figure-label">En prospection</span><span className="figure-value">{v.prospects.length}</span><span className="figure-hint">dont {v.offers} offre{v.offers > 1 ? 's' : ''} en cours</span></a>
            <a className="figure link-figure" href={href('/prospection')}><span className="figure-label">Relances à faire</span><span className={`figure-value ${v.followUps.length ? 'neg' : ''}`}>{v.followUps.length + v.contactFollow.length}</span><span className="figure-hint">biens et contacts</span></a>
            <a className="figure link-figure" href={href('/biens')}><span className="figure-label">Biens détenus</span><span className="figure-value">{v.owned.length}</span><span className="figure-hint">loyers estimés {money(v.ownedRent)} / mois</span></a>
            {consolidated ? (
            <a className="figure link-figure" href={href('/biens')}><span className="figure-label">Cash-flow prévisionnel</span>
              <span className={`figure-value ${v.owned.length === v.cashUnknown ? '' : v.ownedCash >= 0 ? 'pos' : 'neg'}`}>{v.owned.length === v.cashUnknown ? '—' : money(v.ownedCash)}</span>
              <span className="figure-hint">{v.owned.length === 0 ? 'aucun bien détenu' : v.cashUnknown ? `par mois ; ${v.cashUnknown} bien(s) sans loyer, charges ni crédit renseignés` : 'par mois : loyers − charges − crédits, avant impôts'}</span></a>
            ) : (
            <a className="figure link-figure" href={href('/abonnement')}><span className="figure-label">Cash-flow consolidé</span>
              <span className="figure-value">—</span>
              <span className="figure-hint">à partir de la formule Patrimoine ; le cash-flow de chaque bien reste visible dans Mes biens</span></a>
            )}
          </div>

          {data.leases.length > 0 && (
            <div className="figures">
              <a className="figure link-figure" href={href('/loyers')}><span className="figure-label">Loyers impayés échus</span><span className={`figure-value ${v.overdue.length ? 'neg' : ''}`}>{money(v.overdueSum)}</span><span className="figure-hint">{v.overdue.length} échéance(s) à confirmer ou relancer</span></a>
              <a className="figure link-figure" href={href('/loyers')}><span className="figure-label">Quittances à émettre</span><span className="figure-value">{v.toReceipt}</span><span className="figure-hint">périodes intégralement réglées</span></a>
              <a className="figure link-figure" href={href('/locataires')}><span className="figure-label">Relances à valider</span><span className={`figure-value ${v.drafts.length ? 'neg' : ''}`}>{v.drafts.length}</span><span className="figure-hint">rien n’est envoyé sans vous</span></a>
              <a className="figure link-figure" href={href('/loyers')}><span className="figure-label">Loyers encaissés {today.slice(0, 4)}</span><span className="figure-value">{money(v.received)}</span><span className="figure-hint">dépenses à payer : {v.expensesToPay.length}</span></a>
            </div>
          )}

          <div className="two-col">
            <Section title="À faire">
              {v.followUps.length + v.visits.length + v.tasks.length + v.contactFollow.length + v.overdue.length + v.drafts.length + v.revisions.length === 0 ? <p className="muted">Rien d’urgent cette semaine.</p> : (
                <ul className="agenda">
                  {v.overdue.map((c) => <li key={`o${c.charge.id}`}><span className="neg">{date(c.charge.due_date)}</span><a href={href(`/baux/${c.charge.lease_id}`)}>Loyer non confirmé : {v.leaseTitle(c.charge.lease_id)}</a><span className="muted">reste {money(c.remaining)}</span></li>)}
                  {v.revisions.map((l) => <li key={`r${l.id}`}><span>IRL</span><a href={href(`/baux/${l.id}`)}>Révision du loyer possible : {v.leaseTitle(l.id)}</a></li>)}
                  {v.drafts.map((r) => <li key={`d${r.id}`}><span>{date(r.created_at)}</span><a href={href(`/baux/${r.lease_id}`)}>Relance à valider : {v.leaseTitle(r.lease_id)}</a></li>)}
                  {v.followUps.map((p) => <li key={`f${p.id}`}><span className={p.follow_up_date! < today ? 'neg' : ''}>{date(p.follow_up_date)}</span><a href={href(`/bien/${p.id}`)}>Relancer : {p.title}</a>{p.next_action && <span className="muted">{p.next_action}</span>}</li>)}
                  {v.contactFollow.map((c) => <li key={`c${c.id}`}><span className={c.next_follow_up! < today ? 'neg' : ''}>{date(c.next_follow_up)}</span><a href={href(`/contacts/${c.id}`)}>Relancer : {c.name}</a></li>)}
                  {v.visits.map((p) => <li key={`v${p.id}`}><span>{dateTime(p.visit_at)}</span><a href={href(`/bien/${p.id}`)}>Visite : {p.title}</a></li>)}
                  {v.tasks.map((t) => {
                    const p = data.properties.find((x) => x.id === t.property_id);
                    return <li key={`t${t.id}`}><span className={t.due_date! < today ? 'neg' : ''}>{date(t.due_date)}</span><a href={href(`/bien/${t.property_id}`)}>{t.title}</a>{p && <span className="muted">{p.title}</span>}</li>;
                  })}
                </ul>
              )}
            </Section>
            <Section title="Parcours de prospection">
              {v.counts.length === 0 ? <p className="muted">Aucun bien en cours.</p> : (
                <ul className="pipeline">
                  {v.counts.map(([s, n]) => (
                    <li key={s}>
                      <a href={href(`/prospection?statut=${s}`)} title={`Voir les biens « ${STATUS_LABELS[s]} »`}>
                        <span>{STATUS_LABELS[s]}</span>
                        <span className={`bar tone-${statusTone(s)}`} style={{ width: `${(n / max) * 100}%` }} aria-hidden="true" />
                        <strong>{n}</strong>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </>
      )}
    </>
  );
}
