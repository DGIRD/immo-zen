import { useMemo, useState } from 'react';
import { useStore } from '../data/store.tsx';
import { bankDossierDoc, debtRatio, HCSF_MAX, type Borrower, type DossierProperty } from '../domain/bankDossier.ts';
import { buildBankDossierPdf } from '../domain/bankDossierPdf.ts';
import { downloadBlob } from '../domain/exporting.ts';
import { money, pct, todayParis } from '../domain/format.ts';
import { patrimonyLines, patrimonyTotals } from '../domain/patrimony.ts';
import type { SimulationInputs, SimulationResult } from '../domain/simulator.ts';
import { Button, Checkbox, Modal, NumberInput, TextArea, TextInput } from '../ui/components.tsx';

/**
 * Export « Dossier banque » d'une simulation : PDF de présentation du projet à une banque ou à un courtier.
 * La situation de l'emprunteur est facultative et n'est jamais enregistrée (elle ne sert qu'au document).
 */
export function BankDossierButton({ property, inputs, result, notify, propertyId }: {
  property: DossierProperty; inputs: SimulationInputs; result: SimulationResult | null; notify: (m: string) => void;
  /** Bien de la simulation, exclu du bilan patrimonial s'il est déjà détenu (pas de double compte). */
  propertyId?: string | null;
}) {
  const { data } = useStore();
  const lines = useMemo(() => patrimonyLines(data.properties.filter((p) => p.id !== propertyId), todayParis()), [data.properties, propertyId]);
  const totals = patrimonyTotals(lines);
  const [withPatrimony, setWithPatrimony] = useState(true);
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
      const doc = bankDossierDoc({ property, inputs, result, borrower: b, editedOn: todayParis(), withSchedule: schedule, patrimony: withPatrimony ? lines : undefined });
      const bytes = await buildBankDossierPdf(lib as never, doc);
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
            {lines.length > 0 && <Checkbox label="Joindre le bilan patrimonial immobilier" checked={withPatrimony} onChange={setWithPatrimony} />}
          </div>
          {lines.length > 0 ? withPatrimony && (
            <p className="note">
              Bilan patrimonial : {lines.length} bien{lines.length > 1 ? 's' : ''} détenu{lines.length > 1 ? 's' : ''} (résidences comprises), valeur estimée <strong>{money(totals.value)}</strong>,
              capital restant dû <strong>{money(totals.remaining)}</strong>, patrimoine net <strong>{money(totals.net)}</strong>.
              {totals.missingValue ? ` ${totals.missingValue} bien${totals.missingValue > 1 ? 's' : ''} sans estimation : lancez l’estimation depuis sa fiche.` : ''}
            </p>
          ) : (
            <p className="muted small">Ajoutez vos biens détenus et votre résidence principale dans « Mes biens » pour joindre un bilan patrimonial.</p>
          )}
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
