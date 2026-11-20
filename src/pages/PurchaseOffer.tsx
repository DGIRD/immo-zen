import { useMemo, useState } from 'react';
import { buildDocPdf } from '../domain/docPdf.ts';
import { downloadBlob } from '../domain/exporting.ts';
import { money, pct, todayParis } from '../domain/format.ts';
import { purchaseOfferDoc, suggestArguments, suggestedPrice, type ArgumentId, type NegotiationArgument, type OfferProperty } from '../domain/purchaseOffer.ts';
import { round2, type SimulationInputs, type SimulationResult } from '../domain/simulator.ts';
import { Button, Checkbox, Modal, NumberInput, TextArea, TextInput } from '../ui/components.tsx';

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/**
 * « Offre d'achat (PDF) » depuis la simulation : prix proposé, motifs de négociation à cocher (pré-remplis avec les
 * chiffres du bien et de la simulation, modifiables), financement et condition suspensive de prêt.
 * Les noms et adresses saisis ne servent qu'au document : ils ne sont pas enregistrés.
 */
export function PurchaseOfferButton({ property, inputs, result, notify, recipient }: {
  property: OfferProperty; inputs: SimulationInputs; result: SimulationResult | null; notify: (m: string) => void; recipient?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={!result}>Offre d’achat (PDF)</Button>
      {open && result && <OfferModal property={property} inputs={inputs} result={result} notify={notify} recipient={recipient} onClose={() => setOpen(false)} />}
    </>
  );
}

