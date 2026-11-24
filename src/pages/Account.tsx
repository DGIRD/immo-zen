import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../data/store.tsx';
import { money, todayParis } from '../domain/format.ts';
import { patrimonyLines } from '../domain/patrimony.ts';
import {
  activeOtherLoans, borrowerNames, CONTRACT_LABELS, FAMILY_LABELS, HOUSING_LABELS, householdIncome, LOAN_KIND_LABELS, missingFields, sanitizeInfo,
  type Contract, type Family, type Housing, type LoanKind, type OtherLoan, type PersonalInfo, type PersonInfo,
} from '../domain/personalInfo.ts';
import { Button, Checkbox, KeyValue, NumberInput, PageHeader, Section, Select, Tabs, TextArea, TextInput } from '../ui/components.tsx';
import { navigate } from '../ui/router.ts';
import { AddressFields } from '../ui/AddressFields.tsx';
import { round2 } from '../domain/simulator.ts';
import { RENT_WEIGHT } from '../domain/bankDossier.ts';
import type { IncomePeriod } from '../domain/personalInfo.ts';

type AccountTab = 'infos' | 'abonnement';

/** En-tête commun de « Mon compte » : informations personnelles et abonnement. */
export function AccountHeader({ tab }: { tab: AccountTab }) {
  return (
    <>
      <PageHeader title="Mon compte" />
      <Tabs<AccountTab> tabs={[['infos', 'Informations personnelles'], ['abonnement', 'Abonnement']]} value={tab}
        onChange={(t) => navigate(t === 'abonnement' ? '/abonnement' : '/compte')} />
    </>
  );
}

const CONTRACTS = Object.entries(CONTRACT_LABELS) as [Contract, string][];
const FAMILIES = Object.entries(FAMILY_LABELS) as [Family, string][];
const HOUSINGS = Object.entries(HOUSING_LABELS) as [Housing, string][];
const LOAN_KINDS = Object.entries(LOAN_KIND_LABELS) as [LoanKind, string][];

const PERIODS: [IncomePeriod, string][] = [['mois', 'Par mois'], ['an', 'Par an']];

/** Montant saisi par mois ou par an (bascule sous le champ) ; la valeur transmise reste mensuelle. */
function IncomeInput({ label, monthly, period = 'mois', onChange, hint }: {
  label: string; monthly: number | null | undefined; period?: IncomePeriod; onChange: (monthly: number | null, period: IncomePeriod) => void; hint?: string;
}) {
  const shown = monthly == null || Number.isNaN(monthly) ? monthly : round2(period === 'an' ? monthly * 12 : monthly);
  return (
    <NumberInput label={label} suffix={period === 'an' ? '€ / an' : '€ / mois'} value={shown ?? null}
      onChange={(v) => onChange(v == null || Number.isNaN(v) ? v : period === 'an' ? v / 12 : v, period)}
      hint={<>
        <span className="period-toggle" role="group" aria-label={`${label} : saisie`}>
          {PERIODS.map(([p, l]) => <button key={p} type="button" aria-pressed={period === p} className={period === p ? 'on' : ''} onClick={() => onChange(monthly ?? null, p)}>{l}</button>)}
        </span>
        {hint && <span className="period-hint">{hint}</span>}
        {period === 'an' && monthly ? <span className="period-hint">Soit {money(monthly)} par mois</span> : null}
      </>} />
  );
}

function PersonFields({ value, onChange, coBorrower }: { value: PersonInfo; onChange: (p: PersonInfo) => void; coBorrower?: boolean }) {
  const set = <K extends keyof PersonInfo>(k: K, v: PersonInfo[K]) => onChange({ ...value, [k]: v });
  const retired = value.contract === 'retraite' || value.contract === 'sans_activite';
  return (
    <div className="grid">
      <TextInput label="Prénom" value={value.first_name} onChange={(v) => set('first_name', v)} autoComplete={coBorrower ? 'off' : 'given-name'} />
      <TextInput label="Nom" value={value.last_name} onChange={(v) => set('last_name', v)} autoComplete={coBorrower ? 'off' : 'family-name'} />
      <TextInput label="Date de naissance" type="date" value={value.birth_date ?? ''} onChange={(v) => set('birth_date', v || null)} hint="L’âge figure dans le dossier banque" />
      <Select<Contract> label="Situation professionnelle" value={value.contract ?? null} onChange={(v) => set('contract', v)} options={CONTRACTS} allowEmpty="—" />
      <TextInput label="Profession" value={value.profession} onChange={(v) => set('profession', v)} hint="Ex. : ingénieur, infirmière" />
      {!retired && <TextInput label="Employeur" value={value.employer} onChange={(v) => set('employer', v)} />}
      {!retired && <TextInput label="Dans cet emploi depuis" type="date" value={value.since ?? ''} onChange={(v) => set('since', v || null)} hint="Ancienneté, regardée par la banque" />}
      <IncomeInput label="Revenus nets" monthly={value.income} period={value.income_period} onChange={(m, p) => onChange({ ...value, income: m, income_period: p })}
        hint="Net avant impôt, primes et 13e mois compris" />
    </div>
  );
}

