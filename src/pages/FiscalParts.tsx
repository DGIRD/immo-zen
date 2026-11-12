import type { ReactNode } from 'react';
import type { Property } from '../data/types.ts';
import { LOAN_SOURCE_LABELS, type FiscalSummary } from '../domain/fiscal.ts';
import { money2 } from '../domain/format.ts';
import { liasseDeadline, type GuideStep } from '../domain/taxGuide.ts';
import { NumberInput } from '../ui/components.tsx';
import { recapFromFoncier, recapFromReelBic } from './FiscalRecap.tsx';

/**
 * Éléments de la page Déclaration : carte « Ce que vous devez faire », points à vérifier avec leur correction,
 * comparaison avec l'année précédente et avec la déclaration déposée, lexique.
 */

export type TabKey = 'verifier' | 'chiffres' | 'saisies' | 'declarer' | 'justificatifs';
const euros = (n: number) => `${Math.round(Math.abs(n)).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} €`;
const frDate = (iso: string) => iso.split('-').reverse().join('/');

/** Montant arrondi à l'euro, tel qu'il se saisit sur impots.gouv.fr, avec bouton de copie. */
export function CopyAmount({ amount, notify }: { amount: number; notify: (m: string) => void }) {
  const v = String(Math.round(Math.abs(amount)));
  return (
    <span className="copy-amount">
      <strong>{euros(amount)}</strong>
      <button type="button" className="link small" aria-label={`Copier ${v}`} onClick={() => {
        navigator.clipboard?.writeText(v).then(() => notify(`${v} copié.`), () => notify(`Copie impossible : saisissez ${v}.`));
      }}>Copier</button>
    </span>
  );
}

// ---------------------------------------------------------------- points à vérifier

export interface Check { level: 'corriger' | 'conseil'; property?: string; text: string; action?: { label: string; go: () => void } }

