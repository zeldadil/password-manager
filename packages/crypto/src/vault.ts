/** @fileoverview BE-003a: Vault encryption — single vault per user, AEAD with vault key.

 * The vault key (derived from master password via Argon2id, BE-002a) encrypts
 * vault-level data: name and description. AES-256-GCM is used (SEC-001 Decision 2).
 * The vault ID is bound as Additional Authenticated Data (AAD) to prevent
 * cross-vault ciphertext reuse (SEC-001 Decision 5).
 *
 * Vault data is serialized to JSON before encryption. The format is:
 *   { name: string, description: string | null, version: number }
 *
 * The vault key is held in server memory only during an active session
 * (SEC-001 Decision 6). On lock / session expiry, it is cleared.
 *
 * AR-1: Node.js crypto (AES-256-GCM) only — no home-grown constructions.
 * AR-2: No real secrets in this file.
 * AR-3: Positive + negative tests in tests/vault.test.ts.
 */

import { encrypt, decrypt } from './aead';
import { Buffer } from 'node:buffer';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Plaintext vault data that gets serialized and encrypted. */
export interface VaultPlaintext {
  name: string;
  description: string | null;
  version: number;
}

/** Serialized vault data as stored in the DB (base64-encoded AEAD output). */
export interface VaultEncryptedRecord {
  ciphertext: string;   // base64
  iv: string;           // base64
  tag: string;          // base64
}

// ─── Serialization ────────────────────────────────────────────────────────────

const VAULT_AAD_PREFIX = 'vault:';

/** Serialize VaultPlaintext to a UTF-8 JSON buffer. */
function serialize(plaintext: VaultPlaintext): Buffer {
  return Buffer.from(JSON.stringify(plaintext), 'utf-8');
}

/** Deserialize a decrypted buffer back to VaultPlaintext. */
function deserialize(buffer: Buffer): VaultPlaintext {
  return JSON.parse(buffer.toString('utf-8')) as VaultPlaintext;
}

// ─── Vault AEAD ───────────────────────────────────────────────────────────────

/**
 * Encrypt vault data with the vault key, binding to the vault ID via AAD.
 *
 * The AAD (`vault:<id>`) is authenticated but not encrypted. It prevents an
 * attacker from copying ciphertext from one vault to another — decryption
 * with the wrong vault ID will fail tag verification (SEC-001 Decision 5).
 */
export function encryptVaultData(
  vaultKey: Buffer,
  vaultId: string,
  name: string,
  description: string | null,
  version = 1,
): VaultEncryptedRecord {
  const plaintext: VaultPlaintext = { name, description, version };
  const aad = Buffer.from(VAULT_AAD_PREFIX + vaultId, 'utf-8');
  const { ciphertext, iv, tag } = encrypt(vaultKey, serialize(plaintext), aad);
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
export function decryptVaultData(
  vaultKey: Buffer,
  vaultId: string,
  record: VaultEncryptedRecord,
): VaultPlaintext {
  const aad = Buffer.from(VAULT_AAD_PREFIX + vaultId, 'utf-8');
  const ciphertext = Buffer.from(record.ciphertext, 'base64');
  const iv = Buffer.from(record.iv, 'base64');
  const tag = Buffer.from(record.tag, 'base64');
  return deserialize(decrypt(vaultKey, ciphertext, iv, tag, aad));
}
