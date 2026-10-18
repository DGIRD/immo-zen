import type { ReactNode } from 'react';
import { href } from './router.ts';

/** Fonction non incluse dans la formule du compte : explication et lien vers « Mon abonnement ». */
export function PlanLock({ title, children, compact = false }: { title: string; children: ReactNode; compact?: boolean }) {
  return (
    <div className="locked" role="note">
      <h3>{title}</h3>
      <p className={compact ? 'small' : undefined}>{children}</p>
      <a className="btn btn-primary btn-sm" href={href('/abonnement')}>Voir les formules</a>
    </div>
  );
}