export function collectChecks(f: FiscalSummary, properties: Property[], go: { property: (id: string) => void; expenses: (id: string) => void; tab: (t: TabKey) => void }): Check[] {
  const out: Check[] = [];
  const title = (id: string) => properties.find((p) => p.id === id)?.title ?? 'Bien';
  for (const w of f.warnings) out.push({ level: 'corriger', text: w });
  for (const p of properties.filter((x) => x.status === 'acquis' && !x.tax_regime && f.amounts.has(x.id))) {
    out.push({ level: 'corriger', property: p.title, text: 'Régime fiscal à choisir : sans lui, le bien n’est dans aucune déclaration.' });
  }
  for (const [pid, a] of f.amounts) {
    for (const w of a.warnings) out.push({ level: 'corriger', property: title(pid), text: w, action: { label: 'Voir les dépenses', go: () => go.expenses(pid) } });
    if (a.interestSource === 'credit' && a.interest > 0) {
      out.push({ level: 'conseil', property: title(pid), text: `Intérêts de ${money2(a.interest)} estimés d’après l’échéancier théorique du crédit : ils peuvent différer des intérêts réels (intérêts intercalaires, assurance comprise dans l’échéance).`,
        action: { label: 'Importer le tableau d’amortissement', go: () => go.property(pid) } });
    }
  }
  if (f.reelBic) {
    for (const r of f.reelBic.perProperty) {
      for (const w of r.warnings) out.push({ level: 'corriger', property: title(r.propertyId), text: w });
      const p = properties.find((x) => x.id === r.propertyId);
      if (p && !p.acquisition_breakdown?.price) {
        out.push({ level: 'conseil', property: p.title, text: 'Coût d’acquisition non décomposé : terrain, construction, frais de notaire et d’agence sont amortis ensemble sur la durée du bâti.',
          action: { label: 'Décomposer dans Mes biens', go: () => go.property(p.id) } });
      }
    }
  }
  if (f.microFoncier) for (const w of f.microFoncier.warnings) out.push({ level: 'corriger', text: w });
  if (f.microBic) for (const w of f.microBic.warnings) out.push({ level: 'corriger', text: w });
  const seen = new Set<string>();
  return out.filter((c) => { const k = `${c.property}|${c.text}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (a.level === b.level ? 0 : a.level === 'corriger' ? -1 : 1));
}

export function ChecksList({ checks }: { checks: Check[] }) {
  if (!checks.length) return <p className="note note-info" role="status">Aucun point bloquant : les montants peuvent être reportés. Relisez tout de même le récapitulatif dans « Mes chiffres ».</p>;
  return (
    <ul className="tax-checks">
      {checks.map((c, i) => (
        <li key={i} className={`tax-check tax-check-${c.level}`}>
          <span className={`pill ${c.level === 'corriger' ? 'pill-warn' : 'pill-info'}`}>{c.level === 'corriger' ? 'À corriger' : 'Conseil'}</span>
          <span>{c.property && <strong>{c.property} : </strong>}{c.text}</span>
          {c.action && <button type="button" className="link" onClick={c.action.go}>{c.action.label}</button>}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- ce que vous devez faire

export function TodoCard({ year, guide, checks, unsaved, notify, onTab }: {
  year: number; guide: GuideStep[]; checks: Check[]; unsaved: boolean; notify: (m: string) => void; onTab: (t: TabKey) => void;
}) {
  if (!guide.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  const liasse = liasseDeadline(year + 1);
  const past = today > `${year + 1}-06-15`;
  const toFix = checks.filter((c) => c.level === 'corriger').length;
  return (
    <section className="tax-todo" aria-labelledby="tax-todo-title">
      <h2 id="tax-todo-title">Ce que vous devez faire en {year + 1} <span className="muted small">(revenus {year})</span></h2>
      {past && <p className="muted small">Échéances de {year + 1} passées : si la déclaration est déposée, comparez-la au calcul dans <button type="button" className="link" onClick={() => onTab('chiffres')}>Mes chiffres</button>.</p>}
      <ol className="tax-todo-steps">
        {toFix > 0 && <li><strong>Corriger {toFix} point{toFix > 1 ? 's' : ''}</strong> avant de déclarer. <button type="button" className="link" onClick={() => onTab('verifier')}>Voir</button></li>}
        {unsaved && <li><strong>Enregistrer vos saisies</strong> (bouton en haut de page).</li>}
        {guide.map((g) => {
          const main = g.boxes.filter((b) => b.form.startsWith('2042') && b.amount !== null);
          const result = g.boxes.find((b) => b.form === '2031');
          return (
            <li key={g.id}>
              <span className={`pill ${g.space === 'professionnel' ? 'pill-warn' : 'pill-ok'}`}>Espace {g.space}</span>{' '}
              <strong>{g.title}</strong>
              <span className="muted small"> — {g.space === 'professionnel' ? `avant le ${frDate(liasse)} (télétransmission)` : 'fin mai à début juin, selon votre département'}</span>
              {main.length > 0 && <ul className="tax-todo-boxes">{main.map((b) => <li key={b.code}>Case <strong>{b.code}</strong> ({b.label}) : <CopyAmount amount={b.amount!} notify={notify} /></li>)}</ul>}
              {result && <ul className="tax-todo-boxes"><li>{result.label} : <strong>{result.code.toLowerCase()}</strong> de {money2(result.amount ?? 0)}</li></ul>}
            </li>
          );
        })}
      </ol>
      <button type="button" className="link" onClick={() => onTab('declarer')}>Marche à suivre détaillée, case par case</button>
    </section>
  );
}

// ---------------------------------------------------------------- comparaisons

export interface Totals { receipts: number; charges: number; interest: number; depreciation: number; result: number; deferredEnd: number | null }

export function totalsOf(f: FiscalSummary | null): Totals | null {
  if (!f) return null;
  const rows = [...(f.reelBic ? recapFromReelBic(f.reelBic.perProperty) : []), ...(f.reelFoncier ? recapFromFoncier(f.reelFoncier.perProperty) : [])];
  const microReceipts = (f.microFoncier?.box4BE ?? 0) + (f.microBic?.lines.reduce((a, l) => a + l.amount, 0) ?? 0);
  const microTaxable = (f.microFoncier?.taxable ?? 0) + (f.microBic?.lines.reduce((a, l) => a + l.taxable, 0) ?? 0);
  if (!rows.length && !microReceipts) return null;
  const s = (k: 'receipts' | 'charges' | 'interest' | 'depreciation' | 'result') => Math.round(rows.reduce((a, r) => a + r[k], 0) * 100) / 100;
  return { receipts: s('receipts') + microReceipts, charges: s('charges'), interest: s('interest'), depreciation: s('depreciation'), result: s('result') + microTaxable, deferredEnd: f.reelBic ? f.reelBic.liasse.deferredAfter : null };
}

const LINES: [keyof Totals, string][] = [
  ['receipts', 'Recettes'], ['charges', 'Charges'], ['interest', 'Intérêts et frais d’emprunt'], ['depreciation', 'Amortissement de l’année'], ['result', 'Résultat comptable'], ['deferredEnd', 'Stock d’amortissements reportables au 31/12'],
];

export function YearCompare({ year, cur, prev }: { year: number; cur: Totals; prev: Totals | null }) {
  const lines = LINES.filter(([k]) => (k !== 'depreciation' || cur.depreciation || prev?.depreciation) && (k !== 'deferredEnd' || cur.deferredEnd !== null));
  return (
    <div className="tax-recap">
      <h3>Évolution par rapport à {year - 1}</h3>
      <div className="dt-scroll"><table className="dt-table compact tax-recap-table">
        <thead><tr><th>Poste</th><th className="num">{year - 1}</th><th className="num">{year}</th><th className="num">Écart</th></tr></thead>
        <tbody>{lines.map(([k, l]) => {
          const a = prev?.[k] ?? null, b = cur[k] ?? 0;
          return <tr key={k}><td>{l}</td><td className="num">{a === null ? '—' : money2(a)}</td><td className="num">{money2(b)}</td><td className="num">{a === null ? '—' : money2(Math.round((b - a) * 100) / 100)}</td></tr>;
        })}</tbody>
      </table></div>
    </div>
  );
}

type FiledKey = 'filed_receipts' | 'filed_charges' | 'filed_interest' | 'filed_depreciation' | 'filed_result' | 'filed_deferred_end';
const FILED: [keyof Totals, FiledKey][] = [['receipts', 'filed_receipts'], ['charges', 'filed_charges'], ['interest', 'filed_interest'], ['depreciation', 'filed_depreciation'], ['result', 'filed_result'], ['deferredEnd', 'filed_deferred_end']];

/** Comparaison avec la déclaration réellement déposée (saisie depuis la liasse ou l'avis). */
export function FiledCompare({ year, cur, filed, setFiled }: { year: number; cur: Totals; filed: Partial<Record<FiledKey, number | null>>; setFiled: (k: FiledKey, v: number | null) => void }) {
  const rows = FILED.filter(([k]) => (k !== 'depreciation' || cur.depreciation) && (k !== 'deferredEnd' || cur.deferredEnd !== null));
  const any = rows.some(([, fk]) => filed[fk] != null);
  return (
    <details className="tax-recap tax-filed" open={any}>
      <summary><strong>Comparer avec la déclaration déposée</strong> <span className="muted small">— liasse ou déclaration faite ailleurs (expert-comptable, decla.fr…)</span></summary>
      <p className="muted small">Saisissez les montants de votre déclaration {year} déposée : l’écart avec le calcul s’affiche ligne par ligne. Charges sans les intérêts ; intérêts avec l’assurance et les frais d’emprunt ; résultat avant imputation des amortissements reportés.</p>
      <div className="dt-scroll"><table className="dt-table compact tax-recap-table">
        <thead><tr><th>Poste</th><th className="num">Calcul Immo-Zen</th><th className="num">Déclaré</th><th className="num">Écart</th></tr></thead>
        <tbody>{rows.map(([k, fk]) => {
          const c = cur[k] ?? 0, d = filed[fk];
          const gap = d == null ? null : Math.round((c - d) * 100) / 100;
          const l = LINES.find(([x]) => x === k)![1];
          return (
            <tr key={k}><td>{l}</td><td className="num">{money2(c)}</td>
              <td className="num"><NumberInput label={`${l} déclaré`} suffix="€" value={d ?? null} onChange={(v) => setFiled(fk, v == null || Number.isNaN(v) ? null : v)} /></td>
              <td className={`num ${gap !== null && Math.abs(gap) > 1 ? 'neg' : ''}`}>{gap === null ? '—' : Math.abs(gap) <= 1 ? 'identique' : money2(gap)}</td></tr>
          );
        })}</tbody>
      </table></div>
    </details>
  );
}

// ---------------------------------------------------------------- lexique

const TERMS: [string, ReactNode][] = [
  ['Recettes', 'Loyers hors charges et charges récupérées encaissés dans l’année (date d’encaissement).'],
  ['Charges', 'Dépenses déductibles payées dans l’année : copropriété, taxe foncière, assurances, entretien, gestion, frais bancaires et de comptabilité…'],
  ['Intérêts d’emprunt', <>Intérêts du crédit échus dans l’année, avec l’assurance emprunteur et les frais de dossier et de garantie (charges financières, ligne 294 en LMNP). Source : {Object.values(LOAN_SOURCE_LABELS).slice(1, 4).join(', ')}.</>],
  ['Amortissement (dotation)', 'Part annuelle du prix du logement (hors terrain), des frais d’acquisition, des meubles et des travaux, déduite en location meublée au réel.'],
  ['Résultat comptable', 'Recettes − charges − intérêts − amortissement de l’année.'],
  ['Stock d’amortissements reportables (art. 39 C)', 'L’amortissement ne peut ni créer ni augmenter un déficit : la part non déduite est mise de côté, sans limite de durée, et se déduit des bénéfices des années suivantes.'],
  ['Déficit (case 5NY)', 'Charges et intérêts supérieurs aux recettes : imputable sur les seuls revenus de location meublée des dix années suivantes.'],
  ['Liasse 2031 et 2033', 'Déclaration de résultat des locations meublées au réel, télétransmise depuis l’espace professionnel : 2033-A bilan, 2033-B compte de résultat, 2033-C immobilisations et amortissements, 2033-D déficits et reports.'],
  ['2042-C-PRO', 'Annexe de la déclaration de revenus où l’on reporte le résultat des locations meublées (5NA, 5NY ; micro-BIC 5ND…).'],
  ['2044', 'Annexe des revenus fonciers au réel (location nue) ; le résultat se reporte en 4BA, 4BB ou 4BC.'],
  ['Régime micro', 'Abattement forfaitaire sur les recettes (30 % en micro-foncier, 50 % en meublé longue durée) qui remplace toute déduction de charges.'],
];

export function Lexique() {
  return (
    <details className="tax-lexique">
      <summary><strong>Lexique</strong> <span className="muted small">— les mots de la déclaration</span></summary>
      <dl>{TERMS.map(([t, d]) => <div key={t}><dt>{t}</dt><dd>{d}</dd></div>)}</dl>
    </details>
  );
}
