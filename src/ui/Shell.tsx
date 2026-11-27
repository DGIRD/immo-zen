/**
 * Éléments de navigation de l'application : menu du compte (thème, installation, déconnexion), bouton « + Ajouter »,
 * recherche globale (Ctrl+K) et barre d'onglets en bas de l'écran sur téléphone.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../data/store.tsx';
import { date, dateTime, money } from '../domain/format.ts';
import { href, navigate } from './router.ts';

/* ---------- thème ---------- */
export type ThemeChoice = 'auto' | 'clair' | 'sombre';
const THEME_KEY = 'immozen:theme';
export function readTheme(): ThemeChoice {
  try { const v = localStorage.getItem(THEME_KEY); return v === 'clair' || v === 'sombre' ? v : 'auto'; } catch { return 'auto'; }
}
/** Applique le thème choisi (attribut data-theme sur <html>) ; « auto » suit le réglage de l'appareil. */
export function applyTheme(t: ThemeChoice) {
  const root = document.documentElement;
  if (t === 'auto') delete root.dataset.theme; else root.dataset.theme = t === 'sombre' ? 'dark' : 'light';
  const dark = t === 'sombre' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#121a19' : '#1f4a45');
}
function useTheme(): [ThemeChoice, (t: ThemeChoice) => void] {
  const [t, setT] = useState<ThemeChoice>(readTheme);
  return [t, (v) => { setT(v); try { localStorage.setItem(THEME_KEY, v); } catch { /* facultatif */ } applyTheme(v); }];
}

/* ---------- installation (application sur l'écran d'accueil) ---------- */
interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferredInstall: InstallEvent | null = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e as InstallEvent; });
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

/* ---------- menus déroulants ---------- */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    addEventListener('mousedown', click); addEventListener('keydown', key);
    return () => { removeEventListener('mousedown', click); removeEventListener('keydown', key); };
  }, [open, close]);
  return ref;
}

export const ADD_ACTIONS: [string, string, string][] = [
  ['Paiement de loyer', '/loyers?ajout=paiement', 'Loyer reçu d’un locataire'],
  ['Dépense', '/depenses?ajout=depense', 'Facture, taxe, travaux…'],
  ['Bien détenu', '/bien/nouveau?mode=owned', 'Un logement que vous possédez'],
  ['Bien en prospection', '/bien/nouveau', 'Une annonce à étudier'],
  ['Bail et locataire', '/baux/nouveau', 'Nouveau locataire dans un bien'],
  ['Document', '/documents?ajout=document', 'Justificatif, diagnostic, contrat…'],
  ['Contact', '/contacts/nouveau', 'Agence, artisan, notaire…'],
];

