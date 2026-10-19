import { useMemo, useState } from 'react';
import { usePlan, useStore } from '../data/store.tsx';
import { PlanLock } from '../ui/PlanLock.tsx';
import type { Channel, Contact, ContactKind, Insert } from '../data/types.ts';
import { downloadBlob, stamp, toCsv, toXlsx, type ExportColumn } from '../domain/exporting.ts';
import { date, dateTime, todayParis } from '../domain/format.ts';
import { CHANNEL_LABELS, CONTACT_KIND_LABELS, STATUS_LABELS } from '../domain/labels.ts';
import { DataTable, type Column } from '../ui/DataTable.tsx';
import { Button, Checkbox, EmptyState, KeyValue, PageHeader, Section, Select, TextArea, TextInput, useConfirm } from '../ui/components.tsx';
import { href, navigate } from '../ui/router.ts';

const KINDS = Object.entries(CONTACT_KIND_LABELS) as [ContactKind, string][];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

interface Row { c: Contact; org: Contact | null; linked: number }

export function ContactsPage() {
  const { data, remove, notify } = useStore();
  const contactsIncluded = usePlan().features.contacts;
  const { ask, dialog } = useConfirm();
  const [kind, setKind] = useState<ContactKind | ''>('');
  const [archived, setArchived] = useState(false);
  const [dueOnly, setDueOnly] = useState(false);
  const today = todayParis();
  const rows: Row[] = useMemo(() => {
    const byId = new Map(data.contacts.map((c) => [c.id, c]));
    return data.contacts
      .filter((c) => (archived ? !!c.archived_at : !c.archived_at) && (!kind || c.kind === kind) && (!dueOnly || (c.next_follow_up !== null && c.next_follow_up <= today)))
      .map((c) => ({ c, org: c.organization_id ? byId.get(c.organization_id) ?? null : null, linked: data.properties.filter((p) => p.agency_id === c.id || p.agent_id === c.id).length }));
  }, [data.contacts, data.properties, kind, archived, dueOnly, today]);

  const columns: Column<Row>[] = useMemo(() => [
    { id: 'name', label: 'Nom', value: (r) => r.c.name, primary: true },
    { id: 'kind', label: 'Type', value: (r) => CONTACT_KIND_LABELS[r.c.kind], mobile: true },
    { id: 'org', label: 'Organisme', value: (r) => r.org?.name ?? r.c.organization_name, mobile: true },
    { id: 'email', label: 'E-mail', value: (r) => r.c.email, render: (r) => (r.c.email ? <a href={`mailto:${r.c.email}`}>{r.c.email}</a> : '—'), mobile: true },
    { id: 'phone', label: 'Téléphone', value: (r) => r.c.phone, render: (r) => (r.c.phone ? <a href={`tel:${r.c.phone.replace(/\s/g, '')}`}>{r.c.phone}</a> : '—'), mobile: true },
    { id: 'sector', label: 'Secteur', value: (r) => r.c.sector },
    { id: 'linked', label: 'Biens liés', value: (r) => r.linked, kind: 'number', align: 'right' },
    { id: 'follow', label: 'Prochaine relance', value: (r) => r.c.next_follow_up, kind: 'date',
      render: (r) => <span className={r.c.next_follow_up && r.c.next_follow_up <= today ? 'neg' : ''}>{date(r.c.next_follow_up)}</span>, mobile: true },
    { id: 'notes', label: 'Notes', value: (r) => r.c.notes, defaultHidden: true, sortable: false },
  ], [today]);

  const ex: ExportColumn<Row>[] = columns.map((c) => ({ label: c.label, value: c.value, kind: c.kind }));
  const exp = async (f: 'xlsx' | 'csv' | 'json', list: Row[]) => {
    const file = `immo-zen-contacts-${stamp()}`;
    if (f === 'csv') downloadBlob(new Blob([toCsv(ex, list)], { type: 'text/csv;charset=utf-8' }), `${file}.csv`);
    else if (f === 'xlsx') downloadBlob(await toXlsx([{ name: 'Contacts', columns: ex, rows: list }]), `${file}.xlsx`);
    else downloadBlob(new Blob([JSON.stringify({ format: 'immo-zen-export', exported_at: new Date().toISOString(), contacts: list.map((r) => r.c) }, null, 2)], { type: 'application/json' }), `${file}.json`);
  };

  return (
    <>
      <PageHeader title="Contacts" subtitle="Agences, agents, artisans, notaires et autres professionnels avec qui vous échangez."
        actions={contactsIncluded && <Button variant="primary" onClick={() => navigate('/contacts/nouveau')}>Ajouter un contact</Button>} />
      {!contactsIncluded && <PlanLock title="Contacts non inclus dans la formule Découverte" compact>Carnet d’agences et d’agents, relances, rattachement aux biens et comparaison de biens : à partir de la formule Essentiel. Les contacts déjà enregistrés restent consultables.</PlanLock>}
      <DataTable id="contacts" rows={rows} columns={columns} rowKey={(r) => r.c.id} initialSort={{ id: 'name', dir: 'asc' }}
        onOpen={(r) => navigate(`/contacts/${r.c.id}`)}
        toolbar={<>
          <label className="inline-select">Type
            <select value={kind} onChange={(e) => setKind(e.target.value as ContactKind | '')}>
              <option value="">Tous</option>
              {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <Checkbox label="Relances à faire" checked={dueOnly} onChange={setDueOnly} />
          <Checkbox label="Archivés" checked={archived} onChange={setArchived} />
        </>}
        rowActions={(r) => [
          { label: 'Ouvrir', onSelect: () => navigate(`/contacts/${r.c.id}`) },
          { label: 'Supprimer', danger: true, onSelect: async () => {
            if (await ask('Supprimer le contact', <>« {r.c.name} » sera supprimé. {r.linked > 0 ? `Il sera détaché de ${r.linked} bien(s).` : ''} Les échanges passés restent dans l’historique des biens.</>, 'Supprimer')) {
              if (await remove('pro_contacts', r.c.id)) notify('Contact supprimé.');
            }
          } },
        ]}
        bulkActions={(sel) => <>
          <Button size="sm" onClick={() => void exp('xlsx', sel)}>Excel</Button>
          <Button size="sm" onClick={() => void exp('csv', sel)}>CSV</Button>
          <Button size="sm" onClick={() => void exp('json', sel)}>JSON</Button>
        </>}
        empty={<EmptyState title={archived ? 'Aucun contact archivé' : 'Aucun contact'} action={!archived && <Button variant="primary" onClick={() => navigate('/contacts/nouveau')}>Ajouter un contact</Button>}>
          Les agences et agents saisis sur un bien apparaissent aussi ici.
        </EmptyState>}
      />
      <p className="muted small">Les prospects commerciaux d’Immo-Zen ne figurent jamais ici : ils relèvent de l’administration de la plateforme et sont stockés séparément (lot 3).</p>
      <div className="export-row">
        <span className="muted">Exporter la liste affichée :</span>
        <Button size="sm" onClick={() => void exp('xlsx', rows)}>Excel (.xlsx)</Button>
        <Button size="sm" onClick={() => void exp('csv', rows)}>CSV</Button>
        <Button size="sm" onClick={() => void exp('json', rows)}>JSON</Button>
      </div>
      {dialog}
    </>
  );
}

export function ContactDetailPage({ id }: { id: string }) {
  const { data, create, update, notify } = useStore();
  const isNew = id === 'nouveau';
  const existing = data.contacts.find((c) => c.id === id);
  const [draft, setDraft] = useState<Insert<Contact> & { name: string; kind: ContactKind }>(() => existing ? { ...existing } : { name: '', kind: 'agence' });
  const [edit, setEdit] = useState(isNew);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState('');
  const [channel, setChannel] = useState<Channel>('telephone');

  if (!isNew && !existing) return <EmptyState title="Contact introuvable" action={<Button onClick={() => navigate('/contacts')}>Retour aux contacts</Button>} />;
  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const agencies = data.contacts.filter((c) => c.kind === 'agence' && c.id !== id && !c.archived_at);
  const linked = existing ? data.properties.filter((p) => p.agency_id === existing.id || p.agent_id === existing.id) : [];
  const members = existing ? data.contacts.filter((c) => c.organization_id === existing.id) : [];
  const exchanges = existing ? data.events.filter((e) => e.contact_id === existing.id).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)) : [];

  async function save() {
    const e: Record<string, string> = {};
    if (!draft.name.trim()) e.name = 'Le nom est obligatoire.';
    if (draft.email && !EMAIL.test(draft.email.trim())) e.email = 'Adresse e-mail invalide.';
    setErrors(e);
    if (Object.keys(e).length) return;
    const { id: _i, user_id: _u, version: _v, created_at: _c, updated_at: _up, ...rest } = draft as Partial<Contact>;
    const payload: Insert<Contact> = { ...rest, name: draft.name.trim(), email: draft.email?.trim().toLowerCase() || null, organization_id: draft.kind === 'agence' ? null : draft.organization_id ?? null };
    if (existing) {
      const row = await update('pro_contacts', existing, payload, `Le contact « ${existing.name} »`);
      if (row) { setEdit(false); setDraft({ ...row }); notify('Contact enregistré.'); }
    } else {
      const row = await create('pro_contacts', payload);
      if (row) { notify('Contact ajouté.'); navigate(`/contacts/${row.id}`); }
    }
  }

  async function addExchange() {
    if (!existing || !summary.trim()) return;
    if (await create('timeline_events', { contact_id: existing.id, property_id: null, kind: 'exchange', channel, summary: summary.trim() })) setSummary('');
  }

  return (
    <>
      <p className="crumbs"><a href={href('/contacts')}>Contacts</a></p>
      <PageHeader title={isNew ? 'Nouveau contact' : existing!.name} subtitle={existing ? CONTACT_KIND_LABELS[existing.kind] : undefined}
        actions={edit ? <>
          <Button onClick={() => (isNew ? navigate('/contacts') : (setEdit(false), setDraft({ ...existing! })))}>Annuler</Button>
          <Button variant="primary" onClick={() => void save()}>Enregistrer</Button>
        </> : <>
          <Button onClick={() => setEdit(true)}>Modifier</Button>
          <Button onClick={async () => { await update('pro_contacts', existing!, { archived_at: existing!.archived_at ? null : new Date().toISOString() }, 'Le contact'); }}>{existing!.archived_at ? 'Désarchiver' : 'Archiver'}</Button>
        </>} />

      {edit ? (
        <Section>
          <div className="grid">
            <TextInput label="Nom" required wide value={draft.name} onChange={(v) => set('name', v)} error={errors.name} maxLength={200} />
            <Select label="Type" value={draft.kind} onChange={(v) => set('kind', v ?? 'autre')} options={KINDS} />
            {draft.kind !== 'agence' && (
              <Select label="Agence ou organisme" value={draft.organization_id ?? null} onChange={(v) => set('organization_id', v)} allowEmpty="Aucun" options={agencies.map((a) => [a.id, a.name] as const)} />
            )}
            {draft.kind !== 'agence' && !draft.organization_id && <TextInput label="Organisme (texte libre)" value={draft.organization_name} onChange={(v) => set('organization_name', v || null)} maxLength={200} />}
            <TextInput label="E-mail" type="email" value={draft.email} onChange={(v) => set('email', v || null)} error={errors.email} autoComplete="off" />
            <TextInput label="Téléphone" type="tel" value={draft.phone} onChange={(v) => set('phone', v || null)} maxLength={40} />
            <TextInput label="Secteur" value={draft.sector} onChange={(v) => set('sector', v || null)} maxLength={200} placeholder="Ex. Est parisien, 93" />
            <TextInput label="Prochaine relance" type="date" value={draft.next_follow_up} onChange={(v) => set('next_follow_up', v || null)} />
            <TextArea label="Notes" value={draft.notes} onChange={(v) => set('notes', v || null)} />
          </div>
        </Section>
      ) : existing && (
        <div className="two-col">
          <Section title="Coordonnées">
            <KeyValue items={[
              ['Organisme', existing.organization_id ? <a href={href(`/contacts/${existing.organization_id}`)}>{data.contacts.find((c) => c.id === existing.organization_id)?.name}</a> : existing.organization_name ?? '—'],
              ['E-mail', existing.email ? <a href={`mailto:${existing.email}`}>{existing.email}</a> : '—'],
              ['Téléphone', existing.phone ? <a href={`tel:${existing.phone.replace(/\s/g, '')}`}>{existing.phone}</a> : '—'],
              ['Secteur', existing.sector ?? '—'],
              ['Prochaine relance', date(existing.next_follow_up)],
              ['Archivé', existing.archived_at ? date(existing.archived_at) : 'Non'],
            ]} />
            {existing.notes && <p className="prewrap">{existing.notes}</p>}
            {members.length > 0 && (<>
              <h3>Agents de cette agence</h3>
              <ul className="plain">{members.map((m) => <li key={m.id}><a href={href(`/contacts/${m.id}`)}>{m.name}</a></li>)}</ul>
            </>)}
          </Section>
          <div>
            <Section title={`Biens liés (${linked.length})`}>
              {linked.length === 0 ? <p className="muted">Aucun bien.</p> : (
                <ul className="plain">{linked.map((p) => <li key={p.id}><a href={href(`/bien/${p.id}`)}>{p.title}</a> <span className="muted small">{STATUS_LABELS[p.status]}</span></li>)}</ul>
              )}
            </Section>
            <Section title="Échanges">
              <div className="exchange-form">
                <label className="inline-select">Canal
                  <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
                    {(Object.keys(CHANNEL_LABELS) as Channel[]).map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
                  </select>
                </label>
                <textarea aria-label="Compte rendu" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Compte rendu de l’échange" />
                <Button size="sm" variant="primary" disabled={!summary.trim()} onClick={() => void addExchange()}>Ajouter</Button>
              </div>
              {exchanges.length === 0 ? <p className="muted">Aucun échange enregistré.</p> : (
                <ol className="timeline">
                  {exchanges.map((e) => {
                    const prop = e.property_id ? data.properties.find((p) => p.id === e.property_id) : null;
                    return (
                      <li key={e.id}>
                        <time dateTime={e.occurred_at}>{dateTime(e.occurred_at)}</time>
                        <div>
                          <span className="tl-kind">{e.channel ? CHANNEL_LABELS[e.channel] : 'Échange'}{prop ? <>, à propos de <a href={href(`/bien/${prop.id}`)}>{prop.title}</a></> : null}</span>
                          <p className="prewrap">{e.summary}</p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </Section>
          </div>
        </div>
      )}
    </>
  );
}
