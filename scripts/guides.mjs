// Génère les guides du site vitrine (site/guides/*.html) à partir de content/guides/*.html.
// Chaque source commence par un commentaire d'en-tête (slug, title, short, description,
// category, related, cta), suivi du corps de l'article en HTML.
// Usage : npm run guides
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND_SVG, siteHeader } from './site-header.mjs';
import { TOOLS, toolPage, toolsIndex } from './outils.mjs';
import { optinForm } from './optin.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'content/guides');
const outDir = join(root, 'site/guides');
const SITE = 'https://immo-zen.fr';
const DATE = '2026-10-20';
const DATE_FR = '20 octobre 2026';
/** Dernière modification des pages pour le plan du site. */
const SITEMAP_LASTMOD = '2026-11-20';
const CATEGORIES = ['Investir', 'Financer et déclarer', 'Gérer'];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');

function parse(file, dir = srcDir, kind = 'guide') {
  const raw = readFileSync(join(dir, file), 'utf8');
  const m = raw.match(/^<!--([\s\S]*?)-->\s*/);
  if (!m) throw new Error(`${file} : en-tête manquant`);
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const required = kind === 'guide' ? ['slug', 'title', 'short', 'description', 'category', 'cta'] : ['slug', 'title', 'short', 'description', 'tag', 'date', 'cta'];
  for (const k of required) if (!meta[k]) throw new Error(`${file} : « ${k} » manquant`);
  if (kind === 'guide' && !CATEGORIES.includes(meta.category)) throw new Error(`${file} : catégorie inconnue ${meta.category}`);
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

const BRAND = BRAND_SVG;

function shell({ title, description, canonical, body, jsonld, prefix, current = 'guides', ogType = 'article' }) {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="${ogType}">
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
<body data-supabase-url="%IMMOZEN_SUPABASE_URL%" data-supabase-key="%IMMOZEN_SUPABASE_ANON_KEY%">
  <a class="skip" href="#contenu">Aller au contenu</a>
  ${siteHeader({ prefix, current })}
  <main id="contenu" class="page">
${body}
  </main>
  <footer class="foot">
    <div class="wrap foot-in">
      <p>© 2026 Immo-Zen</p>
      <nav aria-label="Liens du site"><a href="${prefix}">Accueil</a><a href="${prefix}outils/">Outils gratuits</a><a href="${prefix}guides/">Guides</a><a href="${prefix}actualites/">Actualités</a><a href="${prefix}mentions-legales.html">Mentions légales</a><a href="${prefix}conditions-generales.html">Conditions générales</a><a href="mailto:contact@immo-zen.fr">contact@immo-zen.fr</a></nav>
    </div>
  </footer>
  <script src="${prefix}site.js" defer></script>
</body>
</html>
`;
}

const DISCLAIMER = `<p class="small disclaimer">Ce guide donne des repères généraux, à jour au ${DATE_FR}. Les règles fiscales et juridiques évoluent : vérifiez-les avec les notices officielles (impots.gouv.fr, service-public.fr) ou un professionnel avant de décider. Les exemples chiffrés reposent sur des hypothèses d'illustration.</p>`;

const TOOL_FOR = {
  'cash-flow-investissement-locatif': 'simulateur-cash-flow',
  'calculer-rentabilite-locative': 'calcul-rentabilite-locative',
  'financer-investissement-locatif': 'simulateur-cash-flow',
  'premier-investissement-locatif': 'simulateur-cash-flow',
  'revision-loyer-irl': 'revision-loyer-irl',
};

function articlePage(a, all) {
  const tool = TOOLS.find((t) => t.slug === TOOL_FOR[a.slug]);
  const toolBox = tool ? `<p class="tool-link"><span class="cat">Outil gratuit</span><a href="../outils/${tool.slug}.html">${esc(tool.short)}</a> : ${esc(tool.card)}</p>` : '';
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
          ${toolBox}
          <div class="cta">
            <p>${esc(a.cta)}</p>
            <a class="btn btn-main" href="../app/">Essayer Immo-Zen gratuitement</a>
          </div>
          ${optinForm({ source: a.category === 'Gérer' ? 'checklist' : 'guide', prefix: '../' })}
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
      <p class="lead">Quatorze guides complets pour investir, financer, déclarer et gérer un bien locatif : méthodes, exemples chiffrés sur un même bien, règles en vigueur en 2026 et modèles à réutiliser.</p>${groups}
      <div class="optin-pair">
        ${optinForm({ source: 'guide', prefix: '../' })}
        ${optinForm({ source: 'checklist', prefix: '../' })}
      </div>
      ${optinForm({ source: 'lettre', prefix: '../' })}
      ${DISCLAIMER}
    </div>`;
  const jsonld = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: "Guides de l'investissement locatif", inLanguage: 'fr-FR', url: `${SITE}/guides/`,
    hasPart: all.map((a) => ({ '@type': 'Article', headline: a.title, url: `${SITE}/guides/${a.slug}.html` })) };
  return shell({ title: "Guides de l'investissement locatif — Immo-Zen", description: 'Quatorze guides complets et chiffrés : premier investissement, SCI à l’IS, rentabilité, cash-flow, crédit, fiscalité nue ou meublée, déclaration 2044, liasse LMNP, quittance, révision IRL, charges, impayés, gestion.', canonical: `${SITE}/guides/`, body, jsonld, prefix: '../' });
}

const all = readdirSync(srcDir).filter((f) => f.endsWith('.html')).sort().map((f) => parse(f));
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const a of all) writeFileSync(join(outDir, `${a.slug}.html`), articlePage(a, all));
writeFileSync(join(outDir, 'index.html'), indexPage(all));

// Actualités : articles datés (content/actualites/*.html), du plus récent au plus ancien.
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const dateFr = (d) => { const [y, m, j] = d.split('-').map(Number); return `${j === 1 ? '1er' : j} ${MOIS[m - 1]} ${y}`; };
const newsSrc = join(root, 'content/actualites');
const newsOut = join(root, 'site/actualites');
const news = readdirSync(newsSrc).filter((f) => f.endsWith('.html')).map((f) => parse(f, newsSrc, 'actualite'))
  .map((n) => ({ ...n, lastmod: n.updated ?? n.date }))
  .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));

function newsPage(n) {
  const tool = n.tool ? TOOLS.find((t) => t.slug === n.tool) : null;
  if (n.tool && !tool) throw new Error(`${n.slug} : outil inconnu ${n.tool}`);
  const toolBox = tool ? `<p class="tool-link"><span class="cat">Outil gratuit</span><a href="../outils/${tool.slug}.html">${esc(tool.short)}</a> : ${esc(tool.card)}</p>` : '';
  for (const [, href] of n.body.matchAll(/href="\.\.\/guides\/([a-z0-9-]+)\.html(?:#[^"]*)?"/g)) {
    if (!all.some((x) => x.slug === href)) throw new Error(`${n.slug} : guide inconnu ${href}`);
  }
  const related = n.related.map((s) => {
    const r = all.find((x) => x.slug === s);
    if (!r) throw new Error(`${n.slug} : guide lié inconnu ${s}`);
    return `<li><a href="../guides/${r.slug}.html"><span class="cat">Guide</span>${esc(r.short)}</a></li>`;
  }).join('');
  const meta = `Publié le ${dateFr(n.date)}${n.updated && n.updated !== n.date ? ` · Mis à jour le ${dateFr(n.updated)}` : ''} · Lecture : ${n.minutes} min`;
  const canonical = `${SITE}/actualites/${n.slug}.html`;
  const body = `    <article class="wrap article news">
      <nav class="breadcrumb" aria-label="Fil d'Ariane"><a href="../">Accueil</a> › <a href="./">Actualités</a> › <span>${esc(n.tag)}</span></nav>
      <p class="news-tag">${esc(n.tag)}</p>
      <h1>${esc(n.title)}</h1>
      <p class="meta">${meta}</p>
      <div class="prose news-prose">
${polish(n.body)}
        ${toolBox}
        <div class="cta">
          <p>${esc(n.cta)}</p>
          <a class="btn btn-main" href="../app/">Essayer Immo-Zen gratuitement</a>
        </div>
        ${optinForm({ source: 'lettre', prefix: '../' })}
        <p class="small disclaimer">Article d'information, à jour au ${dateFr(n.lastmod)}. Il ne constitue pas un conseil fiscal, juridique ou financier personnalisé : vérifiez votre situation avec les textes officiels ou un professionnel avant de décider. Les exemples chiffrés reposent sur des hypothèses d'illustration.</p>
        ${related ? `<section class="related" aria-labelledby="related-title">
          <h2 id="related-title">Pour aller plus loin</h2>
          <ul>${related}</ul>
        </section>` : ''}
      </div>
    </article>`;
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'NewsArticle', headline: n.title, description: n.description,
    inLanguage: 'fr-FR', datePublished: n.date, dateModified: n.lastmod, mainEntityOfPage: canonical, articleSection: n.tag,
    author: { '@type': 'Organization', name: 'Immo-Zen', url: SITE },
    publisher: { '@type': 'Organization', name: 'Immo-Zen', url: SITE, logo: { '@type': 'ImageObject', url: `${SITE}/icon-512.png` } },
  };
  return shell({ title: `${n.title} — Actualités Immo-Zen`, description: n.description, canonical, body, jsonld, prefix: '../', current: 'actualites' });
}

function newsIndex() {
  const items = news.map((n) => `
          <li class="guide-card news-card"><a href="${n.slug}.html"><span class="news-tag">${esc(n.tag)}</span><h2>${esc(n.short)}</h2><p>${esc(n.description)}</p><span class="small">${dateFr(n.date)} · ${n.minutes} min</span></a></li>`).join('');
  const body = `    <div class="wrap">
      <nav class="breadcrumb" aria-label="Fil d'Ariane"><a href="../">Accueil</a> › <span>Actualités</span></nav>
      <h1>Actualités de l'investissement locatif</h1>
      <p class="lead">Budget, fiscalité, loyers, crédit : ce qui change pour les propriétaires bailleurs, expliqué simplement et relié aux guides et outils gratuits d'Immo-Zen.</p>
      <ul class="guide-list news-list">${items}
      </ul>
      ${optinForm({ source: 'lettre', prefix: '../' })}
    </div>`;
  const jsonld = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: "Actualités de l'investissement locatif", inLanguage: 'fr-FR', url: `${SITE}/actualites/`,
    hasPart: news.map((n) => ({ '@type': 'NewsArticle', headline: n.title, url: `${SITE}/actualites/${n.slug}.html`, datePublished: n.date })) };
  return shell({ title: "Actualités de l'investissement locatif — Immo-Zen", description: 'Budget 2027 et LMNP, révision des loyers, taux de crédit, statut du bailleur privé : les actualités qui comptent pour les propriétaires bailleurs, avec leurs effets chiffrés.', canonical: `${SITE}/actualites/`, body, jsonld, prefix: '../', current: 'actualites', ogType: 'website' });
}

rmSync(newsOut, { recursive: true, force: true });
mkdirSync(newsOut, { recursive: true });
for (const n of news) writeFileSync(join(newsOut, `${n.slug}.html`), newsPage(n));
writeFileSync(join(newsOut, 'index.html'), newsIndex());

// Plan du site pour les moteurs de recherche.
// Outils gratuits : pages, indices IRL repris de l'application (source unique : src/domain/irl.ts).
const outilsDir = join(root, 'site/outils');
mkdirSync(outilsDir, { recursive: true });
const irlSrc = readFileSync(join(root, 'src/domain/irl.ts'), 'utf8');
const irl = Object.fromEntries([...irlSrc.matchAll(/'(\d{4}-T[1-4])': ([\d.]+)/g)].map(([, k, v]) => [k, Number(v)]));
const lastKey = Object.keys(irl).sort().at(-1);
const [ly, lq] = lastKey.split('-T');
const prevVal = irl[`${Number(ly) - 1}-T${lq}`];
const fr = (x) => String(x).replace('.', ',');
const lastIrl = `Le dernier indice publié dans ce calculateur est celui du ${lq === '1' ? '1er' : `${lq}e`} trimestre ${ly} : ${fr(irl[lastKey])}, soit ${fr(((irl[lastKey] / prevVal - 1) * 100).toFixed(2))} % sur un an (${fr(prevVal)} un an plus tôt).`;
writeFileSync(join(outilsDir, 'irl.js'), `/* Indices de référence des loyers (INSEE), repris de src/domain/irl.ts par scripts/guides.mjs. */\nwindow.IRL_VALUES = ${JSON.stringify(irl)};\n`);
const TOOLS_DATE_FR = '9 novembre 2026';
for (const t of TOOLS) {
  const p = toolPage(t, { site: SITE, dateFr: TOOLS_DATE_FR, lastIrl });
  writeFileSync(join(outilsDir, `${t.slug}.html`), shell({ ...p, prefix: '../', current: 'outils', ogType: 'website' }));
}
{
  const p = toolsIndex({ site: SITE });
  writeFileSync(join(outilsDir, 'index.html'), shell({ ...p, prefix: '../', current: 'outils', ogType: 'website' }));
}

const urls = [`${SITE}/`, `${SITE}/outils/`, ...TOOLS.map((t) => `${SITE}/outils/${t.slug}.html`), `${SITE}/guides/`, ...all.map((a) => `${SITE}/guides/${a.slug}.html`), `${SITE}/mentions-legales.html`, `${SITE}/conditions-generales.html`]
  .map((u) => [u, SITEMAP_LASTMOD]);
urls.push([`${SITE}/actualites/`, news[0]?.lastmod ?? SITEMAP_LASTMOD], ...news.map((n) => [`${SITE}/actualites/${n.slug}.html`, n.lastmod]));
writeFileSync(join(root, 'site/sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, d]) => `  <url><loc>${u}</loc><lastmod>${d}</lastmod></url>`).join('\n')}\n</urlset>\n`);
writeFileSync(join(root, 'site/robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

// En-tête commun réécrit dans les pages statiques.
for (const [file, opts] of [['site/index.html', { home: true }], ['site/mentions-legales.html', {}], ['site/inscription.html', {}]]) {
  const path = join(root, file);
  const html = readFileSync(path, 'utf8');
  const next = html.replace(/<header class="top">[\s\S]*?<\/header>/, siteHeader(opts))
    // formulaires d'inscription : <!--optin:source--> … <!--/optin--> (réécrits à chaque génération)
    .replace(/<!--optin:([a-z-]+)(:compact)?-->[\s\S]*?<!--\/optin-->/g, (_, source, compact) =>
      `<!--optin:${source}${compact ?? ''}-->\n        ${optinForm({ source, compact: !!compact })}\n        <!--/optin-->`);
  if (next === html && !html.includes(siteHeader(opts))) throw new Error(`${file} : en-tête introuvable`);
  writeFileSync(path, next);
}

for (const a of all) console.log(`${a.slug.padEnd(40)} ${String(a.words).padStart(5)} mots  ${a.minutes} min`);
console.log(`${all.length} guides générés dans site/guides/`);
for (const n of news) console.log(`${n.slug.padEnd(40)} ${String(n.words).padStart(5)} mots  ${n.date}`);
console.log(`${news.length} actualités générées dans site/actualites/`);
