import { useMemo, useState } from 'react';
import { useStore } from '../../data/store.tsx';
import type { DepositMovement, Payment, Receipt, Reminder, RentCharge } from '../../data/types.ts';
import { date, dateTime, money2, todayParis } from '../../domain/format.ts';
import {
  autoAllocate, chargeTotal, DEFAULT_REMINDER_TEMPLATES, leaseLedger, leaseTenants, monthLabel, PAYMENT_METHOD_LABELS, renderTemplate, tenantName,
  type ChargeView,
} from '../../domain/rental.ts';
import { round2 } from '../../domain/simulator.ts';
import { Button, EmptyState, KeyValue, Modal, NumberInput, PageHeader, Section, Select, Tabs, TextArea, TextInput, useConfirm } from '../../ui/components.tsx';
import { href, navigate } from '../../ui/router.ts';
import { DocumentList } from './Documents.tsx';
import { AccessPill, useTenantAccess } from './TenantAccess.tsx';
import { IRL_VALUES, irlLabel, revisionPlan } from '../../domain/irl.ts';
import { ChargeActions, ChargeBadge, LeaseBadge, PaymentDialog, paymentAllocated, periodLabel, ReceiptDialog, sendLabel, useRental } from './common.tsx';

type Tab = 'echeances' | 'paiements' | 'quittances' | 'relances' | 'depot' | 'titulaires' | 'documents';

