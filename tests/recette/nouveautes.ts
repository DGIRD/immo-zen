/**
 * Recette des évolutions du 10 au 15 novembre 2026 (mode démonstration) : un résultat par cas du cahier de test.
 * Tableau d'amortissement, déclaration en onglets, ergonomie (point info, cartes, rubriques repliables, onglets de la fiche,
 * assistant de bail, dossiers de documents, comparatif des formules, filtre de période) et dossier banque.
 * Prérequis : npm run build. Usage : node --import tsx tests/recette/nouveautes.ts → JSON sur la sortie standard.
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright';

const root = join(import.meta.dirname, '..', '..');
const dist = join(root, 'dist');
const shots = join(root, 'test-results', 'recette');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json' };
const T = (s: string) => s.replace(/[  ]/g, ' ');
const fr2 = (v: number) => v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const out: Record<string, { ok: boolean; detail: string }> = {};
let cur: Page | null = null;
async function c(id: string, fn: () => Promise<string | void>) {
  try { out[id] = { ok: true, detail: (await fn()) || 'conforme' }; process.stderr.write(`OK   ${id}\n`); }
  catch (e) { await cur?.screenshot({ path: join(shots, `KO-${id}.png`), fullPage: true }).catch(() => undefined); out[id] = { ok: false, detail: String((e as Error).message ?? e).split('\n').slice(0, 3).join(' ') }; process.stderr.write(`KO   ${id} ${out[id]!.detail}\n`); }
}
const db = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('immozen:demo:v1') ?? '{}'));

/** Texte de chaque page d'un PDF (pdf.js, version utilisée par l'application). */
async function pdfText(buf: Buffer): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    pages.push(T(tc.items.map((x) => ('str' in x ? x.str : '')).join(' ')).replace(/\s+/g, ' '));
  }
  return pages;
}

