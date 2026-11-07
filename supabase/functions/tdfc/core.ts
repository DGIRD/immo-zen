/**
 * Cœur de la fonction serveur « tdfc » : liasse LMNP → contrôles → interchange INFENT-DF signé (AUTACK).
 *
 * Module pur : aucune entrée-sortie. La base (données, numéro séquentiel) et la cryptographie (signature,
 * vérification) sont injectées. Testé sous Node (tests/tdfcServer.test.ts) ; regroupé par esbuild dans
 * core.bundle.js pour le déploiement (scripts/build-functions.mjs), car il réutilise src/domain.
 */
import type { Allocation, DepositMovement, Expense, Lease, Payment, Property, RentCharge, TaxInputs, TaxPropertyInputs } from '../../../src/data/types.ts';
import { reviewBilan } from '../../../src/domain/bilanReview.ts';
import { parseAccreditation, signedBlock, type RawRsaSigner } from '../../../src/domain/edi/autack.ts';
import { encodeLatin9 } from '../../../src/domain/edi/edifact.ts';
import {
  buildInterchange, campaignFor, checkRequest, parisStamp, secureInterchange,
  type EdiPartner, type PostalAddress, type TdfcCheck, type TdfcDeclarant, type TdfcItem, type TdfcRequest,
} from '../../../src/domain/edi/tdfc.ts';
import { fiscalSummary } from '../../../src/domain/fiscal.ts';

export { parseAccreditation };

// ------------------------------------------------------------------ configuration du partenaire (secrets)

export interface PartnerConfig { partner: EdiPartner; test: boolean; errors: string[] }

/**
 * Lit la configuration du partenaire EDI dans les secrets de la fonction.
 * TDFC_MODE vaut « test » par défaut : un envoi réel exige TDFC_MODE=reel.
 */
export function partnerFromEnv(env: (k: string) => string | undefined): PartnerConfig {
  const errors: string[] = [];
  const v = (k: string) => (env(k) ?? '').trim();
  let address: PostalAddress = { street: '', zip: '', city: '' };
  try {
    const raw = v('TDFC_PARTNER_ADDRESS');
    if (raw) address = JSON.parse(raw) as PostalAddress; else errors.push('TDFC_PARTNER_ADDRESS manquant.');
  } catch { errors.push('TDFC_PARTNER_ADDRESS : JSON invalide.'); }
  for (const k of ['TDFC_AGREMENT', 'TDFC_TRANSFER_ALIAS', 'TDFC_ATTESTATION', 'TDFC_ACCREDITATION', 'TDFC_PRIVATE_KEY']) if (!v(k)) errors.push(`${k} manquant.`);
  const mode = v('TDFC_MODE') || 'test';
  if (mode !== 'test' && mode !== 'reel') errors.push('TDFC_MODE doit valoir « test » ou « reel ».');
  return {
    test: mode !== 'reel',
    errors,
    partner: {
      agrement: v('TDFC_AGREMENT'),
      name: v('TDFC_PARTNER_NAME') || 'IMMO-ZEN',
      address,
      transfer: { mode: v('TDFC_TRANSFER_MODE') === 'C' ? 'C' : 'T', alias: v('TDFC_TRANSFER_ALIAS') },
      software: { editor: 'IMMO-ZEN', program: 'Immo-Zen', version: v('TDFC_SOFTWARE_VERSION') || '1.0' },
      attestation: v('TDFC_ATTESTATION'),
      accreditation: v('TDFC_ACCREDITATION') || undefined,
    },
  };
}

// ------------------------------------------------------------------ données de l'abonné

export interface TdfcSnapshot {
  properties: Property[];
  leases: Lease[];
  charges: RentCharge[];
  payments: Payment[];
  allocations: Allocation[];
  expenses: Expense[];
  deposits: DepositMovement[];
  taxInputs: TaxInputs;
}

/** Ligne de tdfc_declarants. */
export interface DeclarantRow {
  siren: string; rof: string; name: string; address: PostalAddress; home: PostalAddress | null; naf: string | null; activity: string | null;
}

