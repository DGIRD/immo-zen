// Génère les guides du site vitrine (site/guides/*.html) à partir de content/guides/*.html.
// Chaque source commence par un commentaire d'en-tête (slug, title, short, description,
// category, related, cta), suivi du corps de l'article en HTML.
// Usage : npm run guides
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'content/guides');
const outDir = join(root, 'site/guides');
const SITE = 'https://immo-zen.fr';
const DATE = '2026-10-20';
const DATE_FR = '20 octobre 2026';
const CATEGORIES = ['Investir', 'Financer et déclarer', 'Gérer'];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');

function parse(file) {
  const raw = readFileSync(join(srcDir, file), 'utf8');
  const m = raw.match(/^<!--([\s\S]*?)-->\s*/);
  if (!m) throw new Error(`${file} : en-tête manquant`);
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  for (const k of ['slug', 'title', 'short', 'description', 'category', 'cta']) if (!meta[k]) throw new Error(`${file} : « ${k} » manquant`);
  if (!CATEGORIES.includes(meta.category)) throw new Error(`${file} : catégorie inconnue ${meta.category}`);
  meta.related = (meta.related ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  meta.body = raw.slice(m[0].length);
  meta.words = strip(meta.body).split(/\s+/).filter(Boolean).length;
  meta.minutes = Math.max(3, Math.round(meta.words / 220));
  meta.lead = strip(meta.body.match(/<p class="lead">([\s\S]*?)<\/p>/)?.[1] ?? meta.description).replace(/\s+/g, ' ').trim();
  return meta;
}

/** Espaces insécables avant € et %, tableaux défilants sur mobile. */
function polish(html) {
  return html
    .replace(/(\d) €/g, '$1&nbsp;€')
    .replace(/(\d) %/g, '$1&nbsp;%')
    .replace(/(\d) (\d{3})(?!\d)/g, '$1&nbsp;$2')
    .replace(/<table>/g, '<div class="table-scroll"><table>')
    .replace(/<\/table>/g, '</table></div>');
}

const BRAND = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 17 16 6l12 11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 26h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><circle cx="16" cy="19" r="2.4" fill="currentColor"/></svg>`;

function shell({ title, description, canonical, body, jsonld, prefix }) {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:locale" content="fr_FR">
  <meta property="og:site_name" content="Immo-Zen">
  <meta name="theme-color" content="#1F4A45">
  <link rel="icon" href="${prefix}icon-192.png">
  <link rel="stylesheet" href="${prefix}site.css">
  <script type="application/ld+json">${JSON.stringify(jsonld)}</script>
</head>
<body>
  <a class="skip" href="#contenu">Aller au contenu</a>
  <header class="top">
    <div class="wrap top-in">
      <a class="brand" href="${prefix}" aria-label="Immo-Zen, accueil">
        ${BRAND}
        Immo-Zen
      </a>
      <nav class="nav-simple" aria-label="Navigation du site"><a href="${prefix}guides/">Guides</a><a class="hide-sm" href="${prefix}#tarifs">Tarifs</a><a class="btn btn-espace" href="${prefix}app/">Espace client</a></nav>
    </div>
  </header>
  <main id="contenu" class="page">
${body}
  </main>
  <footer class="foot">
    <div class="wrap foot-in">
      <p>© 2026 Immo-Zen</p>
      <nav aria-label="Liens du site"><a href="${prefix}">Accueil</a><a href="${prefix}guides/">Guides</a><a href="${prefix}mentions-legales.html">Mentions légales</a><a href="mailto:contact@immo-zen.fr">contact@immo-zen.fr</a></nav>
    </div>
  </footer>
</body>
</html>
`;
}

const DISCLAIMER = `<p class="small disclaimer">Ce guide donne des repères généraux, à jour au ${DATE_FR}. Les règles fiscales et juridiques évoluent : vérifiez-les avec les notices officielles (impots.gouv.fr, service-public.fr) ou un professionnel avant de décider. Les exemples chiffrés reposent sur des hypothèses d'illustration.</p>`;

