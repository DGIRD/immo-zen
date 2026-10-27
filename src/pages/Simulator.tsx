import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../data/store.tsx';
import type { Property, PropertyStatus, PropertyType, Scenario } from '../data/types.ts';
import { DPE_VALUES, STATUS_LABELS, STATUS_ORDER, TYPE_LABELS } from '../domain/labels.ts';
import { AddressFields } from '../ui/AddressFields.tsx';
import { downloadBlob, stamp, toXlsx } from '../domain/exporting.ts';
import { money, money2, pct } from '../domain/format.ts';
import { inputsFromProperty, isProspect, primaryScenario, prospectFieldsFromSimulation } from '../domain/property.ts';
import { autoProvisionMonthly, autoRecoverableAnnual, ENGINE_VERSION, normalizeInputs, simulate, simulatedCashflow, summarize, type FieldError, type SimulationInputs } from '../domain/simulator.ts';
import { Button, Checkbox, NumberInput, PageHeader, Section, Select, TextArea, TextInput } from '../ui/components.tsx';
import { EstimatePanel, type EstimateFields } from '../ui/EstimatePanel.tsx';
import { ListingImport } from '../ui/ListingImport.tsx';
import type { ListingData, ListingField } from '../../supabase/functions/_shared/listing.ts';
import { href, navigate } from '../ui/router.ts';

/**
 * Fiche d'un bien en prospection et sa simulation, saisies dans un seul écran (une seule simulation par bien).
 * Sans `propertyId` : création d'un bien en prospection. Bien détenu : simulation seule, la fiche se modifie dans Mes biens.
 */
