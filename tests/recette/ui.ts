/**
 * Recette navigateur complémentaire (mode démonstration) : un résultat par cas du cahier de test.
 * Prérequis : npm run build. Usage : node --import tsx tests/recette/ui.ts → JSON sur la sortie standard.
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
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.xml': 'application/xml', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json' };
const T = (s: string) => s.replace(/[  ]/g, ' ');

const out: Record<string, { ok: boolean; detail: string }> = {};
async function c(id: string, fn: () => Promise<string | void>) {
  try { out[id] = { ok: true, detail: (await fn()) || 'conforme' }; process.stderr.write(`OK   ${id}\n`); }
  catch (e) { await cur?.screenshot({ path: join(shots, `KO-${id}.png`), fullPage: true }).catch(() => undefined); out[id] = { ok: false, detail: String((e as Error).message ?? e).split('\n').slice(0, 3).join(' ') }; process.stderr.write(`KO   ${id} ${out[id]!.detail}\n`); }
}
let cur: Page | null = null;
const statuts = (x: string) => x || 'aucun';
const db = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('immozen:demo:v1') ?? '{}'));

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
  const site = `http://127.0.0.1:${port}/`; const url = site + 'app/';
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  await ctx.route(/data\.geopf\.fr|files\.data\.gouv\.fr|geo\.api\.gouv\.fr/, (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"features":[]}' }));
  const page = await ctx.newPage();
  cur = page;
  page.setDefaultTimeout(6000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const confirm = async (name: RegExp | string) => page.locator('dialog[open]').getByRole('button', { name }).click();

  await c('TDB-01', async () => {
    await page.goto(url);
    await page.getByText('Commencez par un premier bien').waitFor();
    await page.screenshot({ path: join(shots, 'tdb-vide.png') });
  });

  await c('AUTH-08', async () => {
    await page.goto(url + '#/parametres');
    await page.getByRole('button', { name: 'Ajouter des données d’exemple' }).click();
    await page.getByText('Données d’exemple ajoutées.').waitFor();
    const d = await db(page);
    assert.ok(d.properties.length >= 3, `${d.properties.length} biens d'exemple`);
    return `${d.properties.length} biens, ${d.pro_contacts?.length ?? 0} contacts d'exemple ajoutés`;
  });

  await c('NAV-01', async () => {
    const seen: string[] = [];
    for (const [label, heading] of [['Tableau de bord', 'Tableau de bord'], ['Prospection', 'Prospection'], ['Mes biens', 'Mes biens'], ['Locataires et baux', /Locataires et baux|Baux/], ['Loyers et paiements', 'Loyers et paiements'], ['Dépenses', 'Dépenses'], ['Contacts', 'Contacts'], ['Documents', 'Documents'], ['Déclaration fiscale', 'Déclaration fiscale'], ['Mon abonnement', 'Mon abonnement'], ['Paramètres', 'Paramètres']] as const) {
      await page.locator('#main-nav').getByRole('link', { name: label }).click();
      await page.locator('main h1').first().waitFor();
      const h = await page.locator('main h1').first().innerText();
      assert.ok(typeof heading === 'string' ? h.includes(heading) : heading.test(h), `${label} → titre « ${h} »`);
      assert.equal(await page.locator('#main-nav a[aria-current="page"]').count(), 1, `${label} : entrée active`);
      seen.push(label);
    }
    return `${seen.length} rubriques ouvertes, entrée active signalée`;
  });

  await c('NAV-03', async () => {
    await page.goto(url + '#/xyz');
    await page.getByText('Page introuvable', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Tableau de bord' }).click();
    await page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
  });

  await c('NAV-04', async () => {
    await page.goto(url + '#/prospection'); await page.locator('main h1').first().waitFor();
    await page.goto(url + '#/depenses'); await page.locator('main h1').first().waitFor();
    await page.goBack(); await page.getByRole('heading', { name: 'Prospection' }).waitFor();
    await page.goForward(); await page.getByRole('heading', { name: 'Dépenses' }).waitFor();
  });

  await c('TDB-02', async () => {
    await page.goto(url);
    await page.getByRole('heading', { name: 'À faire' }).waitFor();
    const txt = T(await page.locator('section', { has: page.getByRole('heading', { name: 'À faire' }) }).innerText());
    assert.match(txt, /exemple/i, `contenu : ${txt.slice(0, 200)}`);
    return txt.replace(/\s+/g, ' ').slice(0, 220);
  });

  await c('TDB-03', async () => {
    const sec = page.locator('section', { has: page.getByRole('heading', { name: 'Parcours de prospection' }) });
    await sec.waitFor();
    const items = (await sec.locator('.pipeline li').allInnerTexts()).map((x) => T(x).replace(/\s+/g, ' '));
    assert.ok(items.length > 0, 'aucune étape affichée');
    const first = sec.locator('.pipeline a').first();
    const label = T(await first.locator('span').first().innerText());
    const n = Number(await first.locator('strong').innerText());
    await first.click();
    await page.getByRole('heading', { name: 'Prospection' }).waitFor();
    await page.waitForTimeout(300);
    const rows = await page.locator('table.dt-table tbody tr').count();
    assert.equal(rows, n, `« ${label} » : ${rows} ligne(s) pour ${n} bien(s)`);
    return `${items.join(' · ')} ; clic sur « ${label} » → prospection filtrée (${rows} bien)`;
  });

  await c('PRO-03', async () => {
    await page.goto(url + '#/prospection');
    const rows = page.locator('table.dt-table tbody tr');
    await rows.first().waitFor();
    const all = await rows.count();
    await page.getByLabel('Rechercher dans le tableau').fill('Studio');
    await page.waitForTimeout(300);
    const n = await rows.count();
    assert.equal(n, 1, `recherche « Studio » : ${n} ligne(s)`);
    await page.getByLabel('Rechercher dans le tableau').fill('');
    await page.locator('thead').getByRole('button', { name: /Prix de présentation FAI/ }).click();
    await page.locator('thead').getByRole('button', { name: /Prix de présentation FAI/ }).click();
    assert.equal(await page.locator('thead th[aria-sort="descending"]').count(), 1, 'tri décroissant');
    return `${all} biens, recherche → 1, tri croissant puis décroissant`;
  });

  await c('PRO-04', async () => {
    await page.getByText('Colonnes', { exact: true }).click();
    await page.locator('.menu-columns').getByLabel('Agence').check();
    await page.getByText('Colonnes', { exact: true }).click();
    await page.reload();
    await page.locator('thead').getByText('Agence').waitFor();
    return 'colonne « Agence » conservée après rechargement';
  });

  let pid = '';
  await c('PRO-05', async () => {
    await page.goto(url + '#/prospection');
    await page.getByRole('button', { name: 'Maison avec jardin (exemple)' }).first().click();
    pid = page.url().split('/bien/')[1]!;
    for (const s of ['À contacter', 'Visite programmée', 'Offre transmise', 'Sous compromis']) {
      await page.getByLabel('Changer le statut').selectOption({ label: s });
      await page.locator('.status-line').getByText(s, { exact: true }).first().waitFor();
    }
    const ev = (await db(page)).timeline_events.filter((e: { property_id: string; kind: string }) => e.property_id === pid && e.kind === 'status_change');
    assert.ok(ev.length >= 4, `${ev.length} changements historisés`);
    return `4 statuts successifs, ${ev.length} changements dans l'historique`;
  });

  await c('FIC-02', async () => {
    await page.goto(url + '#/bien/' + pid);
    await page.getByRole('tab', { name: /Historique/ }).click();
    await page.getByLabel('Compte rendu de l’échange').fill('Appel agence : DPE reçu');
    await page.getByRole('button', { name: 'Ajouter l’échange' }).click();
    await page.getByText('Appel agence : DPE reçu').waitFor();
  });

  await c('FIC-03', async () => {
    await page.getByRole('tab', { name: /Tâches/ }).click().catch(() => undefined);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await page.getByLabel('Nouvelle tâche').fill('Demander les PV d’AG');
    await page.getByLabel('Échéance').fill(tomorrow);
    await page.locator('.task-form').getByRole('button', { name: 'Ajouter' }).click();
    await page.getByText('Demander les PV d’AG').waitFor();
    await page.getByRole('checkbox', { name: 'Demander les PV d’AG' }).check();
    await page.locator('li.done', { hasText: 'Demander les PV d’AG' }).waitFor();
    return 'tâche créée puis cochée terminée';
  });

  await c('FIC-04', async () => {
    await page.goto(url + '#/bien/' + pid + '/modifier');
    await page.getByLabel('DPE', { exact: true }).selectOption('F');
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await page.getByText(/enregistr/).first().waitFor();
    await page.goto(url + '#/bien/' + pid);
    const v = T(await page.locator('main').innerText());
    assert.match(v, /2028/, 'vigilance 2028 absente de la fiche');
    return (v.match(/[^\n]*2028[^\n]*/)?.[0] ?? '').slice(0, 200);
  });

  await c('CMP-02', async () => {
    await page.goto(url + '#/prospection');
    await page.locator('table.dt-table tbody tr').first().getByRole('checkbox').check();
    const btn = page.getByRole('button', { name: 'Comparer' });
    assert.ok(await btn.isDisabled(), 'Comparer actif avec 1 bien');
    await page.getByLabel('Tout sélectionner sur cette page').check();
    const n = await page.locator('table.dt-table tbody tr input[type=checkbox]:checked').count();
    return `1 bien : bouton désactivé ; ${n} biens : ${await btn.isDisabled() ? 'désactivé' : 'actif'} (limite 2 à 4)`;
  });

  await c('PRO-07', async () => {
    await page.goto(url + '#/prospection');
    const rows = page.locator('table.dt-table tbody tr');
    const before = await rows.count();
    await rows.nth(0).getByRole('checkbox').check();
    await rows.nth(1).getByRole('checkbox').check();
    await page.locator('.inline-select', { hasText: 'Statut' }).locator('select').selectOption({ label: 'Visite à programmer' });
    await page.waitForTimeout(400);
    const d = await db(page);
    const n = d.properties.filter((p: { status: string }) => p.status === 'visite_a_programmer').length;
    assert.ok(n >= 2, `${n} biens au statut « Visite à programmer »`);
    const r0 = rows.nth(0); await r0.getByLabel('Actions').click(); await r0.getByRole('menuitem', { name: 'Archiver' }).click();
    await page.waitForTimeout(300);
    assert.equal(await rows.count(), before - 1, 'bien archivé encore visible');
    return `2 biens passés à « Visite à programmer » ; 1 archivé, masqué de la vue (${before} → ${before - 1})`;
  });

  await c('SIM-04', async () => {
    await page.goto(url + '#/bien/nouveau');
    await page.getByLabel('Prix proposé', { exact: true }).fill('150000');
    await page.getByRole('button', { name: 'Par année' }).click().catch(() => undefined);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Excel|xlsx/ }).first().click()]);
    assert.match(dl.suggestedFilename(), /\.xlsx$/);
    return `export ${dl.suggestedFilename()}`;
  });

  await c('SIM-06', async () => {
    await page.goto(url + '#/parametres');
    const sec = page.locator('section', { has: page.getByRole('heading', { name: 'Valeurs par défaut des simulations' }) });
    await sec.getByLabel(/Frais de notaire/).fill('8');
    await sec.getByRole('button', { name: 'Enregistrer' }).click();
    await page.getByText(/enregistr/i).first().waitFor();
    await page.goto(url + '#/bien/nouveau');
    const v = await page.getByLabel('Taux frais de notaire').inputValue();
    assert.equal(v.replace(',', '.'), '8', `taux repris : ${v}`);
    await page.goto(url + '#/parametres');
    await sec.getByLabel(/Frais de notaire/).fill('7,5');
    await sec.getByRole('button', { name: 'Enregistrer' }).click();
    return 'taux de notaire 8 % repris dans une nouvelle simulation';
  });

  // ---------- biens détenus, baux, loyers
  let leaseUrl = '';
  let bai03 = '';
  await c('BIE-01', async () => {
    await page.goto(url + '#/biens');
    await page.getByRole('button', { name: 'Ajouter un bien détenu' }).first().click();
    await page.getByLabel('Titre *').fill('T2 recette');
    await page.getByLabel('Loyer hors charges').fill('750');
    await page.getByLabel('Provision sur charges').fill('60');
    await page.getByLabel('Taxe foncière').fill('900');
    await page.getByLabel('Montant emprunté').fill('160000');
    await page.getByLabel('Taux', { exact: false }).first().fill('3,5');
    await page.getByLabel('Durée').fill('20');
    await page.getByLabel('Première échéance').fill('2025-01-05');
    await page.getByLabel('Mode de détention').selectOption('nom_propre');
    await page.getByRole('button', { name: 'Enregistrer' }).first().click();
    await page.getByRole('heading', { name: 'T2 recette' }).waitFor();
    const txt = T(await page.locator('main').innerText());
    assert.match(txt, /927,9[34]/, 'mensualité calculée absente');
    assert.match(txt, /[Cc]apital restant/, 'capital restant dû absent');
    return 'mensualité 927,94 € calculée, capital restant dû affiché';
  });

  await c('BAI-02', async () => {
    await page.goto(url + '#/locataires');
    await page.getByRole('button', { name: 'Nouveau bail' }).click();
    await page.getByLabel('Bien', { exact: true }).selectOption({ label: 'T2 recette' });
    await page.getByRole('button', { name: '+ Nouveau locataire' }).click();
    const dlg = page.locator('dialog[open]');
    await dlg.getByLabel('Prénom').fill('Paul'); await dlg.getByLabel('Nom *').fill('Recette'); await dlg.getByLabel('E-mail').fill('paul@example.test');
    await dlg.getByRole('button', { name: 'Enregistrer' }).click();
    await page.locator('.chip.on', { hasText: 'Paul Recette' }).waitFor();
    const now = new Date(); const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 15)).toISOString().slice(0, 10);
    await page.getByLabel('Début du bail *').fill(start);
    await page.getByLabel('Dépôt de garantie').fill('1500');
    await page.getByRole('button', { name: 'Enregistrer' }).first().click();
    await page.getByText(/Dépôt de garantie trop élevé : 750,00 € maximum/).waitFor();
    bai03 = 'dépôt de 1 500 € refusé à la saisie : « Dépôt de garantie trop élevé : 750,00 € maximum (un mois de loyer hors charges en location vide) »';
    await page.getByLabel('Charges', { exact: true }).selectOption('forfait');
    await page.getByLabel('Dépôt de garantie').fill('750');
    await page.getByRole('button', { name: 'Enregistrer' }).first().click();
    await page.getByText(/le forfait est réservé à la colocation/).waitFor();
    bai03 += ' ; forfait de charges refusé en location vide';
    await page.getByLabel('Charges', { exact: true }).selectOption('provision');
    await page.getByRole('button', { name: 'Enregistrer' }).first().click();
    await page.getByRole('tab', { name: /^Loyers et paiements \(3 mois/ }).waitFor();
    leaseUrl = page.url();
    const d = await db(page);
    const lease = d.leases.find((l: { property_id: string }) => d.properties.find((p: { id: string; title: string }) => p.id === l.property_id)?.title === 'T2 recette');
    const ch = d.rent_charges.filter((x: { lease_id: string }) => x.lease_id === lease.id).sort((a: { due_date: string }, b: { due_date: string }) => a.due_date.localeCompare(b.due_date));
    const first = ch[0];
    await page.reload(); await page.getByRole('tab', { name: /^Loyers et paiements \(3 mois/ }).waitFor();
    return `bail créé (début ${start}), 3 lignes mensuelles ; 1re proratisée : ${first.rent_amount} € HC + ${first.charges_amount} € ; pas de doublon après rechargement`;
  });

  await c('BAI-03', async () => {
    assert.ok(bai03, 'contrôle non observé');
    return bai03;
  });

  await c('LOY-02', async () => {
    await page.goto(leaseUrl);
    await page.getByRole('tab', { name: /^Loyers et paiements/ }).click();
    const row = page.locator('table.dt-table tbody tr').filter({ has: page.getByRole('button', { name: /^(Paiement reçu|Enregistrer un paiement)$/ }) }).first();
    const due = T(await row.innerText());
    await row.getByRole('button', { name: /^(Paiement reçu|Enregistrer un paiement)$/ }).click();
    const dlg = page.locator('dialog[open]');
    const amt = await dlg.getByLabel('Montant reçu').inputValue();
    await dlg.getByRole('button', { name: /Confirmer le paiement|Enregistrer le paiement/ }).click();
    await page.getByText(/Paiement (confirmé|enregistré) sur/).first().waitFor();
    await page.locator('table.dt-table tbody tr .status', { hasText: /^Réglé$/ }).first().waitFor();
    return `mois « ${due.split('\n')[0]} » : montant proposé ${amt} € (reste dû reporté compris), confirmé → statut Réglé`;
  });

  await c('QUI-04', async () => {
    await page.getByRole('button', { name: 'Émettre la quittance' }).first().click();
    const dlg = page.locator('dialog[open]');
    const h1 = await dlg.getByRole('heading', { name: /Quittance Q-/ }).innerText();
    await dlg.getByRole('button', { name: 'Supprimer', exact: true }).click();
    await dlg.getByLabel('Motif de la suppression').fill('Erreur de période');
    await dlg.getByRole('button', { name: 'Supprimer le document' }).click();
    await page.getByText('Document supprimé (annulé).').first().waitFor();
    await dlg.waitFor({ state: 'detached' });
    const d = await db(page);
    assert.ok(d.receipts.some((r: { number: string; cancelled_at: string | null; cancel_reason: string | null }) => h1.includes(r.number) && r.cancelled_at && r.cancel_reason === 'Erreur de période'), 'motif d’annulation conservé');
    await page.getByRole('button', { name: 'Émettre la quittance' }).first().click();
    const h2 = await page.locator('dialog[open]').getByRole('heading', { name: /Quittance Q-/ }).innerText();
    assert.notEqual(h1, h2);
    await page.locator('dialog[open]').getByRole('button', { name: 'Fermer' }).last().click();
    return `${h1.trim()} annulée avec son motif, nouvelle ${h2.trim()} émise`;
  });

  await c('LOY-06', async () => {
    await page.goto(leaseUrl);
    await page.getByRole('tab', { name: /^Loyers et paiements/ }).click();
    const txt = T(await page.locator('table.dt-table').innerText());
    const statuses = [...new Set((txt.match(/À venir|Impayé reporté|Impayé|Réglé|Partiel reporté|Partiel/g) ?? []))].join(', ');
    const row = page.locator('table.dt-table tbody tr').filter({ has: page.getByRole('button', { name: 'Annuler', exact: true }) }).first();
    await row.getByRole('button', { name: 'Annuler', exact: true }).click();
    const dlg = page.locator('dialog[open]');
    assert.ok(await dlg.getByRole('button', { name: 'Annuler la ligne' }).isDisabled(), 'annulation possible sans motif');
    await dlg.getByLabel('Motif d’annulation').fill('Mois offert (travaux)');
    await dlg.getByRole('button', { name: 'Annuler la ligne' }).click();
    await page.getByText('Annulé : Mois offert (travaux)').first().waitFor();
    return `statuts : ${statuts(statuses)} ; motif obligatoire, affiché sous la période (« Annulé : Mois offert (travaux) »)`;
  });

  await c('BAI-06', async () => {
    await page.goto(leaseUrl);
    await page.getByRole('button', { name: 'Modifier' }).first().click();
    const end = new Date(); end.setUTCDate(1); end.setUTCDate(0); // dernier jour du mois précédent
    await page.getByLabel('Fin du bail (facultatif)').fill(end.toISOString().slice(0, 10));
    await page.getByRole('button', { name: 'Enregistrer' }).first().click();
    await page.waitForTimeout(500);
    const d = await db(page);
    const lease = d.leases.find((l: { property_id: string }) => d.properties.find((p: { id: string; title: string }) => p.id === l.property_id)?.title === 'T2 recette');
    const future = d.rent_charges.filter((x: { lease_id: string; period_start: string; cancelled_at: string | null }) => x.lease_id === lease.id && x.period_start > end.toISOString().slice(0, 10) && !x.cancelled_at && !d.payment_allocations.some((a: { charge_id: string }) => a.charge_id === (x as unknown as { id: string }).id));
    assert.equal(future.length, 0, `${future.length} échéance(s) postérieure(s) à la fin non annulée(s)`);
    await page.goto(url + '#/biens');
    const row = T(await page.locator('tbody tr', { hasText: 'T2 recette' }).innerText());
    assert.doesNotMatch(row, /Loué/, `Mes biens : ${row}`);
    return `fin au ${end.toISOString().slice(0, 10)} : échéances suivantes annulées, bien non loué`;
  });

  await c('DEP-05', async () => {
    await page.goto(url + '#/depenses');
    const quick = page.getByRole('form', { name: 'Ajout rapide d’une dépense' });
    await quick.getByLabel('Bien').selectOption({ label: 'T2 recette' });
    await quick.getByLabel('Catégorie').selectOption('loyer');
    await quick.getByLabel('Libellé').fill('Loyer encaissé hors application');
    await quick.getByLabel('Montant').fill('750');
    await quick.getByRole('button', { name: '+ Ajouter' }).click();
    await page.getByText('Ligne ajoutée.').waitFor();
    const figs = T(await page.locator('.figures').first().innerText());
    assert.match(figs, /[Rr]ecette|[Ee]ncaiss/, figs);
    return figs.replace(/\s+/g, ' ').slice(0, 200);
  });

  await c('DEP-06', async () => {
    const rows = page.locator('table.dt-table tbody tr');
    const before = await rows.count();
    const r = rows.first(); await r.getByLabel('Actions').click(); await r.getByRole('menuitem', { name: 'Dupliquer' }).click();
    await page.waitForTimeout(400);
    const afterDup = await rows.count();
    assert.equal(afterDup, before + 1, 'duplication');
    await rows.nth(0).getByRole('checkbox').check(); await rows.nth(1).getByRole('checkbox').check();
    await page.getByRole('button', { name: /^Supprimer \(\d+\)$/ }).click();
    await confirm(/Supprimer/);
    await page.waitForTimeout(400);
    assert.equal(await rows.count(), afterDup - 2, 'suppression multiple');
    return `${before} → ${afterDup} après duplication → ${afterDup - 2} après suppression de 2 lignes (confirmation demandée)`;
  });

  await c('DEP-07', async () => {
    const d = await db(page);
    const p = d.properties.find((x: { title: string }) => x.title === 'T2 recette');
    await page.goto(url + '#/depenses?bien=' + p.id);
    await page.getByLabel('Année').selectOption('').catch(() => undefined);
    await page.locator('main h1').waitFor(); await page.waitForTimeout(300);
    const txt = T(await page.locator('main').innerText());
    const where = d.expenses.filter((e: { property_id: string }) => e.property_id === p.id).map((e: { expense_date: string; label: string; amount: number }) => `${e.expense_date} ${e.label} ${e.amount}`).join(' / ');
    assert.ok(d.expenses.some((e: { property_id: string }) => e.property_id === p.id) === !/Aucune dépense/.test(txt), `filtre incohérent : dépenses du bien en base = ${where || 'aucune'} ; écran = ${/Aucune dépense/.test(txt) ? 'Aucune dépense' : 'liste'}`);
    const others = d.expenses.filter((e: { property_id: string }) => e.property_id !== p.id).length;
    const mine = d.expenses.filter((e: { property_id: string }) => e.property_id === p.id).length;
    const shown = txt.split('\n').filter((l) => /\d+,\d{2}/.test(l)).length;
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.export-row').getByRole('button', { name: /Excel/ }).click()]);
    return `filtre sur « T2 recette » : ${shown} ligne(s) affichée(s) pour ${mine} dépense(s) du bien (${others} d'autres biens masquées) ; export ${dl.suggestedFilename()}`;
  });

  await c('IMP-02', async () => {
    await page.goto(url + '#/depenses');
    await page.getByRole('button', { name: 'Importer (Excel, CSV)' }).click();
    const dlg = page.locator('dialog[open]');
    const csv = 'Date;Libellé;Montant;Catégorie;Appartement\n12/03/2026;Plombier;-1 234,56 €;Entretien;T2 recette\n';
    await dlg.locator('input[type=file]').setInputFiles({ name: 'releve.csv', mimeType: 'text/csv', buffer: Buffer.from('﻿' + csv) });
    await dlg.getByText('1 prête(s)').waitFor();
    const t = T(await dlg.innerText());
    assert.match(t, /1 234,56/, 'montant au format français');
    await dlg.getByRole('button', { name: 'Importer 1 ligne(s)' }).click();
    await page.getByText('1 ligne(s) importée(s)').waitFor();
    const d = await db(page);
    const e = d.expenses.find((x: { label: string | null }) => x.label === 'Plombier');
    const p = d.properties.find((x: { id: string }) => x.id === e?.property_id);
    assert.equal(p?.title, 'T2 recette', `ligne importée rattachée à « ${p?.title ?? 'aucun bien'} » (date ${e?.expense_date}, montant ${e?.amount})`);
    return 'CSV séparé par « ; », montant 1 234,56 € lu correctement, ligne importée';
  });

  await c('PAR-01', async () => {
    await page.goto(url + '#/parametres');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Télécharger une sauvegarde (.json)' }).click()]);
    const j = JSON.parse(await readFile((await dl.path())!, 'utf8'));
    const keys = Object.keys(j.data ?? j);
    for (const k of ['properties', 'scenarios', 'leases', 'charges', 'payments', 'expenses']) assert.ok(keys.includes(k) || JSON.stringify(j).includes(`"${k}"`), `sauvegarde sans ${k}`);
    return `sauvegarde ${dl.suggestedFilename()} : ${keys.length} collections`;
  });

  await c('LOY-09', async () => {
    await page.goto(url + '#/loyers');
    const [x] = await Promise.all([page.waitForEvent('download'), page.locator('.export-row').getByRole('button', { name: /Excel/ }).click()]);
    const [cv] = await Promise.all([page.waitForEvent('download'), page.locator('.export-row').getByRole('button', { name: 'CSV' }).click()]);
    const text = await readFile((await cv.path())!, 'utf8');
    assert.ok(text.startsWith('﻿'), 'CSV sans BOM UTF-8 (accents mal lus dans Excel)');
    assert.match(text, /é/);
    return `${x.suggestedFilename()} et ${cv.suggestedFilename()} (UTF-8, accents corrects)`;
  });

  await c('LOY-01', async () => {
    await page.goto(url + '#/loyers');
    const all = await page.locator('table.dt-table').first().locator('tbody tr').count();
    await page.locator('select', { has: page.locator('option[value=a_traiter]') }).selectOption('a_traiter');
    await page.waitForTimeout(300);
    const txt = T(await page.locator('table.dt-table').first().innerText());
    return `${all} lignes mensuelles ; « À traiter » : ${txt.split('\n').length - 1} ligne(s) (impayés échus et périodes payées sans quittance)`;
  });

  await c('PRO-08', async () => {
    const m = await browser.newContext({ locale: 'fr-FR', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mp = await m.newPage();
    await mp.goto(url);
    await mp.evaluate((s) => localStorage.setItem('immozen:demo:v1', s), await page.evaluate(() => localStorage.getItem('immozen:demo:v1')!));
    const res: string[] = [];
    for (const p of ['#/prospection', '#/biens', '#/locataires', '#/loyers', '#/depenses', '#/contacts', '#/documents', '#/declaration', '#/abonnement', '#/parametres', '#/bien/nouveau']) {
      await mp.goto(url + p); await mp.reload(); await mp.locator('main h1').first().waitFor();
      const { sw, iw } = await mp.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      if (sw > iw + 1) res.push(`${p} : ${sw}px`);
    }
    await mp.goto(url + '#/prospection'); await mp.reload();
    const cards = await mp.locator('.dt-card').count();
    await mp.screenshot({ path: join(shots, 'mobile-prospection.png'), fullPage: true });
    await m.close();
    assert.deepEqual(res, [], `défilement horizontal : ${res.join(', ')}`);
    assert.ok(cards > 0);
    return `11 rubriques à 390 px sans défilement horizontal ; ${cards} cartes en prospection`;
  });

  await c('MOB-03', async () => {
    await page.goto(url + '#/depenses');
    await page.getByRole('button', { name: 'Ajouter une dépense' }).first().click();
    await page.locator('dialog[open]').waitFor();
    for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => { const a = document.activeElement as HTMLElement; return { tag: a.tagName, inDialog: !!a.closest('dialog'), outline: getComputedStyle(a).outlineStyle + ' ' + getComputedStyle(a).boxShadow.slice(0, 30) }; });
    assert.ok(focused.inDialog, 'le focus sort de la fenêtre');
    await page.keyboard.press('Escape');
    await page.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => { throw new Error('Échap ne ferme pas la fenêtre'); });
    return `focus conservé dans la fenêtre (${focused.tag}, ${focused.outline.trim()}) ; Échap ferme la fenêtre`;
  });

  await c('MOB-04', async () => {
    const res = await page.evaluate(() => {
      const bad: string[] = [];
      document.querySelectorAll('input, select, textarea, button').forEach((el) => {
        const e = el as HTMLInputElement;
        if (e.type === 'hidden' || e.closest('[hidden]')) return;
        const name = e.getAttribute('aria-label') || (e.id && document.querySelector(`label[for="${e.id}"]`)?.textContent) || e.closest('label')?.textContent || e.textContent || e.getAttribute('title');
        if (!name || !name.trim()) bad.push(e.outerHTML.slice(0, 80));
      });
      return bad;
    });
    assert.deepEqual(res, [], `contrôles sans libellé : ${res.join(' | ')}`);
    return 'tous les champs et boutons de la page Dépenses ont un libellé accessible (contrastes non mesurés)';
  });

  await c('SIT-05', async () => {
    const p = await ctx.newPage();
    await p.goto(site + 'guides/');
    const links = await p.locator('a[href$=".html"]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href).filter((h) => h.includes('/guides/')));
    const bad: string[] = [];
    for (const l of [...new Set(links)]) { const r = await p.request.get(l); if (!r.ok()) bad.push(l); }
    await p.close();
    assert.deepEqual(bad, []);
    return `${new Set(links).size} guides ouverts sans erreur`;
  });

  await c('SIT-06', async () => {
    const p = await ctx.newPage();
    const sm = await (await p.request.get(site + 'sitemap.xml')).text();
    const rb = await (await p.request.get(site + 'robots.txt')).text();
    await p.goto(site + 'guides/quittance-de-loyer.html');
    const ld = await p.locator('script[type="application/ld+json"]').innerText();
    const appHtml = await (await p.request.get(site + 'app/')).text();
    await p.close();
    assert.match(rb, /Sitemap: https:\/\/immo-zen\.fr\/sitemap\.xml/); assert.doesNotMatch(rb, /Disallow: \/app\//);
    assert.match(appHtml, /<meta name="robots" content="noindex/);
    assert.match(ld, /FAQPage/); assert.match(ld, /"Article"/);
    return `sitemap : ${(sm.match(/<loc>/g) ?? []).length} adresses ; application en noindex ; données Article et FAQPage présentes (outil Google non utilisé)`;
  });

  await c('SIT-04', async () => {
    const p = await ctx.newPage();
    await p.goto(site + '#tarifs');
    const t = T(await p.locator('#tarifs').innerText());
    await p.close();
    for (const s of ['9,90', '19,90', '39,90', '99', '199', '399']) assert.ok(t.includes(s), `prix ${s} absent du site`);
    for (const s of ['1 bien', '3 biens', '10 biens']) assert.ok(t.includes(s), `limite « ${s} » absente du site`);
    return 'prix (9,90 / 19,90 / 39,90 €, 99 / 199 / 399 €/an) et limites identiques à l’application';
  });

  await c('SIT-07', async () => {
    const p = await ctx.newPage();
    await p.goto(site + 'mentions-legales.html');
    const todo = await p.locator('[data-todo]').count();
    await p.close();
    assert.equal(todo, 0, 'Identité de l’éditeur toujours « À compléter » (nom, forme juridique, adresse, SIREN, directeur de la publication)');
  });

  await c('JS', async () => {
    assert.deepEqual(errors, [], errors.join(' | '));
    return 'aucune erreur JavaScript pendant la recette';
  });

  await browser.close(); server.close();
  console.log(JSON.stringify(out, null, 1));
}
main().catch((e) => { console.error(e); console.log(JSON.stringify(out, null, 1)); process.exit(1); });
