# NEGATIVE_TEST_CHECKLIST.md — Secure Password Manager

**Maintained by:** `qa` · **Consumed by:** `backend`, `frontend`, `browser`, `architect`, `docs`
**Status:** Proposed — pending Architect review
**Task:** QA-001f (`t_11c01f92`) · **Test Types:** `meta`, `security` · **Last updated:** 2026-09-17

---

## 1. Purpose and Scope

This is the **consolidated negative-test checklist artifact** required by `TEST_STRATEGY.md` §6.3. It enumerates every
mandatory negative-test case (per §6.2) together with the **owning test path** where the case must live, the **expected
safe failure**, and the **SEC-001** vector / absolute rule it defends.

The five attack themes named in this card's acceptance criteria are the primary organizing sections (§4.1–§4.5):

1. **Tampered ciphertext** — crypto integrity failures (SEC-001 V1/V7, Decision 5, AR-3).
2. **Auth abuse** — authentication / session / token abuse (SEC-001 V2/V5/V6; ADR-004 auth endpoints).
3. **Leakage vectors** — secret exposure via logs/errors/URLs/telemetry/storage (SEC-001 V4, AR-2).
4. **Permission bypass** — authorization / ownership / level escalation (SEC-001 V2; ADR-003 §6).
5. **Origin spoofing** — bridge and extension-origin impersonation (SEC-001 V3, Decision 9; ADR-005 §3).

**Scope of the artifact.** This checklist is a *specification*, not a test suite. The crypto, bridge, and auth code it
targets is not yet written (SEC-001 gate is pending QA sign-off; downstream tasks are blocked). Each row names the file
where the test **will** live, so the implementing card can be checked against this list in review. Test paths follow
`TEST_STRATEGY.md` §8.

**Out of scope:** CI *wiring* (QA-001b), Playwright matrix (QA-001c), SAST/dependency/secret-scan *config* (QA-001d),
fixture/coverage *implementation* (QA-001e), artifact *upload* (QA-001g), sign-off *enforcement* (QA-001h).

---

## 2. How to Read a Case

Every case below is a row with five fields:

| Field | Meaning |
|---|---|
| **ID** | Stable identifier (`<THEME>-<nn>`), referenced by tests and review notes. |
| **Negative case** | The exact failure mode or abuse input being exercised. |
| **Expected safe failure** | How the system must fail: correct code/status (ADR-004), generic message, no secret material, no state mutation. |
| **Owning test path** | File (or suite) where the test belongs, per `TEST_STRATEGY.md` §8. |
| **Vector / rule** | The SEC-001 vector (`V1`–`V7`) and/or absolute rule (`AR-1`–`AR-6`) the case defends. |

### 2.1 What every negative test must assert (TEST_STRATEGY §6.1)

A case is **not** satisfied by "it threw". Each implemented test must assert **all five**:

1. **Correct failure semantics** — the exact error code / HTTP status from ADR-004 (or the documented error shape).
2. **Generic message** — no cryptographic detail, no stack trace, no existence oracle.
3. **No secret leakage** — response/log must not contain `password`, `secret`, `token`, `key`, `vaultKey`, `salt`,
   `iv`, `tag`, `ciphertext`, `plaintext`, or any hex/base64 blob that could be secret material.
4. **No side effects** — a failed operation must not mutate DB state, session state, or in-memory key material
   (asserted by before/after snapshots).
5. **Vector reference** — the test names the SEC-001 vector it defends (or `n/a — general robustness`).

---

## 3. Reference Surfaces (what each theme attacks)

| Theme | Primary surface | Key source of truth |
|---|---|---|
| Tampered ciphertext | `packages/crypto/**` (AEAD, KDF, key wrap) + `Resource.secretCiphertext` / `User.vaultKeyEncrypted` | SEC-001 Decisions 1–5; AR-1, AR-3; ADR-003 §3.1/§3.3 |
| Auth abuse | `/auth/login`, `/auth/refresh`, `/auth/logout` + JWT middleware | ADR-004; SEC-001 Decision 6; ADR-002 §4.2 |
| Leakage vectors | Logging, error handler, URL/query handling, storage, telemetry | SEC-001 V4; AR-2; ADR-004 envelope |
| Permission bypass | `/resources`, `/folders`, `/tags`, `/permissions`, `/vaults` | ADR-003 §6; ADR-004; SEC-001 V2 |
| Origin spoofing | Extension bridge `postMessage` + content script + manifest | ADR-005 §3–§6; SEC-001 Decision 9; ADR-002 §6 |

