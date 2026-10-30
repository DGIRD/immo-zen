import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  arrondissementCode, computeMarketRent, findCap, HORS_ZONE, parseRentCapsCsv, parseRentIndicatorsCsv, pickIndicator, rentPosition, segmentFor,
  segmentFromFileName, simulatorRentM2, snapshotOf, type RentCap, type RentIndicator,
} from '../src/domain/marketRent.ts';
import { lookupKey, lookupMarketRent, MarketRentError, missingForLookup } from '../src/domain/marketRentLookup.ts';
import { DEFAULT_MARKET_CONFIG } from '../src/data/market.ts';

const ind = (o: Partial<RentIndicator> = {}): RentIndicator => ({
  vintage: 2025, segment: 'appart_t1t2', insee: '94033', libgeo: 'Fontenay-sous-Bois', low: 16, mid: 20, high: 25,
  level: 'commune', r2: 0.72, nb_obs_commune: 420, nb_obs_maille: 420, ...o,
});
const cap = (o: Partial<RentCap> = {}): RentCap => ({
  territory: 'Est Ensemble', insee: '93048', zone: '1', rooms: 2, year_min: null, year_max: 1945, furnished: false, ref: 20, max: 24, min: 14,
  valid_from: '2026-06-01', valid_to: '2026-11-23', ...o,
});

test('loyer de marché : segment selon le type et le nombre de pièces', () => {
  assert.equal(segmentFor('maison', 5), 'maison');
  assert.equal(segmentFor('appartement', 2), 'appart_t1t2');
  assert.equal(segmentFor('appartement', 1), 'appart_t1t2');
  assert.equal(segmentFor('appartement', 3), 'appart_t3plus');
  assert.equal(segmentFor('appartement', null), 'appart');
  assert.equal(segmentFor('parking', 1), null);
  assert.equal(segmentFromFileName('pred-app12-mef-dhup.csv'), 'appart_t1t2');
  assert.equal(segmentFromFileName('pred-app3-mef-dhup.csv'), 'appart_t3plus');
  assert.equal(segmentFromFileName('pred-mai-mef-dhup.csv'), 'maison');
  assert.equal(segmentFromFileName('pred-app-mef-dhup.csv'), 'appart');
});

test('loyer de marché : Paris, Lyon, Marseille par arrondissement', () => {
  assert.equal(arrondissementCode('75056', '75011'), '75111');
  assert.equal(arrondissementCode('75056', '75116'), '75116');
  assert.equal(arrondissementCode('69123', '69003'), '69383');
  assert.equal(arrondissementCode('13055', '13008'), '13208');
  assert.equal(arrondissementCode('94033', '94120'), null);
});

test('loyer de marché : dernier millésime, repli sur les appartements tous types', () => {
  const list = [ind({ vintage: 2024, mid: 18 }), ind(), ind({ segment: 'appart', mid: 19 })];
  assert.equal(pickIndicator(list, 'appart_t1t2')!.indicator.mid, 20);
  const r = pickIndicator([ind({ segment: 'appart' })], 'appart_t3plus')!;
  assert.equal(r.fallback, true);
  assert.equal(pickIndicator([ind({ segment: 'appart' })], 'maison'), null);
});

test('loyer de marché : indicateur × surface, trois valeurs (critère : 45 m², 2 pièces)', () => {
  const mr = computeMarketRent({ indicator: ind(), surface: 45 });
  assert.deepEqual([mr.low, mr.mid, mr.high], [720, 900, 1125]);
  assert.equal(mr.hc, null); // charges inconnues : charges comprises seulement
  assert.equal(mr.reliability, 'bonne');
});

test('loyer de marché : hors charges, meublé à 1,15 par défaut', () => {
  const mr = computeMarketRent({ indicator: ind(), surface: 40, chargesMonthly: 60, furnished: true });
  assert.equal(mr.coef, 1.15);
  assert.deepEqual([mr.low, mr.mid, mr.high], [736, 920, 1150]);
  assert.deepEqual(mr.hc, { low: 676, mid: 860, high: 1090 });
  const m2 = simulatorRentM2(mr);
  assert.deepEqual(m2, { low: 16.9, high: 27.25 });
  assert.equal(computeMarketRent({ indicator: ind(), surface: 40, furnished: true, furnishedCoef: 1.1 }).coef, 1.1);
});

