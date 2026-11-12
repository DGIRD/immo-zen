// Génère les documents à télécharger du site (site/ressources/*.pdf) à partir de content/ressources/*.html.
// Usage : node scripts/ressources.mjs (Chromium de Playwright requis). Les PDF sont versionnés.
import { mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'content/ressources');
const out = join(root, 'site/ressources');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
for (const f of readdirSync(src).filter((x) => x.endsWith('.html') && !x.startsWith('_'))) {
  await page.goto(pathToFileURL(join(src, f)).href);
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: join(out, f.replace(/\.html$/, '.pdf')), format: 'A4', printBackground: true, preferCSSPageSize: true });
  console.log('→', f.replace(/\.html$/, '.pdf'));
}
await browser.close();
