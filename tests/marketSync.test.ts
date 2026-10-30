import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  carteSlug, nextQuarter, parisCapsUrl, parisInsee, parisPeriod, parseParisCaps, parseUsuryPage, quarterOf, reminderLines, syncMarket, usuryPageUrl,
  type MarketStatus, type SyncDeps, type SyncState, type UsuryRow,
} from '../supabase/functions/_shared/marketSync.ts';
import type { RentCap, RentIndicator } from '../supabase/functions/_shared/rentData.ts';

/** Page de la Banque de France (structure du tableau publié pour le 4e trimestre 2026). */
export const USURY_HTML = `<html><body><h1>Taux d'usure - 2026-Q4</h1>
<table><thead><tr><th>Taux d'usure et taux effectifs moyens pratiqués par les établissements de crédit et les sociétés de financement (%)</th><th></th><th></th></tr>
<tr><th>Catégorie</th><th>Taux effectif moyen pratiqué au<br>3ème trimestre 2026</th><th>Taux d'usure applicable au<br>1er octobre 2026</th></tr></thead>
<tbody>
<tr><td><strong>CR&Eacute;DITS DE TR&Eacute;SORERIE</strong><br>Crédits de trésorerie aux ménages et prêts pour travaux d'un montant inférieur ou égal à 75 000 euros (1)</td><td><a href="#">Séries</a></td><td><a href="#">Séries</a></td></tr>
<tr><td>Prêts d'un montant inférieur ou égal à 3 000 euros</td><td>17,70</td><td>23,60</td></tr>
<tr><td>Prêts d'un montant supérieur à 6 000 euros</td><td>6,42</td><td>8,56</td></tr>
<tr><td><strong>CRÉDITS IMMOBILIERS</strong><br>Crédits immobiliers et prêts pour travaux d'un montant supérieur à 75 000 euros (2)</td><td><a href="#">Séries</a></td><td><a href="#">Séries</a></td></tr>
<tr><td>Prêts à taux fixe d'une durée inférieure à 10 ans</td><td>3,07</td><td>4,09</td></tr>
<tr><td>Prêts à taux fixe d'une durée comprise entre 10 ans et moins de 20 ans</td><td>3,51</td><td>4,68</td></tr>
<tr><td>Prêts à taux fixe d'une durée de 20 ans et plus</td><td>4,05</td><td>5,40</td></tr>
<tr><td>Prêts à taux variable</td><td>4,14</td><td>5,52</td></tr>
<tr><td>Prêts relais</td><td>4,87</td><td>6,49</td></tr>
<tr><td>Prêts aux personnes morales n&#039;ayant pas d&#039;activité industrielle, commerciale, artisanale, agricole ou professionnelle non commerciale</td><td><a href="#">Séries</a></td><td><a href="#">Séries</a></td></tr>
<tr><td>Prêts à taux fixe d'une durée comprise entre 2 ans et moins de 10 ans</td><td>4,47</td><td>5,96</td></tr>
<tr><td>Prêts à taux fixe d'une durée comprise entre 10 ans et moins de 20 ans</td><td>4,45</td><td>5,93</td></tr>
<tr><td>Prêts à taux fixe d'une durée de 20 ans et plus</td><td>4,37</td><td>5,83</td></tr>
<tr><td>Prêts à taux variable d'une durée initiale supérieure à 2 ans (3)</td><td>4,63</td><td>6,17</td></tr>
<tr><td>Découverts en compte</td><td>14,31</td><td>19,08</td></tr>
<tr><td>Prêts aux personnes physiques agissant pour leurs besoins professionnels et aux personnes morales ayant une activité industrielle</td><td><a href="#">Séries</a></td><td></td></tr>
<tr><td>Découverts en compte</td><td>14,31</td><td>19,08</td></tr>
</tbody></table></body></html>`;

test('dates : trimestre en cours et suivant', () => {
  assert.deepEqual(quarterOf('2026-10-30'), { quarter: '2026-Q4', from: '2026-10-01', to: '2026-12-31' });
  assert.equal(nextQuarter('2026-10-30').quarter, '2027-Q1');
  assert.equal(nextQuarter('2026-02-10').quarter, '2026-Q2');
  assert.equal(usuryPageUrl('2027-Q1'), 'https://www.banque-france.fr/fr/statistiques/taux-et-cours/taux-dusure-2027-q1');
  assert.equal(carteSlug(2025), 'carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025');
  assert.match(parisCapsUrl(2026), /refine=annee%3A2026$/);
});

