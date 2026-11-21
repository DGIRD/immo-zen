import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Property } from '../src/data/types.ts';
import { bankDossierDoc } from '../src/domain/bankDossier.ts';
import { buildBankDossierPdf } from '../src/domain/bankDossierPdf.ts';
import { buildDocPdf } from '../src/domain/docPdf.ts';
import { patrimonyLines, patrimonyTotals, propertyValue } from '../src/domain/patrimony.ts';
import { applyStatusRules, isRental, isResidence } from '../src/domain/property.ts';
import { euroWords, inWords, purchaseOfferDoc, suggestArguments, suggestedPrice } from '../src/domain/purchaseOffer.ts';
import { DEFAULT_INPUTS, simulate } from '../src/domain/simulator.ts';
import { planUsage } from '../src/domain/plans.ts';

const prop = (o: Partial<Property>): Property => ({
  id: crypto.randomUUID(), user_id: 'u', version: 1, created_at: '', updated_at: '', title: 'Bien', status: 'acquis', status_before_archive: null,
  occupation_status: 'loue', property_type: 'appartement', address: null, zip: null, city: null, surface: null, rooms: null, dpe: null, listing_url: null,
  asking_price: null, offer_price: null, works_budget: null, estimated_rent: null, agency_id: null, agent_id: null, next_action: null, follow_up_date: null,
  visit_at: null, comments: null, vigilance: [], ownership_mode: null, tax_regime: null, acquired_at: null, acquisition_cost: null, acquisition_snapshot: null,
  primary_scenario_id: null, legacy_simulation_id: null, legacy_ref: null, ...o,
} as Property);

const today = '2026-11-20';
const rp = prop({ title: 'Maison Nantes', usage: 'residence_principale', estimate_median: 420000, loan_amount: 300000, loan_rate: 3, loan_years: 25, loan_start_date: '2020-01-05' });
const rs = prop({ title: 'Studio Biarritz', usage: 'residence_secondaire', estimate_low: 180000, estimate_high: 200000 });
const loc = prop({ title: 'T2 Lyon', estimated_rent: 750, acquisition_cost: 160000, loan_amount: 140000, loan_years: 20, loan_rate: 2 });
const prospect = prop({ title: 'Prospect', status: 'repere', estimate_median: 100000 });

test('bilan patrimonial : valeur médiane, capital restant dû, net, résidences en tête', () => {
  const lines = patrimonyLines([loc, rs, rp, prospect], today);
  assert.deepEqual(lines.map((l) => l.title), ['Maison Nantes', 'Studio Biarritz', 'T2 Lyon'], 'biens détenus seulement, résidences d’abord');
  const [a, b, c] = lines;
  assert.equal(a!.value, 420000); assert.equal(a!.valueSource, 'mediane');
  assert.ok(a!.remaining > 0 && a!.remaining < 300000); assert.equal(a!.remainingSource, 'calcul');
  assert.equal(b!.value, 190000); assert.equal(b!.valueSource, 'fourchette'); assert.equal(b!.remaining, 0);
  assert.equal(c!.value, 160000); assert.equal(c!.valueSource, 'achat');
  assert.equal(c!.remaining, 140000); assert.equal(c!.remainingSource, 'initial', 'sans date de début : montant initial');
  assert.equal(a!.monthlyRent, 0); assert.equal(c!.monthlyRent, 750);
  const t = patrimonyTotals(lines);
  assert.equal(t.value, 770000);
  assert.equal(t.net, Math.round((770000 - t.remaining) * 100) / 100);
  assert.equal(t.count, 3); assert.equal(t.missingValue, 0);
  assert.deepEqual(propertyValue({ estimate_median: null, estimate_low: null, estimate_high: null, acquisition_cost: null }), { value: null, source: null });
  // crédit terminé : plus de capital restant dû
  const fini = patrimonyLines([prop({ estimate_median: 1, loan_amount: 10000, loan_years: 5, loan_rate: 1, loan_start_date: '2010-01-01' })], today);
  assert.equal(fini[0]!.remaining, 0);
});

