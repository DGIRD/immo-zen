// Pages « Outils gratuits » du site vitrine : simulateur de cash-flow, plafond de loyer à Paris, révision IRL.
// Générées par scripts/guides.mjs (même en-tête, même pied de page). Le calcul est dans site/outils/outils.js.

const field = (label, name, value, unit, extra = '') =>
  `<label${extra}>${label}<span class="in"><input inputmode="decimal" name="${name}" value="${value}" autocomplete="off"><i>${unit}</i></span></label>`;
const select = (label, name, options, extra = '') =>
  `<label${extra}>${label}<span class="in"><select name="${name}"${extra.includes('id=') ? '' : ''}>${options}</select></span></label>`;
const opt = (pairs, selected) => pairs.map(([v, t]) => `<option value="${v}"${String(v) === String(selected) ? ' selected' : ''}>${t}</option>`).join('');
const row = (label, id) => `<div><dt>${label}</dt><dd id="${id}">—</dd></div>`;
const share = '<button type="button" class="btn-link" data-share>Copier le lien de cette simulation</button>';
const faq = (items) => items.map(([q, r]) => `<details><summary>${q}</summary><p>${r}</p></details>`).join('\n');

export const TOOLS = [
  {
    slug: 'simulateur-cash-flow',
    short: 'Simulateur de cash-flow',
    title: 'Simulateur de cash-flow locatif gratuit : crédit, charges, rendement',
    h1: 'Simulateur de cash-flow d’un investissement locatif',
    description: 'Calculez gratuitement le cash-flow mensuel d’un investissement locatif : mensualité du crédit, charges, vacance, rendement brut et net, capital remboursé. Sans inscription.',
    pitch: 'Ce que le bien vous coûte ou vous rapporte chaque mois, crédit et charges compris, avant impôts.',
    card: 'Mensualité, charges, vacance : le cash-flow mensuel et le rendement, en direct.',
    guides: [['cash-flow-investissement-locatif', 'Cash-flow positif ou négatif : quand l’accepter'], ['calculer-rentabilite-locative', 'Calculer la rentabilité : brut, net et net-net'], ['financer-investissement-locatif', 'Financer : apport, durée, taux d’endettement']],
    form: `<form class="calc tool-form" id="calc-cashflow" aria-labelledby="form-title">
          <h2 id="form-title">Le bien et son financement</h2>
          <div class="calc-grid">
            ${field('Prix d’achat (frais d’agence inclus)', 'prix', '180000', '€')}
            ${field('Frais de notaire', 'notaire', '7,5', '%')}
            ${field('Travaux', 'travaux', '5000', '€')}
            ${field('Apport', 'apport', '20000', '€')}
            ${field('Taux du crédit', 'taux', '3,4', '%')}
            ${select('Durée du crédit', 'duree', opt([[10, '10 ans'], [15, '15 ans'], [20, '20 ans'], [25, '25 ans']], 20))}
            ${field('Assurance emprunteur', 'assurance', '0,30', '% / an')}
          </div>
          <h2>Les loyers et les charges</h2>
          <div class="calc-grid">
            ${field('Loyer hors charges', 'loyer', '850', '€ / mois')}
            ${field('Vacance locative', 'vacance', '0,5', 'mois / an')}
            ${field('Taxe foncière', 'tf', '900', '€ / an')}
            ${field('Copropriété non récupérable', 'copro', '600', '€ / an')}
            ${field('Assurance propriétaire (PNO)', 'pno', '120', '€ / an')}
            ${field('Entretien et petits travaux', 'entretien', '300', '€ / an')}
            ${field('Gestion par une agence', 'gestion', '0', '% des loyers')}
          </div>
        </form>`,
    out: `<div class="tool-out" aria-live="polite">
          <p class="calc-label">Cash-flow mensuel, avant impôts</p>
          <p class="calc-figure" id="cf-result">—</p>
          <p class="calc-verdict" id="cf-verdict"></p>
          <dl class="tool-dl">
            ${row('Crédit et assurance', 'cf-credit')}
            ${row('Charges et vacance', 'cf-charges')}
            ${row('Montant emprunté', 'cf-emprunt')}
            ${row('Coût total de l’opération', 'cf-cout')}
            ${row('Rendement brut', 'cf-brut')}
            ${row('Rendement net de charges', 'cf-net')}
            ${row('Capital remboursé', 'cf-capital')}
            ${row('Enrichissement (cash-flow + capital)', 'cf-enrichi')}
          </dl>
          <div class="calc-cta">
            <p id="cf-cta-text"></p>
            <a class="btn btn-main" href="../app/">Essayer Immo-Zen gratuitement 30 jours</a>
          </div>
          ${share}
        </div>`,
    body: `<h2 id="methode">Comment le cash-flow est calculé</h2>
<p>Le cash-flow mensuel est ce qui reste chaque mois une fois le loyer encaissé et toutes les dépenses payées, crédit compris :</p>
<p class="formula">Cash-flow = (loyers encaissés − charges) ÷ 12 − mensualité du crédit − assurance emprunteur</p>
<ul>
<li><strong>Loyers encaissés</strong> : le loyer hors charges multiplié par les mois réellement loués (12 moins la vacance).</li>
<li><strong>Charges</strong> : taxe foncière, part non récupérable de la copropriété, assurance propriétaire non occupant, entretien, et frais de gestion si une agence gère le bien.</li>
<li><strong>Montant emprunté</strong> : prix + frais de notaire + travaux − apport.</li>
<li><strong>Capital remboursé</strong> : la part de vos mensualités qui réduit la dette. Elle n’est pas une dépense : c’est votre patrimoine qui augmente.</li>
</ul>
<p>Le résultat est calculé avant impôts : la fiscalité dépend du régime choisi (micro-foncier, réel, LMNP) et de votre taux d’imposition.</p>
<h2 id="lire">Bien lire le résultat</h2>
<p>Un cash-flow négatif n’est pas forcément un mauvais investissement : si l’effort mensuel est inférieur au capital remboursé, vous vous enrichissez quand même. La vraie question est de savoir si cet effort est supportable dans la durée, y compris en cas de vacance ou de travaux imprévus.</p>
<h2 id="faq">Questions fréquentes</h2>
${faq([
  ['Quel cash-flow viser pour un premier investissement ?', 'Il n’y a pas de seuil universel. Beaucoup d’investisseurs visent un cash-flow proche de zéro ou positif pour que le bien se finance seul ; d’autres acceptent un effort mensuel en échange d’un bien mieux placé. L’essentiel est que l’effort reste supportable même avec un mois de vacance.'],
  ['Pourquoi compter de la vacance locative ?', 'Entre deux locataires, le logement reste souvent vide quelques semaines. Prévoir un demi-mois à un mois par an évite de surestimer les loyers.'],
  ['Les charges récupérables doivent-elles être saisies ?', 'Non : les charges récupérables sont refacturées au locataire. Seule la part non récupérable de la copropriété reste à votre charge.'],
  ['Le calcul tient-il compte des impôts ?', 'Non, le résultat est avant impôts. Dans Immo-Zen, la simulation complète intègre le régime fiscal de chaque bien.'],
])}`,
  },
  {
    slug: 'plafond-loyer-paris',
    short: 'Plafond de loyer à Paris',
    title: 'Plafond de loyer à Paris 2026 : calcul par quartier (encadrement des loyers)',
    h1: 'Calcul du plafond de loyer à Paris',
    description: 'Calculez le loyer maximum autorisé à Paris selon le quartier, le nombre de pièces, l’époque de construction et la location vide ou meublée. Barème de l’arrêté du 12 juin 2026.',
    pitch: 'Le loyer de référence majoré de votre quartier, multiplié par la surface : le loyer hors charges à ne pas dépasser.',
    card: 'Quartier, pièces, époque, vide ou meublé : le loyer maximum autorisé.',
    guides: [['location-nue-ou-meublee-lmnp', 'Location nue ou meublée : quel régime choisir'], ['revision-loyer-irl', 'Révision du loyer avec l’IRL']],
    form: `<form class="calc tool-form" id="calc-plafond" aria-labelledby="form-title">
          <h2 id="form-title">Le logement</h2>
          <div class="calc-grid">
            <label>Arrondissement<span class="in"><select name="arr" id="pl-arr">${opt(Array.from({ length: 20 }, (_, i) => [i + 1, i === 0 ? '1er' : `${i + 1}e`]), 18)}</select></span></label>
            <label>Quartier<span class="in"><select name="quartier" id="pl-quartier"></select></span></label>
            ${select('Nombre de pièces', 'pieces', opt([[1, '1 pièce'], [2, '2 pièces'], [3, '3 pièces'], [4, '4 pièces et plus']], 2))}
            ${select('Construction', 'epoque', opt([[0, 'Avant 1946'], [1, '1946 à 1970'], [2, '1971 à 1990'], [3, 'Après 1990']], 0))}
            ${select('Location', 'type', opt([['vide', 'Vide'], ['meuble', 'Meublée']], 'meuble'))}
            ${field('Surface habitable', 'surface', '40', 'm²')}
            ${field('Loyer envisagé (facultatif)', 'loyer', '1300', '€ HC / mois', ' class="wide"')}
          </div>
          <p class="small">Le quartier administratif figure sur l’avis de taxe foncière ou sur la carte officielle de la Ville de Paris (loyers.paris.fr). Un doute sur l’époque de construction : retenez celle du permis de construire.</p>
        </form>`,
    out: `<div class="tool-out" aria-live="polite">
          <p class="calc-label">Loyer maximum hors charges</p>
          <p class="calc-figure" id="pl-result">—</p>
          <p class="calc-verdict" id="pl-verdict"></p>
          <dl class="tool-dl">
            ${row('Quartier', 'pl-quartier-nom')}
            ${row('Loyer de référence majoré', 'pl-maj-m2')}
            ${row('Loyer de référence', 'pl-ref-m2')}
            ${row('Loyer de référence minoré', 'pl-min-m2')}
            ${row('Loyer de référence × surface', 'pl-ref')}
            ${row('Loyer minoré × surface', 'pl-min')}
          </dl>
          <p class="tool-note">Barème de l’arrêté préfectoral du 12 juin 2026, applicable aux baux signés ou renouvelés du 1er juillet au 24 novembre 2026. Le Parlement examine une prolongation de deux ans de l’encadrement : cette page sera mise à jour dès sa publication.</p>
          <div class="calc-cta">
            <p>Immo-Zen vérifie le plafond pour chaque bien en zone encadrée, à côté du loyer de marché et de la simulation de rentabilité.</p>
            <a class="btn btn-main" href="../app/">Essayer Immo-Zen gratuitement 30 jours</a>
          </div>
          ${share}
        </div>`,
    script: 'plafonds-paris-2026.js',
    body: `<h2 id="regle">La règle à Paris</h2>
<p>À Paris, le loyer hors charges d’un logement loué vide ou meublé ne peut pas dépasser le <strong>loyer de référence majoré</strong> fixé chaque année par arrêté préfectoral, multiplié par la surface habitable. Il dépend de quatre critères :</p>
<ul>
<li>le quartier (80 quartiers regroupés en 14 secteurs) ;</li>
<li>le nombre de pièces principales (1, 2, 3, 4 et plus) ;</li>
<li>l’époque de construction (avant 1946, 1946 à 1970, 1971 à 1990, après 1990) ;</li>
<li>la location vide ou meublée.</li>
</ul>
<p class="formula">Loyer maximum = loyer de référence majoré (€/m²) × surface habitable (m²)</p>
<p>Le loyer de référence majoré vaut 120 % du loyer de référence, le loyer minoré 70 %. Le bail doit mentionner le loyer de référence et le loyer de référence majoré.</p>
<h2 id="complement">Le complément de loyer</h2>
<p>Un loyer au-dessus du plafond n’est possible qu’avec un complément de loyer, justifié par des caractéristiques de localisation ou de confort exceptionnelles par rapport aux logements comparables du quartier. Il doit être mentionné et justifié dans le bail, et le locataire peut le contester.</p>
<h2 id="faq">Questions fréquentes</h2>
${faq([
  ['L’encadrement des loyers continue-t-il après le 24 novembre 2026 ?', 'L’expérimentation prévue par la loi arrive à son terme le 24 novembre 2026. Une proposition de loi qui la prolonge de deux ans a été votée par le Sénat en octobre 2026 et doit être adoptée définitivement. Nous mettrons cette page à jour dès que le texte sera publié.'],
  ['Comment connaître le quartier de mon logement ?', 'Le quartier administratif figure sur l’avis de taxe foncière. La Ville de Paris propose aussi une carte des loyers de référence où l’on peut saisir l’adresse.'],
  ['Le plafond s’applique-t-il aux charges ?', 'Non : le plafond porte sur le loyer hors charges. Les charges récupérables ou le forfait de charges s’ajoutent.'],
  ['Que risque un bailleur qui dépasse le plafond ?', 'Le locataire peut demander la mise en conformité et le remboursement du trop-perçu, et le préfet peut prononcer une amende administrative.'],
])}`,
  },
  {
    slug: 'revision-loyer-irl',
    short: 'Révision de loyer (IRL)',
    title: 'Calcul de la révision de loyer avec l’IRL 2026 : nouveau loyer et lettre type',
    h1: 'Calcul de la révision de loyer (IRL)',
    description: 'Calculez le nouveau loyer après révision annuelle selon l’indice de référence des loyers (IRL) de l’INSEE, avec le dernier indice publié et une lettre type à envoyer au locataire.',
    pitch: 'Le nouveau loyer selon le dernier indice publié par l’INSEE, avec la lettre à envoyer à votre locataire.',
    card: 'Le nouveau loyer selon le dernier IRL publié, et la lettre au locataire.',
    guides: [['revision-loyer-irl', 'Révision du loyer : calcul, délais et lettre type'], ['regularisation-charges-locatives', 'Régularisation des charges locatives']],
    form: `<form class="calc tool-form" id="calc-irl" aria-labelledby="form-title">
          <h2 id="form-title">Le bail</h2>
          <div class="calc-grid">
            ${field('Loyer actuel hors charges', 'loyer', '850', '€ / mois')}
            ${select('Trimestre de référence du bail', 'trimestre', opt([[1, '1er trimestre'], [2, '2e trimestre'], [3, '3e trimestre'], [4, '4e trimestre']], 3))}
            <label class="wide">Date de la révision<span class="in"><input type="date" name="date" value=""></span></label>
            <label class="wide check"><input type="checkbox" name="dpe"> Le logement est classé F ou G au DPE</label>
          </div>
          <p class="small">Le trimestre de référence est indiqué dans le bail. À défaut, c’est celui du dernier indice publié à la date de signature.</p>
        </form>`,
    out: `<div class="tool-out" id="irl-out" aria-live="polite">
          <p class="calc-label">Nouveau loyer hors charges</p>
          <p class="calc-figure" id="irl-result">—</p>
          <p class="calc-verdict" id="irl-verdict"></p>
          <dl class="tool-dl">
            ${row('Hausse', 'irl-hausse')}
            ${row('Indices retenus', 'irl-indices')}
          </dl>
          <p class="calc-detail" id="irl-detail"></p>
          <label class="tool-letter">Lettre au locataire<textarea id="irl-lettre" rows="9" readonly></textarea></label>
          <button type="button" class="btn-link" id="irl-copier">Copier la lettre</button>
          <div class="calc-cta">
            <p>Dans Immo-Zen, la révision est proposée chaque année à la bonne date et le nouvel avis d’échéance est prêt.</p>
            <a class="btn btn-main" href="../app/">Essayer Immo-Zen gratuitement 30 jours</a>
          </div>
          ${share}
        </div>`,
    script: 'irl.js',
    body: `<h2 id="calcul">Le calcul</h2>
<p class="formula">Nouveau loyer = loyer actuel × IRL du trimestre de référence ÷ IRL du même trimestre un an plus tôt</p>
<p>L’indice retenu est le dernier publié par l’INSEE à la date de révision pour le trimestre mentionné au bail. L’INSEE publie l’IRL vers le 15 avril (1er trimestre), le 15 juillet (2e), le 15 octobre (3e) et le 15 janvier (4e).</p>
<h2 id="regles">Les règles à respecter</h2>
<ul>
<li>Le bail doit contenir une clause de révision ; la révision a lieu au plus une fois par an, à la date anniversaire ou à la date prévue au bail.</li>
<li>Elle n’est pas rétroactive : demandée après la date prévue, elle s’applique à la date de la demande. Le bailleur dispose d’un an pour la demander.</li>
<li>Un logement classé F ou G au DPE ne peut pas voir son loyer révisé (métropole, depuis le 24 août 2022).</li>
</ul>
<h2 id="faq">Questions fréquentes</h2>
${faq([
  ['Quel est le dernier IRL publié ?', '{{LAST_IRL}}'],
  ['Faut-il envoyer un courrier recommandé ?', 'Ce n’est pas obligatoire, mais un écrit (courrier ou courriel) daté permet de prouver la date de la demande, qui compte puisque la révision n’est pas rétroactive.'],
  ['Le locataire peut-il refuser la révision ?', 'Non, si le bail prévoit la clause de révision et que le calcul respecte l’IRL. Il peut en revanche contester un calcul erroné.'],
  ['Et en cas de travaux d’amélioration ?', 'Une majoration de loyer pour travaux est possible si le bail la prévoit, selon des règles distinctes de la révision annuelle.'],
])}`,
  },
];

