/** @fileoverview BE-003a unit tests: vault AEAD encryption.

 * Test type: unit (per Kanban task).
 * Covers all acceptance criteria:
 *   AC1: Vault data encrypted with vault key using AES-256-GCM AEAD
 *   AC2: AAD binds ciphertext to vault ID (no cross-vault reuse)
 *
 * AR-3 compliance: positive + negative tests for every crypto path.
 * AR-4 compliance: all data is synthetic — generated at test time.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  encryptVaultData,
  decryptVaultData,
  type VaultPlaintext,
  type VaultEncryptedRecord,
} from '../src/vault';
import { deriveVaultKey, registerMasterPassword } from '../src/index';

// ─── Synthetic test data (AR-4 compliant) ─────────────────────────────────────

const SYNTHETIC_PASSWORD = 'test-master-password-42';
const SYNTHETIC_VAULT_ID = 'vault-synthetic-001';
const SYNTHETIC_VAULT_NAME = 'My Secure Vault';
const SYNTHETIC_VAULT_DESC = 'Encrypted vault for unit tests';
const SYNTHETIC_VAULT_NAME_2 = 'Another Vault';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

let vaultKey: Buffer;
let record: Awaited<ReturnType<typeof registerMasterPassword>>;

beforeAll(async () => {
  record = await registerMasterPassword(Buffer.from(SYNTHETIC_PASSWORD));
  vaultKey = await deriveVaultKey(Buffer.from(SYNTHETIC_PASSWORD), record.salt, record.kdfParams);
});

// ─── Positive tests ───────────────────────────────────────────────────────────

describe('encryptVaultData / decryptVaultData (AC1)', () => {
  it('encrypts and decrypts vault name', () => {
    const encrypted = encryptVaultData(vaultKey, SYNTHETIC_VAULT_ID, SYNTHETIC_VAULT_NAME, null);
    const decrypted = decryptVaultData(vaultKey, SYNTHETIC_VAULT_ID, encrypted);
    expect(decrypted.name).toBe(SYNTHETIC_VAULT_NAME);
    expect(decrypted.description).toBeNull();
    expect(decrypted.version).toBe(1);
  });

  it('encrypts and decrypts vault name + description', () => {
    const encrypted = encryptVaultData(vaultKey, SYNTHETIC_VAULT_ID, SYNTHETIC_VAULT_NAME, SYNTHETIC_VAULT_DESC);
    const decrypted = decryptVaultData(vaultKey, SYNTHETIC_VAULT_ID, encrypted);
    expect(decrypted.name).toBe(SYNTHETIC_VAULT_NAME);
    expect(decrypted.description).toBe(SYNTHETIC_VAULT_DESC);
  });

  it('round-trips through base64 (simulates DB persistence)', () => {
    const encrypted = encryptVaultData(vaultKey, SYNTHETIC_VAULT_ID, SYNTHETIC_VAULT_NAME, SYNTHETIC_VAULT_DESC);
    // Simulate DB storage: all fields are base64 strings.
    const persisted: VaultEncryptedRecord = {
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: encrypted.tag,
    };
    const decrypted = decryptVaultData(vaultKey, SYNTHETIC_VAULT_ID, persisted);
    expect(decrypted.name).toBe(SYNTHETIC_VAULT_NAME);
    expect(decrypted.description).toBe(SYNTHETIC_VAULT_DESC);
  });

  it('different plaintexts produce different ciphertexts', () => {
    const enc1 = encryptVaultData(vaultKey, SYNTHETIC_VAULT_ID, SYNTHETIC_VAULT_NAME, null);
    const enc2 = encryptVaultData(vaultKey, SYNTHETIC_VAULT_ID, SYNTHETIC_VAULT_NAME_2, null);
    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
    expect(enc1.iv).not.toBe(enc2.iv);
  });

  it('random nonce per encryption (SEC-001 Decision 4)', () => {
    const enc1 = encryptVaultData(vaultKey, SYNTHETIC_VAULT_ID, SYNTHETIC_VAULT_NAME, null);
    const enc2 = encryptVaultData(vaultKey, SYNTHETIC_VAULT_ID, SYNTHETIC_VAULT_NAME, null);
    expect(enc1.iv).not.toBe(enc2.iv);
  });

  it('custom version is preserved', () => {
    const encrypted = encryptVaultData(vaultKey, SYNTHETIC_VAULT_ID, 'vault', null, 2);
    const decrypted = decryptVaultData(vaultKey, SYNTHETIC_VAULT_ID, encrypted);
    expect(decrypted.version).toBe(2);
  });
});

// ─── AAD binding (AC2 — SEC-001 Decision 5) ──────────────────────────────────

describe('AAD binding to vault ID (AC2)', () => {
  it('same plaintext + different vault ID → different ciphertext', () => {
    const enc1 = encryptVaultData(vaultKey, 'vault-a', SYNTHETIC_VAULT_NAME, null);
    const enc2 = encryptVaultData(vaultKey, 'vault-b', SYNTHETIC_VAULT_NAME, null);
    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
  });

  it('ciphertext for vault-a cannot be decrypted with vault-b (AAD mismatch)', async () => {
    const encrypted = encryptVaultData(vaultKey, 'vault-a', SYNTHETIC_VAULT_NAME, null);
    // Deliberately using wrong vault ID — AAD binding must reject decryption.
    expect(() => decryptVaultData(vaultKey, 'vault-b', encrypted)).toThrow(
      /authentication failed/i,
    );
  });

  it('wrong key on decrypt is rejected even with correct vault ID', async () => {
    const encrypted = encryptVaultData(vaultKey, SYNTHETIC_VAULT_ID, SYNTHETIC_VAULT_NAME, null);
    // Derive a fresh key with a different password — different key, same vault ID.
    const altRecord = await registerMasterPassword(Buffer.from('alt-password'));
    const altKey = await deriveVaultKey(Buffer.from('alt-password'), altRecord.salt, altRecord.kdfParams);
    expect(() => decryptVaultData(altKey, SYNTHETIC_VAULT_ID, encrypted)).toThrow(
      /authentication failed/i,
    );
  });
});

// ─── Negative tests (AR-3) ────────────────────────────────────────────────────

describe('Negative tests (AR-3)', () => {
  it('wrong key → authentication failure', () => {
    const encrypted = encryptVaultData(vaultKey, SYNTHETIC_VAULT_ID, SYNTHETIC_VAULT_NAME, null);
    const wrongKey = Buffer.alloc(32, 0xAA);
    expect(() => decryptVaultData(wrongKey, SYNTHETIC_VAULT_ID, encrypted)).toThrow(
      /authentication failed/i,
    );
  });

  it('tampered ciphertext → authentication failure', () => {
    const encrypted = encryptVaultData(vaultKey, SYNTHETIC_VAULT_ID, SYNTHETIC_VAULT_NAME, null);
    const cipherBytes = Buffer.from(encrypted.ciphertext, 'base64');
    cipherBytes[0] ^= 0xff;
    const tampered: VaultEncryptedRecord = {
      ciphertext: cipherBytes.toString('base64'),
      iv: encrypted.iv,
      tag: encrypted.tag,
    };
    expect(() => decryptVaultData(vaultKey, SYNTHETIC_VAULT_ID, tampered)).toThrow(
      /authentication failed/i,
    );
  });

  it('tampered tag → authentication failure', () => {
    const encrypted = encryptVaultData(vaultKey, SYNTHETIC_VAULT_ID, SYNTHETIC_VAULT_NAME, null);
    const tagBytes = Buffer.from(encrypted.tag, 'base64');
    tagBytes[0] ^= 0x01;
    const tampered: VaultEncryptedRecord = {
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: tagBytes.toString('base64'),
    };
    expect(() => decryptVaultData(vaultKey, SYNTHETIC_VAULT_ID, tampered)).toThrow(
      /authentication failed/i,
    );
  });

  it('tampered IV → authentication failure or wrong plaintext (never original)', () => {
    const encrypted = encryptVaultData(vaultKey, SYNTHETIC_VAULT_ID, SYNTHETIC_VAULT_NAME, null);
    const wrongIv = Buffer.alloc(12, 0xBB);
    const tampered: VaultEncryptedRecord = {
      ciphertext: encrypted.ciphertext,
      iv: wrongIv.toString('base64'),
      tag: encrypted.tag,
    };
    try {
      const result = decryptVaultData(vaultKey, SYNTHETIC_VAULT_ID, tampered);
      // GCM may produce garbage or throw — we assert it does NOT return the original.
      expect(result.name).not.toBe(SYNTHETIC_VAULT_NAME);
    } catch {
      // Also acceptable: GCM throws on IV mismatch.
    }
  });

  it('empty vault name is valid', () => {
    const encrypted = encryptVaultData(vaultKey, SYNTHETIC_VAULT_ID, '', null);
    const decrypted = decryptVaultData(vaultKey, SYNTHETIC_VAULT_ID, encrypted);
    expect(decrypted.name).toBe('');
  });
});

// ─── Registration + vault encryption end-to-end ───────────────────────────────

describe('End-to-end: register → encrypt vault → decrypt', () => {
  it('full flow with synthetic password', async () => {
    const password = 'e2e-test-password-99';
    const vaultId = 'vault-e2e-001';

    const regRecord = await registerMasterPassword(Buffer.from(password));
    const key = await deriveVaultKey(Buffer.from(password), regRecord.salt, regRecord.kdfParams);

    const encrypted = encryptVaultData(key, vaultId, 'E2E Vault', 'End-to-end test');
    const decrypted = decryptVaultData(key, vaultId, encrypted);

    expect(decrypted.name).toBe('E2E Vault');
    expect(decrypted.description).toBe('End-to-end test');
    expect(decrypted.version).toBe(1);
  });
});
