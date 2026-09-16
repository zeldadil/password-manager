# ADR-002: Overall Architecture

**Status:** Proposed
**Date:** 2026-09-16
**Author:** Architect
**Decision-Makers:** Architect + QA
**References:** ADR-001 (functional patterns), SEC-001 (threat model + crypto decisions), PROJECT_BRIEF.md

---

## 1. Purpose and Scope

This document establishes the **overall architecture** of the Secure Password Manager: monorepo layout, service/app boundaries, data flow, cryptographic boundaries, and the extension bridge contract. It is the architectural foundation that all downstream implementation tasks (BE-001, FE-001, BR-001, etc.) build on.

It does **not** define the detailed data model (ADR-003), the full API contract (ADR-004), or the extension bridge message protocol (ADR-005) — those are separate ADRs that refine this document. This ADR establishes the boundaries and contracts those ADRs must stay within.

**Scope:** Sections 2–6 below cover the monorepo layout, service boundaries, data flow, crypto boundaries, and extension bridge contract — the five items in the task acceptance criteria.

---

## 2. Monorepo Layout

### 2.1 Directory Structure

The repository is a single TypeScript monorepo using `pnpm` workspaces (per PROJECT_BRIEF.md Section 5). The layout groups by **application** (`apps/`) and **shared packages** (`packages/`), with a clear boundary between what is shared and what is app-specific.

```
password-manager/
├── apps/
│   ├── web/                    # React 18 + TypeScript + Vite — Web UI
│   ├── browser-firefox/        # Firefox WebExtension (Manifest V3)
│   └── services/
│       └── api/                # Node.js + TypeScript + Fastify — backend API
├── packages/
│   ├── shared/                 # Shared types, message contracts, validation helpers
│   └── crypto/                 # (future) Small, audited crypto wrappers — gated by SEC-001
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   └── security/
├── docs/
│   ├── development/
│   └── architecture/
├── architecture/
│   └── adr/                    # Architecture Decision Records (ADR-001, ADR-002, ...)
├── scripts/                    # Dev/build/seed/authoring helpers
├── .github/                    # CI workflows, PR templates, CODEOWNERS
└── package.json                # Root workspaces config + scripts
```

### 2.2 What Belongs Where

| Location | Contents | Shared? |
|---|---|---|
| `apps/web/` | All React components, pages, routing, state,테마, API client | No — web-only |
| `apps/browser-firefox/` | Extension manifest, background worker, content scripts, popup, tests | No — extension-only |
| `apps/services/api/` | API routes, DB migrations, auth, vault CRUD, search, permission enforcement | No — API-only |
| `packages/shared/` | TypeScript types for entities, message types, validation schemas, constants | **Yes** — imported by web, extension, and API |
| `packages/crypto/` | **Not created yet.** When created, minimal audited wrappers around Node `crypto` / Web Crypto — no new constructions | **Yes** — but gated by security review |
| `tests/` | Test suites by level; each app may also have its own `__tests__` inside its dir | By level |
| `docs/` | User-facing and developer-facing documentation | No |
| `architecture/adr/` | All ADRs in chronological order | No (reference only) |
| `scripts/` | Build, seed, dev helpers — not shipped | No |

### 2.3 Why This Layout

- **Shared contract in one place.** `packages/shared` is the single source of truth for message types, entity shapes, and validation rules. Both the Web UI and the Firefox extension import from it, which keeps the extension bridge contract consistent (ADR-005).
- **Separation of concerns.** Each `apps/` subdirectory is a self-contained deployable/runtime unit. The API, web, and extension can be built, tested, and deployed independently — important for a self-hosted product where the operator may want to update the extension without touching the API.
- **Crypto isolation.** The planned `packages/crypto/` sits at the monorepo root (not inside any app) so that it can be reviewed as a single security boundary. No app may bypass it. This is an **original decision** for our project — Passbolt does not have an equivalent isolated crypto package in its PHP stack (see Section 8).
- **Explicit non-sharing.** Nothing in `apps/web/` may be imported by the extension, and vice versa. The only shared layer is `packages/shared` (types + contracts) and, later, `packages/crypto` (audited primitives). This prevents accidental coupling between the web bundle and the extension bundle.

---

## 3. Service Boundaries

### 3.1 The Three Runtime Units

The product has three runtime units, each with a distinct responsibility:

```
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│  apps/web/          │     │  apps/services/api/ │     │  apps/browser-      │
│  React 18 + Vite    │     │  Node + Fastify     │     │  firefox/           │
│  (Web UI)           │     │  (Backend API)      │     │  MV3 WebExtension   │
└────────┬────────────┘     └────────┬────────────┘     └────────┬────────────┘
         │                            │                            │
         │  HTTPS (REST)              │                            │
         │  + postMessage bridge      │                            │
         ▼                            ▼                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          packages/shared/                               │
│  Types, message contracts, validation helpers — imported by all three   │
└─────────────────────────────────────────────────────────────────────────┘
```

