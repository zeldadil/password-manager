# SEC-001: Threat Model + Security Gate

**Status:** Signed (Architect) — Pending QA sign-off  
**Date:** 2026-09-16  
**Author:** Architect  
**Decision-Makers:** Architect + QA  
**References:** PROJECT_BRIEF.md, ADR-001, backlog.md  

---

## Purpose

This document is the **security gate** for the Secure Password Manager project. No secret-storage, cryptographic, or browser-bridge code may be written until this document is signed off by Architect + QA. It establishes:

1. A threat model covering 7 minimum attack vectors
2. 9 mandatory cryptographic decisions with rationale
3. Absolute security rules that all implementors must follow
4. The dependency graph that blocks downstream tasks until this gate is closed

---

## Scope

The password manager stores user secrets: master password, vault contents (resource secrets, TOTP seeds), session tokens. It runs as a self-hosted TypeScript/Node API + React Web UI + Firefox WebExtension (MV3). The threat model assumes:

- **Zero-knowledge architecture:** the server never sees plaintext secrets or the master password
- **Self-hosted:** the operator controls the deployment environment (not a SaaS provider)
- **Single-user primary use case** with multi-user sharing deferred to Phase 4

---

## Part 1: Threat Model — 7 Minimum Vectors

### Vector 1: Local File / Backup Access

**Scenario:** An attacker gains read access to the server's filesystem — either the live vault database, a backup archive, or a developer's exported data file.

**Assets at risk:** Encrypted vault ciphertext, KDF salt, encrypted vault key material, session tokens, refresh tokens.

**Attack surface:**
- Database files (SQLite/Postgres) readable by unauthorized OS users or compromised processes
- Backup archives (tar, dump files) stored on disk or in object storage with weak permissions
- Developer machines with vault exports or local dev database files
- Log files that may contain ciphertext fragments or metadata

**Current controls (to be implemented):**
- Database file permissions restricted to the API process user only
- Backups encrypted with a separate backup key (see Crypto Decision 8)
- No plaintext secrets in any file on disk — only AEAD ciphertext
- Secret scanning in CI prevents accidental commit of real secrets (BE-001f)
- Logs must never contain ciphertext, keys, salts, or tokens (see Vector 4)

**Residual risk:** If the attacker also obtains the master password (e.g., from a keylogger on the admin machine), the vault is compromised. This is accepted — the threat model assumes the master password is the root secret and its compromise is out of scope for server-side controls.

---

### Vector 2: Partial API Compromise

**Scenario:** An attacker compromises a subset of API endpoints — e.g., through an RCE in a dependency, a misconfigured route, or a SQL injection in a non-critical query — but does not gain full server control or access to the crypto module.

**Assets at risk:** Any data served by the compromised endpoints: resource metadata, vault structure, user accounts, folder/tag organization.

**Attack surface:**
- Metadata endpoints (`GET /resources`, `GET /folders`, `GET /tags`) return plaintext metadata — an attacker learning resource names, usernames, URIs is a privacy leak but not a secret compromise (metadata may be encrypted per-resource; see ADR-003)
- Permission-enforcement bugs could allow a user to read another user's metadata
- Session token theft via XSS in the Web UI (see Vector 3)

**Current controls:**
- All endpoints hardened: parameterized queries, input validation, no raw SQL
- Metadata encryption opt-in from V1 (ADR-001) — reduces exposure even if endpoints are read
- Permission enforcement middleware on every access (BE-003f)
- Short-lived JWT (15m) + refresh token rotation limits session token usefulness
- Error handler strips stack traces in production (BE-001f)

**Residual risk:** A full server compromise (attacker reads process memory, environment variables, and all files) defeats the zero-knowledge model. This is an accepted residual risk for self-hosted deployments — the operator is responsible for server hardening. The crypto boundary assumes the API process is trusted for metadata but untrusted for secrets.

---

### Vector 3: Hostile Browser Extension / Malicious Web Page

