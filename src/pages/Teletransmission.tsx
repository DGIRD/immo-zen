import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../data/store.tsx';
import {
  MANDATE_VERSION, SUBMISSION_STATUS, TdfcBlocked, TdfcUnavailable, declarantErrors,
  type Preview, type TdfcDeclarant, type TdfcMandate, type TdfcSubmission,
} from '../data/tdfc.ts';
import type { TdfcCheck } from '../domain/edi/tdfc.ts';
import { downloadBlob } from '../domain/exporting.ts';
import { money2 } from '../domain/format.ts';
import { navigate } from '../ui/router.ts';
import { Button, Checkbox, PageHeader, Pill, Section, Select, TextInput } from '../ui/components.tsx';

const EMPTY: TdfcDeclarant = { siren: '', rof: 'BIC1', name: '', address: { street: '', zip: '', city: '' }, home: null, naf: '6820A', activity: null };
const FORM_LABELS: Record<string, string> = {
  'F-IDENTIF': 'Identification', '2031': '2031 – Déclaration de résultats', '2033A': '2033-A – Bilan simplifié', '2033B': '2033-B – Compte de résultat',
  '2033C': '2033-C – Immobilisations et amortissements', '2033D': '2033-D', '2033E': '2033-E', '2033F': '2033-F', '2033G': '2033-G',
};
const frDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
const frDateTime = (iso: string) => new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' });

/** Texte du mandat présenté à l'abonné (version enregistrée avec la signature). */
function MandateText() {
  return (
    <div className="tdfc-mandate-text">
      <p>Je donne mandat à la société Immo-Zen, partenaire EDI habilité par la Direction générale des Finances publiques, pour transmettre par voie électronique (procédure EDI-TDFC), en mon nom, la déclaration de résultats de mon activité de location meublée (formulaire 2031 et annexes 2033-A à 2033-G) établie à partir des données que j’ai enregistrées dans Immo-Zen.</p>
      <ul>
        <li>Je reste seul responsable du contenu de ma déclaration : je la vérifie avant chaque préparation.</li>
        <li>Immo-Zen transmet la déclaration telle que je l’ai validée, me communique les accusés de réception et comptes rendus de la DGFiP, et conserve une copie de chaque envoi.</li>
        <li>Ce mandat vaut jusqu’à sa révocation, que je peux faire à tout moment depuis cette page ; il ne remet pas en cause les envois déjà effectués.</li>
      </ul>
      <p className="muted small">Version {MANDATE_VERSION}.</p>
    </div>
  );
}

function StepTitle({ n, title, state }: { n: number; title: string; state: 'fait' | 'a_faire' | 'bloque' }) {
  const label = state === 'fait' ? 'Fait' : state === 'bloque' ? 'À corriger' : 'À faire';
  return (
    <span className="tdfc-step-title">
      <span className="tdfc-step-n" aria-hidden="true">{n}</span>{title}
      <Pill tone={state === 'fait' ? 'ok' : state === 'bloque' ? 'bad' : 'neutral'}>{label}</Pill>
    </span>
  );
}

function CheckList({ checks }: { checks: TdfcCheck[] }) {
  if (checks.length === 0) return <p className="tdfc-ok">Aucun point bloquant ni avertissement.</p>;
  return (
    <ul className="tdfc-checks">
      {checks.map((c, i) => <li key={i} className={c.level === 'bloquant' ? 'bad' : 'warn'}><strong>{c.level === 'bloquant' ? 'Bloquant' : 'Avertissement'} :</strong> {c.message}</li>)}
    </ul>
  );
}

