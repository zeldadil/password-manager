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
it implemented the server side of every option's shared prefix (KDF +
vault-key wrap/unwrap) but never made a choice about how, or whether, the web
client gets the key. This ADR exists to put that choice back in front of a
human before any more frontend work is built on an assumption nothing
currently provides.

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

## 4. Option A1 vs A2 vs B — concrete tradeoffs and blast radius

Earlier drafts of this ADR labeled two *server-side key-custody mechanics*
"A1"/"A2" under a single "Option A" — that conflated two options with
genuinely different security properties (does a vault key ever reach the
browser at all?) into one. Corrected below into three options, each a
distinct point on "who computes the key, and does it ever leave the server":

### Option A1 — server decrypts on every request; no key ever reaches the browser

`GET /resources/:id` (or a new `/resources/:id/reveal` endpoint) decrypts
server-side and returns **plaintext** secret in the response body. The vault
key itself is never transmitted to the client, ever — only the already-
decrypted secret, per request, at the moment it's needed.

**Files touched (estimate):**
- `apps/services/api/src/auth/unlock.ts` — persist `vaultKey` server-side
  keyed by session id (in-memory map, or a sessions-table column if it must
  survive process restart — SEC-001 Decision 6 says "in-process memory only,
  cleared on lock/restart", so an in-memory map keyed by `sessionId` is the
  SEC-001-compatible version).
- `apps/services/api/src/auth/session-key-store.ts` (new) — the in-memory
  vault-key-by-session map, cleared on `/auth/lock` and expiry.
- `apps/services/api/src/routes/resources.ts` — GET (and PATCH/POST, see
  below) decrypt/encrypt server-side; the module docblock's "server never
  decrypts" claim becomes false and must be rewritten; **ADR-004's API
  contract changes** — `secretCiphertext`/`secretIv`/`secretTag` would no
  longer be meaningful client-facing fields on GET, replaced by a plaintext
  `secret` field (or equivalent), and POST/PATCH would need to accept a
  plaintext secret from the client instead of a pre-encrypted blob (the
  client has no key to encrypt with either, under A1) — so A1 isn't just a
  GET-path change, it inverts the create/edit contract too.
- `apps/web/src/pages/*` (Resource Detail Modal, Create/Edit form) — no
  client-side AEAD needed at all anywhere; render/submit plaintext directly.
- SEC-001 threat model — the "server is untrusted for secrets" assumption
  ADR-002 §4.2 cites becomes false for **every** resource operation, not just
  unlock; SEC-001 needs an explicit amendment documenting that the MVP server
  is trusted with plaintext secrets in memory continuously, which is a real,
  user-facing change to the product's security posture, not an implementation
  detail.

**Acceptance criteria that need rewriting:**
- FE-003d (t_79831815): "'Reveal' button (fetches + **decrypts client-side**)" —
  the "decrypts client-side" clause becomes false; would read "fetches
  already-decrypted plaintext" instead. This is a criterion rewrite, not just
  an implementation note.
- FE-003i (t_c7258993): "Secret decrypted **in memory using vault key from
  unlock**" — there is no vault key on the client under A1 at all; this
  criterion's premise doesn't hold. The task's actual remaining scope under
  A1 (optimistic updates + in-memory-only handling of a plaintext secret,
  never persisted) would need to be re-specified, not just re-worded.
- FE-003e (t_59303b60): no AC currently mentions encryption, but the
  submission path changes materially — the form would POST a plaintext
  `secret` field, not `secretCiphertext`/`secretIv`/`secretTag`. Needs a new,
  explicit AC describing this if A1 is chosen (currently implicit/undocumented
  either way — see §5).

**Tradeoffs:** Fastest to build — no browser crypto dependency, no new
package, no client-side crypto code at all. Directly contradicts the
"zero-knowledge boundary" ADR-002 §4.2 states the API should have ("The API
never stores or sees plaintext secrets") and that `resources.ts`'s docblock
already asserts as fact — and does so on *every* read/write, not just at
unlock. Every future security review / pentest / compliance conversation has
to explain this deviation. Largest continuous plaintext exposure surface of
the three options (plaintext crosses the server on every reveal, not once).

### Option A2 — server sends the vault key to the client after unlock; client decrypts locally

`POST /auth/unlock` (or a follow-up authenticated call) additionally returns
the raw vault key (base64) to the client. `SessionProvider` holds it in
memory. The client performs AEAD encrypt/decrypt locally using the existing
ciphertext/iv/tag wire format — `resources.ts`'s current contract (opaque
blobs in, opaque blobs out) is **unchanged**; only the unlock response and
`SessionProvider` change. No client-side KDF (Argon2id) is needed — the
server already derived the key; A2 only needs a browser **AEAD** (Web Crypto)
implementation, not a browser KDF.

**Files touched (estimate):**
- `apps/services/api/src/auth/unlock.ts` — include `vaultKey` (base64) in the
  `UnlockResponse` body. This is the one line that most directly reverses
  ADR-002 §4.2 step 8's explicit "no vault key in response" — worth the
  Architect/QA decision-makers reading that line twice.
- `apps/services/api/src/routes/resources.ts` — **no change**; still never
  decrypts, still round-trips opaque blobs, docblock stays accurate.
- `packages/crypto/src/aead.ts` — needs a Web Crypto (`crypto.subtle`)
  implementation of `encrypt`/`decrypt` for the browser target (confirmed:
  currently `node:crypto`-only, no browser path). No KDF work needed — A2
  does not need `packages/crypto`'s Argon2id to run in the browser at all.