**Scenario:** A malicious browser extension (installed by the user or through a supply-chain attack) or a malicious web page (XSS on the self-hosted domain, or a phishing page) attempts to steal the vault session, captured credentials, or the vault key.

**Assets at risk:** Vault unlock state, session cookie, in-memory vault key (in extension background worker), autofill payload (username + password sent to content script).

**Attack surface:**
- **Malicious extension:** Could read `storage.local`, intercept `runtime messages`, or scrape the DOM after autofill
- **Malicious web page:** Could inject scripts via XSS on the self-hosted domain, read cookies (if not SameSite/Secure/HttpOnly), or social-engineer the user into revealing the master password
- **Content script abuse:** If the extension's content script is tricked into running on an attacker-controlled page, it could exfiltrate form data

**Current controls (per ADR-001 Section 6 and BR-002):**
- Extension permissions: minimal — `activeTab`, `scripting`, `storage`, plus API-domain host permission only
- CSP: `script-src 'self'; object-src 'none';` — no inline scripts, no eval (BR-001a)
- Origin validation: background worker only accepts messages from `moz-extension://<this-extension>` and the API domain (BR-001f, BR-002d)
- Autofill is **explicit-user-action only** — no automatic fill (ADR-001 Section 6)
- Content scripts have no crypto — they only detect forms and relay messages (BR-002c)
- Vault key held in memory only in the background worker — never persisted to `storage.local` or `localStorage` (BR-002e)
- Session cookie: `SameSite=Strict`, `Secure`, `HttpOnly` where applicable
- Web app: input sanitization, CSP headers, no `document.write`, framework-chosen XSS defenses (React)

**Residual risk:**
- A malicious extension with broad host permissions (`<all_urls>`) could theoretically scrape the DOM after autofill. Mitigated by user education: only install extensions from trusted sources, and the password manager extension itself uses minimal permissions.
- XSS on the self-hosted Web UI could steal the session cookie if the operator misconfigures cookie attributes. Mitigated by Secure/HttpOnly/SameSite defaults.
- The extension popup and content scripts are JavaScript contexts that a determined attacker with code-injection capability could compromise — but they have no direct access to the vault key (which lives in the background worker).

---

### Vector 4: Leakage via Logs / Errors / URLs / Telemetry

**Scenario:** Sensitive data leaks through application logs, error messages, URL query parameters, or telemetry/reporting endpoints.

**Assets at risk:** Master password (if logged at auth time), vault key material, session tokens, resource secrets (if an error path accidentally serializes decrypted data), PII from metadata.

**Attack surface:**
- **Logging:** A `console.log` or structured logger accidentally serializing a request object that contains the master password, vault key, or decrypted secret
- **Error messages:** A 500 error returning a stack trace or internal state that includes secret material (BE-001f must prevent this)
- **URLs:** Master password or tokens passed as query parameters (should never happen — use POST body)
- **Telemetry:** If the app sends usage data, it must not include any secret material or identifiable metadata that could reconstruct the vault contents

**Current controls:**
- **Absolute rule:** No real secrets anywhere — logs, errors, URLs, telemetry, environment variables, comments (see Absolute Rules below)
- Error handler strips stack traces in production (BE-001f)
- All auth endpoints use POST with body — no query parameters for secrets
- Structured logging with redaction: any field named `password`, `secret`, `token`, `key`, `salt`, `iv`, `tag`, `ciphertext` must be redacted or omitted
- No third-party telemetry in MVP — no analytics SDKs, no beacon endpoints
- CI secret scanning (gitleaks/truffleHog) fails on any real secret committed to repo (BE-001f)

**Residual risk:** A developer accidentally adding a `console.log(vaultKey)` in a dev build that ships to production. Mitigated by: (a) lint rules banning `console.log` in production code paths, (b) CI secret scanning, (c) code review requirement for any crypto-module change.

---

### Vector 5: Stolen Device / Unlocked Session

**Scenario:** An attacker physically steals the user's device (laptop, phone) while the vault is unlocked, or gains access to a device with an active session.

