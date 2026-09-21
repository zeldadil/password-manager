/** @fileoverview Crypto primitives for the Secure Password Manager.

 * Implements SEC-001 / ADR-002 cryptographic decisions:
 *   - Decision 1: Argon2id KDF (memory=64MB, iterations=3, parallelism=4, hashLength=32)
 *   - Decision 2: AES-256-GCM AEAD (12-byte random nonce, 16-byte auth tag)
 *   - Decision 3: Key hierarchy — master password → KDF → vault key → AEAD → vault data
 *
 * AR-1: All constructions use peer-reviewed libraries (argon2 npm binding,
 * Node.js crypto for AES-GCM). No home-grown crypto.
 * AR-2: No real secrets in this file — all constants are parameters, all
 *        test data is synthetic.
 * AR-3: Positive + negative tests in __tests__/crypto.test.ts.
 */

import argon2 from 'argon2';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// ─── KDF parameters (SEC-001 Decision 1) ──────────────────────────────────

/** Argon2id KDF parameters per SEC-001 Decision 1.
 *
 * These values are tuned for a self-hosted server that can afford ~1s derive
 * time. They are the canonical parameters — any change must be documented as
 * a crypto decision update and gated by AR-6.
 */
export const KDF_PARAMS = {
  algorithm: 'argon2id',
  memory: 65536,    // 64 MiB in KiB
  iterations: 3,
  parallelism: 4,
  hashLength: 32,   // 256-bit output for AES-256
};

export type StoredKdfParams = typeof KDF_PARAMS;

/** Shape of the full user KDF record stored in the DB.
 *
 * Matches the `users` table columns: salt, kdfParams, vaultKeyEncrypted,
 * vaultKeyIv, vaultKeyTag.
 */
export interface KdfRegistrationRecord {
  kdfParams: StoredKdfParams;
  salt: Buffer;
  vaultKeyEncrypted: Buffer;
  vaultKeyIv: Buffer;
  vaultKeyTag: Buffer;
}

// ─── KDF ───────────────────────────────────────────────────────────────────

export async function deriveVaultKey(
  masterPassword: Buffer,
  salt: Buffer,
  params: StoredKdfParams = KDF_PARAMS,
): Promise<Buffer> {
  const hash = await argon2.hash(masterPassword, {
    type: argon2.argon2id,
    memoryCost: params.memory,
    timeCost: params.iterations,
    parallelism: params.parallelism,
    hashLength: params.hashLength,
    salt,
    raw: true,
  });
  return Buffer.from(hash);
}

// ─── AEAD (AES-256-GCM) ────────────────────────────────────────────────────

/** Authentication tag length in bytes (128-bit tag, the GCM default and the
 *  value this module's `decrypt` requires — pinned explicitly on both the
 *  cipher and decipher so a truncated-tag forgery can't be smuggled through
 *  a shorter negotiated tag length. */
const GCM_AUTH_TAG_LENGTH = 16;

export function encrypt(
  key: Buffer,
  plaintext: Buffer,
  aad?: Buffer,
): { ciphertext: Buffer; iv: Buffer; tag: Buffer } {
  if (key.length !== 32) throw new Error('encrypt: key must be 32 bytes');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, {
    authTagLength: GCM_AUTH_TAG_LENGTH,
  });
  if (aad) cipher.setAAD(aad, { plaintextLength: plaintext.length });
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext, iv, tag };
}

export function decrypt(
  key: Buffer,
  ciphertext: Buffer,
  iv: Buffer,
  tag: Buffer,
  aad?: Buffer,
): Buffer {
  if (key.length !== 32) throw new Error('decrypt: key must be 32 bytes');
  if (iv.length !== 12) throw new Error('decrypt: iv must be 12 bytes');
  if (tag.length !== GCM_AUTH_TAG_LENGTH) {
    throw new Error('decrypt: tag must be 16 bytes');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv, {
      authTagLength: GCM_AUTH_TAG_LENGTH,
    });
    if (aad) decipher.setAAD(aad, { plaintextLength: ciphertext.length });
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext;
  } catch {
    throw new Error('decrypt: authentication failed — ciphertext may be tampered');
  }
}

// ─── Registration flow (SEC-001 Decision 6, step 1) ───────────────────────

export async function registerMasterPassword(
  masterPassword: Buffer,
  _userId?: string,
): Promise<KdfRegistrationRecord> {
  const salt = randomBytes(16);
  const vaultKey = await deriveVaultKey(masterPassword, salt);
  // Self-wrap: encrypt vault key with itself, no AAD.
  // The 12-byte random nonce provides uniqueness; AAD binding is a
  // future enhancement (see SEC-001 Decision 3 key-rotation note).
  const { ciphertext, iv, tag } = encrypt(vaultKey, vaultKey);
  return {
    kdfParams: { ...KDF_PARAMS },
    salt,
    vaultKeyEncrypted: ciphertext,
    vaultKeyIv: iv,
    vaultKeyTag: tag,
  };
}

// ─── Unlock flow (SEC-001 Decision 6, step 2) ─────────────────────────────

export async function unlockVaultKey(
  masterPassword: Buffer,
  record: KdfRegistrationRecord,
): Promise<Buffer> {
  const candidateKey = await deriveVaultKey(
    masterPassword,
    record.salt,
    record.kdfParams,
  );
  return decrypt(
    candidateKey,
    record.vaultKeyEncrypted,
    record.vaultKeyIv,
    record.vaultKeyTag,
  );
}

/** JWT signing and verification utilities. */
export * from './jwt';