---

## 4. Primary Categories (acceptance criteria)

### 4.1 Tampered Ciphertext (crypto integrity — §6.2-A)

Every case asserts: decryption **fails**, returns the generic "decryption failed" error (no crypto detail), leaks **no**
plaintext, and mutates **no** state. Owning suites: `packages/crypto/**/__tests__/*.test.ts` (primitive-level) and
`tests/security/crypto-property.test.ts` (property-level, AR-3 gate).

| ID | Negative case | Expected safe failure | Owning test path | Vector / rule |
|---|---|---|---|---|
| CRY-01 | Tampered ciphertext — single-bit flip in `secretCiphertext` / `vaultKeyEncrypted` | GCM tag fails → generic "decryption failed"; no plaintext returned | `packages/crypto/src/**/__tests__/aead.test.ts` · `tests/security/crypto-property.test.ts` | V1 · AR-3 · Decision 5 |
| CRY-02 | Corrupted / truncated authentication tag (`secretTag`, `vaultKeyTag`, `metadataTag`) | Tag verification fails → decrypt rejected | `packages/crypto/src/**/__tests__/aead.test.ts` · `tests/security/crypto-property.test.ts` | V1 · AR-3 · Decision 5 |
| CRY-03 | Wrong nonce (`secretIv`) — reused or substituted nonce | Decrypt fails; nonce-reuse detection fires (logged as security event, no secret material) | `packages/crypto/src/**/__tests__/nonce.test.ts` · `tests/security/crypto-property.test.ts` | V1 · AR-3 · Decision 4 |
| CRY-04 | Truncated ciphertext (shorter than tag length, or mid-block) | Decrypt fails generically; no partial plaintext | `packages/crypto/src/**/__tests__/aead.test.ts` · `tests/security/crypto-property.test.ts` | V1 · AR-3 |
| CRY-05 | Wrong AAD / resource binding — ciphertext copied from resource A presented to resource B | AAD mismatch → decrypt fails; copy-paste ciphertext swap rejected | `packages/crypto/src/**/__tests__/aad.test.ts` · `tests/security/crypto-property.test.ts` | V1 · AR-3 · Decision 5 (AAD) |
| CRY-06 | Wrong key — decrypting with a different vault key / sub-key | Decrypt fails; no oracle distinguishing "wrong key" from "wrong data" | `packages/crypto/src/**/__tests__/key-wrap.test.ts` · `tests/security/crypto-property.test.ts` | V1 · AR-3 · Decision 3 |
| CRY-07 | Wrong format version — ciphertext tagged with unknown/older version | Clear, non-destructive error; no attempt to decrypt with wrong construction | `packages/crypto/src/**/__tests__/version.test.ts` | V7 · AR-3 · Decision 8 |
| CRY-08 | Wrong password at KDF → vault-key decrypt | Vault-key unwrap fails → generic auth failure (no existence oracle); no vault key materialized | `packages/crypto/src/**/__tests__/kdf.test.ts` · `apps/services/api/**/__tests__/auth.test.ts` | V2 · AR-3 · Decision 3/6 |
| CRY-09 | KDF parameter tampering (memory/iterations lowered in stored `kdfParams`) | Server rejects out-of-policy params, or re-derives fails safely; no weak-param downgrade accepted | `packages/crypto/src/**/__tests__/kdf.test.ts` | V1 · AR-3 · Decision 1 |
| CRY-10 | Nonce reuse detection — same nonce+ciphertext seen twice for same key | Critical security event logged/alerted; decrypt still fails closed | `packages/crypto/src/**/__tests__/nonce.test.ts` | V1 · Decision 4 |

**Corrupted backup / migration integrity (AR-5, SEC-001 V7)** — these are tampered-ciphertext variants at the
archive/schema level, enumerated in §5.3 below.

### 4.2 Auth Abuse (authentication / session / token — §6.2-B auth subset)

Primary surface: `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` + JWT middleware (ADR-004; SEC-001
Decision 6). Owning suites: `apps/services/api/**/__tests__/auth*.test.ts`, `apps/services/api/**/__tests__/contract/*.test.ts`,
`tests/security/vectors/` (V2/V5), and `tests/e2e/web/*.spec.ts` for the user-visible flows.