- `apps/web/src/auth/SessionProvider.tsx` — add `vaultKey: Uint8Array | null`
  (or equivalent) to `SessionState`; extend `login()`'s signature; clear it in
  `lock()`/`clear()`.
- `apps/web/src/pages/LoginPage.tsx` — parse `vaultKey` out of the `/auth/unlock`
  response and pass it to `session.login(...)`.
- SEC-001 — needs a narrower amendment than A1: the server still derives and
  briefly transmits the raw key once, per unlock (over TLS), rather than
  continuously handling plaintext secrets; the "zero-knowledge for secrets"
  property SEC-001/§4.2 describe is *partially* preserved (the server never
  sees plaintext secrets, only the key that could decrypt them) but the
  "vault key never sent by server" line in ADR-002 §4.2 step 8 becomes false
  and must be corrected either way.

**Acceptance criteria that need rewriting:**
- FE-003d: "decrypts client-side" — **true under A2**, no rewrite needed.
- FE-003i: "vault key from unlock" — **true under A2**, matches as written;
  this AC was seemingly written assuming A2 (or B) already existed.
- FE-003e: still needs an explicit AC added for client-side encryption before
  POST (true under A2 *and* B, absent under A1) — this gap exists regardless
  of which of A2/B is chosen, so it should be added to FE-003e now rather
  than deferred again.

**Tradeoffs:** No new KDF dependency/audit burden (unlike B). Resource routes
and the wire contract are untouched (unlike A1). But it does put raw key
material on the wire once per unlock/session and has the server compute and
briefly hold the actual vault key on every unlock (already true today, at
verification time) — a determined, compromised, or subpoenaed server can
capture it at that moment even though it's not persisted or logged. This is
weaker than B's guarantee that the server never has the plaintext key in the
first place, but stronger than A1's continuous server-side plaintext-secret
exposure.

### Option B — real client-side KDF (browser Argon2id); server never computes or sees the key

The client still sends the master password to `POST /auth/unlock` exactly as
today, for the server's own verification/token-issuance purposes (the server
continues to derive-and-discard, as it already does — no server-side change
needed there). **Additionally, independently**, the client runs its own local
Argon2id derivation (using `salt`/`kdfParams` the server must now also
return) to compute the *same* key for its own use, holds it only in
`SessionProvider` state, and does all AEAD encrypt/decrypt in the browser
using the ciphertext/iv/tag blobs the API already round-trips opaquely (which
is what `resources.ts` already assumes). The server never sees or computes
anything it doesn't already compute today — this is the option requiring the
least server-side change, and the only one under which "the server never sees
or transmits the vault key" (ADR-002 §4.2 step 8, SEC-001) stays true without
qualification.

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
  boundary, key memory lifetime) — all currently `triage`, not yet started —
  and all assume "vault key... received via secure channel" (BR-002c) — that channel
  doesn't exist yet either; those cards are two layers downstream of this
  decision (web app must hold a key before it can hand one to the extension).
- SEC-001 — no amendment needed; this is the option SEC-001 already assumes.

**Acceptance criteria that need rewriting:**
- FE-003d: "decrypts client-side" — **true under B**, no rewrite needed.
- FE-003i: "vault key from unlock" — **true under B** in spirit, though
  technically the key comes from the client's own local derivation *triggered
  by* a successful unlock, not literally "from" the unlock response the way
  A2 would make it; worth a small wording clarification but not a rewrite.
- FE-003e: same gap as under A2 — needs an explicit AC added for client-side
  encryption before POST; currently undocumented regardless of option.

**Library approval gate:** if B is chosen, the specific browser Argon2id
package is **not** this ADR's decision and must not be picked by whoever
implements it. Per the standing "no home-made crypto, approved libraries
only" rule (SEC-001 AR-1): **Architect** proposes a specific library with
written rationale (bundle size, maintenance/audit history, whether its output
matches `KDF_PARAMS` exactly), **QA** reviews and signs off independently,
and the human makes the final call — Architect must not self-approve its own
recommendation. This gate blocks only the *library choice*; it does not
need to block re-litigating A vs B vs the rest of this ADR.

**Tradeoffs:** Matches every existing ADR-002/SEC-001/`resources.ts` statement
about the zero-knowledge boundary — no doc rewrites needed elsewhere, and the
server-side unlock code needs no change at all beyond returning `salt`/
`kdfParams`. Real scope: a new crypto dependency with its own audit/security-
review burden (see library approval gate above), a second AEAD implementation
path (shared with A2), and a non-trivial `/auth/unlock` protocol change
(client needs `salt`/`kdfParams` before or alongside token issuance).

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

This document does not choose between Option A1, A2, and B. That is a
security-posture decision (it changes what SEC-001 can truthfully claim about
the server's trust boundary) and belongs to whoever owns that document —
proposed as Architect + QA per the ADR-006 precedent. No implementation
(browser Argon2 library, `SessionProvider` changes, or endpoint changes) has
been started against any option. If B is chosen, the library-approval gate in
§4 applies before any implementation of that option begins.

---

*Date: 2026-09-28 (updated same day: split "Option A" into A1/A2 after review
— the original draft conflated two server-side key-custody mechanics under
one option without distinguishing whether the vault key itself ever reaches
the browser, which is the actual security-relevant axis) · Author: QA ·
Status: Proposed — awaiting Architect decision*
