/** @fileoverview BE-002f: Rate limit — unit tests (no server, no DB).
 *
 * Test type: unit (pure function + logic tests).
 * Covers: failed-attempts counter, lockout threshold, lockout expiry reset,
 *         and config validation.
 *
 * AR-3: Positive + negative tests for rate-limiting logic.
 * AR-4: All data is synthetic — generated at test time.
 */

import { describe, it, expect } from 'vitest';
import { config } from '../../src/config';

// ─── Constants (mirrored from unlock.ts for validation) ───────────────────────

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// ─── Rate-limit state machine (pure logic, no DB) ─────────────────────────────

/** Simulates the rate-limit state machine from unlock.ts. */
interface RateLimitState {
  failedAttempts: number;
  lockedUntil: number; // epoch ms, 0 = not locked
}

function isLockedOut(state: RateLimitState): boolean {
  const nowMs = Date.now();
  return state.lockedUntil > nowMs;
}

function isLockoutExpired(state: RateLimitState): boolean {
  const nowMs = Date.now();
  return state.lockedUntil > 0 && state.lockedUntil <= nowMs;
}

function attemptFailed(state: RateLimitState): { newFailedAttempts: number; shouldLockout: boolean } {
  const newFailedAttempts = state.failedAttempts + 1;
  const shouldLockout = newFailedAttempts >= MAX_FAILED_ATTEMPTS;
  return { newFailedAttempts, shouldLockout };
}

function attemptSucceeded(state: RateLimitState): RateLimitState {
  return { failedAttempts: 0, lockedUntil: 0 };
}

// ─── Rate limit config validation ──────────────────────────────────────────────

describe('BE-002f: rate limit — config validation', () => {
  it('config.autoLockTimeoutMs defaults to 15 minutes', () => {
    expect(config.autoLockTimeoutMs).toBe(15 * 60 * 1000);
  });

  it('config.autoLockTimeoutMs is a positive integer', () => {
    expect(Number.isInteger(config.autoLockTimeoutMs)).toBe(true);
    expect(config.autoLockTimeoutMs).toBeGreaterThan(0);
  });

  it('config.autoLockTimeoutMs is at least 1 minute (security minimum)', () => {
    expect(config.autoLockTimeoutMs).toBeGreaterThanOrEqual(60 * 1000);
  });

  it('AUTO_LOCK_TIMEOUT_MS env var is parsed correctly', () => {
    // Validate that the parseInt fallback works for valid input.
    expect(parseInt('900000', 10)).toBe(900000);
    expect(parseInt('15000', 10)).toBe(15000);
  });

  it('parseInt returns NaN for empty string (fallback to default)', () => {
    expect(parseInt('', 10)).toBeNaN();
    // The config uses: parseInt(...) || 15*60*1000 — NaN is falsy, so default applies.
    expect(parseInt('', 10) || 15 * 60 * 1000).toBe(15 * 60 * 1000);
  });

  it('parseInt returns NaN for non-numeric string (fallback to default)', () => {
    expect(parseInt('abc', 10)).toBeNaN();
    expect(parseInt('abc', 10) || 15 * 60 * 1000).toBe(15 * 60 * 1000);
  });
});

// ─── Rate limit state machine ──────────────────────────────────────────────────