const DISCLAIMER = (date) => `<p class="small disclaimer">Ce calcul donne une estimation à titre indicatif, à jour au ${date}. Vérifiez les règles applicables avec les textes officiels (service-public.fr, paris.fr, insee.fr) ou un professionnel avant de décider.</p>`;

export function toolPage(t, { site, dateFr, lastIrl }) {
  const canonical = `${site}/outils/${t.slug}.html`;
  const guides = t.guides.map(([s, l]) => `<li><a href="../guides/${s}.html"><span class="cat">Guide</span>${l}</a></li>`).join('');
  const others = TOOLS.filter((x) => x.slug !== t.slug).map((x) => `<li><a href="${x.slug}.html"><span class="cat">Outil</span>${x.short}</a></li>`).join('');
  const body = `    <div class="wrap tool">
      <nav class="breadcrumb" aria-label="Fil d'Ariane"><a href="../">Accueil</a> › <a href="./">Outils gratuits</a> › <span>${t.short}</span></nav>
      <h1>${t.h1}</h1>
      <p class="tool-pitch">${t.pitch} Gratuit, sans inscription.</p>
      <div class="tool-grid">
        ${t.form}
        ${t.out}
      </div>
      <div class="prose tool-prose">
${t.body.replace('{{LAST_IRL}}', lastIrl)}
        ${DISCLAIMER(dateFr)}
        <section class="related" aria-labelledby="related-title">
          <h2 id="related-title">Pour aller plus loin</h2>
          <ul>${guides}${others}</ul>
        </section>
      </div>
    </div>
    ${t.script ? `<script src="${t.script}" defer></script>` : ''}
    <script src="outils.js" defer></script>`;
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'WebApplication', name: t.short, description: t.description, url: canonical,
    applicationCategory: 'FinanceApplication', operatingSystem: 'Tous navigateurs', inLanguage: 'fr-FR',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    publisher: { '@type': 'Organization', name: 'Immo-Zen', url: site },
  };
  const qa = [...t.body.replace('{{LAST_IRL}}', lastIrl).matchAll(/<details><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)]
    .map(([, q, r]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: r } }));
  return { canonical, body, title: `${t.title} — Immo-Zen`, description: t.description, jsonld: [jsonld, { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: qa }] };
}

export function toolsIndex({ site }) {
  const canonical = `${site}/outils/`;
  const cards = TOOLS.map((t) => `<li><a href="${t.slug}.html"><span class="cat">Gratuit</span><strong>${t.short}</strong><span>${t.card}</span></a></li>`).join('\n          ');
  const body = `    <div class="wrap tool">
      <nav class="breadcrumb" aria-label="Fil d'Ariane"><a href="../">Accueil</a> › <span>Outils gratuits</span></nav>
      <h1>Outils gratuits pour investisseurs et bailleurs</h1>
      <p class="tool-pitch">Des calculettes sans inscription, issues des fonctions de l’application Immo-Zen.</p>
      <ul class="tool-cards">
          ${cards}
      </ul>
    </div>`;
  const jsonld = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Outils gratuits Immo-Zen', url: canonical, inLanguage: 'fr-FR' };
  return { canonical, body, title: 'Outils gratuits : cash-flow, plafond de loyer, révision IRL — Immo-Zen', description: 'Calculettes gratuites et sans inscription pour l’investissement locatif : simulateur de cash-flow, plafond de loyer à Paris, révision de loyer avec l’IRL.', jsonld };
}