export function PersonalInfoPage() {
  const { data, session, saveSettings, notify, repo } = useStore();
  const saved = data.settings?.personal_info ?? {};
  const [info, setInfo] = useState<PersonalInfo>(() => ({ ...saved, other_loans: saved.other_loans ?? [] }));
  const [busy, setBusy] = useState(false);
  const savedKey = JSON.stringify(sanitizeInfo({ ...saved, other_loans: saved.other_loans ?? [] }));
  const dirty = JSON.stringify(sanitizeInfo(info)) !== savedKey;
  // informations chargées après l'ouverture de la page (synchronisation) ou modifiées ailleurs : reprises si rien n'est en cours de saisie
  const lastSaved = useRef(savedKey);
  useEffect(() => {
    if (savedKey === lastSaved.current) return;
    setInfo((cur) => (JSON.stringify(sanitizeInfo(cur)) === lastSaved.current ? { ...saved, other_loans: saved.other_loans ?? [] } : cur));
    lastSaved.current = savedKey;
  }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof PersonalInfo>(k: K, v: PersonalInfo[K]) => setInfo((x) => ({ ...x, [k]: v }));
  const today = todayParis();

  const owned = useMemo(() => patrimonyLines(data.properties, today), [data.properties, today]);
  const propertyLoans = owned.filter((l) => l.monthlyLoan > 0);
  const loans = info.other_loans ?? [];
  const setLoan = (id: string, patch: Partial<OtherLoan>) => set('other_loans', loans.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const missing = missingFields(info);
  const income = householdIncome(sanitizeInfo(info));
  const rents = round2(owned.reduce((s, l) => s + l.monthlyRent, 0));
  const weight = info.rent_weight != null && !Number.isNaN(info.rent_weight) && info.rent_weight >= 0 && info.rent_weight <= 100 ? info.rent_weight : RENT_WEIGHT * 100;
  const otherMonthly = activeOtherLoans(sanitizeInfo(info), today).reduce((s, l) => s + (l.monthly ?? 0), 0);

  async function save() {
    setBusy(true);
    try {
      if (await saveSettings({ personal_info: sanitizeInfo(info) })) notify('Informations personnelles enregistrées.');
    } finally { setBusy(false); }
  }

  const saveBar = (
    <div className="row">
      <Button variant="primary" disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Enregistrement…' : dirty ? 'Enregistrer' : 'Enregistré'}</Button>
    </div>
  );

  return (
    <>
      <AccountHeader tab="infos" />
      <p className="muted">
        Ces informations remplissent automatiquement le <strong>dossier banque</strong> et l’<strong>offre d’achat</strong> de vos simulations.
        Elles ne sont visibles que de vous{repo.mode === 'demo' ? ' (en démonstration, elles restent dans ce navigateur)' : ''}. Ne saisissez ni numéro de compte bancaire ni numéro de pièce d’identité.
      </p>
      {missing.length > 0 && <p className="note">Pour un dossier complet, il manque : {missing.join(', ')}.</p>}

      <Section title="Emprunteur" actions={saveBar}>
        <PersonFields value={info.borrower ?? {}} onChange={(p) => set('borrower', p)} />
        <Checkbox label="J’emprunte avec un co-emprunteur (conjoint, partenaire…)" checked={!!info.co_borrower} onChange={(v) => set('co_borrower', v ? { last_name: info.borrower?.last_name } : null)} />
      </Section>

      {info.co_borrower && (
        <Section title="Co-emprunteur">
          <PersonFields coBorrower value={info.co_borrower} onChange={(p) => set('co_borrower', p)} />
        </Section>
      )}

      <Section title="Foyer et coordonnées">
        <div className="grid">
          <Select<Family> label="Situation familiale" value={info.family ?? null} onChange={(v) => set('family', v)} options={FAMILIES} allowEmpty="—" />
          <NumberInput label="Enfants à charge" value={info.children ?? null} onChange={(v) => set('children', v)} />
          <AddressFields value={info} onChange={(a) => setInfo((x) => ({ ...x, address: a.address ?? '', zip: a.zip ?? '', city: a.city ?? '' }))} />
          <TextInput label="Téléphone" type="tel" value={info.phone} onChange={(v) => set('phone', v)} autoComplete="tel" />
          <TextInput label="E-mail de contact" type="email" value={info.email} onChange={(v) => set('email', v)} placeholder={session?.email} autoComplete="email" />
          <Select<Housing> label="Logement actuel" value={info.housing ?? null} onChange={(v) => set('housing', v)} options={HOUSINGS} allowEmpty="—"
            hint={info.housing === 'proprietaire' ? 'Ajoutez votre résidence principale dans « Mes biens » pour la faire figurer au bilan patrimonial' : undefined} />
          {info.housing === 'locataire' && <NumberInput label="Loyer de votre logement" suffix="€ / mois" value={info.housing_rent ?? null} onChange={(v) => set('housing_rent', v)} />}
        </div>
      </Section>

      <Section title="Revenus complémentaires">
        <div className="grid">
          <IncomeInput label="Autres revenus réguliers" monthly={info.other_income} period={info.other_income_period}
            onChange={(m, p) => setInfo((x) => ({ ...x, other_income: m, other_income_period: p }))}
            hint="Pensions, allocations, revenus de capitaux… hors loyers de vos biens (repris ci-dessous)" />
          <NumberInput label="Part des loyers retenue par la banque" suffix="%" value={info.rent_weight ?? null} onChange={(v) => set('rent_weight', v)}
            error={info.rent_weight != null && (Number.isNaN(info.rent_weight) || info.rent_weight < 0 || info.rent_weight > 100) ? 'Entre 0 et 100 %' : undefined}
            hint={`Vide : ${RENT_WEIGHT * 100} %, la pratique la plus courante. Certaines banques retiennent 60 %, 80 % ou les loyers nets de charges`} />
          {!!info.other_income && <TextInput label="Nature de ces revenus" value={info.other_income_label} onChange={(v) => set('other_income_label', v)} hint="Ex. : pension alimentaire" />}
</div>
        <KeyValue items={[
          ['Loyers de vos biens loués', rents > 0 ? `${money(rents)} par mois, soit ${money(rents * 12)} par an (repris de « Mes biens »)` : 'aucun bien loué dans « Mes biens »'],
          ...(rents > 0 ? [[`Loyers retenus par la banque (${weight} %)`, `${money(round2(rents * weight / 100))} par mois`] as [string, string]] : []) as [string, string][],
          ['Revenus du foyer', `${money(income)} par mois hors loyers ; ${money(round2(income + rents))} loyers compris`],
        ]} />
      </Section>

      <Section title="Épargne disponible">
        <div className="grid">
          <NumberInput label="Épargne disponible" suffix="€" value={info.savings ?? null} onChange={(v) => set('savings', v)}
            hint="Livrets, comptes à terme, assurance-vie, PEA… avant l’apport du projet" />
        </div>
        <p className="muted small">Le dossier banque en déduit l’apport de la simulation (épargne restante après l’apport) et l’ajoute au bilan patrimonial (patrimoine total = immobilier net + épargne).</p>
      </Section>

      <Section title="Autres crédits en cours" info="Les crédits de vos biens immobiliers sont repris automatiquement de « Mes biens » (mensualité, capital restant dû). Déclarez ici uniquement vos autres crédits : prêt personnel, auto, travaux, étudiant, LOA, crédit renouvelable…">
        <p className="muted small">
          {propertyLoans.length
            ? <>Repris de « Mes biens » : {propertyLoans.map((l) => `${l.title} ${money(l.monthlyLoan)}`).join(' ; ')} par mois. </>
            : <>Aucun crédit immobilier dans « Mes biens ». </>}
          Déclarez ici uniquement les autres crédits.
        </p>
        {loans.map((l) => (
          <div key={l.id} className="offer-arg on">
            <div className="grid">
              <Select<LoanKind> label="Type de crédit" value={l.kind} onChange={(v) => setLoan(l.id, { kind: v ?? 'autre' })} options={LOAN_KINDS} />
              <TextInput label="Libellé" value={l.label} onChange={(v) => setLoan(l.id, { label: v })} hint="Ex. : voiture 2024" />
              <TextInput label="Organisme prêteur" value={l.lender} onChange={(v) => setLoan(l.id, { lender: v })} />
              <NumberInput label="Mensualité" suffix="€" value={l.monthly ?? null} onChange={(v) => setLoan(l.id, { monthly: v })} hint="Assurance comprise" />
              <NumberInput label="Capital restant dû" suffix="€" value={l.remaining ?? null} onChange={(v) => setLoan(l.id, { remaining: v })} />
              <TextInput label="Dernière échéance" type="date" value={l.end_date ?? ''} onChange={(v) => setLoan(l.id, { end_date: v || null })} hint="Un crédit terminé n’est plus compté" />
            </div>
            <Button size="sm" variant="danger" onClick={() => set('other_loans', loans.filter((x) => x.id !== l.id))}>Retirer ce crédit</Button>
          </div>
        ))}
        <div className="row">
          <Button size="sm" onClick={() => set('other_loans', [...loans, { id: crypto.randomUUID(), kind: 'consommation' }])}>Ajouter un crédit</Button>
          {otherMonthly > 0 && <span className="muted small">Autres crédits en cours : {money(otherMonthly)} par mois.</span>}
        </div>
      </Section>

      <Section title="Présentation pour la banque">
        <TextArea label="Texte de présentation (facultatif)" value={info.presentation} onChange={(v) => set('presentation', v)} rows={3}
          hint="Repris en page de garde du dossier banque, modifiable à chaque dossier. Ex. : investisseurs depuis 2019, deux biens loués sans impayé" />
      </Section>

      <div className="row">{saveBar}{borrowerNames(info) && <span className="muted small">Dossier banque et offre d’achat seront établis au nom de {borrowerNames(info)}.</span>}</div>
    </>
  );
}