| ID | Negative case | Expected safe failure | Owning test path | Vector / rule |
|---|---|---|---|---|
| AUTH-01 | Login with wrong master password | 401; generic "invalid credentials"; no distinction between unknown email vs. wrong password (no existence oracle) | `apps/services/api/**/__tests__/auth.test.ts` · `tests/e2e/web/` (E2E-WEB-009) | V2 · AR-3 |
| AUTH-02 | Login with unknown email | Same 401 + generic body as AUTH-01; identical timing/status (no account enumeration) | `apps/services/api/**/__tests__/auth.test.ts` | V2 · V4 |
| AUTH-03 | Login missing / malformed `vaultKeyProof` (wrong type, not base64, oversized) | 400 validation error; no crypto detail in message; no session issued | `apps/services/api/**/__tests__/contract/auth.test.ts` | V2 · AR-2 |
| AUTH-04 | MFA failure — wrong / expired / reused TOTP code (when MFA enabled) | 401; generic failure; code is single-use (replay rejected) | `apps/services/api/**/__tests__/auth-mfa.test.ts` | V2 · V5 |
| AUTH-05 | Missing `Authorization` header on a protected endpoint | 401 (not 403); no resource info leaked | `apps/services/api/**/__tests__/authz-middleware.test.ts` | V2 |
| AUTH-06 | Expired JWT access token | 401; refresh path required; no plaintext returned | `apps/services/api/**/__tests__/authz-middleware.test.ts` | V2 · V5 · Decision 6 |
| AUTH-07 | Malformed / tampered JWT (bad signature, altered claims) | 401; signature verification fails; token rejected | `apps/services/api/**/__tests__/authz-middleware.test.ts` | V2 |
| AUTH-08 | Revoked JWT (logged-out / locked session) reused | 401; revoked token rejected even within nominal expiry window | `apps/services/api/**/__tests__/authz-middleware.test.ts` | V2 · V5 |
| AUTH-09 | JWT with wrong `aud`/`iss`/algorithm confusion (`alg=none`, HS↔RS swap) | 401; server enforces expected algorithm + audience, rejects confusion | `apps/services/api/**/__tests__/jwt.test.ts` | V2 · AR-1 |
| AUTH-10 | Refresh token reuse after rotation (token replay) | 401; reused refresh token invalidates the whole token family (rotation detected) | `apps/services/api/**/__tests__/auth-refresh.test.ts` | V2 · V5 · Decision 6 |
| AUTH-11 | Refresh with expired / revoked / wrong-user refresh token | 401; no new access token; no cross-user session | `apps/services/api/**/__tests__/auth-refresh.test.ts` | V2 · V5 |
| AUTH-12 | Logout twice, or use access token after logout | Second logout idempotent; post-logout token use → 401 | `apps/services/api/**/__tests__/auth-logout.test.ts` | V5 · Decision 6 |
| AUTH-13 | Lock (`POST /auth/lock`) then use session | Vault key cleared from memory; JWT revoked; subsequent access → 401 and requires re-unlock | `apps/services/api/**/__tests__/auth-lock.test.ts` · `tests/e2e/web/` (E2E-WEB-007) | V5 · Decision 6 |
| AUTH-14 | Auto-lock expiry (15m) not enforced | Session expires on schedule; vault key cleared; E2E asserts auto-lock after inactivity | `apps/services/api/**/__tests__/session.test.ts` · `tests/e2e/web/` (E2E-WEB-006) | V5 · Decision 6 |
| AUTH-15 | Master password never reaches server — assert login payload carries no `masterPassword` field | Contract test rejects a body containing a plaintext master-password field | `apps/services/api/**/__tests__/contract/auth.test.ts` | V2 · AR-2 · Decision 3 |
| AUTH-16 | Brute-force / rapid repeated login (rate limiting, if in V1) | If rate limiting exists: 429 after threshold, no lockout-state oracle; otherwise documented as out-of-scope for V1 | `apps/services/api/**/__tests__/auth-rate-limit.test.ts` (if implemented) | V2 |

### 4.3 Leakage Vectors (secret exposure — §3.3.2, AR-2)

Every case asserts the **absence** of secret material, not a specific HTTP code. Owning suites:
`tests/security/leakage.test.ts`, `apps/services/api/**/__tests__/error*.test.ts`, and the CI scans in §4.3-note.