const PARAMS = 'params', FOYER = 'foyer';

/** Saisies fiscales d'un bien pour une année (paramètres permanents complétés par l'année), comme la page Déclaration. */
export function inputsGetter(t: TaxInputs) {
  return (pid: string, y: number): TaxPropertyInputs => ({ ...(t[PARAMS]?.[pid] ?? {}), ...(t[String(y)]?.[pid] ?? {}) });
}

export interface Preview {
  year: number;
  /** Données transmises, pour l'aperçu. */
  /** kind : montant en euros, date (AAAAMMJJ) ou texte. */
  items: { form: string; code: string; label: string; value: string; kind: 'montant' | 'date' | 'texte' }[];
  checks: TdfcCheck[];
  blocking: boolean;
  summary: { properties: number; fiscalResult: number; turnover: number; assetsNet: number };
}

function itemValue(i: TdfcItem): string {
  const v = i.value;
  switch (v.seg) {
    case 'MOA': return String(Math.trunc(v.amount));
    case 'FTX': return v.texts.join(' ');
    case 'DTM': return v.value;
    case 'CCI': return v.value;
    case 'CUX': return v.currency;
    case 'RFF': return v.value;
    case 'NAD': return [v.id, ...v.names, v.address && `${v.address.street}, ${v.address.zip} ${v.address.city}`].filter(Boolean).join(' — ');
  }
}

/** Construit la demande (sans numéro séquentiel ni horodatage définitifs) et la contrôle. */
export function buildRequest(year: number, snap: TdfcSnapshot, declarant: DeclarantRow | null, cfg: PartnerConfig, preparedAt: Date, sequence = 1, documentRef = `IZ${year}`) {
  const inputs = inputsGetter(snap.taxInputs);
  const data = { properties: snap.properties, leases: snap.leases, charges: snap.charges, payments: snap.payments, allocations: snap.allocations, expenses: snap.expenses };
  const fiscal = fiscalSummary(year, data, inputs);
  const checks: TdfcCheck[] = [];
  if (!fiscal.reelBic) return { request: null, review: null, propertyCount: 0, checks: [{ level: 'bloquant', message: `Aucun bien au régime réel BIC (LMNP) pour ${year}.` } as TdfcCheck] };
  const props = fiscal.reelBic.perProperty.map((r) => snap.properties.find((p) => p.id === r.propertyId)!).filter(Boolean);
  const foyer = snap.taxInputs[String(year)]?.[FOYER] ?? {};
  const review = reviewBilan(year, { ...data, deposits: snap.deposits }, props, fiscal.reelBic.liasse, inputs, foyer);
  if (!declarant) checks.push({ level: 'bloquant', message: 'Identité fiscale du déclarant non renseignée (SIREN, référence d’obligation fiscale, adresse).' });
  for (const e of cfg.errors) checks.push({ level: 'bloquant', message: `Configuration du partenaire EDI : ${e}`, scope: 'partenaire' });
  const decl: TdfcDeclarant = declarant
    ? { siren: declarant.siren, rof: declarant.rof, name: declarant.name, address: declarant.address, home: declarant.home ?? undefined, naf: declarant.naf ?? undefined, activity: declarant.activity ?? undefined }
    : { siren: '', rof: '', name: '', address: { street: '', zip: '', city: '' } };
  const request: TdfcRequest = {
    partner: cfg.partner, declarant: decl, period: { start: `${year}-01-01`, end: `${year}-12-31` },
    liasse: fiscal.reelBic.liasse, balance: review.balance, test: cfg.test, preparedAt, sequence, documentRef,
  };
  checks.push(...checkRequest(request), ...review.facts.warnings.map((message) => ({ level: 'avertissement', message }) as TdfcCheck));
  return { request, review, checks, propertyCount: props.length };
}

