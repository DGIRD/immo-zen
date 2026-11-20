/**
 * Captures de l'application pour le site vitrine (section « Immo-Zen en images ») et l'e-mail de bienvenue.
 * Parc d'exemple fictif (scripts/captures/seed.ts) en mode démonstration, puis mise en page : fond vert, titre,
 * fenêtre de navigateur. Produit site/img/app/<nom>.webp (1200 × 900), <nom>-600.webp et site/img/email/<nom>.jpg.
 * Prérequis : npm run build. Usage : node --import tsx scripts/captures/run.ts [nom…]
 */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { extname, join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { seedDemo } from './seed.ts';

const root = join(import.meta.dirname, '..', '..');
const dist = join(root, 'dist');
const tmp = join(root, 'test-results', 'captures');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webp': 'image/webp' };

interface Scene {
  name: string; title: string; subtitle: string;
  /** Prépare l'écran à photographier (route, clics) ; renvoie le chemin d'une image déjà prête (document PDF) le cas échéant. */
  go(p: Page, ids: Ids): Promise<string | void>;
  /** Hauteur à partir de laquelle commencer la capture de la page (défilement), en pixels de l'application. */
  scrollTo?: string;
  email?: boolean;
}
interface Ids { prospect: string; lyon: string; lyonLease: string }

const SCENES: Scene[] = [
  { name: 'tableau-de-bord', email: true, title: 'Tout votre parc d’un coup d’œil', subtitle: 'Loyers, cash-flow, impayés et prochaines actions',
    go: async (p) => { await p.goto('#/'); await p.getByRole('heading', { name: 'Tableau de bord' }).waitFor(); } },
  { name: 'simulation', email: true, title: 'Chiffrez chaque bien avant l’offre', subtitle: 'Coût total, crédit, cash-flow et rendement',
    go: async (p, ids) => { await p.goto(`#/bien/${ids.prospect}`); await p.getByRole('tab', { name: 'Simulation' }).click(); } },
  { name: 'dossier-banque', title: 'Un dossier prêt pour votre banque', subtitle: 'Chiffres clés, financement et taux d’endettement en PDF',
    go: async (p, ids) => {
      await p.goto(`#/bien/${ids.prospect}/modifier`);
      await p.getByRole('button', { name: 'Dossier banque (PDF)' }).click();
      const d = p.getByRole('dialog', { name: 'Dossier de financement pour la banque' });
      await d.getByLabel('Emprunteur(s)').fill('Alex et Sam Exemple');
      await d.getByLabel('Revenus nets mensuels du foyer').fill('6200');
      await d.getByLabel('Crédits en cours').fill('0');
      const [dl] = await Promise.all([p.waitForEvent('download'), d.getByRole('button', { name: 'Télécharger le PDF' }).click()]);
      const pdf = join(tmp, 'dossier-banque.pdf'); await dl.saveAs(pdf);
      execFileSync('pdftoppm', ['-png', '-r', '150', '-f', '1', '-l', '1', '-singlefile', pdf, join(tmp, 'dossier-banque-p1')]);
      return join(tmp, 'dossier-banque-p1.png');
    } },
  { name: 'mes-biens', title: 'Vos biens, en cartes ou en tableau', subtitle: 'Loyer, cash-flow et état locatif de chaque logement',
    go: async (p) => { await p.goto('#/biens'); await p.locator('.prop-card').first().waitFor(); } },
  { name: 'fiche-bien', title: 'Une fiche par bien, rangée en onglets', subtitle: 'Location, finances, estimation, documents et historique',
    go: async (p, ids) => { await p.goto(`#/bien/${ids.lyon}`); await p.getByRole('tab', { name: 'Finances' }).click(); } },
  { name: 'baux-locataires', email: true, title: 'Baux et locataires au même endroit', subtitle: 'Loyer, charges, révision et état de chaque bail',
    go: async (p) => { await p.goto('#/locataires'); await p.getByRole('heading', { name: /Locataires et baux/ }).waitFor(); } },
  { name: 'bail', email: true, title: 'Le contrat de bail généré pour vous', subtitle: 'À partir des informations du bail, avec les points à vérifier',
    go: async (p, ids) => { await p.goto(`#/baux/${ids.lyonLease}/contrat`); await p.getByRole('heading', { name: 'Contrat de bail' }).waitFor(); } },
  { name: 'loyers', email: true, title: 'Loyers suivis, impayés repérés', subtitle: 'Paiements rapprochés, quittances envoyées seules',
    go: async (p) => { await p.goto('#/loyers'); await p.locator('table.dt-table').first().waitFor(); } },
  { name: 'depenses', email: true, title: 'Les dépenses classées par bien', subtitle: 'Saisie rapide ou import de vos relevés bancaires',
    go: async (p) => { await p.goto('#/depenses'); await p.locator('table.dt-table').first().waitFor(); } },
  { name: 'declaration', email: true, title: 'Votre déclaration, étape par étape', subtitle: 'Points à vérifier, montants case par case selon le régime',
    go: async (p) => { await p.goto('#/declaration'); await p.getByRole('tab', { name: /Mes chiffres/ }).click(); } },
];

async function main() {
  const only = process.argv.slice(2);
  await mkdir(tmp, { recursive: true });
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    const file = path.startsWith('/_tmp/') ? join(tmp, path.slice(6)) : join(dist, path.endsWith('/') ? `${path}index.html` : path);
    if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'access-control-allow-origin': '*' }); res.end(await readFile(file));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  const store = await seedDemo(today);
  const db = JSON.parse(store['immozen:demo:v1']!);
  const lyon = db.properties.find((x: { title: string }) => x.title.startsWith('T2 Lyon'));
  const ids: Ids = {
    prospect: db.properties.find((x: { title: string }) => x.title.startsWith('T2 Paris')).id,
    lyon: lyon.id, lyonLease: db.leases.find((l: { property_id: string }) => l.property_id === lyon.id).id,
  };

  const ctx = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true, baseURL: `${base}/app/` });
  await ctx.route(/data\.geopf\.fr|files\.data\.gouv\.fr|geo\.api\.gouv\.fr/, (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"features":[]}' }));
  await ctx.addInitScript((s: Record<string, string>) => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.clear();
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    localStorage.setItem('immozen:vue:mes-biens', 'cartes');
    localStorage.setItem('immozen:demarrage-masque', '1');
    sessionStorage.setItem('seeded', '1');
  }, store);
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${String(e)}`));
  await page.goto('');

  const frame = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  for (const s of SCENES.filter((x) => !only.length || only.includes(x.name))) {
    const ready = await s.go(page, ids);
    await page.addStyleTag({ content: '.sidenav{display:none!important} .topbar .brand,.nav-toggle,.demo-banner{display:none!important} .body{grid-template-columns:1fr!important} .toasts,.toast{display:none!important} *{scroll-behavior:auto!important}' });
    await page.waitForTimeout(600);
    let shot: string;
    let isDoc = false;
    if (ready) { shot = ready; isDoc = true; } else {
      if (s.scrollTo) await page.locator(s.scrollTo).first().evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70)).catch(() => undefined);
      else await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
      shot = join(tmp, `${s.name}-app.png`);
      await page.screenshot({ path: shot });
    }
    const img = `/_tmp/${shot.split('/').pop()}`;
    await frame.setContent(`<!doctype html><html><head><style>
      @font-face { font-family: S; font-weight: 600; src: url(${base}/fonts/source-serif-4-latin-600-normal.woff2) format("woff2"); }
      html,body{margin:0;width:1200px;height:900px;overflow:hidden;background:#1f4a45;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
      h1{position:absolute;left:64px;top:52px;margin:0;font:600 58px/1.1 S,serif;color:#fff;letter-spacing:-.01em}
      p{position:absolute;left:64px;top:132px;margin:0;font-size:27px;line-height:1.3;color:#cfe0da}
      .win{position:absolute;left:64px;top:206px;width:1072px;height:760px;background:#f4f6f4;border-radius:16px 16px 0 0;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.28)}
      .bar{height:34px;background:#dde6e2;display:flex;gap:9px;align-items:center;padding-left:18px}.bar i{width:12px;height:12px;border-radius:50%;background:#b9c7c1;display:block}
      .win img{display:block;width:1072px}
      .doc{position:absolute;left:150px;top:206px;width:900px;height:760px;background:#fff;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.28);border-radius:6px 6px 0 0}
      .doc img{display:block;width:900px}
    </style></head><body><h1>${s.title}</h1><p>${s.subtitle}</p>${isDoc
      ? `<div class="doc"><img src="${base}${img}"></div>`
      : `<div class="win"><div class="bar"><i></i><i></i><i></i></div><img src="${base}${img}"></div>`}</body></html>`, { waitUntil: 'load' });
    await frame.evaluate(() => document.fonts.ready);
    const png = join(tmp, `${s.name}.png`);
    await frame.screenshot({ path: png });
    const outApp = join(root, 'site', 'img', 'app');
    execFileSync('python3', ['-I', '-c', `
import sys
from PIL import Image
src, name, app, email, mail = sys.argv[1:6]
im = Image.open(src).convert('RGB')
im.save(f'{app}/{name}.webp', 'WEBP', quality=82, method=6)
im.resize((600, 450), Image.LANCZOS).save(f'{app}/{name}-600.webp', 'WEBP', quality=82, method=6)
if mail == '1': im.resize((1040, 780), Image.LANCZOS).save(f'{email}/{name}.jpg', 'JPEG', quality=84, optimize=True, progressive=True)
`, png, s.name, outApp, join(root, 'site', 'img', 'email'), s.email ? '1' : '0']);
    process.stderr.write(`OK ${s.name}\n`);
  }
  await writeFile(join(tmp, 'errors.json'), JSON.stringify(errors, null, 1));
  if (errors.length) process.stderr.write(`Erreurs JavaScript : ${errors.join(' | ')}\n`);
  await browser.close(); server.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
