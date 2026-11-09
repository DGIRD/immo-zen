import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confidenceOf, departmentOf, dvfUrl, dvfYears, estimate, loadSales, salesFromCsv, weightedQuantile, type DvfSale } from '../supabase/functions/_shared/dvf.ts';
import { applyFeatures, dpeRentalWarning, featureAdjustments } from '../src/domain/valuationFeatures.ts';
import { locate, valuate, ValuationError } from '../src/domain/valuation.ts';
import { csv, row, salesAround } from './fixtures/dvf.ts';

test('DVF : fichiers communaux et années consultées', () => {
  assert.equal(departmentOf('75102'), '75');
  assert.equal(departmentOf('2A004'), '2A');
  assert.equal(departmentOf('97411'), '974');
  assert.equal(dvfUrl(2025, '75102'), 'https://files.data.gouv.fr/geo-dvf/latest/csv/2025/communes/75/75102.csv');
  assert.deepEqual(dvfYears('2026-10-18'), [2025, 2024, 2023, 2022]);
});

test('DVF : une vente = une mutation d’un seul logement, ventes seulement', () => {
  const sales = salesFromCsv(csv([
    row({ id: 'A', value: 400000, surface: 50 }),
    row({ id: 'A', value: 400000, surface: 0 }, 'Dépendance', ''), // cave vendue avec l'appartement : gardée
    row({ id: 'B', value: 900000, surface: 50 }), row({ id: 'B', value: 900000, surface: 60 }), // deux logements : écartée
    row({ id: 'C', value: 300000, surface: 40, nature: 'Echange' }), // pas une vente
    row({ id: 'D', value: 50000, surface: 6 }), // surface trop petite
    row({ id: 'E', value: 700000, surface: 120, type: 'Maison', lat: 48.87 }),
  ]));
  assert.deepEqual(sales.map((s) => s.id), ['A', 'E']);
  assert.equal(sales[0]!.address, '12 RUE DE LA PAIX, BAT A 75002 Paris 2e Arrondissement');
  assert.equal(sales[0]!.value / sales[0]!.surface, 8000);
  assert.equal(sales[1]!.type, 'Maison');
  assert.throws(() => salesFromCsv('a,b\n1,2'), /Format DVF/);
  assert.deepEqual(salesFromCsv(''), []);
});

test('DVF : fourchette = quartiles pondérés du prix au m² des ventes proches × surface', () => {
  const near = salesAround(18, 10000);
  const far = salesAround(20, 5000, { lat: 48.9, prefix: 'F' }); // ~3,5 km : hors rayon
  const sales = salesFromCsv(csv([...near, ...far, row({ id: 'X', value: 50 * 30000, surface: 50 })])); // valeur extrême
  const e = estimate(sales, { type: 'Appartement', surface: 50, lat: 48.8686, lon: 2.3317 })!;
  assert.equal(e.radius, 300);
  assert.equal(e.count, 18); // la vente extrême est écartée (Tukey)
  assert.ok(Math.abs(e.perM2.median - 10000) <= 100, String(e.perM2.median));
  assert.ok(e.perM2.p25 < e.perM2.median && e.perM2.p75 > e.perM2.median);
  assert.ok(Math.abs(e.median - 500000) <= 5000, String(e.median));
  assert.ok(e.low < e.median && e.median < e.high);
  assert.equal(e.comparables.length, 10);
  assert.match(e.source, /^DVF 2024–2024, 18 ventes d'appartements à moins de 300 m$/);

  // sans coordonnées : toute la commune
  const all = estimate(sales, { type: 'Appartement', surface: 50 })!;
  assert.equal(all.radius, null);
  assert.ok(all.perM2.median < 10000);
  assert.match(all.source, /dans la commune/);

  // pas de maison : pas d'estimation
  assert.equal(estimate(sales, { type: 'Maison', surface: 90 }), null);
  assert.equal(estimate(sales, { type: 'Appartement', surface: 0 }), null);
});

const geo = (citycode: string, type = 'housenumber') => JSON.stringify({ features: [{ geometry: { coordinates: [2.3317, 48.8686] }, properties: { citycode, label: '12 Rue de la Paix 75002 Paris', type } }] });

function fakeFetch(files: Record<string, string | number>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith('https://data.geopf.fr/')) return new Response(geo('75102'));
    const f = files[url];
    if (typeof f === 'number') return new Response('', { status: f });
    if (f === undefined) return new Response('', { status: 404 });
    return new Response(f);
  }) as typeof fetch;
}

