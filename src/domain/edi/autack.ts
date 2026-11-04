/**
 * Sécurisation EDI-TDFC : message AUTACK PEDI (cahier des charges 2026, volume IV § 4.3, GUM AUTACK v13.01)
 * et procédé de signature du pack technique DGFiP « nouvelle sécurisation EDI » (programme signer_donnees.c).
 *
 * Bloc signé (44 octets) = SHA-256 du groupe fonctionnel INFENT (de « UNG » à « UNE…' » inclus, octets
 * ISO 8859-15 transmis) suivi de la date et de l'heure de signature « AAAAMMJJhhmm », identiques à
 * celles de l'UNG. Signature RSA 2048 bits, remplissage PKCS#1 v1.5 de type 1 (RSA_private_encrypt,
 * sans en-tête d'algorithme), transmise en hexadécimal (512 caractères) dans le segment USY.
 *
 * La clé privée ne doit jamais être chargée dans le navigateur : la signature est déléguée à une fonction
 * serveur (voir supabase/functions/_shared/tdfcSigner.ts).
 */
import { segment } from './edifact.ts';

/** Signataire RSA « brut » : chiffre le bloc avec la clé privée (PKCS#1 v1.5 type 1). */
export type RawRsaSigner = (block: Uint8Array) => Promise<Uint8Array>;

export interface Accreditation {
  /** SIRET étendu : SIRET (14) + numéro d'ordre TDFC (10). */
  siretExtended: string;
  /** Numéro du dispositif virtuel de signature. */
  device: string;
  /** Clé publique du partenaire (SubjectPublicKeyInfo, base 64), certifiée par la DGFiP. */
  publicKeySpki: string;
  /** Signature de la DGFiP (hexadécimal, 512 caractères). */
  dgfipSignature: string;
  /** Les 1368 caractères tels que remis par le correspondant téléprocédures. */
  raw: string;
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
const ascii = (h: string) => String.fromCharCode(...(h.match(/../g) ?? []).map((x) => parseInt(x, 16)));

/** Décode l'accréditation (fichier de 1368 caractères hexadécimaux remis par la DGFiP). */
export function parseAccreditation(text: string): Accreditation {
  const raw = text.trim();
  if (!/^[0-9A-Fa-f]{1368}$/.test(raw)) throw new Error('Accréditation invalide : 1368 caractères hexadécimaux attendus.');
  const siretExtended = ascii(raw.slice(0, 48));
  const device = ascii(raw.slice(48, 72));
  const publicKeySpki = ascii(raw.slice(72, 856));
  if (!/^\d{24}$/.test(siretExtended)) throw new Error('Accréditation invalide : SIRET étendu illisible.');
  if (!/^MII[A-Za-z0-9+/=]+$/.test(publicKeySpki)) throw new Error('Accréditation invalide : clé publique illisible.');
  return { siretExtended, device, publicKeySpki, dgfipSignature: raw.slice(856).toUpperCase(), raw };
}

/** Bloc à signer : SHA-256 du groupe fonctionnel + « AAAAMMJJhhmm ». */
export async function signedBlock(group: Uint8Array, stamp: string): Promise<Uint8Array> {
  if (!/^\d{12}$/.test(stamp)) throw new Error('Horodatage de signature invalide (AAAAMMJJhhmm).');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', group as Uint8Array<ArrayBuffer>));
  const out = new Uint8Array(44);
  out.set(digest, 0);
  for (let i = 0; i < 12; i++) out[32 + i] = stamp.charCodeAt(i);
  return out;
}

export interface AutackParams {
  test: boolean;
  /** Numéro d'agrément DGFiP du partenaire émetteur. */
  agrement: string;
  accreditation: Accreditation;
  /** Signature du bloc, hexadécimal (512 caractères pour une clé de 2048 bits). */
  signatureHex: string;
  /** Date et heure de préparation, identiques à celles de l'UNG INFENT. */
  yymmdd: string;
  hhmm: string;
}

/** Groupe fonctionnel AUTACK PEDI (deuxième groupe de l'interchange), de UNG à UNE. */
export function autackGroup(p: AutackParams): string {
  const version = 'FA1301';
  const body = [
    segment('UNH', '00001', ['AUTACK', '4', '1', 'UN', version]),
    segment('USH', '1', '1', '3', '1', '2', '2'),
    segment('USC', undefined, undefined, undefined, 'ZZ1', '2'),
    segment('USR', ['1', p.accreditation.raw]),
    segment('USB', '1', undefined, [p.agrement, 'ZZ1'], ['DGI_EDI_TDFC']),
    segment('USX', undefined, undefined, undefined, '1'),
    segment('USY', '1', ['1', p.signatureHex]),
    segment('UST', '1'),
  ];
  body.push(segment('UNT', String(body.length + 1), '00001'));
  return [
    segment('UNG', 'AUTACK', [p.test ? 'DF4' : 'DF1', 'ZZ1'], ['EDI_TDFC'], [p.yymmdd, p.hhmm], '2', 'UN', ['4', '1', version]),
    ...body,
    segment('UNE', '1', '2'),
  ].join('');
}

/** Signe le groupe fonctionnel INFENT et renvoie la signature en hexadécimal. */
export async function signGroup(group: Uint8Array, stamp: string, signer: RawRsaSigner): Promise<string> {
  const sig = await signer(await signedBlock(group, stamp));
  if (sig.length !== 256) throw new Error(`Signature de ${sig.length} octets : clé RSA de 2048 bits attendue.`);
  return hex(sig);
}