test('taux d’usure : lecture de la page de la Banque de France', () => {
  const rows = parseUsuryPage(USURY_HTML, '2026-Q4');
  assert.equal(rows.length, 8);
  const get = (b: UsuryRow['borrower'], k: UsuryRow['bracket']) => rows.find((r) => r.borrower === b && r.bracket === k)!;
  assert.deepEqual([get('particulier', 'moins_10').average, get('particulier', 'moins_10').usury], [3.07, 4.09]);
  assert.equal(get('particulier', '20_plus').usury, 5.4);
  assert.equal(get('particulier', 'variable').usury, 5.52);
  assert.equal(get('particulier', 'relais').usury, 6.49);
  assert.equal(get('personne_morale', 'moins_10').usury, 5.96);
  assert.equal(get('personne_morale', '20_plus').usury, 5.83);
  assert.equal(rows.some((r) => r.usury === 23.6 || r.usury === 19.08 || r.usury === 6.17), false, 'consommation, découverts et taux variable des entreprises écartés');
  assert.equal(get('particulier', '10_20').valid_from, '2026-10-01');
  assert.equal(get('particulier', '10_20').valid_to, '2026-12-31');
  assert.throws(() => parseUsuryPage('<html><p>Page en maintenance</p></html>', '2026-Q4'), /tableau incomplet ou format modifié/);
});

const parisRec = (o: Record<string, unknown> = {}) => ({ id_zone: 2, id_quartier: 1, nom_quartier: "St-Germain-l'Auxerrois", piece: 1, epoque: 'Avant 1946', meuble_txt: 'non meublé', ref: 35.1, max: 42.1, min: 24.6, annee: 2026, geo_shape: {}, ...o });

test('plafonds de Paris : quartier, arrondissement, époque, meublé, validité', () => {
  assert.deepEqual(parisPeriod('Avant 1946'), [null, 1945]);
  assert.deepEqual(parisPeriod('1946-1970'), [1946, 1970]);
  assert.deepEqual(parisPeriod('1971-1990'), [1971, 1990]);
  assert.deepEqual(parisPeriod('Après 1990'), [1991, null]);
  assert.equal(parisPeriod('inconnue'), null);
  assert.equal(parisInsee({ id_quartier: 1 }), '75101');
  assert.equal(parisInsee({ id_quartier: 44 }), '75111');
  assert.equal(parisInsee({ c_quinsee: '7511144' }), '75111');
  assert.equal(parisInsee({}), '75056');
  const caps = parseParisCaps([parisRec(), parisRec({ meuble_txt: 'meublé', ref: 40, max: 48, min: 28 }), parisRec({ piece: 5 }), parisRec({ ref: 50 })], 2026, '2026-11-23');
  assert.equal(caps.length, 3, 'ligne incohérente (référence > majoré) écartée');
  assert.deepEqual(caps[0], { territory: 'Paris', insee: '75101', zone: "St-Germain-l'Auxerrois", rooms: 1, year_min: null, year_max: 1945, furnished: false,
    ref: 35.1, max: 42.1, min: 24.6, valid_from: '2026-07-01', valid_to: '2026-11-23' });
  assert.equal(caps[1]!.furnished, true);
  assert.equal(caps[2]!.rooms, 4, '5 pièces → 4 et plus');
  assert.equal(parseParisCaps([parisRec()], 2026, '2028-11-23')[0]!.valid_to, '2027-06-30', 'au plus tard le 30 juin suivant');
});

// --------------------------------------------------------------------------- orchestration avec réponses simulées

const CSV_HEAD = '"id_zone";"INSEE_C";"LIBGEO";"EPCI";"DEP";"REG";"loypredm2";"lwr.IPm2";"upr.IPm2";"TYPPRED";"nbobs_com";"nbobs_mail";"R2_adj"';
const carteCsv = (n: number) => [CSV_HEAD, ...Array.from({ length: n }, (_, i) => `"${i}";"${String(1001 + i).padStart(5, '0')}";"Commune ${i}";"";"01";"84";"12,5";"10,1";"15,2";"commune";"120";"120";"0,61"`)].join('\n');

