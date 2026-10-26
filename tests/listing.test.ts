import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, listingScore, mergeListing, parseAmount, parseListing, sanitizeListing } from '../supabase/functions/_shared/listing.ts';

test('montants : espaces, points de milliers, virgule décimale', () => {
  assert.equal(parseAmount('245 000 €'), 245000);
  assert.equal(parseAmount('245.000€'), 245000);
  assert.equal(parseAmount('1 250,50'), 1250.5);
  assert.equal(parseAmount('45,5'), 45.5);
  assert.equal(parseAmount('abc'), null);
});

test('page avec données structurées (JSON-LD) et balises Open Graph', () => {
  const html = `<html><head><title>Vente appartement 2 pièces</title>
    <meta property="og:title" content="Appartement 2 pi&egrave;ces 41 m&sup2; – Montreuil">
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"BreadcrumbList"},{"@type":"Apartment","name":"T2 lumineux proche métro",
      "floorSize":{"@type":"QuantitativeValue","value":41.5,"unitCode":"MTK"},"numberOfRooms":2,"numberOfBedrooms":1,
      "address":{"@type":"PostalAddress","postalCode":"93100","addressLocality":"Montreuil","streetAddress":"12 rue de Paris"},
      "offers":{"@type":"Offer","price":"229000","priceCurrency":"EUR"}}]}</script></head>
    <body><h1>T2 lumineux</h1><p>Classe énergie : D. Charges de copropriété : 1 320 € / an. Taxe foncière : 980 €.</p></body></html>`;
  const d = parseListing({ html });
  assert.equal(d.title, 'T2 lumineux proche métro');
  assert.equal(d.price, 229000);
  assert.equal(d.surface, 41.5);
  assert.equal(d.rooms, 2);
  assert.equal(d.bedrooms, 1);
  assert.equal(d.property_type, 'appartement');
  assert.equal(d.zip, '93100');
  assert.equal(d.city, 'Montreuil');
  assert.equal(d.address, '12 rue de Paris');
  assert.equal(d.dpe, 'D');
  assert.equal(d.copro_charges_annual, 1320);
  assert.equal(d.property_tax_annual, 980);
  assert.equal(d.sources.price, 'données structurées');
  assert.equal(d.sources.dpe, 'texte de l’annonce');
});

test('texte collé depuis une annonce', () => {
  const text = `Appartement 3 pièces 62 m²
Lyon 7e (69007)
285 000 €
Bel appartement traversant au 3e étage avec ascenseur, 2 chambres, balcon.
Honoraires : 12 000 € TTC à la charge de l'acquéreur.
Charges de copropriété : 150 € par mois
Taxe foncière : 1 100 €
DPE : C   GES : B
Copropriété de 40 lots.`;
  const d = parseListing({ text });
  assert.equal(d.price, 285000);
  assert.equal(d.surface, 62);
  assert.equal(d.rooms, 3);
  assert.equal(d.bedrooms, 2);
  assert.equal(d.property_type, 'appartement');
  assert.equal(d.zip, '69007');
  assert.equal(d.city, 'Lyon 7e');
  assert.equal(d.dpe, 'C');
  assert.equal(d.copro_charges_annual, 1800, '150 € par mois × 12');
  assert.equal(d.property_tax_annual, 1100);
  assert.equal(d.agency_fees, 12000);
  assert.equal(d.floor, 3);
  assert.ok(listingScore(d) >= 8);
});

test('maison : surface habitable avant le terrain, studio et code postal en tête', () => {
  const d = parseListing({ text: 'Maison 5 pièces\n44100 Nantes\nSurface habitable : 112 m² sur 600 m² de terrain\nPrix : 389 000 € FAI\nClasse énergétique E' });
  assert.equal(d.property_type, 'maison');
  assert.equal(d.surface, 112);
  assert.equal(d.price, 389000);
  assert.equal(d.zip, '44100');
  assert.equal(d.city, 'Nantes');
  assert.equal(d.dpe, 'E');
  const s = parseListing({ text: 'Studio meublé 18 m2 — 98 500 euros — 13005 Marseille' });
  assert.equal(s.rooms, 1);
  assert.equal(s.surface, 18);
  assert.equal(s.price, 98500);
  assert.equal(s.furnished, true);
});

test('montants hors plage ignorés, lecture assistée validée puis fusionnée', () => {
  const d = parseListing({ text: 'Appelez le 06 12 34 56 78. Loyer 750 € / mois.' });
  assert.equal(d.price, null, 'un loyer mensuel n’est pas un prix de vente');
  const ai = sanitizeListing({ price: '199000', surface: 'non précisé', dpe: 'z', zip: '7501', property_type: 'maison', city: 'Rennes' });
  assert.deepEqual([ai.price, ai.surface, ai.dpe, ai.zip, ai.property_type, ai.city], [199000, null, null, null, 'maison', 'Rennes']);
  const m = mergeListing(parseListing({ text: 'Maison 80 m²' }), ai, 'lecture assistée');
  assert.equal(m.surface, 80);
  assert.equal(m.sources.surface, 'texte de l’annonce');
  assert.equal(m.price, 199000);
  assert.equal(m.sources.price, 'lecture assistée');
});

test('texte d’une page HTML', () => {
  assert.equal(htmlToText('<p>Prix&nbsp;: 100&nbsp;000&nbsp;&euro;</p><script>var x = 1;</script>'), 'Prix : 100 000 €');
});
