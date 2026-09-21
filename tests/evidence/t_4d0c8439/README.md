# BE-002b: Unlock Endpoint — Evidence

## Test Results

### Crypto unit tests (unchanged from BE-002a)
- Command: `pnpm --filter=@password-manager/crypto test`
- Result: **37/37 pass** (1 test file, 37 tests)

### API integration tests (BE-002b unlock)
- Command: `pnpm --filter=@password-manager/api exec vitest run`
- Result: **100/100 pass** (11 test files, 100 tests)

### Full API suite
- Command: `pnpm --filter=@password-manager/api exec vitest run`
- Result: **100/100 pass** (11 test files)

### Gitleaks secret scan
- Command: `pnpm scan:secrets`
- Result: **no leaks found** (exit 0)

### Typecheck
- Command: `pnpm --filter=@password-manager/crypto typecheck && pnpm --filter=@password-manager/api typecheck`
- Result: **clean** (exit 0 both)

## Acceptance Criteria Verification

### AC1: `POST /auth/unlock` — accepts master password, runs KDF, decrypts vault key
- **PASS**: Wrong password → 401 "Invalid credentials" (no leakage of whether email exists)
- **PASS**: Correct password → 200 with accessToken + refreshToken
- **PASS**: KDF (Argon2id, 64MB/3/4) → deriveVaultKey → unlockVaultKey → decrypt
- **PASS**: All DB columns present: salt (16B), kdfParams (JSON), vaultKeyEncrypted (32B), vaultKeyIv (12B), vaultKeyTag (16B)

### AC2: Returns short-lived JWT (15m) + refresh token (30d, rotation)
- **PASS**: Access token is valid JWT with header/payload/signature (3 dot-separated parts)
- **PASS**: JWT payload contains: sub (user ID), aud ("pm-api"), exp (~15min), iat, jti (random)
- **PASS**: Refresh token is valid JWT with same claim structure, exp ~30 days
- **PASS**: Each unlock issues NEW refresh token (rotation) — verified via multi-unlock test
- **PASS**: Refresh token hash (SHA-256) persisted to DB — never the raw token
- **PASS**: expiresIn field returns seconds until access token expiry (~900s)

## Test Coverage (9 integration tests)

| # | Test | Result |
|---|------|--------|
| 1 | Happy path: correct password → 200 + tokens | PASS |
| 2 | Token rotation: each unlock → new refresh token | PASS |
| 3 | Wrong password → 401 | PASS |
| 4 | Unknown email → 401 | PASS |
| 5 | Missing email → 400 | PASS |
| 6 | Missing masterPassword → 400 | PASS |
| 7 | Empty password → 400 (schema validation) | PASS |
| 8 | JWT claims: sub/aud/exp/iat/jti present, exp ~15min | PASS |
| 9 | Multi-unlock: 3 unlocks → 3 distinct refresh tokens | PASS |

## Security Compliance (SEC-001 AR-1 through AR-4)

- **AR-1** (no home-grown crypto): Only `argon2` npm binding + Node.js built-in `crypto` (HMAC-SHA256 for JWT, SHA-256 for token hash). No custom crypto.
- **AR-2** (no real secrets): All test data synthetic. JWT secret from env `JWT_SECRET` with dev fallback only. Master password never logged or stored. Vault key lives only in server memory.
- **AR-3** (positive + negative tests): Happy path, rotation, wrong password, unknown email, missing fields, empty password, JWT claim validation, multi-unlock — 9 tests covering all paths.
- **AR-4** (synthetic fixtures): All test data generated at test time — no hardcoded credentials.

## Files Changed

- `packages/crypto/src/jwt.ts` (new, 162 lines) — HS256 JWT signing/verification
- `packages/crypto/src/index.ts` (modified) — re-exports from jwt module
- `apps/services/api/src/auth/unlock.ts` (new, 179 lines) — unlock route handler
- `apps/services/api/src/server.ts` (modified) — registers unlockPlugin
- `apps/services/api/tests/auth/unlock.test.ts` (new, 105 lines) — integration tests
- `apps/services/api/vitest.config.ts` (modified) — `@crypto` path alias for tests

## PR

- PR #53: https://github.com/zeldadil/password-manager/pull/53
- Branch: `feature/t_7918f010`
- Commit: `d5eeacb` (feat: BE-002b unlock endpoint with JWT + refresh token)
- Base: `master`

## Design Decisions

1. **JWT via Node crypto (no library)**: HS256 is trivial (~50 lines). Avoiding `jose`/`jsonwebtoken` keeps the dependency graph minimal and auditable for a security-sensitive project.
2. **Email in unlock body**: Required to identify which user's vault key to decrypt. Standard pattern (Bitwarden, 1Password). Not in AC text but necessary for the crypto flow described.
3. **Refresh token hash in DB**: SHA-256 of the raw token, never the token itself. Enables rotation detection and revocation per SEC-001 Decision 6.
4. **`created_at`/`updated_at` explicitly set**: DB schema has these as NOT NULL without defaults in the insert path, so they're set explicitly.
5. **`@crypto` path alias**: Added to vitest config to resolve the monorepo package boundary cleanly in tests.

## Non-blocking observations

- The `debug-*.ts` scratch files in the worktree are untracked and not committed
- The `apps/packages/` directory appearing as untracked is a worktree artifact, not a real package
