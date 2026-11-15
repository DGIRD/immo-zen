import { useState } from 'react';
import { bankDossierDoc, debtRatio, HCSF_MAX, type Borrower, type DossierProperty } from '../domain/bankDossier.ts';
import { buildDocPdf } from '../domain/docPdf.ts';
import { downloadBlob } from '../domain/exporting.ts';
import { pct, todayParis } from '../domain/format.ts';
import type { SimulationInputs, SimulationResult } from '../domain/simulator.ts';
import { Button, Checkbox, Modal, NumberInput, TextArea, TextInput } from '../ui/components.tsx';

/**
 * Export « Dossier banque » d'une simulation : PDF de présentation du projet à une banque ou à un courtier.
 * La situation de l'emprunteur est facultative et n'est jamais enregistrée (elle ne sert qu'au document).
 */
export function BankDossierButton({ property, inputs, result, notify }: {
  property: DossierProperty; inputs: SimulationInputs; result: SimulationResult | null; notify: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [b, setB] = useState<Borrower>({});
  const [schedule, setSchedule] = useState(true);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Borrower>(k: K, v: Borrower[K]) => setB((x) => ({ ...x, [k]: v }));
  const ratio = result ? debtRatio(b, result.monthlyPaymentWithInsurance, result.monthlyRent) : null;

  async function generate() {
    if (!result) return;
    setBusy(true);
    try {
      const lib = await import('pdf-lib');
      const doc = bankDossierDoc({ property, inputs, result, borrower: b, editedOn: todayParis(), withSchedule: schedule });
      const bytes = await buildDocPdf(lib as never, doc);
      const slug = (property.title || 'projet').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
      downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `dossier-financement-${slug || 'projet'}.pdf`);
      notify('Dossier de financement téléchargé.');
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={!result}>Dossier banque (PDF)</Button>
      {open && (
        <Modal open wide title="Dossier de financement pour la banque" onClose={() => setOpen(false)}
          footer={<><Button onClick={() => setOpen(false)}>Annuler</Button><Button variant="primary" disabled={busy || !result} onClick={() => void generate()}>{busy ? 'Préparation…' : 'Télécharger le PDF'}</Button></>}>
          <p>Le PDF reprend le bien, le plan de financement, le prêt demandé, la rentabilité locative et le tableau d’amortissement de la simulation. Ajoutez si vous le souhaitez votre situation : la banque calcule d’abord votre taux d’endettement.</p>
          <p className="muted small">Ces informations ne servent qu’au document : elles ne sont pas enregistrées dans Immo-Zen.</p>
          <div className="grid">
            <TextInput label="Emprunteur(s)" wide value={b.names ?? ''} onChange={(v) => set('names', v)} hint="Ex. : David et Marie Dupont" />
            <TextInput label="Situation professionnelle" wide value={b.situation ?? ''} onChange={(v) => set('situation', v)} hint="Ex. : salarié en CDI depuis 2015" />
            <NumberInput label="Revenus nets mensuels du foyer" suffix="€" value={b.income ?? null} onChange={(v) => set('income', v)} hint="Avant impôt" />
            <NumberInput label="Crédits en cours" suffix="€ / mois" value={b.currentLoans ?? null} onChange={(v) => set('currentLoans', v)} hint="Mensualités, assurance comprise" />
            <NumberInput label="Loyers déjà perçus" suffix="€ / mois" value={b.currentRents ?? null} onChange={(v) => set('currentRents', v)} />
            <NumberInput label="Épargne restante après l’apport" suffix="€" value={b.savingsAfter ?? null} onChange={(v) => set('savingsAfter', v)} hint="Épargne de précaution" />
            <TextArea label="Présentation du projet (facultatif)" value={b.presentation ?? ''} onChange={(v) => set('presentation', v)} rows={3} />
            <Checkbox label="Joindre le tableau d’amortissement annuel" checked={schedule} onChange={setSchedule} />
          </div>
          {ratio && (
            <p className={ratio.after > HCSF_MAX ? 'form-error' : 'note'} role="status">
              Taux d’endettement après le projet : <strong>{pct(ratio.after)}</strong>{ratio.before != null ? ` (aujourd’hui ${pct(ratio.before)})` : ''}, loyers retenus à 70 %.
              {ratio.after > HCSF_MAX ? ` Au-dessus du plafond de ${HCSF_MAX} % recommandé : la banque peut accorder une dérogation, mais il faudra la justifier (épargne, reste à vivre).` : ` Sous le plafond de ${HCSF_MAX} % recommandé.`}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}
