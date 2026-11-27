import { NewsletterPrompt } from './NewsletterPrompt.tsx';
import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../data/store.tsx';
import { Button, Help, Modal } from './components.tsx';
import { href } from './router.ts';
import { AssistantButton } from './Assistant.tsx';
import { AccountMenu, AddMenu, BottomTabs, SearchButton } from './Shell.tsx';

export interface NavItem {
  key: string;
  label: string;
  path: string;
  /** Lot de livraison si la rubrique n'est pas encore disponible. */
  plannedLot?: 2 | 3;
  /** Visible des seuls administrateurs. */
  adminOnly?: boolean;
  /** Rubrique du menu. */
  group?: 'investir' | 'gerer' | 'papiers' | 'compte';
}

const GROUPS: [NonNullable<NavItem['group']>, string][] = [['investir', 'Investir'], ['gerer', 'Gérer'], ['papiers', 'Papiers'], ['compte', 'Compte']];

export const NAV: NavItem[] = [
  { key: 'dashboard', label: 'Tableau de bord', path: '/' },
  { key: 'prospection', label: 'Prospection', path: '/prospection', group: 'investir' },
  { key: 'biens', label: 'Mes biens', path: '/biens', group: 'gerer' },
  { key: 'locataires', label: 'Locataires et baux', path: '/locataires', group: 'gerer' },
  { key: 'loyers', label: 'Loyers et paiements', path: '/loyers', group: 'gerer' },
  { key: 'depenses', label: 'Dépenses', path: '/depenses', group: 'gerer' },
  { key: 'documents', label: 'Documents', path: '/documents', group: 'papiers' },
  { key: 'fiscal', label: 'Déclaration fiscale', path: '/declaration', group: 'papiers' },
  { key: 'contacts', label: 'Contacts', path: '/contacts', group: 'papiers' },
  { key: 'compte', label: 'Mon compte', path: '/compte', group: 'compte' },
  { key: 'parametres', label: 'Paramètres', path: '/parametres', group: 'compte' },
  { key: 'admin', label: 'Administration', path: '/admin', adminOnly: true, group: 'compte' },
];

export function Layout({ active, children }: { active: string; children: ReactNode }) {
  const { repo, toasts, dismissToast, conflict, sync, data, platform, portal } = useStore();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [active]);

  return (
    <div className="shell">
      {repo.mode === 'demo' && (
        <div className="demo-banner" role="status">
          Mode démonstration : les données restent dans ce navigateur, sans sauvegarde en ligne. Aucun e-mail ni paiement n’est envoyé.
        </div>
      )}
      {sync.state === 'offline' && <div className="offline-banner" role="status">{sync.message ?? 'Hors connexion.'}</div>}
      {data.missingTables.length > 0 && (
        <div className="offline-banner" role="alert">
          Mise à jour de la base requise : la gestion locative n’est pas encore installée dans Supabase. Exécutez la migration SQL du lot 2 (voir la documentation).
        </div>
      )}

      {platform && !platform.access.has_access && (
        <div className="offline-banner" role="alert">
          {platform.access.reason === 'decouverte_terminee'
            ? <>Votre offre Découverte de 30 jours est terminée : vos données restent consultables et exportables. Choisissez une formule pour continuer à les modifier. </>
            : <>Votre accès est en consultation seule (abonnement terminé ou absent) : vos données restent consultables et exportables. </>}
          <a href={href('/abonnement')}>Voir mon abonnement</a>
        </div>
      )}

      <header className="topbar">
        <button type="button" className="icon-btn nav-toggle" aria-expanded={open} aria-controls="main-nav" onClick={() => setOpen(!open)}>
          <span aria-hidden="true">☰</span><span className="sr-only">Menu</span>
        </button>
        <a href={href('/')} className="brand">
          <svg viewBox="0 0 32 32" aria-hidden="true" className="brand-mark"><path d="M4 17 16 6l12 11" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M9 26h14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"/><circle cx="16" cy="19" r="2.4" fill="currentColor"/></svg>
          <span>Immo-Zen</span>
        </a>
        <div className="topbar-right">
          <SearchButton />
          <AddMenu />
          <AssistantButton page={active} />
          <AccountMenu />
        </div>
      </header>

      <div className="body">
        <nav id="main-nav" className={`sidenav${open ? ' open' : ''}`} aria-label="Navigation principale">
          {[['', ''] as [string, string], ...GROUPS].map(([g, title]) => {
            const items = NAV.filter((n) => (n.group ?? '') === g && (!n.adminOnly || platform?.access.is_admin));
            if (!items.length && !(g === 'gerer' && portal?.accounts.length)) return null;
            return (
              <div key={g || 'accueil'} className={`nav-group${g === 'compte' && !items.some((n) => n.adminOnly) ? ' nav-mobile-only' : ''}`}>
                {title && <p className="nav-group-title">{g === 'compte' && items.some((n) => n.adminOnly) ? <><span className="nav-mobile-only">Compte</span><span className="nav-desktop-only">Administration</span></> : title}</p>}
                <ul>
                  {items.map((n) => (
                    <li key={n.key} className={n.group === 'compte' && !n.adminOnly ? 'nav-mobile-only' : undefined}>
                      <a href={href(n.path)} className={active === n.key ? 'active' : ''} aria-current={active === n.key ? 'page' : undefined}>
                        <span>{n.label}</span>
                        {n.plannedLot && <span className="soon" title={`Prévu au lot ${n.plannedLot}`}>lot {n.plannedLot}</span>}
                      </a>
                    </li>
                  ))}
                  {g === 'gerer' && !!portal?.accounts.length && <li><a href={href('/espace-locataire')}><span>Mon espace locataire</span></a></li>}
                </ul>
              </div>
            );
          })}
          <p className="tagline">Prospectez, investissez et gérez vos locations sereinement.</p>
        </nav>
        <main className="content" id="contenu"><NewsletterPrompt />{children}</main>
      </div>
      <BottomTabs active={active} />

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
            <span>{t.message}</span>
            {t.action && <button type="button" className="toast-action" onClick={() => { dismissToast(t.id); t.action!.run(); }}>{t.action.label}</button>}
            <button type="button" className="icon-btn" aria-label="Fermer" onClick={() => dismissToast(t.id)}>×</button>
          </div>
        ))}
      </div>

      <Modal open={!!conflict} title="Modification concurrente" onClose={() => conflict?.resolve('reload')}
        footer={<>
          <Button onClick={() => conflict?.resolve('reload')}>Recharger la version enregistrée</Button>
          <Button variant="danger" onClick={() => conflict?.resolve('overwrite')}>Remplacer par mes modifications</Button>
        </>}>
        <p>{conflict?.label} a été modifié depuis un autre appareil ou un autre onglet après son ouverture ici.</p>
        <p className="muted small">Rien n’a été écrasé. Choisissez de recharger la version enregistrée (vos modifications sont abandonnées) ou de la remplacer par la vôtre.</p>
      </Modal>
    </div>
  );
}
