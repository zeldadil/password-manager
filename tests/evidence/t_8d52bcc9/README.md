# BE-002h: Security Tests — Evidence

**Task:** t_8d52bcc9
**Date:** 2026-09-22
**Profile:** backend

## What was built

39 new security tests in `tests/auth/security.test.ts` covering all five
acceptance criteria from the task card:

1. **Timing-attack resistance** (5 tests)
   - Constant-time signature comparison verified (same-length wrong sig rejected)
   - Tampered signature of identical length rejected (no length short-circuit)
   - Wrong password and unknown user return identical 401 bodies
   - Non-existent user returns 401 (not 404) — dummy KDF burn path
   - Error message never contains user-enumeration signals

2. **Brute-force protection** (8 tests)
   - 4 consecutive wrong passwords allowed without lockout
   - 5th consecutive wrong password triggers lockout (silent — no threshold leak)
   - Correct password rejected during lockout
   - Lockout persists across identifier type (email + username)
   - Unknown user during lockout returns identical 401
   - DB reflects failedAttempts=5 and lockedUntil set after lockout
   - Successful unlock resets counter to 0 and clears lockedUntil
   - After lockout expiry, counter resets and new wrong attempt starts from 1

3. **Token replay protection** (8 tests)
   - Old refresh token rejected after rotation (replay attack fails)
   - Newly rotated refresh token works, old one stays dead
   - Access token rejected by /auth/status after /auth/lock
   - Refresh with token whose session was locked is rejected
   - Tampered refresh token rejected
   - Empty refresh token rejected
   - Missing refresh token field rejected
   - Refresh token single-use guarantee (second use always fails)

4. **JWT algorithm confusion resistance** (9 tests)
   - Token with alg=none and empty signature rejected
   - Token with alg=HS512 header — verifier only implements HS256
   - Token with garbage header (non-JSON base64) rejected
   - Token with non-JSON payload rejected
   - Token with missing userId rejected
   - Token with missing sessionId rejected
   - Token with wrong type claim rejected
   - Expired token rejected even with valid signature
   - Token signed with wrong secret rejected
   - Token with wrong number of segments rejected

5. **Secret scan on logs (redaction)** (9 tests)
   - Telegram bot token pattern redacted
   - Bearer token value redacted (keeps "Bearer " label)
   - key=value patterns redacted (apiKey, secret, token, password, salt, iv, tag)
   - key: value patterns redacted
   - Non-string input returns empty string
   - Multiple secrets in one string all redacted
   - Non-secret content preserved unchanged
   - Bearer token embedded in validation error message redacted

## Test results

```
PASS  tests/auth/security.test.ts (39 tests)
Test Files  1 passed (1)
Tests       39 passed (39)
Duration    3.59s
```

Full suite after adding BE-002h:

```
Test Files  22 passed (22)
Tests       469 passed (469)
Duration    14.51s
```

## Files

- `apps/services/api/tests/auth/security.test.ts` — 39 tests, 574 lines
- `apps/services/api/tests/evidence/t_8d52bcc9/README.md` — this file

## Security compliance

- AR-1: Node.js built-in crypto only (no third-party JWT library)
- AR-2: No real secrets — all test data synthetic, generated at test time
- AR-3: Positive + negative tests for every security concern
- AR-4: All fixtures generated at test time, no hardcoded credentials

## Commit

`ab33fba` — `test(api): BE-002h security tests — timing, brute-force, replay, JWT alg, log redaction`

Branch: `feature/t_7918f010`
PR: https://github.com/zeldadil/password-manager/pull/55
