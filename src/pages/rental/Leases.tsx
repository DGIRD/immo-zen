import { IRL_KEYS, IRL_VALUES, irlLabel, latestPublishedAt } from '../../domain/irl.ts';
import { useMemo, useState } from 'react';
import { useStore } from '../../data/store.tsx';
import type { Insert, Lease, Tenant } from '../../data/types.ts';
import { date, money, money2, todayParis } from '../../domain/format.ts';
import { leaseLedger, leaseState, leaseTenants, tenantName } from '../../domain/rental.ts';
import { round2 } from '../../domain/simulator.ts';
import { DataTable, type Column } from '../../ui/DataTable.tsx';
import { Button, Checkbox, EmptyState, Modal, NumberInput, PageHeader, Section, Select, Tabs, TextArea, TextInput, useConfirm } from '../../ui/components.tsx';
import { navigate } from '../../ui/router.ts';
import { LeaseBadge, useRental } from './common.tsx';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function LeasesPage({ tab: initialTab }: { tab?: 'baux' | 'locataires' }) {
  const { data } = useStore();
  const [tab, setTab] = useState<'baux' | 'locataires'>(initialTab ?? 'baux');
  const [tenantEdit, setTenantEdit] = useState<Tenant | 'new' | null>(null);
  const owned = data.properties.filter((p) => p.status === 'acquis');
  return (
    <>
      <PageHeader title="Locataires et baux" subtitle="Baux successifs de vos biens détenus, titulaires, colocations et périodes sans occupation."
        actions={tab === 'baux'
          ? <Button variant="primary" disabled={!owned.length} title={owned.length ? undefined : 'Ajoutez d’abord un bien dans Mes biens'} onClick={() => navigate('/baux/nouveau')}>Nouveau bail</Button>
          : <Button variant="primary" onClick={() => setTenantEdit('new')}>Nouveau locataire</Button>} />
      <Tabs tabs={[['baux', `Baux (${data.leases.length})`], ['locataires', `Locataires (${data.tenants.filter((t) => !t.archived_at).length})`]]} value={tab} onChange={setTab} />
      {tab === 'baux' ? <LeaseTable /> : <TenantTable onEdit={setTenantEdit} />}
      <TenantDialog tenant={tenantEdit} onClose={() => setTenantEdit(null)} />
    </>
  );
}

interface LeaseRow { l: Lease; property: string; tenants: string; balance: number; overdue: number }