function fakeEnv(o: { today: string; usury?: Record<string, string>; carte?: Record<number, { title: string; last_modified: string; rows: number }[]>; paris?: Record<number, unknown[]>; state?: SyncState; status?: Partial<MarketStatus>; elapsed?: () => number }) {
  const calls: string[] = [];
  const db = { indicators: [] as { vintage: number; segment: string; n: number }[], usury: [] as UsuryRow[], caps: [] as RentCap[], state: { ...(o.state ?? {}) } as SyncState, mails: [] as { subject: string; body: string; dedupe: string }[] };
  const res = (status: number, body: string, type = 'application/json') => new Response(body, { status, headers: { 'content-type': type } });
  const fetchFake = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const carte = /carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-(\d{4})\/$/.exec(url);
    if (carte) {
      const files = o.carte?.[Number(carte[1])];
      return files ? res(200, JSON.stringify({ resources: [...files.map((f) => ({ title: f.title, url: `https://static.data.gouv.fr/${f.title}`, format: 'csv', last_modified: f.last_modified })), { title: 'guide.pdf', url: 'https://static.data.gouv.fr/guide.pdf', format: 'pdf' }] })) : res(404, '{}');
    }
    const file = /static\.data\.gouv\.fr\/(.+)$/.exec(url);
    if (file) {
      const f = Object.values(o.carte ?? {}).flat().find((x) => x.title === file[1]);
      return f ? res(200, carteCsv(f.rows), 'text/csv') : res(404, '');
    }
    const q = /taux-dusure-(\d{4})-q(\d)$/.exec(url);
    if (q) { const html = o.usury?.[`${q[1]}-Q${q[2]}`]; return html ? res(200, html, 'text/html') : res(404, 'introuvable', 'text/html'); }
    const p = /annee%3A(\d{4})$/.exec(url);
    if (p) return res(200, JSON.stringify(o.paris?.[Number(p[1])] ?? []));
    return res(500, 'inattendu');
  }) as typeof fetch;
  const deps: SyncDeps = {
    fetch: fetchFake, today: o.today, elapsed: o.elapsed ?? (() => 0), budgetMs: 100_000,
    db: {
      async state() { return db.state; },
      async setState(source, version) { db.state[source] = { version }; },
      async status() {
        return { benchmarkOn: null, usuryQuarters: [...new Set(db.usury.map((u) => u.quarter))], vintages: [...new Set(db.indicators.map((i) => i.vintage))],
          caps: db.caps.map((c) => ({ territory: c.territory, valid_from: c.valid_from, valid_to: c.valid_to })), encadrementEnd: '2026-11-23', ...o.status };
      },
      async replaceIndicators(vintage, segment, rows: RentIndicator[]) { db.indicators = db.indicators.filter((x) => !(x.vintage === vintage && x.segment === segment)); db.indicators.push({ vintage, segment, n: rows.length }); return rows.length; },
      async insertUsury(rows) { db.usury.push(...rows); },
      async replaceCaps(territory, rows) { db.caps = [...db.caps.filter((c) => c.territory !== territory), ...rows]; return rows.length; },
      async queueReminder(subject, body, dedupe) { if (db.mails.some((m) => m.dedupe === dedupe)) return false; db.mails.push({ subject, body, dedupe }); return true; },
    },
  };
  return { deps, db, calls };
}

const FILES = [
  { title: 'pred-app-mef-dhup.csv', last_modified: '2025-12-11T10:00:00', rows: 1500 },
  { title: 'pred-app12-mef-dhup.csv', last_modified: '2025-12-11T10:00:00', rows: 1400 },
  { title: 'pred-app3-mef-dhup.csv', last_modified: '2025-12-11T10:00:00', rows: 1300 },
  { title: 'pred-mai-mef-dhup.csv', last_modified: '2025-12-11T10:00:00', rows: 1200 },
];
const PARIS_2026 = Array.from({ length: 80 }, (_, q) => [1, 2, 3, 4].flatMap((piece) => ['Avant 1946', '1946-1970', '1971-1990', 'Apres 1990'].flatMap((epoque) =>
  ['non meublé', 'meublé'].map((m) => parisRec({ id_quartier: q + 1, nom_quartier: `Quartier ${q + 1}`, piece, epoque, meuble_txt: m }))))).flat();

test('chargement automatique : premier passage (Carte 2025, usure T4 2026, Paris 2026)', async () => {
  const { deps, db, calls } = fakeEnv({ today: '2026-10-31', usury: { '2026-Q4': USURY_HTML }, carte: { 2025: FILES }, paris: { 2026: PARIS_2026 } });
  const r = await syncMarket(deps);
  assert.deepEqual(r.errors, []);
  assert.equal(db.indicators.length, 4, 'les quatre segments');
  assert.deepEqual(db.indicators.map((x) => x.n), [1500, 1400, 1300, 1200]);
  assert.equal(db.usury.length, 8);
  assert.equal(db.caps.length, 2560, '80 quartiers × 4 pièces × 4 époques × 2 types');
  assert.equal(db.caps.filter((c) => c.insee === '75111').length, 128, '4 quartiers par arrondissement');
  assert.ok(calls.some((u) => u.includes('taux-dusure-2027-q1')), 'trimestre suivant cherché (pas encore publié)');
  assert.equal(r.reminder, false, 'rappel seulement le 1er du mois');
  // nuit suivante : rien de nouveau, rien n'est retéléchargé
  const before = calls.length;
  const again = await syncMarket({ ...deps, today: '2026-11-01' } as SyncDeps);
  assert.deepEqual(again.loaded, []);
  assert.equal(calls.slice(before).filter((u) => u.includes('static.data.gouv.fr')).length, 0, 'fichiers inchangés : non retéléchargés');
  assert.equal(calls.slice(before).filter((u) => u.includes('opendata.paris.fr')).length, 0, 'année de Paris déjà chargée');
  assert.equal(again.reminder, true, 'rappel du 1er novembre');
  assert.match(db.mails[0]!.subject, /données de marché à mettre à jour \(novembre 2026\)/);
  assert.match(db.mails[0]!.body, /Barème des taux à 10, 15, 20 et 25 ans : à saisir pour novembre \(aucun barème enregistré\)/);
  assert.match(db.mails[0]!.body, /Plafonds des territoires encadrés hors Paris : aucun chargé/);
  assert.equal((await syncMarket({ ...deps, today: '2026-11-01' } as SyncDeps)).reminder, false, 'un seul rappel par mois');
});

