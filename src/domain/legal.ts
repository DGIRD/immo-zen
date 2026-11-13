// Identité légale de l'éditeur, d'après l'extrait Kbis du 13/11/2026.
// Source unique pour l'application ; le site vitrine (site/mentions-legales.html) reprend les mêmes valeurs,
// vérifiées par tests/legal.test.ts.
export const EDITEUR = {
  denomination: 'Immo-Zen',
  forme: 'Société par actions simplifiée à associé unique (SASU)',
  capital: '500 €',
  siege: '110 rue de Fontenay, 94300 Vincennes',
  domiciliataire: 'Les Tricolores (RCS Paris 849 409 313)',
  siren: '132 762 634',
  rcs: 'RCS Créteil 132 762 634',
  tva: 'FR94132762634',
  president: 'DG Holding, SAS au capital de 1 000 € (RCS Créteil 132 015 025), représentée par David Girardeau',
  directeurPublication: 'David Girardeau',
  contact: 'contact@immo-zen.fr',
} as const;

/** Ligne courte pour les pieds de page : « Immo-Zen, SASU au capital de 500 € – RCS Créteil 132 762 634 ». */
export function editeurLine(): string {
  return `${EDITEUR.denomination}, SASU au capital de ${EDITEUR.capital} – ${EDITEUR.rcs}`;
}

/** Page des mentions légales du site vitrine, vue depuis l'application (servie sous /app/). */
export const MENTIONS_URL = '../mentions-legales.html';
