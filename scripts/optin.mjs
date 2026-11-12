// Formulaires d'inscription du site (adresse e-mail + accord facultatif, non coché).
// Envoyés par site.js à la fonction publique iz_subscribe (voir supabase/migrations/20261112000100_inscriptions_site.sql).
// Règle : le service demandé (calcul, guide, checklist, alerte) ne dépend jamais de la case « conseils et offres ».

export const CONSENT_TEXT = 'J’accepte de recevoir les conseils et offres d’Immo-Zen par e-mail (environ un par mois, désinscription en un clic).';
const LETTER_CONSENT = 'J’accepte de recevoir la lettre Immo-Zen par e-mail (environ une par mois, désinscription en un clic).';
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const KINDS = {
  'calcul-cash-flow': { title: 'Recevoir ce calcul par e-mail', text: 'Le lien pour rouvrir votre simulation avec les mêmes valeurs.', button: 'Envoyer' },
  'calcul-plafond': { title: 'Recevoir ce calcul par e-mail', text: 'Le lien pour retrouver ce plafond, et si vous le souhaitez, une alerte quand les plafonds de Paris changent.', button: 'Envoyer', paris: true },
  'calcul-irl': { title: 'Recevoir ce calcul et un rappel chaque année', text: 'Le lien pour retrouver ce calcul, et si vous le souhaitez, un rappel le mois de révision de votre bail.', button: 'Envoyer', irl: true },
  'calcul-economies': { title: 'Recevoir cette estimation par e-mail', text: 'Le lien pour la retrouver avec vos chiffres.', button: 'Envoyer' },
  guide: { title: 'Guide gratuit : les 10 vérifications avant d’acheter un bien locatif', text: 'Deux pages à cocher avant de faire une offre : budget, prix réel, loyer, DPE, copropriété, cash-flow. PDF envoyé par e-mail.', button: 'Recevoir le guide', download: 'ressources/guide-10-verifications-avant-achat.pdf' },
  checklist: { title: 'Checklist gratuite de mise en location', text: 'Diagnostics, bail, dépôt de garantie, état des lieux, démarches après l’entrée du locataire : tout ce qu’il faut vérifier, en deux pages à imprimer.', button: 'Recevoir la checklist', download: 'ressources/checklist-mise-en-location.pdf' },
  lettre: { title: 'La lettre des propriétaires bailleurs', text: 'Une actualité, un calcul et un conseil, environ une fois par mois. Gratuit, désinscription en un clic.', button: 'M’inscrire' },
};

let n = 0;
/** @param {{ source: keyof typeof KINDS, prefix?: string, compact?: boolean, heading?: 'h2'|'h3' }} o */
export function optinForm({ source, prefix = '', compact = false, heading = 'h3' }) {
  const k = KINDS[source];
  if (!k) throw new Error(`Formulaire d’inscription inconnu : ${source}`);
  const id = `optin-${source}-${++n}`;
  const isLetter = source === 'lettre';
  const extra = [
    k.irl ? `<label class="optin-check"><input type="checkbox" name="irl"> Me rappeler chaque année la révision, en <select name="irl_month" aria-label="Mois de révision du bail">${MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('')}</select></label>` : '',
    k.paris ? '<label class="optin-check"><input type="checkbox" name="paris"> Me prévenir quand les plafonds de loyer de Paris changent</label>' : '',
  ].join('');
  return `<form class="optin${compact ? ' optin-compact' : ''}" data-source="${source}"${k.download ? ` data-download="${prefix}${k.download}"` : ''} novalidate>
          <${heading} class="optin-title">${k.title}</${heading}>
          <p class="optin-text">${k.text}</p>
          <div class="optin-row">
            <label class="sr-only" for="${id}">Adresse e-mail</label>
            <input id="${id}" type="email" name="email" autocomplete="email" placeholder="votre@adresse.fr" required>
            <button type="submit" class="btn btn-main">${k.button}</button>
          </div>
          ${extra}
          <label class="optin-check optin-consent"><input type="checkbox" name="marketing"${isLetter ? ' data-required' : ''}> <span>${isLetter ? LETTER_CONSENT : CONSENT_TEXT}</span></label>
          <input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
          <p class="form-msg" role="status" aria-live="polite"></p>
          <p class="optin-legal">${isLetter ? 'Un lien de confirmation vous est envoyé.' : 'Votre adresse sert à vous envoyer ce que vous demandez ; la case est facultative.'} <a href="${prefix}mentions-legales.html#confidentialite">Confidentialité</a></p>
        </form>`;
}
