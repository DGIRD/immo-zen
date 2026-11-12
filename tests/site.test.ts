// Site vitrine : même en-tête sur toutes les pages (accueil, guides, mentions légales).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { siteHeader } from '../scripts/site-header.mjs';

const site = join(import.meta.dirname, '..', 'site');
const header = (html: string) => html.match(/<header class="top">[\s\S]*?<\/header>/)?.[0];

test('en-tête identique sur toutes les pages du site vitrine', () => {
  assert.equal(header(readFileSync(join(site, 'index.html'), 'utf8')), siteHeader({ home: true }));
  assert.equal(header(readFileSync(join(site, 'mentions-legales.html'), 'utf8')), siteHeader({}));
  const guides = readdirSync(join(site, 'guides')).filter((f) => f.endsWith('.html'));
  assert.ok(guides.length >= 10);
  for (const f of guides) assert.equal(header(readFileSync(join(site, 'guides', f), 'utf8')), siteHeader({ prefix: '../', current: 'guides' }), f);
  const outils = readdirSync(join(site, 'outils')).filter((f) => f.endsWith('.html'));
  assert.equal(outils.length, 4);
  for (const f of outils) assert.equal(header(readFileSync(join(site, 'outils', f), 'utf8')), siteHeader({ prefix: '../', current: 'outils' }), f);
});

test('outils gratuits : pages au plan du site, indices IRL repris de l’application', () => {
  const sitemap = readFileSync(join(site, 'sitemap.xml'), 'utf8');
  for (const p of ['outils/', 'outils/simulateur-cash-flow.html', 'outils/plafond-loyer-paris.html', 'outils/revision-loyer-irl.html']) assert.match(sitemap, new RegExp(`immo-zen.fr/${p.replace('.', '\\.')}<`));
  const irl = readFileSync(join(site, 'outils', 'irl.js'), 'utf8');
  assert.match(irl, /"2026-T3":148\.06/);
  const paris = readFileSync(join(site, 'outils', 'plafonds-paris-2026.js'), 'utf8');
  assert.match(paris, /\[72,"Chapelle",13\]/);
});

test('« Espace client » dans l’en-tête, après le bouton Menu, sur chaque page', () => {
  for (const h of [siteHeader({ home: true }), siteHeader({}), siteHeader({ prefix: '../', current: 'guides' })]) {
    assert.match(h, /<div class="top-actions">\s*<button class="menu-btn"[^>]*>Menu<\/button>\s*<a class="btn btn-espace" href="[^"]*app\/">Espace client<\/a>/);
  }
  assert.match(siteHeader({ prefix: '../', current: 'guides' }), /<a href="\.\.\/guides\/" aria-current="page">Guides<\/a>/);
  assert.doesNotMatch(siteHeader({ home: true }), /aria-current/);
});

test('inscriptions : formulaires avec case d’accord non cochée, sources reconnues par le serveur', () => {
  const sql = readFileSync(join(import.meta.dirname, '..', 'supabase', 'migrations', '20261112000200_inscriptions_site.sql'), 'utf8');
  const allowed = new Set([...(sql.match(/p_source not in \(([^)]*)\)/)?.[1] ?? '').matchAll(/'([a-z-]+)'/g)].map((m) => m[1]));
  const pages = [join(site, 'index.html'), ...['guides', 'outils'].flatMap((d) => readdirSync(join(site, d)).filter((f) => f.endsWith('.html')).map((f) => join(site, d, f)))];
  const seen = new Set<string>();
  for (const p of pages) {
    const html = readFileSync(p, 'utf8');
    for (const [form, src] of html.matchAll(/<form class="optin[^"]*" data-source="([a-z-]+)"[\s\S]*?<\/form>/g)) {
      const source = src ?? '';
      seen.add(source);
      assert.ok(allowed.has(source), `${p} : source ${source} inconnue du serveur`);
      const consent = form.match(/<input type="checkbox" name="marketing"[^>]*>/)?.[0] ?? '';
      assert.ok(consent && !/checked/.test(consent), `${p} : case d’accord absente ou cochée`);
      assert.match(form, /mentions-legales\.html#confidentialite/);
    }
    if (html.includes('class="optin')) assert.match(html, /<body data-supabase-url="%IMMOZEN_SUPABASE_URL%" data-supabase-key="%IMMOZEN_SUPABASE_ANON_KEY%">/, p);
  }
  for (const s of ['calcul-cash-flow', 'calcul-plafond', 'calcul-irl', 'calcul-economies', 'guide', 'checklist', 'lettre']) assert.ok(seen.has(s), `formulaire ${s} absent`);
});

test('inscriptions : documents à télécharger, page de confirmation et confidentialité', () => {
  for (const f of ['guide-10-verifications-avant-achat.pdf', 'checklist-mise-en-location.pdf']) {
    assert.equal(readFileSync(join(site, 'ressources', f)).subarray(0, 5).toString(), '%PDF-', f);
  }
  const page = readFileSync(join(site, 'inscription.html'), 'utf8');
  assert.equal(header(page), siteHeader({}));
  assert.match(page, /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(readFileSync(join(site, 'sitemap.xml'), 'utf8'), /inscription\.html/);
  assert.match(readFileSync(join(site, 'mentions-legales.html'), 'utf8'), /Calculs, guide, checklist, lettre et alertes/);
});