test('Estimation : localisation puis lecture des fichiers DVF des dernières années', async () => {
  const placeFetch = fakeFetch({});
  const p = await locate('12 rue de la Paix', '75002', 'Paris', placeFetch);
  assert.deepEqual(p, { citycode: '75102', lat: 48.8686, lon: 2.3317, label: '12 Rue de la Paix 75002 Paris', precise: true });
  assert.equal(await locate('', '', '', placeFetch), null);

  const files = {
    [dvfUrl(2025, '75102')]: csv(salesAround(10, 10000, { date: '2025-03-01' })),
    [dvfUrl(2024, '75102')]: csv(salesAround(10, 10000, { prefix: 'N', date: '2024-03-01' })),
  };
  const sales = await loadSales('75102', [2025, 2024, 2023], fakeFetch(files));
  assert.equal(sales.length, 20);

  const input = { address: '12 rue de la Paix', zip: '75002', city: 'Paris', property_type: 'appartement' as const, surface: 45 };
  const { estimate: e } = await valuate(input, '2026-10-18', null, fakeFetch(files));
  assert.ok(Math.abs(e.median - 450000) <= 5000, String(e.median));
  assert.match(e.source, /DVF 2024–2025, 20 ventes/);

  await assert.rejects(valuate({ ...input, property_type: 'parking' }, '2026-10-18', null, fakeFetch(files)), ValuationError);
  await assert.rejects(valuate({ ...input, surface: null }, '2026-10-18', null, fakeFetch(files)), /surface/);
  await assert.rejects(valuate(input, '2026-10-18', null, fakeFetch({})), /Trop peu de ventes/);

  // fichiers illisibles depuis le navigateur : calcul par la fonction serveur
  const broken = fakeFetch({ [dvfUrl(2025, '75102')]: 503 });
  let asked: unknown = null;
  const { estimate: s } = await valuate(input, '2026-10-18', async (payload) => { asked = payload; return e; }, broken);
  assert.equal(s, e);
  assert.deepEqual(asked, { citycode: '75102', type: 'Appartement', surface: 45, rooms: null, lat: 48.8686, lon: 2.3317 });
  await assert.rejects(valuate(input, '2026-10-18', null, broken), /inaccessibles/);
});

const sale = (o: Partial<DvfSale> & { perM2: number }): DvfSale => {
  const surface = o.surface ?? 40;
  return { id: o.id ?? String(Math.random()), date: o.date ?? '2025-06-01', value: o.perM2 * surface, type: 'Appartement', surface, rooms: o.rooms ?? 2, lat: o.lat ?? 48.8686, lon: o.lon ?? 2.3317, address: 'X' };
};

test('Quantile pondéré : une valeur lourde tire la médiane vers elle', () => {
  assert.equal(weightedQuantile([{ v: 1, w: 1 }, { v: 2, w: 1 }, { v: 3, w: 1 }], 0.5), 2);
  assert.ok(weightedQuantile([{ v: 1, w: 1 }, { v: 2, w: 1 }, { v: 3, w: 8 }], 0.5) > 2.5);
});