test('chargement automatique : nouveau millésime, nouvelle publication, budget de temps', async () => {
  const state: SyncState = Object.fromEntries(FILES.map((f) => [`carte:2025:${f.title.includes('12') ? 'appart_t1t2' : f.title.includes('app3') ? 'appart_t3plus' : f.title.includes('mai') ? 'maison' : 'appart'}`, { version: f.last_modified }]));
  const next = FILES.map((f) => ({ ...f, last_modified: '2026-12-10T09:00:00' }));
  // temps écoulé : une minute par segment chargé ; budget de 100 secondes
  const loaded: { n: number } = { n: 0 };
  const { deps, db } = fakeEnv({ today: '2026-12-15', carte: { 2025: FILES, 2026: next }, state, elapsed: () => loaded.n * 60_000 });
  const replace = deps.db.replaceIndicators.bind(deps.db);
  deps.db.replaceIndicators = async (...a) => { loaded.n++; return replace(...a); };
  const r = await syncMarket(deps);
  assert.ok(db.indicators.every((x) => x.vintage === 2026), 'millésime 2026 chargé');
  assert.ok(db.indicators.length >= 1 && db.indicators.length < 4, 'chargement partiel, poursuivi la nuit suivante');
  assert.ok(r.pending.length > 0);
  loaded.n = 0;
  const r2 = await syncMarket(deps);
  assert.equal(db.indicators.length, 4);
  assert.deepEqual(r2.pending, []);
});

test('chargement automatique : échecs isolés, rien de remplacé par un fichier incomplet', async () => {
  const { deps, db } = fakeEnv({ today: '2026-10-31', usury: { '2026-Q4': '<html>maintenance</html>' }, carte: { 2025: [{ ...FILES[0]!, rows: 12 }] }, paris: { 2026: PARIS_2026 } });
  const r = await syncMarket(deps);
  assert.equal(r.errors.length, 2);
  assert.ok(r.errors.some((e) => /taux d’usure 2026-Q4 : tableau incomplet/.test(e)));
  assert.ok(r.errors.some((e) => /12 communes lues seulement/.test(e)));
  assert.equal(db.indicators.length, 0);
  assert.equal(db.usury.length, 0);
  assert.equal(db.caps.length, 2560, 'Paris chargé malgré les autres échecs');
});

test('rappel mensuel : barème, usure, millésime, arrêtés, fin de l’encadrement', () => {
  const status: MarketStatus = {
    benchmarkOn: '2026-10-01', usuryQuarters: ['2026-Q4'], vintages: [2025], encadrementEnd: '2026-11-23',
    caps: [
      { territory: 'Paris', valid_from: '2026-07-01', valid_to: '2026-11-23' },
      { territory: 'Lille', valid_from: '2025-03-01', valid_to: '2026-11-23' },
      { territory: 'Bordeaux', valid_from: '2026-07-15', valid_to: '2026-10-15' },
    ],
  };
  const l = reminderLines(status, '2026-11-01').join('\n');
  assert.match(l, /à saisir pour novembre \(dernier barème : 1 octobre 2026\)/);
  assert.match(l, /Plafonds de Lille : valables jusqu’au 23 novembre 2026/);
  assert.match(l, /Plafonds de Bordeaux : expirés depuis le 15 octobre 2026/);
  assert.match(l, /Fin de l’encadrement des loyers prévue le 23 novembre 2026/);
  assert.doesNotMatch(l, /Plafonds de Paris/, 'Paris : automatique');
  assert.doesNotMatch(l, /Taux d’usure du trimestre en cours/, 'usure du trimestre chargée');
  const l2 = reminderLines({ ...status, usuryQuarters: [], vintages: [2023], benchmarkOn: '2027-01-01' }, '2027-01-01').join('\n');
  assert.match(l2, /déjà saisi pour ce mois/);
  assert.match(l2, /Taux d’usure du trimestre en cours \(2027, trimestre 1\)/);
  assert.match(l2, /dernier millésime 2023/);
});
