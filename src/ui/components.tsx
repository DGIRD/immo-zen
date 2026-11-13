import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { PropertyStatus } from '../data/types.ts';
import { STATUS_LABELS, statusTone } from '../domain/labels.ts';

export function Button({ variant = 'secondary', size, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' }) {
  return <button type="button" className={`btn btn-${variant}${size ? ' btn-sm' : ''} ${className}`} {...rest} />;
}

/** Au-delà de cette longueur, une explication passe dans un point info au lieu de s'afficher en toutes lettres. */
const LONG_TEXT = 90;
const isLong = (n: ReactNode) => typeof n === 'string' && n.length > LONG_TEXT;

/**
 * Point info « i » : l'explication s'ouvre au survol, au clic ou au clavier (Entrée, Espace), se ferme avec Échap,
 * un clic ailleurs ou le défilement. Le texte reste dans la page pour les lecteurs d'écran (aria-describedby).
 */
export function InfoTip({ children, label = 'Aide', className = '', text }: { children: ReactNode; label?: string; className?: string; text?: string }) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState<'hover' | 'pinned' | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const w = Math.min(352, window.innerWidth - 16);
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left - 12, window.innerWidth - w - 8)) });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(null); btn.current?.focus(); } };
    const click = (e: MouseEvent) => { if (!btn.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node)) setOpen(null); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', key);
    document.addEventListener('mousedown', click);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); document.removeEventListener('keydown', key); document.removeEventListener('mousedown', click); };
  }, [open]);
  return (
    <span className={`info-tip ${className}`} onMouseEnter={() => setOpen((o) => o ?? 'hover')} onMouseLeave={() => setOpen((o) => (o === 'hover' ? null : o))}>
      <button ref={btn} type="button" className={text ? 'info-tip-link' : 'info-tip-btn'} aria-label={text ? undefined : 'Plus d’informations'} title={text ? undefined : label} aria-expanded={!!open} aria-describedby={id}
        onClick={() => setOpen((o) => (o === 'pinned' ? null : 'pinned'))}>{text ? <><span className="info-tip-btn" aria-hidden="true">i</span> {text}</> : 'i'}</button>
      <span ref={pop} id={id} role="tooltip" className={`info-tip-pop${open ? ' open' : ''}`} style={open && pos ? { top: pos.top, left: pos.left } : undefined}>{children}</span>
    </span>
  );
}

/** Texte d'aide : court, il s'affiche ; long, il passe dans un point info. */
export function Help({ children, label, inline }: { children: ReactNode; label?: string; inline?: boolean }) {
  if (!isLong(children) && typeof children === 'string') return inline ? <span className="muted small">{children}</span> : <p className="muted small">{children}</p>;
  return inline ? <InfoTip label={label}>{children}</InfoTip> : <p className="help-line"><InfoTip label={label} text={label ?? 'En savoir plus'}>{children}</InfoTip></p>;
}

