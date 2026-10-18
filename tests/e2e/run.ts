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

const root = join(import.meta.dirname, '..', '..');
const dist = join(root, 'dist');
const out = join(root, 'test-results');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

async function serve(): Promise<{ url: string; close: () => void }> {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    const file = join(dist, path === '/' ? 'index.html' : path);
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
  if (!existsSync(join(dist, 'index.html'))) throw new Error('Lancez d’abord npm run build');
  await mkdir(out, { recursive: true });
  const { url, close } = await serve();
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  // services d'adresses publics simulés (aucun appel réseau pendant les tests)
  await ctx.route('https://data.geopf.fr/geocodage/**', (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ features: [
    { properties: { label: '12 Rue de Paris 93100 Montreuil', name: '12 Rue de Paris', postcode: '93100', city: 'Montreuil', type: 'housenumber' } },
    { properties: { label: '12 Rue de Paris 75012 Paris', name: '12 Rue de Paris', postcode: '75012', city: 'Paris', type: 'housenumber' } },
  ] }) }));
  await ctx.route('https://geo.api.gouv.fr/communes**', (r) => {
    const zip = new URL(r.request().url()).searchParams.get('codePostal');
    const list = zip === '93100' ? [{ nom: 'Montreuil' }] : zip === '75018' ? [{ nom: 'Paris' }] : [];
    return r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(list) });
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await step('ouverture en mode démonstration, bannière visible', async () => {
    await page.goto(url);
    await page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
    await page.getByText('Mode démonstration').first().waitFor();
    await page.screenshot({ path: join(out, '01-tableau-de-bord-vide.png') });
  });

  await step('menu complet, sans états des lieux', async () => {
    const labels = await page.locator('#main-nav a').allInnerTexts();
    for (const l of ['Tableau de bord', 'Prospection', 'Simulateur', 'Mes biens', 'Locataires et baux', 'Loyers et paiements', 'Dépenses', 'Contacts', 'Documents', 'Déclaration fiscale', 'Mon abonnement', 'Paramètres']) {
      assert.ok(labels.some((x) => x.includes(l)), `menu : ${l}`);
    }
    const js = await page.evaluate(async () => {
      const src = (document.querySelector('script[type=module]') as HTMLScriptElement).src;
      return (await fetch(src)).text();
    });
    assert.ok(!/[ée]tats? des lieux/i.test(js), 'aucune mention des états des lieux dans le code livré');
    assert.ok(!/etat-des-lieux|etats-des-lieux|edl/i.test(await page.content()), 'aucune route états des lieux');
  });

  await step('prospection et simulation en une seule saisie, puis agence et relance', async () => {
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
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await page.getByText('Bien « T3 test balcon » ajouté à la prospection avec sa simulation.').waitFor();
    // une seule saisie : la fiche du bien porte les valeurs simulées
    await page.goto(url + '#/prospection');
    await page.getByRole('button', { name: 'T3 test balcon' }).first().click();
    await page.getByRole('heading', { name: 'T3 test balcon' }).waitFor();
    assert.match((await page.locator('.figures').first().innerText()).replace(/[\u202f\u00a0]/g, ' '), /320 000 €[\s\S]*300 000 €/);
    await page.getByRole('button', { name: 'Modifier' }).first().click();
    assert.equal(await page.getByLabel('Prix affiché').count(), 0, 'plus de double saisie des prix dans la fiche');
    await page.getByText('Ces valeurs se saisissent une seule fois, dans le simulateur').waitFor();
    await page.getByLabel('Agence', { exact: true }).selectOption({ label: '+ Nouvelle agence…' });
    await page.getByLabel('Nom de la nouvelle agence').fill('Agence Test');
    await page.getByLabel('Date de relance').fill('2020-01-01');
    await page.getByRole('button', { name: 'Enregistrer' }).first().click();
    await page.getByRole('heading', { name: 'T3 test balcon' }).waitFor();
    await page.getByRole('tab', { name: /Historique/ }).click();
    await page.getByText('Bien ajouté à la prospection').first().waitFor();
  });

  await step('simulation liée au bien, enregistrée comme scénario principal', async () => {
    await page.goto(url + '#/prospection');
    await page.getByRole('button', { name: 'T3 test balcon' }).first().click();
    await page.getByRole('button', { name: 'Simuler' }).click();
    await page.getByLabel('Apport').fill('40000');
    await page.getByLabel('Taxe foncière').fill('1100');
    const cash = await page.locator('.cashflow strong').innerText();
    assert.match(cash, /€/);
    await page.screenshot({ path: join(out, '02-simulateur.png'), fullPage: true });
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await page.getByText('Bien et simulation enregistrés.').waitFor();
    await page.getByRole('button', { name: 'Par année' }).click();
    assert.ok(await page.locator('table.compact tbody tr').count() === 20, '20 lignes annuelles');
  });

  await step('valeurs invalides bloquent l’enregistrement', async () => {
    await page.getByLabel('Durée').fill('0');
    await page.getByText('Durée entière entre 1 et 40 ans.').first().waitFor();
    assert.ok(await page.getByRole('button', { name: 'Enregistrer', exact: true }).isDisabled());
    await page.getByLabel('Durée').fill('20');
  });

  await step('simulateur : négociation, loyer au m² bas/haut, charges de copropriété à 80 %', async () => {
    await page.goto(url + '#/simulateur');
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
    // le simulateur alimente la prospection
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
    await page.locator('thead').getByRole('button', { name: /Prix affiché/ }).click();
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
    await dlg.getByRole('button', { name: 'Fermer' }).click();
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
    await page.screenshot({ path: join(out, '22-declaration-fiscale.png'), fullPage: true });
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

  await step('abonnement et administration : offres, contrôle d’accès, prospects, accès support', async () => {
    await page.goto(url + '#/abonnement');
    await page.getByText('Les offres ne sont pas encore ouvertes').waitFor();
    await page.getByRole('link', { name: 'Administration' }).click();
    await page.getByRole('heading', { name: 'Administration' }).waitFor();
    await page.getByRole('tab', { name: 'Offres et tarifs' }).click();
    const plan = page.locator('.plan').first();
    await plan.getByLabel('Prix TTC par mois').fill('9,90');
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
    await page.getByRole('tab', { name: 'Contrôle d’accès' }).click();
    await page.getByLabel('Exiger un abonnement pour modifier les données').check();
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Activer' }).click();
    await page.getByText('Configuration enregistrée.').waitFor();
    await page.getByRole('tab', { name: 'Journal' }).click();
    await page.getByText('configuration', { exact: true }).waitFor();
    await page.screenshot({ path: join(out, '23-administration.png'), fullPage: true });
    await page.goto(url + '#/abonnement');
    await page.getByText('9,90 € / mois').waitFor();
    assert.ok(await page.getByRole('button', { name: 'S’abonner' }).isDisabled(), 'aucun paiement en mode démonstration');
    await page.screenshot({ path: join(out, '24-abonnement.png'), fullPage: true });
    await page.goto(url + '#/parametres');
    await page.getByRole('button', { name: 'Autoriser pendant 7 jours' }).click();
    await page.getByText('Accès support autorisé pour 7 jours.').waitFor();
    await page.getByRole('button', { name: 'Retirer l’autorisation' }).waitFor();
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
    for (const [path, shot] of [['', '07-mobile-tableau-de-bord'], ['#/prospection', '08-mobile-prospection'], ['#/simulateur', '09-mobile-simulateur'], [`#/bien/${propertyId}`, '10-mobile-fiche'], [leasePath, '17-mobile-bail'], ['#/loyers', '18-mobile-loyers']] as const) {
      await mp.goto(url + path);
      await mp.reload();
      await mp.locator('main h1').first().waitFor();
      await noHorizontalScroll(mp);
      await mp.screenshot({ path: join(out, `${shot}.png`), fullPage: path === '#/simulateur' ? false : true });
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
    assert.deepEqual(errors.filter((e) => !/favicon|ERR_FILE_NOT_FOUND/.test(e)), []);
  });

  void duplicateOk;
  await browser.close();
  close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} étapes réussies`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
