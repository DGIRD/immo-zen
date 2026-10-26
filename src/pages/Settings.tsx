import { useMemo, useState } from 'react';
import { resetDemo } from '../data/demoRepo.ts';
import { useStore } from '../data/store.tsx';
import type { Contact, Insert } from '../data/types.ts';
import { buildBackup, materialize, parseBackup, planImport, type ImportPlan } from '../domain/backup.ts';
import { downloadBlob, stamp } from '../domain/exporting.ts';
import { dateTime } from '../domain/format.ts';
import { legacyContacts, legacyInputs, legacyProperty, readLegacyLocal, type LegacySimulation } from '../domain/legacy.ts';
import { DEFAULT_INPUTS, DEFAULT_SETTING_FIELDS, ENGINE_VERSION, type SimulationInputs } from '../domain/simulator.ts';
import { Button, Modal, NumberInput, PageHeader, Section, TextArea, TextInput, useConfirm } from '../ui/components.tsx';
import type { ReminderTemplate } from '../data/types.ts';
import { DEFAULT_REMINDER_TEMPLATES, TEMPLATE_VARIABLES } from '../domain/rental.ts';
import { loadSampleData } from './sample.ts';

export function SettingsPage() {
  const store = useStore();
  const { data, session, saveSettings, simulatorDefaults, notify, repo } = store;
  const [defaults, setDefaults] = useState<SimulationInputs>(simulatorDefaults);
  const [plan, setPlan] = useState<{ plan: ImportPlan; file: string } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { ask, dialog } = useConfirm();

  const legacy = useMemo(() => {
    const known = new Set(data.properties.map((p) => p.legacy_simulation_id).filter(Boolean));
    return readLegacyLocal().flatMap((b) => b.simulations).filter((s) => !known.has(s.id));
  }, [data.properties]);

  function backupNow() {
    const b = buildBackup(data, session?.email ?? '');
    downloadBlob(new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' }), `immo-zen-sauvegarde-${stamp()}.json`);
  }

  async function onFile(f: File | undefined) {
    setImportError(null);
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { setImportError('Fichier trop volumineux (20 Mo maximum).'); return; }
    const parsed = parseBackup(await f.text());
    if (!parsed.ok) { setImportError(parsed.error); return; }
    setPlan({ plan: planImport(parsed.backup, data), file: f.name });
  }

  async function runImport(p: ImportPlan) {
    setBusy(true);
    try {
      backupNow(); // sauvegarde préalable de l'état actuel
      const rows = materialize(p);
      if (rows.agencies.length && !(await store.createMany('pro_contacts', rows.agencies))) return;
      if (rows.otherContacts.length && !(await store.createMany('pro_contacts', rows.otherContacts))) return;
      const props = rows.properties.length ? await store.createMany('properties', rows.properties) : [];
      if (!props) return;
      if (rows.scenarios.length && !(await store.createMany('scenarios', rows.scenarios))) return;
      for (const prop of props) {
        const sid = rows.primary.get(prop.id);
        if (sid) await store.update('properties', prop, { primary_scenario_id: sid }, 'Le bien importé');
      }
      if (rows.tasks.length) await store.createMany('property_tasks', rows.tasks);
      if (rows.events.length) await store.createMany('timeline_events', rows.events);
      await store.refresh();
      notify(`Import terminé : ${props.length} bien(s), ${rows.agencies.length + rows.otherContacts.length} contact(s), ${rows.scenarios.length} scénario(s).`);
      setPlan(null);
    } finally {
      setBusy(false);
    }
  }

  async function importLegacy(list: LegacySimulation[]) {
    if (!(await ask('Reprendre les simulations de l’ancienne version', <>{list.length} simulation(s) trouvée(s) dans ce navigateur et absente(s) de votre compte seront ajoutées à la prospection, avec un scénario chacune. Une sauvegarde de votre compte est téléchargée avant l’opération.</>, 'Reprendre', false))) return;
    setBusy(true);
    try {
      backupNow();
      let contacts: Contact[] = [...data.contacts];
      let n = 0;
      for (const s of list) {
        const { agency, agent } = legacyContacts(s, contacts);
        let agencyId: string | null = null;
        let agentId: string | null = null;
        if (agency) {
          if ('id' in agency && agency.id && 'version' in agency) agencyId = agency.id;
          else { const c = await store.create('pro_contacts', agency as Insert<Contact>); if (!c) return; contacts = [...contacts, c]; agencyId = c.id; }
        }
        if (agent) {
          if ('id' in agent && agent.id && 'version' in agent) agentId = agent.id;
          else { const c = await store.create('pro_contacts', { ...(agent as Insert<Contact>), organization_id: agencyId }); if (!c) return; contacts = [...contacts, c]; agentId = c.id; }
        }
        const prop = await store.create('properties', { ...legacyProperty(s), agency_id: agencyId, agent_id: agentId });
        if (!prop) return;
        const sc = await store.create('scenarios', { property_id: prop.id, name: `Simulation reprise ${s.number ?? ''}`.trim(), inputs: legacyInputs(s), engine_version: 'legacy-idf-invest' });
        if (sc) await store.update('properties', prop, { primary_scenario_id: sc.id }, 'Le bien repris');
        n++;
      }
      await store.refresh();
      notify(`${n} simulation(s) de l’ancienne version reprise(s).`);
    } finally {
      setBusy(false);
    }
  }

  const numField = (k: keyof SimulationInputs, label: string, suffix: string) => (
    <NumberInput label={label} suffix={suffix} value={defaults[k] as number} onChange={(v) => setDefaults((d) => ({ ...d, [k]: v ?? 0 }))} />
  );

  return (
    <>
      <PageHeader title="Paramètres" />

      <Section title="Valeurs par défaut des simulations" actions={<>
        <Button size="sm" onClick={() => setDefaults({ ...DEFAULT_INPUTS })}>Valeurs d’origine</Button>
        <Button size="sm" variant="primary" onClick={async () => { const picked = Object.fromEntries(DEFAULT_SETTING_FIELDS.map((k) => [k, defaults[k]])); if (await saveSettings({ simulator_defaults: { ...picked, _v: 2 } as never })) notify('Valeurs par défaut enregistrées.'); }}>Enregistrer</Button>
      </>}>
        <p className="muted small">Utilisées pour toute nouvelle simulation. Les scénarios existants gardent leurs propres hypothèses.</p>
        <div className="grid">
          {numField('notaryRate', 'Frais de notaire', '% du prix')}
          {numField('agencyFees', 'Frais d’agence', '€')}
          {numField('interestRate', 'Taux du crédit', '% / an')}
          {numField('loanYears', 'Durée du crédit', 'ans')}
          {numField('insuranceRate', 'Assurance emprunteur', '% / an')}
          {numField('pnoAnnual', 'Assurance PNO', '€ / an')}
        </div>
      </Section>

      <RentalSettingsSection />

      <Section title="Sauvegarde et import">
        <p>Téléchargez une copie complète de vos biens, scénarios, contacts, tâches et échanges au format JSON. Ce fichier peut être réimporté.</p>
        <div className="row">
          <Button onClick={backupNow}>Télécharger une sauvegarde (.json)</Button>
          <label className="btn btn-secondary file-btn">
            Importer une sauvegarde…
            <input type="file" accept="application/json,.json" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
        {importError && <p className="form-error" role="alert">{importError}</p>}
        <p className="muted small">L’import affiche d’abord un aperçu ; les doublons (même bien, même contact) sont ignorés ; une sauvegarde de l’état actuel est téléchargée juste avant. La sauvegarde contient aussi la gestion locative (baux, loyers, quittances, dépenses, fiches des documents) ; sa réimportation n’est pas encore disponible et les fichiers eux-mêmes restent dans le stockage.</p>
      </Section>

      <Section title="Données de l’ancienne version">
        <p>Les simulations enregistrées en ligne dans l’ancienne version sont reprises automatiquement lors de la mise en service (biens en prospection, scénarios et contacts agence/agent).</p>
        {legacy.length > 0 ? (
          <div className="note">
            <p>{legacy.length} simulation(s) de l’ancienne version sont présentes dans ce navigateur mais absentes de votre compte (enregistrées hors connexion dans l’ancienne application).</p>
            <ul className="plain small">{legacy.slice(0, 8).map((s) => <li key={s.id}>{String(s.title ?? s.number ?? s.id)}</li>)}{legacy.length > 8 && <li>…</li>}</ul>
            <Button variant="primary" disabled={busy} onClick={() => void importLegacy(legacy)}>Reprendre ces simulations</Button>
          </div>
        ) : <p className="muted small">Aucune simulation de l’ancienne version en attente dans ce navigateur.</p>}
      </Section>

      <Section title="Compte">
        <p>Connecté avec <strong>{session?.email}</strong>{data.loadedAt && <> — données synchronisées le {dateTime(data.loadedAt)}</>}.</p>
        <div className="row">
          {repo.mode === 'supabase' && <Button onClick={async () => { try { await repo.requestPasswordReset(session?.email ?? ''); notify('E-mail de changement de mot de passe envoyé.'); } catch (e) { notify(String((e as Error).message), 'error'); } }}>Changer de mot de passe</Button>}
          <Button onClick={() => void store.signOut()}>Se déconnecter de cet appareil</Button>
        </div>
        <p className="muted small">La déconnexion efface la copie locale de vos données sur cet appareil.</p>
      </Section>

      {store.platform && (
        <Section title="Accès support">
          {store.platform.supportUntil && store.platform.supportUntil > new Date().toISOString() ? (
            <>
              <p>Le support Immo-Zen peut consulter un résumé chiffré de votre compte (nombre de biens, baux, impayés, e-mails en échec) jusqu’au <strong>{dateTime(store.platform.supportUntil)}</strong>. Chaque consultation est journalisée.</p>
              <Button onClick={async () => { try { await repo.platform.setSupportAccess(null); await store.refreshPlatform(); notify('Accès support retiré.'); } catch (e) { notify(String((e as Error).message), 'error'); } }}>Retirer l’autorisation</Button>
            </>
          ) : (
            <>
              <p>Par défaut, personne chez Immo-Zen n’accède à vos données. En cas de problème, vous pouvez autoriser le support à consulter un résumé chiffré de votre compte pendant 7 jours.</p>
              <Button onClick={async () => { try { await repo.platform.setSupportAccess(new Date(Date.now() + 7 * 86400000).toISOString()); await store.refreshPlatform(); notify('Accès support autorisé pour 7 jours.'); } catch (e) { notify(String((e as Error).message), 'error'); } }}>Autoriser pendant 7 jours</Button>
            </>
          )}
        </Section>
      )}

      {repo.mode === 'demo' && (
        <Section title="Mode démonstration">
          <div className="row">
            <Button onClick={async () => { await loadSampleData(store); notify('Données d’exemple ajoutées.'); }}>Ajouter des données d’exemple</Button>
            <Button variant="danger" onClick={async () => { if (await ask('Effacer la démonstration', 'Toutes les données de démonstration de ce navigateur seront effacées.', 'Effacer')) { resetDemo(); await store.refresh(); } }}>Effacer les données de démonstration</Button>
          </div>
        </Section>
      )}

      <Modal open={!!plan} title={`Importer « ${plan?.file ?? ''} »`} onClose={() => setPlan(null)}
        footer={<>
          <Button onClick={() => setPlan(null)}>Annuler</Button>
          <Button variant="primary" disabled={busy || !plan || (plan.plan.properties.add.length + plan.plan.contacts.add.length + plan.plan.scenarios.length === 0)}
            onClick={() => plan && void runImport(plan.plan)}>{busy ? 'Import…' : 'Importer'}</Button>
        </>}>
        {plan && (
          <>
            <table className="dt-table compact">
              <thead><tr><th>Élément</th><th className="num">Ajoutés</th><th className="num">Doublons ignorés</th></tr></thead>
              <tbody>
                <tr><td>Biens</td><td className="num">{plan.plan.properties.add.length}</td><td className="num">{plan.plan.properties.duplicates.length}</td></tr>
                <tr><td>Contacts</td><td className="num">{plan.plan.contacts.add.length}</td><td className="num">{plan.plan.contacts.duplicates.length}</td></tr>
                <tr><td>Scénarios</td><td className="num">{plan.plan.scenarios.length}</td><td className="num">—</td></tr>
                <tr><td>Tâches</td><td className="num">{plan.plan.tasks.length}</td><td className="num">—</td></tr>
                <tr><td>Échanges et notes</td><td className="num">{plan.plan.events.length}</td><td className="num">—</td></tr>
              </tbody>
            </table>
            {plan.plan.properties.duplicates.length > 0 && (
              <p className="muted small">Déjà présents : {plan.plan.properties.duplicates.slice(0, 5).map((d) => d.existing.title).join(', ')}{plan.plan.properties.duplicates.length > 5 ? '…' : ''}</p>
            )}
            <p className="muted small">Une sauvegarde de votre compte sera téléchargée avant l’import. Moteur de calcul : version {ENGINE_VERSION}.</p>
          </>
        )}
      </Modal>
      {dialog}
    </>
  );
}

function RentalSettingsSection() {
  const { data, saveSettings, notify } = useStore();
  const rs = data.settings?.rental_settings ?? {};
  const [name, setName] = useState(rs.landlord_name ?? '');
  const [address, setAddress] = useState(rs.landlord_address ?? '');
  const [tpls, setTpls] = useState<ReminderTemplate[]>(() => (rs.reminder_templates?.length === 3 ? rs.reminder_templates : DEFAULT_REMINDER_TEMPLATES.map((t) => ({ ...t }))));
  const setTpl = (i: number, k: keyof ReminderTemplate, v: string) => setTpls((x) => x.map((t, j) => (j === i ? { ...t, [k]: v } : t)));
  const LEVELS = ['Niveau 1 – rappel', 'Niveau 2 – second rappel', 'Niveau 3 – dernier rappel amiable'];
  return (
    <Section title="Gestion locative" actions={<>
      <Button size="sm" onClick={() => setTpls(DEFAULT_REMINDER_TEMPLATES.map((t) => ({ ...t })))}>Modèles d’origine</Button>
      <Button size="sm" variant="primary" onClick={async () => {
        if (tpls.some((t) => !t.subject.trim() || !t.body.trim())) { notify('Chaque modèle doit avoir un objet et un message.', 'error'); return; }
        if (await saveSettings({ rental_settings: { ...rs, landlord_name: name.trim(), landlord_address: address.trim(), reminder_templates: tpls } })) notify('Paramètres de gestion locative enregistrés.');
      }}>Enregistrer</Button>
    </>}>
      <p className="muted small">Identité du bailleur proposée pour chaque nouveau bail (elle figure sur les quittances).</p>
      <div className="grid">
        <TextInput label="Nom du bailleur" value={name} onChange={setName} maxLength={200} />
        <TextInput label="Adresse du bailleur" wide value={address} onChange={setAddress} maxLength={500} />
      </div>
      <h3>Modèles de relance amiable</h3>
      <p className="muted small">Variables : {TEMPLATE_VARIABLES.join(', ')}. Pas de pénalité ni de formule juridique : ces messages restent des rappels amiables, relus avant chaque envoi.</p>
      {tpls.map((t, i) => (
        <details key={i} className="tpl" open={i === 0}>
          <summary>{LEVELS[i]}</summary>
          <div className="grid">
            <TextInput label="Objet" wide value={t.subject} onChange={(v) => setTpl(i, 'subject', v)} maxLength={300} />
            <TextArea label="Message" value={t.body} onChange={(v) => setTpl(i, 'body', v)} rows={8} />
          </div>
        </details>
      ))}
    </Section>
  );
}