/** Aperçu sans signature ni numéro : ce qui sera transmis, et les contrôles. */
export function preview(year: number, snap: TdfcSnapshot, declarant: DeclarantRow | null, cfg: PartnerConfig, now: Date): Preview {
  const { request, review, checks, propertyCount } = buildRequest(year, snap, declarant, cfg, now);
  const blocking = checks.some((c) => c.level === 'bloquant');
  if (!request || !review || !campaignFor(request.period.end)) {
    return { year, items: [], checks, blocking: true, summary: { properties: 0, fiscalResult: 0, turnover: 0, assetsNet: 0 } };
  }
  const items = buildInterchange(request).items.map((i) => ({
    form: i.form, code: i.code, label: i.label, value: itemValue(i),
    kind: i.value.seg === 'MOA' ? 'montant' as const : i.value.seg === 'DTM' && i.value.format === '102' ? 'date' as const : 'texte' as const,
  }));
  return {
    year, items, checks, blocking,
    summary: {
      properties: propertyCount,
      fiscalResult: request.liasse.fiscalResult,
      turnover: request.liasse.lines.find((l) => l.code === '218')?.amount ?? 0,
      assetsNet: review.bilan.assetsNet,
    },
  };
}

// ------------------------------------------------------------------ préparation signée

export interface CryptoDeps {
  signer: RawRsaSigner;
  /** Retrouve le bloc signé avec la clé publique (SPKI base 64) : vérification avant archivage. */
  recover: (publicKeySpki: string, signatureHex: string) => Uint8Array;
}

export interface Prepared {
  reference: string;
  documentRef: string;
  bytes: Uint8Array;
  sha256: string;
  signatureHex: string;
  test: boolean;
  checks: TdfcCheck[];
  summary: Preview['summary'] & { items: number };
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

/**
 * Prépare l'interchange signé. Refuse s'il reste un contrôle bloquant. Le numéro séquentiel n'est pris
 * qu'une fois les contrôles passés ; la signature est vérifiée avec la clé certifiée avant d'être rendue.
 */
export async function prepare(
  year: number, snap: TdfcSnapshot, declarant: DeclarantRow | null, cfg: PartnerConfig, now: Date,
  nextSequence: (parisDay: string) => Promise<number>, crypto: CryptoDeps, submissionId: string,
): Promise<{ ok: true; prepared: Prepared } | { ok: false; checks: TdfcCheck[] }> {
  const first = buildRequest(year, snap, declarant, cfg, now);
  if (!first.request || first.checks.some((c) => c.level === 'bloquant')) return { ok: false, checks: first.checks };
  const day = parisStamp(now).yyyymmdd;
  const sequence = await nextSequence(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}`);
  const documentRef = `IZ${year}-${submissionId.replaceAll('-', '').slice(0, 12).toUpperCase()}`;
  const { request, review, checks, propertyCount } = buildRequest(year, snap, declarant, cfg, now, sequence, documentRef);
  if (!request || !review || checks.some((c) => c.level === 'bloquant')) return { ok: false, checks };

  const message = buildInterchange(request);
  const secured = await secureInterchange(message, cfg.partner.accreditation!, crypto.signer);
  const accreditation = parseAccreditation(cfg.partner.accreditation!);
  const expected = await signedBlock(encodeLatin9(message.group), message.stamp.signature);
  let recovered: Uint8Array;
  try { recovered = crypto.recover(accreditation.publicKeySpki, secured.signatureHex); } catch { recovered = new Uint8Array(0); }
  if (recovered.length !== expected.length || recovered.some((b, i) => b !== expected[i]))
    throw new Error('La signature ne se vérifie pas avec la clé certifiée par l’accréditation : clé privée et accréditation ne correspondent pas.');
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', secured.bytes as Uint8Array<ArrayBuffer>));
  return {
    ok: true,
    prepared: {
      reference: secured.reference, documentRef, bytes: secured.bytes, sha256: hex(digest), signatureHex: secured.signatureHex, test: request.test, checks,
      summary: {
        properties: propertyCount, fiscalResult: request.liasse.fiscalResult,
        turnover: request.liasse.lines.find((l) => l.code === '218')?.amount ?? 0, assetsNet: review.bilan.assetsNet, items: message.items.length,
      },
    },
  };
}