**Assets at risk:** The decrypted vault in browser memory (React state, JavaScript heap), session tokens in cookies/storage, the extension's in-memory vault key, any data displayed on screen.

**Attack surface:**
- Device theft while session is active: attacker opens browser, sees vault
- Physical access to unlocked device: attacker uses developer tools to inspect memory, localStorage, or cookies
- Unattended device with unlocked vault: anyone with physical access gets the data

**Current controls:**
- Auto-lock: configurable timeout (default 15m inactivity), enforced via JWT expiry + refresh rotation (BE-002d)
- Lock button in UI: user can manually lock at any time (FE-002c)
- Vault key cleared from extension memory on lock, browser sleep, extension reload (BR-002e)
- Session cookie: `SameSite=Strict`, `Secure`, `HttpOnly`
- No plaintext secrets persisted to `localStorage` or `IndexedDB` — only ciphertext (FE-003i)
- OS-level full-disk encryption (user responsibility, not app-level control)

**Residual risk:** Physical access to an unlocked device for a sufficient window defeats any software control. Mitigated by: short auto-lock timeout, manual lock, user education about locking when stepping away. The app cannot prevent an attacker with physical access from reading the screen or using the unlocked session while it's active.

---

### Vector 6: Forgotten Master Password

**Scenario:** The user forgets their master password. Because the vault is zero-knowledge (server has no recovery mechanism), the user loses access to all vault data permanently.

**Assets at risk:** All vault data — effectively a denial-of-service to the user.

**Attack surface:** This is not an attack by an adversary — it's a usability/recovery failure mode. The threat is **data loss**, not confidentiality breach.

**Current controls:**
- **No server-side recovery:** The server cannot reset the master password because it does not store it or any derivable material that allows password reset without vault loss (ADR-001: server-side keyring recovery explicitly rejected)
- **Recovery kit (planned):** User-generated backup kit — a printable/downloadable recovery code or key file that can unlock the vault without the master password. Storage and format per Crypto Decision 7. Not in MVP scope — must be designed before V1 ships.
- **Warning at registration:** UI warns the user that losing the master password means losing the vault (no recovery available)

**Residual risk:** **High — this is the single biggest user-facing risk.** If no recovery mechanism is built before V1 ships, any user who forgets their password loses everything. This must be tracked as a blocking deliverable before V1 launch. Acceptable for MVP if the warning is prominent and the recovery kit is designed (even if implementation is post-MVP).

---

### Vector 7: Corrupted Backup / Failed Migration

**Scenario:** A backup becomes corrupted, or a migration (schema upgrade, vault format change, key rotation) fails partway through, leaving the vault in an unreadable state.

**Assets at risk:** All vault data — denial-of-service via data corruption or migration failure.

**Attack surface:**
- Backup file corruption (bit rot, incomplete write, storage media failure)
- Backup encryption key lost separately from the master password
- Migration that encrypts/overwrites data without a rollback path
- Vault format version mismatch after an upgrade

**Current controls:**
- **Backup strategy (per Crypto Decision 8):** Encrypted backups with a separate backup key, stored independently of the live system
- **Migration strategy (per Absolute Rules):** Every schema/data migration must have a documented rollback plan; migrations are tested with up/down scripts (BE-001a)
- **Version tagging:** Vault format versions tagged so that older clients can still read their data (or a migration path is documented)
- **Backup integrity verification:** Checksum/hash of backup file stored alongside it; restore tested periodically (operational, not code-level)
- **No in-place destructive updates:** Crypto operations produce new ciphertext; old ciphertext is only removed after successful write + verification

**Residual risk:** A catastrophic storage failure (e.g., entire disk loss with no backup) is out of scope — the operator is responsible for backup infrastructure. The app must make backup possible (export encrypted vault) but cannot guarantee the operator backs up.

---

## Part 2: Mandatory Cryptographic Decisions (9)