function LeaseTable() {
  const { data } = useStore();
  const { propertyById, today } = useRental();
  const [scope, setScope] = useState<'actifs' | 'tous'>('actifs');
  const rows: LeaseRow[] = useMemo(() => data.leases
    .filter((l) => scope === 'tous' || leaseState(l, today) !== 'termine')
    .map((l) => {
      const ch = data.charges.filter((c) => c.lease_id === l.id);
      const ids = new Set(ch.map((c) => c.id));
      const led = leaseLedger(ch, data.payments.filter((p) => p.lease_id === l.id), data.allocations.filter((a) => ids.has(a.charge_id)), today);
      return {
        l, property: propertyById.get(l.property_id)?.title ?? '—',
        tenants: leaseTenants(l.id, data.leaseTenants, data.tenants, false).map(tenantName).join(', '), balance: led.balance, overdue: led.overdue,
      };
    }), [data, scope, today, propertyById]);

  const columns: Column<LeaseRow>[] = [
    { id: 'property', label: 'Bien', value: (r) => r.property + (r.l.label ? ` – ${r.l.label}` : ''), primary: true },
    { id: 'tenants', label: 'Locataire(s)', value: (r) => r.tenants || null, mobile: true },
    { id: 'type', label: 'Type', value: (r) => (r.l.furnished ? 'Meublé' : 'Vide') },
    { id: 'start', label: 'Début', value: (r) => r.l.start_date, kind: 'date', render: (r) => date(r.l.start_date), mobile: true },
    { id: 'end', label: 'Fin', value: (r) => r.l.end_date, kind: 'date', render: (r) => date(r.l.end_date) },
    { id: 'rent', label: 'Loyer HC', value: (r) => r.l.rent_hc, kind: 'money', align: 'right', render: (r) => money2(r.l.rent_hc) },
    { id: 'charges', label: 'Charges', value: (r) => r.l.charges_amount, kind: 'money', align: 'right', render: (r) => money2(r.l.charges_amount) },
    { id: 'cc', label: 'Loyer CC', value: (r) => round2(r.l.rent_hc + r.l.charges_amount), kind: 'money', align: 'right', render: (r) => money2(r.l.rent_hc + r.l.charges_amount), mobile: true },
    { id: 'state', label: 'État', value: (r) => leaseState(r.l, today), render: (r) => <LeaseBadge lease={r.l} />, mobile: true },
    { id: 'balance', label: 'Solde', value: (r) => r.balance, kind: 'money', align: 'right',
      render: (r) => <span className={r.balance < 0 ? 'neg' : r.balance > 0 ? 'pos' : ''} title={r.balance > 0 ? 'Avance du locataire' : r.balance < 0 ? 'Montant dû' : undefined}>{money2(r.balance)}</span>, mobile: true },
    { id: 'overdue', label: 'Impayé échu', value: (r) => r.overdue, kind: 'money', align: 'right', render: (r) => (r.overdue ? <span className="neg">{money2(r.overdue)}</span> : '—') },
  ];
  return (
    <DataTable id="baux" rows={rows} columns={columns} rowKey={(r) => r.l.id} initialSort={{ id: 'start', dir: 'desc' }}
      onOpen={(r) => navigate(`/baux/${r.l.id}`)}
      toolbar={<label className="inline-select">Afficher
        <select value={scope} onChange={(e) => setScope(e.target.value as 'actifs' | 'tous')}>
          <option value="actifs">En cours et à venir</option><option value="tous">Tous, y compris terminés</option>
        </select></label>}
      rowActions={(r) => [
        { label: 'Ouvrir', onSelect: () => navigate(`/baux/${r.l.id}`) },
        { label: 'Modifier', onSelect: () => navigate(`/baux/${r.l.id}/modifier`) },
      ]}
      empty={<EmptyState title="Aucun bail" action={data.properties.some((p) => p.status === 'acquis') && <Button variant="primary" onClick={() => navigate('/baux/nouveau')}>Créer un bail</Button>}>
        Un bail relie un bien détenu à un ou plusieurs locataires et génère les échéances de loyer chaque mois.
      </EmptyState>} />
  );
}

function TenantTable({ onEdit }: { onEdit: (t: Tenant) => void }) {
  const { data, remove, notify } = useStore();
  const { ask, dialog } = useConfirm();
  const { leaseLabel, today } = useRental();
  const [archived, setArchived] = useState(false);
  const rows = data.tenants.filter((t) => (archived ? !!t.archived_at : !t.archived_at));
  const leasesOf = (t: Tenant) => data.leaseTenants.filter((x) => x.tenant_id === t.id).map((x) => data.leases.find((l) => l.id === x.lease_id)).filter((l): l is Lease => !!l);
  const columns: Column<Tenant>[] = [
    { id: 'name', label: 'Nom', value: (t) => tenantName(t), primary: true },
    { id: 'email', label: 'E-mail', value: (t) => t.email, render: (t) => (t.email ? <a href={`mailto:${t.email}`}>{t.email}</a> : <span className="muted">—</span>), mobile: true },
    { id: 'phone', label: 'Téléphone', value: (t) => t.phone, mobile: true },
    { id: 'lease', label: 'Bail', value: (t) => leasesOf(t).map(leaseLabel).join(' ; ') || null,
      render: (t) => {
        const ls = leasesOf(t);
        const current = ls.find((l) => leaseState(l, today) === 'actif');
        return current ? <a href={`#/baux/${current.id}`}>Bail en cours</a> : ls.length ? <span className="muted">{ls.length} bail(s) passé(s) ou à venir</span> : <span className="muted">Aucun</span>;
      }, mobile: true },
  ];
  return (
    <>
      <DataTable id="locataires" rows={rows} columns={columns} rowKey={(t) => t.id} initialSort={{ id: 'name', dir: 'asc' }} onOpen={onEdit}
        toolbar={<Checkbox label="Archivés" checked={archived} onChange={setArchived} />}
        rowActions={(t) => [
          { label: 'Modifier', onSelect: () => onEdit(t) },
          { label: 'Supprimer', danger: true, onSelect: async () => {
            const n = leasesOf(t).length;
            if (n) { await ask('Suppression impossible', `${tenantName(t)} figure sur ${n} bail(s). Archivez la fiche pour conserver l’historique.`, 'Compris', false); return; }
            if (await ask('Supprimer le locataire', `${tenantName(t)} sera supprimé.`, 'Supprimer') && await remove('tenants', t.id)) notify('Locataire supprimé.');
          } },
        ]}
        empty={<EmptyState title={archived ? 'Aucun locataire archivé' : 'Aucun locataire'}>Les locataires peuvent aussi être créés directement depuis le formulaire de bail.</EmptyState>} />
      {dialog}
    </>
  );
}