export function TeletransmissionPage() {
  const { repo, data, notify } = useStore();
  const api = repo.platform.tdfc;
  const thisYear = Number(new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' }).slice(0, 4));
  const [year, setYear] = useState(String(thisYear - 1));
  const [ready, setReady] = useState<boolean | null>(null);
  const [saved, setSaved] = useState<TdfcDeclarant | null>(null);
  const [form, setForm] = useState<TdfcDeclarant>(EMPTY);
  const [homeDiffers, setHomeDiffers] = useState(false);
  const [tried, setTried] = useState(false);
  const [mandates, setMandates] = useState<TdfcMandate[]>([]);
  const [accept, setAccept] = useState(false);
  const [submissions, setSubmissions] = useState<TdfcSubmission[]>([]);
  const [preview, setPreview] = useState<{ preview: Preview; test: boolean } | null>(null);
  const [busy, setBusy] = useState<'' | 'save' | 'mandate' | 'preview' | 'prepare'>('');
  const [prepareError, setPrepareError] = useState<{ message: string; checks?: TdfcCheck[]; unavailable?: boolean } | null>(null);
  const [prepared, setPrepared] = useState<{ reference: string; test: boolean; sha256: string; fileName: string; bytes: Uint8Array } | null>(null);

  async function load() {
    try {
      const ok = await api.ready();
      setReady(ok);
      if (!ok) return;
      const [d, m, s] = await Promise.all([api.declarant(), api.mandates(), api.submissions()]);
      setSaved(d); setForm(d ?? EMPTY); setHomeDiffers(!!d?.home); setMandates(m); setSubmissions(s);
    } catch (e) { notify((e as Error).message, 'error'); }
  }
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const decl = { ...form, home: homeDiffers ? (form.home ?? { street: '', zip: '', city: '' }) : null };
  const errors = declarantErrors(decl);
  const dirty = JSON.stringify(decl) !== JSON.stringify(saved ?? null);
  const mandate = mandates.find((m) => !m.revoked_at) ?? null;
  const userChecks = preview?.preview.checks.filter((c) => c.scope !== 'partenaire') ?? [];
  const partnerChecks = preview?.preview.checks.filter((c) => c.scope === 'partenaire') ?? [];
  const userBlocking = userChecks.some((c) => c.level === 'bloquant');
  const serviceClosed = partnerChecks.some((c) => c.level === 'bloquant');
  const byForm = useMemo(() => {
    const m = new Map<string, Preview['items']>();
    for (const i of preview?.preview.items ?? []) m.set(i.form, [...(m.get(i.form) ?? []), i]);
    return [...m.entries()];
  }, [preview]);

  const set = (patch: Partial<TdfcDeclarant>) => { setForm((f) => ({ ...f, ...patch })); setPreview(null); };
  const setAddr = (k: 'address' | 'home', patch: Partial<TdfcDeclarant['address']>) =>
    setForm((f) => ({ ...f, [k]: { ...(f[k] ?? { street: '', zip: '', city: '' }), ...patch } }));

  async function save() {
    setTried(true);
    if (Object.keys(errors).length) return;
    setBusy('save');
    try { await api.saveDeclarant(decl); notify('Identité fiscale enregistrée.', 'ok'); setTried(false); setPreview(null); await load(); }
    catch (e) { notify((e as Error).message, 'error'); }
    finally { setBusy(''); }
  }
  async function sign() {
    setBusy('mandate');
    try { await api.signMandate(); setAccept(false); notify('Mandat signé.', 'ok'); setMandates(await api.mandates()); }
    catch (e) { notify((e as Error).message, 'error'); }
    finally { setBusy(''); }
  }
  async function revoke() {
    setBusy('mandate');
    try { await api.revokeMandate(); notify('Mandat révoqué : aucune nouvelle déclaration ne sera préparée.', 'info'); setMandates(await api.mandates()); }
    catch (e) { notify((e as Error).message, 'error'); }
    finally { setBusy(''); }
  }
  async function check() {
    setBusy('preview'); setPrepareError(null); setPrepared(null);
    try {
      const snap = { properties: data.properties, leases: data.leases, charges: data.charges, payments: data.payments, allocations: data.allocations,
        expenses: data.expenses, deposits: data.deposits, taxInputs: data.settings?.tax_inputs ?? {} };
      setPreview(await api.preview(Number(year), snap));
    } catch (e) { notify((e as Error).message, 'error'); }
    finally { setBusy(''); }
  }
  async function prepare() {
    setBusy('prepare'); setPrepareError(null);
    try {
      const f = await api.prepare(Number(year));
      setPrepared(f);
      downloadBlob(new Blob([f.bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }), f.fileName);
      setSubmissions(await api.submissions());
    } catch (e) {
      if (e instanceof TdfcBlocked) setPrepareError({ message: e.message, checks: e.checks });
      else setPrepareError({ message: (e as Error).message, unavailable: e instanceof TdfcUnavailable });
    } finally { setBusy(''); }
  }
  async function download(s: TdfcSubmission) {
    try { const f = await api.download(s.id); downloadBlob(new Blob([f.bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }), f.fileName); }
    catch (e) { notify((e as Error).message, 'error'); }
  }

  const years = Array.from({ length: 3 }, (_, i) => String(thisYear - 1 - i));
  const identityState = saved && !dirty ? 'fait' : tried && Object.keys(errors).length ? 'bloque' : 'a_faire';
  const previewState = !preview ? 'a_faire' : userBlocking ? 'bloque' : 'fait';
  const canPrepare = !!saved && !dirty && !!mandate && !!preview && !userBlocking && busy === '';

  return (
    <div className="tdfc-page">
      <PageHeader title="Télétransmission de la liasse"
        subtitle="Déclaration de résultats de la location meublée au réel (2031 et 2033-A à G), transmise à la DGFiP par Immo-Zen en procédure EDI-TDFC."
        actions={<Button onClick={() => navigate('/declaration')}>Retour à la déclaration</Button>} />

      {ready === false && <p className="tdfc-banner bad" role="alert">La télétransmission n’est pas encore activée sur ce compte : mise à jour de la base requise.</p>}

      <div className="tdfc-year">
        <Select label="Revenus de l’année" value={year} onChange={(v) => { setYear(v ?? year); setPreview(null); setPrepared(null); setPrepareError(null); }}
          options={years.map((y) => [y, `${y} (déclaration ${Number(y) + 1})`] as [string, string])} />
      </div>

      <Section title={<StepTitle n={1} title="Identité fiscale" state={identityState} />}>
        <p className="muted small">Ces informations figurent dans votre espace professionnel sur impots.gouv.fr (rubrique « Mon dossier professionnel »).</p>
        <div className="grid">
          <TextInput label="SIREN" required value={form.siren} onChange={(v) => set({ siren: v.replace(/\D/g, '').slice(0, 9) })} error={tried ? errors.siren : undefined} hint="9 chiffres, attribué lors de la déclaration de début d’activité (P0i)." />
          <TextInput label="Référence d’obligation fiscale" required value={form.rof} onChange={(v) => set({ rof: v.toUpperCase() })} error={tried ? errors.rof : undefined} hint="En général BIC1." />
          <TextInput label="Nom et prénom" required value={form.name} onChange={(v) => set({ name: v })} maxLength={35} error={tried ? errors.name : undefined} />
          <TextInput label="Code NAF" value={form.naf} onChange={(v) => set({ naf: v.toUpperCase() || null })} error={tried ? errors.naf : undefined} hint="6820A : location de logements." />
          <TextInput label="Adresse de l’activité" required value={form.address.street} onChange={(v) => setAddr('address', { street: v })} maxLength={35} error={tried ? errors.street : undefined} hint="Celle déclarée au SIE ; souvent celle du logement loué." />
          <TextInput label="Complément" value={form.address.complement} onChange={(v) => setAddr('address', { complement: v })} maxLength={35} />
          <TextInput label="Code postal" required value={form.address.zip} onChange={(v) => setAddr('address', { zip: v.replace(/\D/g, '').slice(0, 5) })} error={tried ? errors.zip : undefined} />
          <TextInput label="Ville" required value={form.address.city} onChange={(v) => setAddr('address', { city: v })} maxLength={35} error={tried ? errors.city : undefined} />
        </div>
        <Checkbox label="Mon domicile est à une autre adresse" checked={homeDiffers} onChange={(v) => { setHomeDiffers(v); setPreview(null); }} />
        {homeDiffers && (
          <div className="grid">
            <TextInput label="Adresse du domicile" required value={form.home?.street} onChange={(v) => setAddr('home', { street: v })} maxLength={35} error={tried ? errors.homeStreet : undefined} />
            <TextInput label="Code postal du domicile" required value={form.home?.zip} onChange={(v) => setAddr('home', { zip: v.replace(/\D/g, '').slice(0, 5) })} error={tried ? errors.homeZip : undefined} />
            <TextInput label="Ville du domicile" required value={form.home?.city} onChange={(v) => setAddr('home', { city: v })} maxLength={35} error={tried ? errors.homeCity : undefined} />
          </div>
        )}
        <div className="tdfc-actions">
          <Button variant="primary" onClick={() => void save()} disabled={busy !== '' || !dirty}>{busy === 'save' ? 'Enregistrement…' : 'Enregistrer l’identité fiscale'}</Button>
          {saved && !dirty && <span className="muted small">Enregistrée.</span>}
          {dirty && saved && <span className="muted small">Modifications non enregistrées.</span>}
        </div>
      </Section>

      <Section title={<StepTitle n={2} title="Mandat de télétransmission" state={mandate ? 'fait' : 'a_faire'} />}>
        <MandateText />
        {mandate ? (
          <div className="tdfc-actions">
            <span>Signé le {frDateTime(mandate.signed_at)} (version {mandate.text_version}).</span>
            <Button variant="ghost" onClick={() => void revoke()} disabled={busy !== ''}>Révoquer le mandat</Button>
          </div>
        ) : (
          <div className="tdfc-actions">
            <Checkbox label="J’ai lu le mandat et je l’accepte" checked={accept} onChange={setAccept} />
            <Button variant="primary" onClick={() => void sign()} disabled={!accept || busy !== ''}>Signer le mandat</Button>
          </div>
        )}
        {mandates.some((m) => m.revoked_at) && (
          <p className="muted small">Historique : {mandates.map((m) => `signé le ${frDate(m.signed_at)}${m.revoked_at ? `, révoqué le ${frDate(m.revoked_at)}` : ' (en vigueur)'}`).join(' ; ')}.</p>
        )}
      </Section>

      <Section title={<StepTitle n={3} title="Vérification de la déclaration" state={previewState} />}>
        <p className="muted small">La vérification reprend vos loyers, dépenses, amortissements et le bilan relu dans la déclaration fiscale. Elle ne transmet rien.</p>
        <div className="tdfc-actions">
          <Button variant="primary" onClick={() => void check()} disabled={busy !== '' || !saved || dirty}>{busy === 'preview' ? 'Vérification…' : `Vérifier ma déclaration ${Number(year) + 1}`}</Button>
          <Button variant="ghost" onClick={() => navigate('/declaration')}>Relire le bilan</Button>
          {(!saved || dirty) && <span className="muted small">Enregistrez d’abord votre identité fiscale.</span>}
        </div>
        {preview && (
          <div className="tdfc-preview" aria-label="Résultat de la vérification">
            {preview.preview.items.length > 0 && (
              <dl className="tdfc-summary">
                <div><dt>Recettes</dt><dd>{money2(preview.preview.summary.turnover)}</dd></div>
                <div><dt>Résultat fiscal</dt><dd>{money2(preview.preview.summary.fiscalResult)}</dd></div>
                <div><dt>Total du bilan</dt><dd>{money2(preview.preview.summary.assetsNet)}</dd></div>
                <div><dt>Données transmises</dt><dd>{preview.preview.items.length}</dd></div>
              </dl>
            )}
            <h4>Points à vérifier</h4>
            <CheckList checks={userChecks} />
            {serviceClosed && (
              <p className="tdfc-banner warn">Immo-Zen n’a pas encore terminé son habilitation auprès de la DGFiP : la préparation signée ouvrira dès réception de l’agrément et de l’accréditation. Votre déclaration peut déjà être vérifiée.</p>
            )}
            {byForm.length > 0 && <h4>Données qui seront transmises</h4>}
            {byForm.map(([form, items]) => (
              <details key={form} className="tdfc-form">
                <summary>{FORM_LABELS[form] ?? form} <span className="muted small">({items.length})</span></summary>
                <div className="dt-scroll"><table className="dt-table compact">
                  <thead><tr><th>Case</th><th>Libellé</th><th className="num">Valeur</th></tr></thead>
                  <tbody>{items.map((i, k) => <tr key={k}><td><strong>{i.code}</strong></td><td>{i.label}</td><td className="num">{i.kind === 'montant' ? money2(Number(i.value)).replace(/,00/, '') : i.kind === 'date' ? `${i.value.slice(6)}/${i.value.slice(4, 6)}/${i.value.slice(0, 4)}` : i.value}</td></tr>)}</tbody>
                </table></div>
              </details>
            ))}
          </div>
        )}
      </Section>

      <Section title={<StepTitle n={4} title="Préparation et signature" state={prepared ? 'fait' : prepareError?.checks ? 'bloque' : 'a_faire'} />}>
        <p className="muted small">Immo-Zen fige votre déclaration, la numérote, la signe électroniquement et en conserve une copie. Le fichier est {preview?.test === false ? 'destiné à un envoi réel' : 'préparé en mode test'}.</p>
        <ul className="tdfc-prereq">
          <li className={saved && !dirty ? 'ok' : ''}>Identité fiscale enregistrée</li>
          <li className={mandate ? 'ok' : ''}>Mandat signé</li>
          <li className={preview && !userBlocking ? 'ok' : ''}>Déclaration vérifiée, sans point bloquant</li>
        </ul>
        <div className="tdfc-actions">
          <Button variant="primary" onClick={() => void prepare()} disabled={!canPrepare}>{busy === 'prepare' ? 'Préparation…' : 'Préparer et signer la déclaration'}</Button>
        </div>
        {prepareError && (
          <div className={`tdfc-banner ${prepareError.unavailable ? 'warn' : 'bad'}`} role="alert">
            <p>{prepareError.message}</p>
            {prepareError.checks && <CheckList checks={prepareError.checks.filter((c) => c.level === 'bloquant')} />}
          </div>
        )}
        {prepared && (
          <div className="tdfc-banner ok" role="status">
            <p><strong>Déclaration préparée et signée</strong>{prepared.test ? ' (mode test)' : ''} : référence {prepared.reference}. Le fichier {prepared.fileName} a été téléchargé.</p>
            <p className="small">Empreinte SHA-256 : <code className="tdfc-hash">{prepared.sha256}</code></p>
            <p className="small">L’envoi à la DGFiP et le suivi des accusés de réception arrivent prochainement : la déclaration est conservée dans l’historique ci-dessous.</p>
          </div>
        )}
      </Section>

      <Section title="Historique des déclarations préparées">
        {submissions.length === 0 ? <p className="muted">Aucune déclaration préparée pour l’instant.</p> : (
          <div className="dt-scroll"><table className="dt-table compact tdfc-history">
            <thead><tr><th>Préparée le</th><th>Revenus</th><th>Référence</th><th>Mode</th><th>État</th><th className="num">Résultat fiscal</th><th /></tr></thead>
            <tbody>{submissions.map((s) => (
              <tr key={s.id}>
                <td>{frDateTime(s.prepared_at)}</td><td>{s.year}</td><td><code>{s.reference}</code></td><td>{s.test ? 'Test' : 'Réel'}</td>
                <td>{SUBMISSION_STATUS[s.status]}{s.status_detail ? <div className="muted small">{s.status_detail}</div> : null}</td>
                <td className="num">{s.summary.fiscalResult != null ? money2(s.summary.fiscalResult) : '—'}</td>
                <td><Button size="sm" variant="ghost" onClick={() => void download(s)}>Télécharger</Button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Section>
    </div>
  );
}
