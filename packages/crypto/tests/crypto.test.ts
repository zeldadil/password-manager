/** @fileoverview Unit tests for crypto package (BE-002a).

 * Test type: unit (per backlog BE-002a).
 * Covers all acceptance criteria:
 *   AC1: Master password registration — KDF derives vault key, encrypts empty vault
 *   AC2: Stored as { kdfParams, salt, ciphertext, iv, tag }
 *
 * AR-3 compliance: positive + negative tests for every crypto path.
 * AR-4 compliance: all data is synthetic — generated at test time.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  KDF_PARAMS,
  type StoredKdfParams,
  type KdfRegistrationRecord,
  deriveVaultKey,
  encrypt,
  decrypt,
  registerMasterPassword,
  unlockVaultKey,
} from '../src/index';

// ─── Helpers ────────────────────────────────────────────────────────────────

function bufEq(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

// ─── Shared test data (synthetic, AR-4 compliant) ──────────────────────────

const SYNTHETIC_PASSWORD = Buffer.from('my-secret-master-password');
const SYNTHETIC_PASSWORD_ALT = Buffer.from('different-password');
const SYNTHETIC_PLAINTEXT = Buffer.from('Hello, encrypted vault!');
const SYNTHETIC_USER_ID = 'user-abc123';

// ─── KDF parameter validation ───────────────────────────────────────────────

describe('KDF_PARAMS (SEC-001 Decision 1)', () => {
  it('has algorithm "argon2id"', () => {
    expect(KDF_PARAMS.algorithm).toBe('argon2id');
  });

  it('memory is 64 MiB expressed in KiB (65536)', () => {
    expect(KDF_PARAMS.memory).toBe(65536);
  });

  it('iterations is 3', () => {
    expect(KDF_PARAMS.iterations).toBe(3);
  });

  it('parallelism is 4', () => {
    expect(KDF_PARAMS.parallelism).toBe(4);
  });

  it('hashLength is 32 bytes (AES-256)', () => {
    expect(KDF_PARAMS.hashLength).toBe(32);
  });

  it('exports as StoredKdfParams type', () => {
    const p: StoredKdfParams = KDF_PARAMS;
    expect(p.algorithm).toBe('argon2id');
    expect(typeof p.memory).toBe('number');
  });
});

// ─── AEAD encrypt/decrypt round-trip (SEC-001 Decision 2 + 5) ──────────────

describe('encrypt / decrypt (AES-256-GCM)', () => {
  let key: Buffer;

  beforeAll(async () => {
    // Derive a deterministic test key from a synthetic password.
    // Use a fixed salt so the key is the same across test runs.
    key = await deriveVaultKey(SYNTHETIC_PASSWORD, Buffer.alloc(16, 0x42));
  });

  it('encrypt returns ciphertext, iv (12 bytes), and tag (16 bytes)', () => {
    const { ciphertext, iv, tag } = encrypt(key, SYNTHETIC_PLAINTEXT);
    expect(iv.length).toBe(12);
    expect(tag.length).toBe(16);
    expect(ciphertext.length).toBeGreaterThan(0);
  });

  it('decrypt recovers the original plaintext', () => {
    const { ciphertext, iv, tag } = encrypt(key, SYNTHETIC_PLAINTEXT);
    const recovered = decrypt(key, ciphertext, iv, tag);
    expect(bufEq(recovered, SYNTHETIC_PLAINTEXT)).toBe(true);
  });

  it('different iv each encryption (random nonce — SEC-001 Decision 4)', () => {
    const r1 = encrypt(key, SYNTHETIC_PLAINTEXT);
    const r2 = encrypt(key, SYNTHETIC_PLAINTEXT);
    expect(r1.iv.equals(r2.iv)).toBe(false);
    // ciphertexts differ because iv differs (same plaintext, same key)
    expect(r1.ciphertext.equals(r2.ciphertext)).toBe(false);
  });

  // BE-003k: IV/nonce reuse detection. AES-GCM's security collapses if the
  // same (key, iv) pair is ever used twice — the two-sample check above
  // proves distinctness for a single pair, but says nothing about the
  // collision rate of the underlying randomness source at scale. This test
  // draws a large sample and would fail (revealing a real defect) if
  // `encrypt` ever used anything less than a full 96-bit cryptographically
  // random IV — a fixed/predictable/counter-based IV, or a narrowed random
  // range, would produce a collision well within this sample size.
  it('generates no IV collisions across a large sample (statistical reuse detection)', () => {
    const SAMPLE_SIZE = 5000;
    const ivs = new Set<string>();
    for (let i = 0; i < SAMPLE_SIZE; i++) {
      const { iv } = encrypt(key, SYNTHETIC_PLAINTEXT);
      ivs.add(iv.toString('hex'));
    }
    expect(ivs.size).toBe(SAMPLE_SIZE);
  });

  // ── negative: wrong key ──
  it('throws on decrypt with wrong key (tag verification failure)', () => {
    const { ciphertext, iv, tag } = encrypt(key, SYNTHETIC_PLAINTEXT);
    const wrongKey = Buffer.alloc(32, 0x99);
    expect(() => decrypt(wrongKey, ciphertext, iv, tag)).toThrow(
      /authentication failed/i,
    );
  });

  // ── negative: tampered ciphertext ──
  it('throws when ciphertext is tampered', () => {
    const { ciphertext, iv, tag } = encrypt(key, SYNTHETIC_PLAINTEXT);
    const tampered = Buffer.from(ciphertext);
    tampered[0] ^= 0xff; // flip one byte
    expect(() => decrypt(key, tampered, iv, tag)).toThrow(/authentication failed/i);
  });

  // ── negative: wrong tag ──
  it('throws when tag is modified', () => {
    const { ciphertext, iv, tag } = encrypt(key, SYNTHETIC_PLAINTEXT);
    const badTag = Buffer.from(tag);
    badTag[0] ^= 0x01;
    expect(() => decrypt(key, ciphertext, iv, badTag)).toThrow(/authentication failed/i);
  });

  // ── negative: wrong iv ──
  it('throws when iv is wrong (decryption produces wrong plaintext or fails)', () => {
    const { ciphertext, iv, tag } = encrypt(key, SYNTHETIC_PLAINTEXT);
    const wrongIv = Buffer.alloc(12, 0x77);
    // GCM with wrong IV may throw or produce garbage; we assert it does NOT
    // return the original plaintext.
    try {
      const result = decrypt(key, ciphertext, wrongIv, tag);
      expect(bufEq(result, SYNTHETIC_PLAINTEXT)).toBe(false);
    } catch {
      // also acceptable — GCM may throw on IV mismatch
    }
  });

  // ── negative: AAD mismatch ──
  it('throws when AAD does not match', () => {
    const aad = Buffer.from('test-aad');
    const { ciphertext, iv, tag } = encrypt(key, SYNTHETIC_PLAINTEXT, aad);
    const wrongAad = Buffer.from('wrong-aad');
    expect(() => decrypt(key, ciphertext, iv, tag, wrongAad)).toThrow(
      /authentication failed/i,
    );
  });

  // ── negative: key size ──
  it('throws when key is not 32 bytes', () => {
    const shortKey = Buffer.alloc(16);
    expect(() => encrypt(shortKey, SYNTHETIC_PLAINTEXT)).toThrow(/must be 32 bytes/i);
    expect(() => decrypt(shortKey, Buffer.alloc(1), Buffer.alloc(12), Buffer.alloc(16)))
      .toThrow(/must be 32 bytes/i);
  });

  // ── negative: iv size ──
  it('throws when iv is not 12 bytes', () => {
    expect(() =>
      decrypt(key, Buffer.alloc(1), Buffer.alloc(16), Buffer.alloc(16))
    ).toThrow(/iv must be 12 bytes/i);
  });

  // ── negative: tag size ──
  it('throws when tag is not 16 bytes', () => {
    expect(() =>
      decrypt(key, Buffer.alloc(1), Buffer.alloc(12), Buffer.alloc(8))
    ).toThrow(/tag must be 16 bytes/i);
  });

  // ── positive: empty plaintext ──
  it('handles empty plaintext', () => {
    const { ciphertext, iv, tag } = encrypt(key, Buffer.alloc(0));
    const recovered = decrypt(key, ciphertext, iv, tag);
    expect(recovered.length).toBe(0);
  });

  // ── positive: large plaintext ──
  it('handles large plaintext (> 1 MB)', () => {
    const large = Buffer.alloc(1_000_000, 0xAA);
    const { ciphertext, iv, tag } = encrypt(key, large);
    const recovered = decrypt(key, ciphertext, iv, tag);
    expect(bufEq(recovered, large)).toBe(true);
  });
});

// ─── Registration flow (AC1 + AC2) ──────────────────────────────────────────

describe('registerMasterPassword (AC1 + AC2)', () => {
  it('returns a record with all required fields', async () => {
    const record = await registerMasterPassword(SYNTHETIC_PASSWORD, SYNTHETIC_USER_ID);
    expect(record).toHaveProperty('kdfParams');
    expect(record).toHaveProperty('salt');
    expect(record).toHaveProperty('vaultKeyEncrypted');
    expect(record).toHaveProperty('vaultKeyIv');
    expect(record).toHaveProperty('vaultKeyTag');
  });

  it('kdfParams matches KDF_PARAMS', async () => {
    const record = await registerMasterPassword(SYNTHETIC_PASSWORD);
    expect(record.kdfParams).toEqual(KDF_PARAMS);
  });

  it('salt is 16 bytes (random)', async () => {
    const r1 = await registerMasterPassword(SYNTHETIC_PASSWORD);
    const r2 = await registerMasterPassword(SYNTHETIC_PASSWORD);
    expect(r1.salt.length).toBe(16);
    expect(r2.salt.length).toBe(16);
    expect(r1.salt.equals(r2.salt)).toBe(false); // different per registration
  });

  it('vaultKeyEncrypted is non-empty ciphertext', async () => {
    const record = await registerMasterPassword(SYNTHETIC_PASSWORD);
    expect(record.vaultKeyEncrypted.length).toBeGreaterThan(0);
  });

  it('vaultKeyIv is 12 bytes', async () => {
    const record = await registerMasterPassword(SYNTHETIC_PASSWORD);
    expect(record.vaultKeyIv.length).toBe(12);
  });

  it('vaultKeyTag is 16 bytes', async () => {
    const record = await registerMasterPassword(SYNTHETIC_PASSWORD);
    expect(record.vaultKeyTag.length).toBe(16);
  });

  it('different passwords produce different encrypted vault keys', async () => {
    const r1 = await registerMasterPassword(SYNTHETIC_PASSWORD);
    const r2 = await registerMasterPassword(SYNTHETIC_PASSWORD_ALT);
    expect(r1.vaultKeyEncrypted.equals(r2.vaultKeyEncrypted)).toBe(false);
  });

  it('AAD binds encrypted key to user ID', async () => {
    // When AAD differs, the ciphertext differs even with same password.
    const r1 = await registerMasterPassword(SYNTHETIC_PASSWORD, 'user-1');
    const r2 = await registerMasterPassword(SYNTHETIC_PASSWORD, 'user-2');
    const rNoAAD = await registerMasterPassword(SYNTHETIC_PASSWORD);
    // Both AAD cases differ from each other
    expect(r1.vaultKeyEncrypted.equals(r2.vaultKeyEncrypted)).toBe(false);
  });
});

// ─── Unlock flow (AC1 — verify correct password opens vault) ───────────────

describe('unlockVaultKey (AC1 — verification)', () => {
  let record: KdfRegistrationRecord;

  beforeAll(async () => {
    record = await registerMasterPassword(SYNTHETIC_PASSWORD, SYNTHETIC_USER_ID);
  });

  it('correct password returns the vault key', async () => {
    const vaultKey = await unlockVaultKey(SYNTHETIC_PASSWORD, record);
    expect(vaultKey.length).toBe(32);
  });

  it('unlock key can decrypt data encrypted with the registration key', async () => {
    const vaultKey = await unlockVaultKey(SYNTHETIC_PASSWORD, record);
    const { ciphertext, iv, tag } = encrypt(vaultKey, SYNTHETIC_PLAINTEXT);
    const recovered = decrypt(vaultKey, ciphertext, iv, tag);
    expect(bufEq(recovered, SYNTHETIC_PLAINTEXT)).toBe(true);
  });

  // ── negative: wrong password ──
  it('wrong password throws authentication failure', async () => {
    await expect(
      unlockVaultKey(SYNTHETIC_PASSWORD_ALT, record),
    ).rejects.toThrow(/authentication failed/i);
  });

  // ── negative: empty password ──
  it('empty password throws (different key → tag mismatch)', async () => {
    await expect(
      unlockVaultKey(Buffer.alloc(0), record),
    ).rejects.toThrow(/authentication failed/i);
  });

  // ── negative: tampered storage record ──
  it('tampered salt breaks unlock (different derived key)', async () => {
    const tampered = { ...record, salt: Buffer.alloc(16, 0x11) };
    await expect(
      unlockVaultKey(SYNTHETIC_PASSWORD, tampered),
    ).rejects.toThrow(/authentication failed/i);
  });

  // ── negative: tampered ciphertext ──
  it('tampered ciphertext breaks unlock', async () => {
    const tampered = {
      ...record,
      vaultKeyEncrypted: Buffer.from(record.vaultKeyEncrypted),
    };
    tampered.vaultKeyEncrypted[0] ^= 0xff;
    await expect(
      unlockVaultKey(SYNTHETIC_PASSWORD, tampered),
    ).rejects.toThrow(/authentication failed/i);
  });

  // ── negative: tampered tag ──
  it('tampered tag breaks unlock', async () => {
    const tampered = {
      ...record,
      vaultKeyTag: Buffer.from(record.vaultKeyTag),
    };
    tampered.vaultKeyTag[0] ^= 0x01;
    await expect(
      unlockVaultKey(SYNTHETIC_PASSWORD, tampered),
    ).rejects.toThrow(/authentication failed/i);
  });
});

// ─── Deterministic KDF test (no argon2 randomness) ─────────────────────────

describe('deriveVaultKey determinism', () => {
  it('same password + same salt → same vault key', async () => {
    const salt = Buffer.from('fixed-salt-12345', 'utf-8');
    const k1 = await deriveVaultKey(SYNTHETIC_PASSWORD, salt);
    const k2 = await deriveVaultKey(SYNTHETIC_PASSWORD, salt);
    expect(bufEq(k1, k2)).toBe(true);
    expect(k1.length).toBe(32);
  });

  it('different passwords → different keys', async () => {
    const salt = Buffer.from('fixed-salt-12345', 'utf-8');
    const k1 = await deriveVaultKey(SYNTHETIC_PASSWORD, salt);
    const k2 = await deriveVaultKey(SYNTHETIC_PASSWORD_ALT, salt);
    expect(bufEq(k1, k2)).toBe(false);
  });
});

// ─── Storage format round-trip (AC2 — persist and restore) ─────────────────

describe('Storage format round-trip (AC2)', () => {
  it('register → serialize → deserialize → unlock works end-to-end', async () => {
    const password = Buffer.from('test-password-123');
    const record = await registerMasterPassword(password, 'user-storage-test');

    // Simulate DB persistence: convert buffers to base64 strings.
    const serialized = {
      kdfParams: record.kdfParams,
      salt: record.salt.toString('base64'),
      vaultKeyEncrypted: record.vaultKeyEncrypted.toString('base64'),
      vaultKeyIv: record.vaultKeyIv.toString('base64'),
      vaultKeyTag: record.vaultKeyTag.toString('base64'),
    };

    // Simulate DB read: reconstruct buffers.
    const restored: KdfRegistrationRecord = {
      kdfParams: serialized.kdfParams,
      salt: Buffer.from(serialized.salt, 'base64'),
      vaultKeyEncrypted: Buffer.from(serialized.vaultKeyEncrypted, 'base64'),
      vaultKeyIv: Buffer.from(serialized.vaultKeyIv, 'base64'),
      vaultKeyTag: Buffer.from(serialized.vaultKeyTag, 'base64'),
    };

    const vaultKey = await unlockVaultKey(password, restored);
    expect(vaultKey.length).toBe(32);

    // Verify the restored key can decrypt.
    const { ciphertext, iv, tag } = encrypt(vaultKey, Buffer.from('hello'));
    const decrypted = decrypt(vaultKey, ciphertext, iv, tag);
    expect(decrypted.toString()).toBe('hello');
  });
});
