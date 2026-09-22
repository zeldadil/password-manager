/** @fileoverview AES-256-GCM AEAD primitives (SEC-001 Decision 2).
 *
 * Extracted from index.ts (BE-003a crypto refactor) — encrypt/decrypt are
 * consumed by both the master-password key-wrap flow (index.ts) and the
 * per-vault AEAD flow (vault.ts).
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

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
