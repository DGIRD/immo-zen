import { useMemo, useState } from 'react';
import { useStore } from '../data/store.tsx';
import type { MeubleKind, TaxInputs, TaxPropertyInputs, TaxRegime } from '../data/types.ts';
import { downloadBlob, stamp, toXlsx } from '../domain/exporting.ts';
import { money2, todayParis } from '../domain/format.ts';
import { DEFAULT_TAX_INPUTS, depreciationItems, FONCIER_DEFICIT_LIMIT, fiscalSummary, MEUBLE_KIND_LABELS, MICRO_BIC_LIMIT, MICRO_FONCIER_LIMIT, type FiscalSummary } from '../domain/fiscal.ts';
import { declarationGuide, guideSections } from '../domain/taxGuide.ts';
import { buildDocPdf } from '../domain/docPdf.ts';
import { TAX_REGIME_LABELS } from '../domain/labels.ts';
import { Button, EmptyState, NumberInput, PageHeader, Section, Select } from '../ui/components.tsx';
import { href } from '../ui/router.ts';

interface Box { form: string; code: string; label: string; amount: number; property?: string }

const PARAMS = 'params';
const FOYER = 'foyer';
type NumKey = Exclude<keyof TaxPropertyInputs, 'meuble_kind'>;

export function FiscalPage() {
  const { data, update, saveSettings, notify } = useStore();
  const thisYear = Number(todayParis().slice(0, 4));
  const years = useMemo(() => {
    const ys = new Set<number>([thisYear - 1, thisYear]);
    for (const e of data.expenses) ys.add(Number((e.paid_on ?? e.expense_date).slice(0, 4)));
    for (const p of data.payments) ys.add(Number(p.paid_on.slice(0, 4)));
    return [...ys].filter((y) => y > 1990).sort((a, b) => b - a);
  }, [data.expenses, data.payments, thisYear]);
  const [year, setYear] = useState(thisYear - 1);
  const saved = (data.settings?.tax_inputs ?? {}) as TaxInputs;
  const [draft, setDraft] = useState<TaxInputs | null>(null);
  const inputs = draft ?? saved;
  const get = (pid: string, y: number): TaxPropertyInputs => ({ ...(inputs[PARAMS]?.[pid] ?? {}), ...(inputs[String(y)]?.[pid] ?? {}) });
  const setInput = (scope: string, pid: string, k: NumKey | 'meuble_kind', v: number | MeubleKind | null) => setDraft((d) => {
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

  return (
    <>
      <PageHeader title="Déclaration fiscale" subtitle={`Montants à reporter pour les revenus ${year}, déclarés en ${year + 1}, selon le régime de chaque bien.`}
        actions={<>
          <label className="inline-select">Revenus de
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Année des revenus">{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
          </label>
          <Button onClick={() => void exportPdf()} disabled={!guide.length}>Dossier PDF</Button>
          <Button onClick={() => void exportXlsx()} disabled={!boxes.length}>Excel (.xlsx)</Button>
        </>} />
      <p className="note">Aide au remplissage calculée à partir de vos loyers encaissés et dépenses payées en {year} (Loyers et paiements, Dépenses, relevés importés). Elle ne vaut ni attestation ni conseil fiscal : vérifiez chaque montant avec les notices officielles (2044, 2042, 2042-C-PRO) ou un professionnel.</p>
      {draft && <p className="unsaved" role="status">Saisies non enregistrées. <Button size="sm" variant="primary" onClick={() => void saveInputs()}>Enregistrer les saisies</Button></p>}
      {fiscal.warnings.map((w) => <p key={w} className="form-error" role="alert">{w}</p>)}

      {owned.length === 0 ? <EmptyState title="Aucun bien détenu">Ajoutez vos logements dans <a href={href('/biens')}>Mes biens</a> et indiquez leur régime fiscal.</EmptyState> : (
        <>
          <Section title="Régime de chaque bien">
            <div className="dt-scroll"><table className="dt-table compact">
              <thead><tr><th>Bien</th><th>Régime fiscal</th><th className="num">Loyers HC {year}</th><th className="num">Charges encaissées</th><th className="num">Dépenses payées</th></tr></thead>
              <tbody>{[...fiscal.amounts.entries()].map(([pid, a]) => {
                const p = data.properties.find((x) => x.id === pid)!;
                const spent = Object.entries(a.byCategory).filter(([k]) => k !== 'credit').reduce((s, [, v]) => s + (v ?? 0), 0);
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
            <p className="muted small">Location nue : micro-foncier (recettes ≤ {MICRO_FONCIER_LIMIT.toLocaleString('fr-FR')} €) ou réel (2044). Location meublée : micro-BIC (≤ {MICRO_BIC_LIMIT.toLocaleString('fr-FR')} €) ou réel. Le régime se modifie aussi dans la fiche du bien.</p>
          </Section>

          {guide.length > 0 && (
            <Section title={`Où déclarer sur impots.gouv.fr (${year + 1})`}>
              <p className="muted small">Chaque régime a son parcours : votre espace particulier pour la déclaration de revenus (2042, 2044, 2042-C-PRO), votre espace professionnel pour la liasse des locations meublées au réel ou des sociétés. Les libellés des écrans peuvent varier d’une campagne à l’autre.</p>
              <div className="tax-guide">
                {guide.map((g) => (
                  <details key={g.id} className="tax-guide-step" open={guide.length <= 2}>
                    <summary><span className={`pill ${g.space === 'professionnel' ? 'pill-warn' : 'pill-ok'}`}>Espace {g.space}</span> <strong>{g.title}</strong></summary>
                    <p className="muted small">{g.deadline}</p>
                    <ol>{g.steps.map((st) => <li key={st}>{st}</li>)}</ol>
                    {g.boxes.length > 0 && (
                      <div className="dt-scroll"><table className="dt-table compact tax-boxes">
                        <thead><tr><th>Formulaire</th><th>Case ou ligne</th><th>Libellé</th><th className="num">Montant</th></tr></thead>
                        <tbody>{g.boxes.map((b, i) => <tr key={g.id + i}><td>{b.form}</td><td><strong>{b.code}</strong></td><td>{b.label}</td><td className="num"><strong>{b.amount === null ? '—' : money2(b.amount)}</strong></td></tr>)}</tbody>
                      </table></div>
                    )}
                    {g.notes.map((n) => <p key={n} className="muted small">{n}</p>)}
                  </details>
                ))}
              </div>
            </Section>
          )}

          {boxes.some((b) => b.form.startsWith('2042') && !b.property) && (
            <Section title={`À reporter en ${year + 1}`}>
              <table className="dt-table compact tax-boxes">
                <thead><tr><th>Déclaration</th><th>Case</th><th>Libellé</th><th className="num">Montant</th></tr></thead>
                <tbody>{boxes.filter((b) => b.form.startsWith('2042') && !b.property).map((b) => (
                  <tr key={b.form + b.code}><td>{b.form}</td><td><strong>{b.code}</strong></td><td>{b.label}</td><td className="num"><strong>{money2(b.amount)}</strong></td></tr>
                ))}</tbody>
              </table>
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
                    <p className="muted small">{p.tax_regime === 'reel_bic' ? 'Déduits du résultat LMNP ci-dessous, dans la limite du résultat avant amortissements (excédent reporté).'
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

          {fiscal.microFoncier && (
            <Section title="Micro-foncier — déclaration 2042">
              <p>Case <strong>4BE</strong> : <strong>{money2(fiscal.microFoncier.box4BE)}</strong> de loyers bruts hors charges. L’administration applique l’abattement de 30 % (revenu imposable estimé {money2(fiscal.microFoncier.taxable)}). Pas de formulaire 2044.</p>
              {fiscal.microFoncier.warnings.map((w) => <p key={w} className="form-error">{w}</p>)}
            </Section>
          )}

          {fiscal.reelFoncier && (
            <Section title="Revenus fonciers au réel — formulaire 2044">
              <div className="dt-scroll"><table className="dt-table compact tax-2044">
                <thead><tr><th>Ligne</th><th>Libellé</th>{fiscal.reelFoncier.perProperty.map((f) => <th key={f.propertyId} className="num">{title(f.propertyId)}</th>)}{fiscal.reelFoncier.perProperty.length > 1 && <th className="num">Total</th>}</tr></thead>
                <tbody>{fiscal.reelFoncier.perProperty[0]!.lines.map((l, i) => {
                  const vals = fiscal.reelFoncier!.perProperty.map((f) => f.lines[i]!.amount);
                  const strong = ['215', '240', '263'].includes(l.code);
                  return (
                    <tr key={l.code} className={strong ? 'subtotal' : ''}>
                      <td><strong>{l.code}</strong></td><td>{l.label}</td>
                      {vals.map((v, j) => <td key={j} className={`num ${l.code === '263' ? (v >= 0 ? 'pos' : 'neg') : ''}`}>{money2(v)}</td>)}
                      {vals.length > 1 && <td className="num">{money2(vals.reduce((a, b) => a + b, 0))}</td>}
                    </tr>
                  );
                })}</tbody>
              </table></div>
              <div className="grid tax-inputs">
                {fiscal.reelFoncier.perProperty.map((f) => (
                  <div key={f.propertyId} className="tax-input-group">
                    <p className="label">{title(f.propertyId)}</p>
                    <NumberInput label="Ligne 230 : régularisation N−1" suffix="€" value={get(f.propertyId, year).regularisation ?? null} onChange={(v) => setInput(String(year), f.propertyId, 'regularisation', v)}
                      hint="Part non déductible des provisions déduites l’an dernier (décompte annuel du syndic : charges récupérables…)." />
                    <NumberInput label="Ligne 213 : recettes diverses" suffix="€" value={get(f.propertyId, year).other_income ?? null} onChange={(v) => setInput(String(year), f.propertyId, 'other_income', v)} hint="Indemnités d’assurance, subventions…" />
                  </div>
                ))}
              </div>
              <h3>Résultat et report sur la 2042</h3>
              <KeyRows rows={[
                ['Ligne 420 : bénéfice ou déficit total', fiscal.reelFoncier.boxes.l420],
                ...fiscal.reelFoncier.boxes.detail.map(([c, v]) => [`Ligne ${c}`, v] as [string, number]),
                ['Case 4BA : revenu foncier imposable', fiscal.reelFoncier.boxes.box4BA],
                ['Case 4BB : déficit imputable sur les revenus fonciers', fiscal.reelFoncier.boxes.box4BB],
                ['Case 4BC : déficit imputable sur le revenu global', fiscal.reelFoncier.boxes.box4BC],
              ]} />
              <p className="muted small">Déficit imputable sur le revenu global plafonné à {FONCIER_DEFICIT_LIMIT.toLocaleString('fr-FR')} € (hors travaux de rénovation énergétique, non distingués ici) ; la part due aux intérêts d’emprunt ne s’impute que sur les revenus fonciers. Rubrique 410 (intérêts) : reprendre le montant de la ligne 250.</p>
              <div className="grid tax-inputs"><NumberInput label="Case 4BD : déficits fonciers antérieurs non imputés" suffix="€" value={inputs[String(year)]?.[FOYER]?.prior_deficits ?? null}
                onChange={(v) => setInput(String(year), FOYER, 'prior_deficits', v)} hint="Montant indiqué sur votre dernier avis d’imposition." /></div>
              {fiscal.reelFoncier.perProperty.some((f) => f.notDeductible.length > 0) && (
                <details><summary>Dépenses non déductibles écartées</summary>
                  <ul>{fiscal.reelFoncier.perProperty.flatMap((f) => f.notDeductible.map((n) => <li key={f.propertyId + n.label}>{title(f.propertyId)} — {n.label} : {money2(n.amount)}</li>))}</ul>
                </details>
              )}
            </Section>
          )}

          {fiscal.microBic && (
            <Section title="Location meublée au micro-BIC — déclaration 2042-C-PRO">
              {fiscal.microBic.lines.map((l) => (
                <p key={l.box}>Case <strong>{l.box}</strong> ({l.label}) : <strong>{money2(l.amount)}</strong> de recettes charges comprises. Abattement de {Math.round(l.rate * 100)} % appliqué par l’administration (revenu imposable estimé {money2(l.taxable)}).</p>
              ))}
              <div className="grid tax-inputs">
                {fiscal.byRegime.micro_bic.map((p) => (
                  <Select key={p.id} label={`Nature de la location : ${p.title}`} value={get(p.id, year).meuble_kind ?? 'longue_duree'}
                    onChange={(v) => setInput(PARAMS, p.id, 'meuble_kind', (v ?? 'longue_duree') as MeubleKind)} options={Object.entries(MEUBLE_KIND_LABELS) as [MeubleKind, string][]} />
                ))}
              </div>
              {fiscal.microBic.warnings.map((w) => <p key={w} className="form-error">{w}</p>)}
            </Section>
          )}

          {fiscal.reelBic && (
            <Section title="Location meublée au réel (LMNP) — 2031, 2033 et 2042-C-PRO">
              <KeyRows rows={[['Case 5NA : bénéfice', fiscal.reelBic.box5NA], ['Case 5NY : déficit', fiscal.reelBic.box5NY]]} />
              <h3>Compte de résultat simplifié (2033-B)</h3>
              <div className="dt-scroll"><table className="dt-table compact tax-2033">
                <thead><tr><th>Ligne</th><th>Libellé</th><th className="num">Montant</th></tr></thead>
                <tbody>{fiscal.reelBic.liasse.lines.map((l) => <tr key={l.code + l.label} className={['270', '310', '352', '354'].includes(l.code) ? 'subtotal' : ''}><td><strong>{l.code}</strong></td><td>{l.label}</td><td className="num">{money2(l.amount)}</td></tr>)}
                  {fiscal.reelBic.liasse.deferredUsed > 0 && <tr><td>—</td><td>Imputation des amortissements différés des exercices précédents</td><td className="num">{money2(fiscal.reelBic.liasse.deferredUsed)}</td></tr>}</tbody>
              </table></div>
              {fiscal.reelBic.perProperty.map((r) => {
                const prm = { ...DEFAULT_TAX_INPUTS, ...get(r.propertyId, year) };
                return (
                  <details key={r.propertyId} className="tax-lmnp" open={fiscal.reelBic!.perProperty.length === 1}>
                    <summary><strong>{title(r.propertyId)}</strong> — résultat {money2(r.box5NA - r.box5NY)}</summary>
                    <KeyRows rows={[
                      ['Recettes (loyers et charges encaissés)', r.receipts],
                      ...r.charges.map((c) => [c.label, -c.amount] as [string, number]),
                      ['Intérêts d’emprunt', -r.interest],
                      ['Résultat avant amortissements', r.resultBeforeDepreciation],
                      ['Amortissements de l’année', r.depreciationYear],
                      ['Amortissements reportés des années précédentes', r.deferredBefore],
                      ['Amortissements déduits', -r.depreciationDeducted],
                      ['Amortissements reportés à nouveau', r.deferredAfter],
                    ]} />
                    {r.depreciation.length > 0 && (
                      <table className="dt-table compact"><thead><tr><th>Élément amorti</th><th className="num">Base</th><th className="num">Durée</th><th>Depuis</th><th className="num">{year}</th></tr></thead>
                        <tbody>{r.depreciation.map((d) => <tr key={d.label + d.start}><td>{d.label}</td><td className="num">{money2(d.base)}</td><td className="num">{d.years} ans</td><td>{d.start.split('-').reverse().join('/')}</td><td className="num">{money2(d.amount)}</td></tr>)}</tbody></table>
                    )}
                    <div className="grid tax-inputs">
                      <NumberInput label="Valeur amortissable" suffix="€" value={get(r.propertyId, year).depreciable_base ?? null} onChange={(v) => setInput(PARAMS, r.propertyId, 'depreciable_base', v)} hint="Par défaut : coût d’acquisition du bien" />
                      <NumberInput label="Part du terrain" suffix="%" value={prm.land_pct} onChange={(v) => setInput(PARAMS, r.propertyId, 'land_pct', v)} hint="Non amortissable" />
                      <NumberInput label="Durée du bâti" suffix="ans" value={prm.building_years} onChange={(v) => setInput(PARAMS, r.propertyId, 'building_years', v)} />
                      <NumberInput label="Durée des meubles" suffix="ans" value={prm.furniture_years} onChange={(v) => setInput(PARAMS, r.propertyId, 'furniture_years', v)} />
                      <NumberInput label="Durée des travaux amortissables" suffix="ans" value={prm.works_years} onChange={(v) => setInput(PARAMS, r.propertyId, 'works_years', v)} />
                      <NumberInput label={`Recettes diverses ${year}`} suffix="€" value={get(r.propertyId, year).other_income ?? null} onChange={(v) => setInput(String(year), r.propertyId, 'other_income', v)} />
                    </div>
                    {r.warnings.map((w) => <p key={w} className="muted small">⚠ {w}</p>)}
                  </details>
                );
              })}
              <p className="muted small">Amortissement linéaire au prorata du temps ; il ne peut ni créer ni augmenter un déficit (article 39 C du CGI) : l’excédent est reporté sans limite de durée. Les frais d’acquisition sont supposés inclus dans la valeur amortissable. La liasse 2031 et 2033 doit être déposée en ligne (professionnel ou service agréé) ; ces montants servent à la préparer.</p>
            </Section>
          )}

          {fiscal.other.length > 0 && (
            <Section title="Autres régimes">
              <p className="muted">{fiscal.other.map((p) => p.title).join(', ')} : régime « {fiscal.other.map((p) => TAX_REGIME_LABELS[p.tax_regime!]).join(', ')} ». Société à l’impôt sur les sociétés : la liasse est établie au nom de la société ; les recettes et dépenses de l’année restent disponibles dans Dépenses et Loyers.</p>
            </Section>
          )}

          {[...fiscal.amounts.entries()].some(([, a]) => a.warnings.length > 0) && (
            <Section title="Points à vérifier">
              <ul>{[...fiscal.amounts.entries()].flatMap(([pid, a]) => a.warnings.map((w) => <li key={pid + w}><strong>{title(pid)}</strong> : {w}</li>))}</ul>
            </Section>
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

