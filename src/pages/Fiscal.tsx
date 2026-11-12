import { useMemo, useState } from 'react';
import { useStore } from '../data/store.tsx';
import type { BilanCorrection, MeubleKind, TaxInputs, TaxPropertyInputs, TaxRegime } from '../data/types.ts';
import { downloadBlob, stamp, toXlsx } from '../domain/exporting.ts';
import { money2, todayParis } from '../domain/format.ts';
import { DEFAULT_TAX_INPUTS, depreciationItems, FONCIER_DEFICIT_LIMIT, fiscalSummary, MEUBLE_KIND_LABELS, MICRO_BIC_LIMIT, MICRO_FONCIER_LIMIT, type FiscalSummary } from '../domain/fiscal.ts';
import { declarationGuide, guideSections } from '../domain/taxGuide.ts';
import { buildDocPdf } from '../domain/docPdf.ts';
import { liasseDoc } from '../domain/liassePdf.ts';
import { CERFA_FILES } from '../domain/cerfaOfficial.ts';
import { TAX_REGIME_LABELS } from '../domain/labels.ts';
import { Button, EmptyState, NumberInput, PageHeader, Section, Select, Tabs } from '../ui/components.tsx';
import { ChecksList, collectChecks, CopyAmount, FiledCompare, Lexique, TodoCard, totalsOf, YearCompare, type TabKey } from './FiscalParts.tsx';
import { round2 } from '../domain/simulator.ts';
import { LoanYearFields } from './FiscalLoan.tsx';
import { reviewBilan } from '../domain/bilanReview.ts';
import { navigate } from '../ui/router.ts';
import { BilanReviewSection } from './FiscalBilan.tsx';
import { AssetsDetail, DeferredTracking, recapFromFoncier, recapFromReelBic, ResultRecap } from './FiscalRecap.tsx';
import { href } from '../ui/router.ts';
import { tdfcVisible } from '../data/tdfc.ts';

interface Box { form: string; code: string; label: string; amount: number; property?: string }

const PARAMS = 'params';
const FOYER = 'foyer';
type NumKey = Exclude<keyof TaxPropertyInputs, 'meuble_kind' | 'bilan_corrections'>;

