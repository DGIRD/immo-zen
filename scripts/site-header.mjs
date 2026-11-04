// En-tête unique du site vitrine (accueil, guides, mentions légales).
// Utilisé par scripts/guides.mjs, qui le réécrit aussi dans site/index.html et site/mentions-legales.html.
// Mêmes liens, même ordre et bouton « Espace client » toujours en haut à droite sur toutes les pages.

export const BRAND_SVG = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 17 16 6l12 11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 26h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><circle cx="16" cy="19" r="2.4" fill="currentColor"/></svg>`;

/** Rubriques de l'accueil (ancres) puis page des guides. */
export const NAV_LINKS = [
  { label: 'Pour qui', anchor: 'profils' },
  { label: 'Acheter', anchor: 'decider' },
  { label: 'Gérer', anchor: 'gerer' },
  { label: 'Déclarer', anchor: 'declarer' },
  { label: 'Tarifs', anchor: 'tarifs' },
  { label: 'Guides', page: 'guides/' },
];

/**
 * @param {{ prefix?: string, home?: boolean, current?: 'guides' | null }} o
 *   prefix : chemin vers la racine du site ('' ou '../') ; home : page d'accueil (ancres locales) ;
 *   current : rubrique de la page affichée (lien marqué aria-current="page").
 */
export function siteHeader({ prefix = '', home = false, current = null } = {}) {
  const links = NAV_LINKS.map((l) => {
    const href = l.page ? `${prefix}${l.page}` : home ? `#${l.anchor}` : `${prefix}#${l.anchor}`;
    const isCurrent = l.page && current === 'guides';
    return `<a href="${href}"${isCurrent ? ' aria-current="page"' : ''}>${l.label}</a>`;
  }).join('\n        ');
  return `<header class="top">
    <div class="wrap top-in">
      <a class="brand" href="${prefix || './'}" aria-label="Immo-Zen, accueil">
        ${BRAND_SVG}
        Immo-Zen
      </a>
      <nav id="nav" class="site-nav" aria-label="Navigation du site">
        ${links}
      </nav>
      <div class="top-actions">
        <button class="menu-btn" type="button" aria-expanded="false" aria-controls="nav">Menu</button>
        <a class="btn btn-espace" href="${prefix}app/">Espace client</a>
      </div>
    </div>
  </header>`;
}