| ID | Negative case | Expected safe failure | Owning test path | Vector / rule |
|---|---|---|---|---|
| LEAK-01 | Logger serializing a request/response object containing a secret-named field | Redaction: `password`, `secret`, `token`, `key`, `salt`, `iv`, `tag`, `ciphertext` fields redacted/omitted | `tests/security/leakage.test.ts` (structured-logger redaction) | V4 · AR-2 |
| LEAK-02 | 500 error leaking stack trace in production | Stack trace stripped; generic envelope error returned | `apps/services/api/**/__tests__/error-handler.test.ts` | V4 · AR-2 |
| LEAK-03 | Crypto error leaking detail (bad tag, nonce, algorithm) | Message is "decryption failed" (no `tag`, `iv`, `ciphertext`, algorithm, or library detail) | `packages/crypto/src/**/__tests__/error-mapping.test.ts` · `tests/security/leakage.test.ts` | V4 · AR-3 · Decision 5 |
| LEAK-04 | Secret/token in URL query string or path segment | Auth/secret values never appear in query or path; route test + lint assert POST-body-only for auth | `tests/security/leakage.test.ts` (URL scan) · `apps/services/api/**/__tests__/route*.test.ts` | V4 · AR-2 |
| LEAK-05 | `salt`, `kdfParams`, `vaultKeyEncrypted` returned by `GET /users/{id}` (or any endpoint) | Never returned — server-side only (ADR-004 `/users/{id}`); response redacted | `apps/services/api/**/__tests__/contract/users.test.ts` | V4 · AR-2 · ADR-004 |
| LEAK-06 | Decrypted plaintext present in any API response body or error body | Only ciphertext + metadata returned; no plaintext secret in responses | `apps/services/api/**/__tests__/contract/*.test.ts` · `tests/security/leakage.test.ts` | V4 · AR-2 · Decision 3 |
| LEAK-07 | Plaintext secret persisted to `localStorage`/`IndexedDB` (web) or `storage.local` (extension) | Only ciphertext persisted; no plaintext secret or vault key in persistent storage | `apps/web/src/**/__tests__/storage*.test.ts(x)` · `apps/browser-firefox/src/background/**/*.test.ts` · `tests/security/vectors/` (V5) | V5 · AR-2 · BR-002e |
| LEAK-08 | Telemetry/analytics/beacon endpoint in bundle | No telemetry SDK/beacon call exists (import/URL scan) | `tests/security/leakage.test.ts` (bundle scan) | V4 · SEC-001 V4 control |
| LEAK-09 | `console.log`/`console.*` in production crypto/auth code paths | ESLint `no-console` rule bans it; lint fails | `pnpm lint` (ESLint rule) — enforced by QA-001b | V4 · AR-2 |
| LEAK-10 | Real secret committed to repo / history | `gitleaks` + `truffleHog` detect → build fails; rotation required (AR-2) | `pnpm scan:secrets` (CI) — wired by QA-001d | V1/V4 · AR-2 |
| LEAK-11 | AAD/metadata bindings echo secret material in errors | AAD usage never serializes the secret into error/log output | `packages/crypto/src/**/__tests__/aad.test.ts` · `tests/security/leakage.test.ts` | V4 · Decision 5 |

### 4.4 Permission Bypass (authorization / ownership — §6.2-B authz subset)

Primary surface: authorization middleware + every entity endpoint (ADR-003 §6.2; ADR-004). Owning suites:
`apps/services/api/**/__tests__/authz*.test.ts`, `apps/services/api/**/__tests__/resources*.test.ts` (and folders/tags/
permissions), `tests/security/vectors/` (V2), `tests/e2e/web/` (E2E-WEB-002).