**Rule:** Every decision below uses established, peer-reviewed constructions from well-audited libraries. **No home-grown crypto.** The implementor's job is to choose parameters and wire the library correctly, not to design constructions.

---

### Decision 1: Key Derivation Function (KDF)

**Decision:** Argon2id with per-user random salt.

**Parameters (to be finalized with QA):**
- Memory: 64 MB (tunable based on security vs. UX trade-off — higher = slower brute-force but slower unlock)
- Iterations: 3
- Parallelism: 4 (match server CPU cores; client-side should match device capability)
- Output length: 32 bytes (256 bits) — sufficient for AES-256

**Rationale:**
- Argon2id is the current OWASP-recommended KDF for password hashing (as of 2025+). It resists GPU/ASIC brute-force via memory hardness and resists side-channel attacks via the "id" hybrid mode.
- Per-user random salt (16+ bytes, cryptographically random) prevents rainbow-table and batch attacks.
- Output length of 32 bytes matches AES-256 key size — no truncation needed.
- Scrypt and bcrypt are acceptable fallbacks if Argon2id is unavailable in a target runtime, but Argon2id is preferred.

**Libraries:** `libsodium` (via `argon2` binding) or Node's built-in `crypto` with Argon2 support if available. Must use a well-maintained, audited binding — not a JavaScript re-implementation of Argon2.

**References:** OWASP Password Storage Cheat Sheet, PHC (Password Hashing Competition) winner.

---

### Decision 2: Authenticated Encryption (AEAD)

**Decision:** AES-256-GCM (Galois/Counter Mode).

**Parameters:**
- Key: 256-bit vault key (derived from master password via KDF)
- Nonce: 12 bytes (96 bits), cryptographically random per encryption operation (see Decision 4)
- Tag: 16 bytes (128 bits) — GCM authentication tag, appended to ciphertext

**Rationale:**
- AES-GCM is widely deployed, hardware-accelerated on modern CPUs (AES-NI), and provides both confidentiality and integrity in a single pass.
- 256-bit key provides a safety margin beyond the 128-bit security level that AES-128 offers — appropriate for a password manager where the cost of compromise is total credential loss.
- GCM's authentication tag provides integrity verification: any tampering with ciphertext or tag is detected on decryption (see Decision 5).
- AES-256-GCM is available in Node.js `crypto` (Web Crypto API in the browser/extension) — no external library needed.

**Alternatives considered:**
- ChaCha20-Poly1305: also a valid AEAD construction, equally secure, often faster in software without AES hardware. Acceptable fallback if GCM is unavailable. GCM preferred for hardware acceleration on server-side Node.js.
- AES-CBC + HMAC-SHA256 (Encrypt-then-MAC): valid but more complex to implement correctly (two passes, separate nonce and MAC key management). GCM is simpler and less error-prone.

**References:** NIST SP 800-38D, OWASP Cryptographic Storage Cheat Sheet.

---

### Decision 3: Key Hierarchy and Storage

**Decision:** Two-key hierarchy — Master Password → (KDF) → Vault Key → (AEAD) → Vault Data. The vault key is never stored plaintext; it is encrypted with a key derived from the master password and stored as `{ kdfParams, salt, ciphertext, iv, tag }`.

**Rationale:**
- **Vault key** is a 256-bit symmetric key used to encrypt/decrypt all vault data (resources, folders, tags, metadata). It is derived once at registration and re-derived on each unlock.
- The vault key itself must be stored so the server can persist it across sessions — but it must be encrypted, because the server should not be able to decrypt it without the master password.
- **Vault key encryption:** The vault key is encrypted using a key derived from the master password (the same KDF output, or a sub-key via a KDF with a different info string). The encrypted vault key, plus the salt and KDF parameters, is stored in the user record.
- On unlock: the client sends the master password → server runs KDF → decrypts vault key → vault key is held in server memory (process memory only, never persisted) for the session duration.
- This matches the Passbolt-inspired auth flow (ADR-001 Section 7) but uses symmetric KDF instead of OpenPGP.

