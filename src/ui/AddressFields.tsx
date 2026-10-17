import { useEffect, useId, useRef, useState } from 'react';
import { citiesForZip, searchAddress, type AddressSuggestion } from '../domain/address.ts';

interface Value { address?: string | null; zip?: string | null; city?: string | null }

/**
 * Adresse avec saisie automatique (Base Adresse Nationale) : choisir une proposition remplit
 * l'adresse, le code postal et la ville. Un code postal saisi seul propose sa ou ses communes.
 */
export function AddressFields({ value, onChange }: { value: Value; onChange: (v: { address: string | null; zip: string | null; city: string | null }) => void }) {
  const id = useId();
  const [items, setItems] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState<'' | 'loading' | 'error'>('');
  const [cities, setCities] = useState<string[]>([]);
  const typed = useRef(false);
  const v = { address: value.address ?? null, zip: value.zip ?? null, city: value.city ?? null };

  useEffect(() => {
    const q = v.address ?? '';
    if (!typed.current || q.trim().length < 3) { setItems([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      setStatus('loading');
      searchAddress(`${q} ${v.zip ?? ''}`.trim(), ctl.signal)
        .then((r) => { setItems(r); setOpen(r.length > 0); setActive(-1); setStatus(''); })
        .catch((e: Error) => { if (e.name !== 'AbortError') { setItems([]); setStatus('error'); } });
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.address]);

  useEffect(() => {
    if (!v.zip || !/^\d{5}$/.test(v.zip)) { setCities([]); return; }
    const ctl = new AbortController();
    citiesForZip(v.zip, ctl.signal).then((list) => {
      setCities(list);
      // une seule commune pour ce code postal : remplie d'office si la ville est vide ou ne correspond pas
      if (list.length === 1 && (!v.city || !list.some((c) => c.toLowerCase() === v.city!.toLowerCase()))) onChange({ ...v, city: list[0]! });
    }).catch(() => setCities([]));
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.zip]);

  const pick = (s: AddressSuggestion) => {
    typed.current = false;
    onChange({ address: s.address || v.address, zip: s.zip, city: s.city });
    setOpen(false);
    setItems([]);
  };

  return (
    <>
      <div className="field field-wide address-field">
        <label htmlFor={`${id}-a`}>Adresse</label>
        <input id={`${id}-a`} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-list`} autoComplete="off" maxLength={300}
          aria-activedescendant={active >= 0 ? `${id}-o${active}` : undefined} aria-describedby={`${id}-h`}
          value={v.address ?? ''} placeholder="Ex. 8 passage Ruelle"
          onChange={(e) => { typed.current = true; onChange({ ...v, address: e.target.value || null }); }}
          onFocus={() => items.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!open || !items.length) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a <= 0 ? items.length - 1 : a - 1)); }
            else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(items[active]!); }
            else if (e.key === 'Escape') setOpen(false);
          }} />
        {open && (
          <ul id={`${id}-list`} role="listbox" className="address-list">
            {items.map((s, i) => (
              <li key={s.label} id={`${id}-o${i}`} role="option" aria-selected={i === active} className={i === active ? 'active' : ''}
                onMouseDown={(e) => { e.preventDefault(); pick(s); }}>{s.label}</li>
            ))}
          </ul>
        )}
        <small id={`${id}-h`} className="muted">{status === 'error' ? 'Suggestions indisponibles : saisissez l’adresse à la main.' : 'Choisissez une suggestion pour remplir le code postal et la ville.'}</small>
      </div>
      <div className="field">
        <label htmlFor={`${id}-z`}>Code postal</label>
        <input id={`${id}-z`} inputMode="numeric" autoComplete="postal-code" maxLength={12} value={v.zip ?? ''} onChange={(e) => onChange({ ...v, zip: e.target.value.trim() || null })} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-c`}>Ville</label>
        <input id={`${id}-c`} list={cities.length > 1 ? `${id}-cities` : undefined} autoComplete="address-level2" maxLength={120} value={v.city ?? ''} onChange={(e) => onChange({ ...v, city: e.target.value || null })} />
        {cities.length > 1 && <datalist id={`${id}-cities`}>{cities.map((c) => <option key={c} value={c} />)}</datalist>}
        {cities.length > 1 && <small className="muted">{cities.length} communes pour ce code postal</small>}
      </div>
    </>
  );
}
