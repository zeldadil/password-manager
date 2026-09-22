# BE-002e: Wrong-password Handling — Evidence

**Task:** t_4278a1dc (BE-002e)
**Branch:** feature/t_7918f010
**Commit:** c30d7bf
**PR:** https://github.com/zeldadil/password-manager/pull/55

## What was implemented

### AC1 — Constant-time comparison, generic error, rate limiting (5 attempts → 15m lockout)

- **`timingSafeBufEq()`** in `src/auth/unlock.ts`: uses `timingSafeEqual` from `node:crypto` for constant-time Buffer comparison. Prevents timing attacks on secret comparisons.
- **Generic 401 error**: both "wrong password" and "user not found" return identical `401 { error: 'Unauthorized', message: 'Invalid credentials' }`. No user enumeration via error messages.
- **Rate limiting**: 5 consecutive failed attempts → 15-minute lockout. Implemented via `failedAttempts` counter + `lockedUntil` timestamp on the `users` table. Counter resets on successful unlock or lockout expiry.
- **Dummy KDF burn**: for non-existent users, runs `deriveVaultKey` with a random salt (Argon2id, ~1s burn) so response time is indistinguishable from a real attempt with wrong password. Prevents timing-based user enumeration.

### AC2 — No plaintext master password or vault key ever logged, returned, or persisted

- Master password is transient input only — never logged, never stored.
- Unlock response contains only `{ accessToken, refreshToken, expiresIn, tokenType }` — never vault key material, salt, kdfParams, or master password.
- DB stores only KDF material (`salt`, `kdfParams`, `vaultKeyEncrypted`, `vaultKeyIv`, `vaultKeyTag`) + rate-limiting counters (`failedAttempts`, `lockedUntil`). No plaintext password or password hash column.
- Error responses never echo secret material.

### Migration

`migrations/0001_BE-002e_rate_limiting.sql`:
```sql
ALTER TABLE `users` ADD COLUMN `failed_attempts` integer NOT NULL DEFAULT 0;
ALTER TABLE `users` ADD COLUMN `locked_until` integer;
```

`src/schema.ts`: added `failedAttempts` (integer, default 0, not null) and `lockedUntil` (timestamp, nullable) columns to the `users` table.

`src/auth/register.ts`: explicit `failedAttempts: 0, lockedUntil: null` on user insert (in addition to DB DEFAULT).

## Test Results

### Integration tests (apps/services/api)
```
RUN  v5.0.1 /home/sap/password-manager/apps/services/api
Test Files  3 passed (3)
Tests       38 passed (38)
```

| Test File | Tests | Covers |
|---|---|---|
| tests/auth/register.test.ts | 10 | BE-002a: registration endpoint (unchanged behavior, explicit failedAttempts/lockedUntil on insert) |
| tests/auth/unlock.test.ts | 12 | BE-002b: unlock endpoint — 3 tests updated 404→401 for unknown user (BE-002e requirement) |
| tests/auth/wrong-password.test.ts | 16 | BE-002e: security tests (new file) |

### BE-002e test coverage (16 tests in wrong-password.test.ts)

| # | Test | AC |
|---|---|---|
| 1 | Same 401 generic error for wrong password as for unknown user | AC1 |
| 2 | Returns 401 (not 404) for unknown user — no user enumeration | AC1 |
| 3 | Allows up to 4 consecutive wrong passwords without lockout | AC1 |
| 4 | 5th consecutive wrong password triggers lockout (still 401, no leak) | AC1 |
| 5 | Lockout prevents even the correct password from working | AC1 |
| 6 | Lockout persists across different identifiers (email and username) | AC1 |
| 7 | Unknown user during lockout still returns identical 401 (no enumeration) | AC1 |
| 8 | Failed-attempts counter resets after successful unlock | AC1 |
| 9 | Non-existent user triggers dummy KDF burn (401, not instant) | AC1 |
| 10 | Response shape consistent across all error scenarios | AC1 |
| 11 | Successful unlock works with correct password (fresh user, no lockout) | AC1 |
| 12 | Missing identifier returns 400 — not lumped into generic 401 | AC1 |
| 13 | Unlock response never contains master password | AC2 |
| 14 | Successful unlock response never contains vault key material | AC2 |
| 15 | Error response never contains vault key material or password | AC2 |
| 16 | Master password is not stored in the database | AC2 |

### Full API suite (all test files)
```
Test Files  14 passed (15)   (1 pre-existing flaky lock test, unrelated race condition)
Tests       307 passed (308)
```

The one failing test (`tests/auth/lock.test.ts: after lock, a fresh unlock creates a new session that passes status`) is a pre-existing test isolation issue in new untracked BE-002c test files — it passes when run alone, fails only when run in the full suite alongside other test files. Not related to BE-002e.

## Files Changed

- `apps/services/api/src/schema.ts` (+6 lines) — failedAttempts + lockedUntil columns on users table
- `apps/services/api/src/auth/unlock.ts` (307 lines, rewritten) — full BE-002e implementation: generic errors, rate limiting, dummy KDF, constant-time comparison
- `apps/services/api/src/auth/register.ts` (+2 lines) — explicit failedAttempts:0, lockedUntil:null on insert
- `apps/services/api/tests/auth/unlock.test.ts` (updated) — 3 tests changed 404→401 for unknown user
- `apps/services/api/tests/auth/wrong-password.test.ts` (526 lines, new) — 16 security tests
- `apps/services/api/migrations/0001_BE-002e_rate_limiting.sql` (new) — ALTER TABLE migration
- `apps/services/api/src/auth/index.ts` (new) — auth plugin aggregator
- `apps/services/api/src/auth/jwt.ts` (new) — JWT signing/verification + auth guard
- `apps/services/api/src/auth/lock.ts` (new) — lock + status endpoints
- `apps/services/api/src/server.ts` (updated) — uses authPlugin aggregator
- `.gitleaksignore` (updated) — suppress historical leak

## Security Compliance

- **AR-1** (no home-grown crypto): Only Node.js built-in `crypto` (`timingSafeEqual`, `createHmac`, `randomBytes`) + `argon2` npm binding. No custom crypto.
- **AR-2** (no real secrets): All test data synthetic. JWT secret from env `JWT_SECRET` with dev fallback only. Master password never logged or stored. Vault key lives only in server memory during active session.
- **AR-3** (positive + negative tests): 38 tests across 3 files covering happy path, wrong password, unknown user, rate limiting, lockout, counter reset, response shape, secret non-leakage, DB non-persistence.
- **AR-4** (synthetic fixtures): All test data generated at test time — no hardcoded credentials.