function articlePage(a, all) {
  const toc = [...a.body.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)].map(([, id, t]) => `<li><a href="#${id}">${t}</a></li>`).join('');
  const related = a.related.map((s) => {
    const r = all.find((x) => x.slug === s);
    if (!r) throw new Error(`${a.slug} : guide lié inconnu ${s}`);
    return `<li><a href="${r.slug}.html"><span class="cat">${esc(r.category)}</span>${esc(r.short)}</a></li>`;
  }).join('');
  for (const [, href] of a.body.matchAll(/href="([a-z0-9-]+)\.html(?:#[^"]*)?"/g)) {
    if (!all.some((x) => x.slug === href)) throw new Error(`${a.slug} : lien interne cassé ${href}.html`);
  }
  const canonical = `${SITE}/guides/${a.slug}.html`;
  const body = `    <article class="wrap article">
      <nav class="breadcrumb" aria-label="Fil d'Ariane"><a href="../">Accueil</a> › <a href="./">Guides</a> › <span>${esc(a.category)}</span></nav>
      <h1>${esc(a.title)}</h1>
      <p class="meta">Mis à jour le ${DATE_FR} · Lecture : ${a.minutes} min</p>
      <div class="article-grid">
        <aside class="toc" aria-label="Sommaire"><p class="toc-title">Sommaire</p><ol>${toc}</ol></aside>
        <div class="prose">
${polish(a.body)}
          <div class="cta">
            <p>${esc(a.cta)}</p>
            <a class="btn btn-main" href="../app/">Essayer Immo-Zen gratuitement</a>
          </div>
          ${DISCLAIMER}
          <section class="related" aria-labelledby="related-title">
            <h2 id="related-title">À lire aussi</h2>
            <ul>${related}</ul>
          </section>
        </div>
      </div>
    </article>`;
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'Article', headline: a.title, description: a.description,
    inLanguage: 'fr-FR', datePublished: DATE, dateModified: DATE, mainEntityOfPage: canonical, articleSection: a.category,
    author: { '@type': 'Organization', name: 'Immo-Zen', url: SITE },
    publisher: { '@type': 'Organization', name: 'Immo-Zen', url: SITE, logo: { '@type': 'ImageObject', url: `${SITE}/icon-512.png` } },
  };
  const faq = [...a.body.matchAll(/<details>\s*<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>\s*<\/details>/g)]
    .map(([, q, r]) => ({ '@type': 'Question', name: strip(q).replace(/\s+/g, ' ').trim(), acceptedAnswer: { '@type': 'Answer', text: strip(r).replace(/\s+/g, ' ').trim() } }));
  const graph = faq.length ? [jsonld, { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq }] : jsonld;
  return shell({ title: `${a.title} — Guides Immo-Zen`, description: a.description, canonical, body, jsonld: graph, prefix: '../' });
}

function indexPage(all) {
  const groups = CATEGORIES.map((c) => {
    const items = all.filter((a) => a.category === c).map((a) => `
          <li class="guide-card"><a href="${a.slug}.html"><h3>${esc(a.short)}</h3><p>${esc(a.description)}</p><span class="small">Lecture : ${a.minutes} min</span></a></li>`).join('');
    return `
      <section class="guide-group" aria-labelledby="g-${c.replace(/\W+/g, '-').toLowerCase()}">
        <h2 id="g-${c.replace(/\W+/g, '-').toLowerCase()}">${esc(c)}</h2>
        <ul class="guide-list">${items}
        </ul>
      </section>`;
  }).join('');
  const body = `    <div class="wrap">
      <nav class="breadcrumb" aria-label="Fil d'Ariane"><a href="../">Accueil</a> › <span>Guides</span></nav>
      <h1>Guides de l'investissement locatif</h1>
      <p class="lead">Onze guides complets pour investir, financer, déclarer et gérer un bien locatif : méthodes, exemples chiffrés sur un même bien, règles en vigueur en 2026 et modèles à réutiliser.</p>${groups}
      ${DISCLAIMER}
    </div>`;
  const jsonld = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: "Guides de l'investissement locatif", inLanguage: 'fr-FR', url: `${SITE}/guides/`,
    hasPart: all.map((a) => ({ '@type': 'Article', headline: a.title, url: `${SITE}/guides/${a.slug}.html` })) };
  return shell({ title: "Guides de l'investissement locatif — Immo-Zen", description: 'Onze guides complets et chiffrés : premier investissement, rentabilité, cash-flow, crédit, fiscalité nue ou meublée, déclaration 2044, quittance, révision IRL, charges, gestion.', canonical: `${SITE}/guides/`, body, jsonld, prefix: '../' });
}

const all = readdirSync(srcDir).filter((f) => f.endsWith('.html')).sort().map(parse);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const a of all) writeFileSync(join(outDir, `${a.slug}.html`), articlePage(a, all));
writeFileSync(join(outDir, 'index.html'), indexPage(all));

// Plan du site pour les moteurs de recherche.
const urls = [`${SITE}/`, `${SITE}/guides/`, ...all.map((a) => `${SITE}/guides/${a.slug}.html`), `${SITE}/mentions-legales.html`];
writeFileSync(join(root, 'site/sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${DATE}</lastmod></url>`).join('\n')}\n</urlset>\n`);
writeFileSync(join(root, 'site/robots.txt'), `User-agent: *\nDisallow: /app/\nSitemap: ${SITE}/sitemap.xml\n`);

for (const a of all) console.log(`${a.slug.padEnd(40)} ${String(a.words).padStart(5)} mots  ${a.minutes} min`);
console.log(`${all.length} guides générés dans site/guides/`);