export function PageHeader({ title, subtitle, actions, info }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; info?: ReactNode }) {
  const tip = info ?? (isLong(subtitle) ? subtitle : null);
  return (
    <div className="page-header">
      <div>
        <div className="title-row"><h1>{title}</h1>{tip && <InfoTip label={typeof title === 'string' ? title : 'Cette page'}>{tip}</InfoTip>}</div>
        {subtitle && !isLong(subtitle) && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Section({ title, actions, children, className = '', info, collapsible, summary, defaultOpen = true }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; info?: ReactNode;
  /** Rubrique repliable : le résumé s'affiche à côté du titre quand elle est fermée. */
  collapsible?: boolean; summary?: ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const head = title && <div className="title-row"><h2>{title}</h2>{info && <InfoTip label={typeof title === 'string' ? title : 'Cette rubrique'}>{info}</InfoTip>}</div>;
  if (collapsible) {
    return (
      <details className={`section section-collapsible ${className}`} open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="section-head">{head}{!open && summary && <span className="section-summary muted small">{summary}</span>}{open && actions && <div className="row" onClick={(e) => e.preventDefault()}>{actions}</div>}</summary>
        {children}
      </details>
    );
  }
  return (
    <section className={`section ${className}`}>
      {(title || actions) && (
        <div className="section-head">
          {head}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatusBadge({ status }: { status: PropertyStatus }) {
  return <span className={`status status-${statusTone(status)}`}>{STATUS_LABELS[status]}</span>;
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'bad' }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  wide?: boolean;
  full?: boolean;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}
export function Field({ label, hint, error, wide, full, children }: FieldProps) {
  const id = useId();
  const descId = hint || error ? `${id}-desc` : undefined;
  // aide longue : point info à côté du libellé (le texte reste lu par les lecteurs d'écran)
  const longHint = typeof hint === 'string' && hint.length > 60;
  return (
    <div className={`field${wide ? ' field-wide' : ''}${full ? ' field-full' : ''}${error ? ' has-error' : ''}`}>
      <span className="field-label"><label htmlFor={id}>{label}</label>{longHint && <InfoTip label={label}>{hint}</InfoTip>}</span>
      {children(id, descId)}
      {error ? <small id={descId} className="field-error">{error}</small>
        : hint && (longHint ? <span id={descId} className="sr-only">{hint}</span> : <small id={descId} className="muted">{hint}</small>)}
    </div>
  );
}

export function TextInput({ label, value, onChange, type = 'text', required, hint, error, wide, full, placeholder, autoComplete, maxLength }: {
  label: string; value: string | null | undefined; onChange: (v: string) => void; type?: string; required?: boolean; hint?: ReactNode;
  error?: string; wide?: boolean; full?: boolean; placeholder?: string; autoComplete?: string; maxLength?: number;
}) {
  return (
    <Field label={required ? `${label} *` : label} hint={hint} error={error} wide={wide} full={full}>
      {(id, d) => <input id={id} aria-describedby={d} aria-invalid={!!error} type={type} value={value ?? ''} required={required}
        placeholder={placeholder} autoComplete={autoComplete} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

/** Saisie numérique tolérante (virgule ou point, espaces). Renvoie null si vide. */
export function NumberInput({ label, value, onChange, suffix, hint, error, step, wide, min }: {
  label: string; value: number | null | undefined; onChange: (v: number | null) => void; suffix?: string; hint?: ReactNode;
  error?: string; step?: string; wide?: boolean; min?: number;
}) {
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value).replace('.', ','));
  const last = useRef(value);
  // synchronisé avant l'affichage : une valeur proposée (ex. 80 % des charges) apparaît immédiatement
  useLayoutEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value === null || value === undefined ? '' : String(value).replace('.', ','));
    }
  }, [value]);
  return (
    <Field label={label} hint={hint} error={error} wide={wide}>
      {(id, d) => (
        <div className="input-suffix">
          <input id={id} aria-describedby={d} aria-invalid={!!error} inputMode="decimal" value={text} data-step={step} data-min={min}
            onChange={(e) => {
              const t = e.target.value;
              setText(t);
              const clean = t.replace(/[\s  ]/g, '').replace(',', '.');
              const n = clean === '' ? null : Number(clean);
              const v = n === null || Number.isNaN(n) ? (clean === '' ? null : Number.NaN) : n;
              last.current = v;
              onChange(v);
            }} />
          {suffix && <span aria-hidden="true">{suffix}</span>}
        </div>
      )}
    </Field>
  );
}

export function Select<V extends string>({ label, value, onChange, options, allowEmpty, hint, wide, error }: {
  label: string; value: V | null | undefined; onChange: (v: V | null) => void; options: readonly (readonly [V, string])[];
  allowEmpty?: string; hint?: ReactNode; wide?: boolean; error?: string;
}) {
  return (
    <Field label={label} hint={hint} wide={wide} error={error}>
      {(id, d) => (
        <select id={id} aria-describedby={d} value={value ?? ''} onChange={(e) => onChange((e.target.value || null) as V | null)}>
          {allowEmpty !== undefined && <option value="">{allowEmpty}</option>}
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      )}
    </Field>
  );
}

export function TextArea({ label, value, onChange, rows = 4, full = true, hint }: { label: string; value: string | null | undefined; onChange: (v: string) => void; rows?: number; full?: boolean; hint?: ReactNode }) {
  return (
    <Field label={label} full={full} hint={hint}>
      {(id, d) => <textarea id={id} aria-describedby={d} rows={rows} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

export function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Modal({ open, title, onClose, children, footer, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={titleId} className={`modal${wide ? ' modal-wide' : ''}`} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      {open && (
        <>
          <div className="modal-head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="icon-btn" aria-label="Fermer" onClick={onClose}>×</button>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

/** Demande de confirmation explicite avant une action irréversible. */
export function useConfirm() {
  const [req, setReq] = useState<{ title: string; message: ReactNode; confirm: string; danger: boolean; resolve: (ok: boolean) => void } | null>(null);
  const ask = (title: string, message: ReactNode, confirm = 'Confirmer', danger = true) =>
    new Promise<boolean>((resolve) => setReq({ title, message, confirm, danger, resolve }));
  const close = (ok: boolean) => { req?.resolve(ok); setReq(null); };
  const dialog = (
    <Modal open={!!req} title={req?.title ?? ''} onClose={() => close(false)}
      footer={<><Button onClick={() => close(false)}>Annuler</Button><Button variant={req?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{req?.confirm}</Button></>}>
      <div>{req?.message}</div>
    </Modal>
  );
  return { ask, dialog };
}

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v]) => (
        <div key={k}><dt>{k}</dt><dd>{v ?? '—'}</dd></div>
      ))}
    </dl>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, string][]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} className={value === k ? 'active' : ''} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

/** Signale une fonction prévue mais non disponible dans ce lot. */
export function NotAvailable({ children }: { children: ReactNode }) {
  return <p className="not-available" role="note">{children}</p>;
}
