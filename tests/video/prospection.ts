// Tutoriel vidéo : ajouter un bien en prospection et le simuler (mode démonstration, services publics simulés).
// Lancement : npm run build, puis node --import tsx tests/video/prospection.ts <dossier de sortie>
// Produit des images horodatées (frames/) et frames.txt, assemblés ensuite en MP4 avec ffmpeg (concat).
import { chromium, type Locator, type Page } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { csv, salesAround } from '../fixtures/dvf.ts';

const root = resolve(import.meta.dirname, '../..');
const dist = join(root, 'dist');
const outDir = resolve(process.argv[2] ?? join(root, 'test-results', 'video'));
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const W = 1440, H = 900;

async function serve() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    const file = join(dist, path.endsWith('/') ? `${path}index.html` : path);
    if (!file.startsWith(dist) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const a = server.address() as { port: number };
  return { url: `http://127.0.0.1:${a.port}/app/`, close: () => server.close() };
}

// ---- services publics simulés : adresses (BAN), communes, ventes DVF ----
type Ctx = Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>['newContext']>>;
async function mocks(ctx: Ctx) {
  const cors = { 'access-control-allow-origin': '*' };
  await ctx.route('https://data.geopf.fr/geocodage/**', (r) => r.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify({ features: [
    { geometry: { coordinates: [1.0993, 49.4431] }, properties: { label: '24 Rue Beauvoisine 76000 Rouen', name: '24 Rue Beauvoisine', postcode: '76000', city: 'Rouen', citycode: '76540', type: 'housenumber' } },
    { geometry: { coordinates: [1.0941, 49.4402] }, properties: { label: '8 Rue Jeanne d’Arc 76000 Rouen', name: '8 Rue Jeanne d’Arc', postcode: '76000', city: 'Rouen', citycode: '76540', type: 'housenumber' } },
    { geometry: { coordinates: [1.1012, 49.4389] }, properties: { label: '15 Rue Saint-Romain 76000 Rouen', name: '15 Rue Saint-Romain', postcode: '76000', city: 'Rouen', citycode: '76540', type: 'housenumber' } },
  ] }) }));
  await ctx.route('https://files.data.gouv.fr/geo-dvf/**', (r) => r.request().url().endsWith('/2025/communes/76/76540.csv')
    ? r.fulfill({ contentType: 'text/csv', headers: cors, body: csv(salesAround(26, 2950, { lat: 49.4425, lon: 1.0985, date: '2025-04-10' })) })
    : r.fulfill({ contentType: 'text/csv', headers: cors, body: csv([]) }));
  await ctx.route('https://geo.api.gouv.fr/communes**', (r) => r.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify([{ nom: 'Rouen' }]) }));
}

