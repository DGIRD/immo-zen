/**
 * Parcours de bout en bout dans un vrai navigateur (Chromium), en mode démonstration.
 * Prérequis : `npm run build` (sans projet Supabase configuré → mode démonstration).
 * Usage : npm run test:e2e   — captures d'écran dans test-results/
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { chromium, type Page } from 'playwright';
import { csv, salesAround } from '../fixtures/dvf.ts';

const root = join(import.meta.dirname, '..', '..');
const dist = join(root, 'dist');
const out = join(root, 'test-results');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

async function serve(): Promise<{ url: string; close: () => void }> {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    const file = join(dist, path.endsWith('/') ? `${path}index.html` : path);
    if (!file.startsWith(dist) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('serveur');
  return { url: `http://127.0.0.1:${addr.port}/`, close: () => server.close() };
}

const results: { name: string; ok: boolean; error?: string }[] = [];
async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`OK   ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: String(e) });
    console.log(`ÉCHEC ${name}\n     ${String(e).split('\n').slice(0, 4).join('\n     ')}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=Test navigateur::${name} – ${String(e).split('\n').slice(0, 3).join(' ').replace(/\s+/g, ' ').slice(0, 400)}`);
  }
}

async function noHorizontalScroll(page: Page) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert.ok(sw <= iw + 1, `défilement horizontal : ${sw}px > ${iw}px`);
}

async function main() {
  if (!existsSync(join(dist, 'app', 'index.html'))) throw new Error('Lancez d’abord npm run build');
  await mkdir(out, { recursive: true });
  const { url: siteUrl, close } = await serve();
  // l'application est publiée sous /app/, le site vitrine à la racine
  const url = siteUrl + 'app/';
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  // services d'adresses publics simulés (aucun appel réseau pendant les tests)
  await ctx.route('https://data.geopf.fr/geocodage/**', (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ features: [
    { geometry: { coordinates: [2.441, 48.861] }, properties: { label: '12 Rue de Paris 93100 Montreuil', name: '12 Rue de Paris', postcode: '93100', city: 'Montreuil', citycode: '93048', type: 'housenumber' } },
    { geometry: { coordinates: [2.39, 48.84] }, properties: { label: '12 Rue de Paris 75012 Paris', name: '12 Rue de Paris', postcode: '75012', city: 'Paris', citycode: '75112', type: 'housenumber' } },
  ] }) }));
  // ventes DVF simulées : 18 appartements autour du 12 rue de Paris à Montreuil, 5 000 €/m² en médiane
  const dvfFiles: string[] = [];
  await ctx.route('https://files.data.gouv.fr/geo-dvf/**', (r) => {
    const u = r.request().url();
    dvfFiles.push(u);
    return u.endsWith('/2025/communes/93/93048.csv')
      ? r.fulfill({ contentType: 'text/csv', headers: { 'access-control-allow-origin': '*' }, body: csv(salesAround(18, 5000, { lat: 48.861, lon: 2.441, date: '2025-04-10' })) })
      : r.fulfill({ contentType: 'text/csv', headers: { 'access-control-allow-origin': '*' }, body: csv([]) }); // aucune vente ces années-là
  });
  await ctx.route('https://geo.api.gouv.fr/communes**', (r) => {
    const zip = new URL(r.request().url()).searchParams.get('codePostal');
    const list = zip === '93100' ? [{ nom: 'Montreuil' }] : zip === '75018' ? [{ nom: 'Paris' }] : [];
    return r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(list) });
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await step('site vitrine : raison d’être, calculateur, contact, lien vers l’espace client', async () => {
    await page.goto(siteUrl);
    await page.getByRole('heading', { level: 1, name: /Achetez au bon prix/ }).waitFor();
    const fig = page.locator('#cf');
    const before = await fig.innerText();
    await page.getByLabel('Loyer hors charges').fill('1200');
    assert.notEqual(await fig.innerText(), before, 'le calculateur se met à jour');
    assert.match((await fig.innerText()).replace(/[\u202f\u00a0]/g, ' '), /^[+−]\d[\d ]* €$/);
    await page.getByText('Offre limitée à 30 jours').waitFor();
    await page.getByText('pendant 30 jours, sans carte bancaire', { exact: true }).waitFor();
    await page.getByText(/s’autofinance|Effort d’épargne/).first().waitFor();
    await page.getByRole('heading', { name: /Investisseur débutant/ }).waitFor();
    assert.equal(await page.getByRole('heading', { name: /Investisseur expert/ }).isVisible(), false, 'un seul profil affiché');
    await page.getByRole('tab', { name: /Je pilote un patrimoine/ }).click();
    await page.getByRole('heading', { name: /Investisseur expert/ }).waitFor();
    assert.equal(await page.getByRole('heading', { name: /Investisseur débutant/ }).isVisible(), false, 'changement de profil');
    await page.getByRole('heading', { name: 'Votre déclaration, case par case' }).waitFor();
    await page.getByText('Un espace pour vos locataires').waitFor();
    await page.screenshot({ path: join(out, '29-site.png'), fullPage: true });
    await page.getByRole('button', { name: 'Envoyer ma demande' }).click();
    await page.getByText('Indiquez votre nom.').waitFor();
    await page.getByLabel('Votre nom').fill('Marie Test');
    await page.getByLabel('E-mail').fill('marie@example.test');
    await page.getByRole('button', { name: 'Envoyer ma demande' }).click();
    await page.getByText(/Formulaire indisponible pour le moment/).waitFor();
    await page.getByRole('link', { name: 'Mentions légales' }).click();
    await page.getByRole('heading', { name: 'Confidentialité et données personnelles' }).waitFor();
    await page.getByRole('link', { name: 'Espace client' }).first().click();
    await page.waitForURL(/\/app\/$/);
    const m = await browser.newContext({ locale: 'fr-FR', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mp = await m.newPage();
    await mp.goto(siteUrl);
    await noHorizontalScroll(mp);
    await mp.getByRole('button', { name: 'Menu' }).click();
    await mp.getByLabel('Navigation du site').getByRole('link', { name: 'Espace client' }).waitFor();
    await mp.screenshot({ path: join(out, '30-site-mobile.png'), fullPage: true });
    await m.close();
  });

  await step('ouverture en mode démonstration, bannière visible', async () => {
    await page.goto(url);
    await page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
    await page.getByText('Mode démonstration').first().waitFor();
    await page.screenshot({ path: join(out, '01-tableau-de-bord-vide.png') });
  });

  await step('menu complet, sans états des lieux', async () => {
    const labels = await page.locator('#main-nav a').allInnerTexts();
    for (const l of ['Tableau de bord', 'Prospection', 'Mes biens', 'Locataires et baux', 'Loyers et paiements', 'Dépenses', 'Contacts', 'Documents', 'Déclaration fiscale', 'Mon abonnement', 'Paramètres']) {
      assert.ok(labels.some((x) => x.includes(l)), `menu : ${l}`);
    }
    assert.ok(!labels.some((x) => x.includes('Simulateur')), 'plus de menu Simulateur : la simulation est celle de chaque bien');
    const js = await page.evaluate(async () => {
      const src = (document.querySelector('script[type=module]') as HTMLScriptElement).src;
      return (await fetch(src)).text();
    });
    assert.ok(!/[ée]tats? des lieux/i.test(js), 'aucune mention des états des lieux dans le code livré');
    assert.ok(!/etat-des-lieux|etats-des-lieux|edl/i.test(await page.content()), 'aucune route états des lieux');
  });

  await step('prospection et simulation en une seule saisie : fiche, suivi, estimation DVF', async () => {
    await page.goto(url + '#/prospection');
    await page.getByRole('button', { name: 'Ajouter un premier bien' }).click();
    await page.getByRole('heading', { name: 'Le bien' }).waitFor();
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await page.getByText('Donnez un titre au bien.').waitFor();
    await page.getByLabel('Titre du bien *').fill('T3 test balcon');
    await page.getByRole('combobox', { name: 'Adresse' }).fill('12 rue de Par');
    await page.getByRole('option', { name: '12 Rue de Paris 93100 Montreuil' }).click();
    assert.equal(await page.getByLabel('Code postal').inputValue(), '93100', 'code postal rempli par la saisie automatique');
    assert.equal(await page.getByLabel('Ville').inputValue(), 'Montreuil');
    assert.equal(await page.getByRole('combobox', { name: 'Adresse' }).inputValue(), '12 Rue de Paris');
    await page.getByLabel('Lien de l’annonce').fill('ftp://x');
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await page.getByText(/Le lien de l’annonce doit commencer/).waitFor();
    await page.getByLabel('Lien de l’annonce').fill('');
    await page.getByLabel('Prix de présentation FAI').fill('320 000');
    await page.getByLabel('Surface du logement').fill('62,5');
    await page.getByLabel('Prix proposé', { exact: true }).fill('300000');
    await page.getByRole('radio', { name: 'Saisie libre' }).click();
    await page.getByLabel('Loyer hors charges', { exact: true }).fill('1350');
    // estimation par les ventes publiques DVF
    await page.getByRole('button', { name: 'Estimer avec les ventes DVF' }).click();
    await page.getByText(/DVF 2025–2025, 18 ventes d'appartements à moins de 300 m/).waitFor();
    const est = (await page.locator('.estimate').innerText()).replace(/[\u202f\u00a0]/g, ' ');
    assert.match(est, /\d[\d ]* € – \d[\d ]* €/, `fourchette affichée : ${est}`);
    assert.match(est, /en dessous de l’estimation médiane \(313 000 €\)/, 'écart prix proposé / estimation');
    assert.ok(dvfFiles.some((u) => u.endsWith('/2025/communes/93/93048.csv')), 'fichier DVF de la commune lu');
    await page.getByRole('button', { name: /Voir les ventes comparables/ }).click();
    assert.equal(await page.locator('.estimate tbody tr').count(), 10, '10 ventes comparables');
    // suivi saisi au même endroit
    await page.getByLabel('Agence', { exact: true }).selectOption({ label: '+ Nouvelle agence…' });
    await page.getByLabel('Nom de la nouvelle agence').fill('Agence Test');
    await page.getByLabel('Date de relance').fill('2020-01-01');
    await page.getByLabel('Points de vigilance (un par ligne)').fill('Toiture à vérifier');
    await page.screenshot({ path: join(out, '31-fiche-unique-estimation.png'), fullPage: true });
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await page.getByText('Bien « T3 test balcon » ajouté à la prospection avec sa simulation.').waitFor();
    // la fiche du bien reprend tout, sans second formulaire
    await page.goto(url + '#/prospection');
    await page.getByRole('button', { name: 'T3 test balcon' }).first().click();
    await page.getByRole('heading', { name: 'T3 test balcon' }).waitFor();
    const fig = (await page.locator('.figures').first().innerText()).replace(/[\u202f\u00a0]/g, ' ');
    assert.match(fig, /Prix de présentation FAI[\s\S]*320 000 €[\s\S]*300 000 €[\s\S]*Estimation DVF/, fig);
    await page.getByText('Agence Test').first().waitFor();
    await page.getByText('Toiture à vérifier').first().waitFor();
    assert.equal(await page.getByRole('button', { name: 'Modifier', exact: true }).count(), 0, 'plus de formulaire séparé pour un bien en prospection');
    await page.getByRole('button', { name: 'Modifier la fiche et la simulation' }).click();
    await page.getByRole('heading', { name: 'Le bien' }).waitFor();
    assert.equal(await page.getByLabel('Titre du bien *').inputValue(), 'T3 test balcon');
    assert.equal(await page.getByLabel('Date de relance').inputValue(), '2020-01-01');
    assert.equal(await page.getByLabel('Agence', { exact: true }).locator('option:checked').innerText(), 'Agence Test');
    await page.goto(url + '#/bien/' + (await page.evaluate(() => JSON.parse(localStorage.getItem('immozen:demo:v1')!).properties.find((p: { title: string }) => p.title === 'T3 test balcon').id)));
    await page.getByRole('tab', { name: /Historique/ }).click();
    await page.getByText('Bien ajouté à la prospection').first().waitFor();
  });

  await step('annonce : surface dans la fiche, caractéristiques reprises depuis le texte de l’annonce', async () => {
    await page.goto(url + '#/bien/nouveau');
    await page.getByRole('heading', { name: 'Le bien' }).waitFor();
    const bien = page.locator('section', { has: page.getByRole('heading', { name: 'Le bien' }) });
    await bien.getByLabel('Surface du logement').waitFor();
    await bien.getByLabel('Prix de présentation FAI').waitFor();
    const order = await page.locator('h2').allInnerTexts();
    assert.ok(order.indexOf('Suivi des actions') > order.indexOf('Loyers et charges'), `suivi après la simulation : ${order.join(' > ')}`);
    await page.getByLabel('Lien de l’annonce').fill('https://www.exemple-annonces.fr/annonce/123');
    await page.getByRole('button', { name: 'Remplir depuis l’annonce' }).click();
    await page.getByText(/Collez le texte de l’annonce/).first().waitFor();
    await page.getByLabel('Texte de l’annonce').fill(['Appartement 3 pièces 62 m²', 'Lyon 7e (69007)', '285 000 €', '2 chambres, 3e étage.',
      'Charges de copropriété : 150 € par mois', 'Taxe foncière : 1 100 €', 'DPE : C'].join('\n'));
    await page.getByRole('button', { name: 'Analyser le texte' }).click();
    const box = page.getByRole('region', { name: 'Remplir depuis l’annonce' });
    await box.getByText('Dans l’annonce').waitFor();
    assert.match((await box.innerText()).replace(/[\u202f\u00a0]/g, ' '), /1 800/, 'charges mensuelles converties en annuel');
    await box.getByRole('button', { name: /^Reprendre dans la fiche \(\d+\)$/ }).click();
    await page.getByText(/reprises? de l’annonce/).first().waitFor();
    assert.equal(await page.getByLabel('Titre du bien *').inputValue(), 'Appartement 3 pièces 62 m²');
    assert.equal(await bien.getByLabel('Surface du logement').inputValue(), '62');
    assert.equal(await page.getByLabel('Pièces').inputValue(), '3');
    assert.equal(await page.getByLabel('Code postal').inputValue(), '69007');
    assert.equal(await page.getByLabel('DPE').inputValue(), 'C');
    assert.match((await page.getByLabel('Prix de présentation FAI').inputValue()).replace(/\s/g, ''), /^285000/);
    assert.match((await page.getByLabel('Taxe foncière', { exact: true }).inputValue()).replace(/\s/g, ''), /^1100/);
    assert.match(await page.getByLabel('Commentaires').inputValue(), /2 chambres, 3e étage/);
    await page.screenshot({ path: join(out, '37-annonce.png'), fullPage: true });
  });

  await step('une seule simulation par bien, modifiable depuis la fiche', async () => {
    await page.goto(url + '#/prospection');
    await page.getByRole('button', { name: 'T3 test balcon' }).first().click();
    await page.getByRole('button', { name: 'Modifier la fiche et la simulation' }).click();
    await page.getByLabel('Apport').fill('40000');
    await page.getByLabel('Taxe foncière').fill('1100');
    const cash = await page.locator('.cashflow strong').innerText();
    assert.match(cash, /€/);
    await page.screenshot({ path: join(out, '02-simulateur.png'), fullPage: true });
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await page.getByText('Bien et simulation enregistrés.').waitFor();
    assert.equal(await page.getByRole('button', { name: /nouveau scénario/i }).count(), 0, 'pas de second scénario');
    assert.equal(await page.getByLabel('Nom du scénario').count(), 0);
    const d = await page.evaluate(() => JSON.parse(localStorage.getItem('immozen:demo:v1')!));
    const t3 = d.properties.find((p: { title: string }) => p.title === 'T3 test balcon');
    assert.equal(d.scenarios.filter((x: { property_id: string }) => x.property_id === t3.id).length, 1, 'une seule simulation enregistrée pour le bien');
    await page.getByRole('button', { name: 'Par année' }).click();
    assert.ok(await page.locator('table.compact tbody tr').count() === 20, '20 lignes annuelles');
    await page.getByRole('button', { name: 'Voir la fiche' }).click();
    await page.getByRole('tab', { name: 'Simulation', exact: true }).click();
    await page.getByRole('button', { name: 'Modifier la simulation' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Nouvelle simulation' }).count(), 0, 'pas de nouvelle simulation possible');
    await page.getByRole('button', { name: 'Modifier la simulation' }).click();
    await page.getByRole('heading', { name: 'Modifier « T3 test balcon »' }).waitFor();
  });

  await step('valeurs invalides bloquent l’enregistrement', async () => {
    await page.getByLabel('Durée').fill('0');
    await page.getByText('Durée entière entre 1 et 40 ans.').first().waitFor();
    assert.ok(await page.getByRole('button', { name: 'Enregistrer', exact: true }).isDisabled());
    await page.getByLabel('Durée').fill('20');
  });

  await step('simulation : négociation, loyer au m² bas/haut, charges de copropriété à 80 %', async () => {
    await page.goto(url + '#/bien/nouveau');
    const val = async (label: string, expected?: string) => {
      // attend que la valeur proposée soit affichée (machines lentes)
      const field = page.getByLabel(label, { exact: true });
      for (let i = 0; expected !== undefined && i < 50 && (await field.inputValue()) !== expected; i++) await page.waitForTimeout(100);
      return field.inputValue();
    };
    const shown = async (id: string) => (await page.locator(`output[aria-labelledby="${id}"]`).innerText()).replace(/[\u202f\u00a0]/g, ' ');
    assert.equal(await val('Assurance PNO'), '99', 'PNO à 99 € par défaut');
    await page.getByLabel('Prix de présentation FAI').fill('250000');
    await page.getByLabel('Surface du logement').fill('40');
    await page.getByLabel('Prix proposé', { exact: true }).fill('220000');
    const nego = await shown('nego');
    assert.match(nego, /20 000 €\s*soit 8,00 %/, `négociation en montant et en % : ${nego}`);
    await page.getByLabel('Loyer au m² bas').fill('20');
    await page.getByLabel('Loyer au m² haut').fill('25');
    assert.match(await shown('rent-hc'), /800,00 €/);
    await page.getByRole('radio', { name: 'Haut' }).click();
    assert.match(await shown('rent-hc'), /1 000,00 €/);
    await page.getByLabel('Charges de copropriété').fill('1000');
    assert.equal(await val('dont récupérables', '800'), '800');
    assert.equal(await val('Provision sur charges', '67'), '67');
    assert.match(await shown('rent-cc'), /1 067,00 €/, 'loyer charges comprises');
    await page.getByLabel('Provision sur charges').fill('50');
    await page.getByLabel('Charges de copropriété').fill('1200');
    assert.equal(await val('dont récupérables', '960'), '960', 'part récupérable recalculée');
    assert.equal(await val('Provision sur charges', '50'), '50', 'valeur modifiée à la main conservée');
    await page.screenshot({ path: join(out, '19-simulateur-loyer-m2.png'), fullPage: true });
    // la simulation alimente la prospection
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await page.getByText('Donnez un titre au bien').last().waitFor();
    await page.getByLabel('Titre du bien *').fill('Studio simulé');
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await page.getByText('ajouté à la prospection').first().waitFor();
    await page.goto(url + '#/prospection');
    const row = page.locator('tbody tr', { hasText: 'Studio simulé' });
    await row.waitFor();
    assert.match((await row.innerText()).replace(/[\u202f\u00a0]/g, ' '), /250 000 €/, 'prix de présentation repris dans la prospection');
  });

  await step('tableau prospection : rendement, cash-flow, relance', async () => {
    await page.goto(url + '#/prospection');
    const row = page.locator('tbody tr', { hasText: 'T3 test balcon' });
    await row.waitFor();
    const text = (await row.innerText()).replace(/[\u202f\u00a0]/g, ' ');
    assert.match(text, /4,87 %/, 'rendement brut affiché (16 200 / 332 500)');
    assert.match(text, /4 800 €/, 'prix au m² (300 000 / 62,5)');
    assert.match(text, /-\d+,\d+ %/, `écart prix proposé / estimation DVF : ${text}`);
    await page.getByLabel(/Relances à faire/).check();
    assert.ok(await page.locator('tbody tr', { hasText: 'T3 test balcon' }).count() === 1);
    await page.getByLabel(/Relances à faire/).uncheck();
    await page.screenshot({ path: join(out, '03-prospection.png') });
  });

  await step('colonnes personnalisables et tri', async () => {
    await page.getByText('Colonnes', { exact: true }).click();
    await page.locator('.menu-columns').getByLabel('Agence').check();
    await page.locator('thead').getByText('Agence').waitFor();
    await page.getByText('Colonnes', { exact: true }).click();
    await page.locator('thead').getByRole('button', { name: /Prix de présentation FAI/ }).click();
    assert.equal(await page.locator('thead th[aria-sort="ascending"]').count(), 1);
  });

  let duplicateOk = false;
  await step('duplication et comparaison', async () => {
    const row = page.locator('tbody tr', { hasText: 'T3 test balcon' }).first();
    await row.getByLabel('Actions').click();
    await row.getByRole('menuitem', { name: 'Dupliquer' }).click();
    await page.getByRole('heading', { name: 'T3 test balcon (copie)' }).waitFor();
    await page.goto(url + '#/prospection');
    await page.getByLabel('Tout sélectionner sur cette page').check();
    await page.getByRole('button', { name: 'Comparer' }).click();
    await page.getByRole('heading', { name: 'Comparer les biens' }).waitFor();
    await page.screenshot({ path: join(out, '04-comparaison.png') });
    await page.locator('dialog[open]').getByRole('button', { name: 'Fermer' }).click();
    duplicateOk = true;
  });

  await step('export Excel réel (.xlsx) et CSV', async () => {
    const [xlsx] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Excel (.xlsx)' }).click()]);
    assert.match(xlsx.suggestedFilename(), /\.xlsx$/);
    const buf = await readFile((await xlsx.path())!);
    const zip = await JSZip.loadAsync(buf);
    assert.ok(zip.file('xl/workbook.xml') && zip.file('xl/worksheets/sheet1.xml'), 'structure OOXML');
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    assert.ok(sheet.includes('T3 test balcon'));
    assert.ok(!buf.subarray(0, 100).toString().includes('<html'), 'pas un HTML renommé');
    await xlsx.saveAs(join(out, 'export-prospection.xlsx'));
    const [csv] = await Promise.all([page.waitForEvent('download'), page.locator('.export-row').getByRole('button', { name: 'CSV' }).click()]);
    const text = await readFile((await csv.path())!, 'utf8');
    assert.ok(text.startsWith('﻿Titre;'), 'CSV UTF-8 avec en-tête');
    assert.match(text, /300000,00/);
  });

  let propertyId = '';
  await step('passage à « Acquis » : transfert vers Mes biens sans duplication', async () => {
    await page.goto(url + '#/prospection');
    await page.getByRole('button', { name: 'T3 test balcon', exact: true }).first().click();
    propertyId = page.url().split('/bien/')[1]!;
    await page.getByRole('button', { name: 'Marquer comme acquis' }).click();
    await page.getByRole('button', { name: 'Transférer dans Mes biens' }).click();
    await page.getByText('est maintenant dans Mes biens').waitFor();
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('immozen:demo:v1')!).properties.length);
    await page.goto(url + '#/prospection');
    await page.locator('.datatable').waitFor();
    assert.equal(await page.locator('tbody tr', { hasText: /^T3 test balcon$/ }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'T3 test balcon', exact: true }).count(), 0, 'absent de la prospection');
    await page.goto(url + '#/biens');
    await page.getByRole('button', { name: 'T3 test balcon', exact: true }).first().click();
    assert.equal(page.url().split('/bien/')[1], propertyId, 'même identifiant');
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('immozen:demo:v1')!).properties.length);
    assert.equal(after, before, 'aucun bien créé');
    await page.getByText('Photographie à l’acquisition').waitFor();
    await page.getByRole('tab', { name: /Historique/ }).click();
    await page.getByText('Bien acquis : transféré dans Mes biens').waitFor();
    await page.getByText('Bien ajouté à la prospection').waitFor();
    await page.screenshot({ path: join(out, '05-fiche-bien-acquis.png'), fullPage: true });
    // Mes biens : fourchette d'estimation du prix actuel à la place des prix affiché et proposé
    await page.getByRole('tab', { name: /Synthèse/ }).click().catch(() => undefined);
    const figs = (await page.locator('.figures').first().innerText()).replace(/[\u202f\u00a0]/g, ' ');
    assert.ok(!/Prix de présentation|Prix proposé|Prix affiché/.test(figs), `plus de prix affiché ni proposé : ${figs}`);
    assert.match(figs, /Estimation du prix actuel/);
    await page.getByRole('heading', { name: 'Estimation du prix actuel' }).waitFor();
    await page.getByRole('button', { name: 'Recalculer avec les ventes DVF' }).click();
    await page.getByText(/calculée le/).first().waitFor();
    await page.goto(url + '#/biens');
    const ownedRow = page.locator('tbody tr', { hasText: 'T3 test balcon' });
    assert.match((await ownedRow.innerText()).replace(/[\u202f\u00a0]/g, ' '), /\d[\d ]* € – \d[\d ]* €/, 'fourchette dans le tableau Mes biens');
    assert.equal(await page.locator('thead').getByText(/Prix affiché|Prix proposé|Prix de présentation/).count(), 0);
    // un ancien lien vers le simulateur ouvre la simulation du bien, sans liste de biens à choisir
    await page.goto(url + '#/simulateur');
    await page.getByRole('heading', { name: 'Ajouter un bien en prospection' }).waitFor();
    assert.equal(await page.getByLabel('Bien', { exact: true }).count(), 0, 'plus de choix du bien dans la simulation');
  });

  await step('ajout direct d’un bien déjà détenu', async () => {
    await page.goto(url + '#/biens');
    await page.getByRole('button', { name: 'Ajouter un bien détenu' }).first().click();
    await page.getByLabel('Titre *').fill('Parking détenu');
    for (const absent of ['Lien de l’annonce', 'Prix affiché', 'Prix proposé', 'Budget travaux']) {
      assert.equal(await page.getByLabel(absent).count(), 0, `champ absent : ${absent}`);
    }
    await page.getByRole('heading', { name: 'Loyer', exact: true }).waitFor();
    await page.getByLabel('Loyer hors charges').fill('780');
    await page.getByLabel('Provision sur charges').fill('45,50');
    const cc = (await page.locator('output[aria-labelledby="loyer-cc"]').innerText()).replace(/[\u202f\u00a0]/g, ' ');
    assert.match(cc, /825,50 €/, 'loyer charges comprises calculé');
    await page.getByLabel('Taxe foncière').fill('900');
    await page.getByLabel('Charges de copropriété').fill('1200');
    await page.getByLabel('Assurance PNO').fill('99');
    assert.match((await page.locator('output[aria-labelledby="charges-total"]').innerText()).replace(/[\u202f\u00a0]/g, ' '), /2 199,00 €/, 'total des charges annuelles');
    await page.getByLabel('Montant emprunté').fill('100000');
    await page.getByLabel('Durée').fill('15');
    await page.getByLabel('Assurance emprunteur').fill('20');
    await page.getByLabel('Mensualité hors assurance').fill('500');
    assert.match((await page.locator('output[aria-labelledby="loan-total"]').innerText()).replace(/[\u202f\u00a0]/g, ' '), /520,00 €/, 'mensualité assurance comprise');
    await page.getByLabel('Mode de détention').selectOption('nom_propre');
    await page.getByRole('button', { name: 'Enregistrer' }).first().click();
    await page.getByRole('heading', { name: 'Parking détenu' }).waitFor();
    await page.getByText('Loyer charges comprises').waitFor();
    assert.match((await page.locator('.kv').innerText()).replace(/[\u202f\u00a0]/g, ' '), /825,50 € \/ mois/);
    // cash-flow = 825,50 − 2 199 / 12 − 520 = 122,25 €
    assert.match((await page.locator('.figures').first().innerText()).replace(/[\u202f\u00a0]/g, ' '), /122 €/, 'cash-flow du bien avec crédit');
    await page.goto(url + '#/biens');
    await page.getByRole('button', { name: 'Parking détenu' }).waitFor();
    assert.match((await page.locator('tbody tr', { hasText: 'Parking détenu' }).innerText()).replace(/[\u202f\u00a0]/g, ' '), /122 €/);
    await page.screenshot({ path: join(out, '06-mes-biens.png') });
    await page.goto(url + '#/');
    const fig = (await page.locator('.figure', { hasText: 'Cash-flow prévisionnel' }).innerText()).replace(/[\u202f\u00a0]/g, ' ');
    assert.match(fig, /-?\d[\d ]* €/, `cash-flow du tableau de bord calculé : ${fig}`);
    assert.doesNotMatch(fig, /sans loyer/, 'tous les biens détenus ont un cash-flow');
    await page.screenshot({ path: join(out, '20-tableau-de-bord.png') });
  });

  await step('conflit : une modification concurrente n’écrase rien en silence', async () => {
    await page.goto(url + `#/bien/${propertyId}/modifier`);
    await page.getByLabel('Titre *').fill('Titre local');
    // modification « depuis un autre appareil »
    await page.evaluate((id) => {
      const db = JSON.parse(localStorage.getItem('immozen:demo:v1')!);
      const p = db.properties.find((x: { id: string }) => x.id === id);
      p.title = 'Titre distant'; p.version += 1;
      localStorage.setItem('immozen:demo:v1', JSON.stringify(db));
    }, propertyId);
    await page.getByRole('button', { name: 'Enregistrer' }).first().click();
    await page.getByRole('heading', { name: 'Modification concurrente' }).waitFor();
    await page.getByRole('button', { name: 'Recharger la version enregistrée' }).click();
    const title = await page.evaluate((id) => JSON.parse(localStorage.getItem('immozen:demo:v1')!).properties.find((x: { id: string }) => x.id === id).title, propertyId);
    assert.equal(title, 'Titre distant');
  });

  await step('contacts : agence créée depuis le bien, échanges', async () => {
    await page.goto(url + '#/contacts');
    await page.getByRole('button', { name: 'Agence Test' }).click();
    await page.getByText(/Biens liés \(\d\)/).waitFor();
    await page.getByLabel('Compte rendu').fill('Appel : dossier complet envoyé');
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await page.getByText('Appel : dossier complet envoyé').waitFor();
  });

  await step('sauvegarde JSON puis réimport sans doublon', async () => {
    await page.goto(url + '#/parametres');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Télécharger une sauvegarde (.json)' }).click()]);
    const file = join(out, 'sauvegarde.json');
    await dl.saveAs(file);
    await page.locator('input[type=file]').setInputFiles(file);
    await page.getByRole('heading', { name: /Importer/ }).waitFor();
    const cells = await page.locator('.modal tbody tr').first().locator('td').allInnerTexts();
    assert.equal(cells[1], '0', 'aucun bien ajouté');
    assert.notEqual(cells[2], '0', 'doublons détectés');
    await page.getByRole('button', { name: 'Annuler' }).click();
  });

  await step('reprise des simulations de l’ancienne version restées dans le navigateur', async () => {
    await page.evaluate(() => localStorage.setItem('idf-invest-v6:abc', JSON.stringify({ simulations: [{ id: '9b2c1f00-0000-4000-8000-000000000001', number: 'SIM-2026-0007', title: 'Ancienne simulation', status: 'Offre en cours', surface: 30, offerPrice: 140000, loanYears: 20, rentLevel: 'Personnalisé', customRent: 700, agency: 'agence test', archived: false }] })));
    await page.reload();
    await page.getByText('1 simulation(s) de l’ancienne version').waitFor();
    page.once('download', () => undefined);
    await page.getByRole('button', { name: 'Reprendre ces simulations' }).click();
    await page.getByRole('button', { name: 'Reprendre', exact: true }).click();
    await page.getByText('1 simulation(s) de l’ancienne version reprise(s).').waitFor();
    const db = await page.evaluate(() => JSON.parse(localStorage.getItem('immozen:demo:v1')!));
    const p = db.properties.find((x: { title: string }) => x.title === 'Ancienne simulation');
    assert.equal(p.status, 'offre_transmise');
    assert.equal(db.pro_contacts.filter((c: { kind: string }) => c.kind === 'agence').length, 1, 'agence dédoublonnée');
    await page.getByText('Aucune simulation de l’ancienne version en attente').waitFor();
  });

  let leaseUrl = '';
  await step('bail : création avec nouveau locataire, échéances générées', async () => {
    await page.goto(url + '#/locataires');
    await page.getByRole('button', { name: 'Nouveau bail' }).click();
    await page.getByLabel('Bien', { exact: true }).selectOption({ label: 'Parking détenu' });
    await page.getByRole('button', { name: '+ Nouveau locataire' }).click();
    const dlg = page.locator('dialog[open]');
    await dlg.getByLabel('Prénom').fill('Léa');
    await dlg.getByLabel('Nom *').fill('Martin');
    await dlg.getByLabel('E-mail').fill('lea@example.test');
    await dlg.getByRole('button', { name: 'Enregistrer' }).click();
    await page.locator('.chip.on', { hasText: 'Léa Martin' }).waitFor();
    const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date()));
    const [y, m] = today.split('-').map(Number) as [number, number];
    const d = new Date(Date.UTC(y, m - 3, 1));
    const start = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
    await page.getByLabel('Début du bail *').fill(start);
    await page.getByLabel('Jour de paiement').fill('1');
    assert.match((await page.locator('output.computed').innerText()).replace(/[\u202f\u00a0]/g, ' '), /825,50 €/, 'loyer CC repris du bien');
    await page.getByRole('button', { name: 'Enregistrer' }).first().click();
    await page.getByRole('tab', { name: 'Échéances (3)' }).waitFor();
    leaseUrl = page.url();
    await page.screenshot({ path: join(out, '13-bail.png'), fullPage: true });
  });

  await step('paiement : réparti sur plusieurs échéances, partiel', async () => {
    await page.getByRole('button', { name: 'Enregistrer un paiement' }).first().click();
    const dlg = page.locator('dialog[open]');
    await dlg.getByLabel('Montant reçu').fill('1000');
    await dlg.getByText('Non affecté').count();
    await dlg.getByRole('button', { name: 'Enregistrer le paiement' }).click();
    await page.getByText('Paiement enregistré.').waitFor();
    const rows = page.locator('table.dt-table tbody tr');
    await page.locator('.status', { hasText: /^Payée$/ }).first().waitFor();
    assert.equal(await rows.filter({ has: page.locator('.status', { hasText: /^Payée$/ }) }).count(), 1);
    assert.equal(await rows.filter({ has: page.locator('.status', { hasText: /^Partiel/ }) }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Émettre la quittance' }).count(), 1, 'quittance proposée uniquement pour la période réglée');
  });

  await step('quittance : émission unique, aperçu et PDF réel', async () => {
    await page.getByRole('button', { name: 'Émettre la quittance' }).click();
    const dlg = page.locator('dialog[open]');
    await dlg.getByRole('heading', { name: /Quittance Q-\d{4}-0001/ }).waitFor();
    await dlg.locator('iframe.pdf-frame').waitFor();
    const [pdf] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: 'Télécharger le PDF' }).click()]);
    const buf = await readFile((await pdf.path())!);
    assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
    await pdf.saveAs(join(out, 'quittance.pdf'));
    await dlg.getByRole('button', { name: 'Envoyer au locataire' }).click();
    await page.getByText(/aucun e-mail n’est envoyé/).first().waitFor();
    await page.locator('dialog[open]').waitFor({ state: 'detached', timeout: 5000 }).catch(() => undefined);
    assert.equal(await page.locator('dialog[open]').count(), 0, 'la fenêtre de la quittance se ferme après l’envoi');
    assert.equal(await page.getByRole('button', { name: 'Émettre la quittance' }).count(), 0);
    await page.getByRole('button', { name: /Quittance Q-/ }).waitFor();
    await page.getByRole('button', { name: 'Reçu partiel' }).click();
    await page.locator('dialog[open]').getByRole('heading', { name: /Reçu R-\d{4}-0001/ }).waitFor();
    await page.locator('dialog[open]').getByRole('button', { name: 'Fermer' }).click();
  });

  await step('confirmation : date du jour proposée par défaut et signalée', async () => {
    const row = page.locator('table.dt-table tbody tr').first();
    await row.getByRole('button', { name: 'Confirmer le paiement' }).click();
    const dlg = page.locator('dialog[open]');
    await dlg.getByText('Date du jour proposée par défaut').waitFor();
    await dlg.getByText(/sans confirmation, le loyer reste impayé/).waitFor();
    await dlg.getByRole('button', { name: 'Confirmer le paiement' }).click();
    await page.getByText('Paiement confirmé.').waitFor();
    await page.getByRole('tab', { name: /Paiements/ }).click();
    await page.getByText('date par défaut').first().waitFor();
    await page.screenshot({ path: join(out, '14-paiements.png'), fullPage: true });
  });

  await step('relance amiable : aperçu avant envoi, montant dû', async () => {
    await page.getByRole('tab', { name: /Relances/ }).click();
    await page.getByRole('button', { name: 'Préparer une relance' }).click();
    const dlg = page.locator('dialog[open]');
    const body = await dlg.getByLabel('Message').inputValue();
    assert.match(body, /Léa Martin/);
    assert.match(body.replace(/[\u202f\u00a0]/g, ' '), /651,00 €/, 'reste dû du mois partiellement payé');
    assert.doesNotMatch(body, /pénalit/i);
    await dlg.getByRole('button', { name: 'Envoyer par e-mail' }).click();
    await page.getByText(/Relance mise en file/).waitFor();
    await page.getByText('Envoi en attente').first().waitFor();
  });

  await step('dépôt de garantie : suivi séparé', async () => {
    await page.getByRole('tab', { name: 'Dépôt de garantie' }).click();
    await page.getByLabel('Montant', { exact: true }).fill('780');
    await page.getByRole('button', { name: 'Ajouter le mouvement' }).click();
    await page.locator('.kv').getByText('780,00').first().waitFor();
    const balance = (await page.locator('.figure', { hasText: 'Solde du locataire' }).innerText()).replace(/[\u202f\u00a0]/g, ' ');
    assert.match(balance, /-651,00 €/, 'dépôt exclu du solde des loyers');
  });

  await step('rappel de charges 2025, import de loyers Excel et quittance avec rappel', async () => {
    await page.goto(leaseUrl);
    await page.getByRole('tab', { name: /Échéances/ }).click();
    await page.getByRole('button', { name: 'Ajouter une somme due' }).click();
    let dlg = page.locator('dialog[open]');
    const lastYear = String(new Date().getFullYear() - 1);
    assert.equal(await dlg.getByLabel('Libellé').inputValue(), `Rappel de charges ${lastYear}`);
    await dlg.getByLabel('Montant').fill('120');
    await dlg.getByRole('button', { name: 'Ajouter' }).click();
    await page.getByText(/Rappel de charges ajouté/).waitFor();
    // import d'un loyer collé depuis Excel : réparti sur ce qui reste dû, rappel compris
    const today = await page.evaluate(() => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris' }).format(new Date()));
    const text = `Date\tMontant\tLocataire\tMoyen\tRéférence\n${today}\t3 000,00 €\tLéa Martin\tVirement\tVIR LOYER`;
    await page.goto(url + '#/loyers');
    await page.getByRole('button', { name: 'Importer des loyers (Excel)' }).click();
    dlg = page.locator('dialog[open]');
    await dlg.getByLabel(/collez les lignes/).fill(text);
    await dlg.getByRole('button', { name: 'Analyser le texte collé' }).click();
    await dlg.getByText('1 prête(s)').waitFor();
    await page.screenshot({ path: join(out, '25-import-loyers.png'), fullPage: true });
    await dlg.getByRole('button', { name: 'Importer 1 paiement(s)' }).click();
    await page.getByText('1 loyer(s) importé(s)').waitFor();
    await page.getByRole('button', { name: 'Importer des loyers (Excel)' }).click();
    await dlg.getByLabel(/collez les lignes/).fill(text);
    await dlg.getByRole('button', { name: 'Analyser le texte collé' }).click();
    await dlg.getByText('1 déjà importée(s)').waitFor();
    await dlg.getByRole('button', { name: 'Fermer' }).first().click();
    // quittance d'un loyer réglé : le rappel est proposé
    await page.goto(leaseUrl);
    await page.getByRole('tab', { name: /Échéances/ }).click();
    await page.locator('table.dt-table tbody tr').filter({ hasNotText: 'Rappel' }).getByRole('button', { name: 'Émettre la quittance' }).first().click();
    dlg = page.locator('dialog[open]');
    await dlg.getByRole('heading', { name: 'Rappel de charges' }).waitFor();
    assert.ok(await dlg.getByRole('checkbox', { name: new RegExp(`Rappel de charges ${lastYear}`) }).isChecked());
    await dlg.getByRole('button', { name: 'Émettre avec le rappel' }).click();
    await page.getByText('Quittance émise avec le rappel de charges.').waitFor();
    await page.locator('dialog[open]').getByText(`Rappel de charges inclus : Rappel de charges ${lastYear}`).waitFor();
    await page.screenshot({ path: join(out, '26-quittance-rappel.png'), fullPage: true });
    await page.locator('dialog[open]').getByRole('button', { name: 'Fermer' }).click();
    // le rappel n'est plus proposé seul
    const rappelRow = page.locator('table.dt-table tbody tr', { hasText: `Rappel de charges ${lastYear}` });
    assert.equal(await rappelRow.getByRole('button', { name: 'Émettre la quittance' }).count(), 0);
  });

  await step('révision IRL : activation dans le bail, prochaine date affichée', async () => {
    await page.goto(leaseUrl);
    await page.getByText(/l’activer dans le bail/).waitFor();
    await page.getByRole('button', { name: 'Modifier' }).first().click();
    await page.getByLabel(/prévoit une révision annuelle/).check();
    assert.ok((await page.getByLabel('IRL de référence du bail').inputValue()).match(/^\d{4}-T[1-4]$/), 'dernier IRL publié à la signature proposé');
    await page.getByRole('button', { name: 'Enregistrer' }).first().click();
    await page.getByRole('heading', { name: 'Révision annuelle du loyer (IRL)' }).waitFor();
    await page.getByText(/Prochaine révision possible à partir du/).waitFor();
  });

  await step('dépenses : saisie, part récupérable, totaux', async () => {
    await page.goto(url + '#/depenses');
    await page.getByRole('button', { name: 'Ajouter une dépense' }).first().click();
    const dlg = page.locator('dialog[open]');
    await dlg.getByLabel('Bien').selectOption({ label: 'Parking détenu' });
    await dlg.getByLabel('Catégorie').selectOption('taxe_fonciere');
    await dlg.getByLabel('Montant TTC').fill('800');
    await dlg.getByLabel('Part récupérable sur le locataire').fill('900');
    await dlg.getByRole('button', { name: 'Enregistrer' }).click();
    await dlg.getByText(/part récupérable doit être comprise/).waitFor();
    await dlg.getByLabel('Part récupérable sur le locataire').fill('120');
    await dlg.getByRole('button', { name: 'Enregistrer' }).click();
    await page.getByText('Dépense enregistrée.').waitFor();
    assert.match((await page.locator('.figure').first().innerText()).replace(/[\u202f\u00a0]/g, ' '), /800,00 €/);
    // ajout rapide puis suppression d'une ligne
    const quick = page.getByRole('form', { name: 'Ajout rapide d’une dépense' });
    await quick.getByLabel('Bien').selectOption({ label: 'Parking détenu' });
    await quick.getByLabel('Catégorie').selectOption('assurance');
    await quick.getByLabel('Libellé').fill('PNO ajout rapide');
    await quick.getByLabel('Montant').fill('99');
    await quick.getByRole('button', { name: '+ Ajouter' }).click();
    await page.getByText('Ligne ajoutée.').waitFor();
    const row = page.locator('table.dt-table tbody tr', { hasText: '99,00' });
    await row.waitFor();
    await row.getByRole('button', { name: /Supprimer la dépense/ }).click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Supprimer' }).click();
    await row.waitFor({ state: 'detached' });
  });

  await step('import d’un relevé collé depuis Excel : catégories, logement, anti-doublon', async () => {
    const T = (...c: string[]) => c.join('\t');
    const text = [
      T('Date', 'Libellé', 'Compte du mouvement', ' Montant(EUROS) ', 'Catégorie', 'Commentaires', 'Appartement'),
      T('27/04/2023', 'VIREMENT INSTANTANE A SYNDICAT 8 RUELLE 18672 Paiement charges ', 'Compte La banque postal', '-319,35 € ', 'Charges de copropriété (dont travaux)', '', 'Parking détenu'),
      T('13/06/2023', 'PRELEVEMENT DE SDC 8 PASSAGE RUE REF : 4921406', 'Compte La banque postal', '-535,43 € ', 'Charges de copropriété (dont travaux)', '', 'Parking détenu'),
      T('15/01/2024', 'VIREMENT INSTANTANE A O REAL', 'Compte La banque postal', '-335,33 € ', 'Charges de copropriété (dont travaux)', '', 'Parking détenu'),
      T('08/04/2024', 'VIREMENT INSTANTANE A O REAL Virement Charge T2 2024', 'Compte La banque postal', '-335,33 € ', 'Charges de copropriété (dont travaux)', '', 'Parking détenu'),
      T('05/05/2024', 'VIR LOYER MAI', 'Compte La banque postal', '850,00 € ', 'Loyer', '', 'Parking détenu'),
      T('15/10/2024', 'DGFIP TAXE FONCIERE', 'Compte La banque postal', '-900,00 € ', 'Taxe foncière ', '', 'Parking détenu'),
      T('20/11/2024', 'BRICO', 'Compte La banque postal', '-40,00 € ', 'Divers', '', 'Parking détenu'),
    ].join('\n');
    await page.goto(url + '#/depenses');
    await page.getByRole('button', { name: 'Importer (Excel, CSV)' }).click();
    const dlg = page.locator('dialog[open]');
    await dlg.getByLabel(/collez les lignes/).fill(text);
    await dlg.getByRole('button', { name: 'Analyser le texte collé' }).click();
    await dlg.getByText('6 prête(s)').waitFor();
    await dlg.getByText('1 à compléter').waitFor();
    await page.screenshot({ path: join(out, '21-import-depenses.png'), fullPage: true });
    await dlg.getByLabel('Catégorie ligne 8').selectOption('entretien');
    await dlg.getByRole('button', { name: 'Importer 7 ligne(s)' }).click();
    await page.getByText('7 ligne(s) importée(s)').waitFor();
    await page.getByLabel('Année').selectOption('2024');
    await page.getByText('Recettes importées').waitFor();
    // réimport : rien n'est ajouté
    await page.getByRole('button', { name: 'Importer (Excel, CSV)' }).click();
    await dlg.getByLabel(/collez les lignes/).fill(text);
    await dlg.getByRole('button', { name: 'Analyser le texte collé' }).click();
    await dlg.getByText('7 déjà importée(s)').waitFor();
    assert.ok(await dlg.getByRole('button', { name: 'Importer 0 ligne(s)' }).isDisabled());
    await dlg.getByRole('button', { name: 'Fermer' }).first().click();
  });

  await step('contrat de bail : points bloquants, aperçu, PDF et enregistrement partagé', async () => {
    await page.goto(leaseUrl);
    await page.getByRole('button', { name: 'Contrat de bail' }).click();
    await page.getByRole('heading', { name: 'Contrat de bail', exact: true }).waitFor();
    await page.getByRole('alert').filter({ hasText: 'À corriger avant d’éditer le contrat' }).getByText(/Adresse du logement incomplète/).waitFor();
    assert.ok(await page.getByRole('button', { name: 'Télécharger le PDF' }).isDisabled(), 'PDF bloqué tant que le contrat est incomplet');
    await page.getByLabel('Nom du bailleur').fill('Paul Bailleur');
    await page.getByLabel('Adresse du bailleur').fill('1 place Bellecour, 69002 Lyon');
    await page.getByRole('combobox', { name: 'Adresse' }).fill('12 rue de Par');
    await page.getByRole('option', { name: '12 Rue de Paris 93100 Montreuil' }).click();
    await page.getByLabel('Type de bail').selectOption({ label: 'Location meublée (résidence principale)' });
    assert.match(await page.getByLabel('Éléments de mobilier (un par ligne)').inputValue(), /Literie comprenant couette/, 'mobilier minimal proposé');
    await page.getByLabel('Surface habitable').fill('28');
    await page.getByLabel('Pièces principales').fill('1');
    await page.getByLabel('Période de construction').selectOption({ label: 'de 1975 à 1989' });
    await page.getByLabel('Dépenses d’énergie : estimation basse').fill('700');
    await page.getByLabel('Dépenses d’énergie : estimation haute').fill('1000');
    assert.equal(await page.getByRole('alert').filter({ hasText: 'À corriger avant d’éditer le contrat' }).count(), 0, 'plus de point bloquant');
    const preview = page.locator('.contract-preview');
    await preview.getByRole('heading', { name: 'Contrat de location – logement meublé' }).waitFor();
    for (const t of ['I. Désignation des parties', 'III. Date de prise d’effet et durée du contrat', 'Clause résolutoire', 'Mobilier', 'Annexes']) await preview.getByText(t).first().waitFor();
    await preview.getByText(/reconduit tacitement pour un an/).waitFor();
    await page.screenshot({ path: join(out, '32-contrat-bail.png'), fullPage: true });
    const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Télécharger le PDF' }).click()]);
    assert.match(pdf.suggestedFilename(), /^bail-meuble-montreuil-\d{4}-\d{2}-01\.pdf$/);
    assert.equal((await readFile((await pdf.path())!)).subarray(0, 5).toString(), '%PDF-');
    await page.getByRole('button', { name: 'Enregistrer dans les documents' }).click();
    await page.getByText('Bail enregistré dans les documents et partagé avec le locataire.').waitFor();
    await page.goto(leaseUrl);
    await page.getByText('location meublée').first().waitFor();
    await page.getByRole('tab', { name: 'Documents' }).click();
    const docRow = page.locator('tbody tr', { hasText: 'Contrat de location – logement meublé' });
    await docRow.getByText('Partagé').waitFor();
  });

  await step('espace locataire : invitation, aperçu des quittances et documents, révocation', async () => {
    await page.goto(url + '#/locataires?onglet=locataires');
    const row = page.locator('tbody tr', { hasText: 'Léa Martin' }).first();
    await row.getByText('Non invité').waitFor();
    await row.getByLabel('Actions').click();
    await row.getByRole('menuitem', { name: 'Inviter à l’espace locataire' }).click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Inviter' }).click();
    const sent = page.locator('dialog[open]');
    await sent.getByRole('heading', { name: 'Invitation préparée' }).waitFor();
    await sent.getByText(/aucun e-mail n’est envoyé/).waitFor();
    const link = await sent.locator('code').innerText();
    assert.match(link, /#\/espace-locataire\?code=[0-9A-F]{12}$/);
    await sent.getByRole('button', { name: 'Fermer' }).last().click();
    await row.getByText('Invitation envoyée').waitFor();
    const queued = await page.evaluate(() => JSON.parse(localStorage.getItem('immozen:demo:v1')!).email_outbox.filter((o: { kind: string }) => o.kind === 'invitation_locataire').length);
    assert.equal(queued, 1, 'invitation placée en file (jamais envoyée en démonstration)');
    await row.getByLabel('Actions').click();
    await row.getByRole('menuitem', { name: 'Aperçu de l’espace locataire' }).click();
    await page.getByRole('heading', { name: 'Aperçu de l’espace locataire : Léa Martin' }).waitFor();
    const receipts = page.locator('section', { has: page.getByRole('heading', { name: /^Quittances et reçus/ }) });
    assert.ok(await receipts.locator('tbody tr').count() >= 2, 'quittance et reçu visibles');
    const docs = page.locator('section', { has: page.getByRole('heading', { name: /^Documents partagés/ }) });
    assert.equal(await docs.locator('tbody tr').count(), 1, 'seul le document partagé est visible');
    await docs.getByText('Contrat de location – logement meublé').waitFor();
    const [q] = await Promise.all([page.waitForEvent('download'), receipts.getByRole('button', { name: 'Télécharger (PDF)' }).first().click()]);
    assert.equal((await readFile((await q.path())!)).subarray(0, 5).toString(), '%PDF-');
    await page.screenshot({ path: join(out, '33-espace-locataire.png'), fullPage: true });
    await page.goto(url + '#/locataires?onglet=locataires');
    await row.getByLabel('Actions').click();
    await row.getByRole('menuitem', { name: 'Révoquer l’accès' }).click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Révoquer' }).click();
    await row.getByText('Accès révoqué').waitFor();
    // lien d'invitation ouvert dans ce navigateur (mode démonstration : un seul compte)
    await page.goto(url + '#/espace-locataire?code=ABCDEF123456');
    await page.getByRole('heading', { name: 'Mon espace locataire' }).waitFor();
    await page.getByRole('alert').getByText(/Mode démonstration/).waitFor();
    await page.goto(url + '#/');
    await page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
  });

  await step('loyers : filtre par bail, modification et réédition de quittance, paiement modifié, suppression', async () => {
    await page.goto(url + '#/loyers');
    await page.getByLabel('Filtrer par bail').selectOption({ index: 1 });
    await page.getByRole('tab', { name: /^Quittances et reçus/ }).click();
    const table = page.locator('table.receipts-table');
    await table.waitFor();
    const before = await table.locator('tbody tr').count();
    assert.ok(before >= 2, 'quittances du bail listées');
    const first = table.locator('tbody tr').filter({ hasText: 'Quittance' }).first();
    const oldNumber = (await first.locator('td').first().innerText()).trim();
    await first.getByRole('button', { name: 'Modifier' }).click();
    let dlg = page.locator('dialog[open]');
    await dlg.getByRole('heading', { name: `Modifier la quittance ${oldNumber}` }).waitFor();
    await dlg.getByLabel('Nom du bailleur').fill('Paul Bailleur-Martin');
    await dlg.getByRole('button', { name: 'Enregistrer la correction' }).click();
    await page.getByText(/Quittance modifiée : un nouveau numéro est attribué/).first().waitFor();
    dlg = page.locator('dialog[open]');
    await dlg.getByRole('heading', { name: /^Quittance Q-/ }).waitFor();
    assert.notEqual((await dlg.getByRole('heading').first().innerText()).trim(), `Quittance ${oldNumber}`, 'nouveau numéro');
    await dlg.getByRole('button', { name: 'Fermer' }).click();
    await page.getByLabel(/Afficher les documents annulés ou remplacés/).check();
    await table.locator('tbody tr', { hasText: oldNumber }).getByText(/Remplacé par la quittance n° Q-/).waitFor();
    await page.getByLabel(/Afficher les documents annulés ou remplacés/).uncheck();
    // réédition avec les données actuelles
    await table.locator('tbody tr').filter({ hasText: 'Quittance' }).first().getByRole('button', { name: 'Rééditer' }).click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Rééditer' }).click();
    await page.getByText(/Quittance rééditée/).first().waitFor();
    await page.locator('dialog[open]').getByRole('button', { name: 'Fermer' }).click();
    // suppression d'un reçu partiel
    const recu = table.locator('tbody tr').filter({ hasText: 'Reçu partiel' }).first();
    if (await recu.count()) {
      await recu.getByRole('button', { name: 'Supprimer' }).click();
      dlg = page.locator('dialog[open]');
      await dlg.getByLabel('Motif de la suppression').fill('Doublon');
      await dlg.getByRole('button', { name: 'Supprimer le document' }).click();
      await page.getByText('Document supprimé (annulé).').first().waitFor();
    }
    // paiement : modification de la référence
    await page.getByRole('tab', { name: /^Paiements/ }).click();
    const prow = page.locator('tbody tr').first();
    await prow.getByLabel('Actions').click();
    await prow.getByRole('menuitem', { name: 'Modifier' }).click();
    dlg = page.locator('dialog[open]');
    await dlg.getByRole('heading', { name: 'Modifier le paiement' }).waitFor();
    await dlg.getByLabel('Référence').fill('VIR-TEST-42');
    await dlg.getByRole('button', { name: 'Enregistrer' }).click();
    await page.getByText(/Paiement modifié/).first().waitFor();
    await page.locator('tbody tr', { hasText: 'VIR-TEST-42' }).waitFor();
    await page.screenshot({ path: join(out, '35-loyers-quittances.png'), fullPage: true });
  });

  await step('paiements et dépenses : doublons signalés, suppression multiple, modification en grille, mise en cohérence des quittances', async () => {
    const txt = async (l: import('playwright').Locator) => (await l.innerText()).replace(/[\u202f\u00a0]/g, ' ').trim();
    await page.goto(url + '#/loyers');
    await page.getByLabel('Filtrer par bail').selectOption({ index: 1 });
    // doublon : même montant, même date qu'un paiement existant
    await page.getByRole('tab', { name: /^Paiements/ }).click();
    const first = page.locator('table.dt-table tbody tr').first();
    const cells = first.locator('td');
    const [d, m, y] = (await txt(cells.nth(1))).slice(0, 10).split('/');
    const amount = (await txt(cells.nth(3))).replace(/[^\d,]/g, '');
    await page.getByRole('button', { name: 'Enregistrer un paiement' }).first().click();
    let dlg = page.locator('dialog[open]');
    await dlg.getByLabel('Bail').selectOption({ index: 1 });
    await dlg.getByLabel('Montant reçu').fill(amount);
    await dlg.getByLabel('Date de réception').fill(`${y}-${m}-${d}`);
    await dlg.getByRole('button', { name: 'Enregistrer le paiement' }).click();
    await dlg.getByText('Doublon probable.').waitFor();
    await dlg.getByRole('button', { name: 'Enregistrer quand même' }).click();
    await page.getByText('Paiement enregistré.').first().waitFor();
    await page.getByText(/semble en double/).waitFor();
    await page.getByRole('button', { name: /Supprimer les doublons/ }).click();
    dlg = page.locator('dialog[open]');
    await dlg.getByRole('heading', { name: /Supprimer le paiement|Supprimer \d+ paiements/ }).waitFor();
    await dlg.getByRole('button', { name: 'Supprimer' }).click();
    await page.getByText(/paiements? supprimés?\./i).first().waitFor();
    assert.equal(await page.getByText(/semble en double|semblent en double/).count(), 0, 'plus de doublon');
    // bouton Supprimer visible sur chaque ligne
    assert.ok(await page.getByRole('button', { name: /^Supprimer le paiement du / }).count() > 0, 'suppression directe par ligne');
    // modification en grille
    await page.getByRole('button', { name: 'Modifier en grille' }).click();
    const ref = page.getByLabel(/^Référence – paiement du /).first();
    await ref.fill('GRILLE-01');
    await page.getByRole('button', { name: 'Enregistrer (1)' }).click();
    await page.getByText(/1 paiement modifié/).first().waitFor();
    await page.locator('tbody tr', { hasText: 'GRILLE-01' }).waitFor();
    // mise en cohérence : une quittance supprimée est réémise depuis les paiements déjà reçus
    await page.getByRole('tab', { name: /^Quittances et reçus/ }).click();
    const q = page.locator('table.receipts-table tbody tr').filter({ hasText: 'Quittance' }).first();
    await q.getByRole('button', { name: 'Supprimer' }).click();
    dlg = page.locator('dialog[open]');
    await dlg.getByLabel('Motif de la suppression').fill('Test de cohérence');
    await dlg.getByRole('button', { name: 'Supprimer le document' }).click();
    await page.getByText('Document supprimé (annulé).').first().waitFor();
    await page.getByRole('tab', { name: /^Échéances/ }).click();
    await page.getByRole('button', { name: /^Mettre en cohérence les quittances \(\d+\)/ }).click();
    dlg = page.locator('dialog[open]');
    await dlg.getByRole('heading', { name: 'Mettre en cohérence les quittances' }).waitFor();
    await dlg.getByRole('button', { name: /^Émettre \d+ quittances?$/ }).click();
    await page.getByText(/quittances? émises? : quittances et paiements sont en cohérence/).first().waitFor();
    assert.equal(await page.getByRole('button', { name: /^Mettre en cohérence les quittances \(/ }).count(), 0, 'plus rien à quittancer');
    // échéances en grille : une échéance quittancée est verrouillée
    await page.getByLabel('Afficher').selectOption('toutes');
    await page.getByRole('button', { name: 'Modifier en grille' }).click();
    await page.locator('.grid-table').getByText(/^Quittance .* : supprimez-la pour modifier$/).first().waitFor();
    await page.getByRole('button', { name: 'Fermer la grille' }).click();
    await page.screenshot({ path: join(out, '36-paiements-grille.png'), fullPage: true });

    // dépenses : doublon à l'ajout rapide, suppression des doublons, grille
    await page.goto(url + '#/depenses');
    await page.getByLabel('Année').selectOption('');
    const quick = page.getByRole('form', { name: 'Ajout rapide d’une dépense' });
    const add = async () => {
      await quick.getByLabel('Date').fill('2026-02-03');
      await quick.getByLabel('Bien').selectOption({ label: 'Parking détenu' });
      await quick.getByLabel('Catégorie').selectOption('entretien');
      await quick.getByLabel('Libellé').fill('Nettoyage portail');
      await quick.getByLabel('Montant').fill('45');
    };
    await add();
    await quick.getByRole('button', { name: '+ Ajouter' }).click();
    await page.getByText('Ligne ajoutée.').first().waitFor();
    await add();
    await quick.getByRole('button', { name: '+ Ajouter' }).click();
    await page.getByText('Doublon probable.').waitFor();
    await quick.getByRole('button', { name: 'Ajouter quand même' }).click();
    await page.getByText(/semble en double/).waitFor();
    await page.getByRole('button', { name: /Supprimer les doublons/ }).click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Supprimer' }).click();
    await page.locator('table.dt-table tbody tr', { hasText: '45,00' }).first().waitFor();
    assert.equal(await page.locator('table.dt-table tbody tr', { hasText: '45,00' }).count(), 1, 'un seul exemplaire conservé');
    await page.getByRole('button', { name: 'Modifier en grille' }).click();
    const lab = page.getByLabel(/^Libellé – dépense du 03\/02\/2026/);
    await lab.fill('Nettoyage du portail (grille)');
    await lab.press('Enter');
    await page.getByRole('button', { name: 'Enregistrer (1)' }).click();
    await page.getByText('1 ligne modifiée.').first().waitFor();
    await page.getByLabel('Afficher').selectOption('');
    await page.getByLabel('Rechercher dans le tableau').fill('portail (grille)');
    await page.locator('table.dt-table tbody tr', { hasText: '45,00' }).waitFor();
    await page.getByLabel('Rechercher dans le tableau').fill('');
  });

  await step('déclaration fiscale : 2044 au réel et cases de la 2042', async () => {
    await page.goto(url + '#/declaration');
    await page.getByLabel('Année des revenus').selectOption('2024');
    await page.getByLabel('Régime de Parking détenu').selectOption('reel_foncier');
    const table = page.locator('table.tax-2044');
    await table.waitFor();
    const row = async (code: string) => (await table.locator('tbody tr').filter({ has: page.getByRole('cell', { name: code, exact: true }) }).innerText()).replace(/[\u202f\u00a0]/g, ' ');
    assert.match(await row('229'), /670,66 €/, 'provisions de copropriété payées en 2024');
    assert.match(await row('227'), /900,00 €/);
    assert.match(await row('224'), /40,00 €/);
    assert.match(await row('211'), /803,15 €/, 'loyer importé, hors provision (850 × 780 / 825,50)');
    await page.getByText('Case 4BA').first().waitFor();
    await page.getByLabel('Ligne 230 : régularisation N−1').fill('100');
    await page.getByRole('button', { name: 'Enregistrer les saisies' }).click();
    await page.getByText('Saisies enregistrées.').waitFor();
    assert.match(await row('230'), /100,00 €/);
    // où déclarer : espace particulier, 2044 puis 2042
    const guide = page.locator('section', { has: page.getByRole('heading', { name: 'Où déclarer sur impots.gouv.fr (2025)' }) });
    await guide.getByText('Location nue au réel : 2044').waitFor();
    await guide.getByText('Espace particulier').first().waitFor();
    await guide.getByText(/Cochez la rubrique « Revenus fonciers », puis « Déclaration 2044 »/).waitFor();
    await page.screenshot({ path: join(out, '22-declaration-fiscale.png'), fullPage: true });
    const [dossier] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Dossier PDF' }).click()]);
    assert.equal(dossier.suggestedFilename(), 'immo-zen-dossier-declaration-2024.pdf');
    assert.equal((await readFile((await dossier.path())!)).subarray(0, 5).toString(), '%PDF-');
    // location meublée au réel : liasse 2031 / 2033 dans l'espace professionnel
    await page.getByLabel('Régime de Parking détenu').selectOption('reel_bic');
    const liasse = page.locator('table.tax-2033');
    await liasse.waitFor();
    assert.match((await liasse.innerText()).replace(/[\u202f\u00a0]/g, ' '), /218[\s\S]*242[\s\S]*254[\s\S]*310/);
    await guide.getByText('Location meublée au réel (LMNP) : liasse 2031 et 2033').waitFor();
    await guide.getByText('Espace professionnel').first().waitFor();
    await guide.getByText(/tuile « Résultat »/).first().waitFor();
    await page.screenshot({ path: join(out, '34-declaration-lmnp.png'), fullPage: true });
    // micro-BIC : case selon la nature du meublé
    await page.getByLabel('Régime de Parking détenu').selectOption('micro_bic');
    await page.getByText(/Case 5ND/).first().waitFor();
    await page.getByLabel('Nature de la location : Parking détenu').selectOption('tourisme_classe');
    await page.getByText(/Case 5NG/).first().waitFor();
    await page.getByLabel('Nature de la location : Parking détenu').selectOption('longue_duree');
    await page.getByLabel('Régime de Parking détenu').selectOption('reel_foncier');
    await page.getByRole('button', { name: 'Enregistrer les saisies' }).click();
    await page.getByText('Saisies enregistrées.').last().waitFor();
  });

  await step('documents : dépôt privé, contrôle du type', async () => {
    await page.goto(url + '#/documents');
    await page.getByRole('button', { name: 'Ajouter un document' }).first().click();
    const dlg = page.locator('dialog[open]');
    await dlg.locator('#doc-file').setInputFiles({ name: 'virus.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') });
    await dlg.getByText(/Type de fichier non accepté/).waitFor();
    await dlg.locator('#doc-file').setInputFiles({ name: 'bail-signe.pdf', mimeType: 'application/pdf', buffer: await readFile(join(out, 'quittance.pdf')) });
    await dlg.getByLabel('Catégorie').selectOption('bail');
    await dlg.getByLabel('Bien').selectOption({ label: 'Parking détenu' });
    await dlg.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await page.getByText('Document ajouté.').waitFor();
    await page.getByRole('button', { name: 'bail-signe' }).waitFor();
  });

  await step('Mes biens : locataire actif, « Loué », encaissements et cash-flow réel', async () => {
    await page.goto(url + '#/biens');
    const row = page.locator('tbody tr', { hasText: 'Parking détenu' });
    await row.waitFor();
    const text = (await row.innerText()).replace(/[\u202f\u00a0]/g, ' ');
    assert.match(text, /Loué/);
    assert.match(text, /Léa Martin/);
    await page.screenshot({ path: join(out, '15-mes-biens-gestion.png') });
    await page.goto(url + '#/loyers');
    await page.getByRole('heading', { name: 'Loyers et paiements' }).waitFor();
    await page.screenshot({ path: join(out, '16-loyers.png'), fullPage: true });
    await page.goto(url);
    await page.getByText('Loyers impayés échus').waitFor();
  });

  await step('abonnement et administration : formules, offres Stripe, prospects, accès support', async () => {
    await page.goto(url + '#/abonnement');
    await page.getByText('Le paiement en ligne n’est pas encore ouvert').waitFor();
    for (const t of ['Essentiel', 'Patrimoine', 'Pro']) await page.getByRole('heading', { name: t, exact: true }).waitFor();
    await page.getByText('199,00 €').waitFor();
    await page.getByText('Phase de lancement : toutes les fonctions sont ouvertes').waitFor();
    await page.getByRole('link', { name: 'Administration' }).click();
    await page.getByRole('heading', { name: 'Administration' }).waitFor();
    await page.getByRole('tab', { name: 'Offres et tarifs' }).click();
    assert.equal(await page.locator('.plan').count(), 7, 'trois formules × deux périodicités, et le pack fiscal');
    const plan = page.locator('.plan').first();
    await plan.getByText('Formule Essentiel · mensuel').waitFor();
    await plan.getByLabel('Offre ouverte aux abonnements').check();
    await plan.getByRole('button', { name: 'Enregistrer' }).click();
    await page.getByText('Une offre ouverte doit avoir un prix et un identifiant Stripe.').waitFor();
    await plan.getByLabel('Identifiant du prix Stripe').fill('price_TEST123');
    await plan.getByRole('button', { name: 'Enregistrer' }).click();
    await page.getByText('Offre enregistrée.').waitFor();
    await page.getByRole('tab', { name: 'Prospects commerciaux' }).click();
    await page.getByRole('button', { name: 'Ajouter' }).click();
    const dlg = page.locator('dialog[open]');
    await dlg.getByLabel('Nom *').fill('Agence Durand');
    await dlg.getByLabel('Origine').fill('Salon RENT');
    await dlg.getByRole('button', { name: 'Enregistrer' }).click();
    await page.getByRole('button', { name: 'Agence Durand' }).waitFor();
    await page.getByRole('tab', { name: 'Application des formules' }).click();
    await page.getByLabel('Appliquer les limites des formules').check();
    await page.getByLabel('Formule simulée (démonstration)').selectOption('decouverte');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Appliquer' }).click();
    await page.getByText('Configuration enregistrée.').waitFor();
    await page.getByRole('tab', { name: 'Journal' }).click();
    await page.getByText('configuration', { exact: true }).waitFor();
    await page.screenshot({ path: join(out, '23-administration.png'), fullPage: true });
    await page.goto(url + '#/parametres');
    await page.getByRole('button', { name: 'Autoriser pendant 7 jours' }).click();
    await page.getByText('Accès support autorisé pour 7 jours.').waitFor();
    await page.getByRole('button', { name: 'Retirer l’autorisation' }).waitFor();
  });

  await step('formule Découverte : limites appliquées, données existantes conservées', async () => {
    await page.goto(url + '#/abonnement');
    await page.getByText('Biens détenus', { exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Mensuel' }).click();
    await page.getByText('9,90 €').first().waitFor();
    assert.ok(await page.getByRole('button', { name: 'Choisir Essentiel' }).isDisabled(), 'aucun paiement en mode démonstration');
    await page.screenshot({ path: join(out, '24-abonnement.png'), fullPage: true });
    // biens détenus déjà au-delà de la limite : consultables, mais pas d'ajout
    await page.goto(url + '#/biens');
    await page.getByRole('button', { name: 'Ajouter un bien détenu' }).first().click();
    await page.getByLabel('Titre *').fill('Bien de trop');
    await page.getByRole('button', { name: 'Enregistrer' }).first().click();
    await page.getByText('Formule Découverte : 1 bien détenu au plus').waitFor();
    await page.goto(url + '#/contacts');
    await page.getByText('Contacts non inclus dans la formule Découverte').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Ajouter un contact' }).count(), 0, 'ajout de contact masqué');
    assert.ok(await page.locator('.dt-table tbody tr, .dt-card').count() > 0, 'contacts existants toujours visibles');
    await page.goto(url + '#/declaration');
    await page.getByText('Déclaration fiscale non incluse dans votre formule').waitFor();
    await page.goto(url + '#/');
    await page.getByText('Cash-flow consolidé').waitFor();
    // retour à la phase de lancement pour la suite des tests
    await page.goto(url + '#/admin');
    await page.getByRole('tab', { name: 'Application des formules' }).click();
    await page.getByLabel('Appliquer les limites des formules').uncheck();
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await page.getByText('Configuration enregistrée.').last().waitFor();
    await page.goto(url + '#/declaration');
    await page.getByRole('heading', { name: 'Déclaration fiscale' }).waitFor();
    assert.equal(await page.getByText('Déclaration fiscale non incluse').count(), 0, 'toutes les fonctions rouvertes');
  });

  await step('amortissement : durée personnalisée sur une dépense, reprise dans la déclaration', async () => {
    await page.goto(url + '#/depenses');
    await page.getByRole('button', { name: 'Ajouter une dépense' }).first().click();
    const dlg = page.locator('dialog[open]');
    await dlg.getByLabel('Bien').selectOption({ label: 'Parking détenu' });
    await dlg.getByLabel('Catégorie').selectOption('mobilier');
    await dlg.getByLabel('Libellé').fill('Lit et literie');
    await dlg.getByLabel('Montant TTC').fill('1000');
    await dlg.getByLabel('Durée d’amortissement').fill('5');
    await dlg.getByRole('button', { name: 'Enregistrer' }).click();
    await page.getByText('Dépense enregistrée.').waitFor();
    const year = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date()).slice(0, 4));
    await page.goto(url + '#/declaration');
    await page.getByLabel('Année des revenus').selectOption(year);
    const sec = page.locator('section', { has: page.getByRole('heading', { name: `Amortissements ${year}` }) });
    await sec.getByText('Meuble : Lit et literie').waitFor();
    assert.match(await sec.innerText(), /5 ans/);
    await page.screenshot({ path: join(out, '27-amortissements.png'), fullPage: true });
  });

  await step('assistant : questions proposées selon la rubrique, réponses de l’aide intégrée', async () => {
    await page.goto(url + '#/depenses');
    await page.getByRole('button', { name: 'Assistant' }).click();
    const panel = page.getByRole('dialog', { name: 'Assistant Immo-Zen' });
    await panel.getByText('Aide intégrée · rubrique Dépenses').waitFor();
    await panel.getByRole('button', { name: 'Comment importer mon relevé bancaire ?' }).click();
    await panel.getByText('Importer un relevé de dépenses (Excel)').waitFor();
    await panel.getByLabel('Votre question').fill('Comment réviser le loyer avec l’indice IRL ?');
    await panel.getByLabel('Votre question').press('Enter');
    await panel.getByText('Révision annuelle du loyer (IRL)').first().waitFor();
    await panel.getByLabel('Votre question').fill('recette de la tarte aux pommes');
    await panel.getByRole('button', { name: 'Envoyer' }).click();
    await panel.getByText(/Je n’ai pas trouvé de réponse précise/).waitFor();
    await page.screenshot({ path: join(out, '28-assistant.png') });
    await panel.getByRole('button', { name: 'Fermer l’assistant' }).click();
    await panel.waitFor({ state: 'detached' });
  });

  await step('rendu mobile (390 px) sans défilement horizontal', async () => {
    const m = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const mp = await m.newPage();
    await mp.goto(url);
    await mp.evaluate((s) => localStorage.setItem('immozen:demo:v1', s), await page.evaluate(() => localStorage.getItem('immozen:demo:v1')!));
    const leasePath = leaseUrl ? '#' + leaseUrl.split('#')[1] : '#/locataires';
    for (const [path, shot] of [['', '07-mobile-tableau-de-bord'], ['#/prospection', '08-mobile-prospection'], ['#/bien/nouveau', '09-mobile-simulateur'], [`#/bien/${propertyId}`, '10-mobile-fiche'], [leasePath, '17-mobile-bail'], ['#/loyers', '18-mobile-loyers']] as const) {
      await mp.goto(url + path);
      await mp.reload();
      await mp.locator('main h1').first().waitFor();
      await noHorizontalScroll(mp);
      await mp.screenshot({ path: join(out, `${shot}.png`), fullPage: path === '#/bien/nouveau' ? false : true });
    }
    await mp.goto(url + '#/prospection');
    assert.ok(await mp.locator('.dt-card').count() > 0, 'cartes affichées sur mobile');
    await mp.getByRole('button', { name: 'Menu' }).click();
    await mp.locator('#main-nav.open').waitFor();
    await mp.screenshot({ path: join(out, '11-mobile-menu.png') });
    await m.close();
  });

  await step('déconnexion : purge des données locales privées', async () => {
    await page.goto(url);
    await page.evaluate(() => localStorage.setItem('immozen:cache:test', '{"x":1}'));
    await page.getByRole('button', { name: 'Déconnexion' }).click();
    await page.getByRole('heading', { name: 'Connexion' }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('immozen:cache:test')), null);
  });

  await step('aucune erreur JavaScript', async () => {
    assert.deepEqual(errors.filter((e) => !/favicon|ERR_FILE_NOT_FOUND/.test(e)), [], errors.join(' | '));
  });

  void duplicateOk;
  await browser.close();
  close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} étapes réussies`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
