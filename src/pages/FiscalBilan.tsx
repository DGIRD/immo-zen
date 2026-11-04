import { useState } from 'react';
import type { BilanCorrection, Property, TaxPropertyInputs } from '../data/types.ts';
import { money2 } from '../domain/format.ts';
import { CORRECTABLE, ORIGIN_LABELS, activeCorrection, type BilanReview, type Origin, type ReviewLine } from '../domain/bilanReview.ts';
import { loanBalance } from '../domain/fiscal.ts';
import { Button, NumberInput, Select, TextInput } from '../ui/components.tsx';

const TONE: Record<Origin, 'neutral' | 'ok' | 'warn' | 'bad'> = {
  calcul: 'ok', liasse: 'ok', historique: 'ok', banque: 'ok', saisie: 'neutral', 'bilan_n-1': 'neutral', convention: 'neutral', correction: 'warn', total: 'neutral',
};

type FoyerKey = 'bilan_cash' | 'bilan_cash_previous' | 'bilan_opening_equity';

/** Relecture du bilan simplifié 2033-A : origine de chaque ligne, saisies, corrections motivées et conservées. */
export function BilanReviewSection({ year, review, properties, get, foyer, setFoyer, setLoanBank, setCorrections }: {
  year: number;
  review: BilanReview;
  properties: Property[];
  get: (pid: string, y: number) => TaxPropertyInputs;
  foyer: TaxPropertyInputs;
  setFoyer: (k: FoyerKey, v: number | null) => void;
  setLoanBank: (pid: string, v: number | null) => void;
  setCorrections: (list: BilanCorrection[]) => void;
}) {
  const { bilan, gapMessage, facts } = review;
  const [field, setField] = useState<BilanCorrection['field']>('receivables');
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const balanced = Math.abs(bilan.assetsNet - bilan.liabilities) < 0.01;
  const valid = amount !== null && Number.isFinite(amount) && amount >= 0 && reason.trim().length >= 3;

  function addCorrection() {
    setTried(true);
    if (!valid) return;
    const c: BilanCorrection = { id: crypto.randomUUID(), field, amount: amount!, reason: reason.trim(), at: new Date().toISOString(), revoked_at: null };
    setCorrections([...review.corrections, c]);
    setAmount(null); setReason(''); setTried(false);
  }
  const revoke = (id: string) => setCorrections(review.corrections.map((c) => (c.id === id ? { ...c, revoked_at: new Date().toISOString() } : c)));

  return (
    <section className="bilan-review" aria-label="Relecture du bilan 2033-A">
      <h3>Bilan simplifié au 31/12/{year} (2033-A)</h3>
      <p className="muted small">Établi à partir de vos biens, loyers, dépôts, dépenses et crédits, sans compte bancaire dédié par défaut. Chaque ligne indique son origine ; dépliez-la pour le détail.</p>
      <p className={`bilan-status bilan-${gapMessage.level}`} role={gapMessage.level === 'ok' ? 'status' : 'alert'}>
        <strong>{balanced ? `Actif = passif = ${money2(bilan.assetsNet)}` : `Bilan déséquilibré : actif ${money2(bilan.assetsNet)}, passif ${money2(bilan.liabilities)}`}</strong>
        {' — '}{gapMessage.text}
      </p>

      <div className="bilan-columns">
        <BilanTable title="Actif" lines={review.actif} />
        <BilanTable title="Passif" lines={review.passif} />
      </div>

      {facts.warnings.length > 0 && <ul className="bilan-warnings">{facts.warnings.map((w) => <li key={w} className="muted small">⚠ {w}</li>)}</ul>}

      <h4>Vos informations</h4>
      <div className="grid tax-inputs">
        {properties.filter((p) => (p.loan_amount ?? 0) > 0 || get(p.id, year).loan_remaining_bank != null).map((p) => {
          const lb = loanBalance(p, year, get(p.id, year));
          return (
            <NumberInput key={p.id} label={`Capital restant dû au 31/12/${year} selon la banque — ${p.title}`} suffix="€" value={get(p.id, year).loan_remaining_bank ?? null}
              onChange={(v) => setLoanBank(p.id, v)} hint={`Tableau d’amortissement de la banque. Calcul d’après le crédit du bien : ${money2(lb.computed)}.`} />
          );
        })}
        <NumberInput label={`Trésorerie d’un compte dédié au 31/12/${year}`} suffix="€" value={foyer.bilan_cash ?? null} onChange={(v) => setFoyer('bilan_cash', v)}
          hint="Laissez vide si loyers et dépenses passent par votre compte personnel (trésorerie 0)." />
        {foyer.bilan_opening_equity != null && (
          <NumberInput label={`Trésorerie du compte dédié au 31/12/${year - 1}`} suffix="€" value={foyer.bilan_cash_previous ?? null} onChange={(v) => setFoyer('bilan_cash_previous', v)} />
        )}
        <NumberInput label={`Capitaux propres au 31/12/${year - 1} (bilan déposé)`} suffix="€" value={foyer.bilan_opening_equity ?? null} onChange={(v) => setFoyer('bilan_opening_equity', v)}
          hint="Seulement si les années précédentes ont été déclarées sans Immo-Zen : capital individuel + résultat du bilan N-1." />
      </div>

      <h4>Corrections manuelles</h4>
      <p className="muted small">Pour remplacer un montant calculé, indiquez le montant retenu et le motif. Chaque correction reste dans l’historique, même annulée.</p>
      <div className="grid tax-inputs bilan-correction">
        <Select label="Ligne" value={field} onChange={(v) => setField((v ?? 'receivables') as BilanCorrection['field'])} options={Object.entries(CORRECTABLE) as [BilanCorrection['field'], string][]} />
        <NumberInput label="Montant retenu" suffix="€" value={amount} onChange={setAmount} error={tried && (amount === null || !(amount >= 0)) ? 'Montant positif ou nul requis' : undefined} />
        <TextInput label="Motif" value={reason} onChange={setReason} required error={tried && reason.trim().length < 3 ? 'Motif requis' : undefined} placeholder="Ex. : loyer réglé le 31/12 par virement" />
        <div className="field bilan-correction-action"><Button onClick={addCorrection}>Ajouter la correction</Button></div>
      </div>
      {review.corrections.length > 0 && (
        <div className="dt-scroll"><table className="dt-table compact bilan-history">
          <thead><tr><th>Date</th><th>Ligne</th><th className="num">Montant retenu</th><th>Motif</th><th>État</th><th /></tr></thead>
          <tbody>{[...review.corrections].sort((a, b) => b.at.localeCompare(a.at)).map((c) => {
            const active = activeCorrection(review.corrections, c.field)?.id === c.id;
            return (
              <tr key={c.id} className={c.revoked_at ? 'revoked' : ''}>
                <td>{c.at.slice(0, 10).split('-').reverse().join('/')}</td><td>{CORRECTABLE[c.field]}</td><td className="num">{money2(c.amount)}</td><td>{c.reason}</td>
                <td>{c.revoked_at ? `Annulée le ${c.revoked_at.slice(0, 10).split('-').reverse().join('/')}` : active ? 'En vigueur' : 'Remplacée'}</td>
                <td>{!c.revoked_at && <Button size="sm" variant="ghost" onClick={() => revoke(c.id)}>Annuler</Button>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      <p className="muted small">Pensez à enregistrer vos saisies. Choix comptables à valider avec un professionnel : trésorerie nulle sans compte dédié, résultat calculé sur les encaissements, frais d’acquisition inclus dans la valeur du bien.</p>
    </section>
  );
}

function BilanTable({ title, lines }: { title: string; lines: ReviewLine[] }) {
  return (
    <div className="bilan-side">
      <div className="dt-scroll"><table className="dt-table compact bilan-table">
        <caption>{title}</caption>
        <thead><tr><th>Code</th><th>Libellé</th><th className="num">Montant</th><th>Origine</th></tr></thead>
        <tbody>{lines.map((l) => (
          <tr key={l.code + l.label} className={l.origin === 'total' ? 'subtotal' : ''}>
            <td><strong>{l.code}</strong></td>
            <td>
              {l.detail && l.detail.length > 0 ? (
                <details><summary>{l.label}</summary>
                  <ul className="bilan-detail">{l.detail.map((x, i) => <li key={i}><span>{x.label}</span> <span className="num">{money2(x.amount)}</span></li>)}</ul>
                </details>
              ) : l.label}
              {l.origin !== 'total' && <span className={`pill pill-${TONE[l.origin]} bilan-origin-inline`}>{l.code} · {ORIGIN_LABELS[l.origin]}</span>}
              {l.note && <div className="muted small">{l.note}</div>}
              {l.computed !== undefined && <div className="muted small">Calculé : {money2(l.computed)}</div>}
            </td>
            <td className="num">{money2(l.amount)}</td>
            <td>{l.origin !== 'total' && <span className={`pill pill-${TONE[l.origin]}`}>{ORIGIN_LABELS[l.origin]}</span>}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}