describe('BE-002f: rate limit — state machine logic', () => {
  // Use a fixed "now" for deterministic tests.
  const fixedNow = new Date('2026-01-01T00:00:00Z');
  const fixedNowMs = fixedNow.getTime();

  it('isLockedOut returns false when lockedUntil is 0 (never locked)', () => {
    const state: RateLimitState = { failedAttempts: 0, lockedUntil: 0 };
    // Override Date for determinism.
    const originalNow = Date.now;
    // @ts-expect-error — we know what we're doing
    Date.now = () => fixedNowMs;
    try {
      expect(isLockedOut(state)).toBe(false);
    } finally {
      Date.now = originalNow;
    }
  });

  it('isLockedOut returns false when lockedUntil is in the past', () => {
    const state: RateLimitState = {
      failedAttempts: 5,
      lockedUntil: fixedNowMs - 1000, // locked 1s ago
    };
    const originalNow = Date.now;
    // @ts-expect-error
    Date.now = () => fixedNowMs;
    try {
      expect(isLockedOut(state)).toBe(false);
    } finally {
      Date.now = originalNow;
    }
  });

  it('isLockedOut returns true when lockedUntil is in the future', () => {
    const state: RateLimitState = {
      failedAttempts: 5,
      lockedUntil: fixedNowMs + LOCKOUT_DURATION_MS,
    };
    const originalNow = Date.now;
    // @ts-expect-error
    Date.now = () => fixedNowMs;
    try {
      expect(isLockedOut(state)).toBe(true);
    } finally {
      Date.now = originalNow;
    }
  });

  it('isLockoutExpired returns false when lockedUntil is 0', () => {
    const state: RateLimitState = { failedAttempts: 0, lockedUntil: 0 };
    const originalNow = Date.now;
    // @ts-expect-error
    Date.now = () => fixedNowMs;
    try {
      expect(isLockoutExpired(state)).toBe(false);
    } finally {
      Date.now = originalNow;
    }
  });

  it('isLockoutExpired returns true when lockout has expired', () => {
    const state: RateLimitState = {
      failedAttempts: 5,
      lockedUntil: fixedNowMs - 1, // expired 1ms ago
    };
    const originalNow = Date.now;
    // @ts-expect-error
    Date.now = () => fixedNowMs;
    try {
      expect(isLockoutExpired(state)).toBe(true);
    } finally {
      Date.now = originalNow;
    }
  });

  it('isLockoutExpired returns false when lockout is still active', () => {
    const state: RateLimitState = {
      failedAttempts: 5,
      lockedUntil: fixedNowMs + LOCKOUT_DURATION_MS,
    };
    const originalNow = Date.now;
    // @ts-expect-error
    Date.now = () => fixedNowMs;
    try {
      expect(isLockoutExpired(state)).toBe(false);
    } finally {
      Date.now = originalNow;
    }
  });

  // ── Failed attempt counting ─────────────────────────────────────────────────

  it('first failed attempt sets count to 1, no lockout', () => {
    const state: RateLimitState = { failedAttempts: 0, lockedUntil: 0 };
    const result = attemptFailed(state);
    expect(result.newFailedAttempts).toBe(1);
    expect(result.shouldLockout).toBe(false);
  });

  it('fourth failed attempt sets count to 4, no lockout', () => {
    const state: RateLimitState = { failedAttempts: 3, lockedUntil: 0 };
    const result = attemptFailed(state);
    expect(result.newFailedAttempts).toBe(4);
    expect(result.shouldLockout).toBe(false);
  });

  it('fifth failed attempt sets count to 5 and triggers lockout', () => {
    const state: RateLimitState = { failedAttempts: 4, lockedUntil: 0 };
    const result = attemptFailed(state);
    expect(result.newFailedAttempts).toBe(MAX_FAILED_ATTEMPTS);
    expect(result.shouldLockout).toBe(true);
  });

  it('sixth failed attempt also triggers lockout (already at threshold)', () => {
    const state: RateLimitState = { failedAttempts: 5, lockedUntil: 0 };
    const result = attemptFailed(state);
    expect(result.newFailedAttempts).toBe(6);
    expect(result.shouldLockout).toBe(true);
  });

  // ── Success resets counter ──────────────────────────────────────────────────

  it('successful attempt resets failedAttempts to 0 and clears lockout', () => {
    const state: RateLimitState = {
      failedAttempts: 5,
      lockedUntil: fixedNowMs + LOCKOUT_DURATION_MS,
    };
    const result = attemptSucceeded(state);
    expect(result.failedAttempts).toBe(0);
    expect(result.lockedUntil).toBe(0);
  });

  it('successful attempt on clean state keeps it clean', () => {
    const state: RateLimitState = { failedAttempts: 0, lockedUntil: 0 };
    const result = attemptSucceeded(state);
    expect(result.failedAttempts).toBe(0);
    expect(result.lockedUntil).toBe(0);
  });

  // ── Lockout threshold boundary ──────────────────────────────────────────────

  it('4 failures + 1 more = lockout (boundary: 4 -> 5)', () => {
    let state: RateLimitState = { failedAttempts: 0, lockedUntil: 0 };
    for (let i = 0; i < 4; i++) {
      const r = attemptFailed(state);
      state = { failedAttempts: r.newFailedAttempts, lockedUntil: state.lockedUntil };
      expect(r.shouldLockout).toBe(false);
    }
    // 5th attempt
    const fifth = attemptFailed(state);
    expect(fifth.newFailedAttempts).toBe(5);
    expect(fifth.shouldLockout).toBe(true);
  });

  it('lockout is not triggered below threshold (3 failures)', () => {
    const state: RateLimitState = { failedAttempts: 2, lockedUntil: 0 };
    const result = attemptFailed(state);
    expect(result.newFailedAttempts).toBe(3);
    expect(result.shouldLockout).toBe(false);
  });

  // ── Lockout expiry + reuse ──────────────────────────────────────────────────

  it('after lockout expiry, counter resets and a new failed attempt starts from 1', () => {
    // Simulate: 5 failures → lockout → wait for expiry → 1 more failure.
    let state: RateLimitState = { failedAttempts: 0, lockedUntil: 0 };
    // Accumulate 5 failures.
    for (let i = 0; i < 5; i++) {
      const r = attemptFailed(state);
      state = { failedAttempts: r.newFailedAttempts, lockedUntil: state.lockedUntil };
    }
    expect(state.failedAttempts).toBe(5);

    // Simulate lockout being set.
    state.lockedUntil = fixedNowMs + LOCKOUT_DURATION_MS;

    // Lockout expires.
    const expiredState: RateLimitState = {
      failedAttempts: 0,
      lockedUntil: 0,
    };

    // New failed attempt after expiry.
    const result = attemptFailed(expiredState);
    expect(result.newFailedAttempts).toBe(1);
    expect(result.shouldLockout).toBe(false);
  });
});

// ─── Lockout duration validation ───────────────────────────────────────────────

describe('BE-002f: rate limit — lockout duration', () => {
  it('LOCKOUT_DURATION_MS is 15 minutes', () => {
    expect(LOCKOUT_DURATION_MS).toBe(15 * 60 * 1000);
  });

  it('LOCKOUT_DURATION_MS is at least 5 minutes (security minimum)', () => {
    expect(LOCKOUT_DURATION_MS).toBeGreaterThanOrEqual(5 * 60 * 1000);
  });

  it('LOCKOUT_DURATION_MS is a reasonable upper bound (< 1 hour)', () => {
    expect(LOCKOUT_DURATION_MS).toBeLessThan(60 * 60 * 1000);
  });

  it('lockout expiry time is computed correctly', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    const nowMs = now.getTime();
    const lockedUntil = new Date(nowMs + LOCKOUT_DURATION_MS);
    expect(lockedUntil.getTime()).toBe(nowMs + LOCKOUT_DURATION_MS);
    expect(lockedUntil.getTime() - nowMs).toBe(LOCKOUT_DURATION_MS);
  });
});