export function LeaseDetailPage({ id }: { id: string }) {
  const store = useStore();
  const { data } = store;
  const { views, propertyById } = useRental();
  const today = todayParis();
  const [tab, setTab] = useState<Tab>('echeances');
  const [pay, setPay] = useState<{ chargeId?: string; mode: 'saisie' | 'confirmation' } | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [chargeForm, setChargeForm] = useState(false);
  const { ask, dialog } = useConfirm();
  const lease = data.leases.find((l) => l.id === id);
  if (!lease) return <EmptyState title="Bail introuvable" action={<Button onClick={() => navigate('/baux')}>Retour aux baux</Button>} />;

  const property = propertyById.get(lease.property_id);
  const charges = views.filter((v) => v.charge.lease_id === lease.id);
  const payments = data.payments.filter((p) => p.lease_id === lease.id).sort((a, b) => b.paid_on.localeCompare(a.paid_on));
  const chargeIds = new Set(charges.map((v) => v.charge.id));
  const ledger = leaseLedger(charges.map((v) => v.charge), payments, data.allocations.filter((a) => chargeIds.has(a.charge_id)), today);
  const receipts = data.receipts.filter((r) => r.lease_id === lease.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const reminders = data.reminders.filter((r) => r.lease_id === lease.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const deposits = data.deposits.filter((d) => d.lease_id === lease.id).sort((a, b) => b.occurred_on.localeCompare(a.occurred_on));
  const depositHeld = round2(deposits.reduce((s, d) => s + (d.kind === 'encaissement' ? d.amount : -d.amount), 0));
  const titulaires = data.leaseTenants.filter((x) => x.lease_id === lease.id);
  const names = leaseTenants(lease.id, data.leaseTenants, data.tenants).map(tenantName).join(', ');
  const drafts = reminders.filter((r) => r.status === 'brouillon').length;

  return (
    <>
      <p className="crumbs"><a href={href('/baux')}>Locataires et baux</a>{property && <>, <a href={href(`/bien/${property.id}`)}>{property.title}</a></>}</p>
      <PageHeader title={`Bail ${property?.title ?? ''}${lease.label ? ` – ${lease.label}` : ''}`}
        subtitle={<>{names || 'Aucun titulaire'}, location {lease.furnished ? 'meublée' : 'vide'} du {date(lease.start_date)}{lease.end_date ? ` au ${date(lease.end_date)}` : ', sans date de fin'}</>}
        actions={<>
          <Button onClick={() => navigate(`/baux/${lease.id}/modifier`)}>Modifier</Button>
          <Button onClick={() => navigate(`/baux/${lease.id}/contrat`)}>Contrat de bail</Button>
          <Button onClick={async () => { const n = await store.call((r) => r.generateCharges(lease.id)); if (n !== null) store.notify(n ? `${n} échéance(s) générée(s).` : 'Échéances déjà à jour.'); }}>Générer les échéances</Button>
          <Button variant="primary" onClick={() => setPay({ mode: 'saisie' })}>Enregistrer un paiement</Button>
        </>} />
      <div className="status-line"><LeaseBadge lease={lease} />{lease.receipt_auto_send && <span className="pill pill-ok">Quittances automatiques</span>}{lease.reminder_enabled && <span className="pill pill-neutral">Relances préparées après {lease.reminder_delay_days} j</span>}</div>

      <div className="figures">
        <div className="figure"><span className="figure-label">Loyer charges comprises</span><span className="figure-value">{money2(lease.rent_hc + lease.charges_amount)}</span><span className="figure-hint">dont charges {money2(lease.charges_amount)} ({lease.charges_mode === 'forfait' ? 'forfait' : 'provision'})</span></div>
        <div className="figure"><span className="figure-label">Solde du locataire</span><span className={`figure-value ${ledger.balance < 0 ? 'neg' : ledger.balance > 0 ? 'pos' : ''}`}>{money2(ledger.balance)}</span><span className="figure-hint">{ledger.balance > 0 ? 'avance (trop-perçu)' : ledger.balance < 0 ? 'reste dû au total' : 'à jour'}</span></div>
        <div className="figure"><span className="figure-label">Impayé échu</span><span className={`figure-value ${ledger.overdue ? 'neg' : ''}`}>{money2(ledger.overdue)}</span><span className="figure-hint">échéances passées non réglées</span></div>
        <div className="figure"><span className="figure-label">Dépôt de garantie détenu</span><span className="figure-value">{money2(depositHeld)}</span><span className="figure-hint">prévu au bail : {money2(lease.deposit_amount)}</span></div>
      </div>

      <RentRevision leaseId={lease.id} />

      <Tabs tabs={[['echeances', `Échéances (${charges.length})`], ['paiements', `Paiements (${payments.length})`], ['quittances', `Quittances et reçus (${receipts.filter((r) => !r.cancelled_at).length})`],
        ['relances', `Relances${drafts ? ` (${drafts} à valider)` : ''}`], ['depot', 'Dépôt de garantie'], ['titulaires', `Titulaires (${titulaires.length})`], ['documents', 'Documents']]} value={tab} onChange={setTab} />

      {tab === 'echeances' && (
        <Section title="Échéances" actions={<Button size="sm" onClick={() => setChargeForm(true)}>Ajouter une somme due</Button>}>
          {charges.length === 0 ? <p className="muted">Aucune échéance. Elles sont générées chaque mois à partir du bail ; utilisez « Générer les échéances » pour les créer dès maintenant.</p> : (
            <div className="dt-scroll"><table className="dt-table">
              <thead><tr><th>Période</th><th>Échéance</th><th className="num">Loyer</th><th className="num">Charges</th><th className="num">Total</th><th className="num">Réglé</th><th className="num">Reste</th><th>Statut</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {[...charges].reverse().map((v) => (
                  <tr key={v.charge.id} className={v.charge.cancelled_at ? 'muted' : ''}>
                    <td>{periodLabel(v.charge)}</td><td>{date(v.charge.due_date)}</td>
                    <td className="num">{money2(v.charge.rent_amount)}</td><td className="num">{money2(v.charge.charges_amount)}</td>
                    <td className="num">{money2(v.total)}</td><td className="num">{money2(v.paid)}</td>
                    <td className={`num ${v.overdue ? 'neg' : ''}`}>{money2(v.remaining)}</td>
                    <td><ChargeBadge v={v} /></td>
                    <td><div className="row">
                      <ChargeActions v={v} onPay={(x) => setPay({ chargeId: x.charge.id, mode: 'saisie' })} onConfirm={(x) => setPay({ chargeId: x.charge.id, mode: 'confirmation' })} onReceipt={setReceipt} />
                      {!v.charge.cancelled_at && v.paid === 0 && (
                        <Button size="sm" variant="ghost" onClick={async () => {
                          if (await ask('Annuler l’échéance', `L’échéance de ${periodLabel(v.charge)} (${money2(v.total)}) sera annulée et ne sera plus due.`, 'Annuler l’échéance')) {
                            await store.update('rent_charges', v.charge, { cancelled_at: new Date().toISOString() }, 'L’échéance');
                          }
                        }}>Annuler</Button>
                      )}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Section>
      )}

      {tab === 'paiements' && <PaymentsList payments={payments} views={charges} onAdd={() => setPay({ mode: 'saisie' })} />}

      {tab === 'quittances' && (
        <Section title="Quittances et reçus">
          {receipts.length === 0 ? <p className="muted">Aucun document. Une quittance s’émet depuis une échéance intégralement réglée ; un reçu depuis une échéance partiellement réglée.</p> : (
            <div className="dt-scroll"><table className="dt-table">
              <thead><tr><th>N°</th><th>Type</th><th>Période</th><th>Émis le</th><th className="num">Montant</th><th>Envoi</th><th /></tr></thead>
              <tbody>{receipts.map((r) => (
                <tr key={r.id} className={r.cancelled_at ? 'muted' : ''}>
                  <td>{r.number}</td><td>{r.kind === 'quittance' ? 'Quittance' : 'Reçu partiel'}</td><td>{monthLabel(r.period_start)}</td><td>{date(r.issued_on)}</td>
                  <td className="num">{money2(r.paid_amount)}</td><td>{sendLabel(r)}</td>
                  <td><Button size="sm" onClick={() => setReceipt(r)}>Ouvrir</Button></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Section>
      )}

      {tab === 'relances' && <Reminders leaseId={lease.id} reminders={reminders} views={charges} />}
      {tab === 'depot' && <Deposits leaseId={lease.id} planned={lease.deposit_amount} movements={deposits} held={depositHeld} />}
      {tab === 'titulaires' && <Holders leaseId={lease.id} />}
      {tab === 'documents' && <DocumentList filter={{ lease_id: lease.id, property_id: lease.property_id }} />}

      <PaymentDialog open={!!pay} onClose={() => setPay(null)} leaseId={lease.id} chargeId={pay?.chargeId} mode={pay?.mode} />
      <ReceiptDialog receipt={receipt} onClose={() => setReceipt(null)} />
      <ChargeDialog open={chargeForm} leaseId={lease.id} onClose={() => setChargeForm(false)} />
      {dialog}
    </>
  );
}

function PaymentsList({ payments, views, onAdd }: { payments: Payment[]; views: ChargeView[]; onAdd: () => void }) {
  const store = useStore();
  const { data } = store;
  const { ask, dialog } = useConfirm();
  const [editDate, setEditDate] = useState<Payment | null>(null);
  const [newDate, setNewDate] = useState('');
  const viewById = new Map(views.map((v) => [v.charge.id, v]));
  return (
    <Section title="Paiements" actions={<Button size="sm" variant="primary" onClick={onAdd}>Enregistrer un paiement</Button>}>
      {payments.length === 0 ? <p className="muted">Aucun paiement enregistré.</p> : (
        <div className="dt-scroll"><table className="dt-table">
          <thead><tr><th>Date</th><th className="num">Montant</th><th>Moyen</th><th>Référence</th><th>Affecté à</th><th className="num">Non affecté</th><th /></tr></thead>
          <tbody>{payments.map((p) => {
            const allocs = data.allocations.filter((a) => a.payment_id === p.id);
            const free = round2(p.amount - paymentAllocated(p, data.allocations));
            return (
              <tr key={p.id}>
                <td>{date(p.paid_on)}{p.date_defaulted && <span className="pill pill-warn" title="Date du jour utilisée par défaut lors de la confirmation">date par défaut</span>}</td>
                <td className="num">{money2(p.amount)}</td><td>{PAYMENT_METHOD_LABELS[p.method]}</td><td>{p.reference ?? '—'}</td>
                <td className="small">{allocs.map((a) => { const v = viewById.get(a.charge_id); return v ? `${periodLabel(v.charge)} : ${money2(a.amount)}` : null; }).filter(Boolean).join(' ; ') || '—'}</td>
                <td className={`num ${free > 0 ? 'pos' : ''}`}>{free > 0 ? money2(free) : '—'}</td>
                <td><div className="row">
                  {free > 0 && views.some((v) => v.remaining > 0) && (
                    <Button size="sm" onClick={async () => {
                      const plan = autoAllocate(free, views.filter((v) => v.remaining > 0));
                      if (plan.allocations.length) await store.createMany('payment_allocations', plan.allocations.map((a) => ({ payment_id: p.id, ...a })));
                    }}>Affecter l’avance</Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => { setEditDate(p); setNewDate(p.paid_on); }}>Modifier la date</Button>
                  <Button size="sm" variant="ghost" onClick={async () => {
                    if (await ask('Supprimer le paiement', `Le paiement de ${money2(p.amount)} du ${date(p.paid_on)} et sa répartition seront supprimés.`, 'Supprimer')) await store.remove('payments', p.id);
                  }}>Supprimer</Button>
                </div></td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      <Modal open={!!editDate} title="Date de réception" onClose={() => setEditDate(null)}
        footer={<><Button onClick={() => setEditDate(null)}>Annuler</Button><Button variant="primary" disabled={!newDate} onClick={async () => {
          if (editDate && await store.update('payments', editDate, { paid_on: newDate, date_defaulted: false }, 'Le paiement')) setEditDate(null);
        }}>Enregistrer</Button></>}>
        <TextInput label="Date de réception" type="date" value={newDate} onChange={setNewDate} />
      </Modal>
      {dialog}
    </Section>
  );
}

function ChargeDialog({ open, leaseId, onClose }: { open: boolean; leaseId: string; onClose: () => void }) {
  const store = useStore();
  const today = todayParis();
  const lastYear = Number(today.slice(0, 4)) - 1;
  const [kind, setKind] = useState<'rappel' | RentCharge['kind']>('rappel');
  const [year, setYear] = useState(lastYear);
  const [label, setLabel] = useState(`Rappel de charges ${lastYear}`);
  const [amount, setAmount] = useState<number | null>(null);
  const [due, setDue] = useState(today);
  const [err, setErr] = useState<string | null>(null);
  const chooseKind = (k: 'rappel' | RentCharge['kind']) => {
    setKind(k);
    setLabel(k === 'rappel' ? `Rappel de charges ${year}` : k === 'regularisation' ? 'Régularisation annuelle des charges' : '');
  };
  async function save() {
    if (amount === null || !Number.isFinite(amount) || amount === 0) { setErr('Indiquez un montant.'); return; }
    if (amount < 0) { setErr('Un trop-perçu de charges en faveur du locataire se gère en avance : enregistrez une restitution ou déduisez-le d’une échéance.'); return; }
    // le rappel couvre l'année concernée (affichée sur la quittance), il est exigible à la date choisie
    const period = kind === 'rappel' ? { period_start: `${year}-01-01`, period_end: `${year}-12-31` } : { period_start: due, period_end: due };
    const c = await store.create('rent_charges', { lease_id: leaseId, kind: kind === 'rappel' ? 'regularisation' : kind, label: label.trim() || null, ...period, due_date: due, rent_amount: 0, charges_amount: round2(amount) });
    if (c) { store.notify(kind === 'rappel' ? 'Rappel de charges ajouté : une fois réglé, il pourra figurer sur la quittance du mois.' : 'Somme due ajoutée.'); onClose(); }
  }
  return (
    <Modal open={open} title="Ajouter une somme due" onClose={onClose} footer={<><Button onClick={onClose}>Annuler</Button><Button variant="primary" onClick={() => void save()}>Ajouter</Button></>}>
      <div className="grid">
        <Select label="Nature" value={kind} onChange={(v) => chooseKind(v ?? 'autre')} options={[['rappel', 'Rappel de charges d’une année précédente'], ['regularisation', 'Régularisation de charges'], ['autre', 'Autre somme due']] as const} />
        {kind === 'rappel' && (
          <Select label="Année concernée" value={String(year)} onChange={(v) => { const y = Number(v ?? lastYear); setYear(y); setLabel(`Rappel de charges ${y}`); }}
            options={[0, 1, 2, 3, 4].map((i) => String(lastYear - i)).map((y) => [y, y] as const)} hint="Rappel possible sur trois ans (prescription des charges)." />
        )}
        <TextInput label="Libellé" wide value={label} onChange={setLabel} maxLength={200} hint={kind === 'rappel' ? 'Tel qu’il apparaîtra sur la quittance.' : undefined} />
        <NumberInput label="Montant" suffix="€" value={amount} onChange={setAmount} hint={kind === 'rappel' ? 'Charges réelles de l’année − provisions déjà versées.' : undefined} />
        <TextInput label="Date d’exigibilité" type="date" value={due} onChange={setDue} />
      </div>
      {kind === 'rappel' && <p className="muted small">Une fois le rappel réglé, « Émettre la quittance » d’un loyer proposera de l’y ajouter sur une ligne distincte. Joignez le décompte de charges au locataire (Documents).</p>}
      {err && <p className="form-error">{err}</p>}
    </Modal>
  );
}

function RentRevision({ leaseId }: { leaseId: string }) {
  const store = useStore();
  const { data } = store;
  const lease = data.leases.find((l) => l.id === leaseId)!;
  const property = data.properties.find((p) => p.id === lease.property_id);
  const today = todayParis();
  const [open, setOpen] = useState(false);
  const [newIdx, setNewIdx] = useState<number | null>(null);
  const [oldIdx, setOldIdx] = useState<number | null>(null);
  const [effective, setEffective] = useState<string | null>(null);
  const history = (data.revisions ?? []).filter((r) => r.lease_id === leaseId).sort((a, b) => b.effective_on.localeCompare(a.effective_on));
  const plan = revisionPlan(lease, today, property?.dpe ?? null, newIdx, oldIdx);
  if (!lease.irl_enabled && !history.length) {
    return <p className="muted small">Révision annuelle du loyer (IRL) non prévue : <a href={href(`/baux/${lease.id}/modifier`)}>l’activer dans le bail</a>.</p>;
  }
  const canRevise = !plan.block || plan.block === 'indice_inconnu';
  async function revise() {
    if (!plan.newRent || !plan.newKey || !plan.oldKey || !plan.newValue || !plan.oldValue) return;
    const r = await store.call((repo) => repo.reviseRent({ leaseId, effective: effective ?? plan.effective, oldLabel: plan.oldKey!, oldIndex: plan.oldValue!, newLabel: plan.newKey!, newIndex: plan.newValue! }),
      `Loyer révisé : ${money2(plan.newRent)} hors charges.`);
    if (r) setOpen(false);
  }
  return (
    <Section title="Révision annuelle du loyer (IRL)" actions={canRevise ? <Button variant="primary" onClick={() => { setNewIdx(null); setOldIdx(null); setEffective(null); setOpen(true); }}>Réviser le loyer</Button> : undefined}>
      <p>{plan.block && plan.block !== 'indice_inconnu' ? plan.message : <>Révision possible{plan.late ? ` depuis le ${date(plan.anniversary)} (demande tardive : effet à la date de la demande, sans rattrapage)` : ` au ${date(plan.anniversary)}`} : {plan.newRent ? <><strong>{money2(plan.currentRent)} → {money2(plan.newRent)}</strong> ({plan.increasePct !== null && plan.increasePct >= 0 ? '+' : ''}{String(plan.increasePct ?? '').replace('.', ',')} %)</> : 'indice à saisir'}.</>}</p>
      {history.length > 0 && (
        <table className="dt-table compact"><thead><tr><th>Effet au</th><th>Indices</th><th className="num">Ancien loyer</th><th className="num">Nouveau loyer</th></tr></thead>
          <tbody>{history.map((h) => <tr key={h.id}><td>{date(h.effective_on)}</td><td>{irlLabel(h.old_index_label)} ({String(h.old_index).replace('.', ',')}) → {irlLabel(h.new_index_label)} ({String(h.new_index).replace('.', ',')})</td><td className="num">{money2(h.old_rent)}</td><td className="num">{money2(h.new_rent)}</td></tr>)}</tbody></table>
      )}
      <Modal open={open} title="Réviser le loyer" onClose={() => setOpen(false)}
        footer={<><Button onClick={() => setOpen(false)}>Annuler</Button><Button variant="primary" disabled={!plan.newRent || (!!plan.block && plan.block !== 'indice_inconnu')} onClick={() => void revise()}>Appliquer la révision</Button></>}>
        <p>Nouveau loyer = loyer actuel × IRL {plan.newKey ? irlLabel(plan.newKey) : ''} / IRL {plan.oldKey ? irlLabel(plan.oldKey) : ''} (variation annuelle, indices INSEE).</p>
        <div className="grid">
          <NumberInput label={`IRL ${plan.oldKey ? irlLabel(plan.oldKey) : 'précédent'}`} value={plan.oldValue} onChange={setOldIdx} />
          <NumberInput label={`IRL ${plan.newKey ? irlLabel(plan.newKey) : 'nouveau'}`} value={plan.newValue} onChange={setNewIdx} hint={plan.newKey && !IRL_VALUES[plan.newKey] ? 'Pas encore dans Immo-Zen : valeur publiée par l’INSEE à saisir.' : 'Valeur INSEE, modifiable.'} />
          <TextInput label="Date d’effet" type="date" value={effective ?? plan.effective} onChange={(v) => setEffective(v || null)} hint={plan.late ? 'Demande tardive : pas d’effet rétroactif.' : 'Date anniversaire du bail.'} />
          <div className="field"><span className="label" id="irl-new">Nouveau loyer hors charges</span><output className="computed" aria-labelledby="irl-new">{plan.newRent ? money2(plan.newRent) : '—'}</output>
            <small className="muted">Actuel : {money2(plan.currentRent)}</small></div>
        </div>
        <p className="muted small">Les échéances de loyer à partir de la date d’effet encore sans paiement sont mises à jour ; les suivantes sont générées au nouveau montant. Informez le locataire par écrit (courrier ou e-mail).</p>
      </Modal>
    </Section>
  );
}

function Reminders({ leaseId, reminders, views }: { leaseId: string; reminders: Reminder[]; views: ChargeView[] }) {
  const store = useStore();
  const { data } = store;
  const lease = data.leases.find((l) => l.id === leaseId)!;
  const property = data.properties.find((p) => p.id === lease.property_id);
  const tenants = leaseTenants(leaseId, data.leaseTenants, data.tenants);
  const overdue = views.filter((v) => v.overdue);
  const debt = round2(overdue.reduce((s, v) => s + v.remaining, 0));
  const templates = data.settings?.rental_settings?.reminder_templates ?? DEFAULT_REMINDER_TEMPLATES;
  const sent = reminders.filter((r) => ['envoye', 'envoye_manuellement'].includes(r.status)).length;
  const [edit, setEdit] = useState<Reminder | 'new' | null>(null);
  const [level, setLevel] = useState(Math.min(sent + 1, 3));
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const { ask, dialog } = useConfirm();

  function prepare(lv: number) {
    const tpl = templates[lv - 1] ?? DEFAULT_REMINDER_TEMPLATES[lv - 1]!;
    const vars = { locataires: tenants.map(tenantName).join(', '), montant: debt, bien: property?.title ?? '', periodes: overdue.map((v) => periodLabel(v.charge)), bailleur: lease.landlord_name ?? '' };
    setLevel(lv); setSubject(tpl.subject); setBody(renderTemplate(tpl.body, vars));
  }
  function open(r: Reminder | 'new') {
    if (r === 'new') prepare(Math.min(sent + 1, 3)); else { setLevel(r.level); setSubject(r.subject); setBody(r.body); }
    setEdit(r);
  }
  async function saveDraft(): Promise<Reminder | null> {
    const recipients = tenants.map((t) => t.email).filter((e): e is string => !!e);
    const payload = { level, subject: subject.trim(), body: body.trim(), recipients, charge_ids: overdue.map((v) => v.charge.id), debt_amount: debt };
    if (edit === 'new') return store.create('reminders', { lease_id: leaseId, ...payload });
    if (edit) return store.update('reminders', edit, edit.created_by === 'automatique' ? { subject: payload.subject, body: payload.body, level } : payload, 'La relance');
    return null;
  }
  const STATUS: Record<Reminder['status'], string> = { brouillon: 'Brouillon à valider', a_envoyer: 'Envoi en attente', envoye: 'Envoyée', echec: 'Échec de l’envoi', annule: 'Annulée', envoye_manuellement: 'Envoyée par vos soins' };

  return (
    <Section title="Relances amiables" actions={<Button size="sm" variant="primary" disabled={!overdue.length} title={overdue.length ? undefined : 'Aucun impayé échu'} onClick={() => open('new')}>Préparer une relance</Button>}>
      <p className="muted small">Relance amiable uniquement : aucune pénalité n’est ajoutée et ce message n’est pas un acte juridique. Une relance en attente est annulée automatiquement si la dette est réglée.</p>
      {reminders.length === 0 ? <p className="muted">Aucune relance.</p> : (
        <ul className="scenario-list">
          {reminders.map((r) => (
            <li key={r.id}>
              <div>
                <strong>{r.subject}</strong> <span className={`pill ${r.status === 'brouillon' ? 'pill-warn' : 'pill-neutral'}`}>{STATUS[r.status]}</span>
                <p className="muted small">Niveau {r.level}, {money2(r.debt_amount)}, {r.created_by === 'automatique' ? 'préparée automatiquement' : 'rédigée par vous'} le {dateTime(r.created_at)}
                  {r.sent_at ? `, envoyée le ${dateTime(r.sent_at)}` : ''}{r.error ? ` (${r.error})` : ''}. Destinataires : {r.recipients.join(', ') || 'aucun e-mail'}</p>
              </div>
              {r.status === 'brouillon' && <div className="row"><Button size="sm" variant="primary" onClick={() => open(r)}>Relire et envoyer</Button>
                <Button size="sm" variant="ghost" onClick={() => void store.update('reminders', r, { status: 'annule' }, 'La relance')}>Abandonner</Button></div>}
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!edit} wide title="Relance amiable : aperçu avant envoi" onClose={() => setEdit(null)}
        footer={<>
          <Button onClick={() => setEdit(null)}>Fermer</Button>
          <Button onClick={async () => { const r = await saveDraft(); if (r) { store.notify('Brouillon enregistré.'); setEdit(null); } }}>Enregistrer le brouillon</Button>
          <Button onClick={async () => {
            const r = await saveDraft();
            if (r && await ask('Envoyée par vos soins', 'La relance sera marquée comme envoyée (courrier, remise en main propre…). Aucun e-mail ne partira.', 'Marquer comme envoyée', false)) {
              const fresh = store.data.reminders.find((x) => x.id === r.id) ?? r;
              if (await store.update('reminders', fresh, { status: 'envoye_manuellement' }, 'La relance')) setEdit(null);
            }
          }}>Marquer comme envoyée par vos soins</Button>
          <Button variant="primary" disabled={!tenants.some((t) => t.email)} title={tenants.some((t) => t.email) ? undefined : 'Aucun e-mail de locataire'} onClick={async () => {
            const r = await saveDraft();
            if (!r) return;
            const out = await store.call((repo) => repo.queueReminder(r.id));
            if (out) { store.notify(out.status === 'annule' ? 'Dette déjà réglée : relance annulée.' : store.repo.mode === 'demo' ? 'Relance mise en file (mode démonstration : aucun e-mail n’est envoyé).' : 'Relance programmée pour envoi.'); setEdit(null); }
          }}>Envoyer par e-mail</Button>
        </>}>
        <div className="grid">
          <Select label="Niveau" value={String(level)} onChange={(v) => prepare(Number(v ?? 1))} options={[['1', '1 – Rappel'], ['2', '2 – Second rappel'], ['3', '3 – Dernier rappel amiable']] as const} hint="Changer de niveau recharge le modèle." />
          <TextInput label="Objet" wide value={subject} onChange={setSubject} maxLength={300} />
          <TextArea label="Message" value={body} onChange={setBody} rows={12} />
        </div>
        <p className="muted small">Destinataires : {tenants.map((t) => `${tenantName(t)}${t.email ? ` <${t.email}>` : ' (pas d’e-mail)'}`).join(', ')}. Montant dû à ce jour : {money2(debt)}. Modèles modifiables dans Paramètres.</p>
      </Modal>
      {dialog}
    </Section>
  );
}

function Deposits({ leaseId, planned, movements, held }: { leaseId: string; planned: number; movements: DepositMovement[]; held: number }) {
  const store = useStore();
  const [kind, setKind] = useState<DepositMovement['kind']>(movements.length ? 'restitution' : 'encaissement');
  const [amount, setAmount] = useState<number | null>(movements.length ? held : planned);
  const [on, setOn] = useState(todayParis());
  const [comment, setComment] = useState('');
  const LABELS = { encaissement: 'Encaissement', restitution: 'Restitution au locataire', retenue: 'Retenue (justifiée)' } as const;
  return (
    <Section title="Dépôt de garantie">
      <p className="muted small">Le dépôt de garantie est suivi séparément : il n’entre ni dans les loyers encaissés ni dans le solde du locataire.</p>
      <KeyValue items={[['Prévu au bail', money2(planned)], ['Détenu actuellement', money2(held)]]} />
      {movements.length > 0 && (
        <table className="dt-table compact"><thead><tr><th>Date</th><th>Mouvement</th><th className="num">Montant</th><th>Commentaire</th><th /></tr></thead>
          <tbody>{movements.map((m) => (
            <tr key={m.id}><td>{date(m.occurred_on)}</td><td>{LABELS[m.kind]}</td><td className="num">{money2(m.amount)}</td><td>{m.comment ?? '—'}</td>
              <td><Button size="sm" variant="ghost" onClick={() => void store.remove('deposit_movements', m.id)}>Supprimer</Button></td></tr>
          ))}</tbody></table>
      )}
      <div className="grid inline-form">
        <Select label="Mouvement" value={kind} onChange={(v) => setKind(v ?? 'encaissement')} options={Object.entries(LABELS) as [DepositMovement['kind'], string][]} />
        <NumberInput label="Montant" suffix="€" value={amount} onChange={setAmount} />
        <TextInput label="Date" type="date" value={on} onChange={setOn} />
        <TextInput label="Commentaire" value={comment} onChange={setComment} maxLength={2000} placeholder={kind === 'retenue' ? 'Motif et justificatif' : ''} />
      </div>
      <Button size="sm" variant="primary" disabled={!amount || amount <= 0} onClick={async () => {
        if (kind !== 'encaissement' && amount! > held) { store.notify('Le montant dépasse le dépôt détenu.', 'error'); return; }
        if (await store.create('deposit_movements', { lease_id: leaseId, kind, amount: round2(amount!), occurred_on: on, comment: comment || null })) setComment('');
      }}>Ajouter le mouvement</Button>
    </Section>
  );
}

function Holders({ leaseId }: { leaseId: string }) {
  const store = useStore();
  const { data } = store;
  const links = data.leaseTenants.filter((x) => x.lease_id === leaseId);
  const [leftOn, setLeftOn] = useState<Record<string, string>>({});
  const access = useTenantAccess();
  return (
    <Section title="Titulaires du bail" actions={<Button size="sm" onClick={() => navigate(`/baux/${leaseId}/modifier`)}>Ajouter ou retirer</Button>}>
      <p className="muted small">Départ d’un colocataire : indiquez sa date de départ ; il reste dans l’historique et n’apparaît plus sur les quittances suivantes. Espace locataire : chaque titulaire invité consulte en ligne ses quittances et les documents partagés.</p>
      <ul className="tasks">
        {links.map((l) => {
          const t = data.tenants.find((x) => x.id === l.tenant_id);
          if (!t) return null;
          return (
            <li key={l.tenant_id}>
              <span className="checkbox">{tenantName(t)}{t.email ? <span className="muted small">, {t.email}</span> : <span className="muted small">, pas d’e-mail</span>}</span>
              <span className="row"><AccessPill tenant={t} />
                {access.actions(t).map((a) => <Button key={a.label} size="sm" variant={a.danger ? 'ghost' : 'secondary'} onClick={a.onSelect}>{a.label}</Button>)}
              </span>
              {l.left_on ? <span className="muted small">parti le {date(l.left_on)} <button type="button" className="link" onClick={() => void store.updateWhere('lease_tenants', { lease_id: leaseId, tenant_id: l.tenant_id }, { left_on: null })}>annuler</button></span> : (
                <span className="row">
                  <input type="date" aria-label={`Date de départ de ${tenantName(t)}`} value={leftOn[l.tenant_id] ?? ''} onChange={(e) => setLeftOn({ ...leftOn, [l.tenant_id]: e.target.value })} />
                  <Button size="sm" disabled={!leftOn[l.tenant_id]} onClick={() => void store.updateWhere('lease_tenants', { lease_id: leaseId, tenant_id: l.tenant_id }, { left_on: leftOn[l.tenant_id] })}>Enregistrer le départ</Button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {access.ui}
    </Section>
  );
}

export function useLeaseCount(propertyId: string) {
  const { data } = useStore();
  return useMemo(() => data.leases.filter((l) => l.property_id === propertyId).length, [data.leases, propertyId]);
}

export { chargeTotal };
