/** @fileoverview Vault encryption service (BE-003a).

 * Single vault per user, encrypted with vault key (from BE-002),
 * AEAD (AES-256-GCM per SEC-001 Decision 2+3).
 *
 * The vault key is derived from the master password via Argon2id (BE-002a)
 * and held in server memory only during an active session (SEC-001 Decision 6).
 *
 * Vault-level data (name, description) is encrypted with the vault key.
 * Resource-level secrets are encrypted separately per-resource (BE-003b).
 *
 * AR-1: All crypto uses Node.js crypto (AES-256-GCM) — no home-grown constructions.
 * AR-2: No real secrets — all test data is synthetic.
 * AR-3: Positive + negative tests in vault.test.ts.
 */

import { encrypt, decrypt } from './index';
import { Buffer } from 'node:buffer';

// ─── Vault data types ─────────────────────────────────────────────────────────

/** Plaintext vault data that gets encrypted. */
export interface VaultPlaintext {
  name: string;
  description?: string;
}

/** Ciphertext vault record as stored in the DB. */
export interface VaultCiphertext {
  id: string;
  ownerId: string;
  /** Base64-encoded AEAD ciphertext of the serialized VaultPlaintext. */
  dataCiphertext: string;
  /** Base64-encoded nonce (IV) used for encryption. */
  dataIv: string;
  /** Base64-encoded GCM auth tag. */
  dataTag: string;
  /** Vault format version — plaintext, used for migrations (ADR-003 §3.2). */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Serializable form of VaultPlaintext for AES-GCM input. */
export interface VaultSerializable {
  name: string;
  description: string | null;
  version: number;
}

// ─── Vault AEAD helpers ───────────────────────────────────────────────────────

/** Serialize VaultPlaintext to a Buffer for AEAD encryption.
 *
 * The version field is included so that decryption can validate format
 * compatibility (ADR-003 §3.2, SEC-001 Vector 7).
 */
export function serializeVault(data: VaultPlaintext, version = 1): Buffer {
  const payload: VaultSerializable = {
    name: data.name,
    description: data.description ?? null,
    version,
  };
  return Buffer.from(JSON.stringify(payload), 'utf-8');
}

/** Deserialize a decrypted Buffer back to VaultPlaintext. */
export function deserializeVault(buffer: Buffer): VaultPlaintext {
  const payload: VaultSerializable = JSON.parse(buffer.toString('utf-8'));
  return {
    name: payload.name,
    description: payload.description ?? undefined,
  };
}

/**
 * Encrypt vault data with the vault key, binding to the vault ID via AAD.
 *
 * The AAD (Additional Authenticated Data) binds the ciphertext to a specific
 * vault ID, preventing an attacker from copying ciphertext from one vault to
 * another (SEC-001 Decision 5).
 */
export function encryptVault(
  vaultKey: Buffer,
  vaultId: string,
  plaintext: VaultPlaintext,
  version = 1,
): { ciphertext: string; iv: string; tag: string } {
  const aad = Buffer.from(`vault:${vaultId}`, 'utf-8');
  const serialized = serializeVault(plaintext, version);
  const { ciphertext, iv, tag } = encrypt(vaultKey, serialized, aad);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

/**
 * Decrypt vault data with the vault key, verifying the AAD binding.
 *
 * Returns the plaintext vault data. Throws if the ciphertext is tampered,
 * the key is wrong, or the AAD does not match the vault ID.
 */
export function decryptVault(
  vaultKey: Buffer,
  vaultId: string,
  ciphertextB64: string,
  ivB64: string,
  tagB64: string,
): VaultPlaintext {
  const aad = Buffer.from(`vault:${vaultId}`, 'utf-8');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const decrypted = decrypt(vaultKey, ciphertext, iv, tag, aad);
  return deserializeVault(decrypted);
}

// ─── Re-export AEAD primitives for resource encryption (BE-003b) ─────────────

/** Re-export encrypt/decrypt for resource-level encryption. */
export { encrypt, decrypt };
