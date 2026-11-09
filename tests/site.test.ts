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