| ID | Negative case | Expected safe failure | Owning test path | Vector / rule |
|---|---|---|---|---|
| PERM-01 | IDOR — user B requests user A's resource/folder/vault/tag by UUID | 403 (or 404 to avoid existence oracle — per ADR-004 decision); never returns the entity | `apps/services/api/**/__tests__/authz-ownership.test.ts` | V2 · ADR-003 §6.2 |
| PERM-02 | `read`-only grantee attempts `PATCH`/`DELETE` on resource | 403; update/delete blocked (requires Update+); state unchanged | `apps/services/api/**/__tests__/authz-level.test.ts` | V2 · ADR-003 §3.5 |
| PERM-03 | `update`-only grantee attempts to grant/revoke permissions (requires Owner) | 403; no permission mutation | `apps/services/api/**/__tests__/permissions.test.ts` | V2 · ADR-003 §3.5 |
| PERM-04 | Non-owner (no grant) attempts `POST /permissions` to grant themselves Owner on a target | 403; grantor must have Owner on target; self-escalation rejected | `apps/services/api/**/__tests__/permissions.test.ts` | V2 · ADR-003 §6.2 step 7 |
| PERM-05 | Revoke a permission the caller did not grant and does not own | 403 (only Owner or original grantor may revoke) | `apps/services/api/**/__tests__/permissions.test.ts` | V2 · ADR-004 `/permissions/{id}` |
| PERM-06 | Access a soft-deleted resource without Owner (`includeDeleted=true`) | 403 or filtered out; non-owner cannot enumerate deleted items | `apps/services/api/**/__tests__/resources.test.ts` | V2 · ADR-004 |
| PERM-07 | Folder `permissionMask` propagation edge — move/create a resource the user does **not** own into a folder | Mask applied only "where possible" (user owns the resource); no permission granted on a resource the caller can't own | `apps/services/api/**/__tests__/folders-mask.test.ts` | V2 · ADR-003 §3.4/§6.3 |
| PERM-08 | Cross-folder move with conflicting masks / existing explicit permissions | Documented resolution rules honored; no unintended permission escalation | `apps/services/api/**/__tests__/folders-mask.test.ts` | V2 · ADR-003 open Q2 |
| PERM-09 | Cross-vault access — tag/resource/folder from vault A accessed via vault B context | 403/404; entities are vault-scoped; no cross-vault leak | `apps/services/api/**/__tests__/authz-vault-scope.test.ts` | V2 · ADR-003 §3.6 |
| PERM-10 | List endpoints leak another user's metadata | Responses filtered to requester's own vault/ownership; no cross-user rows in list | `apps/services/api/**/__tests__/authz-list.test.ts` | V2 · SEC-001 V2 control |
| PERM-11 | Permission level escalation via group (post-MVP) — non-member or removed member still holds group grant | Group membership resolved at request time; removed member loses access immediately | `apps/services/api/**/__tests__/permissions-group.test.ts` (post-MVP) | V2 · ADR-003 §6.2 step 5 |
| PERM-12 | Sole-owner group deletion lock-out (post-MVP) | Group deletion blocked if it is the sole Owner of any entity | `apps/services/api/**/__tests__/permissions-group.test.ts` (post-MVP) | V2 · ADR-003 §3.7 |

### 4.5 Origin Spoofing (bridge / extension — §6.2-C and §6.2-D)

Primary surface: extension background worker + content script + web-app bridge handler (ADR-005 §3–§6; SEC-001
Decision 9). Owning suites: `tests/security/bridge.test.ts`, `packages/shared/**/__tests__/*.test.ts` (envelope/type
guards), `apps/browser-firefox/src/background/**/*.test.ts`, `apps/browser-firefox/src/content/**/*.test.ts`,
`tests/e2e/extension/` (E2E-EXT-009/010).