**1. Web UI (`apps/web/`)**
- Serves the user-facing React application.
- Handles authentication UI (login, unlock), vault UI, resource/folder/tag management, password generator.
- Holds the master password transiently in memory during login/unlock only (never persisted, never sent to analytics).
- After unlock, stores the **vault key** in browser memory (React state / JS heap) for client-side decryption of vault data received from the API. The vault key is never written to `localStorage`, `sessionStorage`, or `IndexedDB`.
- Communicates with the API over HTTPS REST using the typed fetch wrapper (FE-001f).
- Communicates with the extension via `postMessage` (Section 6) for lock-state sync and autofill orchestration.

**2. Backend API (`apps/services/api/`)**
- Serves the REST API (OpenAPI 3.1, ADR-004).
- Owns the database and all schema migrations.
- Handles registration, unlock (KDF + vault key derivation), lock, session management (JWT + refresh token), resource/folder/tag CRUD, search, permissions.
- **Zero-knowledge boundary:** The API never stores or sees plaintext secrets. It stores encrypted vault data (AEAD ciphertext + nonce + tag) and the encrypted vault key (`{ kdfParams, salt, vaultKeyEncrypted, iv, tag }` per SEC-001 Decision 3).
- Holds the decrypted vault key **in process memory only** during an active session (SEC-001 Decision 6). On lock or process restart, the vault key is lost.
- Does **not** perform KDF or AEAD on behalf of the client for normal vault operations — that is the client's responsibility. The API's crypto role is limited to: (a) KDF at unlock to recover the vault key (so it can serve decrypted data to API clients that hold the key, if any), and (b) AEAD for backup export (if server-side backup is chosen). For the MVP web flow, the API stores ciphertext and the web client decrypts.

**3. Firefox WebExtension (`apps/browser-firefox/`)**
- Manifest V3, background service worker, content scripts, popup.
- Minimal permissions: `activeTab`, `scripting`, `storage` (for extension settings only — never the vault key), plus host permission for the API domain only.
- **No cryptographic operations.** Does not run KDF, AEAD, or any crypto. The vault key, if held in the extension for offline autofill, lives in the background worker's memory only — never in `browser.storage.local` or any persistent store (SEC-001 Decision 9, BR-002e).
- Content scripts detect login forms and relay messages to the background worker. They do not hold secrets.
- Communicates with the web app via `postMessage` with strict origin validation (Section 6).

### 3.2 Ownership and Responsibilities Matrix

| Responsibility | Web UI | Backend API | Firefox Extension |
|---|---|---|---|
| Master password handling | Transient input → API | KDF at unlock only | Never touches |
| KDF (Argon2id) | — (calls API) | At unlock, derives vault key | Never |
| AEAD encrypt/decrypt | Client-side decrypt of vault data | Stores ciphertext; backup AEAD only | Never |
| Vault key storage | In memory only (JS heap) | Encrypted in DB (per SEC-001 D3); in memory during session | In memory only (background worker) |
| Session management | JWT interceptor, refresh | Issue/revoke JWT + refresh token | Reads lock state via bridge |
| Resource CRUD | UI forms → API | Full CRUD + permissions | Search only (popup) |
| Autofill | — | — | Content script fill on explicit user click |
| Permission enforcement | Displays what API returns | Enforces on every access | None (read-only search) |

### 3.3 Communication Between Units

- **Web UI ↔ API:** HTTPS REST with envelope format (ADR-004). JWT access token in `Authorization` header; refresh token in HttpOnly cookie. No plaintext secrets in URLs or query params (AR-2).
- **Web UI ↔ Extension:** `postMessage` with origin validation (Section 6). Used for lock-state sync and autofill orchestration only. No secrets pass through this channel — the extension either fetches encrypted data from the API itself, or the web app sends only `{username, password}` after decryption (BR-002c).
- **Extension ↔ API:** HTTPS REST directly from the background worker (using the API domain host permission). The extension authenticates with the same JWT flow as the web UI (BR-002b unlock flow handles the case where the vault is locked).

---

## 4. Data Flow

### 4.1 Registration Flow

