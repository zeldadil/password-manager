# BE-002a: Registration + KDF + Vault Key Storage — Evidence

**Task:** t_16f8ad84  
**Branch:** feature/t_7918f010  
**Commit:** 17fd35a  
**PR:** https://github.com/zeldadil/password-manager/pull/53  

## Acceptance Criteria Coverage

### AC1: Master password registration — KDF derives vault key, vault key encrypts empty vault
- `packages/crypto/src/index.ts::registerMasterPassword()`: generates random 16-byte salt, derives 32-byte vault key via Argon2id (64MB/3/4), encrypts vault key with itself via AES-256-GCM → returns `{kdfParams, salt, vaultKeyEncrypted, vaultKeyIv, vaultKeyTag}`
- `apps/services/api/src/auth/register.ts`: POST /auth/register accepts masterPassword, calls registerMasterPassword(), persists record to users table columns (salt, kdfParams, vaultKeyEncrypted, vaultKeyIv, vaultKeyTag), returns 201 with {id, email, username, kdfParams}
- Tests: `registerMasterPassword` positive tests (crypto.test.ts lines 189-241) + API integration test "registers a new user and returns 201" (register.test.ts)

### AC2: Stored as { kdfParams, salt, ciphertext, iv, tag }
- `packages/crypto/src/index.ts::KdfRegistrationRecord` interface: { kdfParams: StoredKdfParams, salt: Buffer, vaultKeyEncrypted: Buffer, vaultKeyIv: Buffer, vaultKeyTag: Buffer }
- `apps/services/api/src/schema.ts::users` table: salt (blob), kdfParams (text/json), vaultKeyEncrypted (blob), vaultKeyIv (blob), vaultKeyTag (blob)
- `apps/services/api/src/auth/register.ts`: inserts all 5 fields into users table
- Tests: Storage format round-trip test (crypto.test.ts lines 332-362), response shape test (register.test.ts — verifies no secret material leaked)
- Evidence: `registerMasterPassword` test (crypto.test.ts line 190-197) asserts all 5 fields present

## Test Results

### Crypto unit tests (packages/crypto)
```
RUN  v5.0.1 /home/sap/password-manager/.worktrees/t_7918f010/packages/crypto
Test Files  1 passed (1)
     Tests  37 passed (37)
```

### API integration tests (apps/services/api)
```
RUN  v5.0.1 /home/sap/password-manager/.worktrees/t_7918f010
Test Files  1 passed (1)
     Tests  10 passed (10)
```

**Total: 47/47 passing**

## Security Compliance

- AR-1: Only argon2 npm binding + Node.js crypto used — no home-grown crypto
- AR-2: No real secrets in code, tests, or fixtures — all synthetic
- AR-3: Positive + negative tests for every crypto path (wrong key, tampered ciphertext, wrong tag, wrong IV, wrong AAD, wrong password, empty password, tampered salt)
- AR-4: All test data synthetic (generated passwords, plaintext, salts)

## Files Changed

- `packages/crypto/src/index.ts` (143 lines) — KDF + AEAD + registration/unlock flows
- `packages/crypto/tests/crypto.test.ts` (363 lines) — 37 unit tests
- `packages/crypto/package.json` — workspace package with argon2 dependency
- `packages/crypto/tsconfig.json` — TypeScript config
- `packages/crypto/vitest.config.ts` — Vitest config
- `apps/services/api/src/auth/register.ts` (160 lines) — POST /auth/register plugin
- `apps/services/api/tests/auth/register.test.ts` (234 lines) — 10 integration tests
- `apps/services/api/tests/auth/test-env.ts` — test environment setup
- `apps/services/api/src/db.ts` — db singleton → let + setTestDbOverride
- `apps/services/api/src/server.ts` — registers authPlugin