| ID | Negative case | Expected safe failure | Owning test path | Vector / rule |
|---|---|---|---|---|
| ORG-01 | Bridge message from wrong web origin (attacker page) to background worker | Dropped silently; `sender.origin !== WEB_APP_ORIGIN` → no handler; rejected origin **not** logged | `apps/browser-firefox/src/background/**/origin*.test.ts` · `tests/security/bridge.test.ts` | V3 · Decision 9 · ADR-005 §3.1 |
| ORG-02 | Web app receives response from a non-`moz-extension://` source | Ignored; response `source` not the extension → dropped | `apps/web/src/**/__tests__/bridge*.test.ts(x)` | V3 · ADR-005 §3.2 |
| ORG-03 | Spoofed extension ID / wrong `moz-extension://` target for `postMessage` send | Web app sends only to the configured extension ID; no wildcard `window` broadcast | `apps/web/src/**/__tests__/bridge*.test.ts(x)` | V3 · ADR-005 §3.2 |
| ORG-04 | Content script (third-party page origin) sends message to background worker | Rejected — content-script origin is the page origin, not the web app | `apps/browser-firefox/src/background/**/origin*.test.ts` | V3 · ADR-005 §3.4 |
| ORG-05 | Unknown `type` in bridge envelope | Dropped silently; no log of the unknown type | `packages/shared/**/__tests__/envelope.test.ts` · `tests/security/bridge.test.ts` | V3 · ADR-005 §2.3 |
| ORG-06 | Malformed envelope / missing field / wrong types | Dropped silently (or typed guard rejects); no crash, no leak | `packages/shared/**/__tests__/envelope.test.ts` · `tests/security/bridge.test.ts` | V3 · ADR-005 §2.1 |
| ORG-07 | Extra/unexpected field in payload | Rejected or ignored by strict type guard; no field forwarded | `packages/shared/**/__tests__/envelope.test.ts` | V3 |
| ORG-08 | Oversized bridge payload | Dropped/rejected before processing (size cap) | `tests/security/bridge.test.ts` | V3 |
| ORG-09 | Replayed message (duplicate `LOCK_STATE_CHANGED` / stale `ts`) | Idempotent handling; stale lock-state does not desync or unlock | `tests/security/bridge.test.ts` · `apps/browser-firefox/src/background/**/lock*.test.ts` | V3 · Decision 9 |
| ORG-10 | Secret-bearing payload — bridge message carrying master password / vault key / ciphertext | Never occurs; static scan of message-construction + runtime assertion both reject | `tests/security/bridge.test.ts` · `apps/web/src/**/__tests__/bridge*.test.ts(x)` | V3 · AR-2 · ADR-005 §6 |
| ORG-11 | Content-script message carrying full secret object (notes/custom fields) | Content script receives only `{username, password}` — never the full secret | `apps/browser-firefox/src/content/**/*.test.ts` · `tests/security/bridge.test.ts` | V3 · ADR-005 §5.3 |
| ORG-12 | Autofill without explicit user action / on page load / on non-login form | No fill occurs; fill requires icon click + credential selection | `tests/e2e/extension/` (E2E-EXT-006/009) · `apps/browser-firefox/src/content/**/detect*.test.ts` | V3 · ADR-005 §5.3 |
| ORG-13 | Vault key present in `storage.local` or reaching a content script | Vault key never persisted; content script never sees it | `apps/browser-firefox/src/background/**/vaultkey*.test.ts` · `tests/security/vectors/` (V5) | V3/V5 · BR-002e |
| ORG-14 | Extension manifest gains `<all_urls>` or extra permission without ADR update | Permission diff test fails if manifest permissions diverge from ADR-005 §4.1 | `pnpm lint` / `web-ext lint` (manifest diff) — wired by QA-001b | V3 · ADR-005 §4.1 |
| ORG-15 | CSP violation — inline script / eval in web app or extension | CSP `script-src 'self'; object-src 'none'` blocks; no inline/eval | `tests/e2e/web/` · `apps/web/**` CSP header test | V3 · SEC-001 V3 control |

---

## 5. Supplementary Categories (TEST_STRATEGY §6.2 D/E/F completeness)

These complete the §6.2 enumeration. Items already fully covered by a §4 row are not repeated; only the residual cases
are listed here.

### 5.1 Web UI abuse (§6.2-E)

| ID | Negative case | Expected safe failure | Owning test path | Vector / rule |
|---|---|---|---|---|
| WEB-01 | XSS payload in every free-text field (name, username, uri, description, tag, folder) | Input sanitized / React-escaped; payload rendered inert; no script execution | `apps/web/src/**/__tests__/sanitize*.test.ts(x)` · `tests/e2e/web/` | V3 · V4 |
| WEB-02 | Deep-link to a protected route while locked | Redirected to unlock; target preserved; no content flash before redirect | `tests/e2e/web/` (E2E-WEB-010) | V5 |
| WEB-03 | Action submitted while API down / timeout | No partial state written; error surfaced; no plaintext left in state | `apps/web/src/**/__tests__/state*.test.ts(x)` | V5 · general |
| WEB-04 | Lock during an in-flight request | No plaintext left in React state after lock; in-flight response discarded | `apps/web/src/**/__tests__/lock*.test.ts(x)` | V5 · Decision 6 |
| WEB-05 | Back/forward navigation after lock | Returning to a protected page re-checks lock state; no stale plaintext rendered | `tests/e2e/web/` | V5 |