test('DVF : les ventes anciennes sont ramenées à aujourd’hui selon l’évolution des prix de la commune', () => {
  // marché en hausse de 5 % par an : 2022 → 8 640 €/m², 2025 → 10 000 €/m²
  const sales: DvfSale[] = [];
  for (let y = 2022; y <= 2025; y++) for (let i = 0; i < 12; i++) sales.push(sale({ date: `${y}-06-01`, perM2: Math.round(10000 * 1.05 ** (y - 2025)) + (i % 3 - 1) * 50 }));
  const e = estimate(sales, { type: 'Appartement', surface: 40, lat: 48.8686, lon: 2.3317, today: '2025-06-01' })!;
  assert.ok(Math.abs(e.method!.trendPerYear - Math.log(1.05)) < 0.01, String(e.method!.trendPerYear));
  assert.ok(Math.abs(e.perM2.median - 10000) <= 150, String(e.perM2.median));
  // sans correction, la médiane brute serait nettement plus basse
  const raw = [...sales].map((s) => s.value / s.surface).sort((a, b) => a - b);
  assert.ok(raw[Math.floor(raw.length / 2)]! < 9600);
});

test('DVF : effet de la surface, poids des ventes proches et des mêmes pièces', () => {
  const sales: DvfSale[] = [];
  // les studios se vendent plus cher au m² que les grands appartements
  for (let i = 0; i < 40; i++) {
    const surface = 20 + (i % 8) * 10;
    sales.push(sale({ surface, rooms: Math.max(1, Math.round(surface / 20)), perM2: Math.round(12000 * (surface / 50) ** -0.2), lat: 48.8686 + (i % 4) * 0.0003 }));
  }
  const small = estimate(sales, { type: 'Appartement', surface: 25, rooms: 1, lat: 48.8686, lon: 2.3317, today: '2025-06-01' })!;
  const big = estimate(sales, { type: 'Appartement', surface: 90, rooms: 4, lat: 48.8686, lon: 2.3317, today: '2025-06-01' })!;
  assert.ok(small.method!.sizeElasticity < -0.1, String(small.method!.sizeElasticity));
  assert.ok(small.perM2.median > big.perM2.median);
  assert.ok(small.comparables.every((c) => (c.weight ?? 0) > 0 && (c.weight ?? 0) <= 1));
  assert.equal(small.comparables[0]!.weight, 1);
});

test('DVF : indice de confiance', () => {
  assert.equal(confidenceOf({ effective: 20, dispersion: 0.1, radius: 300, located: true, lastSale: '2025-09-01', today: '2026-01-01' }).score, 5);
  const weak = confidenceOf({ effective: 4, dispersion: 0.4, radius: 2000, located: true, lastSale: '2023-01-01', today: '2026-01-01' });
  assert.equal(weak.score, 1);
  assert.equal(weak.label, 'Très faible');
  assert.equal(weak.reasons.length, 4);
});

test('Caractéristiques du bien : écarts publiés, plafonnés à ±25 %', () => {
  const ctx = { apartment: true, paris: false };
  const adj = featureAdjustments({ dpe: 'B', floor: 'rdc', outdoor: 'balcon', parking: true, condition: 'renove' }, ctx);
  assert.deepEqual(adj.map((a) => a.pct), [12, 5, -5, 6, 7]);
  const r = applyFeatures({ low: 200000, median: 220000, high: 240000 }, adj);
  assert.equal(r.pct, 25); // 1,12 × 1,05 × 0,95 × 1,06 × 1,07 = 1,268 → plafonné à +25 %
  assert.equal(r.median, 275000);
  // Paris : pas d'écart pour le parking ; maison : ni étage ni extérieur
  assert.equal(featureAdjustments({ parking: true }, { apartment: true, paris: true }).length, 0);
  assert.deepEqual(featureAdjustments({ floor: 'rdc', dpe: 'G' }, { apartment: false, paris: false }).map((a) => a.label), ['DPE G']);
  assert.equal(featureAdjustments({ floor: 'haut', elevator: false }, ctx)[0]!.pct, -3);
  assert.equal(applyFeatures({ low: 100000, median: 100000, high: 100000 }, []).median, 100000);
  assert.match(dpeRentalWarning('G')!, /1er janvier 2025/);
  assert.equal(dpeRentalWarning('C'), null);
});
