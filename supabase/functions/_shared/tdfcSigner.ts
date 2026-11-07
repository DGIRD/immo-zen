/**
 * Signataire RSA de l'interchange EDI-TDFC, côté serveur uniquement (Node ou Deno via « node:crypto »).
 * Reproduit RSA_private_encrypt(…, RSA_PKCS1_PADDING) du programme DGFiP signer_donnees.c.
 *
 * La clé privée (PEM, éventuellement protégée par mot de passe) est un secret de la fonction serveur
 * (variables TDFC_PRIVATE_KEY et TDFC_PRIVATE_KEY_PASSPHRASE) ; elle ne transite jamais par le navigateur.
 */
import { Buffer } from 'node:buffer';
import { constants, createPrivateKey, createPublicKey, privateEncrypt, publicDecrypt, type KeyObject } from 'node:crypto';

/** Signataire RSA « brut » (même forme que RawRsaSigner de src/domain/edi/autack.ts). */
export type RawRsaSigner = (block: Uint8Array) => Promise<Uint8Array>;

export function loadPrivateKey(pem: string, passphrase?: string): KeyObject {
  const key = createPrivateKey({ key: pem, format: 'pem', passphrase });
  const bits = key.asymmetricKeyDetails?.modulusLength;
  if (key.asymmetricKeyType !== 'rsa' || bits !== 2048) throw new Error(`Clé RSA de 2048 bits attendue (reçue : ${key.asymmetricKeyType} ${bits ?? '?'} bits).`);
  if (key.asymmetricKeyDetails?.publicExponent !== 65537n) throw new Error('Exposant public 65537 attendu.');
  return key;
}

export function rawRsaSigner(key: KeyObject): RawRsaSigner {
  return async (block) => new Uint8Array(privateEncrypt({ key, padding: constants.RSA_PKCS1_PADDING }, block));
}

/** Vérifie une signature avec une clé publique (PEM ou SPKI base 64) et renvoie le bloc signé. */
export function recoverBlock(publicKey: string, signatureHex: string): Uint8Array {
  const pem = publicKey.includes('BEGIN') ? publicKey : `-----BEGIN PUBLIC KEY-----\n${publicKey.match(/.{1,64}/g)!.join('\n')}\n-----END PUBLIC KEY-----\n`;
  return new Uint8Array(publicDecrypt({ key: createPublicKey(pem), padding: constants.RSA_PKCS1_PADDING }, Buffer.from(signatureHex, 'hex')));
}

/**
 * L'accréditation a-t-elle été délivrée pour cette clé privée ? Compare la clé publique certifiée
 * (SPKI base 64, voir parseAccreditation) à celle de la clé du signataire.
 */
export function accreditationMatchesKey(certifiedSpki: string, key: KeyObject): boolean {
  return createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64') === certifiedSpki;
}