test('résidences : hors gestion locative, hors forfait, statut « usage personnel »', () => {
  assert.ok(isResidence(rp)); assert.ok(!isRental(rp)); assert.ok(isRental(loc));
  const ruled = applyStatusRules(null, { ...rp, occupation_status: 'loue', tax_regime: 'micro_foncier' } as Property, []);
  assert.equal(ruled.occupation_status, 'usage_personnel');
  assert.equal(ruled.tax_regime, null);
  const u = planUsage({ properties: [rp, rs, loc], documents: [] } as never);
  assert.equal(u.owned, 1, 'seuls les biens locatifs comptent dans le forfait');
});

test('dossier banque : section bilan patrimonial avec « après le projet »', async () => {
  const inputs = { ...DEFAULT_INPUTS, askingPrice: 250000, price: 240000, surface: 60, monthlyRent: 1200, rentMode: 'manuel' as const, downPayment: 30000, interestRate: 3.5, loanYears: 20, insuranceRate: 0.3 };
  const out = simulate(inputs); assert.ok(out.ok);
  const lines = patrimonyLines([rp, rs, loc], today);
  const doc = bankDossierDoc({ property: { title: 'T3 Vincennes' }, inputs, result: out.result, editedOn: today, patrimony: lines });
  const s = doc.sections.find((x) => x.title === 'Bilan patrimonial immobilier')!;
  assert.ok(s, 'section présente');
  const [detail, synth] = s.blocks.filter((b) => b.t === 'table') as { rows: string[][] }[];
  assert.equal(detail!.rows.length, 4, '3 biens + total');
  assert.match(detail!.rows[2]![2]!, /\(1\)/, 'valeur au coût d’acquisition signalée');
  assert.equal(synth!.rows.length, 5);
  const t0 = patrimonyTotals(lines);
  const avec = bankDossierDoc({ property: { title: 'T3', estimate_median: 300000 }, inputs, result: out.result, editedOn: today, patrimony: lines });
  const synth2 = (avec.sections.find((x) => x.title === 'Bilan patrimonial immobilier')!.blocks.filter((b) => b.t === 'table')[1] as { rows: string[][] }).rows;
  assert.equal(synth2[0]![2]!.replace(/\D/g, ''), String(t0.value + 300000), 'après le projet : valeur médiane du bien visé, pas le prix d’achat');
  assert.match(JSON.stringify(avec.sections), /valeur médiane estimée du bien visé/);
  assert.ok(doc.cover.pitch.some((x) => x.startsWith('Patrimoine immobilier actuel : 3 biens')));
  const sans = bankDossierDoc({ property: { title: 'T3' }, inputs, result: out.result, editedOn: today });
  assert.ok(!sans.sections.some((x) => x.title.startsWith('Bilan')));
  const pdf = await PDFDocument.load(await buildBankDossierPdf({ PDFDocument, StandardFonts, rgb } as never, doc));
  assert.ok(pdf.getPageCount() >= 2);
});

test('montant en lettres', () => {
  assert.equal(inWords(185000), 'cent quatre-vingt-cinq mille');
  assert.equal(inWords(280000), 'deux cent quatre-vingt mille');
  assert.equal(inWords(80), 'quatre-vingts');
  assert.equal(inWords(200), 'deux cents');
  assert.equal(inWords(71), 'soixante et onze');
  assert.equal(inWords(1250300), 'un million deux cent cinquante mille trois cents');
  assert.equal(inWords(1000), 'mille');
  assert.equal(inWords(21991), 'vingt et un mille neuf cent quatre-vingt-onze');
  assert.equal(euroWords(1), 'un euro');
});

