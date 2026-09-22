/** @fileoverview BE-002f: KDF parameter validation — unit tests.
 *
 * Test type: unit (no server, no DB — pure function + constant tests).
 * Covers: KDF parameter structure, type compliance, secure-range validation.
 *
 * AR-3: Positive + negative tests for KDF parameter handling.
 * AR-4: All data is synthetic (constant values, no real secrets).
 */

import { describe, it, expect } from 'vitest';
import {
  KDF_PARAMS,
  type StoredKdfParams,
  deriveVaultKey,
  encrypt,
  decrypt,
} from '@password-manager/crypto';

// ─── KDF_PARAMS structure ──────────────────────────────────────────────────────

describe('BE-002f: KDF parameter validation', () => {
  it('KDF_PARAMS has all required fields', () => {
    expect(KDF_PARAMS).toHaveProperty('algorithm');
    expect(KDF_PARAMS).toHaveProperty('memory');
    expect(KDF_PARAMS).toHaveProperty('iterations');
    expect(KDF_PARAMS).toHaveProperty('parallelism');
    expect(KDF_PARAMS).toHaveProperty('hashLength');
  });

  it('KDF_PARAMS field types are correct', () => {
    expect(typeof KDF_PARAMS.algorithm).toBe('string');
    expect(typeof KDF_PARAMS.memory).toBe('number');
    expect(typeof KDF_PARAMS.iterations).toBe('number');
    expect(typeof KDF_PARAMS.parallelism).toBe('number');
    expect(typeof KDF_PARAMS.hashLength).toBe('number');
  });

  it('KDF algorithm is argon2id', () => {
    expect(KDF_PARAMS.algorithm).toBe('argon2id');
  });

  it('KDF memory is 64 MiB expressed in KiB (65536)', () => {
    expect(KDF_PARAMS.memory).toBe(65536);
  });

  it('KDF iterations is 3', () => {
    expect(KDF_PARAMS.iterations).toBe(3);
  });

  it('KDF parallelism is 4', () => {
    expect(KDF_PARAMS.parallelism).toBe(4);
  });

  it('KDF hashLength is 32 bytes (AES-256)', () => {
    expect(KDF_PARAMS.hashLength).toBe(32);
  });

  // ── Secure-range validation ──────────────────────────────────────────────────

  it('KDF memory is at least 64 MiB (secure minimum)', () => {
    expect(KDF_PARAMS.memory).toBeGreaterThanOrEqual(65536);
  });

  it('KDF iterations is at least 3 (secure minimum)', () => {
    expect(KDF_PARAMS.iterations).toBeGreaterThanOrEqual(3);
  });

  it('KDF parallelism is at least 1', () => {
    expect(KDF_PARAMS.parallelism).toBeGreaterThanOrEqual(1);
  });

  it('KDF hashLength is at least 16 bytes', () => {
    expect(KDF_PARAMS.hashLength).toBeGreaterThanOrEqual(16);
  });

  // ── Type compliance ──────────────────────────────────────────────────────────

  it('KDF_PARAMS satisfies StoredKdfParams type', () => {
    const params: StoredKdfParams = KDF_PARAMS;
    expect(params.algorithm).toBe('argon2id');
    expect(typeof params.memory).toBe('number');
    expect(typeof params.iterations).toBe('number');
    expect(typeof params.parallelism).toBe('number');
    expect(typeof params.hashLength).toBe('number');
  });

  it('StoredKdfParams is assignable from KDF_PARAMS', () => {
    const params: StoredKdfParams = { ...KDF_PARAMS };
    expect(params).toEqual(KDF_PARAMS);
  });

  // ── deriveVaultKey with custom params ────────────────────────────────────────

  it('deriveVaultKey accepts custom KDF params', async () => {
    const customParams = {
      algorithm: 'argon2id',
      memory: 16384, // 16 MiB
      iterations: 2,
      parallelism: 2,
      hashLength: 32,
    };
    const salt = Buffer.alloc(16, 0x42);
    const key = await deriveVaultKey(
      Buffer.from('test-password'),
      salt,
      customParams,
    );
    expect(key.length).toBe(32);
  });

  it('deriveVaultKey with default params produces 32-byte key', async () => {
    const salt = Buffer.alloc(16, 0x42);
    const key = await deriveVaultKey(
      Buffer.from('test-password'),
      salt,
    );
    expect(key.length).toBe(32);
  });

  it('deriveVaultKey produces different keys for different salts', async () => {
    const salt1 = Buffer.alloc(16, 0x42);
    const salt2 = Buffer.alloc(16, 0x43);
    const key1 = await deriveVaultKey(Buffer.from('pwd'), salt1);
    const key2 = await deriveVaultKey(Buffer.from('pwd'), salt2);
    expect(key1.equals(key2)).toBe(false);
  });

  it('deriveVaultKey produces different keys for different passwords', async () => {
    const salt = Buffer.alloc(16, 0x42);
    const key1 = await deriveVaultKey(Buffer.from('password-a'), salt);
    const key2 = await deriveVaultKey(Buffer.from('password-b'), salt);
    expect(key1.equals(key2)).toBe(false);
  });

  // ── encrypt/decrypt with KDF-derived key ─────────────────────────────────────

  it('KDF-derived key encrypts and decrypts correctly', async () => {
    const salt = Buffer.alloc(16, 0x55);
    const key = await deriveVaultKey(Buffer.from('test-key-password'), salt);
    const plaintext = Buffer.from('Hello, vault!');
    const { ciphertext, iv, tag } = encrypt(key, plaintext);
    const recovered = decrypt(key, ciphertext, iv, tag);
    expect(recovered.equals(plaintext)).toBe(true);
  });

  it('KDF-derived key rejects wrong key on decrypt', async () => {
    const salt = Buffer.alloc(16, 0x55);
    const key = await deriveVaultKey(Buffer.from('test-key-password'), salt);
    const { ciphertext, iv, tag } = encrypt(key, Buffer.from('secret data'));
    const wrongKey = Buffer.alloc(32, 0xAA);
    expect(() => decrypt(wrongKey, ciphertext, iv, tag)).toThrow(
      /authentication failed/i,
    );
  });

  // ── Parameter constraint validation ──────────────────────────────────────────

  it('encrypt rejects key shorter than 32 bytes', () => {
    const shortKey = Buffer.alloc(16);
    expect(() => encrypt(shortKey, Buffer.from('data'))).toThrow(
      /must be 32 bytes/i,
    );
  });

  it('encrypt rejects key longer than 32 bytes', () => {
    const longKey = Buffer.alloc(64);
    expect(() => encrypt(longKey, Buffer.from('data'))).toThrow(
      /must be 32 bytes/i,
    );
  });

  it('decrypt rejects key shorter than 32 bytes', () => {
    const shortKey = Buffer.alloc(16);
    expect(() =>
      decrypt(shortKey, Buffer.alloc(1), Buffer.alloc(12), Buffer.alloc(16)),
    ).toThrow(/must be 32 bytes/i);
  });

  it('decrypt rejects iv shorter than 12 bytes', () => {
    const key = Buffer.alloc(32);
    expect(() =>
      decrypt(key, Buffer.alloc(1), Buffer.alloc(8), Buffer.alloc(16)),
    ).toThrow(/iv must be 12 bytes/i);
  });

  it('decrypt rejects iv longer than 12 bytes', () => {
    const key = Buffer.alloc(32);
    expect(() =>
      decrypt(key, Buffer.alloc(1), Buffer.alloc(16), Buffer.alloc(16)),
    ).toThrow(/iv must be 12 bytes/i);
  });

  it('decrypt rejects tag shorter than 16 bytes', () => {
    const key = Buffer.alloc(32);
    expect(() =>
      decrypt(key, Buffer.alloc(1), Buffer.alloc(12), Buffer.alloc(8)),
    ).toThrow(/tag must be 16 bytes/i);
  });

  it('decrypt rejects tag longer than 16 bytes', () => {
    const key = Buffer.alloc(32);
    expect(() =>
      decrypt(key, Buffer.alloc(1), Buffer.alloc(12), Buffer.alloc(32)),
    ).toThrow(/tag must be 16 bytes/i);
  });
});