### 5.2 Extension runtime (§6.2-D) — residuals not already in §4.5

| ID | Negative case | Expected safe failure | Owning test path | Vector / rule |
|---|---|---|---|---|
| EXT-01 | No fill on pages without a detectable login form (e.g. signup, search) | Content script does not fill; requires explicit, separate user action | `apps/browser-firefox/src/content/**/detect*.test.ts` | V3 · ADR-005 §5.3 |
| EXT-02 | Extension cannot fetch from a non-API domain (no `<all_urls>`) | Network call to non-API origin blocked by manifest permission | `tests/e2e/extension/` (E2E-EXT-010) | V3 · ADR-005 §4.1 |

### 5.3 Migration / Backup corruption (§6.2-F, AR-5)

| ID | Negative case | Expected safe failure | Owning test path | Vector / rule |
|---|---|---|---|---|
| MIG-01 | Migration fails partway (up script interrupted) | Rollback leaves prior data readable; no data loss; re-runnable | `apps/services/api/**/__tests__/migration/*.test.ts` | V7 · AR-5 |
| MIG-02 | Down-script restores previous schema/format | Up→verify→down→verify cycle passes; data preserved | `apps/services/api/**/__tests__/migration/*.test.ts` | V7 · AR-5 |
| MIG-03 | Corrupted backup archive | Integrity check (AEAD tag / HMAC+hash) fails closed; restore refused | `tests/security/vectors/` (V7) · `packages/crypto/**/__tests__/backup*.test.ts` | V7 · Decision 8 |
| MIG-04 | Backup version-tag mismatch | Clear, non-destructive error; no attempt to restore incompatible format | `packages/crypto/**/__tests__/version.test.ts` | V7 · Decision 8 |
| MIG-05 | In-place destructive re-encryption (KDF/param change) | Old ciphertext retained until new encrypt verified; no destructive overwrite | `apps/services/api/**/__tests__/migration/*.test.ts` | V7 · AR-5 · Decision 3 |

---

## 6. Traceability Matrix

### 6.1 Acceptance-criteria coverage

| Required theme | §4 section | Case IDs | Count |
|---|---|---|---|
| Tampered ciphertext | §4.1 | CRY-01 … CRY-10 | 10 |
| Auth abuse | §4.2 | AUTH-01 … AUTH-16 | 16 |
| Leakage vectors | §4.3 | LEAK-01 … LEAK-11 | 11 |
| Permission bypass | §4.4 | PERM-01 … PERM-12 | 12 |
| Origin spoofing | §4.5 | ORG-01 … ORG-15 | 15 |

### 6.2 TEST_STRATEGY §6.2 category coverage

| §6.2 category | Where enumerated | Case IDs |
|---|---|---|
| A. Crypto (AR-3) | §4.1 | CRY-01 … CRY-10 |
| B. API | §4.2 (auth) + §4.4 (authz) + §4.3 (leakage/URLs) | AUTH-*, PERM-*, LEAK-04/05/06 |
| C. Bridge | §4.5 | ORG-01 … ORG-11 |
| D. Extension runtime | §4.5 (ORG-12…15) + §5.2 | ORG-12…15, EXT-01/02 |
| E. Web UI | §5.1 | WEB-01 … WEB-05 |
| F. Migration/backup | §5.3 | MIG-01 … MIG-05 |

### 6.3 SEC-001 vector coverage

Every vector V1–V7 is defended by at least one case above (V1: CRY-*, LEAK-10; V2: AUTH-*, PERM-*; V3: ORG-*, WEB-01,
EXT-*; V4: LEAK-*; V5: AUTH-06/13/14, LEAK-07, ORG-13, WEB-02/03/04/05; V6: (recovery — see §7 note); V7: MIG-*, CRY-07).
Vector V6 (forgotten master password) is a *recovery* concern, not a tamper/auth bypass; its negative test (reset is
impossible without recovery material) is owned by the recovery-kit task and listed in `TEST_STRATEGY.md` §3.3.3 V6 —
tracked here as an open dependency, not a missing §4 row.

---

## 7. Delivery and Verification Rules

1. **This artifact is `meta, security`.** The evidence for the card is (a) this checklist, and (b) the mechanical
   self-validation in §8 proving the five themes and all §6.2 categories are enumerated with owning test paths.
