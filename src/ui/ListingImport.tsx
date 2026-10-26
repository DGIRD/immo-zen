import { useState } from 'react';
import { useStore } from '../data/store.tsx';
import { FunctionUnavailable } from '../data/platform.ts';
import { listingScore, mergeListing, parseListing, type ListingData, type ListingField } from '../../supabase/functions/_shared/listing.ts';
import { TYPE_LABELS } from '../domain/labels.ts';
import { money } from '../domain/format.ts';
import { Button, Checkbox } from './components.tsx';

/** Caractéristiques proposées au remplissage, dans l'ordre d'affichage. */
export const LISTING_APPLY_FIELDS: [ListingField, string][] = [
  ['title', 'Titre'], ['property_type', 'Type'], ['price', 'Prix de présentation FAI'], ['surface', 'Surface'], ['rooms', 'Pièces'],
  ['address', 'Adresse'], ['zip', 'Code postal'], ['city', 'Ville'], ['dpe', 'DPE'], ['copro_charges_annual', 'Charges de copropriété'],
  ['property_tax_annual', 'Taxe foncière'], ['agency_fees', 'Honoraires d’agence (acquéreur)'], ['bedrooms', 'Chambres'], ['floor', 'Étage'], ['furnished', 'Meublé'],
];

export function listingDisplay(k: ListingField, v: unknown): string {
  if (v === null || v === undefined || v === '' || v === 0 && k !== 'floor') return '—';
  switch (k) {
    case 'price': case 'agency_fees': return money(Number(v));
    case 'copro_charges_annual': case 'property_tax_annual': return `${money(Number(v))} / an`;
    case 'surface': return `${String(v).replace('.', ',')} m²`;
    case 'property_type': return TYPE_LABELS[v as keyof typeof TYPE_LABELS] ?? String(v);
    case 'floor': return Number(v) === 0 ? 'rez-de-chaussée' : `${v}e étage`;
    case 'furnished': return v ? 'oui' : 'non';
    default: return String(v);
  }
}

/**
 * Remplissage d'une fiche de bien depuis une annonce : lecture du lien par la fonction serveur « annonce »,
 * ou analyse d'un texte collé (dans le navigateur, complétée par la lecture assistée si elle est disponible).
 * Rien n'est appliqué sans validation : chaque valeur trouvée est proposée, avec la valeur actuelle en regard.
 */
