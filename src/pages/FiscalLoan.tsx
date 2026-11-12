import { LOAN_SOURCE_LABELS, type YearAmounts } from '../domain/fiscal.ts';
import { money2 } from '../domain/format.ts';
import { NumberInput } from '../ui/components.tsx';

/**
 * Intérêts d'emprunt et assurance emprunteur de l'année : pré-remplis d'après le tableau d'amortissement importé
 * ou le crédit du bien (ou les dépenses de l'année), modifiables d'après l'attestation annuelle de la banque.
 */
export function LoanYearFields({ a, year, interest, insurance, setInterest, setInsurance, onOpenProperty }: {
  a: YearAmounts; year: number; interest: number | null | undefined; insurance: number | null | undefined;
  setInterest: (v: number | null) => void; setInsurance: (v: number | null) => void; onOpenProperty?: () => void;
}) {
  if (a.interestComputedSource === 'aucun' && a.loanInsuranceComputedSource === 'aucun' && interest == null && insurance == null) return null;
  const hint = (typed: number | null | undefined, computed: number, source: YearAmounts['interestComputedSource'], reset: () => void) => (typed != null
    ? <>Montant saisi. Pré-calcul : {money2(computed)} ({LOAN_SOURCE_LABELS[source]}). <button type="button" className="link" onClick={reset}>Revenir au pré-calcul</button></>
    : <>Pré-calculé : {LOAN_SOURCE_LABELS[source]}. Remplacez-le par le montant de l’attestation annuelle de la banque.</>);
  return (
    <div className="tax-input-group">
      <NumberInput label={`Intérêts d’emprunt ${year}`} suffix="€" value={interest ?? a.interestComputed}
        onChange={(v) => { if (v != null && !Number.isNaN(v)) setInterest(v); }} hint={hint(interest, a.interestComputed, a.interestComputedSource, () => setInterest(null))} />
      <NumberInput label={`Assurance emprunteur ${year}`} suffix="€" value={insurance ?? a.loanInsuranceComputed}
        onChange={(v) => { if (v != null && !Number.isNaN(v)) setInsurance(v); }} hint={hint(insurance, a.loanInsuranceComputed, a.loanInsuranceComputedSource, () => setInsurance(null))} />
      {a.interestComputedSource === 'credit' && onOpenProperty && (
        <p className="muted small">Échéancier théorique : importez le tableau d’amortissement de la banque pour retenir les intérêts réellement échus.{' '}
          <button type="button" className="link" onClick={onOpenProperty}>Importer dans Mes biens</button></p>
      )}
    </div>
  );
}