export function TenantDialog({ tenant, onClose, onCreated }: { tenant: Tenant | 'new' | null; onClose: () => void; onCreated?: (t: Tenant) => void }) {
  const store = useStore();
  const existing = tenant && tenant !== 'new' ? tenant : null;
  const [d, setD] = useState<Insert<Tenant> & { last_name: string }>({ last_name: '' });
  const [err, setErr] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const k = existing?.id ?? (tenant === 'new' ? 'new' : null);
  if (k !== key) { setKey(k); setD(existing ? { ...existing } : { last_name: '', first_name: '', email: '', phone: '' }); setErr(null); }
  const set = <K extends keyof typeof d>(f: K, v: (typeof d)[K]) => setD((x) => ({ ...x, [f]: v }));

  async function save() {
    if (!d.last_name.trim()) { setErr('Le nom est obligatoire.'); return; }
    if (d.email && !EMAIL.test(d.email.trim())) { setErr('Adresse e-mail invalide.'); return; }
    const payload: Insert<Tenant> = { first_name: d.first_name?.trim() || null, last_name: d.last_name.trim(), email: d.email?.trim().toLowerCase() || null, phone: d.phone?.trim() || null, notes: d.notes || null };
    if (existing) {
      if (await store.update('tenants', existing, payload, `Le locataire « ${tenantName(existing)} »`)) onClose();
    } else {
      const t = await store.create('tenants', payload);
      if (t) { onCreated?.(t); onClose(); }
    }
  }
  return (
    <Modal open={!!tenant} title={existing ? `Modifier ${tenantName(existing)}` : 'Nouveau locataire'} onClose={onClose}
      footer={<>
        {existing && <Button variant="ghost" onClick={async () => { if (await store.update('tenants', existing, { archived_at: existing.archived_at ? null : new Date().toISOString() }, 'Le locataire')) onClose(); }}>{existing.archived_at ? 'Désarchiver' : 'Archiver'}</Button>}
        <Button onClick={onClose}>Annuler</Button><Button variant="primary" onClick={() => void save()}>Enregistrer</Button>
      </>}>
      <div className="grid">
        <TextInput label="Prénom" value={d.first_name} onChange={(v) => set('first_name', v)} maxLength={120} />
        <TextInput label="Nom" required value={d.last_name} onChange={(v) => set('last_name', v)} maxLength={120} />
        <TextInput label="E-mail" type="email" value={d.email} onChange={(v) => set('email', v)} hint="Nécessaire pour envoyer quittances et relances." />
        <TextInput label="Téléphone" type="tel" value={d.phone} onChange={(v) => set('phone', v)} maxLength={40} />
        <TextArea label="Notes" value={d.notes} onChange={(v) => set('notes', v)} rows={3} />
      </div>
      {err && <p className="form-error" role="alert">{err}</p>}
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Formulaire de bail
// ---------------------------------------------------------------------
export function LeaseFormPage({ id, propertyId }: { id?: string; propertyId?: string }) {
  const store = useStore();
  const { data } = store;
  const existing = id ? data.leases.find((l) => l.id === id) : undefined;
  const owned = data.properties.filter((p) => p.status === 'acquis');
  const rs = data.settings?.rental_settings ?? {};
  const initialProperty = existing?.property_id ?? propertyId ?? (owned.length === 1 ? owned[0]!.id : '');
  const prop = data.properties.find((p) => p.id === initialProperty);
  const [d, setD] = useState<Insert<Lease>>(() => existing ? { ...existing } : {
    property_id: initialProperty, furnished: false, start_date: todayParis(), end_date: null, rent_hc: prop?.estimated_rent ?? 0,
    charges_amount: prop?.charges_provision ?? 0, charges_mode: 'provision', deposit_amount: prop?.estimated_rent ?? 0, payment_day: 5,
    landlord_name: rs.landlord_name ?? '', landlord_address: rs.landlord_address ?? '', owner_confirmation_email: true, receipt_auto_send: false,
    reminder_enabled: false, reminder_delay_days: 10,
  });
  const currentTenantIds = existing ? data.leaseTenants.filter((x) => x.lease_id === existing.id).map((x) => x.tenant_id) : [];
  const [tenantIds, setTenantIds] = useState<string[]>(currentTenantIds);
  const [newTenant, setNewTenant] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Lease>(k: K, v: Lease[K] | null | undefined) => setD((x) => ({ ...x, [k]: v }));

  if (id && !existing) return <EmptyState title="Bail introuvable" />;
  if (!owned.length) return <EmptyState title="Aucun bien détenu" action={<Button onClick={() => navigate('/bien/nouveau?mode=owned')}>Ajouter un bien détenu</Button>}>Un bail ne peut concerner qu’un bien de la rubrique Mes biens.</EmptyState>;
  const hasCharges = existing ? data.charges.some((c) => c.lease_id === existing.id) : false;

  function validate() {
    const e: Record<string, string> = {};
    if (!d.property_id) e.property_id = 'Choisissez le bien.';
    if (!d.start_date) e.start_date = 'Date de début obligatoire.';
    if (d.end_date && d.start_date && d.end_date < d.start_date) e.end_date = 'La fin précède le début.';
    for (const k of ['rent_hc', 'charges_amount', 'deposit_amount'] as const) if (!(Number.isFinite(d[k]) && (d[k] as number) >= 0)) e[k] = 'Montant positif attendu.';
    if (!(Number.isInteger(d.payment_day) && d.payment_day! >= 1 && d.payment_day! <= 28)) e.payment_day = 'Jour entre 1 et 28.';
    if (!(Number.isInteger(d.reminder_delay_days) && d.reminder_delay_days! >= 1 && d.reminder_delay_days! <= 90)) e.reminder_delay_days = 'Entre 1 et 90 jours.';
    if (!tenantIds.length) e.tenants = 'Ajoutez au moins un titulaire.';
    setErrors(e);
    return !Object.keys(e).length;
  }

  async function save() {
    if (!validate()) return;
    setBusy(true);
    try {
      const { id: _i, user_id: _u, version: _v, created_at: _c, updated_at: _up, ...rest } = d as Partial<Lease>;
      const payload: Insert<Lease> = { ...rest, label: d.label?.trim() || null, landlord_name: d.landlord_name?.trim() || null, landlord_address: d.landlord_address?.trim() || null, notes: d.notes || null };
      let lease: Lease | null;
      if (existing) lease = await store.update('leases', existing, payload, 'Le bail');
      else lease = await store.create('leases', payload);
      if (!lease) return;
      const add = tenantIds.filter((t) => !currentTenantIds.includes(t));
      if (add.length) await store.createMany('lease_tenants', add.map((tenant_id) => ({ lease_id: lease!.id, tenant_id })));
      for (const t of currentTenantIds.filter((x) => !tenantIds.includes(x))) await store.removeWhere('lease_tenants', { lease_id: lease.id, tenant_id: t });
      const n = await store.call((r) => r.generateCharges(lease!.id));
      store.notify(existing ? 'Bail enregistré.' : `Bail créé${n ? `, ${n} échéance(s) générée(s)` : ''}.`);
      navigate(`/baux/${lease.id}`);
    } finally {
      setBusy(false);
    }
  }

  const tenantsList = data.tenants.filter((t) => !t.archived_at || tenantIds.includes(t.id)).sort((a, b) => tenantName(a).localeCompare(tenantName(b), 'fr'));
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
      <PageHeader title={existing ? 'Modifier le bail' : 'Nouveau bail'}
        actions={<><Button onClick={() => history.back()}>Annuler</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</Button></>} />
      {Object.keys(errors).length > 0 && <p className="form-error" role="alert">Corrigez les champs signalés.</p>}

      <Section title="Bien et titulaires">
        <div className="grid">
          <Select label="Bien" wide value={d.property_id ?? null} error={errors.property_id} allowEmpty="Choisir…"
            onChange={(v) => {
              const p = data.properties.find((x) => x.id === v);
              setD((x) => ({ ...x, property_id: v ?? '', ...(existing || !p ? {} : { rent_hc: p.estimated_rent ?? x.rent_hc, charges_amount: p.charges_provision ?? x.charges_amount, deposit_amount: p.estimated_rent ?? x.deposit_amount }) }));
            }}
            hint={hasCharges ? 'Le bien ne peut plus être changé : des échéances existent.' : undefined}
            options={owned.map((p) => [p.id, p.title] as const)} />
          <TextInput label="Libellé (facultatif)" value={d.label} onChange={(v) => set('label', v)} maxLength={120} placeholder="Ex. Chambre 2 en colocation" />
        </div>
        <div className="tenant-picker">
          <p className="label">Titulaire(s) du bail{errors.tenants && <span className="field-error"> – {errors.tenants}</span>}</p>
          {tenantsList.length === 0 && <p className="muted small">Aucun locataire enregistré.</p>}
          <div className="chips">
            {tenantsList.map((t) => (
              <label key={t.id} className={`chip${tenantIds.includes(t.id) ? ' on' : ''}`}>
                <input type="checkbox" checked={tenantIds.includes(t.id)} onChange={(e) => setTenantIds(e.target.checked ? [...tenantIds, t.id] : tenantIds.filter((x) => x !== t.id))} />
                {tenantName(t)}
              </label>
            ))}
            <Button size="sm" onClick={() => setNewTenant(true)}>+ Nouveau locataire</Button>
          </div>
          <p className="muted small">Colocation : cochez plusieurs titulaires sur un même bail, ou créez un bail par chambre.</p>
        </div>
      </Section>

      <Section title="Durée et loyer">
        <div className="grid">
          <Select label="Location" value={d.furnished ? 'meuble' : 'vide'} onChange={(v) => set('furnished', v === 'meuble')} options={[['vide', 'Vide'], ['meuble', 'Meublée']] as const} />
          <TextInput label="Début du bail" type="date" required value={d.start_date} onChange={(v) => set('start_date', v)} error={errors.start_date} />
          <TextInput label="Fin du bail (facultatif)" type="date" value={d.end_date} onChange={(v) => set('end_date', v || null)} error={errors.end_date}
            hint="À renseigner au départ du locataire. Les échéances suivantes non réglées sont annulées." />
          <NumberInput label="Loyer hors charges" suffix="€/mois" value={d.rent_hc} onChange={(v) => set('rent_hc', v ?? 0)} error={errors.rent_hc} />
          <Select label="Charges" value={d.charges_mode ?? 'provision'} onChange={(v) => set('charges_mode', v ?? 'provision')} options={[['provision', 'Provision (régularisation annuelle)'], ['forfait', 'Forfait']] as const} />
          <NumberInput label={d.charges_mode === 'forfait' ? 'Forfait de charges' : 'Provision sur charges'} suffix="€/mois" value={d.charges_amount} onChange={(v) => set('charges_amount', v ?? 0)} error={errors.charges_amount} />
          <div className="field">
            <span className="label">Loyer charges comprises</span>
            <output className="computed">{money2(round2((d.rent_hc ?? 0) + (d.charges_amount ?? 0)))}<small> / mois</small></output>
          </div>
          <NumberInput label="Jour de paiement" value={d.payment_day} onChange={(v) => set('payment_day', v === null ? 1 : Math.round(v))} error={errors.payment_day} hint="Entre 1 et 28." />
          <NumberInput label="Dépôt de garantie" suffix="€" value={d.deposit_amount} onChange={(v) => set('deposit_amount', v ?? 0)} error={errors.deposit_amount}
            hint="Suivi à part des loyers (encaissement et restitution dans la fiche du bail)." />
        </div>
        <p className="muted small">Une modification manuelle du loyer s’applique aux échéances générées ensuite. Pour la révision annuelle, utilisez « Réviser le loyer » dans la fiche du bail.</p>
      </Section>

      <Section title="Révision annuelle (IRL)">
        <Checkbox label="Le bail prévoit une révision annuelle selon l’indice de référence des loyers (IRL)" checked={!!d.irl_enabled}
          onChange={(v) => setD((x) => ({ ...x, irl_enabled: v, irl_base_label: x.irl_base_label ?? (v ? latestPublishedAt(x.start_date ?? todayParis()) : null), irl_base_value: x.irl_base_value ?? (v ? IRL_VALUES[latestPublishedAt(x.start_date ?? todayParis()) ?? ''] ?? null : null) }))} />
        {d.irl_enabled && (
          <div className="grid">
            <Select label="IRL de référence du bail" value={d.irl_base_label ?? null} allowEmpty="Choisir…"
              onChange={(v) => setD((x) => ({ ...x, irl_base_label: v, irl_base_value: v ? IRL_VALUES[v] ?? x.irl_base_value ?? null : null }))}
              options={IRL_KEYS.map((k) => [k, `${irlLabel(k)} — ${String(IRL_VALUES[k]).replace('.', ',')}`] as const)}
              hint="Trimestre et indice figurant au bail (le dernier publié à la signature) ou retenus à la dernière révision." />
            <NumberInput label="Valeur de l’indice" value={d.irl_base_value ?? null} onChange={(v) => set('irl_base_value', v)} hint="Reprise de l’INSEE ; modifiable." />
            <TextInput label="Dernière révision" type="date" value={d.last_revision_on ?? ''} onChange={(v) => set('last_revision_on', v || null)} hint="Si le loyer a déjà été révisé avant l’utilisation d’Immo-Zen." />
          </div>
        )}
        <p className="muted small">Chaque année à la date anniversaire, « Réviser le loyer » (fiche du bail) calcule le nouveau loyer avec la variation annuelle de l’IRL. Révision interdite pour un logement classé F ou G au DPE.</p>
      </Section>

      <Section title="Quittances">
        <div className="grid">
          <TextInput label="Nom du bailleur" value={d.landlord_name} onChange={(v) => set('landlord_name', v)} maxLength={200} hint="Tel qu’il doit figurer sur les quittances." />
          <TextInput label="Adresse du bailleur" wide value={d.landlord_address} onChange={(v) => set('landlord_address', v)} maxLength={500} />
        </div>
      </Section>

      <Section title="Automatisations">
        <div className="toggles">
          <Checkbox label="M’envoyer un e-mail le lendemain de chaque échéance non réglée pour confirmer le paiement" checked={!!d.owner_confirmation_email} onChange={(v) => set('owner_confirmation_email', v)} />
          <p className="muted small">Votre absence de réponse ne vaut jamais paiement : le loyer reste impayé tant que vous ne l’avez pas confirmé.</p>
          <Checkbox label="Émettre et envoyer automatiquement la quittance quand une période est intégralement réglée" checked={!!d.receipt_auto_send} onChange={(v) => set('receipt_auto_send', v)} />
          <p className="muted small">Uniquement après un paiement que vous avez saisi ou confirmé, si le montant réglé est exactement le montant dû, et une seule fois par période. Jamais sur la seule base d’une date.</p>
          <Checkbox label="Préparer une relance amiable quand un loyer reste impayé" checked={!!d.reminder_enabled} onChange={(v) => set('reminder_enabled', v)} />
          {d.reminder_enabled && (
            <div className="grid"><NumberInput label="Délai après l’échéance" suffix="jours" value={d.reminder_delay_days} onChange={(v) => set('reminder_delay_days', v === null ? 10 : Math.round(v))} error={errors.reminder_delay_days} /></div>
          )}
          <p className="muted small">La relance est préparée en brouillon et vous est signalée : rien n’est envoyé au locataire sans votre validation.</p>
        </div>
      </Section>

      <Section title="Notes">
        <div className="grid"><TextArea label="Notes" value={d.notes} onChange={(v) => set('notes', v)} rows={3} /></div>
      </Section>

      <div className="form-foot">
        <Button onClick={() => history.back()}>Annuler</Button>
        <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</Button>
      </div>
      <TenantDialog tenant={newTenant ? 'new' : null} onClose={() => setNewTenant(false)} onCreated={(t) => setTenantIds((x) => [...x, t.id])} />
    </form>
  );
}

export const leaseMoney = (l: Lease) => money(l.rent_hc + l.charges_amount);