export function FiscalPage() {
  const { repo, data, update, saveSettings, notify } = useStore();
  const thisYear = Number(todayParis().slice(0, 4));
  const years = useMemo(() => {
    const ys = new Set<number>([thisYear - 1, thisYear]);
    for (const e of data.expenses) ys.add(Number((e.paid_on ?? e.expense_date).slice(0, 4)));
    for (const p of data.payments) ys.add(Number(p.paid_on.slice(0, 4)));
    return [...ys].filter((y) => y > 1990).sort((a, b) => b - a);
  }, [data.expenses, data.payments, thisYear]);
  const [year, setYear] = useState(thisYear - 1);
  const [tab, setTabState] = useState<TabKey>(() => { try { return (localStorage.getItem('immozen:declaration-tab') as TabKey | null) ?? 'chiffres'; } catch { return 'chiffres'; } });
  const setTab = (t: TabKey) => { setTabState(t); try { localStorage.setItem('immozen:declaration-tab', t); } catch { /* préférence locale facultative */ } };
  const saved = (data.settings?.tax_inputs ?? {}) as TaxInputs;
  const [draft, setDraft] = useState<TaxInputs | null>(null);
  const inputs = draft ?? saved;
  const get = (pid: string, y: number): TaxPropertyInputs => ({ ...(inputs[PARAMS]?.[pid] ?? {}), ...(inputs[String(y)]?.[pid] ?? {}) });
  const setInput = (scope: string, pid: string, k: NumKey | 'meuble_kind' | 'bilan_corrections', v: number | MeubleKind | BilanCorrection[] | null) => setDraft((d) => {
    const base = structuredClone(d ?? saved);
    const cur: Record<string, unknown> = { ...(base[scope]?.[pid] ?? {}) };
    if (v === null) delete cur[k]; else cur[k] = v;
    base[scope] = { ...(base[scope] ?? {}), [pid]: cur as TaxPropertyInputs };
    return base;
  });

  const fiscal = useMemo(() => fiscalSummary(year, {
    properties: data.properties, leases: data.leases, charges: data.charges, payments: data.payments, allocations: data.allocations, expenses: data.expenses,
  }, get), // eslint-disable-next-line react-hooks/exhaustive-deps
  [year, data, inputs]);
  const title = (id: string) => data.properties.find((p) => p.id === id)?.title ?? '—';
  const boxes = collectBoxes(fiscal, title);
  const loanFields = (pid: string) => {
    const a = fiscal.amounts.get(pid);
    if (!a) return null;
    const cur = inputs[String(year)]?.[pid] ?? {};
    return <LoanYearFields a={a} year={year} interest={cur.loan_interest} insurance={cur.loan_insurance}
      setInterest={(v) => setInput(String(year), pid, 'loan_interest', v)} setInsurance={(v) => setInput(String(year), pid, 'loan_insurance', v)}
      onOpenProperty={() => navigate(`/bien/${pid}/modifier`)} />;
  };
  // amortissements de l'année pour chaque bien (bâti seulement pour les régimes qui l'amortissent)
  const fiscalData = { properties: data.properties, leases: data.leases, charges: data.charges, payments: data.payments, allocations: data.allocations, expenses: data.expenses };
  const amort = [...fiscal.amounts.keys()].map((pid) => {
    const p = data.properties.find((x) => x.id === pid)!;
    const withBuilding = p.tax_regime === 'reel_bic' || p.tax_regime === 'is';
    const { items } = depreciationItems(p, year, fiscalData, get(pid, year), withBuilding);
    return { p, items, total: items.reduce((a, i) => a + i.amount, 0) };
  }).filter((x) => x.items.length > 0);
  for (const a of amort) for (const i of a.items) boxes.push({ form: 'Amortissements', code: `${i.years} ans`, label: i.label, amount: i.amount, property: a.p.title });
  const owned = data.properties.filter((p) => p.status === 'acquis');
  const foyer = inputs[String(year)]?.[FOYER] ?? {};
  const reelProps = fiscal.reelBic ? fiscal.reelBic.perProperty.map((r) => data.properties.find((p) => p.id === r.propertyId)!).filter(Boolean) : [];
  const bilanReview = useMemo(() => fiscal.reelBic ? reviewBilan(year, { ...fiscalData, deposits: data.deposits }, reelProps, fiscal.reelBic.liasse, get, foyer) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fiscal, data.deposits, foyer]);
  const priorDeficits = inputs[String(year)]?.[FOYER]?.prior_deficits ?? 0;
  const guide = declarationGuide(fiscal, data.properties, { priorDeficits });
  async function exportPdf() {
    const lib = await import('pdf-lib');
    const bytes = await buildDocPdf(lib as never, {
      title: `Dossier de déclaration – revenus ${year}`,
      subtitle: `Montants à reporter en ${year + 1} sur impots.gouv.fr, calculés par Immo-Zen le ${todayParis().split('-').reverse().join('/')} à partir des loyers encaissés et des dépenses payées. Aide au remplissage : à vérifier avec les notices officielles ; ne vaut ni attestation ni conseil fiscal.`,
      sections: guideSections(guide),
      footer: `Immo-Zen – déclaration ${year + 1}`,
    });
    downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `immo-zen-dossier-declaration-${year}.pdf`);
  }

  /** Liasse LMNP en document de travail (forme des liasses des services en ligne). */
  async function exportLiasse() {
    if (!fiscal.reelBic) return;
    let declarant: Parameters<typeof liasseDoc>[0]['declarant'] = null;
    try {
      const api = repo.platform.tdfc;
      if (await api.ready()) {
        const d = await api.declarant();
        const addr = (a: { street: string; zip: string; city: string } | null | undefined) => (a ? `${a.street}, ${a.zip} ${a.city}` : null);
        if (d) declarant = { name: d.name, siren: d.siren, address: addr(d.address), home: addr(d.home) };
      }
    } catch { /* identité facultative : la liasse reste éditable sans elle */ }
    const lib = await import('pdf-lib');
    // imprimés officiels livrés avec l'application ; à défaut, formulaires redessinés
    let cerfa = null;
    try {
      const get = async (f: string) => { const r = await fetch(f); if (!r.ok) throw new Error(f); return new Uint8Array(await r.arrayBuffer()); };
      cerfa = { f2031: await get(CERFA_FILES.f2031), f2033: await get(CERFA_FILES.f2033) };
    } catch { cerfa = null; }
    const bytes = await buildDocPdf(lib as never, liasseDoc({ year, reel: fiscal.reelBic, properties: data.properties, bilan: bilanReview?.bilan ?? null, declarant, editedOn: todayParis(), cerfa }));
    downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `immo-zen-liasse-lmnp-${year}.pdf`);
  }

  async function saveInputs() {
    if (!draft) return;
    if (await saveSettings({ tax_inputs: draft })) { setDraft(null); notify('Saisies enregistrées.'); }
  }
  async function exportXlsx() {
    downloadBlob(await toXlsx([{ name: `Déclaration ${year}`, rows: boxes, columns: [
      { label: 'Formulaire', value: (b: Box) => b.form }, { label: 'Case ou ligne', value: (b: Box) => b.code },
      { label: 'Libellé', value: (b: Box) => b.label }, { label: 'Bien', value: (b: Box) => b.property ?? 'Total' }, { label: 'Montant', value: (b: Box) => b.amount, kind: 'money' },
    ] }]), `immo-zen-declaration-${year}-${stamp()}.xlsx`);
  }

  const prevFiscal = useMemo(() => (years.includes(year - 1) || year - 1 >= Math.min(...years) ? fiscalSummary(year - 1, fiscalData, get) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [year, data, inputs]);
  const checks = collectChecks(fiscal, data.properties, {
    property: (id) => navigate(`/bien/${id}/modifier`), expenses: (id) => navigate(`/depenses?bien=${id}`), tab: setTab,
  });
  const cur = totalsOf(fiscal), prev = totalsOf(prevFiscal);
  const lmnpLabel = (r: NonNullable<FiscalSummary['reelBic']>['perProperty'][number]) => `résultat comptable ${money2(round2(r.resultBeforeDepreciation - r.depreciationYear))} · avant amortissement ${money2(r.resultBeforeDepreciation)}`;
  const tabs: [TabKey, string][] = [
    ['verifier', `1. Vérifier${checks.filter((c) => c.level === 'corriger').length ? ` (${checks.filter((c) => c.level === 'corriger').length})` : ''}`],
    ['chiffres', '2. Mes chiffres'], ['saisies', `3. Mes saisies${draft ? ' •' : ''}`], ['declarer', '4. Déclarer'], ['justificatifs', '5. Justificatifs'],
  ];

  return (
    <>
      <PageHeader title="Déclaration fiscale" subtitle={`Revenus ${year}, déclarés en ${year + 1}.`}
        actions={<>
          <label className="inline-select">Revenus de
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Année des revenus">{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
          </label>
          <Button onClick={() => void exportPdf()} disabled={!guide.length}>Dossier PDF</Button>
          <Button onClick={() => void exportXlsx()} disabled={!boxes.length}>Excel (.xlsx)</Button>
        </>} />
      {draft && <p className="unsaved" role="status">Saisies non enregistrées. <Button size="sm" variant="primary" onClick={() => void saveInputs()}>Enregistrer les saisies</Button></p>}

      {owned.length === 0 ? <EmptyState title="Aucun bien détenu">Ajoutez vos logements dans <a href={href('/biens')}>Mes biens</a> et indiquez leur régime fiscal.</EmptyState> : (
        <>
          <TodoCard year={year} guide={guide} checks={checks} unsaved={!!draft} notify={notify} onTab={setTab} />
          <Tabs tabs={tabs} value={tab} onChange={setTab} />

          {tab === 'verifier' && (
            <>
              <Section title="Points à vérifier">
                <ChecksList checks={checks} />
              </Section>
              <Section title="Régime de chaque bien">
                <div className="dt-scroll"><table className="dt-table compact">
                  <thead><tr><th>Bien</th><th>Régime fiscal</th><th className="num">Loyers HC {year}</th><th className="num">Charges encaissées</th><th className="num">Dépenses payées</th></tr></thead>
                  <tbody>{[...fiscal.amounts.entries()].map(([pid, a]) => {
                    const p = data.properties.find((x) => x.id === pid)!;
                    const spent = Object.entries(a.byCategory).filter(([k]) => k !== 'credit').reduce((t, [, v]) => t + (v ?? 0), 0);
                    return (
                      <tr key={pid}>
                        <td><a href={href(`/bien/${pid}`)}>{p.title}</a></td>
                        <td><select aria-label={`Régime de ${p.title}`} value={p.tax_regime ?? ''} onChange={(e) => void update('properties', p, { tax_regime: (e.target.value || null) as TaxRegime | null }, `Le bien « ${p.title} »`)}>
                          <option value="">À choisir…</option>
                          {(Object.entries(TAX_REGIME_LABELS) as [TaxRegime, string][]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select></td>
                        <td className="num">{money2(a.rentsHC)}</td><td className="num">{money2(a.chargesCollected)}</td><td className="num">{money2(spent)}</td>
                      </tr>
                    );
                  })}</tbody>
                </table></div>
                <p className="muted small">Location nue : micro-foncier (recettes ≤ {MICRO_FONCIER_LIMIT.toLocaleString('fr-FR')} €) ou réel (2044). Location meublée : micro-BIC (≤ {MICRO_BIC_LIMIT.toLocaleString('fr-FR')} €) ou réel (LMNP). Le régime se modifie aussi dans la fiche du bien.</p>
              </Section>
              <p className="muted small">Montants calculés à partir des loyers encaissés et des dépenses payées en {year} (Loyers et paiements, Dépenses, relevés importés). Aide au remplissage : elle ne vaut ni attestation ni conseil fiscal ; vérifiez avec les notices officielles ou un professionnel.</p>
            </>
          )}

          {tab === 'chiffres' && (
            <>
              {fiscal.reelBic && (
                <Section title="Location meublée au réel (LMNP)">
                  <ResultRecap title="Résultat par bien" rows={recapFromReelBic(fiscal.reelBic.perProperty)} properties={data.properties}
                    footer={[[`Résultat fiscal ${year}, après limitation de l’amortissement (${fiscal.reelBic.box5NY ? 'case 5NY : déficit' : 'case 5NA : bénéfice'})`, fiscal.reelBic.box5NY ? -fiscal.reelBic.box5NY : fiscal.reelBic.box5NA],
                      ['Stock d’amortissements reportables au 31 décembre', fiscal.reelBic.liasse.deferredAfter]]} />
                  <p className="muted small">Le « résultat » du tableau est le résultat comptable, toutes dotations déduites. Fiscalement, l’amortissement ne peut ni créer ni augmenter un déficit : la part non déduite rejoint le stock reportable ci-dessous.</p>
                  {fiscal.reelBic.perProperty.some((r) => r.depreciationYear > 0 || r.deferredBefore > 0) && (
                    <DeferredTracking list={fiscal.reelBic.perProperty} properties={data.properties} year={year} editable={false}
                      opening={(pid) => inputs[String(year)]?.[pid]?.deferred_opening ?? null} setOpening={(pid, v) => setInput(String(year), pid, 'deferred_opening', v)} />
                  )}
                  <h3>Détail par bien</h3>
                  {fiscal.reelBic.perProperty.map((r) => (
                    <details key={r.propertyId} className="tax-lmnp" open={fiscal.reelBic!.perProperty.length === 1}>
                      <summary><strong>{title(r.propertyId)}</strong> — {lmnpLabel(r)}</summary>
                      <KeyRows rows={[
                        ['Recettes (loyers et charges encaissés)', r.receipts],
                        ...r.charges.map((c) => [c.label, -c.amount] as [string, number]),
                        ...r.financial.map((c) => [c.label, -c.amount] as [string, number]),
                        ['= Résultat avant amortissement', r.resultBeforeDepreciation],
                        ['Amortissement de l’année', -r.depreciationYear],
                        ['= Résultat comptable', round2(r.resultBeforeDepreciation - r.depreciationYear)],
                        ['Stock reportable au 1er janvier', r.deferredBefore],
                        ['Amortissement effectivement déduit', -r.depreciationDeducted],
                        ['Stock reportable au 31 décembre', r.deferredAfter],
                      ]} />
                    </details>
                  ))}
                </Section>
              )}
              {fiscal.reelFoncier && (
                <Section title="Location nue au réel (2044)">
                  <ResultRecap title="Résultat par bien" rows={recapFromFoncier(fiscal.reelFoncier.perProperty)} properties={data.properties} />
                  <KeyRows rows={[
                    ['Case 4BA : revenu foncier imposable', fiscal.reelFoncier.boxes.box4BA],
                    ['Case 4BB : déficit imputable sur les revenus fonciers', fiscal.reelFoncier.boxes.box4BB],
                    ['Case 4BC : déficit imputable sur le revenu global', fiscal.reelFoncier.boxes.box4BC],
                  ]} />
                  <p className="muted small">Déficit imputable sur le revenu global plafonné à {FONCIER_DEFICIT_LIMIT.toLocaleString('fr-FR')} € (hors intérêts d’emprunt, qui ne s’imputent que sur les revenus fonciers).</p>
                </Section>
              )}
              {fiscal.microFoncier && (
                <Section title="Location nue au micro-foncier">
                  <KeyRows rows={[['Loyers bruts (case 4BE)', fiscal.microFoncier.box4BE], ['Revenu imposable estimé après abattement de 30 %', fiscal.microFoncier.taxable]]} />
                </Section>
              )}
              {fiscal.microBic && (
                <Section title="Location meublée au micro-BIC">
                  <KeyRows rows={fiscal.microBic.lines.flatMap((l) => [[`Recettes (case ${l.box}, ${l.label})`, l.amount], [`Revenu imposable estimé après abattement de ${Math.round(l.rate * 100)} %`, l.taxable]] as [string, number][])} />
                </Section>
              )}
              {cur && (
                <Section title="Contrôles">
                  <YearCompare year={year} cur={cur} prev={prev} />
                  <FiledCompare year={year} cur={cur} filed={foyer} setFiled={(k, v) => setInput(String(year), FOYER, k, v)} />
                </Section>
              )}
              {fiscal.other.length > 0 && (
                <Section title="Autres régimes">
                  <p className="muted">{fiscal.other.map((p) => p.title).join(', ')} : régime « {fiscal.other.map((p) => TAX_REGIME_LABELS[p.tax_regime!]).join(', ')} ». Société à l’impôt sur les sociétés : la liasse est établie au nom de la société.</p>
                </Section>
              )}
              <Lexique />
            </>
          )}

          {tab === 'saisies' && (
            <>
              <p className="muted">Seuls champs modifiables de la déclaration, par bien. Laissez vide pour garder le calcul automatique ; pensez à enregistrer.</p>
              {[...fiscal.amounts.keys()].map((pid) => {
                const p = data.properties.find((x) => x.id === pid)!;
                const prm = { ...DEFAULT_TAX_INPUTS, ...get(pid, year) };
                const reel = p.tax_regime === 'reel_bic' || p.tax_regime === 'is';
                const lmnp = fiscal.reelBic?.perProperty.find((r) => r.propertyId === pid);
                return (
                  <Section key={pid} title={`${p.title}${p.tax_regime ? ` — ${TAX_REGIME_LABELS[p.tax_regime]}` : ''}`}>
                    <div className="grid tax-inputs">
                      {loanFields(pid)}
                      <NumberInput label={p.tax_regime === 'reel_foncier' ? 'Ligne 213 : recettes diverses' : `Recettes diverses ${year}`} suffix="€" value={get(pid, year).other_income ?? null}
                        onChange={(v) => setInput(String(year), pid, 'other_income', v)} hint="Indemnités d’assurance, subventions…" />
                      {p.tax_regime === 'reel_foncier' && (
                        <NumberInput label="Ligne 230 : régularisation N−1" suffix="€" value={get(pid, year).regularisation ?? null} onChange={(v) => setInput(String(year), pid, 'regularisation', v)}
                          hint="Part non déductible des provisions déduites l’an dernier (décompte annuel du syndic)." />
                      )}
                      {p.tax_regime === 'micro_bic' && (
                        <Select label="Nature de la location" value={get(pid, year).meuble_kind ?? 'longue_duree'}
                          onChange={(v) => setInput(PARAMS, pid, 'meuble_kind', (v ?? 'longue_duree') as MeubleKind)} options={Object.entries(MEUBLE_KIND_LABELS) as [MeubleKind, string][]} />
                      )}
                      {lmnp && (
                        <NumberInput label={`Stock d’amortissements reportables au 1er janvier ${year}`} suffix="€" value={inputs[String(year)]?.[pid]?.deferred_opening ?? null}
                          onChange={(v) => setInput(String(year), pid, 'deferred_opening', v)}
                          hint={`Calculé : ${money2(lmnp.deferredBefore)}. Si l’année ${year - 1} a été déclarée ailleurs, indiquez le stock de fin d’année de la liasse déposée : il fait foi.`} />
                      )}
                      {reel && <>
                        {!p.acquisition_breakdown?.price && <>
                          <NumberInput label="Valeur amortissable" suffix="€" value={get(pid, year).depreciable_base ?? null} onChange={(v) => setInput(PARAMS, pid, 'depreciable_base', v)} hint="Par défaut : coût d’acquisition du bien" />
                          <NumberInput label="Part du terrain" suffix="%" value={prm.land_pct} onChange={(v) => setInput(PARAMS, pid, 'land_pct', v)} hint="Non amortissable" />
                          <NumberInput label="Durée du bâti" suffix="ans" value={prm.building_years} onChange={(v) => setInput(PARAMS, pid, 'building_years', v)} />
                        </>}
                        <NumberInput label="Durée des meubles" suffix="ans" value={prm.furniture_years} onChange={(v) => setInput(PARAMS, pid, 'furniture_years', v)} />
                        <NumberInput label="Durée des travaux amortissables" suffix="ans" value={prm.works_years} onChange={(v) => setInput(PARAMS, pid, 'works_years', v)} />
                      </>}
                    </div>
                    {reel && (p.acquisition_breakdown?.price ? (
                      <p className="muted small">Construction, frais de notaire et d’agence et mobilier d’après la décomposition du coût d’acquisition saisie dans Mes biens.{' '}
                        <button type="button" className="link" onClick={() => navigate(`/bien/${pid}/modifier`)}>Modifier la décomposition</button></p>
                    ) : (
                      <p className="muted small">Bâti amorti sur le coût d’acquisition global.{' '}
                        <button type="button" className="link" onClick={() => navigate(`/bien/${pid}/modifier`)}>Décomposer le coût d’acquisition (terrain, construction, notaire, agence) dans Mes biens</button></p>
                    ))}
                  </Section>
                );
              })}
              {fiscal.reelFoncier && (
                <Section title="Foyer">
                  <div className="grid tax-inputs"><NumberInput label="Case 4BD : déficits fonciers antérieurs non imputés" suffix="€" value={inputs[String(year)]?.[FOYER]?.prior_deficits ?? null}
                    onChange={(v) => setInput(String(year), FOYER, 'prior_deficits', v)} hint="Montant indiqué sur votre dernier avis d’imposition." /></div>
                </Section>
              )}
              {draft && <p><Button variant="primary" onClick={() => void saveInputs()}>Enregistrer les saisies</Button></p>}
            </>
          )}

          {tab === 'declarer' && (
            <Section title={`Où et comment déclarer sur impots.gouv.fr (${year + 1})`}
              actions={fiscal.reelBic ? <>
                <Button onClick={() => void exportLiasse()}>Liasse PDF</Button>
                {tdfcVisible() && <Button variant="primary" onClick={() => navigate('/declaration/teletransmission')}>Télétransmettre la liasse</Button>}
              </> : undefined}>
              <p className="muted small">Dans l’ordre : d’abord l’espace professionnel (liasse des locations meublées au réel ou des sociétés), puis l’espace particulier (déclaration de revenus). Les montants se saisissent en euros entiers. Les libellés des écrans peuvent varier d’une campagne à l’autre.</p>
              {fiscal.reelBic && !tdfcVisible() && <p className="note note-info">La liasse 2031 et 2033 doit être télétransmise (dépôt papier refusé), par un partenaire agréé (expert-comptable, service en ligne de déclaration LMNP) ou depuis votre espace professionnel. Immo-Zen prépare tous les montants et la liasse PDF à recopier.</p>}
              <div className="tax-guide">
                {guide.map((g, i) => (
                  <details key={g.id} className="tax-guide-step" open>
                    <summary><span className="tax-guide-num">{i + 1}</span> <span className={`pill ${g.space === 'professionnel' ? 'pill-warn' : 'pill-ok'}`}>Espace {g.space}</span> <strong>{g.title}</strong></summary>
                    <p className="muted small">{g.deadline}</p>
                    <ol>{g.steps.map((st) => <li key={st}>{st}</li>)}</ol>
                    {g.boxes.length > 0 && (
                      <div className="dt-scroll"><table className="dt-table compact tax-boxes">
                        <thead><tr><th>Formulaire</th><th>Case ou ligne</th><th>Libellé</th><th className="num">À saisir</th></tr></thead>
                        <tbody>{g.boxes.map((b, j) => <tr key={g.id + j}><td>{b.form}</td><td><strong>{b.code}</strong></td><td>{b.label}</td><td className="num">{b.amount === null ? '—' : <CopyAmount amount={b.amount} notify={notify} />}</td></tr>)}</tbody>
                      </table></div>
                    )}
                    {g.notes.map((n) => <p key={n} className="muted small">{n}</p>)}
                  </details>
                ))}
              </div>
              <h3>Autres obligations</h3>
              <ul className="muted small">
                {(fiscal.reelBic || fiscal.microBic) && <li>Location meublée : numéro SIRET (guichet unique de l’INPI, dans les 15 jours du début de la location) et cotisation foncière des entreprises (CFE : déclaration 1447-C la première année, paiement au 15 décembre).</li>}
                {fiscal.reelBic && <li>Revente d’un bien en LMNP au réel (depuis le 15/02/2025) : les amortissements déduits sont retranchés du prix d’acquisition pour calculer la plus-value.</li>}
                <li>Conservez les justificatifs (factures, relevés, tableau d’amortissement du crédit) pendant au moins 6 ans.</li>
              </ul>
            </Section>
          )}

          {tab === 'justificatifs' && (
            <>
              {fiscal.reelBic && (
                <Section title="Liasse LMNP (2031 et 2033)" actions={<Button onClick={() => void exportLiasse()}>Liasse PDF</Button>}>
                  <AssetsDetail liasse={fiscal.reelBic.liasse} properties={data.properties} year={year} />
                  <h3>Compte de résultat simplifié (2033-B)</h3>
                  <div className="dt-scroll"><table className="dt-table compact tax-2033">
                    <thead><tr><th>Ligne</th><th>Libellé</th><th className="num">Montant</th></tr></thead>
                    <tbody>{fiscal.reelBic.liasse.lines.map((l) => <tr key={l.code + l.label} className={['270', '310', '352', '354'].includes(l.code) ? 'subtotal' : ''}><td><strong>{l.code}</strong></td><td>{l.label}</td><td className="num">{money2(l.amount)}</td></tr>)}
                      {fiscal.reelBic.liasse.deferredUsed > 0 && <tr><td>—</td><td>Imputation des amortissements différés des exercices précédents</td><td className="num">{money2(fiscal.reelBic.liasse.deferredUsed)}</td></tr>}</tbody>
                  </table></div>
                  {bilanReview && (
                    <BilanReviewSection year={year} review={bilanReview} properties={reelProps} get={get} foyer={foyer}
                      setFoyer={(k, v) => setInput(String(year), FOYER, k, v)} setLoanBank={(pid, v) => setInput(String(year), pid, 'loan_remaining_bank', v)}
                      setCorrections={(list) => setInput(String(year), FOYER, 'bilan_corrections', list)} />
                  )}
                </Section>
              )}
              {fiscal.reelFoncier && (
                <Section title="Formulaire 2044 ligne par ligne">
                  <div className="dt-scroll"><table className="dt-table compact tax-2044">
                    <thead><tr><th>Ligne</th><th>Libellé</th>{fiscal.reelFoncier.perProperty.map((f) => <th key={f.propertyId} className="num">{title(f.propertyId)}</th>)}{fiscal.reelFoncier.perProperty.length > 1 && <th className="num">Total</th>}</tr></thead>
                    <tbody>{fiscal.reelFoncier.perProperty[0]!.lines.map((l, i) => {
                      const vals = fiscal.reelFoncier!.perProperty.map((f) => f.lines[i]!.amount);
                      return (
                        <tr key={l.code} className={['215', '240', '263'].includes(l.code) ? 'subtotal' : ''}>
                          <td><strong>{l.code}</strong></td><td>{l.label}</td>
                          {vals.map((v, j) => <td key={j} className={`num ${l.code === '263' ? (v >= 0 ? 'pos' : 'neg') : ''}`}>{money2(v)}</td>)}
                          {vals.length > 1 && <td className="num">{money2(vals.reduce((a, b) => a + b, 0))}</td>}
                        </tr>
                      );
                    })}</tbody>
                  </table></div>
                  <KeyRows rows={[['Ligne 420 : bénéfice ou déficit total', fiscal.reelFoncier.boxes.l420], ...fiscal.reelFoncier.boxes.detail.map(([c, v]) => [`Ligne ${c}`, v] as [string, number])]} />
                  {fiscal.reelFoncier.perProperty.some((f) => f.notDeductible.length > 0) && (
                    <details><summary>Dépenses non déductibles écartées</summary>
                      <ul>{fiscal.reelFoncier.perProperty.flatMap((f) => f.notDeductible.map((n) => <li key={f.propertyId + n.label}>{title(f.propertyId)} — {n.label} : {money2(n.amount)}</li>))}</ul>
                    </details>
                  )}
                </Section>
              )}
              <Section title={`Amortissements ${year}`}>
                {amort.length === 0 ? (
                  <p className="muted">Aucun élément amorti pour {year}. Les meubles, l’entretien amortissable et toute dépense dotée d’une durée d’amortissement (onglet Dépenses) apparaissent ici ; en LMNP au réel, le bâti s’y ajoute.</p>
                ) : (
                  <>
                    {amort.map(({ p, items, total }) => (
                      <div key={p.id} className="tax-amort">
                        <p className="label">{p.title} — {p.tax_regime ? TAX_REGIME_LABELS[p.tax_regime] : 'régime à choisir'} : dotation {year} <strong>{money2(total)}</strong></p>
                        <div className="dt-scroll"><table className="dt-table compact">
                          <thead><tr><th>Élément</th><th className="num">Base</th><th className="num">Durée</th><th>Depuis</th><th className="num">Dotation {year}</th><th className="num">Cumul fin {year}</th><th className="num">Reste à amortir</th></tr></thead>
                          <tbody>{items.map((i) => (
                            <tr key={i.label + i.start}><td>{i.label}</td><td className="num">{money2(i.base)}</td><td className="num">{String(i.years).replace('.', ',')} ans</td><td>{i.start.split('-').reverse().join('/')}</td>
                              <td className="num">{money2(i.amount)}</td><td className="num">{money2(i.cumulated)}</td><td className="num">{money2(i.remaining)}</td></tr>
                          ))}</tbody>
                        </table></div>
                        <p className="muted small">{p.tax_regime === 'reel_bic' ? 'Déduits du résultat LMNP dans la limite du résultat avant amortissement (excédent reporté).'
                          : p.tax_regime === 'is' ? 'À reporter dans la liasse de la société.'
                          : p.tax_regime === 'reel_foncier' ? 'Information : en location nue, rien ne s’amortit ; les travaux sont déduits l’année du paiement (ligne 224) et les meubles ne sont pas déductibles.'
                          : p.tax_regime === 'micro_foncier' || p.tax_regime === 'micro_bic' ? 'Information : au régime micro, l’abattement forfaitaire remplace toute déduction, amortissements compris.'
                          : 'Choisissez le régime fiscal du bien pour savoir si ces amortissements sont déductibles.'} <a href={href(`/depenses?bien=${p.id}`)}>Modifier les durées dans Dépenses</a>.</p>
                      </div>
                    ))}
                    <p><strong>Total des dotations {year} : {money2(amort.reduce((a, x) => a + x.total, 0))}</strong></p>
                  </>
                )}
              </Section>
            </>
          )}
        </>
      )}
    </>
  );
}

function KeyRows({ rows }: { rows: [string, number][] }) {
  return (
    <dl className="results tax-result">
      {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={v < 0 ? 'neg' : ''}>{money2(v)}</dd></div>)}
    </dl>
  );
}

function collectBoxes(f: FiscalSummary, title: (id: string) => string): Box[] {
  const out: Box[] = [];
  if (f.microFoncier) out.push({ form: '2042', code: '4BE', label: 'Micro-foncier : recettes brutes', amount: f.microFoncier.box4BE });
  if (f.reelFoncier) {
    const b = f.reelFoncier.boxes;
    if (b.box4BA) out.push({ form: '2042', code: '4BA', label: 'Revenus fonciers imposables', amount: b.box4BA });
    if (b.box4BB) out.push({ form: '2042', code: '4BB', label: 'Déficit imputable sur les revenus fonciers', amount: b.box4BB });
    if (b.box4BC) out.push({ form: '2042', code: '4BC', label: 'Déficit imputable sur le revenu global', amount: b.box4BC });
    if (!b.box4BA && !b.box4BB && !b.box4BC) out.push({ form: '2042', code: '4BA', label: 'Revenus fonciers imposables', amount: 0 });
    for (const p of f.reelFoncier.perProperty) for (const l of p.lines) out.push({ form: '2044', code: l.code, label: l.label, amount: l.amount, property: title(p.propertyId) });
    out.push({ form: '2044', code: '420', label: 'Résultat total', amount: b.l420 });
  }
  if (f.microBic) for (const l of f.microBic.lines) out.push({ form: '2042-C-PRO', code: l.box, label: `${l.label}, micro-BIC : recettes`, amount: l.amount });
  if (f.reelBic) {
    out.push({ form: '2042-C-PRO', code: f.reelBic.box5NY ? '5NY' : '5NA', label: f.reelBic.box5NY ? 'Meublé non professionnel au réel : déficit' : 'Meublé non professionnel au réel : bénéfice', amount: f.reelBic.box5NY || f.reelBic.box5NA });
    for (const l of f.reelBic.liasse.lines) out.push({ form: '2033-B', code: l.code, label: l.label, amount: l.amount });
    for (const r of f.reelBic.perProperty) {
      out.push({ form: 'LMNP', code: 'Recettes', label: 'Recettes', amount: r.receipts, property: title(r.propertyId) });
      out.push({ form: 'LMNP', code: 'Charges', label: 'Charges (hors intérêts)', amount: r.chargesTotal, property: title(r.propertyId) });
      out.push({ form: 'LMNP', code: 'Intérêts', label: 'Intérêts d’emprunt', amount: r.interest, property: title(r.propertyId) });
      out.push({ form: 'LMNP', code: 'Amortissements', label: 'Amortissements déduits', amount: r.depreciationDeducted, property: title(r.propertyId) });
      out.push({ form: 'LMNP', code: 'Reports', label: 'Amortissements reportés', amount: r.deferredAfter, property: title(r.propertyId) });
    }
  }
  return out;
}

