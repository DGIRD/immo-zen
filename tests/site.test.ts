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
});

test('« Espace client » dans l’en-tête, après le bouton Menu, sur chaque page', () => {
  for (const h of [siteHeader({ home: true }), siteHeader({}), siteHeader({ prefix: '../', current: 'guides' })]) {
    assert.match(h, /<div class="top-actions">\s*<button class="menu-btn"[^>]*>Menu<\/button>\s*<a class="btn btn-espace" href="[^"]*app\/">Espace client<\/a>/);
  }
  assert.match(siteHeader({ prefix: '../', current: 'guides' }), /<a href="\.\.\/guides\/" aria-current="page">Guides<\/a>/);
  assert.doesNotMatch(siteHeader({ home: true }), /aria-current/);
});