```
User (Web UI)
  │
  │ 1. Enter master password (type=password, autocomplete=off)
  │
  ▼
Web UI (React)
  │
  │ 2. POST /auth/register  { masterPassword, userId? }
  │    (master password in POST body only — never URL, never log)
  │
  ▼
Backend API
  │
  │ 3. Generate random salt (16+ bytes, CSPRNG)
  │ 4. Run Argon2id(masterPassword, salt, params) → vaultKey (32 bytes)
  │ 5. Encrypt empty vault with vaultKey (AES-256-GCM) → emptyCiphertext
  │ 6. Encrypt vaultKey with vaultKey-derived sub-key → vaultKeyEncrypted
  │    (or: vaultKeyEncrypted = encrypt(vaultKey, vaultKey) — wrap with itself;
  │     exact construction per BE-002a; the point is the vault key is never stored plaintext)
  │ 7. Store user record: { salt, kdfParams, vaultKeyEncrypted, iv, tag }
  │ 8. Return 201 — no plaintext vault key, no plaintext master password in response
  │
  ▼
Web UI
  │
  │ 9. Clear master password from memory immediately after response
  │10. Show "registration complete" — user must now log in to unlock
```

**Key property:** The server never stores the master password. The vault key is derived once and stored only in encrypted form. (Inspired by Passbolt's master-password+KDF auth flow, ADR-001 Section 7 — but using symmetric KDF instead of OpenPGP; explicit flag below.)

### 4.2 Unlock / Login Flow

```
User (Web UI)
  │
  │ 1. Enter master password
  │
  ▼
Web UI
  │
  │ 2. POST /auth/unlock  { masterPassword }
  │
  ▼
Backend API
  │
  │ 3. Load user's { salt, kdfParams, vaultKeyEncrypted, iv, tag }
  │ 4. Run Argon2id(masterPassword, salt, kdfParams) → candidateVaultKey
  │ 5. Decrypt vaultKeyEncrypted with candidateVaultKey → vaultKey
  │    (AEAD decrypt; if tag fails → wrong password → generic error, no detail)
  │ 6. Hold vaultKey in process memory (session-scoped variable)
  │ 7. Issue JWT (15m) + refresh token (30d, rotation)
  │ 8. Return { jwt, refreshToken } — no vault key in response
  │
  ▼
Web UI
  │
  │ 9. Store JWT + refresh token (HttpOnly cookie / memory)
  │10. On subsequent API calls, fetch encrypted vault data
  │11. Decrypt vault data client-side with vault key (which was never sent by server —
  │    the web client re-derives it? No — for web, the vault key must be available client-side.
  │    Resolution: the web client sends master password to unlock; the server derives the vault key
  │    and... does NOT send it back. So how does the web client decrypt?
  │
  │    → design decision for BE-002a/BE-003a: two options:
  │      (A) Server decrypts on behalf of web client (server holds vault key in memory,
  │          decrypts data, returns plaintext to web client over HTTPS) — simpler, but server
  │          sees plaintext briefly.
  │      (B) Client-side KDF: web client runs Argon2id locally (using a WASM/JS binding),
  │          derives vault key in browser, decrypts client-side — true zero-knowledge for web too.
  │
  │    → ADR-003 / BE-002a will resolve this. For now: the architecture supports both; SEC-001
  │      assumes the server is trusted for metadata but untrusted for secrets. Option (B) is preferred
  │      for full zero-knowledge; Option (A) is acceptable for MVP if the server process is trusted.
  │
  │    → FLAG: This is an original decision point, not Passbolt-inspired (Passbolt does client-side
  │      OpenPGP decryption). We will decide in BE-002a.
  │
  │12. Vault key held in browser memory (React state) — never persisted
```

### 4.3 Vault Data Flow (per-session)

```
Backend API (holds encrypted vault in DB)
  │
  │  GET /resources?include=tags,folder,permissions
  │
  ▼
Web UI
  │
  │  Receives: [ { id, name, username, uri, description, ciphertext, iv, tag, ... }, ... ]
  │  (metadata in request/response – may be plaintext or encrypted per-resource per ADR-003;
  │   secret always ciphertext)
  │
  ▼
Web UI (decrypts client-side with in-memory vault key)
  │
  │  For each resource: AEAD decrypt(ciphertext, iv, tag, vaultKey) → plaintext secret
  │  Plaintext secret held in React state / JS heap only
  │  Rendered in UI (masked by default, "Reveal" to show)
  │
  ▼
User
  │
  │  Views/copies secret. On lock or session expiry, vault key cleared,
  │  plaintext secret lost from memory.
```

### 4.4 Lock Flow

```
User clicks Lock (or auto-lock timeout)
  │
  ▼
Web UI → POST /auth/lock
  │
  ▼
Backend API → clears vault key from process memory, revokes JWT
  │
  ▼
Web UI → clears vault key from browser memory, redirects to /unlock
  │
  ▼
Extension (if active) → receives lock-state change via postMessage (Section 6)
  │  → clears its in-memory vault key (if it held one)
  │  → icon shows "locked" state
```

### 4.5 Extension Autofill Data Flow (high-level)

```
Web page with login form
  │
  │  content script detects form → injects icon
  │
  ▼
User clicks icon → popup opens → shows matching resources (from API, encrypted)
  │
  ▼
User selects resource → popup sends message to background worker
  │
  ▼
Background worker
  │  → fetches encrypted secret from API (authenticated with JWT)
  │  → decrypts in memory (vault key in background worker, if available; otherwise
  │    triggers unlock flow BR-002b)
  │  → sends ONLY { username, password } to content script (never full secret object)
  │
  ▼
Content script
  │  → fills username + password fields on explicit user click (no auto-fill)
  │  → never exposes full secret object to the page
```

Full details in ADR-005 (Extension Bridge Protocol) and BR-002.

### 4.6 What Never Flows Where

| Data | Where it NEVER goes |
|---|---|
| Master password | Logs, URLs, localStorage, service worker storage, extension storage, analytics, error messages |
| Vault key (plaintext) | Database, localStorage, IndexedDB, extension storage, logs, any persistent store |
| Plaintext secret | API response (returns ciphertext only), localStorage, IndexedDB, URL, logs |
| Salt / IV / tag | Anywhere except: salt in user record (not secret), IV+tag alongside ciphertext (not secret) |

---

## 5. Cryptographic Boundaries

### 5.1 The Crypto Boundary Definition

The **cryptographic boundary** is the set of code paths that touch KDF, AEAD, key material, nonce/IV, or authentication tags. Everything outside this boundary deals only with ciphertext (opaque blobs) or plaintext that has already been decrypted in memory.

```
┌─────────────────────────────────────────────────────────────┐
│                    CRYPTO BOUNDARY                           │
│  (code paths that must pass AR-1 through AR-6 + code review)│
│                                                             │
│  • KDF: Argon2id(masterPassword, salt, params) → vaultKey   │
│  • AEAD encrypt: AES-256-GCM(vaultKey, plaintext, nonce)    │
│  • AEAD decrypt: AES-256-GCM(vaultKey, ciphertext, nonce)   │
│  • Key wrapping: encrypt vaultKey under itself / sub-key     │
│  • Nonce generation: randomBytes(12) / getRandomValues       │
│  • Tag verification: on every decrypt                        │
│  • Lock/unlock lifecycle: derive → hold → clear              │
│  • Recovery kit: wrap vaultKey with recovery key             │
│  • Backup: AEAD encrypt vault dump                          │
└─────────────────────────────────────────────────────────────┘
```

**Everything outside this boundary** (API routes, UI components, content scripts, message handlers) treats ciphertext as an opaque base64 string. It never inspects, modifies, or re-computes cryptographic material.

### 5.2 Location in the Monorepo

When `packages/crypto/` is created (gated by SEC-001 sign-off + code review), it will contain the only code in the entire monorepo that calls the underlying crypto library. Apps import from `packages/crypto` — they do not import `node:crypto` or `crypto.subtle` directly. This is an **original decision** for our project: it centralizes the crypto surface for review (AR-6) and prevents accidental direct crypto calls in app code.

```
apps/web/           → imports from packages/crypto (client-side: Web Crypto via wrapper)
apps/browser-firefox/ → imports from packages/crypto (extension: Web Crypto via wrapper)
apps/services/api/  → imports from packages/crypto (server-side: Node crypto via wrapper)
packages/crypto/    → the only place that touches crypto.subtle / node:crypto / argon2 bindings
```

Each app's bundle includes only the crypto wrapper it needs (client-side uses Web Crypto; server-side uses Node crypto). The extension never includes Node-crypto code.

### 5.3 What the Crypto Boundary Must Guarantee (from SEC-001)

| Requirement | Source |
|---|---|
| Argon2id KDF, not home-grown | SEC-001 Decision 1 + AR-1 |
| AES-256-GCM AEAD, not CBC/HMAC hand-rolled | SEC-001 Decision 2 + AR-1 |
| 12-byte random nonce per encryption, never reused | SEC-001 Decision 4 |
| 16-byte GCM tag verified on every decrypt; no plaintext on failure | SEC-001 Decision 5 |
| Vault key held in memory only, cleared on lock | SEC-001 Decision 6 |
| Recovery kit architecture supported (wrap vault key with second key) | SEC-001 Decision 7 |
| Encrypted backup export supported | SEC-001 Decision 8 |
| Extension: no crypto, vault key in memory only, cleared on lock/reload/sleep | SEC-001 Decision 9 |
| Positive + negative tests for every crypto change | AR-3 |
| Synthetic fixtures only | AR-4 |
| No real secrets anywhere (logs, errors, URLs, env, code) | AR-2 |

### 5.4 Library Choices (from SEC-001)

- **KDF:** `argon2` binding (Node) / Argon2id via Web Crypto-compatible binding (client). Must use a well-maintained audited binding, not a JS re-implementation. (SEC-001 Decision 1)
- **AEAD:** Node.js `crypto` (server) / Web Crypto `crypto.subtle` (browser + extension). AES-256-GCM. (SEC-001 Decision 2)
- **RNG:** `crypto.randomBytes` (Node) / `crypto.getRandomValues` (Web). Never `Math.random`. (SEC-001 Decision 4)

**No new library choices are made in this ADR.** ADR-002 records the boundary and the requirement that all crypto flows through `packages/crypto` using the audited primitives listed above. Specific library versions and parameter tuning are deferred to BE-002a (KDF) and BE-003a (AEAD), each of which will have its own implementation ADR or PR description that references SEC-001.

### 5.5 Extension Crypto Boundary (Special Case)

The Firefox extension is a **separate crypto boundary** because it runs in a different runtime (browser extension context, not Node) and has a different threat model (malicious web pages, malicious extensions, content script abuse).

Per SEC-001 Decision 9:
- The extension does **not** perform KDF or AEAD. Period.
- The vault key, if held in the extension, is in the background worker's memory only.
- The extension's only crypto-adjacent responsibility is: receiving a decrypted `{username, password}` pair from the background worker and passing it to the content script — and even that is orchestration, not crypto.

This means `packages/crypto` **is not imported by the extension** in the MVP. The extension's message contract (ADR-005) is a separate boundary from the crypto boundary. The two meet only at the point where the web app (or API) has already decrypted the secret and the extension receives the plaintext `{username, password}` pair — and even then, the extension never stores it.

---

## 6. Extension Bridge Contract

### 6.1 What the Bridge Is

The **extension bridge** is the communication channel between the Web UI (`apps/web/`) and the Firefox WebExtension (`apps/browser-firefox/`). It is **not** a REST API — it is a `postMessage` channel (with a SameSite=Strict cookie fallback for lock-state sync, per SEC-001 Decision 9).

The bridge has two responsibilities:
1. **Lock-state sync:** The extension needs to know whether the vault is locked so it can decide whether to allow autofill/search.
2. **Autofill orchestration:** The extension notifies the web app when it has detected a login form and needs the user to select a credential; the web app may surface a UI to help.

**The bridge does not carry secrets.** The extension fetches encrypted data from the API directly (authenticated with its own JWT session). The bridge carries only lock state and orchestration signals.

### 6.2 Message Types

The message types are defined in `packages/shared/` so that both the web app and the extension import the same types. This is the **only** shared layer between the web app and the extension (per Section 2.3).

| Message type | Direction | Purpose | Payload (synthetic example) |
|---|---|---|---|
| `LOCK_STATE_CHANGED` | Web → Extension | Notify extension that vault locked/unlocked | `{ state: "locked" | "unlocked", ts: number }` |
| `AUTOFILL_REQUEST` | Extension → Web | Extension detected a login form, asks web to surface credential selection (optional — extension may handle alone) | `{ url: "https://example.test/login", fieldSelector: "string" }` |
| `AUTOFILL_RESPONSE` | Web → Extension | Web returns selected credential (already decrypted by web, sent as `{username, password}` only) — OR extension handles alone and this is not used | `{ username: "testuser", password: "generated-password-test" }` |
| `VAULT_SEARCH` | Extension → Web (optional) | Extension asks web to search vault (web queries API, returns filtered list) | `{ query: "example" }` |
| `EXTENSION_READY` | Extension → Web | Extension initialized, ready to receive lock-state sync | `{ version: "1.0.0" }` |

**Origin validation applies to ALL messages** (Section 6.3). No message is processed without verifying the sender's origin.

### 6.3 Origin Validation

Per SEC-001 Decision 9 and BR-002d:

**Extension side (background worker):**
- Only accepts `postMessage` from the web app's exact origin (e.g., `https://vault.example.test`).
- Rejects any message from an unexpected origin silently (no error, no log of the origin that might leak info).
- Additionally validates that the message type is one of the known types from `packages/shared` — unknown types are dropped.

**Web app side:**
- Only sends `postMessage` to the extension's `moz-extension://` URL (obtained via `browser.runtime` API or a known extension ID).
- Does not trust any response from the extension without verifying the response's `source` is the extension.

**Fallback (lock-state only):** If `postMessage` is unavailable (e.g., extension not installed, messaging blocked), the web app sets a `SameSite=Strict; Secure; HttpOnly` cookie with the lock state, and the extension reads it via `browser.cookies`. This is **less secure** (any extension with cookie permission could read it) and is a fallback only — `postMessage` with origin check is the primary mechanism. (SEC-001 Decision 9)

### 6.4 Permission Model for the Bridge

The bridge does not introduce new permissions — it operates within the existing permission model:

- The extension has host permission for the API domain only (not `<all_urls>`). It can fetch encrypted vault data from the API, but it cannot fetch from arbitrary sites.
- The content script runs on pages the user visits. It detects forms but does not have access to the vault key (which is in the background worker). It cannot decrypt anything.
- The web app does not grant the extension any API access beyond what the extension's own JWT session provides. The bridge is not an auth channel.

### 6.5 Autofill Flow (Bridge-Ordered)

This is the controlled autofill flow that the bridge enables. Full implementation in BR-003; this section records the architectural contract.

1. **Form detected:** Content script detects a login form (username + password fields) on a page. Injects an icon next to the form.
2. **User invokes:** User clicks the icon (explicit user action — no auto-detect auto-fill). Popup opens.
3. **Popup shows candidates:** Popup queries the API (authenticated) for resources matching the page's URL. Shows list (or single resource).
4. **User selects:** User clicks a resource in the popup.
5. **Background worker decrypts:** Background worker fetches the encrypted secret from the API, decrypts it with the vault key (in memory), extracts `{username, password}`.
6. **Fill on click:** Background worker sends `{username, password}` to the content script. Content script fills the form fields. **No automatic fill** — the user must click to fill.
7. **Clear after fill:** The `{username, password}` pair is cleared from the content script's memory after fill (not persisted).

The bridge message `AUTOFILL_REQUEST`/`AUTOFILL_RESPONSE` is used only if the web app surfaces a credential-selection UI; the extension may handle the entire flow itself without web app involvement. The architectural contract is that **both paths are supported** and the message types exist in `packages/shared` regardless.

### 6.6 What the Bridge Must NOT Do

- Carry the master password, vault key, or any ciphertext between web app and extension.
- Allow the extension to trigger autofill without explicit user action.
- Allow the content script to access the vault key or any decrypted secret (it only receives `{username, password}` after the background worker has decrypted).
- Allow any origin other than the web app's origin (extension side) or the extension's `moz-extension://` URL (web side) to send or receive bridge messages.

### 6.7 Bridge vs. API: Clear Separation

| Concern | Bridge (postMessage) | API (REST) |
|---|---|---|
| Lock-state sync | Yes (primary) | No |
| Autofill orchestration | Yes (optional) | No |
| Credential fetch | No (extension fetches from API directly) | Yes |
| Authentication | No (uses extension's own JWT session for API calls) | Yes (JWT + refresh token) |
| Secrets in transit | No | No (only ciphertext in API responses) |

---

## 7. Data Flow Summary Diagram (text)

```
                       ┌─────────────┐
                       │   User      │
                       └──────┬──────┘
                              │ master password (transient)
                              ▼
                       ┌─────────────┐     ┌──────────────────┐
                       │ Web UI (React)│     │  Backend API     │
                       └──────┬──────┘     │  (Node/Fastify)  │
                              │            └───────┬──────────┘
                              │  HTTPS REST       │ KDF + AEAD
                              ▼            ┌───────┴──────────┐
                       ┌─────────────┐     │  Encrypted DB    │
                       │ Client-side │     │  (ciphertext +   │
                       │ decryption  │     │   salt, kdfParams│
                       │ (vault key  │     │   vaultKeyEnc)   │
                       │  in memory) │     └──────────────────┘
                       └──────┬──────┘
                              │ plaintext secret (in memory only)
                              ▼
                       ┌─────────────┐
                       │   UI render │  (masked; reveal on click)
                       └─────────────┘

Extension bridge (separate channel):
  Web UI ◄──postMessage──► Extension (background worker)
    │                           │
    │ lock state               │ lock state
    │ autofill orchestration   │ fetch encrypted from API
    │                           │ decrypt in memory
    │                           │ send {username,password} to content script
    │                           ▼
    │                    ┌─────────────┐
    │                    │Content script│ → fill form on click
    │                    └─────────────┘
```

---

## 8. Passbolt-Inspired vs. Original Decisions

Per the IP boundary rule (PROJECT_BRIEF.md Section 4, ADR-001 Section 1), this ADR explicitly flags each architectural decision as **inspired by Passbolt** (studied from Passbolt's public docs/repo, adapted to our architecture) or **original** (our own design, not derived from Passbolt).

### 8.1 Decisions Inspired by Passbolt (with adaptation noted)

| # | Decision | Passbolt source | Our adaptation |
|---|---|---|---|
| 1 | Monorepo with separate apps for web / browser / API | Passbolt's separate repos for web, extension, API (conceptual parallel, not literal structure) | We use a single monorepo with `apps/` and `packages/`; Passbolt uses separate repos. **Inspired-by with structural change.** |
| 2 | Resource metadata / secret separation | ADR-001 Section 1 — Passbolt's resource + secret split | We keep the split but use AEAD (not OpenPGP); metadata encryption opt-in from V1. **Adapted.** |
| 3 | Three permission levels (Read/Update/Owner) | ADR-001 Section 5 — Passbolt's 1/7/15 bitmask | Same three levels, same semantics, enforced in our RBAC. **Adapted.** |
| 4 | Folder permission mask (propagate at create/move) | ADR-001 Section 2 — Passbolt's "where possible" mask | Same concept, simplified; our ADR-003 will define exact propagation rules. **Adapted.** |
| 5 | Flat tags, many-to-many with resources | ADR-001 Section 3 — Passbolt's tag model | Direct adoption. **Adapted.** |
| 6 | Extension: minimal permissions, CSP strict, origin validation, explicit-user-action autofill | ADR-001 Section 6 — Passbolt's MV3 extension architecture | Firefox-first (Passbolt supports Firefox + Chrome); same security controls. **Adapted.** |
| 7 | Auth flow: master password + KDF (not OpenPGP) | ADR-001 Section 7 — Passbolt's GPGAuth → JWT flow | We use symmetric KDF (Argon2id) instead of OpenPGP; JWT + refresh token. **Adapted — the KDF direction is Passbolt-inspired (master-password auth), but the symmetric construction is original to our threat model.** |
| 8 | API envelope: `{ header, body }`, UUIDs, soft delete | ADR-001 Section 8 — Passbolt's response envelope | Same structure; `include[]` instead of `contain[]` (naming preference). **Adapted.** |
| 9 | Groups as AROs for sharing, client-side re-encryption on membership change | ADR-001 Section 4 — Passbolt's group-sharing model | We use symmetric vault keys (key wrapping) instead of OpenPGP public-key re-encryption. **Adapted.** |

### 8.2 Decisions That Are Original (not Passbolt-inspired)

| # | Decision | Why original |
|---|---|---|
| 1 | `packages/crypto/` as a isolated, audited crypto wrapper package at the monorepo root, imported by all apps, with no direct `node:crypto`/`crypto.subtle` imports elsewhere | Passbolt's PHP stack does not have an equivalent isolated crypto package. This is our architectural response to AR-1 (no home-grown crypto) and AR-6 (code review gate for crypto changes). |
| 2 | `packages/shared/` as the single shared contract layer between web and extension (message types, validation) — explicit non-import rule between `apps/web/` and `apps/browser-firefox/` | Passbolt's extension and web are separate repos with no shared TS package. Our monorepo layout with a shared contract package is an original structural decision. |
| 3 | Web client-side decryption vs. server-decryption decision (option A/B in Section 4.2) — to be resolved in BE-002a | Passbolt does client-side OpenPGP decryption, but our symmetric vault model with optional server-side decryption for web is a decision point specific to our architecture. Flagged here so BE-002a makes an explicit choice. |
| 4 | Recovery kit architecture (wrap vault key with a second CSPRNG-generated recovery key, stored encrypted on server) | Passbolt's recovery is server-side keyring (which we rejected per ADR-001). Our recovery kit is a user-managed, zero-knowledge recovery path — original to our threat model (SEC-001 Decision 7). |
| 5 | Extension bridge contract as a `postMessage` channel with a defined message set in `packages/shared/`, with `SameSite=Strict` cookie fallback for lock-state only | Passbolt's extension bridge is not documented in the same way in its public docs; our contract-first approach (message types in shared package) is an original architectural choice for type safety across the web/extension boundary. |
| 6 | Explicit non-import rule: `apps/web/` and `apps/browser-firefox/` may not import from each other; only `packages/shared/` and (future) `packages/crypto/` are shared | Original structural rule to prevent coupling between web and extension bundles. |

### 8.3 Decisions Explicitly Rejected from Passbolt (cross-reference ADR-001)

See ADR-001 Section "Patterns NOT Adopted" for the full list. The most architecturally significant rejections for this ADR are:

- **OpenPGP/GPGAuth** → we use symmetric AEAD (SEC-001).
- **Server-side keyring recovery** → we use a user-managed recovery kit (SEC-001 Decision 7).
- **PHP/CakePHP stack** → we use TypeScript/Node + React + WebExtension.
- **Metadata plaintext by default** → we encrypt metadata from V1 (opt-in per resource, ADR-003).

---

## 9. Consequences

### 9.1 Positive

- Clear separation between web, API, and extension — each can be developed, tested, and deployed independently.
- Single source of truth for shared types (`packages/shared/`) — reduces drift between web and extension message contracts.
- Isolated crypto package (`packages/crypto/`) — concentrates the security surface for review (AR-6) and prevents accidental direct crypto calls in app code.
- Bridge contract defined upfront (message types in `packages/shared/`) — web and extension teams can work in parallel against the contract.
- Every Passbolt-inspired decision is flagged, reducing AGPLv3 contamination risk (QA can scan for Passbolt code/schemas/config).

### 9.2 Negative / Risks

- The `packages/crypto/` isolation relies on discipline — nothing prevents an implementor from importing `node:crypto` directly in app code. AR-6 (code review gate) + lint rules in CI must enforce this. DOC-001e (doc policy + validation CI) should include a lint rule that bans direct crypto imports outside `packages/crypto/`.
- The web client-side vs. server-side decryption decision (Section 4.2, option A/B) is unresolved. If option A (server decrypts for web) is chosen, the zero-knowledge property for the web flow is weakened — the server sees plaintext briefly. This must be decided explicitly in BE-002a with QA sign-off.
- The extension bridge fallback (SameSite=Strict cookie for lock-state) is less secure than `postMessage`. If the primary `postMessage` path is reliable (it should be for a self-hosted app where the user has installed the extension), the fallback may never be used — but it must still be implemented per SEC-001 Decision 9.
- `packages/crypto/` is not created in this ADR's scope — it is gated by SEC-001 sign-off. Until it exists, apps must not perform any crypto. This means the earliest crypto work (BE-002a) must create `packages/crypto/` as part of its deliverable, or reference a plan to create it.

### 9.3 Downstream Impact

- **ADR-003 (Data Model):** Must define schemas that fit the service boundaries in Section 3 — user, vault, resource, folder, tag, permission, group — and reference ADR-001 for resource/secret split and permission-mask patterns.
- **ADR-004 (API Contract):** Must use the envelope format from Section 3.2 (Passbolt-inspired), reference ADR-001, and define OpenAPI 3.1 spec skeleton.
- **ADR-005 (Extension Bridge Protocol):** Must define the message types from Section 6.2 in full detail, origin validation rules from Section 6.3, and reference ADR-001.
- **BE-001a (Migration System):** Must create the DB schema that stores encrypted vault data per Section 4.1/4.3.
- **BE-002a (Registration + KDF):** Must implement the registration flow from Section 4.1, create `packages/crypto/` if it doesn't exist, and resolve the client-side vs. server-side decryption decision (Section 4.2).
- **BR-001e (Message Protocol):** Must implement the message types from Section 6.2 in `packages/shared/`.
- **BR-002a (Vault Session Sync):** Must implement the lock-state sync from Section 6.3.

---

## 10. Open Questions (carried into downstream ADRs)

These are not resolved in this ADR — they are flagged for the downstream ADRs / implementation tasks that own them.

1. **Web client-side vs. server-side decryption (Section 4.2, option A/B):** Who decrypts vault data for the web UI? If client-side (option B), the web client needs an Argon2id binding (WASM/JS) to derive the vault key locally. If server-side (option A), the server sees plaintext briefly. **Owner: BE-002a + BE-003a, with QA sign-off.**
2. **Vault key encryption at rest (Section 4.1, step 6):** Exactly how is the vault key encrypted for storage? Wrapped with itself (encrypt vault key with vault key)? Or wrapped with a sub-key derived from the master password via a different KDF info string? **Owner: BE-002a, referencing SEC-001 Decision 3.**
3. **`packages/crypto/` creation:** Who creates it, and as part of which task? **Owner: BE-002a (first crypto task) — it must exist before any crypto code is written.**
4. **Backup key (Section 4.3, Decision 8):** For MVP, the backup is encrypted with the vault key (simpler). A separate backup key is a future enhancement. **Owner: BE-003a + backup task (post-MVP), referencing SEC-001 Decision 8.**
5. **Extension vault key in memory:** Does the extension hold the vault key for offline autofill, or does it always fetch encrypted data and rely on the web app for decryption? **Owner: BR-002c + BR-002e, referencing SEC-001 Decision 9.**

---

## 11. Sign-off

| Role | Name | Date | Signature |
|---|---|---|---|
| Architect | Architect (Solar Pro4, Upstage) | 2026-09-16 | Signed — reviewed in full |
| QA | (pending) | | |

**Architect sign-off rationale (summary):** This ADR documents the monorepo layout, service boundaries, data flow, crypto boundaries, and extension bridge contract as required by the acceptance criteria. It references ADR-001 for all Passbolt-inspired patterns and explicitly flags each decision as inspired-by vs. original (Sections 8.1, 8.2, 8.3). It references SEC-001 for all crypto boundary requirements (Section 5.3). It does not introduce any new crypto decisions — all crypto decisions come from SEC-001, and this ADR records only the boundary and the requirement that crypto flows through an isolated `packages/crypto/` package. Open questions are flagged for downstream owners.

**QA sign-off is still required.** This ADR is `Proposed` until QA reviews and signs. Downstream tasks (ADR-003, ADR-004, ADR-005, BE-001a, etc.) are blocked on ADR-002 + ADR-001 + SEC-001 per the backlog dependency graph.

---

## 12. Changelog

| Date | Change | Author |
|---|---|---|
| 2026-09-16 | Initial draft | Architect |

---

*Date: 2026-09-16 · Author: Architect · Status: Proposed · References: ADR-001, SEC-001, PROJECT_BRIEF.md*
