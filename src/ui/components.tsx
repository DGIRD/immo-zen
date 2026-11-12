import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { PropertyStatus } from '../data/types.ts';
import { STATUS_LABELS, statusTone } from '../domain/labels.ts';

export function Button({ variant = 'secondary', size, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' }) {
  return <button type="button" className={`btn btn-${variant}${size ? ' btn-sm' : ''} ${className}`} {...rest} />;
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Section({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`section ${className}`}>
      {(title || actions) && (
        <div className="section-head">
          {title && <h2>{title}</h2>}
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
  return (
    <div className={`field${wide ? ' field-wide' : ''}${full ? ' field-full' : ''}${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children(id, descId)}
      {(error || hint) && <small id={descId} className={error ? 'field-error' : 'muted'}>{error ?? hint}</small>}
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
