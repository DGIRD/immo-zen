import { useMemo, useState, type FormEvent } from 'react';
import { useStore } from '../data/store.tsx';
import type { Contact, Insert, OccupationStatus, OwnershipMode, Property, PropertyStatus, PropertyType, TaxRegime } from '../data/types.ts';
import { DPE_VALUES, OCCUPATION_LABELS, OWNERSHIP_LABELS, STATUS_LABELS, STATUS_ORDER, TAX_REGIME_LABELS, TYPE_LABELS } from '../domain/labels.ts';
import { money2, todayParis } from '../domain/format.ts';
import { ANNUAL_CHARGE_FIELDS, annualChargesTotal, LOAN_FIELDS, loanInfo, rentWithCharges } from '../domain/property.ts';
import { Button, NumberInput, PageHeader, Section, Select, TextArea, TextInput } from '../ui/components.tsx';
import { navigate } from '../ui/router.ts';
import { AddressFields } from '../ui/AddressFields.tsx';

type Draft = Insert<Property> & { title: string };
const NEW = '__new__';

const entries = <K extends string>(o: Record<K, string>) => Object.entries(o) as [K, string][];

export function PropertyFormPage({ id, mode }: { id?: string; mode: 'prospect' | 'owned' }) {
  const { data, create, update } = useStore();
  const existing = id ? data.properties.find((p) => p.id === id) : undefined;
  const [draft, setDraft] = useState<Draft>(() => existing ? { ...existing } : { title: '', status: mode === 'owned' ? 'acquis' : 'repere', property_type: 'appartement', vigilance: [] });
  const [newAgency, setNewAgency] = useState('');
  const [newAgent, setNewAgent] = useState('');
  const [agencyChoice, setAgencyChoice] = useState<string>(existing?.agency_id ?? '');
  const [agentChoice, setAgentChoice] = useState<string>(existing?.agent_id ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [vigilanceText, setVigilanceText] = useState('');

  const agencies = useMemo(() => data.contacts.filter((c) => c.kind === 'agence' && !c.archived_at).sort((a, b) => a.name.localeCompare(b.name, 'fr')), [data.contacts]);
  const agents = useMemo(() => data.contacts.filter((c) => c.kind === 'agent' && !c.archived_at && (!agencyChoice || agencyChoice === NEW || !c.organization_id || c.organization_id === agencyChoice))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr')), [data.contacts, agencyChoice]);

  if (id && !existing) return <PageHeader title="Bien introuvable" subtitle="Il a peut-être été supprimé." />;
  const owned = draft.status === 'acquis';
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!draft.title.trim()) e.title = 'Le titre est obligatoire.';
    for (const k of ['surface', 'asking_price', 'offer_price', 'works_budget', 'estimated_rent', 'charges_provision', 'acquisition_cost', 'rooms', ...ANNUAL_CHARGE_FIELDS.map(([f]) => f), 'loan_amount', 'loan_rate', 'loan_years', 'loan_insurance_monthly', 'loan_monthly_payment'] as const) {
      const v = draft[k];
      if (v !== null && v !== undefined && (!Number.isFinite(v) || v < 0)) e[k] = 'Nombre positif attendu.';
    }
    if (draft.loan_years === 0) e.loan_years = 'Durée supérieure à zéro.';
    if ((draft.loan_rate ?? 0) > 30) e.loan_rate = 'Taux annuel en %, 30 au plus.';
    if ((draft.loan_years ?? 0) > 40) e.loan_years = 'Durée de 40 ans au plus.';
    if (draft.loan_amount && !draft.loan_years && draft.loan_monthly_payment == null) e.loan_years = 'Indiquez la durée, ou la mensualité si vous la connaissez.';
    if (draft.surface === 0) e.surface = 'La surface doit être supérieure à zéro.';
    if (!owned && draft.listing_url && !/^https?:\/\//i.test(draft.listing_url)) e.listing_url = 'Adresse web commençant par http:// ou https://';
    if (agencyChoice === NEW && !newAgency.trim()) e.agency = 'Nom de l’agence à créer.';
    if (agentChoice === NEW && !newAgent.trim()) e.agent = 'Nom de l’agent à créer.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function ensureContact(choice: string, name: string, kind: 'agence' | 'agent', orgId: string | null): Promise<string | null | false> {
    if (!choice) return null;
    if (choice !== NEW) return choice;
    const c = await create('pro_contacts', { kind, name: name.trim(), organization_id: kind === 'agent' ? orgId : null } as Insert<Contact>);
    return c ? c.id : false;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    try {
      const agencyId = await ensureContact(agencyChoice, newAgency, 'agence', null);
      if (agencyId === false) return;
      const agentId = await ensureContact(agentChoice, newAgent, 'agent', agencyId);
      if (agentId === false) return;
      const { id: _i, user_id: _u, version: _v, created_at: _c, updated_at: _up, ...rest } = draft as Partial<Property>;
      const payload: Insert<Property> = { ...rest, title: draft.title.trim(), agency_id: agencyId, agent_id: agentId };
      if (!owned) { payload.occupation_status = null; }
      // N'envoyer la provision que si elle est renseignée (compatibilité avec une base pas encore migrée)
      for (const k of ['charges_provision', ...ANNUAL_CHARGE_FIELDS.map(([f]) => f), ...LOAN_FIELDS] as const) if (payload[k] === null || payload[k] === undefined) delete payload[k];
      if (existing) {
        const row = await update('properties', existing, payload, `Le bien « ${existing.title} »`);
        if (row) navigate(`/bien/${row.id}`);
      } else {
        const row = await create('properties', payload);
        if (row) navigate(`/bien/${row.id}`);
      }
    } finally {
      setBusy(false);
    }
  }

  const statusOptions = (existing ? STATUS_ORDER : STATUS_ORDER.filter((s) => (mode === 'owned' ? s === 'acquis' : s !== 'acquis' && s !== 'archive')))
    .map((s) => [s, STATUS_LABELS[s]] as const);

  return (
    <form onSubmit={submit} noValidate>
      <PageHeader title={existing ? `Modifier « ${existing.title} »` : mode === 'owned' ? 'Ajouter un bien détenu' : 'Ajouter un bien en prospection'}
        actions={<>
          <Button onClick={() => (existing ? navigate(`/bien/${existing.id}`) : history.back())}>Annuler</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</Button>
        </>} />
      {Object.keys(errors).length > 0 && <p className="form-error" role="alert">Corrigez les champs signalés.</p>}

      <Section title="Le bien">
        <div className="grid">
          <TextInput label="Titre" required wide value={draft.title} onChange={(v) => set('title', v)} error={errors.title} maxLength={200} placeholder="Ex. T2 lumineux proche gare" />
          <Select label="Type" value={draft.property_type ?? 'appartement'} onChange={(v) => set('property_type', (v ?? 'appartement') as PropertyType)} options={entries(TYPE_LABELS)} />
          <Select label="Statut d’acquisition" value={draft.status ?? 'repere'} onChange={(v) => set('status', (v ?? 'repere') as PropertyStatus)} options={statusOptions}
            hint={!owned && existing ? '« Acquis » transfère le bien dans Mes biens.' : undefined} />
          <AddressFields value={draft} onChange={(a) => setDraft((d) => ({ ...d, ...a }))} />
          <NumberInput label="Surface" suffix="m²" value={draft.surface} onChange={(v) => set('surface', v)} error={errors.surface} />
          <NumberInput label="Pièces" value={draft.rooms} onChange={(v) => set('rooms', v === null ? null : Math.round(v))} error={errors.rooms} />
          <Select label="DPE renseigné" value={draft.dpe ?? null} onChange={(v) => set('dpe', v)} allowEmpty="Non renseigné" options={DPE_VALUES.map((d) => [d, d] as const)} />
          {!owned && <TextInput label="Lien de l’annonce" type="url" wide value={draft.listing_url} onChange={(v) => set('listing_url', v || null)} error={errors.listing_url} placeholder="https://" />}
        </div>
      </Section>

      {owned ? (
        <Section title="Loyer">
          <div className="grid">
            <NumberInput label="Loyer hors charges" suffix="€/mois" value={draft.estimated_rent} onChange={(v) => set('estimated_rent', v)} error={errors.estimated_rent} />
            <NumberInput label="Provision sur charges" suffix="€/mois" value={draft.charges_provision} onChange={(v) => set('charges_provision', v)} error={errors.charges_provision} />
            <div className="field">
              <span className="label" id="loyer-cc">Loyer charges comprises</span>
              <output className="computed" aria-labelledby="loyer-cc">{money2(rentWithCharges(draft))}<small> / mois</small></output>
              <small className="muted">Calculé : loyer hors charges + provision.</small>
            </div>
          </div>
        </Section>
      ) : null}

      {owned ? (
        <Section title="Charges annuelles">
          <div className="grid">
            {ANNUAL_CHARGE_FIELDS.map(([k, label]) => (
              <NumberInput key={k} label={label} suffix="€/an" value={draft[k] ?? null} onChange={(v) => set(k, v)} error={errors[k]}
                hint={k === 'management_annual' ? 'Honoraires de l’agence ou de l’administrateur de biens.' : k === 'gli_annual' ? 'Garantie loyers impayés.' : undefined} />
            ))}
            <div className="field">
              <span className="label" id="charges-total">Total des charges</span>
              <output className="computed" aria-labelledby="charges-total">{money2(annualChargesTotal(draft) ?? 0)}<small> / an</small></output>
              <small className="muted">Soit {money2((annualChargesTotal(draft) ?? 0) / 12)} par mois.</small>
            </div>
          </div>
          <p className="muted small">Ces montants pré-remplissent les simulations du bien. Les dépenses réellement payées se saisissent dans Dépenses.</p>
        </Section>
      ) : (
        <Section title="Prix et loyer">
          <div className="grid">
            <NumberInput label="Prix affiché" suffix="€" value={draft.asking_price} onChange={(v) => set('asking_price', v)} error={errors.asking_price} />
            <NumberInput label="Prix proposé" suffix="€" value={draft.offer_price} onChange={(v) => set('offer_price', v)} error={errors.offer_price} />
            <NumberInput label="Budget travaux" suffix="€" value={draft.works_budget} onChange={(v) => set('works_budget', v)} error={errors.works_budget} />
            <NumberInput label="Loyer estimé hors charges" suffix="€/mois" value={draft.estimated_rent} onChange={(v) => set('estimated_rent', v)} error={errors.estimated_rent} />
          </div>
          <p className="muted small">Ces valeurs pré-remplissent les nouvelles simulations. Rendement et cash-flow sont calculés dans le simulateur.</p>
        </Section>
      )}

      {owned && <LoanSection draft={draft} set={set} errors={errors} snapshot={existing?.acquisition_snapshot ?? null} />}

      {owned && (
        <Section title="Détention">
          <div className="grid">
            <Select label="Mode de détention" value={draft.ownership_mode ?? null} onChange={(v) => set('ownership_mode', v as OwnershipMode | null)} allowEmpty="Non renseigné" options={entries(OWNERSHIP_LABELS)} />
            <Select label="Régime fiscal renseigné" value={draft.tax_regime ?? null} onChange={(v) => set('tax_regime', v as TaxRegime | null)} allowEmpty="Non renseigné" options={entries(TAX_REGIME_LABELS)}
              hint="Information déclarative, utilisée pour la synthèse annuelle (lot 3)." />
            <TextInput label="Date d’acquisition" type="date" value={draft.acquired_at} onChange={(v) => set('acquired_at', v || null)} />
            <NumberInput label="Coût d’acquisition réel" suffix="€" value={draft.acquisition_cost} onChange={(v) => set('acquisition_cost', v)} error={errors.acquisition_cost}
              hint="Prix + frais réellement payés. Sinon, le coût du scénario acquis est utilisé." />
            <Select label="Occupation" value={draft.occupation_status ?? 'vacant'} onChange={(v) => set('occupation_status', (v ?? 'vacant') as OccupationStatus)}
              options={entries(OCCUPATION_LABELS)} hint="« Loué » sera déterminé par les baux au lot 2." />
          </div>
        </Section>
      )}

      <Section title="Agence et agent">
        <div className="grid">
          <Select label="Agence" value={agencyChoice} onChange={(v) => { setAgencyChoice(v ?? ''); }} allowEmpty="Aucune" error={errors.agency}
            options={[...agencies.map((a) => [a.id, a.name] as const), [NEW, '+ Nouvelle agence…'] as const]} />
          {agencyChoice === NEW && <TextInput label="Nom de la nouvelle agence" value={newAgency} onChange={setNewAgency} error={errors.agency} />}
          <Select label="Agent" value={agentChoice} onChange={(v) => setAgentChoice(v ?? '')} allowEmpty="Aucun" error={errors.agent}
            options={[...agents.map((a) => [a.id, a.name] as const), [NEW, '+ Nouvel agent…'] as const]} />
          {agentChoice === NEW && <TextInput label="Nom du nouvel agent" value={newAgent} onChange={setNewAgent} error={errors.agent} />}
        </div>
        <p className="muted small">Coordonnées complètes, échanges et relances : rubrique Contacts.</p>
      </Section>

      {!owned && (
        <Section title="Suivi">
          <div className="grid">
            <TextInput label="Prochaine action" wide value={draft.next_action} onChange={(v) => set('next_action', v || null)} maxLength={300} placeholder="Ex. Demander les PV d’AG" />
            <TextInput label="Date de relance" type="date" value={draft.follow_up_date} onChange={(v) => set('follow_up_date', v || null)} />
            <TextInput label="Date et heure de visite" type="datetime-local" value={draft.visit_at ? toLocalInput(draft.visit_at) : ''}
              onChange={(v) => set('visit_at', v ? new Date(v).toISOString() : null)} />
          </div>
        </Section>
      )}

      <Section title="Commentaires et vigilance">
        <div className="grid">
          <TextArea label="Commentaires" value={draft.comments} onChange={(v) => set('comments', v || null)} rows={5} />
        </div>
        <div className="vigilance-edit">
          <p className="label">Éléments de vigilance</p>
          <ul>
            {(draft.vigilance ?? []).map((v, i) => (
              <li key={`${v}-${i}`}>
                <span>{v}</span>
                <button type="button" className="link danger" onClick={() => set('vigilance', (draft.vigilance ?? []).filter((_, j) => j !== i))}>Retirer</button>
              </li>
            ))}
          </ul>
          <div className="row">
            <input aria-label="Nouvel élément de vigilance" value={vigilanceText} placeholder="Ex. Toiture à refaire, procédure en copropriété…" onChange={(e) => setVigilanceText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (vigilanceText.trim()) { set('vigilance', [...(draft.vigilance ?? []), vigilanceText.trim()]); setVigilanceText(''); } } }} />
            <Button size="sm" onClick={() => { if (vigilanceText.trim()) { set('vigilance', [...(draft.vigilance ?? []), vigilanceText.trim()]); setVigilanceText(''); } }}>Ajouter</Button>
          </div>
        </div>
      </Section>

      <div className="form-foot">
        <Button onClick={() => (existing ? navigate(`/bien/${existing.id}`) : history.back())}>Annuler</Button>
        <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</Button>
      </div>
    </form>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function LoanSection({ draft, set, errors, snapshot }: {
  draft: Draft; set: <K extends keyof Draft>(k: K, v: Draft[K]) => void; errors: Record<string, string>; snapshot: Property['acquisition_snapshot'];
}) {
  const info = loanInfo(draft, todayParis());
  const snap = snapshot?.inputs;
  const snapLoan = snapshot?.results?.loanAmount ?? 0;
  const canImport = !draft.loan_amount && snap && snap.useLoan !== false && snapLoan > 0;
  return (
    <Section title="Crédit" actions={canImport ? (
      <Button size="sm" onClick={() => {
        set('loan_amount', snapLoan);
        if (snap.interestRate != null) set('loan_rate', snap.interestRate);
        if (snap.loanYears != null) set('loan_years', snap.loanYears);
        if (snap.insuranceRate != null) set('loan_insurance_monthly', Math.round(snapLoan * snap.insuranceRate / 12) / 100);
        if (!draft.loan_start_date && draft.acquired_at) set('loan_start_date', draft.acquired_at);
      }}>Reprendre le crédit de la simulation</Button>
    ) : undefined}>
      <div className="grid">
        <NumberInput label="Montant emprunté" suffix="€" value={draft.loan_amount ?? null} onChange={(v) => set('loan_amount', v)} error={errors.loan_amount} />
        <NumberInput label="Taux du crédit" suffix="% / an" value={draft.loan_rate ?? null} onChange={(v) => set('loan_rate', v)} error={errors.loan_rate} hint="Taux nominal, hors assurance" />
        <NumberInput label="Durée" suffix="ans" value={draft.loan_years ?? null} onChange={(v) => set('loan_years', v)} error={errors.loan_years} />
        <TextInput label="Première échéance" type="date" value={draft.loan_start_date} onChange={(v) => set('loan_start_date', v || null)} hint="Pour le capital restant dû et la fin du crédit" />
        <NumberInput label="Assurance emprunteur" suffix="€ / mois" value={draft.loan_insurance_monthly ?? null} onChange={(v) => set('loan_insurance_monthly', v)} error={errors.loan_insurance_monthly} />
        <NumberInput label="Mensualité hors assurance" suffix="€ / mois" value={draft.loan_monthly_payment ?? null} onChange={(v) => set('loan_monthly_payment', v)} error={errors.loan_monthly_payment}
          hint={info?.computed && info.payment ? `Calculée : ${money2(info.payment)}. Saisissez celle de votre offre de prêt si elle diffère.` : 'Laissez vide pour la calculer.'} />
        <div className="field">
          <span className="label" id="loan-total">Mensualité assurance comprise</span>
          <output className="computed" aria-labelledby="loan-total">{money2(info ? info.payment + info.insurance : 0)}<small> / mois</small></output>
          <small className="muted">{info?.remaining != null ? `Capital restant dû : ${money2(info.remaining)}${info.endDate ? `, fin le ${info.endDate.split('-').reverse().join('/')}` : ''}.` : 'Utilisée pour le cash-flow du bien.'}</small>
        </div>
      </div>
    </Section>
  );
}
