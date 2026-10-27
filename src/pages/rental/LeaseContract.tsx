import { useMemo, useState } from 'react';
import { useStore } from '../../data/store.tsx';
import type { ContractKind, LeaseContract } from '../../data/types.ts';
import { downloadBlob } from '../../domain/exporting.ts';
import { todayParis } from '../../domain/format.ts';
import { leaseTenants } from '../../domain/rental.ts';
import { buildDocPdf } from '../../domain/docPdf.ts';
import {
  buildContract, CONSTRUCTION_LABELS, CONTRACT_KIND_LABELS, defaultContract, defaultDuration, FURNITURE_MINIMUM, NOTICE_URL, type Block, type ContractContext,
} from '../../domain/leaseContract.ts';
import { Button, Checkbox, EmptyState, NumberInput, PageHeader, Section, Select, TextArea, TextInput } from '../../ui/components.tsx';
import { href, navigate } from '../../ui/router.ts';
import { useUpload } from './Documents.tsx';
import { AddressFields } from '../../ui/AddressFields.tsx';
import type { Lease, Property } from '../../data/types.ts';

const KIND_HELP: Record<ContractKind, string> = {
  vide: 'Résidence principale du locataire, logement nu : contrat type du décret n° 2015-587 (annexe 1), version issue du décret n° 2026-596 applicable aux baux conclus ou renouvelés depuis le 1er octobre 2026. Durée de 3 ans (6 ans pour une société bailleresse), dépôt de garantie d’un mois maximum.',
  meuble: 'Résidence principale du locataire, logement meublé : contrat type du décret n° 2015-587 (annexe 2), version issue du décret n° 2026-596 applicable aux baux conclus ou renouvelés depuis le 1er octobre 2026. Durée d’un an (9 mois pour un étudiant), dépôt de garantie de deux mois maximum, mobilier minimal obligatoire.',
  civil_secondaire: 'Logement qui n’est pas la résidence principale du locataire (résidence secondaire) : bail soumis au Code civil, durée et conditions libres. Pas de modèle officiel.',
  civil_societe: 'Logement loué à une société pour y loger un salarié ou un dirigeant désigné : bail soumis au Code civil. Pas de modèle officiel.',
  parking: 'Garage, box ou emplacement de stationnement loué seul : bail soumis au Code civil. Pas de modèle officiel.',
};