2. **Negative tests are part of the PR that introduces the behavior** (TEST_STRATEGY §6.3) — never deferred. Each
   implementing card is reviewed against this checklist: for every endpoint/message type, the count of negative cases
   must be ≥ the count of documented failure modes (§6.2).
3. **Crypto/bridge/auth cards** additionally require AR-6 explicit Architect + QA sign-off (TEST_STRATEGY §12.1).
4. **Synthetic data only (AR-4).** Every test case above must use synthetic fixtures (`example.test` domains, per-run
   generated secrets); no real credential, key, or domain anywhere.
5. **Verdict vocabulary** (§12): a card whose negative cases are missing is returned `fail` with the missing case IDs,
   never `pass`.

---

## 8. Self-Validation (QA-001f evidence)

The checklist is validated mechanically with `scripts/qa/validate-checklist.mjs` (see `tests/evidence/t_11c01f92/`):

```
node scripts/qa/validate-checklist.mjs tests/security/NEGATIVE_TEST_CHECKLIST.md
```

The validator asserts: (1) all five acceptance-criteria themes are present as sections, (2) every §6.2 A–F category is
covered by at least one case ID, (3) every case row has a non-empty owning test path, (4) no forbidden real-looking
secret/domain appears in the document (AR-4 self-check), and (5) the document references SEC-001 V1–V7 and AR-1–AR-6.

---

## 9. Known Inconsistencies / Open Items (carried forward)

| # | Item | Source | Owner |
|---|---|---|---|
| 1 | Crypto package path: `packages/crypto/` used here (ADR wins until amended). | `PROJECT_BRIEF.md` §9 says `packages/shared/crypto/`; ADR-002/ADR-005 say `packages/crypto/` | Architect (TEST_STRATEGY §15.1) |
| 2 | Bridge review gate: AR-6 does not cover `packages/shared/` bridge-message changes (§4.5 ORG-05…11 live there). | ADR-005 §9.2 | Architect (TEST_STRATEGY §15.4) |
| 3 | `WEB_APP_ORIGIN` / extension-ID config — needed before ORG-01/03 E2E can assert exact origins. | ADR-005 §10 Q1–2 | BR-001f (TEST_STRATEGY §15.6) |
| 4 | Fallback `SameSite=Strict` cookie contract — needed for the cookie-path negative test. | ADR-005 §10 Q5 | BR-002a (TEST_STRATEGY §15.5) |
| 5 | Client- vs. server-side decryption — affects where CRY-* negative tests live for API-only clients. | ADR-002 §4.2 / Q3 | BE-002a (TEST_STRATEGY §15.7) |
| 6 | Rate limiting (AUTH-16) — not in ADR-004 auth endpoints; marked conditional. | ADR-004 `/auth/login` | Architect (V1 scope decision) |

---

## 10. References

- `TEST_STRATEGY.md` §6 (negative-test requirements), §8 (test organization), §3.3 (security tests)
- `architecture/adr/SEC-001-threat-model.md` — vectors V1–V7, crypto decisions 1–9, **Absolute Rules AR-1…AR-6**
- `architecture/adr/ADR-002-overall-architecture.md` — boundaries, `packages/crypto/` isolation, auth flow
- `architecture/adr/ADR-003-data-model.md` — ownership, permission levels, centralized authorization
- `architecture/adr/ADR-004-api-contract.yaml` — auth endpoints, error envelope, status codes
- `architecture/adr/ADR-005-extension-bridge-protocol.md` — message types, origin validation, autofill constraints
- `architecture/kanban/backlog.md` — QA-001f acceptance criteria
- `PROJECT_BRIEF.md` — scope, ratified decisions

---

## 11. Changelog

| Date | Change | Author |
|---|---|---|
| 2026-09-17 | Initial checklist: 5 mandated themes + §6.2 A–F, owning test paths, SEC-001 traceability | QA (QA-001f) |

---

## 12. Review and Sign-off

| Role | Name | Date | Signature |
|---|---|---|---|
| QA | `qa` profile | 2026-09-17 | Drafted — self-validated (evidence in `tests/evidence/t_11c01f92/`) |
| Architect | (pending) | | |

**Next steps:** Architect review; QA-001h consumes this artifact to enforce the sign-off gate; implementing cards
(BE-002*, BE-003*, BR-001f/002*, FE-*) are reviewed against §4/§5 case IDs.
