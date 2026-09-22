/** @fileoverview BE-003a: Vault encryption.
 *
 * Single vault per user, encrypted with vault key (from BE-002),
 * AEAD (AES-256-GCM per SEC-001 Decision 2+5).
 *
 * The vault key is derived from the master password via Argon2id (BE-002a)
 * and held in server memory only during an active session (SEC-001 Decision 6).
 *
 * Vault-level data (name, description) is encrypted with the vault key.
 * Resource-level secrets are encrypted separately per-resource (BE-003b).
 *
 * AR-1: All crypto uses Node.js crypto (AES-256-GCM) — no home-grown constructions.
 * AR-2: No real secrets — all test data is synthetic.
 * AR-3: Positive + negative tests in this file.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  encryptVault,
  decryptVault,
  type VaultPlaintext,
  type VaultCiphertext,
} from '../src/vault';
import {
  deriveVaultKey,
  registerMasterPassword,
  type KdfRegistrationRecord,
} from '../src/index';
import { Buffer } from 'node:buffer';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bufEq(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

// ─── Synthetic test data (AR-4 compliant) ─────────────────────────────────────

const SYNTHETIC_PASSWORD = Buffer.from('my-secret-master-password');
const SYNTHETIC_PASSWORD_ALT = Buffer.from('different-password');
const SYNTHETIC_VAULT_NAME = 'my-vault';
const SYNTHETIC_VAULT_DESC = 'A test vault for unit tests';
const SYNTHETIC_VAULT_ID = 'vault-abc123';

// ─── Vault AEAD round-trip (AC1: encrypt with vault key, AEAD) ───────────────

describe('encryptVault / decryptVault (BE-003a, SEC-001 Decision 2+5)', () => {
  let vaultKey: Buffer;
  let record: KdfRegistrationRecord;

  beforeAll(async () => {
    record = await registerMasterPassword(SYNTHETIC_PASSWORD, SYNTHETIC_VAULT_ID);
    vaultKey = await deriveVaultKey(SYNTHETIC_PASSWORD, record.salt, record.kdfParams);
  });

  it('encryptVault returns base64 ciphertext, iv, and tag', () => {
    const ct = encryptVault(vaultKey, SYNTHETIC_VAULT_ID, {
      name: SYNTHETIC_VAULT_NAME,
      description: SYNTHETIC_VAULT_DESC,
    });
    expect(ct.ciphertext).toBeTruthy();
    expect(ct.iv).toBeTruthy();
    expect(ct.tag).toBeTruthy();
  });

  it('decryptVault recovers the original plaintext', () => {
    const ct = encryptVault(vaultKey, SYNTHETIC_VAULT_ID, {
      name: SYNTHETIC_VAULT_NAME,
      description: SYNTHETIC_VAULT_DESC,
    });
    const plain = decryptVault(vaultKey, SYNTHETIC_VAULT_ID, ct.ciphertext, ct.iv, ct.tag);
    expect(plain.name).toBe(SYNTHETIC_VAULT_NAME);
    expect(plain.description).toBe(SYNTHETIC_VAULT_DESC);
  });

  it('round-trip with empty description', () => {
    const ct = encryptVault(vaultKey, SYNTHETIC_VAULT_ID, { name: 'no-desc-vault' });
    const plain = decryptVault(vaultKey, SYNTHETIC_VAULT_ID, ct.ciphertext, ct.iv, ct.tag);
    expect(plain.name).toBe('no-desc-vault');
    expect(plain.description).toBeUndefined();
  });

  it('different plaintext produces different ciphertext', () => {
    const ct1 = encryptVault(vaultKey, SYNTHETIC_VAULT_ID, { name: 'vault-1' });
    const ct2 = encryptVault(vaultKey, SYNTHETIC_VAULT_ID, { name: 'vault-2' });
    expect(ct1.ciphertext).not.toBe(ct2.ciphertext);
  });

  it('different nonce each encryption (random nonce — SEC-001 Decision 4)', () => {
    const ct1 = encryptVault(vaultKey, SYNTHETIC_VAULT_ID, { name: 'same' });
    const ct2 = encryptVault(vaultKey, SYNTHETIC_VAULT_ID, { name: 'same' });
    expect(ct1.iv).not.toBe(ct2.iv);
  });
});

// ─── AAD binding: ciphertext bound to vault ID (SEC-001 Decision 5) ──────────

describe('AAD binding — vault ID binding', () => {
  let vaultKey: Buffer;

  beforeAll(async () => {
    const record = await registerMasterPassword(SYNTHETIC_PASSWORD);
    vaultKey = await deriveVaultKey(SYNTHETIC_PASSWORD, record.salt, record.kdfParams);
  });

  it('ciphertext for different vault IDs differs (AAD binds to vault)', () => {
    const ct1 = encryptVault(vaultKey, 'vault-a', { name: 'same-name' });
    const ct2 = encryptVault(vaultKey, 'vault-b', { name: 'same-name' });
    expect(ct1.ciphertext).not.toBe(ct2.ciphertext);
  });

  it('decrypt with wrong vault ID fails (AAD mismatch)', () => {
    const ct = encryptVault(vaultKey, 'vault-correct', { name: 'test' });
    // Decrypting with a different vault ID must fail — AAD binding prevents
    // cross-vault ciphertext reuse (SEC-001 Decision 5).
    expect(() =>
      decryptVault(vaultKey, 'vault-wrong', ct.ciphertext, ct.iv, ct.tag),
    ).toThrow(/authentication failed/i);
  });
});

// ─── Negative tests (AR-3) ────────────────────────────────────────────────────

describe('Negative tests — vault encryption', () => {
  let vaultKey: Buffer;
  let record: KdfRegistrationRecord;

  beforeAll(async () => {
    record = await registerMasterPassword(SYNTHETIC_PASSWORD);
    vaultKey = await deriveVaultKey(SYNTHETIC_PASSWORD, record.salt, record.kdfParams);
  });

  const encrypt = () =>
    encryptVault(vaultKey, SYNTHETIC_VAULT_ID, { name: SYNTHETIC_VAULT_NAME });

  // ── wrong key ──
  it('throws with wrong vault key (tag verification failure)', () => {
    const ct = encryptVault(vaultKey, SYNTHETIC_VAULT_ID, { name: SYNTHETIC_VAULT_NAME });
    const wrongKey = Buffer.alloc(32, 0x99);
    expect(() =>
      decryptVault(wrongKey, SYNTHETIC_VAULT_ID, ct.ciphertext, ct.iv, ct.tag),
    ).toThrow(/authentication failed/i);
  });

  // ── tampered ciphertext ──
  it('throws when ciphertext is tampered', () => {
    const ct = encryptVault(vaultKey, SYNTHETIC_VAULT_ID, { name: SYNTHETIC_VAULT_NAME });
    const tampered = Buffer.from(ct.ciphertext, 'base64');
    tampered[0] ^= 0xff;
    expect(() =>
      decryptVault(vaultKey, SYNTHETIC_VAULT_ID, tampered.toString('base64'), ct.iv, ct.tag),
    ).toThrow(/authentication failed/i);
  });

  // ── tampered tag ──
  it('throws when tag is modified', () => {
    const ct = encryptVault(vaultKey, SYNTHETIC_VAULT_ID, { name: SYNTHETIC_VAULT_NAME });
    const badTag = Buffer.from(ct.tag, 'base64');
    badTag[0] ^= 0x01;
    expect(() =>
      decryptVault(vaultKey, SYNTHETIC_VAULT_ID, ct.ciphertext, ct.iv, badTag.toString('base64')),
    ).toThrow(/authentication failed/i);
  });

  // ── wrong iv ──
  it('throws when iv is wrong', () => {
    const ct = encryptVault(vaultKey, SYNTHETIC_VAULT_ID, { name: SYNTHETIC_VAULT_NAME });
    const wrongIv = Buffer.alloc(12, 0x77);
    expect(() =>
      decryptVault(vaultKey, SYNTHETIC_VAULT_ID, ct.ciphertext, wrongIv.toString('base64'), ct.tag),
    ).toThrow(/authentication failed/i);
  });

  // ── wrong key size ──
  it('throws when key is not 32 bytes', () => {
    const shortKey = Buffer.alloc(16);
    expect(() =>
      encryptVault(shortKey, SYNTHETIC_VAULT_ID, { name: 'test' }),
    ).toThrow(/must be 32 bytes/i);
  });
});

// ─── Registration + vault encrypt round-trip (AC1 + AC2 end-to-end) ───────────

describe('Registration + vault encrypt round-trip (AC1 + AC2)', () => {
  it('register master password → derive vault key → encrypt vault → decrypt → match', async () => {
    const password = Buffer.from('test-master-password-456');
    const vaultId = 'vault-roundtrip-1';

    // Register (simulates DB persistence of KDF record)
    const record = await registerMasterPassword(password, vaultId);

    // Derive vault key (simulates unlock)
    const vaultKey = await deriveVaultKey(password, record.salt, record.kdfParams);

    // Encrypt vault data
    const plaintext: VaultPlaintext = {
      name: 'My Secure Vault',
      description: 'Encrypted with vault key',
    };
    const ct = encryptVault(vaultKey, vaultId, plaintext);

    // Decrypt and verify
    const recovered = decryptVault(vaultKey, vaultId, ct.ciphertext, ct.iv, ct.tag);
    expect(recovered.name).toBe(plaintext.name);
    expect(recovered.description).toBe(plaintext.description);
  });

  it('different passwords produce different vault keys and different ciphertext', async () => {
    const vaultId = 'vault-diff-pw';
    const r1 = await registerMasterPassword(SYNTHETIC_PASSWORD, vaultId);
    const r2 = await registerMasterPassword(SYNTHETIC_PASSWORD_ALT, vaultId);

    const k1 = await deriveVaultKey(SYNTHETIC_PASSWORD, r1.salt, r1.kdfParams);
    const k2 = await deriveVaultKey(SYNTHETIC_PASSWORD_ALT, r2.salt, r2.kdfParams);

    const ct1 = encryptVault(k1, vaultId, { name: 'same-name' });
    const ct2 = encryptVault(k2, vaultId, { name: 'same-name' });

    expect(ct1.ciphertext).not.toBe(ct2.ciphertext);
    expect(bufEq(k1, k2)).toBe(false);
  });
});

// ─── Serialization round-trip ─────────────────────────────────────────────────

describe('Vault serialization round-trip', () => {
  let vaultKey: Buffer;

  beforeAll(async () => {
    const record = await registerMasterPassword(SYNTHETIC_PASSWORD);
    vaultKey = await deriveVaultKey(SYNTHETIC_PASSWORD, record.salt, record.kdfParams);
  });

  it('encrypt → base64 → parse → decrypt recovers plaintext', () => {
    const plaintext: VaultPlaintext = {
      name: 'serialized-vault',
      description: 'test description',
    };
    const ct = encryptVault(vaultKey, SYNTHETIC_VAULT_ID, plaintext);

    // Simulate DB persistence: base64 strings
    const persisted = {
      ciphertext: ct.ciphertext,
      iv: ct.iv,
      tag: ct.tag,
    };

    // Simulate DB read: reconstruct from base64
    const recovered = decryptVault(
      vaultKey,
      SYNTHETIC_VAULT_ID,
      persisted.ciphertext,
      persisted.iv,
      persisted.tag,
    );
    expect(recovered.name).toBe(plaintext.name);
    expect(recovered.description).toBe(plaintext.description);
  });
});