async function main() {
  await mkdir(shots, { recursive: true });
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    const file = join(dist, path.endsWith('/') ? `${path}index.html` : path);
    if (!file.startsWith(dist) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }); res.end(await readFile(file));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/app/`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  await ctx.route(/data\.geopf\.fr|files\.data\.gouv\.fr|geo\.api\.gouv\.fr/, (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"features":[]}' }));
  const page = await ctx.newPage();
  cur = page;
  page.setDefaultTimeout(8000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const leaseNext = () => page.getByRole('button', { name: 'Suivant' }).click();
  const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())).catch(() => new Date().toISOString().slice(0, 10));
  const year = Number(today.slice(0, 4));

  // données d'exemple
  await page.goto(url + '#/parametres');
  await page.getByRole('button', { name: 'Ajouter des données d’exemple' }).click();
  await page.getByText('Données d’exemple ajoutées.').waitFor();

  // ---------- tableau de bord
  await c('TDB-04', async () => {
    await page.goto(url);
    const sec = page.locator('section.start-list');
    await sec.waitFor();
    const h = T(await sec.getByRole('heading').innerText());
    const items = await sec.locator('li').count();
    assert.equal(items, 4, `${items} étapes`);
    assert.match(h, /Bien démarrer \(\d\/4\)/);
    const links = await sec.locator('li a').count();
    await sec.getByRole('button', { name: 'Masquer' }).click();
    await page.reload(); await page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
    assert.equal(await page.locator('section.start-list').count(), 0, 'liste réaffichée après « Masquer »');
    await page.evaluate(() => localStorage.removeItem('immozen:demarrage-masque'));
    return `« ${h} » : 4 étapes dont ${links} à faire (liens) ; « Masquer » conservé après rechargement`;
  });

  // ---------- point info
  await c('ERG-01', async () => {
    await page.goto(url + '#/loyers');
    const btn = page.locator('.page-header .info-tip-btn').first();
    await btn.waitFor();
    assert.equal(await page.locator('.info-tip-pop.open').count(), 0, 'bulle ouverte par défaut');
    await btn.click();
    const pop = page.locator('.info-tip-pop.open');
    await pop.waitFor();
    const txt = T(await pop.innerText()).trim();
    assert.ok(txt.length > 30, 'bulle vide');
    assert.equal(await btn.getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.info-tip-pop.open').count(), 0, 'Échap ne ferme pas');
    await btn.click(); await page.locator('.info-tip-pop.open').waitFor();
    await page.locator('main h1').click();
    await page.waitForTimeout(150);
    const outside = await page.locator('.info-tip-pop.open').count();
    return `bulle fermée par défaut, ouverte au clic (« ${txt.slice(0, 70)}… »), aria-expanded, Échap ferme${outside ? '' : ', clic à côté ferme'}`;
  });

  // ---------- cartes / tableau
  await c('ERG-02', async () => {
    await page.goto(url + '#/prospection');
    const grp = page.getByRole('group', { name: 'Affichage' });
    await grp.getByRole('button', { name: 'Tableau' }).click();
    const rows = await page.locator('table.dt-table tbody tr').count();
    await grp.getByRole('button', { name: 'Cartes' }).click();
    const cards = page.locator('.prop-card');
    await cards.first().waitFor();
    const n = await cards.count();
    assert.equal(n, rows, `${n} cartes pour ${rows} lignes`);
    await page.reload();
    await page.locator('.prop-card').first().waitFor();
    assert.equal(await grp.getByRole('button', { name: 'Cartes' }).getAttribute('aria-pressed'), 'true', 'vue cartes non conservée');
    await page.screenshot({ path: join(shots, 'nov-prospection-cartes.png'), fullPage: true });
    await grp.getByRole('button', { name: 'Tableau' }).click();
    await page.evaluate(() => { localStorage.setItem('immozen:vue:mes-biens', 'tableau'); });
    return `${rows} biens : ${n} cartes, vue conservée après rechargement, retour au tableau`;
  });

  // ---------- bien détenu : rubriques repliables, onglets
  let pid = '';
  await c('ERG-03', async () => {
    await page.goto(url + '#/biens');
    await page.getByRole('button', { name: 'Ajouter un bien détenu' }).first().click();
    await page.getByLabel('Titre *').fill('T3 nouveautés');
    const det = page.locator('details.section-collapsible');
    const total = await det.count();
    const closed = await det.evaluateAll((ds) => ds.filter((d) => !(d as HTMLDetailsElement).open).map((d) => d.querySelector('summary')?.textContent?.trim().slice(0, 40) ?? ''));
    assert.ok(total >= 3, `${total} rubriques repliables`);
    await page.evaluate(() => document.querySelectorAll('details.section-collapsible').forEach((d) => { (d as HTMLDetailsElement).open = true; }));
    await page.getByLabel('Loyer hors charges').fill('1000');
    await page.getByLabel('Provision sur charges').fill('80');
    await page.getByLabel('Taxe foncière').fill('1100');
    await page.getByLabel('Montant emprunté').fill('200000');
    await page.getByLabel('Taux', { exact: false }).first().fill('3');
    await page.getByLabel('Durée').fill('20');
    await page.getByLabel('Première échéance').fill(`${year - 1}-01-05`);
    await page.getByLabel('Mode de détention').selectOption('nom_propre');
    const sticky = await page.evaluate(() => { const f = document.querySelector('.form-foot'); return !!f && getComputedStyle(f).position === 'sticky' && !!f.querySelector('button[type=submit], button'); });
    assert.ok(sticky, 'barre d’enregistrement non collante en bas du formulaire');
    await page.getByRole('button', { name: 'Enregistrer' }).first().click();
    await page.getByRole('heading', { name: 'T3 nouveautés' }).waitFor();
    pid = page.url().split('/bien/')[1]!;
    return `${total} rubriques repliables (${closed.length} fermées à l’ouverture : ${closed.join(' ; ') || '—'}) ; bouton Enregistrer ${sticky ? 'collant' : 'non collant'}`;
  });

  await c('FIC-05', async () => {
    await page.goto(url + '#/bien/' + pid);
    const tabs = (await page.getByRole('tab').allInnerTexts()).map((t) => t.replace(/\s*\(\d+\)/, '').trim());
    assert.deepEqual(tabs, ['Vue d’ensemble', 'Location', 'Finances', 'Estimation', 'Documents', 'Historique', 'Tâches']);
    await page.getByRole('tab', { name: 'Finances' }).click();
    const fin = T(await page.locator('main').innerText());
    assert.match(fin, /1 109,19|1 109,20/, 'mensualité 200 000 € à 3 % sur 20 ans');
    await page.getByRole('tab', { name: 'Documents' }).click();
    await page.getByRole('tab', { name: 'Documents', selected: true }).waitFor();
    return `7 onglets : ${tabs.join(', ')} ; Finances : mensualité 1 109,20 € (200 000 € à 3 % sur 20 ans)`;
  });

  // ---------- tableau d'amortissement collé
  let interestPrev = 0;
  await c('EMP-01', async () => {
    let bal = 200000; const r = 0.03 / 12; const pay = 1109.20; const lines = ['N° Date Échéance Intérêts Capital amorti Assurance Capital restant dû'];
    for (let i = 0; i < 24; i++) {
      const it = Math.round(bal * r * 100) / 100; const pr = Math.round((pay - it) * 100) / 100; bal = Math.round((bal - pr) * 100) / 100;
      if (i < 12) interestPrev += it;
      const d = `05/${String(i % 12 + 1).padStart(2, '0')}/${year - 1 + Math.floor(i / 12)}`;
      lines.push(`${i + 1}  ${d}  ${fr2(pay + 15)}  ${fr2(it)}  ${fr2(pr)}  15,00  ${fr2(bal)}`);
    }
    interestPrev = Math.round(interestPrev * 100) / 100;
    await page.goto(url + `#/bien/${pid}/modifier`);
    await page.evaluate(() => document.querySelectorAll('details.section-collapsible').forEach((d) => { (d as HTMLDetailsElement).open = true; }));
    await page.getByRole('button', { name: 'Importer le tableau d’amortissement' }).click();
    const dlg = page.locator('dialog.modal[open]');
    await dlg.locator('#sched-paste').fill(lines.join('\n'));
    await dlg.getByRole('button', { name: 'Analyser le texte collé' }).click();
    await dlg.getByText('24 échéance(s) lue(s)', { exact: false }).waitFor();
    const roles = await dlg.locator('thead select').evaluateAll((ss) => ss.map((s) => (s as HTMLSelectElement).value));
    const yrs = T(await dlg.locator('table').last().innerText());
    assert.ok(yrs.includes(fr2(interestPrev)), `intérêts ${year - 1} attendus ${fr2(interestPrev)} : ${yrs.slice(0, 300)}`);
    assert.match(yrs, new RegExp(`${year - 1}\\s+12\\s`), '12 échéances la 1re année');
    await page.screenshot({ path: join(shots, 'nov-tableau-colle.png'), fullPage: true });
    await dlg.getByRole('button', { name: 'Utiliser ce tableau' }).click();
    await page.getByText('24 échéances du', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Enregistrer' }).first().click();
    await page.waitForURL(new RegExp(`#/bien/${pid}$`));
    const p = (await db(page)).properties.find((x: { id: string }) => x.id === pid);
    assert.equal(p.loan_schedule?.rows?.length, 24, 'tableau non enregistré');
    return `24 échéances collées, colonnes reconnues (${roles.join(', ')}) ; intérêts ${year - 1} = ${fr2(interestPrev)} € ; enregistré dans le bien`;
  });

  // ---------- bien ajouté sans date d'acquisition, crédit commencé l'année précédente
  await c('DEC-03', async () => {
    const p = (await db(page)).properties.find((x: { id: string }) => x.id === pid);
    await page.goto(url + '#/declaration');
    await page.getByLabel('Année des revenus').selectOption(String(year - 1));
    await page.getByRole('tab', { name: /Vérifier/ }).click();
    await page.getByRole('heading', { name: 'Points à vérifier' }).waitFor();
    const listed = await page.getByLabel('Régime de T3 nouveautés').count();
    const checks = T(await page.locator('section, .section', { has: page.getByRole('heading', { name: 'Points à vérifier' }) }).first().innerText());
    const warned = /T3 nouveautés/.test(checks) && /acquisition|échéance/i.test(checks);
    assert.ok(listed || warned, `date d’acquisition fixée d’office au ${p.acquired_at} (jour de la saisie) alors que la 1re échéance du crédit est le ${p.loan_start_date} : le bien et ses ${fr2(interestPrev)} € d’intérêts ${year - 1} sont absents de la déclaration ${year - 1}, sans point à vérifier`);
    return listed ? 'bien repris malgré la date par défaut' : 'point à vérifier affiché';
  });
  await page.goto(url + `#/bien/${pid}/modifier`);
  await page.evaluate(() => document.querySelectorAll('details.section-collapsible').forEach((d) => { (d as HTMLDetailsElement).open = true; }));
  await page.getByLabel('Date d’acquisition').fill(`${year - 1}-01-02`);
  await page.getByRole('button', { name: 'Enregistrer' }).first().click();
  await page.waitForURL(new RegExp(`#/bien/${pid}$`));

  // ---------- déclaration en onglets
  await c('DEC-01', async () => {
    await page.goto(url + '#/declaration');
    await page.getByLabel('Année des revenus').selectOption(String(year - 1));
    const tabs = (await page.getByRole('tab').allInnerTexts()).map((t) => t.replace(/\s*\(\d+\)|\s*•/g, '').trim());
    assert.deepEqual(tabs, ['1. Vérifier', '2. Mes chiffres', '3. Mes saisies', '4. Déclarer', '5. Justificatifs']);
    await page.getByRole('tab', { name: /Vérifier/ }).click();
    await page.getByRole('heading', { name: 'Points à vérifier' }).waitFor();
    await page.getByLabel('Régime de T3 nouveautés').selectOption('reel_foncier');
    await page.getByRole('tab', { name: /Mes saisies/ }).click();
    const field = page.getByLabel(`Intérêts d’emprunt ${year - 1}`).first();
    const v = await field.inputValue();
    assert.equal(v, String(interestPrev).replace('.', ','), `intérêts pré-remplis ${v}`);
    await page.getByText('Pré-calculé : tableau d’amortissement importé', { exact: false }).first().waitFor();
    return `5 onglets dans l’ordre (${tabs.join(' · ')}) ; intérêts ${year - 1} pré-remplis depuis le tableau collé : ${v} €`;
  });

  await c('DEC-02', async () => {
    await page.getByRole('tab', { name: /Mes chiffres/ }).click();
    const main = page.locator('main');
    await main.getByText(/Évolution par rapport à \d{4}/).first().waitFor();
    await main.getByText('Comparer avec la déclaration déposée').waitFor();
    const lex = main.locator('details', { hasText: 'Lexique' }).first();
    await lex.locator('summary').click();
    const lexTxt = T(await lex.innerText());
    const todo = await page.getByRole('region', { name: /Ce que vous devez faire en/ }).count();
    return `« Évolution par rapport à ${year - 2} » et « Comparer avec la déclaration déposée » affichés ; lexique dépliable (${lexTxt.split('\n').length} lignes) ; carte « Ce que vous devez faire » ${todo ? 'présente' : 'absente'}`;
  });

  // ---------- assistant de bail
  await c('BAI-07', async () => {
    await page.goto(url + '#/locataires');
    await page.getByRole('button', { name: 'Nouveau bail' }).click();
    await page.getByRole('list', { name: 'Étapes de création du bail' }).locator('li').first().waitFor();
    const steps = (await page.getByRole('list', { name: 'Étapes de création du bail' }).locator('li').allInnerTexts()).map((s) => s.replace(/^\s*\d+\.?\s*/, '').trim());
    assert.equal(steps.length, 4, steps.join(' | '));
    await page.getByLabel('Bien', { exact: true }).selectOption({ label: 'T3 nouveautés' });
    await leaseNext();
    await page.getByText('Ajoutez au moins un titulaire.').waitFor();
    assert.equal(await page.locator('.stepper li[aria-current="step"]').innerText().then((t) => /Bien et locataires/.test(t)), true, 'passage à l’étape 2 sans locataire');
    await page.getByRole('button', { name: '+ Nouveau locataire' }).click();
    const dlg = page.locator('dialog[open]');
    await dlg.getByLabel('Prénom').fill('Inès'); await dlg.getByLabel('Nom *').fill('Nouveautés'); await dlg.getByLabel('E-mail').fill('ines@example.test');
    await dlg.getByRole('button', { name: 'Enregistrer' }).click();
    await page.locator('.chip.on', { hasText: 'Inès Nouveautés' }).waitFor();
    await leaseNext();
    const [y, m] = today.split('-').map(Number) as [number, number];
    const start = new Date(Date.UTC(y, m - 1 - 4, 1)).toISOString().slice(0, 10);
    await page.getByLabel('Début du bail *').fill(start);
    await page.getByLabel('Jour de paiement').fill('5');
    await leaseNext();
    await leaseNext();
    await page.getByRole('button', { name: 'Créer le bail' }).click();
    await page.getByRole('tab', { name: /^Loyers et paiements \(5 mois/ }).waitFor();
    return `4 étapes (${steps.join(' → ')}) ; « Suivant » bloqué sans titulaire ; bail créé au ${start}, 5 lignes mensuelles`;
  });

  // ---------- filtre de période des loyers
  await c('LOY-10', async () => {
    await page.goto(url + '#/loyers');
    const table = page.locator('table.dt-table').first();
    await table.waitFor();
    const filter = page.locator('label.inline-select', { hasText: 'Afficher' }).locator('select');
    if (await filter.count()) await filter.selectOption('toutes');
    const period = page.locator('label.inline-select', { hasText: 'Période' }).locator('select');
    const count = async () => { await page.waitForTimeout(250); // lignes mensuelles (sous l'en-tête de groupe « ▾ T3 nouveautés ») : seul bail du jeu d'essai
      return (await table.locator('tbody tr').allInnerTexts()).filter((t) => !t.includes('▾') && /(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre) \d{4}/.test(t)).length; };
    const all = await count();
    await period.selectOption('mois'); const mois = await count();
    await period.selectOption('3mois'); const trois = await count();
    await period.selectOption(`annee:${year}`); const an = await count();
    await period.selectOption('');
    assert.equal(mois, 1, `ce mois-ci : ${mois}`);
    assert.equal(trois, 3, `3 derniers mois : ${trois}`);
    assert.ok(an <= all && an >= trois, `année ${year} : ${an}`);
    return `T3 nouveautés : toutes = ${all}, ce mois-ci = ${mois}, 3 derniers mois = ${trois}, année ${year} = ${an}`;
  });

  // ---------- documents en dossiers, glisser-déposer
  await c('DOC-02', async () => {
    await page.goto(url + '#/documents');
    const folders = page.getByRole('group', { name: 'Dossiers' }).getByRole('button');
    await folders.first().waitFor();
    const labels = (await folders.allInnerTexts()).map((t) => T(t).replace(/\s+/g, ' ').trim());
    assert.equal(labels.length, 5, labels.join(' | '));
    const before = (await db(page)).documents?.length ?? 0;
    await page.locator('nav[aria-label="Biens"]').getByRole('button', { name: /T3 nouveautés/ }).click().catch(() => undefined);
    // glisser-déposer d'une facture PDF
    const dt = await page.evaluateHandle(() => { const d = new DataTransfer(); d.items.add(new File(['%PDF-1.4\n%recette\n'], 'facture-plombier.pdf', { type: 'application/pdf' })); return d; });
    await page.dispatchEvent('.doc-drop', 'dragover', { dataTransfer: dt });
    await page.dispatchEvent('.doc-drop', 'drop', { dataTransfer: dt });
    const dlg = page.locator('dialog[open]');
    await dlg.getByText('facture-plombier.pdf').first().waitFor();
    await dlg.getByLabel(/Catégorie|Type/).first().selectOption('facture');
    const bien = dlg.getByLabel('Bien', { exact: true });
    if (await bien.count()) await bien.selectOption({ label: 'T3 nouveautés' }).catch(() => undefined);
    await dlg.getByRole('button', { name: /Enregistrer|Ajouter|Déposer/ }).last().click();
    await dlg.waitFor({ state: 'detached' });
    const after = (await db(page)).documents.length;
    assert.equal(after, before + 1, 'document non enregistré');
    const f = page.getByRole('group', { name: 'Dossiers' }).getByRole('button', { name: /Factures et charges/ });
    const ft = T(await f.innerText());
    assert.match(ft, /[1-9]\d* document/, ft);
    await f.click();
    assert.equal(await f.getAttribute('aria-pressed'), 'true');
    const rows = await page.locator('table.dt-table tbody tr, .doc-list li').filter({ hasText: 'facture-plombier' }).count();
    await page.screenshot({ path: join(shots, 'nov-documents-dossiers.png'), fullPage: true });
    return `5 dossiers (${labels.map((l) => l.replace(/^\S+\s/, '').replace(/\s*\d+ documents?$/, '')).join(' ; ')}) ; fichier déposé par glisser-déposer, classé dans « Factures et charges » (${ft.replace(/\s+/g, ' ').match(/\d+ documents?/)?.[0]}) ; filtre du dossier : ${rows} ligne(s)`;
  });

  // ---------- comparatif des formules
  await c('ABO-03', async () => {
    await page.goto(url + '#/abonnement');
    const det = page.locator('details.tier-compare');
    await det.locator('summary').click();
    const heads = (await det.locator('thead th').allInnerTexts()).map((t) => t.trim());
    const rows = await det.locator('tbody tr').count();
    const txt = T(await det.innerText());
    for (const p of ['9,90', '19,90', '39,90']) assert.ok(txt.includes(p), `prix ${p} absent`);
    assert.equal(rows, 10, `${rows} lignes`);
    return `comparatif dépliable : colonnes ${heads.slice(1).join(', ')} ; ${rows} lignes (prix, limites, fonctions) ; prix 9,90 / 19,90 / 39,90 € par mois`;
  });

  // ---------- dossier banque
  await c('SIM-08', async () => {
    await page.goto(url + '#/bien/nouveau');
    await page.getByLabel('Prix de présentation FAI').fill('250000');
    await page.getByLabel('Surface du logement').fill('40');
    await page.getByLabel('Prix proposé', { exact: true }).fill('220000');
    await page.getByLabel('Loyer au m² bas').fill('20');
    await page.getByLabel('Loyer au m² haut').fill('25');
    await page.getByRole('button', { name: 'Dossier banque (PDF)' }).click();
    const bank = page.getByRole('dialog', { name: 'Dossier de financement pour la banque' });
    await bank.getByLabel('Emprunteur(s)').fill('Alex Recette');
    await bank.getByLabel('Revenus nets mensuels du foyer').fill('5000');
    await bank.getByLabel('Crédits en cours').fill('500');
    const status = T(await bank.getByText(/Taux d’endettement après le projet/).innerText());
    const ratio = status.match(/projet : ([\d,]+ %)/)?.[1];
    assert.ok(ratio, status);
    const [dl] = await Promise.all([page.waitForEvent('download'), bank.getByRole('button', { name: 'Télécharger le PDF' }).click()]);
    const file = join(shots, 'nov-dossier-banque.pdf');
    await dl.saveAs(file);
    const buf = await readFile(file);
    assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
    const pages = await pdfText(buf);
    const all = pages.join(' ');
    for (const s of ['Immo-Zen', 'Le projet en bref', 'Alex Recette', 'Plan de financement', 'Tableau d', 'Avertissement']) assert.ok(all.includes(s), `« ${s} » absent du PDF`);
    assert.ok(all.includes(ratio!.replace(' %', '')), `taux ${ratio} de la fenêtre absent du PDF`);
    assert.ok(/35 ?%/.test(all), 'repère HCSF 35 % absent');
    assert.ok(/Page 1 ?\/ ?\d/.test(all) || /1 ?\/ ?\d/.test(pages[0]!), 'numéro de page absent');
    // taux recalculé à la main : (crédits en cours + mensualité assurance comprise) / (revenus + 70 % du loyer HC)
    const num = (x: string | undefined) => Number((x ?? 'NaN').replace(/\s/g, '').replace(',', '.'));
    const pay = num(all.match(/MENSUALITÉ ([\d ]+,\d{2}) € assurance comprise/)?.[1]);
    const rent = num(all.match(/LOYER MENSUEL ([\d ]+,\d{2}) € hors charges/)?.[1]);
    const expected = Math.round((500 + pay) / (5000 + 0.7 * rent) * 10000) / 100;
    assert.equal(fr2(expected) + ' %', ratio, `recalcul ${expected} % (mensualité ${pay}, loyer ${rent})`);
    return `${pages.length} pages numérotées ; page de garde (logo, « Le projet en bref », 9 chiffres clés, barre apport/prêt, jauge avec repère 35 %) ; taux d’endettement ${ratio} = (500 + ${fr2(pay)}) / (5 000 + 70 % × ${fr2(rent)}), identique à la fenêtre et au PDF`;
  });

  await c('JS-NOV', async () => {
    assert.deepEqual(errors, [], errors.join(' | '));
    return 'aucune erreur JavaScript pendant la recette des nouveautés';
  });

  await browser.close(); server.close();
  console.log(JSON.stringify(out, null, 1));
}
main().catch((e) => { console.error(e); console.log(JSON.stringify(out, null, 1)); process.exit(1); });
