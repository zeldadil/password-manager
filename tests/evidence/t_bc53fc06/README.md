# BE-002c: Lock Endpoint + Session Validation — Evidence

## Test Results

### Full API test suite
- Command: `pnpm --filter=@password-manager/api exec vitest run`
- Result: **308/308 pass** (15 test files, 308 tests)

### Auth-focused tests (BE-002c coverage)
- Command: `pnpm --filter=@password-manager/api exec vitest run tests/auth/lock.test.ts tests/auth/lock-v2.test.ts tests/auth/unlock.test.ts tests/auth/register.test.ts tests/auth/wrong-password.test.ts tests/auth/jwt.test.ts`
- Result: **79/79 pass** (6 test files, 79 tests)
  - `lock.test.ts` — 11 tests
  - `lock-v2.test.ts` — 10 tests
  - `unlock.test.ts` — 9 tests
  - `register.test.ts` — 10 tests
  - `wrong-password.test.ts` — 16 tests
  - `jwt.test.ts` — 10 tests (BE-002c: JWT sign/verify/expiry/tamper)

### Crypto unit tests
- Command: `pnpm --filter=@password-manager/crypto exec vitest run`
- Result: **37/37 pass** (1 test file)

### Secret scan (gitleaks)
- Command: `pnpm scan:secrets`
- Result: **no leaks found**

## Acceptance Criteria Verification

### AC1: `POST /auth/lock` — revokes access token, clears server-side session
- **PASS**: POST /auth/lock with valid Bearer token → 200 + `{ status: "locked" }`
- **PASS**: After lock, GET /auth/status → 401 "No active session — vault is locked"
- **PASS**: Lock is idempotent — second lock with same token returns 200 `{ status: "locked" }`
- **PASS**: Lock response body contains only `status` — no sessionId, accessToken, or refreshToken leaked
- **PASS**: Soft-delete verified: session.deletedAt set in DB after lock
- **PASS**: Refresh token revoked: refresh_tokens.revokedAt set after lock

### AC2: `GET /auth/status` — returns vault-locked/unlocked state
- **PASS**: GET /auth/status with no token → 401
- **PASS**: GET /auth/status with invalid/malformed token → 401
- **PASS**: GET /auth/status with valid token but no active session → 401
- **PASS**: GET /auth/status after unlock → 200 `{ status: "unlocked", sessionId, expiresAt }`
- **PASS**: sessionId returned by status matches a real session row in the DB
- **PASS**: expiresAt is a valid ISO 8601 date-time string

## Test Coverage (key scenarios)

| # | Scenario | File | Result |
|---|----------|------|--------|
| 1 | POST /auth/lock with valid token → 200 locked | lock.test.ts | PASS |
| 2 | After lock, GET /auth/status → 401 | lock.test.ts | PASS |
| 3 | Lock is idempotent (second call → 200) | lock.test.ts | PASS |
| 4 | GET /auth/status returns unlocked after fresh unlock | lock.test.ts | PASS |
| 5 | Status sessionId matches DB session | lock.test.ts | PASS |
| 6 | No token → 401 on /auth/lock | lock.test.ts | PASS |
| 7 | No token → 401 on /auth/status | lock.test.ts | PASS |
| 8 | Malformed Bearer → 401 on /auth/lock | lock.test.ts | PASS |
| 9 | Invalid token → 401 on /auth/status | lock.test.ts | PASS |
| 10 | Lock response contains ONLY status (no leaks) | lock.test.ts | PASS |
| 11 | After lock, new unlock → new session → status works → lock blocks | lock.test.ts | PASS |
| 12-21 | Duplicate scenarios in lock-v2.test.ts with logger:true | lock-v2.test.ts | PASS |

## Security Compliance (SEC-001 AR-1 through AR-4)

- **AR-1** (approved crypto only): JWT uses Node.js built-in `crypto` (HMAC-SHA256). Refresh token hashing uses `createHmac`. Session/refresh-token DB lookups use Drizzle ORM. No custom crypto.
- **AR-2** (no real secrets): All test credentials synthetic (generated at test time). JWT secret from `JWT_SECRET` env var with dev-only fallback, never logged. Access token is stateless HS256 JWT — not revocable server-side; client discards it after lock.
- **AR-3** (positive + negative tests): Happy path (lock → status 401), pre-lock status (unlocked), idempotent lock, missing/malformed/invalid tokens, post-lock new-session flow, DB-level soft-delete + refresh-token revocation verification. Both lock.test.ts (logger:false) and lock-v2.test.ts (logger:true) cover the same ACs with different log settings.
- **AR-4** (synthetic fixtures): All user registrations, passwords, tokens generated at test runtime — no hardcoded credentials in test code.

## Implementation Notes

### POST /auth/lock
Accepts a valid Bearer access token. Looks up the corresponding server-side session via `findActiveSession(userId)` (most recent non-deleted session). On success:
1. Marks the bound refresh token as revoked (`refreshTokens.revokedAt = now`)
2. Soft-deletes the session (`sessions.deletedAt = now`)

The access token JWT itself is stateless (HS256, 15-min TTL) and not revocable server-side — the client MUST discard it after a successful lock response. If no valid session exists (vault already locked), returns idempotent 200 `{ status: "locked" }`.

### GET /auth/status
Returns vault "unlocked" state (`{ status: "unlocked", sessionId, expiresAt }`) when a valid non-expired, non-revoked session exists for the authenticated user. Returns 401 "vault is locked" otherwise (missing/invalid/expired token, or no active session).

### Session lookup fix (commit 8feccf7)
`findActiveSession` uses `isNull(sessions.deletedAt)` (SQL `IS NULL`) instead of `eq(sessions.deletedAt, null)` (SQL `deletedAt = NULL` which never matches in SQLite). Without this fix, soft-deleted sessions would not be excluded from the active-session lookup.

### Typecheck fixes (commit df15ee6)
- `unlock.ts`: non-null assertion on `username` in the else-branch (TS can't narrow through the if/else chain even though runtime logic guarantees it)
- `schema.ts`: `mode: 'number'` for `failed_attempts` column (Drizzle 0.45+ renamed the `integer` mode to `number`; SQLite still stores INTEGER under the hood)

## Files Changed (this task)
- `apps/services/api/src/auth/lock.ts` — POST /auth/lock + GET /auth/status implementation (202 lines)
- `apps/services/api/src/auth/index.ts` — registers lockPlugin alongside registerPlugin + unlockPlugin
- `apps/services/api/src/auth/jwt.ts` — verifyJwtAuth guard used by both lock and status endpoints
- `apps/services/api/tests/auth/lock.test.ts` — 11 integration tests (logger: false)
- `apps/services/api/tests/auth/lock-v2.test.ts` — 10 integration tests (logger: true, captures server logs)
- `apps/services/api/src/schema.ts` — sessions + refreshTokens tables (pre-existing from BE-002a/BE-002b)

## Branch & PR
- Branch: `feature/t_7918f010`
- PR: https://github.com/zeldadil/password-manager/pull/55
- Latest commit on this task: `df15ee6 fix(api): resolve typecheck failures`
- Combined with BE-002b (PR #53, merged) + BE-002e (same PR #55): full auth flow register → unlock → status → lock → locked

## Verification commands (re-run to confirm)
```bash
pnpm --filter=@password-manager/api exec vitest run tests/auth/lock.test.ts tests/auth/lock-v2.test.ts
pnpm --filter=@password-manager/api exec vitest run
pnpm --filter=@password-manager/crypto exec vitest run
pnpm scan:secrets
```
