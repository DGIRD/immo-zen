import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pdfLib from 'pdf-lib';
import type { Lease, LeaseContract, Property, Tenant } from '../src/data/types.ts';
import { buildContract, contractText, defaultContract, FURNITURE_MINIMUM, leaseFormIssues, type ContractContext } from '../src/domain/leaseContract.ts';
import { buildDocPdf } from '../src/domain/docPdf.ts';

const property = (o: Partial<Property> = {}): Property => ({
  id: 'p1', user_id: 'u', version: 1, created_at: '', updated_at: '', title: 'T2 Lilas', status: 'acquis', status_before_archive: null, occupation_status: 'loue',
  property_type: 'appartement', address: '3 rue des Lilas', zip: '69003', city: 'Lyon', surface: 42.5, rooms: 2, dpe: 'D', listing_url: null, asking_price: null,
  offer_price: null, works_budget: null, estimated_rent: 800, agency_id: null, agent_id: null, next_action: null, follow_up_date: null, visit_at: null, comments: null,
  vigilance: [], ownership_mode: 'nom_propre', tax_regime: 'reel_foncier', acquired_at: '2020-01-01', acquisition_cost: 200000, acquisition_snapshot: null,
  primary_scenario_id: null, legacy_simulation_id: null, legacy_ref: null, ...o,
});
const lease = (o: Partial<Lease> = {}): Lease => ({
  id: 'l1', user_id: 'u', version: 1, created_at: '', updated_at: '', property_id: 'p1', label: null, furnished: false, start_date: '2026-11-01', end_date: null,
  rent_hc: 800, charges_amount: 60, charges_mode: 'provision', deposit_amount: 800, payment_day: 5, landlord_name: 'Paul Bailleur', landlord_address: '1 place Bellecour, 69002 Lyon',
  owner_confirmation_email: false, receipt_auto_send: false, reminder_enabled: false, reminder_delay_days: 10, notes: null,
  irl_enabled: true, irl_base_label: '2026-T2', irl_base_value: 147.12, ...o,
});
const tenant = (last: string, first = 'Léa'): Tenant => ({ id: last, user_id: 'u', version: 1, created_at: '', updated_at: '', first_name: first, last_name: last, email: `${last.toLowerCase()}@example.test`, phone: null, notes: null, archived_at: null });
const ctx = (o: Partial<ContractContext> = {}): ContractContext => ({ lease: lease(), property: property(), tenants: [tenant('Martin')], today: '2026-10-20', ...o });
const full = (c: Partial<LeaseContract>, x = ctx()): LeaseContract => ({ ...defaultContract(x), construction_period: '1949_1974', energy_cost_min: 900, energy_cost_max: 1300, energy_ref_year: 2025, ...c });

test('bail vide : contrat type (I à XI), reconduction 3 ans, révision IRL, clause résolutoire à six semaines', () => {
  const x = ctx();
  const c = full({}, x);
  assert.equal(c.kind, 'vide');
  assert.equal(c.duration_months, 36);
  const doc = buildContract(c, x);
  assert.deepEqual(doc.errors, []);
  assert.deepEqual(doc.warnings, []);
  const titles = doc.sections.map((s) => s.title);
  assert.deepEqual(titles.slice(0, 7), ['I. Désignation des parties', 'II. Objet du contrat', 'III. Date de prise d’effet et durée du contrat', 'IV. Conditions financières', 'V. Travaux', 'VI. Garanties', 'VII. Clause résolutoire']);
  const t = contractText(doc);
  assert.match(t, /décret n° 2015-587/);
  assert.match(t, /Surface habitable : 42,5 m²/);
  assert.match(t, /reconduit tacitement pour 3 ans/);
  assert.match(t, /2026, 2e trimestre \(valeur 147,12\)/);
  assert.match(t, /six semaines après un commandement de payer/);
  assert.match(t, /préavis de trois mois/);
  assert.match(t, /entre 900,00 € et 1 300,00 € par an/);
  assert.match(t, /Notice d’information/);
  assert.ok(!/Clause de solidarité/.test(t), 'pas de solidarité avec un seul locataire');
  assert.match(doc.fileName, /^bail-vide-lyon-2026-11-01\.pdf$/);
});

test('bail vide : dépôt, durée, forfait de charges, DPE G et encadrement contrôlés', () => {
  const x = ctx({ lease: lease({ deposit_amount: 1600, charges_mode: 'forfait' }), property: property({ dpe: 'G' }) });
  const doc = buildContract(full({ duration_months: 24 }, x), x);
  assert.ok(doc.errors.some((e) => e.includes('Dépôt de garantie trop élevé')));
  assert.ok(doc.errors.some((e) => e.includes('Durée trop courte')));
  assert.ok(doc.errors.some((e) => e.includes('forfait est réservé à la colocation')));
  assert.ok(doc.errors.some((e) => e.includes('classé G')));
  // durée réduite justifiée par un événement précis
  const y = ctx();
  assert.deepEqual(buildContract(full({ duration_months: 12, reduced_reason: 'Départ à la retraite et retour dans le logement' }, y), y).errors, []);
  assert.ok(buildContract(full({ duration_months: 12, reduced_reason: 'x', landlord_kind: 'morale' }, y), y).errors.length > 0, 'pas de durée réduite pour une personne morale');
  // encadrement des loyers : 800 € pour 42,5 m² > 15 €/m² majoré
  const enc = buildContract(full({ zone_tendue: true, reference_rent: 12.5, reference_rent_increased: 15 }, y), y);
  assert.ok(enc.errors.some((e) => e.includes('loyer de référence majoré')));
  assert.deepEqual(buildContract(full({ zone_tendue: true, reference_rent: 12.5, reference_rent_increased: 15, rent_complement: 162.5, rent_complement_reason: 'Terrasse de 30 m²' }, y), y).errors, []);
});

