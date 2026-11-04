/**
 * Génère un interchange EDI-TDFC de test (population fictive DGFiP) à partir d'une liasse LMNP calculée.
 * Usage : node --import tsx scripts/tdfc-exemple.ts [fichier de sortie]
 */
import { writeFileSync } from 'node:fs';
import type { Expense, Property } from '../src/data/types.ts';
import { fiscalSummary, type FiscalData } from '../src/domain/fiscal.ts';
import { buildInterchange, checkRequest, encodeInterchange, type TdfcRequest } from '../src/domain/edi/tdfc.ts';

const prop = {
  id: 'p1', title: 'T2 meublé', status: 'acquis', tax_regime: 'reel_bic', ownership_mode: 'nom_propre', acquired_at: '2024-01-01', acquisition_cost: 200000,
  vigilance: [], acquisition_snapshot: null,
} as unknown as Property;
const exp = (id: string, category: Expense['category'], amount: number, d: string, nature: Expense['nature'] = 'charge') =>
  ({ id, property_id: 'p1', expense_date: d, paid_on: d, amount, category, nature, recoverable_amount: 0, payment_status: 'paye' } as unknown as Expense);
const data: FiscalData = { properties: [prop], leases: [], charges: [], payments: [], allocations: [],
  expenses: [exp('e1', 'loyer', 12000, '2025-03-01'), exp('e2', 'copropriete', 1200, '2025-03-01'), exp('e3', 'taxe_fonciere', 900, '2025-10-15'), exp('e4', 'mobilier', 3000, '2025-02-01', 'immobilisation')] };

const liasse = fiscalSummary(2025, data, () => ({})).reelBic!.liasse;
const request: TdfcRequest = {
  partner: { agrement: '0000000', name: 'IMMO-ZEN', address: { street: '1 avenue de Paris', zip: '94300', city: 'Vincennes' },
    transfer: { mode: 'T', alias: 'XXXXXXXX' }, software: { editor: 'IMMO-ZEN', program: 'Immo-Zen', version: '0.1' }, attestation: 'EN ATTENTE' },
  declarant: { siren: '079555934', rof: 'BIC1', name: 'MONSIEUR 01', address: { street: '252 RUE ALPHANUMERIQUE', zip: '44001', city: 'NANTES CHANTIERS' }, naf: '6820A' },
  period: { start: '2025-01-01', end: '2025-12-31' }, liasse, test: true, preparedAt: new Date(), sequence: 1, documentRef: 'EXEMPLE-LMNP-2025',
};
const message = buildInterchange(request);
const out = process.argv[2] ?? 'tdfc-exemple.edi';
writeFileSync(out, encodeInterchange(message));
console.log(`${out} : ${message.items.length} données, référence ${message.reference}`);
for (const c of checkRequest(request)) console.log(`[${c.level}] ${c.message}`);
console.log('\n' + message.interchange.replace(/(?<!\?)'/g, "'\n"));
