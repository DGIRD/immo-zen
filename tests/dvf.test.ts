import { test } from 'node:test';
import assert from 'node:assert/strict';
import { departmentOf, dvfUrl, dvfYears, estimate, loadSales, salesFromCsv } from '../supabase/functions/_shared/dvf.ts';
import { locate, valuate, ValuationError } from '../src/domain/valuation.ts';
import { csv, row, salesAround } from './fixtures/dvf.ts';

test('DVF : fichiers communaux et années consultées', () => {
  assert.equal(departmentOf('75102'), '75');
  assert.equal(departmentOf('2A004'), '2A');
  assert.equal(departmentOf('97411'), '974');
  assert.equal(dvfUrl(2025, '75102'), 'https://files.data.gouv.fr/geo-dvf/latest/csv/2025/communes/75/75102.csv');
  assert.deepEqual(dvfYears('2026-10-18'), [2025, 2024, 2023]);
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

test('DVF : fourchette = quartiles du prix au m² des ventes proches × surface', () => {
  const near = salesAround(18, 10000);
  const far = salesAround(20, 5000, { lat: 48.9, prefix: 'F' }); // ~3,5 km : hors rayon
  const sales = salesFromCsv(csv([...near, ...far, row({ id: 'X', value: 50 * 30000, surface: 50 })])); // valeur extrême
  const e = estimate(sales, { type: 'Appartement', surface: 50, lat: 48.8686, lon: 2.3317 })!;
  assert.equal(e.radius, 300);
  assert.equal(e.count, 18); // la vente extrême est écartée (Tukey)
  assert.equal(e.perM2.median, 10000);
  assert.ok(e.perM2.p25 < 10000 && e.perM2.p75 > 10000);
  assert.equal(e.low, Math.round((e.perM2.p25 * 50) / 1000) * 1000);
  assert.equal(e.median, 500000);
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

test('Estimation : localisation puis lecture des fichiers DVF des trois dernières années', async () => {
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
  assert.deepEqual(asked, { citycode: '75102', type: 'Appartement', surface: 45, lat: 48.8686, lon: 2.3317 });
  await assert.rejects(valuate(input, '2026-10-18', null, broken), /inaccessibles/);
});