export function LeaseContractPage({ id }: { id: string }) {
  const store = useStore();
  const { data, notify } = store;
  const upload = useUpload();
  const [leaseEdit, setLeaseEdit] = useState<Pick<Lease, 'landlord_name' | 'landlord_address'> | null>(null);
  const [propEdit, setPropEdit] = useState<Pick<Property, 'address' | 'zip' | 'city'> | null>(null);
  const savedLease = data.leases.find((l) => l.id === id);
  const savedProperty = savedLease ? data.properties.find((p) => p.id === savedLease.property_id) : undefined;
  // informations du bail et du bien complétées depuis cet écran (enregistrées avec le contrat)
  const lease = savedLease && leaseEdit ? { ...savedLease, ...leaseEdit } : savedLease;
  const property = savedProperty && propEdit ? { ...savedProperty, ...propEdit } : savedProperty;
  const tenants = lease ? leaseTenants(lease.id, data.leaseTenants, data.tenants, false) : [];
  const ctx: ContractContext | null = lease && property ? { lease, property, tenants, today: todayParis() } : null;
  const [draft, setDraft] = useState<LeaseContract | null>(null);
  const [share, setShare] = useState(true);
  const [busy, setBusy] = useState(false);
  const c = draft ?? (ctx ? defaultContract(ctx) : null);
  const doc = useMemo(() => (c && ctx ? buildContract(c, ctx) : null), [c, ctx]);
  if (!lease || !property || !ctx || !c || !doc) return <EmptyState title="Bail introuvable" action={<Button onClick={() => navigate('/baux')}>Retour aux baux</Button>} />;

  const set = <K extends keyof LeaseContract>(k: K, v: LeaseContract[K]) => setDraft({ ...c, [k]: v });
  const setKind = (kind: ContractKind) => setDraft({
    ...c, kind, duration_months: defaultDuration(kind, c.landlord_kind, c.student),
    furniture: kind === 'meuble' && !c.furniture?.length ? [...FURNITURE_MINIMUM] : c.furniture,
    notice_months: kind === 'parking' ? 1 : kind.startsWith('civil') ? 3 : null,
  });
  const housing = c.kind === 'vide' || c.kind === 'meuble';
  const dirty = draft !== null || leaseEdit !== null || propEdit !== null;

  async function save(): Promise<boolean> {
    if (!dirty) return true;
    if (propEdit && !(await store.update('properties', savedProperty!, propEdit, `Le bien « ${savedProperty!.title} »`))) return false;
    setPropEdit(null);
    const patch = { contract: c, ...(leaseEdit ?? {}), ...(housing && savedLease!.furnished !== (c!.kind === 'meuble') ? { furnished: c!.kind === 'meuble' } : {}) };
    const row = await store.update('leases', savedLease!, patch, 'Le bail');
    if (row) { setDraft(null); setLeaseEdit(null); notify('Informations du contrat enregistrées.'); }
    return !!row;
  }
  async function pdfBytes() {
    const lib = await import('pdf-lib');
    return buildDocPdf(lib as never, { title: doc!.title, subtitle: doc!.subtitle, sections: doc!.sections, footer: doc!.title });
  }
  async function download() {
    setBusy(true);
    try { downloadBlob(new Blob([await pdfBytes() as BlobPart], { type: 'application/pdf' }), doc!.fileName); } finally { setBusy(false); }
  }
  async function saveToDocuments() {
    setBusy(true);
    try {
      if (!(await save())) return;
      const bytes = await pdfBytes();
      const file = new File([bytes as BlobPart], doc!.fileName, { type: 'application/pdf' });
      const row = await upload(file, { title: `${doc!.title} – ${todayParis().split('-').reverse().join('/')}`, category: 'bail', property_id: property!.id, lease_id: lease!.id, shared_with_tenant: share });
      if (row) notify(share ? 'Bail enregistré dans les documents et partagé avec le locataire.' : 'Bail enregistré dans les documents du bail.');
    } finally { setBusy(false); }
  }

  return (
    <>
      <p className="crumbs"><a href={href('/baux')}>Locataires et baux</a>, <a href={href(`/baux/${lease.id}`)}>Bail {property.title}</a></p>
      <PageHeader title="Contrat de bail" subtitle={`${property.title} – ${CONTRACT_KIND_LABELS[c.kind]}`}
        actions={<>
          <Button onClick={() => void save()} disabled={!dirty}>Enregistrer</Button>
          <Button onClick={() => void download()} disabled={busy || doc.errors.length > 0} title={doc.errors.length ? 'Corrigez d’abord les points bloquants' : undefined}>Télécharger le PDF</Button>
          <Button variant="primary" onClick={() => void saveToDocuments()} disabled={busy || doc.errors.length > 0}>Enregistrer dans les documents</Button>
        </>} />
      <p className="note">Le contrat reprend les informations du bail (loyer, charges, dépôt, dates, révision), du bien et des locataires, complétées ci-dessous. Les baux vide et meublé suivent les contrats types officiels (décret n° 2015-587 du 29 mai 2015) ; le bail civil et la location de parking n’ont pas de modèle officiel. Relisez le contrat avant signature : il ne remplace pas le conseil d’un professionnel.</p>
      {dirty && <p className="unsaved" role="status">Modifications non enregistrées.</p>}
      {doc.errors.length > 0 && (
        <div className="form-error" role="alert"><strong>À corriger avant d’éditer le contrat :</strong><ul>{doc.errors.map((e) => <li key={e}>{e}</li>)}</ul></div>
      )}
      {doc.warnings.length > 0 && <div className="note"><strong>Points à vérifier :</strong><ul>{doc.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}

      <div className="contract-layout">
        <div>
          <Section title="Type de bail">
            <div className="grid">
              <Select label="Type de bail" wide value={c.kind} onChange={(v) => setKind(v ?? 'vide')} options={Object.entries(CONTRACT_KIND_LABELS) as [ContractKind, string][]} />
            </div>
            <p className="muted small">{KIND_HELP[c.kind]}</p>
          </Section>

          <Section title="Parties">
            <p className="muted small">Locataire(s) : {tenants.map((t) => [t.first_name, t.last_name].filter(Boolean).join(' ')).join(', ') || '—'} (<a href={href(`/baux/${lease.id}/modifier`)}>titulaires du bail</a>). Le nom et l’adresse du bailleur figurent aussi sur les quittances.</p>
            <div className="grid">
              <TextInput label="Nom du bailleur" value={lease.landlord_name} onChange={(v) => setLeaseEdit({ landlord_name: v || null, landlord_address: lease.landlord_address })} maxLength={200} />
              <TextInput label="Adresse du bailleur" wide value={lease.landlord_address} onChange={(v) => setLeaseEdit({ landlord_name: lease.landlord_name, landlord_address: v || null })} maxLength={500} />
              <Select label="Le bailleur est" value={c.landlord_kind ?? 'physique'} onChange={(v) => setDraft({ ...c, landlord_kind: v ?? 'physique', duration_months: c.kind === 'vide' ? defaultDuration('vide', v ?? 'physique', false) : c.duration_months })}
                options={[['physique', 'Une personne physique'], ['sci_familiale', 'Une SCI familiale'], ['morale', 'Une personne morale (société)']] as const} />
              <TextInput label="E-mail du bailleur (facultatif)" type="email" value={c.landlord_email} onChange={(v) => set('landlord_email', v || null)} />
              {housing && <TextInput label="Téléphone portable du bailleur (facultatif)" type="tel" value={c.landlord_phone} onChange={(v) => set('landlord_phone', v || null)} hint="Mention facultative du contrat type depuis le 1er octobre 2026. Celui des locataires est repris de leur fiche." />}
              <TextInput label="Mandataire (facultatif)" wide value={c.landlord_representative} onChange={(v) => set('landlord_representative', v || null)} placeholder="Nom, adresse, activité, n° de carte professionnelle" />
              {c.kind === 'civil_societe' ? (
                <>
                  <TextInput label="Société locataire" value={c.company_name} onChange={(v) => set('company_name', v || null)} />
                  <TextInput label="SIREN" value={c.company_id} onChange={(v) => set('company_id', v || null)} />
                  <TextInput label="Représentée par" wide value={c.company_representative} onChange={(v) => set('company_representative', v || null)} placeholder="Nom et fonction" />
                  <TextInput label="Occupant désigné" wide value={c.occupant_name} onChange={(v) => set('occupant_name', v || null)} placeholder="Salarié ou dirigeant logé" />
                </>
              ) : <TextInput label="Garant (facultatif)" wide value={c.guarantor} onChange={(v) => set('guarantor', v || null)} placeholder="Nom et adresse de la caution" />}
            </div>
          </Section>

          {c.kind === 'parking' ? (
            <Section title="Emplacement">
              <div className="grid">
                <AddressFields value={property} onChange={(a) => setPropEdit(a)} />
                <TextInput label="Emplacement" wide value={c.parking_spot} onChange={(v) => set('parking_spot', v || null)} placeholder="Box n° 12, 2e sous-sol" />
                <TextInput label="Accessoires (badge, télécommande…)" wide value={c.private_annexes} onChange={(v) => set('private_annexes', v || null)} />
              </div>
            </Section>
          ) : (
            <Section title="Logement">
              <div className="grid">
                <AddressFields value={property} onChange={(a) => setPropEdit(a)} />
                <Select label="Type d’habitat" value={c.building_type ?? 'collectif'} onChange={(v) => set('building_type', v ?? 'collectif')} options={[['collectif', 'Immeuble collectif'], ['individuel', 'Individuel']] as const} />
                <Select label="Régime juridique" value={c.ownership_regime ?? 'copropriete'} onChange={(v) => set('ownership_regime', v ?? 'copropriete')} options={[['copropriete', 'Copropriété'], ['monopropriete', 'Monopropriété']] as const} />
                <Select label="Période de construction" value={c.construction_period ?? null} allowEmpty="À préciser" onChange={(v) => set('construction_period', v ?? undefined)} options={Object.entries(CONSTRUCTION_LABELS) as [NonNullable<LeaseContract['construction_period']>, string][]} />
                <NumberInput label="Surface habitable" suffix="m²" value={c.surface ?? null} onChange={(v) => set('surface', v)} />
                <NumberInput label="Pièces principales" value={c.rooms ?? null} onChange={(v) => set('rooms', v === null ? null : Math.round(v))} />
                <TextInput label="Identifiant fiscal du logement (facultatif)" value={c.tax_id} onChange={(v) => set('tax_id', v || null)} />
                <TextInput label="Autres parties du logement" wide value={c.other_parts} onChange={(v) => set('other_parts', v || null)} placeholder="Balcon, terrasse, cave, grenier…" />
                <TextInput label="Éléments d’équipement" wide value={c.equipment} onChange={(v) => set('equipment', v || null)} placeholder="Cuisine équipée, installations sanitaires…" />
                <Select label="Chauffage" value={c.heating ?? 'individuel'} onChange={(v) => set('heating', v ?? 'individuel')} options={[['individuel', 'Individuel'], ['collectif', 'Collectif']] as const} />
                <Select label="Eau chaude" value={c.hot_water ?? 'individuel'} onChange={(v) => set('hot_water', v ?? 'individuel')} options={[['individuel', 'Individuelle'], ['collectif', 'Collective']] as const} />
                {(c.heating === 'collectif' || c.hot_water === 'collectif') && <TextInput label="Répartition des consommations collectives" wide value={c.collective_split} onChange={(v) => set('collective_split', v || null)} />}
                {housing && <Select label="Destination" value={c.usage ?? 'habitation'} onChange={(v) => set('usage', v ?? 'habitation')} options={[['habitation', 'Habitation'], ['mixte', 'Mixte professionnel et habitation']] as const} />}
                {housing && <Checkbox label="Logement soumis à la servitude de résidence principale (art. L. 151-14-1 du code de l’urbanisme)" checked={!!c.principal_residence_servitude} onChange={(v) => set('principal_residence_servitude', v)} />}
                <TextInput label="Annexes privatives" wide value={c.private_annexes} onChange={(v) => set('private_annexes', v || null)} placeholder="Cave n° 4, parking n° 12…" />
                <TextInput label="Parties communes" wide value={c.common_areas} onChange={(v) => set('common_areas', v || null)} placeholder="Ascenseur, local vélos, espaces verts…" />
                <TextInput label="Accès internet" wide value={c.telecom} onChange={(v) => set('telecom', v || null)} placeholder="Raccordement à la fibre optique…" />
              </div>
              <p className="muted small">Classe énergie du DPE : {property.dpe ?? 'non renseignée'} (fiche du bien).</p>
            </Section>
          )}

          <Section title="Durée">
            <div className="grid">
              <NumberInput label="Durée du bail" suffix="mois" value={c.duration_months ?? null} onChange={(v) => set('duration_months', v === null ? null : Math.round(v))} />
              {c.kind === 'vide' && <TextInput label="Motif d’une durée réduite (facultatif)" wide value={c.reduced_reason} onChange={(v) => set('reduced_reason', v || null)} hint="Événement précis justifiant la reprise du logement par le bailleur personne physique (durée d’un an au minimum)." />}
              {c.kind === 'meuble' && <Checkbox label="Location à un étudiant (9 mois, sans reconduction)" checked={!!c.student} onChange={(v) => setDraft({ ...c, student: v, duration_months: v ? 9 : 12 })} />}
              {!housing && <Checkbox label="Reconduction tacite" checked={c.tacit_renewal !== false} onChange={(v) => set('tacit_renewal', v)} />}
              {!housing && <NumberInput label="Préavis de congé" suffix="mois" value={c.notice_months ?? null} onChange={(v) => set('notice_months', v === null ? null : Math.round(v))} />}
            </div>
          </Section>

          <Section title="Loyer et paiement">
            <p className="muted small">Loyer, charges, dépôt de garantie, jour de paiement et révision IRL : repris du bail.</p>
            <div className="grid">
              <Select label="Paiement" value={c.payment_terms ?? 'echoir'} onChange={(v) => set('payment_terms', v ?? 'echoir')} options={[['echoir', 'D’avance (à échoir)'], ['echu', 'À terme échu']] as const} />
              <TextInput label="Lieu ou mode de paiement" wide value={c.payment_place} onChange={(v) => set('payment_place', v || null)} placeholder="Virement sur le compte indiqué par le bailleur" />
              {housing && (
                <>
                  <NumberInput label="Dépenses d’énergie : estimation basse" suffix="€/an" value={c.energy_cost_min ?? null} onChange={(v) => set('energy_cost_min', v)} hint="Indiquée sur le DPE." />
                  <NumberInput label="Dépenses d’énergie : estimation haute" suffix="€/an" value={c.energy_cost_max ?? null} onChange={(v) => set('energy_cost_max', v)} />
                  <NumberInput label="Année de référence des prix" value={c.energy_ref_year ?? null} onChange={(v) => set('energy_ref_year', v === null ? null : Math.round(v))} />
                  <TextInput label="Date de révision (facultatif)" type="date" value={c.revision_date ?? ''} onChange={(v) => set('revision_date', v || null)} hint="À défaut : chaque année à la date anniversaire du contrat." />
                  {c.kind === 'vide' && <TextInput label="Contribution pour le partage des économies de charges" wide value={c.charges_economy} onChange={(v) => set('charges_economy', v || null)} placeholder="Montant, durée restant à courir, travaux justifiant la contribution" />}
                  {tenants.length > 1 && <NumberInput label="Assurance souscrite pour le compte des colocataires" suffix="€/an" value={c.coloc_insurance_annual ?? null} onChange={(v) => set('coloc_insurance_annual', v)} hint="Montant total annuel récupérable (récupéré par douzième)." />}
                  <TextInput label="Réévaluation d’un loyer manifestement sous-évalué" wide value={c.rent_reassessment} onChange={(v) => set('rent_reassessment', v || null)} placeholder="Uniquement lors d’un renouvellement : montant et modalités" />
                  <NumberInput label="Loyer du précédent locataire" suffix="€" value={c.previous_rent ?? null} onChange={(v) => set('previous_rent', v)} hint="Obligatoire s’il a quitté le logement moins de 18 mois avant la signature." />
                  <TextInput label="Date du dernier versement" type="date" value={c.previous_rent_date ?? ''} onChange={(v) => set('previous_rent_date', v || null)} />
                  <Checkbox label="Logement en zone tendue ou soumis à l’encadrement des loyers" checked={!!c.zone_tendue} onChange={(v) => set('zone_tendue', v)} />
                  {c.zone_tendue && (
                    <>
                      <NumberInput label="Loyer de référence" suffix="€/m²" value={c.reference_rent ?? null} onChange={(v) => set('reference_rent', v)} />
                      <NumberInput label="Loyer de référence majoré" suffix="€/m²" value={c.reference_rent_increased ?? null} onChange={(v) => set('reference_rent_increased', v)} />
                      <NumberInput label="Complément de loyer" suffix="€" value={c.rent_complement ?? null} onChange={(v) => set('rent_complement', v)} />
                      <TextInput label="Justification du complément" wide value={c.rent_complement_reason} onChange={(v) => set('rent_complement_reason', v || null)} />
                    </>
                  )}
                </>
              )}
            </div>
          </Section>

          {housing && (
            <Section title="Travaux et honoraires">
              <div className="grid">
                <TextArea label="Travaux réalisés depuis le dernier bail" value={c.works_done} onChange={(v) => set('works_done', v || null)} rows={2} />
                <TextArea label="Majoration de loyer pour travaux du bailleur" value={c.works_landlord} onChange={(v) => set('works_landlord', v || null)} rows={2} />
                <TextArea label="Diminution de loyer pour travaux du locataire" value={c.works_tenant} onChange={(v) => set('works_tenant', v || null)} rows={2} />
                <NumberInput label="Honoraires bailleur : visite, dossier, bail" suffix="€" value={c.agency_fees_landlord ?? null} onChange={(v) => set('agency_fees_landlord', v)} />
                <NumberInput label="Honoraires bailleur : état des lieux d’entrée" suffix="€" value={c.agency_fees_landlord_edl ?? null} onChange={(v) => set('agency_fees_landlord_edl', v)} />
                <NumberInput label="Honoraires bailleur : autres prestations" suffix="€" value={c.agency_fees_landlord_other ?? null} onChange={(v) => set('agency_fees_landlord_other', v)} />
                <NumberInput label="Honoraires locataire : visite, dossier, bail" suffix="€" value={c.agency_fees_tenant ?? null} onChange={(v) => set('agency_fees_tenant', v)} />
                <NumberInput label="Honoraires locataire : état des lieux d’entrée" suffix="€" value={c.agency_fees_tenant_edl ?? null} onChange={(v) => set('agency_fees_tenant_edl', v)} />
                <NumberInput label="Plafond locataire (visite, dossier, bail)" suffix="€/m²" value={c.agency_cap_m2 ?? null} onChange={(v) => set('agency_cap_m2', v)} />
                <NumberInput label="Plafond locataire (état des lieux)" suffix="€/m²" value={c.agency_cap_edl_m2 ?? null} onChange={(v) => set('agency_cap_edl_m2', v)} />
              </div>
            </Section>
          )}

          {c.kind === 'meuble' && (
            <Section title="Mobilier">
              <TextArea label="Éléments de mobilier (un par ligne)" rows={8} value={(c.furniture ?? []).join('\n')} onChange={(v) => set('furniture', v.split('\n').map((x) => x.trim()).filter(Boolean))}
                hint="Liste minimale du décret n° 2015-981 proposée ; complétez-la. L’inventaire détaillé est annexé au bail." />
            </Section>
          )}

          {housing && (
            <Section title="Clause résolutoire et annexes">
              <p className="muted small">La résiliation pour défaut de paiement du loyer, des charges ou du dépôt de garantie (six semaines après un commandement de payer) figure toujours au contrat. Les clauses suivantes sont facultatives.</p>
              <div className="grid">
                <Checkbox label="Résiliation à défaut d’assurance des risques locatifs (un mois après un commandement)" checked={c.clause_insurance !== false} onChange={(v) => set('clause_insurance', v)} />
                <Checkbox label="Résiliation pour troubles de voisinage constatés par une décision de justice définitive" checked={c.clause_neighbours !== false} onChange={(v) => set('clause_neighbours', v)} />
                <Checkbox label="Autorisation préalable de mise en location annexée (« permis de louer »)" checked={!!c.rental_permit} onChange={(v) => set('rental_permit', v)} />
              </div>
            </Section>
          )}

          <Section title="Conditions particulières et signature">
            <div className="grid">
              <TextArea label="Conditions particulières" value={c.special_conditions} onChange={(v) => set('special_conditions', v || null)} rows={3} />
              <TextInput label="Fait à" value={c.signed_place} onChange={(v) => set('signed_place', v || null)} placeholder={property.city ?? ''} />
              <TextInput label="Le" type="date" value={c.signed_on ?? ''} onChange={(v) => set('signed_on', v || null)} />
            </div>
            <Checkbox label="Partager le contrat avec le locataire (espace locataire) en l’enregistrant dans les documents" checked={share} onChange={setShare} />
            {housing && <p className="muted small">À joindre au bail : notice d’information de l’arrêté du 29 mai 2015 (<a href={NOTICE_URL} target="_blank" rel="noreferrer">service-public.fr</a>), diagnostics, état des lieux{c.kind === 'meuble' ? ', inventaire du mobilier' : ''}.</p>}
          </Section>
        </div>

        <aside className="contract-preview" aria-label="Aperçu du contrat">
          <h2>{doc.title}</h2>
          <p className="muted small">{doc.subtitle}</p>
          {doc.sections.map((s) => (
            <section key={s.title}>
              <h3>{s.title}</h3>
              {s.blocks.map((b, i) => <PreviewBlock key={i} b={b} />)}
            </section>
          ))}
        </aside>
      </div>
    </>
  );
}

function PreviewBlock({ b }: { b: Block }) {
  if (b.t === 'p') return <p>{b.text}</p>;
  if (b.t === 'list') return <ul>{b.items.map((x) => <li key={x}>{x}</li>)}</ul>;
  if (b.t === 'kv') return <dl className="contract-kv">{b.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
  return <div className="contract-sign">{b.parties.map((p) => <div key={p}>{p}</div>)}</div>;
}
