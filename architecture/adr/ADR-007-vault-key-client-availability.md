# ADR-007: Vault Key Client Availability (the ADR-002 §4.2 FLAG, unresolved)

**Status:** Proposed — decision needed
**Date:** 2026-09-28
**Author:** QA (found while investigating FE-003d)
**Decision-Makers:** Architect + QA
**References:** ADR-002 §4.2 (Unlock/Login Flow), §4.3 (Vault Data Flow), §9.3;
SEC-001 Decision 6; `packages/crypto/`; `apps/services/api/src/auth/unlock.ts`;
`apps/web/src/auth/SessionProvider.tsx`

---

## 1. Purpose

FE-003d (Resource Detail Modal — "Reveal" button, "fetches + decrypts
client-side") cannot be implemented as specified. Investigating why surfaced
that ADR-002 §4.2 left this as an explicit open question and named BE-002a as
the task that would resolve it. BE-002a (merged, PR #54) did not resolve it —
it implemented the server side of both options' shared prefix (KDF + vault-key
wrap/unwrap) but never made a choice about how, or whether, the web client
gets the key. This ADR exists to put that choice back in front of a human
before any more frontend work is built on an assumption nothing currently
provides.

## 2. What ADR-002 §4.2 says (verbatim)

> │11. Decrypt vault data client-side with vault key (which was never sent by server —
> │    the web client re-derives it? No — for web, the vault key must be available client-side.
> │    Resolution: the web client sends master password to unlock; the server derives the vault key
> │    and... does NOT send it back. So how does the web client decrypt?
> │
> │    → design decision for BE-002a/BE-003a: two options:
> │      (A) Server decrypts on behalf of web client (server holds vault key in memory,
> │          decrypts data, returns plaintext to web client over HTTPS) — simpler, but server
> │          sees plaintext briefly.
> │      (B) Client-side KDF: web client runs Argon2id locally (using a WASM/JS binding),
> │          derives vault key in browser, decrypts client-side — true zero-knowledge for web too.
> │
> │    → ADR-003 / BE-002a will resolve this. For now: the architecture supports both; SEC-001
> │      assumes the server is trusted for metadata but untrusted for secrets. Option (B) is preferred
> │      for full zero-knowledge; Option (A) is acceptable for MVP if the server process is trusted.
> │
> │    → FLAG: This is an original decision point, not Passbolt-inspired (Passbolt does client-side
> │      OpenPGP decryption). We will decide in BE-002a.

ADR-003 does not mention this question at all (checked — no `vault key` /
`client-side` decision text in ADR-003). So neither of the two documents ADR-002
named as the resolution point actually resolved it.

## 3. What BE-002a actually implemented (verified by reading the code, 2026-09-28)

- `packages/crypto/src/index.ts` — `deriveVaultKey`/`registerMasterPassword`/
  `unlockVaultKey` all use the `argon2` npm package, which is a **native
  Node.js binding** (compiled addon). It cannot run in a browser; there is no
  WASM or Web Crypto path in this package. `apps/web/package.json` has no
  browser-compatible Argon2id dependency at all (checked: no `argon2-browser`,
  `hash-wasm`, `@noble/*`, or similar).
- `apps/services/api/src/auth/unlock.ts` (`POST /auth/unlock`) — runs
  `unlockVaultKey()` **server-side only**, to verify the master password (a
  decrypt-tag-verification check), then **discards it**. The response body is
  `{ accessToken, refreshToken, expiresIn, tokenType }` — no key material of
  any kind.
- `apps/web/src/auth/SessionProvider.tsx` — `SessionState` has exactly four
  fields: `accessToken`, `refreshToken`, `expiresAt`, `active`. No `vaultKey`
  field exists, and nothing derives one.
- `apps/web/src/pages/LoginPage.tsx` — sends `{ masterPassword, email }` to
  `/auth/unlock`, receives tokens, calls `session.login(...)`. The master
  password itself is never used for anything client-side (no local KDF call)
  and is cleared from state immediately after.

**Net effect: this implements neither Option A nor Option B.** It is the
common prefix of both (server-side KDF + wrap/unwrap, used only to gate token
issuance) with the actual decision — how the client gets a key to decrypt with
— never made. Right now there is **no code path, in any task merged to
master, by which the browser ever holds a vault key.**

This matches what `apps/services/api/src/routes/resources.ts`'s module
docblock *asserts* is already true ("The client encrypts client-side with the
vault key... and decrypts client-side after fetching") — that comment
describes the target architecture, not the current one; nothing in the web
app can do either half of that sentence today.

## 4. Option A vs Option B — concrete tradeoffs and blast radius

### Option A — server decrypts on request, returns plaintext over HTTPS

The server already holds the vault key transiently during `/auth/unlock` (to
verify the password) — Option A extends that: either (A1) keep it in server
memory for the session's lifetime keyed by session id, or (A2) re-derive it
per-request from a value the client sends back. Either way, `GET
/resources/:id` (or a new `/resources/:id/reveal` endpoint) would decrypt
server-side and return plaintext.

**Files touched (estimate):**
- `apps/services/api/src/auth/unlock.ts` — persist `vaultKey` somewhere
  server-side keyed by session id (in-memory map, or a new sessions-table
  column if it must survive process restart — SEC-001 Decision 6 currently
  says "in-process memory only, cleared on lock/restart", so a map keyed by
  `sessionId` is the SEC-001-compatible version of A1).
- `apps/services/api/src/routes/resources.ts` — new or modified GET path that
  decrypts before responding; module docblock's "server never decrypts" claim
  becomes false and must be rewritten.
- `apps/services/api/src/auth/session-key-store.ts` (new) — the in-memory
  vault-key-by-session map, with clearing on `/auth/lock` and expiry.
- `apps/web/src/pages/*` (Resource Detail Modal, and anywhere else a secret is
  shown) — no client-side AEAD needed at all; just render what the API
  returns.
- SEC-001 threat model — the "server is untrusted for secrets" assumption
  ADR-002 §4.2 cites becomes false; SEC-001 needs an explicit amendment
  documenting that the MVP server is trusted with plaintext secrets in
  memory (not just wrapped keys), which is a real, user-facing change to the
  product's security posture, not just an implementation detail.

**Tradeoffs:** Fast to build (no browser crypto dependency, no new package).
Directly contradicts the "zero-knowledge boundary" ADR-002 §4.2 states the API
should have ("The API never stores or sees plaintext secrets") and that
`resources.ts`'s docblock already asserts as fact. Every future security
review / pentest / compliance conversation has to explain this deviation.

### Option B — real client-side KDF (browser Argon2id)

The client would derive the vault key locally at unlock time (in addition to,
or instead of, sending the master password to `/auth/unlock` for token
issuance), hold it only in `SessionProvider` state, and do all AEAD
encrypt/decrypt in the browser using the ciphertext/iv/tag blobs the API
already round-trips opaquely (which is what `resources.ts` already assumes).

**Files touched (estimate):**
- `packages/crypto/` — needs a second, browser-safe implementation of
  Argon2id (a WASM binding — candidates would need real evaluation, not a
  reflexive pick: bundle size, audit history, whether it matches the exact
  KDF_PARAMS already fixed server-side in `KDF_PARAMS`). The existing
  `deriveVaultKey`/`unlockVaultKey` API shape could stay the interface; only
  the implementation swaps per target (Node vs browser), matching what ADR-002
  §5.3/§9.3 already describe ("client-side uses Web Crypto via wrapper").
  AES-256-GCM AEAD (`encrypt`/`decrypt` in `packages/crypto/src/aead.ts`) also
  needs a Web Crypto (`crypto.subtle`) implementation for the browser target —
  confirmed (2026-09-28): it currently imports `createCipheriv`/
  `createDecipheriv`/`randomBytes` from `node:crypto` unconditionally, no
  browser path exists for AEAD either, not just the KDF.
- `apps/web/src/pages/LoginPage.tsx` / `UnlockPage.tsx` — derive the vault key
  locally (Argon2id with the user's salt/kdfParams, which the client doesn't
  currently have — `/auth/unlock` would need to either return
  `{salt, kdfParams}` before the password check, e.g. a separate lookup call,
  or the client derives after a successful unlock using params returned
  alongside the tokens).
- `apps/web/src/auth/SessionProvider.tsx` — add a `vaultKey: Buffer | null`
  (or equivalent) field; extend `login()`'s signature; clear it in `lock()`
  and `clear()` (SessionState already models "never persisted", so this fits
  the existing shape).
- FE-003d (Resource Detail Modal), FE-003i (Client-side Decryption —
  literally named for this), FE-003e (Create/Edit Resource Form — encrypting
  a *new* secret before `POST /resources` needs the same key) — all three can
  only be correctly implemented once this lands.
- BR-002a/b/c/e (browser extension vault session sync, unlock flow, crypto
  boundary, key memory lifetime) — all currently `triage`/未-started and all
  assume "vault key... received via secure channel" (BR-002c) — that channel
  doesn't exist yet either; those cards are two layers downstream of this
  decision (web app must hold a key before it can hand one to the extension).
- SEC-001 — no amendment needed; this is the option SEC-001 already assumes.

**Tradeoffs:** Matches every existing ADR-002/SEC-001/`resources.ts` statement
about the zero-knowledge boundary — no doc rewrites needed elsewhere. Real
scope: a new crypto dependency with its own audit/security-review burden, a
second AEAD implementation path, and a non-trivial `/auth/unlock` protocol
change (client needs `salt`/`kdfParams` before or alongside token issuance).

## 5. Blast radius — every card that assumes a client-held vault key

Searched all kanban tasks for "vault key" / related terms (2026-09-28):

| Task | Title | Status | Assumption |
|---|---|---|---|
| t_79831815 | FE-003d: Resource Detail Modal | blocked | "Reveal" fetches + decrypts **client-side** |
| t_c7258993 | FE-003i: Client-side Decryption + Optimistic Updates | todo | "Secret decrypted in memory using **vault key from unlock**" |
| t_59303b60 | FE-003e: Create/Edit Resource Form | todo | Not stated in its own acceptance criteria, but `POST /resources` requires `secretCiphertext`/`secretIv`/`secretTag` already encrypted — the form cannot submit a real secret without a client-side vault key either. Not yet attempted, so not yet crashed on it the way FE-003d did. |
| t_974b5e77 | BR-002c: Crypto Boundary + Autofill Decryption | triage | "vault key held in memory only, **received via secure channel**" (extension side — presupposes the web app already has one to hand over) |
| t_b1a8b77e | BR-002e: Vault Key Memory Lifetime | triage | "Vault key cleared on lock, browser sleep, extension reload" — presupposes BR-002c |
| t_83dc1b35 | BR-002a: Vault Session Sync | triage | Downstream of BR-002c/e — doesn't itself name the key, but is part of the same dependent chain |
| t_e919cff1 | BR-002b: Unlock Flow (extension) | triage | Same chain |

FE-003d is the only one that has actually been *attempted* (3 crashes, see
its run history — one crash log shows the worker stuck reasoning about base64
padding, consistent with it discovering it had no real key/ciphertext to work
with and improvising). The others simply haven't been picked up yet; they
will hit the same wall.

## 6. What this ADR does *not* do

This document does not choose between Option A and Option B. That is a
security-posture decision (it changes what SEC-001 can truthfully claim about
the server's trust boundary) and belongs to whoever owns that document —
proposed as Architect + QA per the ADR-006 precedent. No implementation
(browser Argon2 library, `SessionProvider` changes, or endpoint changes) has
been started against either option.

---

*Date: 2026-09-28 · Author: QA · Status: Proposed — awaiting Architect decision*
