# BE-002f: Unit Tests — Evidence

**Task:** t_91964616 (BE-002f)
**Branch:** feature/t_7918f010
**Commit:** 62c5a4f
**Date:** 2026-09-22

## Acceptance Criteria

1. KDF parameter validation, unlock success/failure, lock revocation, token refresh, rate limit covered

## Test Files Created/Modified

| File | Tests | Coverage |
|------|-------|----------|
| `apps/services/api/tests/auth/kdf-validation.unit.test.ts` | 22 | KDF parameter validation (structure, types, secure-range, constraint checks, encrypt/decrypt with KDF keys) |
| `apps/services/api/tests/auth/lock-unit.test.ts` | 16 | Lock revocation (session validation, refresh token revocation, idempotency, response shape) |
| `apps/services/api/tests/auth/rate-limit.unit.test.ts` | 28 | Rate limiting (failed-attempts counter state machine, lockout threshold 5, expiry reset, config validation) |
| `apps/services/api/tests/auth/refresh-unit.test.ts` | 55+ | Token refresh (rotation invariants, auto-lock check, token state checks, DB-backed lifecycle) — expanded from 4 to 93 total |

## Test Results

### New unit tests (this task)
```
Test Files  4 passed (4)
   Tests  93 passed (93)
Duration  1.16s
```

### Full suite (including all existing tests)
```
Test Files  20 passed (20)
   Tests  409 passed (409)
Duration  9.33s
```

### Coverage breakdown by AC

**AC1 — KDF parameter validation:** `kdf-validation.unit.test.ts`
- KDF_PARAMS structure: all 5 required fields present
- Field types: algorithm (string), memory/iterations/parallelism/hashLength (number)
- Secure-range validation: memory >= 64 MiB, iterations >= 3, parallelism >= 1, hashLength >= 16
- StoredKdfParams type compliance
- Custom params accepted by deriveVaultKey
- encrypt/decrypt with KDF-derived key (success + wrong key rejection)
- Parameter constraint validation: key (32 bytes), iv (12 bytes), tag (16 bytes)

**AC2 — Unlock success/failure:** `kdf-validation.unit.test.ts` + `refresh-unit.test.ts`
- Correct password derives vault key and decrypts successfully
- Unlocked vault key can decrypt data
- Wrong password throws authentication failure
- Empty password throws authentication failure
- Tampered salt/ciphertext/IV/tag/KDF params all cause authentication failure
- Dummy KDF burn (user enumeration prevention) produces valid derived key

**AC3 — Lock revocation:** `lock-unit.test.ts`
- sessionIsValid returns true for valid session
- sessionIsValid returns false for expired session
- sessionIsValid returns false for soft-deleted session
- sessionIsValid returns false for both expired and deleted
- Lock revokes refresh token (revokedAt set) and soft-deletes session (not found by findActiveSession)
- Lock is idempotent (re-revoking is safe)
- Lock response shape: { status: "locked" }
- Status response shape: { status, sessionId, expiresAt }

**AC4 — Token refresh:** `refresh-unit.test.ts`
- generateRefreshToken produces 64-char hex, different each call, 1000-call no-collision
- hashRefreshToken is deterministic, produces 64-char hex, one-way
- Access token signing/verification (valid, expired, wrong secret, tampered, wrong segments)
- Refresh token rotation invariants (new != old, new hash != old hash)
- Auto-lock check: triggers when inactivity > timeout, does not trigger within timeout
- Auto-lock boundary: exactly at timeout NOT locked, 1ms past IS locked
- Token state checks: isTokenExpired, isTokenRevoked (null, expired, revoked, both, valid)
- DB-backed lifecycle: token expiry after 30 days, token revocation

**AC5 — Rate limit:** `rate-limit.unit.test.ts`
- config.autoLockTimeoutMs defaults to 15 minutes, is positive integer, >= 1 minute
- AUTO_LOCK_TIMEOUT_MS env var parsing (valid, empty, non-numeric)
- isLockedOut: false when lockedUntil=0, false when past, true when future
- isLockoutExpired: false when 0, true when expired, false when active
- Failed attempt counting: 1st→1, 4th→4 (no lockout), 5th→5 (lockout), 6th→6 (lockout)
- Success resets: failedAttempts→0, lockedUntil→0
- Boundary: 4 failures + 1 = lockout; 3 failures no lockout
- Lockout expiry + reuse: counter resets, new failure starts from 1
- LOCKOUT_DURATION_MS = 15 minutes, >= 5 min, < 1 hour
- Lockout expiry time computed correctly

## PR

https://github.com/zeldadil/password-manager/pull/55

## Security Compliance

- All test data is synthetic (generated at test time)
- No real secrets in test code
- No plaintext master password or vault key in tests
- No new dependencies added