test('offre d’achat : arguments pré-remplis, prix suggéré, conditions et PDF', async () => {
  const inputs = { ...DEFAULT_INPUTS, priceMode: 'honoraires_inclus' as const, askingPrice: 210000, price: 195000, agencyFees: 10000, surface: 50, works: 15000, monthlyRent: 800, rentMode: 'manuel' as const,
    downPayment: 20000, interestRate: 3.8, loanYears: 25, coproChargesAnnual: 2400, propertyTaxAnnual: 1300 };
  const out = simulate(inputs); assert.ok(out.ok);
  const r = out.result;
  const property = { title: 'T2 Roubaix', address: '3 rue X', zip: '59100', city: 'Roubaix', property_type: 'appartement', dpe: 'F', estimate_median: 180000 };
  const args = suggestArguments({ property, inputs, result: r }, { monthsOnMarket: 6 });
  const by = Object.fromEntries(args.map((a) => [a.id, a]));
  assert.ok(by.dpe!.relevant); assert.match(by.dpe!.text, /2028/); assert.equal(by.dpe!.amount, 15000);
  assert.equal(by.travaux!.amount, 0, 'travaux déjà comptés dans le DPE');
  assert.ok(by.marche!.relevant); assert.equal(by.marche!.amount, 200000 - 180000);
  assert.ok(by.taux!.relevant); assert.ok(by.copro!.relevant); assert.ok(by.duree!.relevant);
  const chosen = args.filter((a) => a.relevant);
  assert.equal(suggestedPrice(210000, chosen), 175000);
  const doc = purchaseOfferDoc({ property, inputs, editedOn: today, args: chosen,
    parties: { buyers: 'Marie et Paul Exemple', buyersAddress: '1 place Y, Lille' },
    terms: { priceFai: 175000, agencyFees: 10000, equity: r.equity, loan: { amount: 160000, years: 25, maxRate: 3.9 }, validUntil: '2026-11-27', compromisDays: 30, loanDays: 45 } });
  assert.deepEqual(doc.warnings, []);
  const titles = doc.sections.map((s) => s.title);
  assert.deepEqual(titles, ['Parties', 'Bien concerné', 'Offre', 'Motifs de l’offre', 'Financement et conditions', 'Validité et suite de l’offre', 'Signatures']);
  const offre = JSON.stringify(doc.sections[2]);
  assert.match(offre, /Nous soussignés/); assert.match(offre, /cent soixante-quinze mille euros/); assert.match(offre, /net vendeur de 165/);
  assert.match(JSON.stringify(doc.sections[4]), /L313-40/);
  assert.match(JSON.stringify(doc.sections[5]), /1589-1/);
  assert.match(JSON.stringify(doc.sections[6]), /générée à l’aide d’Immo-Zen/); assert.match(doc.footer ?? '', /Immo-Zen/);
  // sans prêt : mention de renonciation ; délai trop court : avertissement
  const cash = purchaseOfferDoc({ property, inputs, editedOn: today, args: [], parties: { buyers: 'Paul' },
    terms: { priceFai: 300000, agencyFees: 0, equity: 0, loan: null, validUntil: '2026-11-27', compromisDays: 30, loanDays: 45 } });
  assert.match(JSON.stringify(cash.sections), /L313-42/);
  assert.match(JSON.stringify(cash.sections), /Je soussigné/);
  assert.ok(cash.warnings.some((w) => w.includes('dépasse')));
  const court = purchaseOfferDoc({ property, inputs, editedOn: today, args: [], parties: { buyers: 'Paul' },
    terms: { priceFai: 1, agencyFees: 0, equity: 0, loan: { amount: 1, years: 1, maxRate: 1 }, validUntil: today, compromisDays: 30, loanDays: 20 } });
  assert.ok(court.warnings.some((w) => w.includes('L313-41')));
  const pdf = await PDFDocument.load(await buildDocPdf({ PDFDocument, StandardFonts, rgb } as never, doc));
  assert.ok(pdf.getPageCount() >= 1);
});