export function AddMenu({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div className="menu add-menu" ref={ref}>
      <button type="button" className={`btn btn-primary btn-sm add-toggle${compact ? ' add-compact' : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span aria-hidden="true">+</span><span className="add-label"> Nouveau</span>
      </button>
      {open && (
        <div className="menu-list add-list" role="menu">
          {ADD_ACTIONS.map(([label, to, hint]) => (
            <a key={to} role="menuitem" href={href(to)} onClick={() => setOpen(false)}><strong>{label}</strong><span className="muted small">{hint}</span></a>
          ))}
        </div>
      )}
    </div>
  );
}

export function AccountMenu() {
  const { session, signOut, sync, refresh, repo } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const [theme, setTheme] = useTheme();
  const [canInstall, setCanInstall] = useState(() => !!deferredInstall);
  useEffect(() => {
    const on = () => setCanInstall(true);
    addEventListener('beforeinstallprompt', on);
    return () => removeEventListener('beforeinstallprompt', on);
  }, []);
  const [iosHelp, setIosHelp] = useState(false);
  const email = session?.email ?? '';
  const initial = (email.trim()[0] ?? '?').toUpperCase();
  const syncLabel = { loading: 'Synchronisation…', saving: 'Enregistrement…', synced: repo.mode === 'demo' ? 'Enregistré dans ce navigateur' : 'Synchronisé', offline: 'Hors connexion', error: 'Erreur de synchronisation' }[sync.state];
  const go = (to: string) => { setOpen(false); navigate(to); };
  return (
    <div className="menu account-menu" ref={ref}>
      <button type="button" className="account-toggle" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title={`Mon compte (${email})`}>
        <span className={`avatar sync-${sync.state}`} aria-hidden="true">{initial}</span>
        <span className="account-email">{email}</span>
        <span className="sr-only">Mon compte</span>
      </button>
      {open && (
        <div className="menu-list account-list" role="menu">
          <div className="account-head"><strong>{email}</strong>
            <button type="button" className={`sync sync-${sync.state}`} onClick={() => void refresh()} title={sync.lastSync ? `Dernière synchronisation ${dateTime(sync.lastSync)}. Cliquer pour resynchroniser.` : 'Cliquer pour resynchroniser.'}>
              <span className="sync-dot" aria-hidden="true" /><span>{syncLabel}</span>
            </button>
          </div>
          <button type="button" role="menuitem" onClick={() => go('/compte')}>Mon compte</button>
          <button type="button" role="menuitem" onClick={() => go('/abonnement')}>Abonnement</button>
          <button type="button" role="menuitem" onClick={() => go('/parametres')}>Paramètres</button>
          <div className="account-theme" role="group" aria-label="Thème">
            <span className="muted small">Thème</span>
            <span className="period-toggle">
              {([['auto', 'Auto'], ['clair', 'Clair'], ['sombre', 'Sombre']] as [ThemeChoice, string][]).map(([k, l]) => (
                <button key={k} type="button" aria-pressed={theme === k} className={theme === k ? 'on' : ''} onClick={() => setTheme(k)}>{l}</button>
              ))}
            </span>
          </div>
          {!standalone() && (canInstall || isIos()) && (
            <button type="button" role="menuitem" onClick={async () => {
              if (deferredInstall) { await deferredInstall.prompt(); deferredInstall = null; setCanInstall(false); setOpen(false); } else setIosHelp((x) => !x);
            }}>Installer l’application</button>
          )}
          {iosHelp && <p className="muted small account-ios">Sur iPhone : touchez le bouton Partager de Safari, puis « Sur l’écran d’accueil ».</p>}
          <button type="button" role="menuitem" className="account-signout" onClick={() => { setOpen(false); void signOut(); }}>Déconnexion</button>
        </div>
      )}
    </div>
  );
}

/* ---------- barre d'onglets (téléphone) ---------- */
const TABS: [string, string, string, ReactNode][] = [
  ['dashboard', 'Accueil', '/', <path key="a" d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />],
  ['biens', 'Biens', '/biens', <path key="b" d="M4 20V9l8-5 8 5v11M9 20v-6h6v6" />],
  ['loyers', 'Loyers', '/loyers', <path key="c" d="M4 7h16v10H4zM4 10h16M8 14h3" />],
  ['depenses', 'Dépenses', '/depenses', <path key="d" d="M7 4h10v16l-2.5-1.5L12 20l-2.5-1.5L7 20zM9.5 9h5M9.5 12.5h5" />],
];
export function BottomTabs({ active }: { active: string }) {
  const [adding, setAdding] = useState(false);
  const ref = useDismiss(adding, () => setAdding(false));
  const tab = ([key, label, to, icon]: (typeof TABS)[number]) => (
    <a key={key} href={href(to)} className={active === key ? 'on' : ''} aria-current={active === key ? 'page' : undefined}>
      <svg viewBox="0 0 24 24" aria-hidden="true">{icon}</svg><span>{label}</span>
    </a>
  );
  return (
    <nav className="bottom-tabs" aria-label="Navigation rapide">
      {TABS.slice(0, 2).map(tab)}
      <div className="bottom-add" ref={ref}>
        <button type="button" aria-haspopup="menu" aria-expanded={adding} onClick={() => setAdding(!adding)} aria-label="Nouveau"><span aria-hidden="true">+</span></button>
        {adding && (
          <div className="menu-list add-list bottom-add-list" role="menu">
            {ADD_ACTIONS.map(([label, to]) => <a key={to} role="menuitem" href={href(to)} onClick={() => setAdding(false)}>{label}</a>)}
          </div>
        )}
      </div>
      {TABS.slice(2).map(tab)}
    </nav>
  );
}

/* ---------- recherche globale ---------- */
interface Hit { kind: string; label: string; detail?: string; to: string }
const norm = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function useSearchIndex(): Hit[] {
  const { data } = useStore();
  return useMemo(() => {
    const prop = (id: string | null | undefined) => data.properties.find((p) => p.id === id)?.title ?? '';
    const leaseOf = (tenantId: string) => {
      const links = data.leaseTenants.filter((lt) => lt.tenant_id === tenantId);
      return (links.find((lt) => !lt.left_on) ?? links[0])?.lease_id;
    };
    const hits: Hit[] = [];
    for (const p of data.properties) hits.push({ kind: p.status === 'acquis' ? 'Bien' : 'Prospection', label: p.title, detail: [p.address, p.city].filter(Boolean).join(', '), to: `/bien/${p.id}` });
    for (const t of data.tenants) {
      const lid = leaseOf(t.id);
      const l = data.leases.find((x) => x.id === lid);
      hits.push({ kind: 'Locataire', label: [t.first_name, t.last_name].filter(Boolean).join(' '), detail: [t.email, l ? prop(l.property_id) : ''].filter(Boolean).join(' · '), to: lid ? `/baux/${lid}` : '/locataires?onglet=locataires' });
    }
    for (const l of data.leases) hits.push({ kind: 'Bail', label: `${prop(l.property_id)}${l.label ? ` – ${l.label}` : ''}`, detail: `depuis le ${date(l.start_date)} · ${money(l.rent_hc + l.charges_amount)} / mois`, to: `/baux/${l.id}` });
    for (const c of data.contacts) if (!c.archived_at) hits.push({ kind: 'Contact', label: c.name, detail: [c.organization_name, c.email].filter(Boolean).join(' · '), to: `/contacts/${c.id}` });
    for (const r of data.receipts) if (!r.cancelled_at) hits.push({ kind: r.kind === 'quittance' ? 'Quittance' : 'Reçu', label: r.number, detail: `${date(r.period_start)} · ${money(r.paid_amount)}`, to: `/baux/${r.lease_id}` });
    for (const e of data.expenses) hits.push({ kind: 'Dépense', label: e.label || 'Dépense', detail: `${date(e.expense_date)} · ${money(e.amount)} · ${prop(e.property_id)}`, to: `/depenses?bien=${e.property_id}` });
    for (const d of data.documents) hits.push({ kind: 'Document', label: d.title, detail: prop(d.property_id), to: '/documents' });
    return hits;
  }, [data]);
}

export function searchHits(index: Hit[], q: string, limit = 12): Hit[] {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return index
    .map((h) => ({ h, text: norm(`${h.label} ${h.detail ?? ''} ${h.kind}`), label: norm(h.label) }))
    .filter((x) => words.every((w) => x.text.includes(w)))
    .sort((a, b) => Number(!a.label.startsWith(words[0]!)) - Number(!b.label.startsWith(words[0]!)))
    .slice(0, limit)
    .map((x) => x.h);
}

export function SearchButton() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true); } };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
  const mac = /mac|iphone|ipad/i.test(navigator.platform);
  return (
    <>
      <button type="button" className="search-toggle" onClick={() => setOpen(true)} aria-label="Rechercher">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
        <span className="search-label">Rechercher</span><kbd className="search-kbd">{mac ? '⌘' : 'Ctrl'} K</kbd>
      </button>
      {open && <SearchDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const index = useSearchIndex();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const hits = searchHits(index, q);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const open = (h?: Hit) => { if (!h) return; onClose(); navigate(h.to); };
  return (
    <div className="search-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="search-box" role="dialog" aria-modal="true" aria-label="Rechercher">
        <input ref={input} type="search" value={q} placeholder="Bien, locataire, quittance, dépense, contact…" aria-label="Rechercher"
          aria-controls="search-results" aria-activedescendant={hits[sel] ? `hit-${sel}` : undefined}
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            else if (e.key === 'Enter') open(hits[sel]);
          }} />
        <ul id="search-results" role="listbox" className="search-results">
          {hits.map((h, i) => (
            <li key={`${h.kind}${h.to}${i}`} id={`hit-${i}`} role="option" aria-selected={i === sel} className={i === sel ? 'on' : ''}
              onMouseEnter={() => setSel(i)} onClick={() => open(h)}>
              <span className="search-kind">{h.kind}</span><span className="search-text"><strong>{h.label}</strong>{h.detail && <span className="muted small">{h.detail}</span>}</span>
            </li>
          ))}
          {q.trim() && hits.length === 0 && <li className="muted search-none">Aucun résultat pour « {q.trim()} ».</li>}
          {!q.trim() && <li className="muted search-none">Tapez un nom, une adresse, un numéro de quittance… Entrée pour ouvrir, Échap pour fermer.</li>}
        </ul>
      </div>
    </div>
  );
}