test('loyer de marché : fiabilité (R², annonces, maille, fourchette large, surface)', () => {
  assert.equal(computeMarketRent({ indicator: ind({ r2: 0.4 }), surface: 40 }).reliability, 'faible');
  assert.equal(computeMarketRent({ indicator: ind({ nb_obs_commune: 12 }), surface: 40 }).reliability, 'faible');
  assert.equal(computeMarketRent({ indicator: ind({ level: 'maille' }), surface: 40 }).reliability, 'moyenne');
  // exemple du besoin : central 800, bas 550, haut 1 100 → écart 69 % > 60 %
  const wide = computeMarketRent({ indicator: ind({ low: 11, mid: 16, high: 22 }), surface: 50, });
  assert.equal(wide.reliability, 'faible');
  assert.ok(wide.reasons.some((r) => /très large/.test(r)));
  // 15 m² pour un bien type de 37 m² : un cran de moins
  const small = computeMarketRent({ indicator: ind(), surface: 15 });
  assert.equal(small.reliability, 'moyenne');
  assert.ok(small.reasons.some((r) => /Petite surface/.test(r)));
  assert.equal(computeMarketRent({ indicator: ind({ segment: 'appart' }), fallback: true, surface: 52 }).reliability, 'moyenne');
});

test('encadrement : le plafond légal devient le loyer haut (critère Montreuil)', () => {
  const found = findCap([cap()], { zone: null, rooms: 2, year: 1930, furnished: false, today: '2026-10-30' });
  assert.equal(found.status, 'ok');
  const mr = computeMarketRent({ indicator: ind(), surface: 45, chargesMonthly: 80, cap: found.cap });
  assert.equal(mr.capHc, 1080); // 24 €/m² × 45
  assert.equal(mr.high, 1160); // plafond + charges
  assert.equal(mr.marketHigh, 1125);
  assert.equal(mr.hc!.high, 1080);
  assert.equal(rentPosition(1100, mr)!.position, 'plafond');
  assert.equal(rentPosition(900, mr)!.position, 'dans');
  assert.equal(rentPosition(500, mr)!.position, 'dessous');
});

test('encadrement : zone, pièces, année, meublé, validité', () => {
  const caps = [cap(), cap({ year_min: 1946, year_max: null, max: 22 }), cap({ zone: '2', max: 21 }), cap({ zone: '2', year_min: 1946, year_max: null, max: 19 }), cap({ furnished: true, max: 27 }), cap({ zone: '1', furnished: true, year_min: 1946, year_max: null, max: 25 })];
  const q = { zone: null, rooms: 2, year: 1930, furnished: false, today: '2026-10-30' };
  assert.equal(findCap(caps, q).status, 'zone_needed');
  assert.deepEqual(findCap(caps, q).zones, ['1', '2']);
  assert.equal(findCap(caps, { ...q, zone: '2' }).cap!.max, 21);
  assert.equal(findCap(caps, { ...q, zone: '1', year: null }).status, 'year_needed');
  assert.equal(findCap(caps, { ...q, zone: '1', year: 1980 }).cap!.max, 22);
  assert.equal(findCap(caps, { ...q, zone: '1', furnished: true }).cap!.max, 27);
  assert.equal(findCap(caps, { ...q, zone: '1', rooms: null }).status, 'rooms_needed');
  assert.equal(findCap(caps, { ...q, zone: HORS_ZONE }).status, 'hors_zone'); // commune partiellement encadrée
  // après la fin de l'expérimentation, sans prolongation : retour au haut de la Carte des loyers
  assert.equal(findCap(caps, { ...q, zone: '1', today: '2026-11-24' }).status, 'expired');
  assert.equal(findCap([], q).status, 'none');
});

test('loyer de marché : photographie enregistrée avec le bien', () => {
  const s = snapshotOf(computeMarketRent({ indicator: ind(), surface: 45 }), '2026-10-30');
  assert.equal(s.source, 'auto');
  assert.equal(s.vintage, 2025);
  assert.equal(s.mid, 900);
});

test('Carte des loyers : lecture du fichier (séparateur, décimales, guillemets)', () => {
  const csv = [
    '"id_zone";"INSEE_C";"LIBGEO";"EPCI";"DEP";"REG";"loypredm2";"lwr.IPm2";"upr.IPm2";"TYPPRED";"nbobs_com";"nbobs_mail";"R2_adj"',
    '"101";"94033";"Fontenay-sous-Bois";"200054781";"94";"11";"20,1";"16,4";"24,7";"commune";"420";"1200";"0,71"',
    '"102";"1001";"L\'Abergement";"200";"01";"84";"9,2";"6,8";"12,4";"maille";"3";"650";"0,55"',
    '"103";"2A004";"Ajaccio";"";"2A";"94";"15";"12";"19";"commune";"800";"800";"0,6"',
    '"104";"99999";"Vide";"";"99";"99";"";"";"";"commune";"";"";""',
  ].join('\n');
  const rows = parseRentIndicatorsCsv(csv, 'appart', 2025);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { vintage: 2025, segment: 'appart', insee: '94033', libgeo: 'Fontenay-sous-Bois', low: 16.4, mid: 20.1, high: 24.7, level: 'commune', r2: 0.71, nb_obs_commune: 420, nb_obs_maille: 1200 });
  assert.equal(rows[1]!.insee, '01001');
  assert.equal(rows[1]!.level, 'maille');
  assert.equal(rows[2]!.insee, '2A004');
  assert.throws(() => parseRentIndicatorsCsv('a;b\n1;2', 'appart', 2025), /Format non reconnu/);
});