export function ListingImport({ url, current, onApply }: {
  url: string | null;
  /** Valeurs actuelles de la fiche, pour signaler ce qui serait remplacé. */
  current: Partial<Record<ListingField, unknown>>;
  onApply: (l: ListingData, fields: ListingField[], url: string | null) => void;
}) {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState('');
  const [found, setFound] = useState<{ l: ListingData; url: string | null; assisted: boolean } | null>(null);
  const [chosen, setChosen] = useState<Set<ListingField>>(new Set());
  const empty = (v: unknown) => v === null || v === undefined || v === '' || v === 0;

  const show = (l: ListingData, finalUrl: string | null, assisted: boolean) => {
    if (listingScore(l) === 0 && !l.title) { setError('Aucune caractéristique reconnue dans cette annonce. Vérifiez le lien ou collez le texte complet de l’annonce.'); return; }
    setFound({ l, url: finalUrl, assisted });
    // cochées par défaut : les valeurs trouvées pour des champs encore vides ; décochées si elles remplaceraient une saisie
    setChosen(new Set(LISTING_APPLY_FIELDS.map(([k]) => k).filter((k) => l[k] !== null && (empty(current[k]) || current[k] === l[k]))));
  };

  async function readUrl() {
    setError(null); setFound(null);
    const u = (url ?? '').trim();
    if (!/^https?:\/\//i.test(u)) { setError('Collez d’abord le lien de l’annonce (commençant par https://) dans « Lien de l’annonce ».'); return; }
    setBusy(true);
    try {
      const r = await store.repo.platform.readListing({ url: u });
      show(r.listing, r.url, r.assisted);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPaste(true); // repli : texte collé
    } finally { setBusy(false); }
  }

  async function readText() {
    setError(null); setFound(null);
    if (text.trim().length < 20) { setError('Collez le texte de l’annonce (titre, prix, surface, description…).'); return; }
    setBusy(true);
    try {
      let l = parseListing({ text });
      let assisted = false;
      // informations clés manquantes : lecture assistée par le serveur, si elle est disponible
      if ((l.price === null || l.surface === null || listingScore(l) < 5) && store.repo.mode !== 'demo') {
        try { const r = await store.repo.platform.readListing({ text: text.slice(0, 50_000) }); l = mergeListing(l, r.listing, 'lecture assistée'); assisted = r.assisted; }
        catch (e) { if (!(e instanceof FunctionUnavailable)) console.warn('lecture assistée', e); }
      }
      show(l, null, assisted);
    } finally { setBusy(false); }
  }

  return (
    <div className="listing-import" role="region" aria-label="Remplir depuis l’annonce">
      <div className="row">
        <Button size="sm" variant="primary" disabled={busy} onClick={() => void readUrl()}>{busy && !paste ? 'Lecture de l’annonce…' : 'Remplir depuis l’annonce'}</Button>
        <button type="button" className="link small" onClick={() => setPaste((p) => !p)} aria-expanded={paste}>{paste ? 'Masquer le texte collé' : 'ou coller le texte de l’annonce'}</button>
      </div>
      <p className="muted small">Immo-Zen lit l’annonce et propose prix, surface, pièces, adresse, DPE, charges et taxe foncière. Vous choisissez ce qui est repris.</p>
      {paste && (
        <div className="field field-full">
          <label htmlFor="listing-text">Texte de l’annonce</label>
          <textarea id="listing-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} maxLength={50_000}
            placeholder="Sur la page de l’annonce : tout sélectionner (Ctrl+A ou ⌘A), copier, puis coller ici." />
          <div className="row"><Button size="sm" disabled={busy} onClick={() => void readText()}>{busy ? 'Analyse…' : 'Analyser le texte'}</Button></div>
        </div>
      )}
      {error && <p className="form-error small" role="alert">{error}</p>}
      {found && (
        <div className="listing-found">
          <p className="small"><strong>{[...chosen].length} caractéristique{chosen.size > 1 ? 's' : ''} à reprendre</strong>
            {found.assisted ? ' · complétées par la lecture assistée : vérifiez-les' : ''}. Décochez ce que vous ne voulez pas reprendre.</p>
          <div className="dt-scroll"><table className="dt-table compact">
            <thead><tr><th><span className="sr-only">Reprendre</span></th><th>Caractéristique</th><th>Dans l’annonce</th><th>Actuellement</th></tr></thead>
            <tbody>{LISTING_APPLY_FIELDS.filter(([k]) => found.l[k] !== null).map(([k, label]) => (
              <tr key={k}>
                <td><Checkbox label={`Reprendre : ${label}`} checked={chosen.has(k)} onChange={(on) => setChosen((s) => { const n = new Set(s); if (on) n.add(k); else n.delete(k); return n; })} /></td>
                <td>{label}{found.l.sources[k] === 'lecture assistée' && <span className="pill pill-neutral" title="Valeur trouvée par la lecture assistée">IA</span>}</td>
                <td><strong>{listingDisplay(k, found.l[k])}</strong></td>
                <td className="muted">{empty(current[k]) ? '—' : listingDisplay(k, current[k])}{!empty(current[k]) && current[k] !== found.l[k] && <span className="small"> (remplacé si coché)</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="row">
            <Button size="sm" variant="primary" disabled={!chosen.size} onClick={() => { onApply(found.l, [...chosen], found.url); setFound(null); setText(''); setPaste(false); }}>Reprendre dans la fiche ({chosen.size})</Button>
            <Button size="sm" variant="ghost" onClick={() => setFound(null)}>Ignorer</Button>
          </div>
          <p className="muted small">Les valeurs reprises restent modifiables. Vérifiez-les avec l’agence : une annonce peut être incomplète ou ancienne.</p>
        </div>
      )}
    </div>
  );
}