test('bail meublé : un an, dépôt de deux mois, mobilier minimal, préavis d’un mois ; colocation solidaire', () => {
  const x = ctx({ lease: lease({ furnished: true, deposit_amount: 1600, charges_mode: 'forfait' }), tenants: [tenant('Martin'), tenant('Durand', 'Hugo')] });
  const c = full({}, x);
  assert.equal(c.kind, 'meuble');
  assert.equal(c.duration_months, 12);
  assert.deepEqual(c.furniture, FURNITURE_MINIMUM);
  const doc = buildContract(c, x);
  assert.deepEqual(doc.errors, []);
  const t = contractText(doc);
  assert.match(t, /titre Ier bis/);
  assert.match(t, /reconduit tacitement pour un an/);
  assert.match(t, /préavis d’un mois/);
  assert.match(t, /Clause de solidarité/);
  assert.match(t, /Réfrigérateur et congélateur/);
  assert.match(t, /forfait mensuel de 60,00 €/);
  assert.match(t, /en 3 exemplaires/);
  const student = buildContract(full({ student: true, duration_months: 9 }, x), x);
  assert.deepEqual(student.errors, []);
  assert.match(contractText(student), /n’est pas reconduit tacitement/);
  assert.ok(buildContract(full({ duration_months: 9 }, x), x).errors.some((e) => e.includes('Durée trop courte')));
});

test('bail civil (résidence secondaire, société) et parking : Code civil, durée libre, avertissement', () => {
  const x = ctx({ lease: lease({ deposit_amount: 2400 }) });
  const sec = buildContract(full({ kind: 'civil_secondaire', duration_months: 6 }, x), x);
  assert.deepEqual(sec.errors, []);
  assert.ok(sec.warnings.some((w) => w.includes('résidence principale')));
  assert.match(contractText(sec), /résidence secondaire/);
  assert.match(contractText(sec), /articles 1714 et suivants du Code civil/);
  assert.match(contractText(sec), /jusqu’au 30\/04\/2027/);

  const soc = buildContract(full({ kind: 'civil_societe' }, x), x);
  assert.ok(soc.errors.some((e) => e.includes('Raison sociale')));
  const soc2 = buildContract(full({ kind: 'civil_societe', company_name: 'Acme SAS', company_id: '123456789', company_representative: 'Jeanne Dupont, présidente', occupant_name: 'Marc Salarié' }, { ...x, tenants: [] }), { ...x, tenants: [] });
  assert.deepEqual(soc2.errors, []);
  assert.match(contractText(soc2), /pour y loger Marc Salarié/);

  const px = ctx({ property: property({ property_type: 'parking', surface: null, rooms: null, dpe: null }), lease: lease({ rent_hc: 90, charges_amount: 0, deposit_amount: 90, irl_enabled: false }) });
  const pk = defaultContract(px);
  assert.equal(pk.kind, 'parking');
  assert.equal(pk.notice_months, 1);
  const pdoc = buildContract({ ...pk, parking_spot: 'Box n° 12, 2e sous-sol' }, px);
  assert.deepEqual(pdoc.errors, []);
  assert.match(contractText(pdoc), /stationnement d’un véhicule/);
  assert.match(contractText(pdoc), /Box n° 12/);
});

test('PDF du contrat : document lisible de plusieurs pages', async () => {
  const x = ctx({ tenants: [tenant('Martin'), tenant('Durand', 'Hugo')] });
  const doc = buildContract(full({ special_conditions: 'Animaux autorisés. ≤ ≥ → caractères remplacés.' }, x), x);
  const bytes = await buildDocPdf(pdfLib as never, { title: doc.title, subtitle: doc.subtitle, sections: doc.sections, footer: 'Bail' });
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
  const pdf = await pdfLib.PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 3, `pages : ${pdf.getPageCount()}`);
});

test('saisie du bail : plafond du dépôt et forfait de charges contrôlés avant le contrat', () => {
  assert.match(leaseFormIssues({ furnished: false, rent_hc: 750, deposit_amount: 1500 }, 1).deposit_amount ?? '', /750,00 € maximum \(un mois/);
  assert.equal(leaseFormIssues({ furnished: false, rent_hc: 750, deposit_amount: 750 }, 1).deposit_amount, undefined);
  assert.equal(leaseFormIssues({ furnished: true, rent_hc: 750, deposit_amount: 1500 }, 1).deposit_amount, undefined, 'deux mois en meublé');
  assert.match(leaseFormIssues({ furnished: true, rent_hc: 750, deposit_amount: 1600 }, 1).deposit_amount ?? '', /1 500,00 € maximum \(deux mois/);
  assert.match(leaseFormIssues({ furnished: false, rent_hc: 750, deposit_amount: 0, charges_mode: 'forfait' }, 1).charges_mode ?? '', /réservé à la colocation/);
  assert.equal(leaseFormIssues({ furnished: false, rent_hc: 750, deposit_amount: 0, charges_mode: 'forfait' }, 2).charges_mode, undefined, 'colocation');
  assert.deepEqual(leaseFormIssues({ furnished: false, rent_hc: 750, deposit_amount: 3000, charges_mode: 'forfait', contract: { kind: 'parking' } }, 1), {}, 'parking : Code civil');
});