// ---- mise en scène : sous-titres, curseur visible, bannière de démonstration masquée ----
const STAGE = `
(() => {
  const css = document.createElement('style');
  css.textContent = \`
    .demo-banner, [class*="demo-banner"] { display: none !important; }
    #tuto-cap { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 2147483646; max-width: 980px; width: max-content;
      background: rgba(24,50,47,.94); color: #fff; font: 600 22px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 14px 24px 16px; border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,.25); transition: opacity .35s; text-align: center; }
    #tuto-cap small { display: block; font-weight: 400; font-size: 17px; opacity: .88; margin-top: 4px; }
    #tuto-cap .step { display: inline-block; background: #a8771f; color: #fff; border-radius: 6px; font-size: 15px; padding: 2px 9px; margin-right: 10px; vertical-align: 3px; }
    #tuto-cursor { position: fixed; z-index: 2147483644; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; pointer-events: none;
      background: rgba(168,119,31,.35); border: 2px solid #a8771f; transition: left .25s ease, top .25s ease, transform .15s; left: -40px; top: -40px; }
    #tuto-cursor.down { transform: scale(.7); background: rgba(168,119,31,.7); }
    #tuto-card { position: fixed; inset: 0; z-index: 2147483647; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
      background: linear-gradient(160deg, #1f4a45, #18322f); color: #fff; font-family: "Iowan Old Style", Palatino, Georgia, serif; transition: opacity .6s; }
    #tuto-card h1 { font-size: 58px; margin: 0 0 18px; font-weight: 600; max-width: 1100px; line-height: 1.15; }
    #tuto-card p { font: 400 26px/1.5 system-ui, sans-serif; margin: 0; opacity: .9; max-width: 900px; }
    #tuto-card .brand { font-size: 30px; letter-spacing: .02em; margin-bottom: 34px; color: #e3c27a; }
    .tuto-focus { outline: 4px solid #a8771f !important; outline-offset: 4px; border-radius: 6px; transition: outline .2s; }
  \`;
  const cur = document.createElement('div'); cur.id = 'tuto-cursor';
  const mount = () => { (document.head || document.documentElement).appendChild(css); document.body.appendChild(cur); };
  if (document.body) mount(); else addEventListener('DOMContentLoaded', mount);
  addEventListener('mousemove', (e) => { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px'; }, true);
  addEventListener('mousedown', () => cur.classList.add('down'), true);
  addEventListener('mouseup', () => cur.classList.remove('down'), true);
  window.__cap = (html) => {
    let c = document.getElementById('tuto-cap');
    if (!html) { if (c) c.style.opacity = '0'; return; }
    if (!c) { c = document.createElement('div'); c.id = 'tuto-cap'; document.body.appendChild(c); }
    c.innerHTML = html; c.style.opacity = '1';
  };
  window.__card = (html) => {
    let c = document.getElementById('tuto-card');
    if (!html) { if (c) { c.style.opacity = '0'; setTimeout(() => c.remove(), 650); } return; }
    if (!c) { c = document.createElement('div'); c.id = 'tuto-card'; document.body.appendChild(c); }
    c.innerHTML = html; c.style.opacity = '1';
  };
})();`;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// commentaire oral : durée de chaque phrase (VOICE_DIR/durations.json) ; chaque étape attend la fin de la phrase précédente
const VOICE_DIR = process.env.VOICE_DIR;
const durations: Record<string, number> = VOICE_DIR && existsSync(join(VOICE_DIR, 'durations.json')) ? JSON.parse(await readFile(join(VOICE_DIR, 'durations.json'), 'utf8')) : {};
const SPEECH: Record<string, string> = {
  'Trouver le bien locatif idéal': 'n00', 'Tous vos biens repérés au même endroit': 'n01', 'Un nouveau bien ? Un seul bouton': 'n02', 'Partez de l’annonce': 'n03',
  'Prix, surface, pièces, DPE, charges, taxe foncière…': 'n04', 'La fiche est remplie en quelques secondes': 'n05', 'Adresse proposée automatiquement': 'n06',
  'Le prix est-il juste ?': 'n07', 'Les ventes comparables, consultables': 'n08', 'Votre offre et votre financement': 'n09', 'Le loyer, au m² ou saisi librement': 'n10',
  'Le cash-flow, en direct': 'n11', 'Le détail du crédit': 'n12', 'Le suivi des actions, à la fin de la fiche': 'n13', 'Un clic, et tout est enregistré': 'n14',
  'Le nouveau bien rejoint la prospection': 'n15', 'Comparez jusqu’à quatre biens': 'n16', 'Du repérage à l’offre, des chiffres justes': 'n17',
};
export const marks: { key: string; t: number }[] = [];
let speechEnd = 0;
async function speak(key: string | undefined) {
  if (!key || !(key in durations)) return;
  const now = Date.now() / 1000;
  if (speechEnd > now) await wait((speechEnd - now) * 1000);
  const t = Date.now() / 1000;
  marks.push({ key, t });
  speechEnd = t + durations[key]! + 0.35;
}
const untilSilence = async (extra = 0) => { const now = Date.now() / 1000; if (speechEnd + extra > now) await wait((speechEnd + extra - now) * 1000); };

function director(page: Page) {
  const cap = async (step: string | null, title: string, sub = '', ms = 3200) => {
    await speak(SPEECH[title]);
    await page.evaluate(([s, t, d]) => (window as unknown as { __cap: (h: string) => void }).__cap(`${s ? `<span class="step">${s}</span>` : ''}${t}${d ? `<small>${d}</small>` : ''}`), [step, title, sub]);
    await wait(ms);
  };
  const card = async (html: string | null, ms = 3500) => { if (html) await speak(Object.entries(SPEECH).find(([k]) => html.includes(k))?.[1]); await page.evaluate((h) => (window as unknown as { __card: (h: string | null) => void }).__card(h), html); await wait(ms); };
  const show = async (l: Locator, ms = 700) => {
    await l.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    await wait(650);
    const b = await l.boundingBox();
    if (b) await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 18), { steps: 12 });
    await wait(ms);
  };
  const focus = async (l: Locator, ms = 1600) => { await show(l, 200); await l.evaluate((el) => el.classList.add('tuto-focus')); await wait(ms); await l.evaluate((el) => el.classList.remove('tuto-focus')); };
  const click = async (l: Locator, ms = 900) => { await show(l, 250); await l.click(); await wait(ms); };
  const type = async (l: Locator, text: string, ms = 350) => { await show(l, 150); await l.click(); await l.selectText(); await l.pressSequentially(text, { delay: 45 }); await wait(ms); };
  const scroll = async (y: number, ms = 900) => { await page.evaluate((v) => window.scrollBy({ top: v, behavior: 'smooth' }), y); await wait(ms); };
  return { cap, card, show, focus, click, type, scroll };
}