**Storage schema (per BE-002a):**
```
user {
  id: UUID,
  kdfParams: { algorithm: "argon2id", memory: 64*, iterations: 3, parallelism: 4, hashLength: 32, salt: <base64> },
  vaultKeyEncrypted: <base64>,  // AES-256-GCM ciphertext of the vault key
  iv: <base64>,                  // nonce used to encrypt vault key
  tag: <base64>,                 // GCM auth tag
  ...
}
```

**Key rotation:** If KDF parameters are upgraded (e.g., memory increased), the vault key must be re-encrypted with the new KDF output. This is a migration (see Vector 7) — old ciphertext is retained until new encrypt is verified.

---

### Decision 4: Nonce / IV Handling

**Decision:** 12-byte cryptographically random nonce per encryption operation, generated by the AEAD library's CSPRNG. Nonce is stored alongside ciphertext (it is not secret).

**Rationale:**
- AES-GCM requires a unique nonce per encryption with the same key. A random 96-bit nonce has a negligible collision probability for the expected volume of vault operations (birthday bound at ~2^48 operations — far beyond any realistic vault size).
- The nonce must be stored with the ciphertext so decryption can recover it. It is not secret — exposing the nonce does not compromise confidentiality or integrity (as long as it is never reused with the same key).
- **Never** use a counter-based or deterministic nonce unless the implementation can guarantee no gaps or duplication across process restarts. Random nonce is simpler and safer.
- **Never** derive the nonce from the plaintext or any predictable input.
- The `crypto` library's `randomBytes(12)` or Web Crypto's `getRandomValues(new Uint8Array(12))` must be used — never `Math.random()`.

**Nonce reuse detection:** If the same nonce+ciphertext pair is ever seen twice for the same key, it is a critical security event (nonce reuse in GCM completely breaks security). Implementors must log and alert on any nonce collision detected during decryption.

---

### Decision 5: Integrity Verification

**Decision:** AES-GCM authentication tag (16 bytes) verified on every decryption. No separate HMAC.

**Rationale:**
- GCM's built-in authentication tag provides integrity and authenticity in one operation. The tag is computed over the ciphertext + additional authenticated data (AAD).
- On decryption, the tag is verified before any plaintext is returned. If the tag does not verify, decryption fails — the ciphertext is treated as tampered and the operation is rejected.
- AAD (Additional Authenticated Data): Use AAD to bind the ciphertext to contextual metadata that should not be tampered with — e.g., the resource ID, the user ID, or a version field. This prevents an attacker from copy-pasting ciphertext from one resource to another.
- **No plaintext output on failure:** If the tag does not verify, the function must return an error and must not leak any partial plaintext or timing information that could aid an attacker.

**Error handling on integrity failure:**
- Decryption failure (bad tag, corrupted ciphertext) returns a generic error — "decryption failed" — not a detailed cryptographic error.
- The event may be logged (as a security event, not with secret material) for monitoring.

---

### Decision 6: Lock / Unlock Lifecycle

**Decision:** Unlock derives the vault key in memory; lock clears it. No persistent unreadable-opaque blob that the server can use without the master password.

**Flow:**
1. **Registration:** Master password → KDF → vault key → encrypt empty vault → store `{ kdfParams, salt, vaultKeyEncrypted, iv, tag }`
2. **Unlock (login):** Client sends master password → server runs KDF (same params, same salt) → decrypts vault key → vault key held in server process memory → returns JWT + refresh token
3. **Session:** Vault key in server memory. API endpoints that serve encrypted vault data return ciphertext; client decrypts with vault key (for browser) or server decrypts for API clients that hold the key (TBD for Phase 2+).
4. **Lock:** `POST /auth/lock` → vault key cleared from server memory → JWT revoked → session terminated
5. **Auto-lock:** JWT expiry (15m) + refresh token rotation enforces re-authentication; after refresh token expiry (30d), user must re-enter master password.

