/** @fileoverview Unit tests for JWT helpers (HS256, Node crypto).

 * Test type: unit (no server, no DB — pure function tests).
 * Covers signing, verification, expiry, tampering, refresh token generation.
 */

import { describe, it, expect } from 'vitest';
import {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
} from '../../src/auth/jwt';

const TEST_SECRET = 'test-signing-secret-abc123';

describe('JWT helpers (HS256)', () => {
  // ── Access token signing + verification ──────────────────────────────────────

  it('signs and verifies a valid access token', () => {
    const token = signAccessToken('user-123', TEST_SECRET, 900, 'sess-abc');
    expect(token).toContain('.');
    const decoded = verifyAccessToken(token, TEST_SECRET);
    expect(decoded.userId).toBe('user-123');
    expect(decoded.sessionId).toBe('sess-abc');
    expect(decoded.type).toBe('access');
    expect(decoded.exp).toBeGreaterThan(900); // at least 15 min from epoch
  });

  it('verifying with wrong secret throws', () => {
    const token = signAccessToken('user-123', TEST_SECRET, 900, 'sess-abc');
    expect(() => verifyAccessToken(token, 'wrong-secret')).toThrow('AUTH_INVALID_TOKEN');
  });

  it('tampered payload throws', () => {
    const token = signAccessToken('user-123', TEST_SECRET, 900, 'sess-abc');
    const parts = token.split('.');
    parts[1] = parts[1].slice(0, -4) + 'XXXX'; // corrupt payload
    const tampered = parts.join('.');
    expect(() => verifyAccessToken(tampered, TEST_SECRET)).toThrow('AUTH_INVALID_TOKEN');
  });

  it(' tampered signature throws', () => {
    const token = signAccessToken('user-123', TEST_SECRET, 900, 'sess-abc');
    const parts = token.split('.');
    parts[2] = 'tampered-signature';
    const tampered = parts.join('.');
    expect(() => verifyAccessToken(tampered, TEST_SECRET)).toThrow('AUTH_INVALID_TOKEN');
  });

  it('wrong number of segments throws', () => {
    expect(() => verifyAccessToken('only.two', TEST_SECRET)).toThrow('AUTH_INVALID_TOKEN');
    expect(() => verifyAccessToken('one', TEST_SECRET)).toThrow('AUTH_INVALID_TOKEN');
    expect(() => verifyAccessToken('', TEST_SECRET)).toThrow('AUTH_INVALID_TOKEN');
  });

  it('expired token throws', () => {
    // Sign with expiry in the past
    const token = signAccessToken('user-123', TEST_SECRET, -3600, 'sess-abc'); // expired 1h ago
    // We can't easily test this without mocking Date — the token was
    // just signed with exp in the past relative to epoch, so it should
    // already be expired. But since exp is a unix timestamp and we set
    // it to (now - 3600), and now >> 3600 after epoch, this actually
    // creates a token that expired 1h ago.
    // Actually, signAccessToken uses Date.now() for iat, so exp = now - 3600
    // which IS in the past. This should throw.
    expect(() => verifyAccessToken(token, TEST_SECRET)).toThrow('AUTH_INVALID_TOKEN');
  });

  it('access token expiry is set correctly (15 min)', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = signAccessToken('user-123', TEST_SECRET, 900, 'sess-abc');
    const decoded = verifyAccessToken(token, TEST_SECRET);
    // exp should be roughly now + 900 (within a few seconds)
    const after = Math.floor(Date.now() / 1000);
    expect(decoded.exp).toBeGreaterThanOrEqual(before + 899);
    expect(decoded.exp).toBeLessThanOrEqual(after + 901);
  });

  // ── Refresh token ────────────────────────────────────────────────────────────

  it('generates a 64-char hex refresh token', () => {
    const token = generateRefreshToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates different tokens on each call', () => {
    const t1 = generateRefreshToken();
    const t2 = generateRefreshToken();
    expect(t1).not.toBe(t2);
  });

  it('hashRefreshToken produces a consistent 64-char hex hash', () => {
    const token = generateRefreshToken();
    const h1 = hashRefreshToken(token);
    const h2 = hashRefreshToken(token);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different tokens produce different hashes', () => {
    const h1 = hashRefreshToken(generateRefreshToken());
    const h2 = hashRefreshToken(generateRefreshToken());
    expect(h1).not.toBe(h2);
  });
});