function OfferModal({ property, inputs: i, result: r, notify, recipient, onClose }: {
  property: OfferProperty; inputs: SimulationInputs; result: SimulationResult; notify: (m: string) => void; recipient?: string; onClose: () => void;
}) {
  const today = todayParis();
  const [months, setMonths] = useState<number | null>(null);
  const base = useMemo(() => suggestArguments({ property, inputs: i, result: r }), [property, i, r]);
  const [args, setArgs] = useState<NegotiationArgument[]>(base);
  const [checked, setChecked] = useState<Set<ArgumentId>>(() => new Set(base.filter((a) => a.relevant).map((a) => a.id)));
  const [buyers, setBuyers] = useState('');
  const [address, setAddress] = useState('');
  const [to, setTo] = useState(recipient ?? '');
  const [place, setPlace] = useState('');
  const [price, setPriceRaw] = useState<number | null>(Math.round(r.offerFai));
  // le texte « rentabilité » cite le prix proposé : il suit le prix tant qu'il n'a pas été retouché
  const setPrice = (v: number | null) => {
    const before = suggestArguments({ property, inputs: i, result: r }, { monthsOnMarket: months, offerPrice: price }).find((x) => x.id === 'rendement')!.text;
    const after = suggestArguments({ property, inputs: i, result: r }, { monthsOnMarket: months, offerPrice: v }).find((x) => x.id === 'rendement')!.text;
    setArgs((xs) => xs.map((a) => (a.id === 'rendement' && a.text === before ? { ...a, text: after } : a)));
    setPriceRaw(v);
  };
  const [fees, setFees] = useState<number | null>(Math.round(r.agencyFees));
  const hasLoan = i.useLoan && r.loanAmount > 0;
  const [loan, setLoan] = useState<number | null>(hasLoan ? Math.round(r.loanAmount) : null);
  const [years, setYears] = useState<number | null>(hasLoan ? i.loanYears : null);
  const [maxRate, setMaxRate] = useState<number | null>(hasLoan ? round2(i.interestRate) : null);
  const [loanDays, setLoanDays] = useState<number | null>(45);
  const [compromisDays, setCompromisDays] = useState<number | null>(30);
  const [validUntil, setValidUntil] = useState(addDays(today, 7));
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);

  const setArg = (id: ArgumentId, patch: Partial<NegotiationArgument>) => setArgs((xs) => xs.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const toggle = (id: ArgumentId, on: boolean) => setChecked((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const chosen = args.filter((a) => checked.has(a.id));
  const suggestion = i.askingPrice > 0 ? suggestedPrice(i.askingPrice, chosen) : null;
  const cut = chosen.reduce((s, a) => s + Math.max(0, a.amount || 0), 0);

  const doc = purchaseOfferDoc({
    property, inputs: i, editedOn: today, args: chosen,
    parties: { buyers, buyersAddress: address, recipient: to },
    terms: {
      priceFai: price ?? 0, agencyFees: fees ?? 0, equity: r.equity,
      loan: loan && loan > 0 ? { amount: loan, years: years ?? i.loanYears, maxRate: maxRate ?? i.interestRate } : null,
      validUntil, compromisDays: compromisDays ?? 30, loanDays: loanDays ?? 45, place,
      extraConditions: extra.split('\n').map((x) => x.trim()).filter(Boolean),
    },
  });

  async function generate() {
    setBusy(true);
    try {
      const lib = await import('pdf-lib');
      const bytes = await buildDocPdf(lib as never, doc);
      const slug = (property.title || 'bien').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
      downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `offre-achat-${slug || 'bien'}.pdf`);
      notify('Offre d’achat téléchargée : relisez-la, signez-la et envoyez-la au vendeur ou à l’agence.');
      onClose();
    } finally { setBusy(false); }
  }

  const discount = i.askingPrice > 0 && price ? i.askingPrice - price : 0;
  return (
    <Modal open wide title="Offre d’achat" onClose={onClose}
      footer={<><Button onClick={onClose}>Annuler</Button><Button variant="primary" disabled={busy || !price} onClick={() => void generate()}>{busy ? 'Préparation…' : 'Télécharger l’offre'}</Button></>}>
      <p>L’offre reprend le bien, le prix et le financement de la simulation. Cochez les arguments qui justifient votre prix : leur texte est pré-rempli avec vos chiffres et reste modifiable.</p>
      <p className="muted small">Noms et adresses ne servent qu’au document : ils ne sont pas enregistrés dans Immo-Zen.</p>

      <h3>Parties</h3>
      <div className="grid">
        <TextInput label="Acquéreur(s)" wide value={buyers} onChange={setBuyers} hint="Ex. : Marie et David Dupont" />
        <TextInput label="Adresse de l’acquéreur" wide value={address} onChange={setAddress} />
        <TextInput label="Destinataire" wide value={to} onChange={setTo} hint="Vendeur ou agence ; vide : « Madame, Monsieur le vendeur »" />
        <TextInput label="Fait à" value={place} onChange={setPlace} />
      </div>

      <h3>Arguments pour négocier</h3>
      <div className="offer-args">
        {args.map((a) => (
          <div key={a.id} className={`offer-arg${checked.has(a.id) ? ' on' : ''}`}>
            <Checkbox label={`${a.label}${a.relevant ? ' — conseillé' : ''}`} checked={checked.has(a.id)} onChange={(v) => toggle(a.id, v)} />
            {checked.has(a.id) && (
              <div className="grid">
                {a.id === 'duree' && (
                  <NumberInput label="En vente depuis" suffix="mois" value={months} onChange={(v) => {
                    setMonths(v);
                    setArg('duree', { text: suggestArguments({ property, inputs: i, result: r }, { monthsOnMarket: v }).find((x) => x.id === 'duree')!.text });
                  }} />
                )}
                <NumberInput label="Décote justifiée" suffix="€" value={a.amount || null} onChange={(v) => setArg(a.id, { amount: v ?? 0 })} hint="Facultatif : sert au prix suggéré" />
                <TextArea label="Texte dans l’offre" value={a.text} onChange={(v) => setArg(a.id, { text: v })} rows={3} />
              </div>
            )}
          </div>
        ))}
      </div>

      <h3>Prix proposé</h3>
      <div className="grid">
        <NumberInput label="Prix proposé, honoraires inclus" suffix="€" value={price} onChange={setPrice}
          hint={i.askingPrice ? `Prix affiché ${money(i.askingPrice)}${discount > 0 ? ` : −${money(discount)} (${pct(round2((discount / i.askingPrice) * 100))})` : ''}` : undefined} />
        <NumberInput label="Dont honoraires d’agence" suffix="€" value={fees} onChange={setFees} hint="À la charge de l’acquéreur ; 0 si à la charge du vendeur" />
      </div>
      {suggestion != null && cut > 0 && (
        <p className="note">
          Décotes retenues : {money(cut)}. Prix suggéré : <strong>{money(suggestion)}</strong>{' '}
          <Button size="sm" onClick={() => setPrice(suggestion)}>Retenir ce prix</Button>
          {price !== Math.round(r.offerFai) && <span className="muted small"> La simulation reste à {money(r.offerFai)} : mettez-la à jour pour recalculer le financement.</span>}
        </p>
      )}

      <h3>Financement et délais</h3>
      <div className="grid">
        <NumberInput label="Montant du prêt" suffix="€" value={loan} onChange={setLoan} hint="Vide ou 0 : achat sans prêt" />
        {loan ? <NumberInput label="Durée maximale" suffix="ans" value={years} onChange={setYears} /> : null}
        {loan ? <NumberInput label="Taux maximal hors assurance" suffix="%" step="0.01" value={maxRate} onChange={setMaxRate} hint="Si aucune banque ne prête à ce taux ou moins, vous renoncez sans pénalité" /> : null}
        {loan ? <NumberInput label="Délai d’obtention du prêt" suffix="jours" value={loanDays} onChange={setLoanDays} hint="30 jours minimum, 45 à 60 en pratique" /> : null}
        <NumberInput label="Signature du compromis sous" suffix="jours" value={compromisDays} onChange={setCompromisDays} />
        <TextInput label="Offre valable jusqu’au" type="date" value={validUntil} onChange={(v) => setValidUntil(v || addDays(today, 7))} />
        <TextArea label="Autres conditions (une par ligne, facultatif)" value={extra} onChange={setExtra} rows={2} hint="Ex. : vente libre de toute occupation ; obtention d’un permis de construire" />
      </div>
      {doc.warnings.length > 0 && <ul className="form-error">{doc.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
    </Modal>
  );
}
