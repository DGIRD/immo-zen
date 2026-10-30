import { useEffect, useState } from 'react';
import { useStore } from '../data/store.tsx';
import type { LoanData } from '../data/market.ts';
import { date, todayParis } from '../domain/format.ts';
import {
  BRACKET_LABELS, bracketFor, estimateTaeg, latestUsury, proposedRate, remainingYears, renegotiation, usuryFor, usuryStatus, type Borrower,
} from '../domain/loanRates.ts';
import { Button, Pill } from './components.tsx';

let loanCache: Promise<LoanData | null> | null = null;
/** Barème et taux d'usure, lus une fois par session (rechargés après une mise à jour par l'administrateur). */
export function useLoanData(): LoanData | null | undefined {
  const { repo } = useStore();
  const [d, setD] = useState<LoanData | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    loanCache ??= repo.platform.market.loanData().catch(() => { loanCache = null; return null; });
    void loanCache.then((x) => { if (alive) setD(x); });
    return () => { alive = false; };
  }, [repo]);
  return d;
}
export function resetLoanData() { loanCache = null; }

const fr = (x: number) => x.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Taux de référence pour la durée choisie (barème, interpolé) et contrôle du taux d'usure (TAEG estimé).
 * Le taux de la simulation n'est remplacé que sur clic.
 */
export function LoanRateHint({ years, rate, onUseRate, amount, insuranceRate, fees, borrower }: {
  years: number; rate: number; onUseRate?: (r: number) => void; amount: number; insuranceRate: number; fees: number; borrower: Borrower;
}) {
  const data = useLoanData();
  const today = todayParis();
  if (data === undefined) return null;
  if (data === null) return <p className="muted small">Taux de référence indisponibles : la base de données n’est pas à jour (migration du 30/10/2026).</p>;
  const ref = proposedRate(data.benchmarks, years, today);
  const bracket = bracketFor(years);
  const usury = usuryFor(data.usury, borrower, years, today);
  const last = usury ? null : latestUsury(data.usury, borrower, bracket);
  const taeg = amount > 0 ? estimateTaeg({ amount, rate, years, insuranceRate, fees }) : null;
  const status = taeg !== null && usury ? usuryStatus(taeg, usury.usury) : null;
  return (
    <div className="loan-hint field-full">
      {ref ? (
        <p>
          Taux de référence sur {years} ans : <strong>{fr(ref.rate)} %</strong>
          <small className="muted"> (barème du {date(ref.on)}, {ref.source}{ref.interpolated ? ', interpolé entre les durées voisines' : ''}{ref.extrapolated ? ', durée hors barème : durée la plus proche' : ''}, hors assurance)</small>
          {ref.stale && <Pill tone="warn">à vérifier</Pill>}
          {onUseRate && Math.abs(ref.rate - rate) >= 0.005 && <Button size="sm" onClick={() => onUseRate(ref.rate)}>Utiliser ce taux</Button>}
        </p>
      ) : <p className="muted small">Barème des taux par durée non renseigné (Administration → Données de marché).</p>}
      {usury ? (
        <p>
          {taeg !== null ? <>TAEG estimé : <strong>{fr(taeg)} %</strong> · </> : null}
          taux d’usure {fr(usury.usury)} % <small className="muted">({BRACKET_LABELS[bracket].toLowerCase()}, {borrower === 'personne_morale' ? 'personnes morales, ' : ''}{usury.quarter.replace('-Q', ', trimestre ')})</small>
          {status === 'ok' && <Pill tone="ok">sous le plafond</Pill>}
          {status === 'proche' && <Pill tone="warn">proche du plafond</Pill>}
          {status === 'depasse' && <Pill tone="bad">plafond dépassé</Pill>}
          {usury.average !== null && <small className="muted"> Repère Banque de France : TAEG moyen pratiqué {fr(usury.average)} %.</small>}
        </p>
      ) : <p className="muted small">Plafond non à jour : taux d’usure du trimestre en cours non chargé{last ? ` (dernier connu : ${last.quarter.replace('-Q', ', trimestre ')}, ${fr(last.usury)} %)` : ''}.</p>}
      {status === 'depasse' && <p className="form-error" role="alert">Financement probablement refusé : le TAEG estimé dépasse le taux d’usure. Réduisez la durée, l’assurance ou les frais, ou augmentez l’apport.</p>}
      {taeg !== null && <p className="muted small">TAEG estimé avec le taux nominal, l’assurance emprunteur et les frais de garantie et de dossier, sans différé. Seul le TAEG de l’offre de prêt fait foi.</p>}
    </div>
  );
}

/** Crédit d'un bien détenu comparé au barème de sa durée restante (renégociation à étudier au-delà de l'écart réglé). */
export function RenegotiationHint({ rate, years, start }: { rate: number | null | undefined; years: number | null | undefined; start: string | null | undefined }) {
  const data = useLoanData();
  const today = todayParis();
  if (!data || rate == null) return null;
  const left = remainingYears(years, start, today);
  if (!left) return null;
  const ref = proposedRate(data.benchmarks, left, today);
  const r = renegotiation(rate, ref?.rate, data.config.renegotiation_gap);
  if (!ref || !r) return null;
  return (
    <p className={r.worth ? 'note note-warn' : 'muted small'} role="status">
      {r.worth ? <><strong>Renégociation à étudier</strong> : </> : null}
      taux du crédit {fr(rate)} % contre {fr(ref.rate)} % au barème pour la durée restante ({left} an{left > 1 ? 's' : ''}, barème du {date(ref.on)})
      {r.gap > 0 ? `, soit ${fr(r.gap)} point${r.gap >= 2 ? 's' : ''} de plus.` : '.'}
      {r.worth && ' Tenez compte des indemnités de remboursement anticipé et des frais de la nouvelle garantie.'}
    </p>
  );
}
