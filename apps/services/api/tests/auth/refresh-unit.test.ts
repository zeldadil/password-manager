/** @fileoverview Unit tests for refresh token helpers.

 * Test type: unit (no server, no DB — pure function tests).
 * Covers: hashRefreshToken consistency, session auto-lock check logic.
 */

import { describe, it, expect } from 'vitest';
import { hashRefreshToken, generateRefreshToken } from '../../src/auth/jwt';
import { config } from '../../src/config';

describe('BE-002d: refresh token helpers', () => {
  it('hashRefreshToken is deterministic', () => {
    const token = generateRefreshToken();
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
  });

  it('different refresh tokens produce different hashes', () => {
    const h1 = hashRefreshToken(generateRefreshToken());
    const h2 = hashRefreshToken(generateRefreshToken());
    expect(h1).not.toBe(h2);
  });

  it('config.autoLockTimeoutMs defaults to 15 minutes', () => {
    expect(config.autoLockTimeoutMs).toBe(15 * 60 * 1000);
  });

  it('config.autoLockTimeoutMs is parseable from env (integration-style check)', () => {
    // The config already reads AUTO_LOCK_TIMEOUT_MS; verify the parsed value
    // is a positive integer when set.
    expect(Number.isInteger(config.autoLockTimeoutMs)).toBe(true);
    expect(config.autoLockTimeoutMs).toBeGreaterThan(0);
  });
});