/** Deux biens déjà repérés, pour montrer le tableau de prospection et la comparaison (préparés hors caméra). */
async function seed(page: Page, url: string) {
  const add = async (b: { title: string; addr: string; option: string; price: string; surface: string; offer: string; rent: string; copro: string; tax: string; status?: string; dpe?: string }) => {
    await page.goto(url + '#/bien/nouveau');
    await page.getByLabel('Titre du bien *').fill(b.title);
    if (b.status) await page.getByLabel('Statut', { exact: true }).selectOption({ label: b.status });
    await page.getByRole('combobox', { name: 'Adresse' }).fill(b.addr);
    await page.getByRole('option', { name: b.option }).click();
    await page.getByLabel('Prix de présentation FAI').fill(b.price);
    await page.getByLabel('Surface du logement').fill(b.surface);
    if (b.dpe) await page.getByLabel('DPE').selectOption(b.dpe);
    await page.getByLabel('Prix proposé', { exact: true }).fill(b.offer);
    await page.getByLabel('Apport').fill('20000');
    await page.getByLabel('Durée', { exact: true }).fill('25');
    await page.getByRole('radio', { name: 'Saisie libre' }).click();
    await page.getByLabel('Loyer hors charges', { exact: true }).fill(b.rent);
    await page.getByLabel('Charges de copropriété').fill(b.copro);
    await page.getByLabel('Taxe foncière', { exact: true }).fill(b.tax);
    await page.getByRole('button', { name: 'Estimer avec les ventes DVF' }).click();
    await page.getByText(/ventes d'appartements/).first().waitFor();
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await page.getByText(/ajouté à la prospection/).first().waitFor();
  };
  await page.goto(url);
  await page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
  await add({ title: 'Studio Jeanne d’Arc', addr: '8 rue Jeanne', option: '8 Rue Jeanne d’Arc 76000 Rouen', price: '92 000', surface: '24', offer: '87000', rent: '450', copro: '700', tax: '400', status: 'Visite à programmer', dpe: 'E' });
  await add({ title: 'T3 Saint-Romain', addr: '15 rue Saint', option: '15 Rue Saint-Romain 76000 Rouen', price: '209 000', surface: '64', offer: '199000', rent: '950', copro: '2000', tax: '1100', status: 'Visité', dpe: 'C' });
  // tableau resserré sur les colonnes utiles à l'écran
  await page.evaluate(() => localStorage.setItem('immozen:ui:table:prospection', JSON.stringify(['city', 'address', 'type', 'rooms', 'asking', 'nego', 'm2', 'estimate', 'works', 'rent', 'agency', 'agent', 'next', 'visit', 'url', 'updated'])));
}

async function main() {
  if (!existsSync(join(dist, 'app', 'index.html'))) throw new Error('Lancez d’abord npm run build');
  await mkdir(outDir, { recursive: true });
  const { url, close } = await serve();
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

  // préparation hors caméra
  const prep = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: W, height: H } });
  await mocks(prep);
  const pp = await prep.newPage();
  await seed(pp, url);
  const state = await prep.storageState();
  await prep.close();

  // tournage
  const ctx = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: W, height: H }, storageState: state });
  await mocks(ctx);
  await ctx.addInitScript(STAGE);
  const page = await ctx.newPage();
  const d = director(page);
  // capture d'écran continue (protocole Chrome) : une image à chaque changement, horodatée
  const frames: { file: string; t: number }[] = [];
  await mkdir(join(outDir, 'frames'), { recursive: true });
  const cdp = await ctx.newCDPSession(page);
  const writes: Promise<void>[] = [];
  cdp.on('Page.screencastFrame', (f) => {
    const file = `frames/f${String(frames.length).padStart(5, '0')}.jpg`;
    frames.push({ file, t: f.metadata.timestamp ?? Date.now() / 1000 });
    writes.push(writeFile(join(outDir, file), Buffer.from(f.data, 'base64')));
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined);
  });
  let recording = false;
  const startRec = async () => { await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 }); recording = true; };

  await page.goto(url + '#/prospection');
  await page.getByRole('heading', { name: 'Prospection' }).first().waitFor();
  await page.evaluate(() => (window as unknown as { __card: (h: string) => void }).__card('<div class="brand">Immo-Zen</div>'));
  await startRec();
  await d.card(`<div class="brand">Immo-Zen</div><h1>Trouver le bien locatif idéal</h1><p>Ajouter un bien en prospection, vérifier son prix et simuler sa rentabilité, en une seule saisie.</p>`, 5200);
  await untilSilence(-1.2);
  await d.card(null, 700);

  // 1. la prospection
  await d.cap('1', 'Tous vos biens repérés au même endroit', 'Statut, prix, rendement, cash-flow et écart avec le prix du marché, bien par bien.', 4800);
  await d.focus(page.locator('table.dt-table').first(), 2600);
  await d.cap('1', 'Un nouveau bien ? Un seul bouton', '« Ajouter un bien » ouvre sa fiche et sa simulation dans le même écran.', 2600);
  await d.click(page.getByRole('button', { name: 'Ajouter un bien' }).first(), 1200);

  // 2. l'annonce
  await page.getByRole('heading', { name: 'Le bien' }).waitFor();
  await d.cap('2', 'Partez de l’annonce', 'Collez son lien, ou son texte : Immo-Zen en extrait les caractéristiques du bien.', 3400);
  await d.type(page.getByLabel('Lien de l’annonce'), 'https://www.exemple-annonces.fr/vente/rouen/t2-beauvoisine', 400);
  await d.click(page.getByRole('button', { name: 'ou coller le texte de l’annonce' }), 600);
  const text = page.getByLabel('Texte de l’annonce');
  await d.show(text, 200);
  await text.fill(['Appartement T2 44 m² lumineux', 'Rouen (76000) - Quartier Beauvoisine, proche gare', 'Prix : 139 000 € honoraires inclus',
    '1 chambre, 2e étage, double vitrage, cave.', 'Charges de copropriété : 90 € par mois', 'Taxe foncière : 850 €', 'DPE : D'].join('\n'));
  await wait(1400);
  await d.click(page.getByRole('button', { name: 'Analyser le texte' }), 900);
  const box = page.getByRole('region', { name: 'Remplir depuis l’annonce' });
  await d.cap('2', 'Prix, surface, pièces, DPE, charges, taxe foncière…', 'Chaque valeur trouvée vous est proposée : vous choisissez ce qui est repris.', 1200);
  await d.focus(box.locator('.listing-found'), 3600);
  await d.click(box.getByRole('button', { name: /^Reprendre dans la fiche/ }), 1400);
  await d.cap('2', 'La fiche est remplie en quelques secondes', 'Titre, type, prix FAI, surface, pièces, code postal, DPE : tout reste modifiable.', 1000);
  await d.focus(page.locator('section', { has: page.getByRole('heading', { name: 'Le bien' }) }).locator('.grid').first(), 3000);
  await d.cap('2', 'Adresse proposée automatiquement', 'Base Adresse Nationale : rue, code postal et ville en un clic.', 600);
  const addr = page.getByRole('combobox', { name: 'Adresse' });
  await d.type(addr, '24 rue Beau', 500);
  await d.click(page.getByRole('option', { name: '24 Rue Beauvoisine 76000 Rouen' }), 1400);

  // 3. le juste prix
  await d.cap('3', 'Le prix est-il juste ?', 'Immo-Zen compare avec les ventes réelles du quartier (données publiques DVF).', 1200);
  await d.click(page.getByRole('button', { name: 'Estimer avec les ventes DVF' }), 1600);
  await page.getByText(/ventes d'appartements/).first().waitFor();
  await d.focus(page.locator('.estimate').first(), 3800);
  await d.cap('3', 'Les ventes comparables, consultables', 'Fourchette et médiane du secteur : un argument solide pour négocier.', 500);
  await d.click(page.getByRole('button', { name: /Voir les ventes comparables/ }), 2600);
  await d.click(page.getByRole('button', { name: /Masquer les ventes comparables|Voir les ventes comparables/ }), 600);

  // 4. la simulation
  await d.cap('4', 'Votre offre et votre financement', 'Prix proposé, négociation, frais de notaire, crédit, apport : tout se calcule pendant la saisie.', 1200);
  await d.type(page.getByLabel('Prix proposé', { exact: true }), '125000', 900);
  await d.focus(page.locator('output[aria-labelledby="nego"]').locator('..'), 2000);
  await d.type(page.getByLabel('Apport'), '20000', 500);
  await d.type(page.getByLabel('Taux du crédit'), '3,4', 500);
  await d.type(page.getByLabel('Durée', { exact: true }), '25', 900);
  await d.cap('4', 'Le loyer, au m² ou saisi librement', 'Loyer bas ou haut du marché, provision et charges récupérables proposées automatiquement.', 800);
  await d.type(page.getByLabel('Loyer au m² bas'), '15', 300);
  await d.type(page.getByLabel('Loyer au m² haut'), '17', 600);
  await d.click(page.getByRole('radio', { name: 'Haut' }), 900);
  await d.focus(page.locator('output[aria-labelledby="rent-hc"]').locator('..'), 1800);
  await d.cap('4', 'Le cash-flow, en direct', 'Après crédit, assurance et charges : ici, le loyer couvre tout. Le bien s’autofinance.', 600);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await wait(800);
  await d.focus(page.locator('.sim-results'), 4200);
  await d.cap('4', 'Le détail du crédit', 'Tableau d’amortissement par année ou par mois, exportable sous Excel.', 500);
  await d.click(page.getByRole('button', { name: 'Par année' }), 2600);

  // 5. le suivi
  await d.cap('5', 'Le suivi des actions, à la fin de la fiche', 'Agence, agent, prochaine action, relance, visite, points de vigilance.', 800);
  const agence = page.getByLabel('Agence', { exact: true });
  await d.show(agence, 300);
  await agence.selectOption({ label: '+ Nouvelle agence…' });
  await wait(500);
  await d.type(page.getByLabel('Nom de la nouvelle agence'), 'Agence du Centre', 300);
  await d.type(page.getByLabel('Prochaine action'), 'Demander les 3 derniers PV d’AG', 300);
  await page.getByLabel('Date de relance').fill('2026-11-02');
  await wait(500);
  await d.type(page.getByLabel('Points de vigilance (un par ligne)'), 'Ravalement voté en 2027 ?', 1200);

  // 6. enregistrer
  await d.cap('6', 'Un clic, et tout est enregistré', 'La fiche, l’estimation, la simulation et le suivi : une seule saisie, une seule simulation par bien.', 600);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await wait(700);
  await d.click(page.getByRole('button', { name: 'Enregistrer', exact: true }), 2600);

  // 7. comparer
  await d.click(page.getByRole('link', { name: 'Prospection' }).first(), 1400);
  await page.locator('tbody tr', { hasText: 'Appartement T2' }).first().waitFor();
  await d.cap('7', 'Le nouveau bien rejoint la prospection', 'Rendement, cash-flow, prix au m² et écart avec l’estimation, côte à côte.', 1000);
  await d.focus(page.locator('table.dt-table').first(), 3200);
  await d.cap('7', 'Comparez jusqu’à quatre biens', 'Les meilleures valeurs sont mises en évidence : le bien idéal saute aux yeux.', 600);
  for (const t of ['Appartement T2', 'T3 Saint-Romain', 'Studio Jeanne']) {
    await d.click(page.locator('tbody tr', { hasText: t }).first().getByRole('checkbox'), 350);
  }
  await d.click(page.getByRole('button', { name: 'Comparer', exact: true }), 1200);
  await d.focus(page.locator('dialog[open]'), 3000);
  await untilSilence(0);
  await page.keyboard.press('Escape');
  await wait(600);

  await d.cap(null, '', '', 0);
  await page.evaluate(() => (window as unknown as { __cap: (h: string) => void }).__cap(''));
  await d.card(`<div class="brand">Immo-Zen</div><h1>Du repérage à l’offre, des chiffres justes</h1><p>Lecture de l’annonce · estimation DVF · simulation complète · suivi des actions · comparaison<br><br>immo-zen.fr — essai gratuit 30 jours</p>`, 6000);

  await untilSilence(0.6);
  if (recording) await cdp.send('Page.stopScreencast');
  await Promise.all(writes);
  // liste pour ffmpeg : chaque image dure jusqu'à la suivante
  const end = Math.max(frames.at(-1)!.t + 1.5, speechEnd + 0.8);
  await writeFile(join(outDir, 'marks.json'), JSON.stringify({ start: frames[0]!.t, end, marks }, null, 1));
  const lines = frames.flatMap((f, i) => [`file '${f.file}'`, `duration ${((frames[i + 1]?.t ?? end) - f.t).toFixed(3)}`]);
  lines.push(`file '${frames.at(-1)!.file}'`);
  await writeFile(join(outDir, 'frames.txt'), lines.join('\n') + '\n');
  await ctx.close();
  await browser.close();
  close();
  console.log(`${frames.length} images, ${(end - frames[0]!.t).toFixed(1)} s → ${join(outDir, 'frames.txt')}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