test('plafonds : lecture du modèle, contrôles par ligne', () => {
  const csv = [
    'territoire;code_insee;zone;pieces;annee_min;annee_max;meuble;loyer_reference;loyer_majore;loyer_minore;debut;fin',
    'Est Ensemble;93048;1;2;;1945;non;20,5;24,6;14,35;2026-06-01;',
    'Est Ensemble;93048;1;2;;1945;oui;23;27,6;16,1;2026-06-01;2028-11-23',
  ].join('\n');
  const caps = parseRentCapsCsv(csv);
  assert.equal(caps.length, 2);
  assert.equal(caps[0]!.valid_to, '2026-11-23'); // fin de l'expérimentation par défaut
  assert.equal(caps[0]!.year_min, null);
  assert.equal(caps[0]!.max, 24.6);
  assert.equal(caps[1]!.furnished, true);
  assert.equal(caps[1]!.valid_to, '2028-11-23');
  assert.throws(() => parseRentCapsCsv(csv.replace('20,5', '30')), /Ligne 2 : loyers minoré/);
  assert.throws(() => parseRentCapsCsv('territoire;code_insee\nx;1'), /Colonnes manquantes/);
});


const place = (citycode: string) => async () => ({ citycode, lat: null, lon: null, label: '', precise: false });

test('recherche : informations manquantes, adresse introuvable, commune non chargée', async () => {
  assert.match(missingForLookup({ property_type: 'parking', surface: 12, city: 'Montreuil' })!, /appartements et les maisons/);
  assert.match(missingForLookup({ property_type: 'appartement', surface: null, city: 'Montreuil' })!, /surface/);
  assert.equal(missingForLookup({ property_type: 'appartement', surface: 40, zip: '93100' }), null);
  const deps = { locate: async () => null, rentData: async () => ({ indicators: [], caps: [], config: DEFAULT_MARKET_CONFIG }) };
  await assert.rejects(lookupMarketRent({ property_type: 'appartement', surface: 40, city: 'Nulle part' }, '2026-10-30', deps), MarketRentError);
  await assert.rejects(lookupMarketRent({ property_type: 'appartement', surface: 40, city: 'Montreuil' }, '2026-10-30', { ...deps, locate: place('93048') }), /Carte des loyers non chargée/);
  await assert.rejects(lookupMarketRent({ property_type: 'appartement', surface: 40, city: 'Montreuil' }, '2026-10-30', { ...deps, locate: place('93048'), rentData: async () => null }), /migration/);
});

test('recherche : Montreuil encadré, arrondissement de Paris, plafonds non chargés', async () => {
  const data = { indicators: [ind({ insee: '93048' }), ind({ insee: '75111', mid: 30, low: 25, high: 36 })], caps: [cap()], config: DEFAULT_MARKET_CONFIG };
  const r = await lookupMarketRent({ property_type: 'appartement', rooms: 2, surface: 45, city: 'Montreuil', zip: '93100', construction_year: 1930, chargesMonthly: 80 },
    '2026-10-30', { locate: place('93048'), rentData: async () => data });
  assert.equal(r.capStatus, 'ok');
  assert.equal(r.mr.capHc, 1080);
  const paris = await lookupMarketRent({ property_type: 'appartement', rooms: 2, surface: 30, city: 'Paris', zip: '75011' },
    '2026-10-30', { locate: place('75056'), rentData: async (codes) => { assert.deepEqual(codes, ['75111', '75056']); return data; } });
  assert.equal(paris.insee, '75111');
  assert.equal(paris.mr.mid, 900);
  assert.equal(paris.encadreSansPlafond, 'Paris'); // commune encadrée, plafonds pas encore chargés
  const kA = lookupKey({ surface: 45, rooms: 2 }), kB = lookupKey({ surface: 46, rooms: 2 });
  assert.notEqual(kA, kB);
});