**Server memory handling:**
- Vault key is held in a single variable/reference in the server process, not in a shared cache, not in a database, not in logs.
- On process restart, vault key is lost — user must re-unlock. This is acceptable behavior (not a bug).
- On lock, the variable is set to `null`/cleared; the JavaScript garbage collector reclaims the memory (no secure memory-zeroing guarantee in JS runtimes — accepted limitation).

**Concurrent sessions:** Each session holds its own vault key in memory. Locking one session does not lock others (by design — user may have the web app and extension both active). Each session independently auto-locks.

---

### Decision 7: Recovery Mechanism

**Decision:** Recovery kit — a user-generated, downloadable/printable secret (recovery key or recovery code) that can unlock the vault without the master password. Not in MVP code scope, but the architecture must support it.

**Architecture requirement:**
- The vault key must be wrap-able with a separate recovery key (a second AEAD encryption of the vault key under the recovery key).
- The recovery key is generated by the client (CSPRNG), shown once to the user, and never stored on the server.
- The encrypted recovery-wrapped vault key is stored on the server (encrypted under the recovery key, which only the user has).
- On recovery: user provides recovery key → server decrypts the recovery-wrapped vault key → vault key recovered → vault unlocked.

**Rationale:**
- This is the only recovery path that preserves zero-knowledge: the server never sees the recovery key or the plaintext vault key during recovery.
- Without this, a forgotten master password is a permanent data loss event (Vector 6).
- The recovery key must be generated with a CSPRNG, must be high-entropy (at least 128 bits), and must be presented to the user in a way that is copyable/printable (e.g., a base64 string or a BIP39-style mnemonic).

**MVP scope:** The recovery kit architecture must be designed and documented before V1 ships, but the UI for generating/storing/using it may be post-MVP. The crypto primitives (AEAD encryption of vault key under a second key) must be in place from the start so the feature can be added without a vault format change.

---

### Decision 8: Backup Strategy

**Decision:** Encrypted backup of the vault, produced client-side (or server-side using the vault key), with a separate backup key or the vault key itself, stored independently of the live system.

**Architecture requirement:**
- The vault (all ciphertext + metadata) must be exportable in a single encrypted archive.
- The backup archive is encrypted with the vault key (same AEAD construction) or a separate backup key derived from the master password + a different KDF info string.
- The backup file must include its own integrity check (AEAD tag or a separate HMAC + hash) so that corruption is detectable before restore.
- Backup format version must be tagged so that future versions can read old backups.

**Storage:** Backup is stored by the operator (not the app) — on a separate disk, in object storage, or downloaded by the user. The app provides the export function; the operator is responsible for backup infrastructure.

**Rationale:**
- Zero-knowledge means the server cannot back up the vault in any usable form without the vault key.
- A backup encrypted with the vault key is useless without the master password (which derives the vault key) — this is correct: the backup inherits the same security properties as the live vault.
- Separate backup key vs. vault key: Using the vault key is simpler and sufficient for MVP. A separate backup key adds defense-in-depth (compromise of one does not compromise the other) but adds complexity. For MVP, vault key is acceptable; separate backup key is a future enhancement.

---

### Decision 9: Browser Extension Bridge Security

**Decision:** The extension ↔ web app bridge uses postMessage with strict origin validation (or SameSite=Strict cookie as a fallback for lock-state sync). No cryptographic operations in the extension; vault key held in extension background worker memory only, never in storage or content scripts.

**Rationale:**
- **Origin validation:** The web app and extension communicate via `postMessage`. The extension must verify that the message origin is exactly the web app's origin (e.g., `https://vault.example.com`). The web app must verify that the message comes from the extension (via `moz-extension://` URL or a shared secret token exchanged at install time).
- **Lock-state sync:** The extension needs to know whether the vault is locked to decide whether to allow autofill/search. This can be done via:
  - `postMessage` from web app to extension when lock state changes, OR
  - A `SameSite=Strict` cookie set by the web app that the extension can read via `browser.cookies` API — but this is less secure (cookie is readable by any extension with cookie permission)
  - **Preferred:** `postMessage` with origin check. Cookie fallback only if messaging is unavailable.