export function SimulatorPage({ propertyId }: { propertyId?: string }) {
  const { data, simulatorDefaults, create, update, notify } = useStore();
  const initialProperty = propertyId ?? null;
  const property = initialProperty ? data.properties.find((p) => p.id === initialProperty) : undefined;
  const scenario = property ? primaryScenario(property, data.scenarios) ?? undefined : undefined;
  const scenarioId = scenario?.id;

  const initial = useMemo<SimulationInputs>(() => {
    if (scenario) {
      const base = normalizeInputs(scenario.inputs, simulatorDefaults);
      // champs ajoutés après l'enregistrement du scénario : repris du bien lié
      if (property && !base.surface && property.surface) base.surface = property.surface;
      if (property && !base.askingPrice && property.asking_price) base.askingPrice = property.asking_price;
      return base;
    }
    if (property) return inputsFromProperty(property, simulatorDefaults);
    return { ...simulatorDefaults };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario?.id, property?.id]);

  const [inputs, setInputs] = useState<SimulationInputs>(initial);
  const [linked, setLinked] = useState<string | null>(initialProperty);
  // Fiche du bien saisie dans le même écran (prospection) : une seule saisie pour le bien et sa simulation
  const bienOf = (p?: Property): Bien => ({
    title: p?.title ?? '', address: p?.address ?? null, zip: p?.zip ?? null, city: p?.city ?? null, property_type: p?.property_type ?? 'appartement',
    rooms: p?.rooms ?? null, dpe: p?.dpe ?? null, listing_url: p?.listing_url ?? null, status: p?.status ?? 'repere',
    agency_id: p?.agency_id ?? null, agent_id: p?.agent_id ?? null, next_action: p?.next_action ?? null, follow_up_date: p?.follow_up_date ?? null,
    visit_at: p?.visit_at ?? null, comments: p?.comments ?? null, vigilance: p?.vigilance ?? [],
    estimate_low: p?.estimate_low ?? null, estimate_high: p?.estimate_high ?? null, estimate_median: p?.estimate_median ?? null,
    estimate_on: p?.estimate_on ?? null, estimate_source: p?.estimate_source ?? null, estimate_details: p?.estimate_details ?? null,
  });
  // nouvelle agence ou nouvel agent créés à l'enregistrement
  const [newAgency, setNewAgency] = useState('');
  const [newAgent, setNewAgent] = useState('');
  const [bien, setBien] = useState<Bien>(() => bienOf(property));
  const [bienBase, setBienBase] = useState<Bien>(() => bienOf(property));
  const setB = <K extends keyof Bien>(k: K, v: Bien[K]) => setBien((b) => ({ ...b, [k]: v }));
  const [detail, setDetail] = useState<'annuel' | 'mensuel' | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setInputs(initial); }, [initial]);

  const outcome = useMemo(() => simulate(inputs), [inputs]);
  const err = (f: keyof SimulationInputs) => (!outcome.ok ? outcome.errors.find((e: FieldError) => e.field === f)?.message : undefined);
  const set = <K extends keyof SimulationInputs>(k: K, v: SimulationInputs[K] | null) => setInputs((i) => ({ ...i, [k]: v ?? (typeof i[k] === 'number' ? 0 : i[k]) }));
  const num = (k: keyof SimulationInputs, label: string, suffix: string, hint?: string) => (
    <NumberInput label={label} suffix={suffix} value={inputs[k] as number} onChange={(v) => set(k, (v ?? 0) as never)} error={err(k)} hint={hint} />
  );
  // Charges de copropriété : part récupérable et provision proposées à 80 %, sauf si elles ont été modifiées à la main
  const setCopro = (v: number | null) => setInputs((i) => {
    const copro = v ?? 0;
    const next = { ...i, coproChargesAnnual: copro };
    if (!i.coproRecoverableAnnual || i.coproRecoverableAnnual === autoRecoverableAnnual(i.coproChargesAnnual)) next.coproRecoverableAnnual = autoRecoverableAnnual(copro);
    if (!i.chargesProvisionMonthly || i.chargesProvisionMonthly === autoProvisionMonthly(i.coproChargesAnnual)) next.chargesProvisionMonthly = autoProvisionMonthly(copro);
    return next;
  });
  const live = outcome.ok ? outcome.result : null;

  /** Reprend dans la fiche et la simulation les caractéristiques retenues de l'annonce. */
  function applyListing(l: ListingData, fields: ListingField[], finalUrl: string | null) {
    const has = (k: ListingField) => fields.includes(k) && l[k] !== null;
    setBien((b) => {
      const n = { ...b };
      if (has('title')) n.title = l.title!.slice(0, 200);
      if (has('property_type')) n.property_type = l.property_type!;
      if (has('rooms')) n.rooms = Math.round(l.rooms!);
      if (has('address')) n.address = l.address;
      if (has('zip')) n.zip = l.zip;
      if (has('city')) n.city = l.city;
      if (has('dpe')) n.dpe = l.dpe;
      if (finalUrl && !n.listing_url) n.listing_url = finalUrl;
      // détails sans champ dédié : notés dans les commentaires
      const notes = [has('bedrooms') ? `${l.bedrooms} chambre${l.bedrooms! > 1 ? 's' : ''}` : null, has('floor') ? (l.floor === 0 ? 'rez-de-chaussée' : `${l.floor}e étage`) : null,
        has('furnished') && l.furnished ? 'vendu meublé' : null].filter(Boolean).join(', ');
      if (notes && !(n.comments ?? '').includes('D’après l’annonce')) n.comments = [n.comments, `D’après l’annonce : ${notes}.`].filter(Boolean).join('\n');
      if (has('dpe') && (l.dpe === 'F' || l.dpe === 'G') && !n.vigilance.some((x) => /DPE/.test(x))) n.vigilance = [...n.vigilance, `DPE ${l.dpe} : location interdite ou loyer gelé, travaux à prévoir`];
      return n;
    });
    setInputs((i) => {
      const n = { ...i };
      // prix proposé vide : il part du prix affiché, honoraires inclus (montant des honoraires connu ou à saisir)
      if (has('price')) { n.askingPrice = l.price!; if (!i.price) { n.price = l.price!; n.priceMode = 'honoraires_inclus'; n.agencyFees = 0; } }
      if (has('agency_fees') && (n.priceMode === 'honoraires_inclus')) n.agencyFees = l.agency_fees!;
      if (has('surface')) n.surface = l.surface!;
      if (has('property_tax_annual')) n.propertyTaxAnnual = l.property_tax_annual!;
      if (has('copro_charges_annual')) {
        const c = l.copro_charges_annual!;
        if (!i.coproRecoverableAnnual || i.coproRecoverableAnnual === autoRecoverableAnnual(i.coproChargesAnnual)) n.coproRecoverableAnnual = autoRecoverableAnnual(c);
        if (!i.chargesProvisionMonthly || i.chargesProvisionMonthly === autoProvisionMonthly(i.coproChargesAnnual)) n.chargesProvisionMonthly = autoProvisionMonthly(c);
        n.coproChargesAnnual = c;
      }
      return n;
    });
    notify(`${fields.length} caractéristique${fields.length > 1 ? 's' : ''} reprise${fields.length > 1 ? 's' : ''} de l’annonce : vérifiez-les avant d’enregistrer.`);
  }
  const dirty = JSON.stringify(inputs) !== JSON.stringify(initial) || linked !== initialProperty || JSON.stringify(bien) !== JSON.stringify(bienBase);

  const linkedProp = linked ? data.properties.find((p) => p.id === linked) : undefined;
  async function save() {
    if (!outcome.ok) { notify('Corrigez les valeurs signalées avant d’enregistrer.', 'error'); return; }
    const editable = !linkedProp || isProspect(linkedProp);
    if (editable && !bien.title.trim()) { notify('Donnez un titre au bien.', 'error'); return; }
    if (editable && bien.listing_url && !/^https?:\/\//i.test(bien.listing_url)) { notify('Le lien de l’annonce doit commencer par http:// ou https://', 'error'); return; }
    if (bien.agency_id === NEW && !newAgency.trim()) { notify('Indiquez le nom de la nouvelle agence.', 'error'); return; }
    if (bien.agent_id === NEW && !newAgent.trim()) { notify('Indiquez le nom du nouvel agent.', 'error'); return; }
    setBusy(true);
    try {
      const fields = prospectFieldsFromSimulation(inputs, outcome.result);
      // contacts créés depuis la fiche
      let agencyId = bien.agency_id, agentId = bien.agent_id;
      if (agencyId === NEW) { const c = await create('pro_contacts', { kind: 'agence', name: newAgency.trim() } as never); if (!c) return; agencyId = (c as { id: string }).id; setNewAgency(''); }
      if (agentId === NEW) { const c = await create('pro_contacts', { kind: 'agent', name: newAgent.trim(), organization_id: agencyId } as never); if (!c) return; agentId = (c as { id: string }).id; setNewAgent(''); }
      const bienOut: Partial<Property> = { ...bien, agency_id: agencyId, agent_id: agentId, title: bien.title.trim().slice(0, 200) };
      // estimation : envoyée seulement si renseignée (base pas encore migrée)
      for (const k of ['estimate_low', 'estimate_high', 'estimate_median', 'estimate_on', 'estimate_source', 'estimate_details'] as const) if (bienOut[k] == null) delete bienOut[k];
      let prop: Property | null | undefined = linkedProp;
      let created = false;
      if (!prop) {
        // Le simulateur alimente la prospection : nouveau bien « Repéré » avec les valeurs simulées
        prop = await create('properties', { ...bienOut, ...fields } as never);
        if (!prop) return;
        created = true;
        setLinked(prop.id);
      }
      // une seule simulation par bien : elle est mise à jour, ou créée au premier enregistrement
      const payload = { inputs, results: summarize(outcome.result), engine_version: ENGINE_VERSION, property_id: prop.id };
      const saved: Scenario | null = scenario && !created
        ? await update('scenarios', scenario, payload, 'La simulation')
        : await create('scenarios', { ...payload, name: 'Simulation' });
      if (!saved) return;
      const patch: Partial<Property> = {};
      if (prop.primary_scenario_id !== saved.id) patch.primary_scenario_id = saved.id;
      // la simulation met à jour la fiche du bien en prospection (titre, adresse, statut… et prix, surface, travaux, loyer)
      if (isProspect(prop) && !created) {
        for (const [k, v] of Object.entries({ ...bienOut, ...fields }) as [keyof Property, never][]) if (prop[k] !== v) (patch as Record<string, unknown>)[k] = v;
      }
      if (Object.keys(patch).length) await update('properties', prop, patch, `Le bien « ${prop.title} »`);
      const saved2 = { ...bien, agency_id: agencyId, agent_id: agentId };
      setBien(saved2); setBienBase(saved2);
      notify(created ? `Bien « ${prop.title} » ajouté à la prospection avec sa simulation.` : 'Bien et simulation enregistrés.');
      if (created) navigate(`/bien/${prop.id}/modifier`);
    } finally {
      setBusy(false);
    }
  }

  async function exportAmortization() {
    if (!outcome.ok) return;
    const r = outcome.result;
    const blob = await toXlsx([
      { name: 'Par année', rows: r.years, columns: [
        { label: 'Année', value: (y) => y.year, kind: 'number' }, { label: 'Échéances crédit', value: (y) => y.payments, kind: 'money' },
        { label: 'Intérêts', value: (y) => y.interest, kind: 'money' }, { label: 'Capital remboursé', value: (y) => y.principal, kind: 'money' },
        { label: 'Assurance', value: (y) => y.insurance, kind: 'money' }, { label: 'Capital restant dû', value: (y) => y.balance, kind: 'money' },
      ] },
      { name: 'Par mois', rows: r.amortization, columns: [
        { label: 'Mois', value: (m) => m.month, kind: 'number' }, { label: 'Phase', value: (m) => m.phase },
        { label: 'Échéance crédit', value: (m) => m.payment, kind: 'money' }, { label: 'Intérêts', value: (m) => m.interest, kind: 'money' },
        { label: 'Intérêts capitalisés', value: (m) => m.capitalized, kind: 'money' }, { label: 'Capital', value: (m) => m.principal, kind: 'money' },
        { label: 'Assurance', value: (m) => m.insurance, kind: 'money' }, { label: 'Capital restant dû', value: (m) => m.balance, kind: 'money' },
      ] },
    ]);
    downloadBlob(blob, `immo-zen-amortissement-${stamp()}.xlsx`);
  }

  if (propertyId && !property) return <PageHeader title="Bien introuvable" subtitle="Il a peut-être été supprimé." />;
  const r = outcome.ok ? outcome.result : null;
  const linkedProperty = linked ? data.properties.find((p) => p.id === linked) : undefined;

  return (
    <>
      {linkedProperty && <p className="crumbs"><a href={href(isProspect(linkedProperty) ? '/prospection' : '/biens')}>{isProspect(linkedProperty) ? 'Prospection' : 'Mes biens'}</a>, <a href={href(`/bien/${linkedProperty.id}`)}>{linkedProperty.title}</a></p>}
      <PageHeader title={!linkedProperty ? 'Ajouter un bien en prospection' : isProspect(linkedProperty) ? `Modifier « ${linkedProperty.title} »` : `Simulation – ${linkedProperty.title}`}
        subtitle={!linkedProperty ? 'Fiche du bien et simulation en une seule saisie : à l’enregistrement, le bien est ajouté à la prospection.'
          : isProspect(linkedProperty) ? 'Fiche du bien et sa simulation : une seule simulation par bien, modifiable à tout moment.' : 'Hypothèses d’achat du bien. Sa fiche se modifie dans Mes biens.'}
        actions={<>
          {linkedProperty && <Button onClick={() => navigate(`/bien/${linkedProperty.id}`)}>Voir la fiche</Button>}
          <Button variant="primary" onClick={() => void save()} disabled={busy || !outcome.ok}>{busy ? 'Enregistrement…' : 'Enregistrer'}</Button>
        </>} />
      {dirty && <p className="unsaved" role="status">Modifications non enregistrées.</p>}
      {scenario?.engine_version === 'legacy-idf-invest' && (
        <p className="note">Simulation reprise de l’ancienne version. Les frais de notaire saisis à l’époque sont conservés en montant. Les résultats sont recalculés avec les formules actuelles : le cash-flow peut différer de l’ancienne version, qui mélangeait deux méthodes (« mode simplifié »).</p>
      )}

      <div className="sim-layout">
        <div>
          <Section title="Le bien">
            <div className="grid">
              {(!linkedProperty || isProspect(linkedProperty)) ? (
                <>
                  <TextInput label="Titre du bien" required wide value={bien.title} onChange={(v) => setB('title', v)} maxLength={200} placeholder="Ex. T2 lumineux proche gare" />
                  <Select label="Statut" value={bien.status} onChange={(v) => setB('status', (v ?? 'repere') as PropertyStatus)}
                    options={STATUS_ORDER.filter((x) => x !== 'acquis' && x !== 'archive').map((x) => [x, STATUS_LABELS[x]] as const)} />
                  <AddressFields value={bien} onChange={(a) => setBien((b) => ({ ...b, ...a }))} />
                  <Select label="Type" value={bien.property_type} onChange={(v) => setB('property_type', (v ?? 'appartement') as PropertyType)} options={Object.entries(TYPE_LABELS) as [PropertyType, string][]} />
                  {num('askingPrice', 'Prix de présentation FAI', '€', 'Prix affiché, frais d’agence inclus')}
                  {num('surface', 'Surface du logement', 'm²', 'Surface habitable (loi Carrez en copropriété)')}
                  <NumberInput label="Pièces" value={bien.rooms} onChange={(v) => setB('rooms', v === null ? null : Math.round(v))} />
                  <Select label="DPE" value={bien.dpe} onChange={(v) => setB('dpe', v)} allowEmpty="Non renseigné" options={DPE_VALUES.map((d) => [d, d] as const)} />
                  <TextInput label="Lien de l’annonce" type="url" wide value={bien.listing_url} onChange={(v) => setB('listing_url', v || null)} placeholder="https://" />
                  <div className="field field-full">
                    <ListingImport url={bien.listing_url}
                      current={{ title: bien.title, property_type: bien.property_type, price: inputs.askingPrice, surface: inputs.surface, rooms: bien.rooms, address: bien.address,
                        zip: bien.zip, city: bien.city, dpe: bien.dpe, copro_charges_annual: inputs.coproChargesAnnual, property_tax_annual: inputs.propertyTaxAnnual,
                        agency_fees: inputs.priceMode === 'honoraires_inclus' ? inputs.agencyFees : null }}
                      onApply={applyListing} />
                  </div>
                </>
              ) : <p className="muted small field-full">Bien détenu : sa fiche se modifie dans Mes biens. La simulation ne la change pas.</p>}
            </div>
            {(!linkedProperty || isProspect(linkedProperty)) && <p className="muted small">Une seule fiche : tout ce qui est saisi ici (bien, estimation, simulation, suivi des actions) est enregistré ensemble et repris tel quel dans la prospection.</p>}
          </Section>

          {(!linkedProperty || isProspect(linkedProperty)) && (
            <>
              <Section title="Estimation du prix">
                <EstimatePanel value={bien} input={{ ...bien, surface: inputs.surface }} onChange={(p) => setBien((b) => ({ ...b, ...p }))}
                  compareTo={live?.offerFai || null} compareLabel="Prix proposé (frais d’agence inclus)" />
              </Section>
            </>
          )}

          <Section title="Acquisition">
            <div className="grid">
              {linkedProperty && !isProspect(linkedProperty) && num('askingPrice', 'Prix de présentation FAI', '€', 'Prix affiché, frais d’agence inclus')}
              {linkedProperty && !isProspect(linkedProperty) && num('surface', 'Surface du logement', 'm²')}
              <Select label="Le prix proposé est" value={inputs.priceMode} onChange={(v) => set('priceMode', v ?? 'hors_honoraires')}
                options={[['hors_honoraires', 'Hors honoraires'], ['honoraires_inclus', 'Honoraires inclus']] as const} />
              {num('price', 'Prix proposé', '€')}
              {num('agencyFees', inputs.priceMode === 'honoraires_inclus' ? 'Dont honoraires d’agence' : 'Frais d’agence', '€')}
              <div className="field">
                <span className="label" id="nego">Négociation</span>
                <output className="computed" aria-labelledby="nego">
                  {live?.negotiationAmount != null ? <>{money(live.negotiationAmount)}<small> soit {pct(live.negotiationPct)}</small></> : <small>Renseignez les deux prix</small>}
                </output>
                <small className="muted">Présentation FAI − prix proposé{inputs.priceMode === 'hors_honoraires' ? ' + frais d’agence' : ''} ({money(live?.offerFai)} FAI).</small>
              </div>
              <Select label="Frais de notaire" value={inputs.notaryMode} onChange={(v) => set('notaryMode', v ?? 'percent')}
                options={[['percent', 'En % du prix'], ['amount', 'Montant connu']] as const} />
              {inputs.notaryMode === 'percent' ? num('notaryRate', 'Taux frais de notaire', '%') : num('notaryAmount', 'Montant frais de notaire', '€')}
              {num('works', 'Travaux', '€')}
              {num('furniture', 'Mobilier', '€')}
              {num('guaranteeFees', 'Frais de garantie', '€', 'Caution ou hypothèque')}
              {num('dossierFees', 'Frais de dossier', '€')}
            </div>
          </Section>

          <Section title="Financement">
            <Checkbox label="Financer par un crédit" checked={inputs.useLoan} onChange={(v) => set('useLoan', v)} />
            {inputs.useLoan && (
              <div className="grid">
                {num('downPayment', 'Apport', '€')}
                {num('interestRate', 'Taux du crédit', '% / an', 'Taux nominal, hors assurance')}
                {num('loanYears', 'Durée', 'ans')}
                {num('insuranceRate', 'Assurance emprunteur', '% / an', 'Sur le capital initial')}
                <Select label="Différé" value={inputs.deferralType} onChange={(v) => set('deferralType', v ?? 'aucun')}
                  options={[['aucun', 'Aucun'], ['partiel', 'Partiel : intérêts seuls'], ['total', 'Total : intérêts capitalisés']] as const}
                  hint={inputs.deferralType === 'partiel' ? 'Pendant le différé, seuls les intérêts et l’assurance sont payés.' : inputs.deferralType === 'total' ? 'Pendant le différé, rien n’est payé hors assurance ; les intérêts s’ajoutent au capital.' : undefined} />
                {inputs.deferralType !== 'aucun' && num('deferralMonths', 'Durée du différé', 'mois', 'Comprise dans la durée totale')}
              </div>
            )}
          </Section>

          <Section title="Loyers et charges">
            <div className="rent-mode" role="radiogroup" aria-label="Loyer hors charges calculé avec">
              <span className="label">Loyer calculé avec le prix au m²</span>
              {([['bas', 'Bas'], ['haut', 'Haut'], ['manuel', 'Saisie libre']] as const).map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={inputs.rentMode === k} className={`seg${inputs.rentMode === k ? ' on' : ''}`} onClick={() => set('rentMode', k)}>{l}</button>
              ))}
            </div>
            <div className="grid">
              {num('rentM2Low', 'Loyer au m² bas', '€ / m²', 'Hors charges, par mois')}
              {num('rentM2High', 'Loyer au m² haut', '€ / m²', 'Hors charges, par mois')}
              {inputs.rentMode === 'manuel' ? num('monthlyRent', 'Loyer hors charges', '€ / mois') : (
                <div className="field">
                  <span className="label" id="rent-hc">Loyer hors charges</span>
                  <output className="computed" aria-labelledby="rent-hc">{money2(live?.monthlyRent ?? 0)}<small> / mois</small></output>
                  <small className="muted">{inputs.surface ? `${String(inputs.surface).replace('.', ',')} m² × ${String(inputs.rentMode === 'bas' ? inputs.rentM2Low : inputs.rentM2High).replace('.', ',')} € (prix ${inputs.rentMode})` : 'Renseignez la surface du logement.'}</small>
                </div>
              )}
              {num('chargesProvisionMonthly', 'Provision sur charges', '€ / mois', 'Versée par le locataire ; proposée à 80 % des charges de copropriété')}
              <div className="field">
                <span className="label" id="rent-cc">Loyer charges comprises</span>
                <output className="computed" aria-labelledby="rent-cc">{money2(live?.monthlyRentWithCharges ?? 0)}<small> / mois</small></output>
                <small className="muted">Loyer hors charges + provision.</small>
              </div>
              <NumberInput label="Charges de copropriété" suffix="€ / an" value={inputs.coproChargesAnnual} onChange={setCopro} error={err('coproChargesAnnual')} />
              {num('coproRecoverableAnnual', 'dont récupérables', '€ / an', 'Proposé à 80 % des charges de copropriété, modifiable')}
              {num('propertyTaxAnnual', 'Taxe foncière', '€ / an')}
              {num('propertyTaxRecoverableAnnual', 'dont part récupérable', '€ / an', 'Taxe d’enlèvement des ordures ménagères')}
              {num('pnoAnnual', 'Assurance PNO', '€ / an')}
              {num('managementAnnual', 'Gestion locative', '€ / an')}
              {num('gliAnnual', 'GLI', '€ / an', 'Garantie loyers impayés')}
              {num('maintenanceAnnual', 'Entretien', '€ / an')}
              {num('vacancyAnnual', 'Vacance locative', '€ / an', 'Loyers perdus estimés')}
              {num('otherChargesAnnual', 'Autres charges', '€ / an')}
            </div>
          </Section>
        </div>

        <aside className="sim-results" aria-live="polite">
          {!outcome.ok ? (
            <div className="results-error" role="alert">
              <h2>Valeurs à corriger</h2>
              <ul>{outcome.errors.map((e) => <li key={e.field + e.message}>{e.message}</li>)}</ul>
            </div>
          ) : r && (
            <>
              {simulatedCashflow(r) === null ? (
                <div className="cashflow pending" role="status">
                  <span>Cash-flow avant fiscalité</span>
                  <strong>—</strong>
                  <span className="muted small">{inputs.rentMode === 'manuel' ? 'Saisissez le loyer hors charges pour lancer la simulation du cash-flow.' : !inputs.surface ? 'Renseignez la surface et le loyer au m² pour lancer la simulation du cash-flow.' : `Renseignez le loyer au m² ${inputs.rentMode} pour lancer la simulation du cash-flow.`}</span>
                </div>
              ) : (
                <div className={`cashflow ${r.cashflowMonthlyYear1 >= 0 ? 'pos' : 'neg'}`}>
                  <span>Cash-flow avant fiscalité</span>
                  <strong>{money(r.cashflowMonthlyYear1)}<small> / mois</small></strong>
                  <span className="muted small">moyenne de l’année 1, soit {money(r.cashflowAnnualYear1)} / an</span>
                  {inputs.useLoan && inputs.deferralType !== 'aucun' && <span className="muted small">après le différé : {money(r.cashflowMonthlySteady)} / mois</span>}
                </div>
              )}
              <dl className="results">
                {r.negotiationAmount !== null && <div><dt>Négociation</dt><dd>{money(r.negotiationAmount)} ({pct(r.negotiationPct)})</dd></div>}
                {r.pricePerM2 !== null && <div><dt>Prix au m² (FAI)</dt><dd>{money(r.pricePerM2)}</dd></div>}
                <div><dt>Coût total de l’opération</dt><dd>{money(r.totalCost)}</dd></div>
                <div className="sub"><dt>Prix hors honoraires</dt><dd>{money(r.netPrice)}</dd></div>
                <div className="sub"><dt>Frais de notaire</dt><dd>{money(r.notaryFees)}</dd></div>
                <div className="sub"><dt>Frais d’agence</dt><dd>{money(r.agencyFees)}</dd></div>
                <div><dt>Apport utilisé</dt><dd>{money(r.equity)}</dd></div>
                <div><dt>Emprunt</dt><dd>{money(r.loanAmount)}</dd></div>
                <div><dt>Mensualité de crédit</dt><dd>{money2(r.monthlyPayment)}</dd></div>
                <div><dt>Assurance mensuelle</dt><dd>{money2(r.monthlyInsurance)}</dd></div>
                <div><dt>Mensualité totale</dt><dd>{money2(r.monthlyPaymentWithInsurance)}</dd></div>
                <div><dt>Coût du financement</dt><dd>{money(r.financingCost)}</dd></div>
                <div className="sub"><dt>Intérêts</dt><dd>{money(r.totalInterest)}</dd></div>
                <div className="sub"><dt>Assurance</dt><dd>{money(r.totalInsurance)}</dd></div>
                <div className="sub"><dt>Garantie et dossier</dt><dd>{money(r.financingFees)}</dd></div>
                <div><dt>Loyer hors charges</dt><dd>{money2(r.monthlyRent)} / mois</dd></div>
                <div><dt>Loyer charges comprises</dt><dd>{money2(r.monthlyRentWithCharges)} / mois</dd></div>
                <div><dt>Loyers annuels</dt><dd>{money(r.annualRent)}</dd></div>
                <div><dt>Charges non récupérables</dt><dd>{money(r.annualOwnerCharges)}</dd></div>
                <div><dt>Vacance</dt><dd>{money(r.annualVacancy)}</dd></div>
                {r.monthlyRent > 0 && <>
                  <div><dt>Revenu net avant crédit</dt><dd>{money(r.annualNetOperatingIncome)}</dd></div>
                  <div><dt>Rendement brut</dt><dd>{pct(r.grossYield)}</dd></div>
                  <div><dt>Rendement après charges</dt><dd>{pct(r.netYield)}</dd></div>
                </>}
                <div><dt>Capital remboursé année 1</dt><dd>{money(r.year1PrincipalRepaid)}</dd></div>
              </dl>
              <p className="muted small">Le capital remboursé n’est pas une charge : il diminue la trésorerie mais constitue votre patrimoine. Aucune fiscalité n’est calculée.</p>
              {r.warnings.length > 0 && <ul className="warnings">{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
            </>
          )}
        </aside>
      </div>

      {r && r.amortization.length > 0 && (
        <Section title="Tableau d’amortissement" actions={<>
          <Button size="sm" onClick={() => setDetail(detail === 'annuel' ? null : 'annuel')}>{detail === 'annuel' ? 'Masquer' : 'Par année'}</Button>
          <Button size="sm" onClick={() => setDetail(detail === 'mensuel' ? null : 'mensuel')}>{detail === 'mensuel' ? 'Masquer' : 'Par mois'}</Button>
          <Button size="sm" onClick={() => void exportAmortization()}>Excel (.xlsx)</Button>
        </>}>
          {detail === 'annuel' && (
            <div className="dt-scroll"><table className="dt-table compact">
              <thead><tr><th>Année</th><th className="num">Échéances</th><th className="num">Intérêts</th><th className="num">Capital</th><th className="num">Assurance</th><th className="num">Restant dû</th></tr></thead>
              <tbody>{r.years.map((y) => <tr key={y.year}><td>{y.year}</td><td className="num">{money2(y.payments)}</td><td className="num">{money2(y.interest)}</td><td className="num">{money2(y.principal)}</td><td className="num">{money2(y.insurance)}</td><td className="num">{money2(y.balance)}</td></tr>)}</tbody>
            </table></div>
          )}
          {detail === 'mensuel' && (
            <div className="dt-scroll tall"><table className="dt-table compact">
              <thead><tr><th>Mois</th><th className="num">Échéance</th><th className="num">Intérêts</th><th className="num">Capital</th><th className="num">Assurance</th><th className="num">Restant dû</th></tr></thead>
              <tbody>{r.amortization.map((m) => <tr key={m.month}><td>{m.month}{m.phase !== 'amortissement' ? ' (différé)' : ''}</td><td className="num">{money2(m.payment)}</td><td className="num">{money2(m.interest || m.capitalized)}</td><td className="num">{money2(m.principal)}</td><td className="num">{money2(m.insurance)}</td><td className="num">{money2(m.balance)}</td></tr>)}</tbody>
            </table></div>
          )}
          {!detail && <p className="muted">{r.months} mensualités. Choisissez une vue par année ou par mois.</p>}
        </Section>
      )}

      {(!linkedProperty || isProspect(linkedProperty)) && (
      <Section title="Suivi des actions">
        <div className="grid">
          <Select label="Agence" value={bien.agency_id} onChange={(v) => setB('agency_id', v)} allowEmpty="Aucune"
            options={[...data.contacts.filter((c) => c.kind === 'agence' && !c.archived_at).map((c) => [c.id, c.name] as const), [NEW, '+ Nouvelle agence…'] as const]} />
          {bien.agency_id === NEW && <TextInput label="Nom de la nouvelle agence" value={newAgency} onChange={setNewAgency} maxLength={200} />}
          <Select label="Agent" value={bien.agent_id} onChange={(v) => setB('agent_id', v)} allowEmpty="Aucun"
            options={[...data.contacts.filter((c) => c.kind === 'agent' && !c.archived_at && (!bien.agency_id || bien.agency_id === NEW || !c.organization_id || c.organization_id === bien.agency_id)).map((c) => [c.id, c.name] as const), [NEW, '+ Nouvel agent…'] as const]} />
          {bien.agent_id === NEW && <TextInput label="Nom du nouvel agent" value={newAgent} onChange={setNewAgent} maxLength={200} />}
          <TextInput label="Prochaine action" wide value={bien.next_action} onChange={(v) => setB('next_action', v || null)} maxLength={300} placeholder="Ex. Demander les PV d’AG" />
          <TextInput label="Date de relance" type="date" value={bien.follow_up_date} onChange={(v) => setB('follow_up_date', v || null)} />
          <TextInput label="Date et heure de visite" type="datetime-local" value={bien.visit_at ? toLocalInput(bien.visit_at) : ''} onChange={(v) => setB('visit_at', v ? new Date(v).toISOString() : null)} />
          <TextArea label="Commentaires" value={bien.comments} onChange={(v) => setB('comments', v || null)} rows={3} />
          <TextArea label="Points de vigilance (un par ligne)" value={bien.vigilance.join('\n')} onChange={(v) => setB('vigilance', v.split('\n').map((x) => x.trim()).filter(Boolean))} rows={3} />
        </div>
      </Section>
      )}

      <details className="method">
        <summary>Méthode de calcul</summary>
        <ul>
          <li>Négociation = prix de présentation FAI − prix proposé exprimé frais d’agence inclus ; en % du prix de présentation.</li>
          <li>Loyer hors charges = surface × loyer au m² (bas ou haut), ou montant saisi en « saisie libre ». Loyer charges comprises = loyer hors charges + provision.</li>
          <li>Charges récupérables et provision proposées à 80 % des charges de copropriété (par an, et par mois), arrondies à l’euro supérieur ; modifiables.</li>
          <li>Coût total = prix hors honoraires + frais d’agence + frais de notaire + travaux + mobilier + garantie + dossier.</li>
          <li>Frais de notaire en % : appliqués au prix hors honoraires d’agence (le prix proposé, ou le prix diminué des honoraires s’ils sont inclus).</li>
          <li>Emprunt = coût total − apport (jamais négatif). Mensualité constante : capital × t / (1 − (1 + t)<sup>−n</sup>), t = taux annuel / 12 ; capital / n si le taux est nul.</li>
          <li>Intérêts du mois = capital restant × t, arrondis au centime ; la dernière mensualité solde exactement le capital.</li>
          <li>Assurance mensuelle = capital initial × taux annuel / 12, constante, due aussi pendant un différé.</li>
          <li>Charges non récupérables = copropriété − part récupérable + taxe foncière − part récupérable + PNO + gestion + GLI + entretien + autres. Les provisions versées par le locataire sont supposées égales aux charges récupérables.</li>
          <li>Rendement brut = loyers annuels / coût total. Rendement après charges = (loyers − vacance − charges non récupérables) / coût total.</li>
          <li>Cash-flow avant fiscalité = loyers − vacance − charges non récupérables − mensualités et assurance (capital compris, car il sort de la trésorerie).</li>
        </ul>
      </details>
    </>
  );
}

type Bien = Pick<Property, 'title' | 'address' | 'zip' | 'city' | 'property_type' | 'rooms' | 'dpe' | 'listing_url' | 'status'
  | 'agency_id' | 'agent_id' | 'next_action' | 'follow_up_date' | 'visit_at' | 'comments' | 'vigilance'> & EstimateFields;
const NEW = '__new__';
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