- **No crypto in extension:** The extension does not perform KDF, AEAD, or any cryptographic operation. It receives the vault key (in memory, background worker only) from the web app via a secure channel after unlock, or it fetches encrypted data from the API and the web app decrypts it. The extension's role is orchestration (form detection, autofill trigger, UI) — not cryptography.
- **Vault key in extension memory:** If the extension holds the vault key (for offline autofill when the web app is not open), it is held in the background worker's JavaScript heap, never in `chrome.storage.local`, `localStorage`, or any persistent store. On lock, extension reload, or browser sleep, the key is cleared.

**Threat scenarios addressed:**
- Malicious content script on a third-party page cannot access the vault key (it's in the background worker, not the content script)
- Malicious extension cannot access the vault key (it's in this extension's background worker, isolated by the browser's extension sandbox)
- Web page XSS cannot access the extension's background worker (same-origin policy + extension isolation)

---

## Part 3: Absolute Rules

These rules are non-negotiable. Any proposed change that violates them must be rejected, documented, and re-assessed. They apply to all implementors (backend, frontend, browser, QA).

### AR-1: No Home-Grown Crypto

- Do not implement your own KDF, AEAD, RNG, MAC, key derivation, or padding scheme.
- Use only well-audited, mainstream libraries: Node.js `crypto` (Web Crypto API in browser), `libsodium`, or equivalent.
- If a construction is not available in a mainstream library, do not build it — redesign the feature to use what is available.
- **Exception:** glue code that wires library calls together is acceptable. The cryptographic construction itself must come from the library.

### AR-2: No Real Secrets Anywhere

- No real master passwords, vault keys, salts, IVs, tokens, passwords, or resource secrets in:
  - Source code (including comments)
  - Test files (use synthetic fixtures only — see AR-4)
  - Log files (redacted or omitted)
  - Error messages or stack traces
  - URL query parameters or path segments
  - Environment variables in deployed environments (dev may use fake values)
  - Configuration files committed to the repo
  - Database records (only ciphertext)
  - Telemetry, analytics, or reporting payloads
- **CI secret scanning** (gitleaks/truffleHog) must pass on every commit — any real secret committed is a build failure.
- If a real secret is accidentally committed, **rotate it immediately** (change the password, re-encrypt the vault key, revoke tokens) — do not just delete the commit.

### AR-3: Positive + Negative Tests per Crypto Change

- Every change to any crypto-path code (KDF parameters, AEAD algorithm, key handling, nonce generation, tag verification) must include:
  1. **Positive test:** Correct password / correct ciphertext → successful decryption, correct plaintext returned.
  2. **Negative test:** Wrong password / tampered ciphertext / wrong tag / wrong nonce / truncated ciphertext → decryption fails, no plaintext leaked, generic error returned.
- Negative tests must cover each failure mode explicitly. A single negative test with "some wrong input" is insufficient.
- These tests are part of the PR that changes the crypto code — they are not optional and not deferred.

### AR-4: Synthetic Fixtures Only

- All test data (fixtures, seeds, E2E data, mock responses) must be synthetic — generated by the test framework, not copied from a real vault.
- Synthetic data must not contain any real password, real URL, real username, real resource name that corresponds to a real service, or any real key material.
- Acceptable: "test-resource-1", "testuser", "https://example.test", generated random strings.
- Unacceptable: any string that is or could be a real credential, domain, or secret.

### AR-5: Migration and Rollback Strategy

- Every schema migration (DB table changes, vault format changes, key format changes) must have:
  1. An **up** script (apply the change)
  2. A **down** script (revert the change)
  3. A documented rollback plan: what happens to existing data if the migration fails partway through
- Migrations that touch encrypted data (re-encrypting vault key, changing KDF params, changing AEAD params) must:
  - Retain the old ciphertext until the new ciphertext is written and verified
  - Be re-runnable (idempotent) where possible
  - Be tested with a full up → verify → down cycle in CI
- No migration may destroy data without a documented recovery path.

### AR-6: Code Review for Crypto Changes

- Any change to code in the crypto boundary (KDF, AEAD, key handling, nonce, tag, lock/unlock, recovery, backup, bridge) requires **explicit sign-off from Architect + QA** before merge.
- This is in addition to the normal PR review — it is a security review gate, not a style or correctness review.
- The reviewer must verify: library choice, parameter choices, error handling, test coverage (AR-3), and adherence to absolute rules (AR-1–AR-5).

---

## Part 4: Dependency Graph — Gate Enforcement

The following tasks are blocked until SEC-001 is signed off (status = `done`). The dispatcher auto-promotes them when this task completes.

| Downstream Task | ID | Depends On | Why It's Blocked |
|---|---|---|---|
| ADR-002: Overall Architecture | t_3ca45da2 (ARC-001a) | SEC-001 | Architecture must reference crypto decisions |
| BE-002a: Registration + KDF + Vault Key Storage | t_16f8ad84 | SEC-001, BE-001h | KDF parameters come from Decision 1, vault key storage from Decision 3 |
| BE-003a: Vault Encryption | t_fe3b76ea | SEC-001, BE-002h | AEAD construction from Decision 2, key hierarchy from Decision 3 |
| BR-002a: Vault Session Sync | t_83dc1b35 | SEC-001, BR-001i | Bridge security from Decision 9 |
| DOC-001d: SECURITY.md | t_93cf5611 | SEC-001 | Doc summarizes this threat model |

**Note:** FE-002 and FE-003 are not directly gated by SEC-001 in the Kanban — they are gated by BE-002h and BE-003k respectively, which are themselves gated by SEC-001. The full chain is: SEC-001 → BE-002a → ... → BE-002h → FE-002a, and SEC-001 → BE-003a → ... → BE-003k → FE-003a. BR-003 is gated by BR-002h + BE-003k, same chain.

**BE-002b through BE-002h** (unlock, lock, session, wrong-password, tests) are gated by BE-002a, which is gated by SEC-001. **BE-003b through BE-003k** (resource CRUD, folders, tags, permissions, search, tests) are gated by BE-003a, which is gated by SEC-001.

---

## Part 5: Sign-off

| Role | Name | Date | Signature |
|---|---|---|---|
| Architect | Architect (Solar Pro4, Upstage) | 2026-09-16 | Signed — reviewed in full, confirms no secret-storage code may proceed until QA also signs |
| QA | (pending) | | |

**Architect sign-off rationale (summary):**

All 7 threat vectors match the project's actual attack surface (self-hosted, zero-knowledge, browser extension, single-user primary). All 9 crypto decisions use established peer-reviewed constructions from audited libraries (Argon2id, AES-256-GCM) — no home-grown crypto. The absolute rules (AR-1 through AR-6) are appropriate and non-negotiable for a product that stores user secrets. Residual risks are documented and accepted at the correct level (server-side compromise out of scope for zero-knowledge model; physical access to unlocked device accepted; forgotten master password is the single biggest user-facing risk and must be addressed by the recovery kit before V1 ships). The dependency graph correctly blocks all 5 downstream tasks.

**QA sign-off is still required.** Per the task body: "Signed off by Architect + QA (recorded in the document)". I am the Architect profile; the QA profile (`qa`) must also sign before this gate is fully closed and downstream tasks may start.

**Sign-off means:** The signatory has reviewed this document in full, agrees with the threat model vectors, crypto decisions, and absolute rules, and confirms that no secret-storage code may proceed until this sign-off is complete.

---

## Changelog

| Date | Change | Author |
|---|---|---|
| 2026-09-16 | Initial draft, Architect sign-off added | Architect |

---

*This document is the SEC-001 security gate deliverable. It must be committed to `architecture/adr/SEC-001-threat-model.md` and signed off before any downstream task is started.*
