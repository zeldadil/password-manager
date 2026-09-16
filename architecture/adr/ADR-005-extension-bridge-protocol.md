# ADR-005: Extension Bridge Protocol

**Status:** Proposed
**Date:** 2026-09-16
**Author:** Architect
**Decision-Makers:** Architect + QA
**References:** ADR-001 (functional patterns), ADR-002 (overall architecture, Section 6), SEC-001 (threat model, Decision 9), PROJECT_BRIEF.md
**Task ID:** ARC-001d

---

## 1. Purpose and Scope

This ADR defines the **extension bridge protocol**: the message types, origin validation rules, permission model, and autofill flow that govern communication between the Web UI (`apps/web/`) and the Firefox WebExtension (`apps/browser-firefox/`).

It is a specialization of ADR-002 Section 6 (Extension Bridge Contract). ADR-002 establishes the contract at the architectural level; this ADR records it as a standalone decision record so that the web and extension teams can work against a single, reviewable specification, and so that QA can verify the bridge implementation against an explicit reference.

**Scope:**
- Message types and their payloads (Section 2)
- Origin validation rules for both sides (Section 3)
- Permission model as it applies to the bridge (Section 4)
- Autofill flow ordered through the bridge (Section 5)
- What the bridge must NOT do (Section 6)
- Bridge vs. API separation (Section 7)
- Passbolt-inspired vs. original decisions (Section 8)

**Out of scope:** The API contract (ADR-004), the data model (ADR-003), the extension manifest and content-script implementation (BR-001), and the full autofill UX (BR-003). This ADR records the *contract* between web and extension — not the implementation of either side.

---

## 2. Message Types

All message types are defined in `packages/shared/` as TypeScript interfaces so that both the web app and the extension import the same types. This is the **only** shared layer between the web app and the extension (per ADR-002 Section 2.3, original decision #2). The bridge does **not** carry secrets — see Section 6.

### 2.1 Message Type Table

| Message type | Direction | Purpose | Payload shape |
|---|---|---|---|
| `EXTENSION_READY` | Extension → Web | Extension initialized, ready to receive lock-state sync and autofill orchestration | `{ version: string }` |
| `LOCK_STATE_CHANGED` | Web → Extension | Notify extension that vault locked or unlocked | `{ state: "locked" | "unlocked", ts: number }` |
| `AUTOFILL_REQUEST` | Extension → Web | Extension detected a login form and asks the web app to surface a credential-selection UI (optional — extension may handle alone) | `{ url: string, fieldSelector: string }` |
| `AUTOFILL_RESPONSE` | Web → Extension | Web returns the selected credential as `{username, password}` only (already decrypted by the web app). Not used if the extension handles the flow alone. | `{ username: string, password: string }` |
| `VAULT_SEARCH` | Extension → Web (optional) | Extension asks the web app to search the vault; web queries the API and returns a filtered list. Not used if the extension searches the API directly. | `{ query: string }` |
| `VAULT_SEARCH_RESPONSE` | Web → Extension (optional) | Web returns a filtered list of resource summaries (metadata only — no secrets). | `{ results: Array<{ id: string, name: string, username?: string, uri?: string }> }` |

### 2.2 Design Notes on Message Types

- **`EXTENSION_READY`** is sent once when the extension's background worker starts. The web app uses it to know the extension is present and can receive `LOCK_STATE_CHANGED` messages. If the web app receives `EXTENSION_READY` after it has already sent lock-state messages, it re-sends the current lock state.
- **`LOCK_STATE_CHANGED`** is the only message that must be sent on every lock/unlock transition. It is the primary mechanism for the extension to stay in sync with the vault state (SEC-001 Decision 9).
- **`AUTOFILL_REQUEST`/`AUTOFILL_RESPONSE`** is the *optional* web-mediated path. The extension may handle the entire autofill flow itself (detect form → popup → select → decrypt → fill) without involving the web app. Both paths are supported by the contract; the message types exist in `packages/shared/` regardless of which path is used at runtime.
- **`VAULT_SEARCH`/`VAULT_SEARCH_RESPONSE`** is also optional. The extension can query the API directly (authenticated with its own JWT session) for search. The web-mediated path exists for cases where the web app holds a different permission context or wants to surface search results in its own UI.

### 2.3 Message Envelope

Every bridge message uses a lightweight envelope so that the receiver can dispatch on `type` and ignore unknown types:

```typescript
interface BridgeMessage {
  type: string; // one of the message types in Section 2.1
  payload: unknown;
  ts?: number; // optional timestamp, for lock-state ordering
}
```

Unknown `type` values are dropped silently (no error, no log of the type that might leak info). This is per ADR-002 Section 6.3 and SEC-001 Decision 9.

---

## 3. Origin Validation

Per SEC-001 Decision 9 and ADR-002 Section 6.3, **every message on the bridge is validated for origin before it is processed.** No message is acted on without verifying the sender.

### 3.1 Extension Side (Background Worker)

The background worker is the receiver of `LOCK_STATE_CHANGED`, `AUTOFILL_RESPONSE`, and `VAULT_SEARCH_RESPONSE`. It applies the following checks to every incoming `postMessage`:

1. **Origin check:** The message's `origin` must exactly match the web app's origin (e.g., `https://vault.example.test`). The origin is configured at build time via an environment variable or manifest constant — it is not guessed from `location.origin` (which could be spoofed in a content script context).
2. **Type check:** The message `type` must be one of the known types from `packages/shared/`. Unknown types are dropped.
3. **No logging of rejected origins:** If the origin does not match, the message is dropped silently. The extension does **not** log the rejected origin (to avoid leaking information about what origins it is expecting).

```typescript
// Pseudocode — exact implementation in BR-001f / BR-002d
browser.runtime.onMessage.addListener((message, sender) => {
  if (sender.origin !== WEB_APP_ORIGIN) return null; // drop silently
  if (!KNOWN_MESSAGE_TYPES.includes(message.type)) return null; // drop silently
  return handleMessage(message);
});
```

### 3.2 Web App Side

The web app is the sender of `LOCK_STATE_CHANGED`, `AUTOFILL_RESPONSE`, and `VAULT_SEARCH_RESPONSE`. It applies the following checks:

1. **Recipient validation:** The web app only sends `postMessage` to the extension's `moz-extension://` URL. The URL is obtained via the `browser.runtime` API (when the web app is opened from the extension context) or via a known extension ID configured at build time. The web app does **not** broadcast to `window` or any wildcard target.
2. **Response verification:** When the web app receives a response from the extension (e.g., `EXTENSION_READY`), it verifies that the response's `source` is the extension (the `moz-extension://` URL). Responses from any other origin are ignored.
3. **No secrets in bridge messages:** The web app must not include the master password, vault key, or any ciphertext in a bridge message payload. The only plaintext that may pass through the bridge is a `{username, password}` pair (already decrypted by the web app) in `AUTOFILL_RESPONSE` — and even that is sent only on explicit user action (Section 5).

### 3.3 Fallback: SameSite=Strict Cookie (Lock-State Only)

If `postMessage` is unavailable (e.g., extension not installed, messaging blocked by the browser), the web app sets a `SameSite=Strict; Secure; HttpOnly` cookie with the current lock state (`locked` or `unlocked`). The extension reads this cookie via `browser.cookies` to determine the vault state.

**Security properties of the fallback:**
- `SameSite=Strict` prevents the cookie from being sent in cross-site requests, reducing the risk of a malicious site reading it.
- `Secure` ensures the cookie is only sent over HTTPS.
- `HttpOnly` prevents JavaScript on the web page from reading the cookie (but note: the extension reads it via the cookies API, not via JavaScript on the page).

**Why the fallback is less secure:** Any extension with the `cookies` permission could read this cookie. It is a fallback only — `postMessage` with origin validation is the primary mechanism. The fallback is documented here (and in SEC-001 Decision 9) so that it can be implemented if needed, but it should not be the default path for a self-hosted app where the user has installed the extension.

### 3.4 What Origin Validation Prevents

| Attack scenario | How origin validation blocks it |
|---|---|
| Malicious web page on a different origin sends a fake `LOCK_STATE_CHANGED` to the extension | Extension rejects because `sender.origin` does not match the web app's origin |
| Malicious extension sends a fake `AUTOFILL_REQUEST` to the web app | Web app ignores responses from origins other than the extension's `moz-extension://` URL |
| Content script on a third-party page tries to send a message to the background worker | Background worker rejects because the content script's origin is not the web app's origin (content scripts have the origin of the page they run on) |
| A site with a reflected XSS tries to send a bridge message | Same-origin policy prevents the injected script from sending `postMessage` to the extension's `moz-extension://` URL |

---

## 4. Permission Model for the Bridge

The bridge does **not** introduce new permissions. It operates within the existing permission model defined in ADR-002 Section 3.1 and SEC-001 Decision 9. This section records the permission implications of the bridge explicitly.

### 4.1 Extension Permissions (Summary)

The extension's manifest requests the minimum permissions needed for its bridge role:

| Permission | Why the bridge needs it |
|---|---|
| `activeTab` | To interact with the active tab when the user invokes autofill (form detection, fill) |
| `scripting` | To inject the autofill icon into a page on user trigger (dynamic injection, not declarative) |
| `storage` | For extension settings only (e.g., API endpoint, auto-lock preference) — **never** the vault key |
| Host permission for the API domain only | To fetch encrypted vault data from the API directly (the extension authenticates with its own JWT session) |

**The extension does NOT request `<all_urls>`.** It cannot fetch from arbitrary sites. It can only fetch encrypted vault data from the API domain. This is a Passbolt-inspired pattern (ADR-001 Section 6) — adapted to our Firefox-first MV3 architecture.

### 4.2 What the Bridge Does Not Grant

- **The bridge is not an authentication channel.** The web app does not grant the extension any API access beyond what the extension's own JWT session provides. The extension authenticates to the API independently.
- **The bridge does not extend the extension's host permissions.** A message from the extension to the web app does not give the extension access to any site the web app can access. The web app's origin is the only destination for bridge messages.
- **The bridge does not let the content script access the vault key.** The content script only receives `{username, password}` from the background worker after the background worker has decrypted. The content script never sees the vault key or any ciphertext.

### 4.3 Permission Model and the Autofill Flow

The autofill flow (Section 5) is designed so that each role operates within its permission boundary:

- **Content script:** Detects forms, relays messages. No secrets. No API access. Runs on pages the user visits — it cannot decrypt anything.
- **Background worker:** Holds the vault key (in memory only). Fetches encrypted data from the API (authenticated). Decrypts. Sends `{username, password}` to the content script.
- **Popup:** UI for the user to select a credential. Queries the API (or the web app) for matching resources. Does not hold secrets.

---

## 5. Autofill Flow (Bridge-Ordered)

This section records the autofill flow that the bridge enables. Full implementation is in BR-003; this section is the architectural contract.

### 5.1 Flow Steps

1. **Form detected.** The content script (declarative content script, static `matches` in manifest) detects a login form (username + password fields) on a page. It injects an icon next to the form via `browser.scripting` (user-triggered dynamic injection, not automatic).

2. **User invokes.** The user clicks the icon (explicit user action — no auto-detect auto-fill). The popup opens.

3. **Popup shows candidates.** The popup queries the API (authenticated with the extension's JWT session) for resources matching the page's URL. It shows a list (or a single resource). If the vault is locked, the popup triggers the unlock flow (BR-002b) before showing candidates.

4. **User selects.** The user clicks a resource in the popup.

5. **Background worker decrypts.** The background worker fetches the encrypted secret from the API, decrypts it with the vault key (in memory), and extracts `{username, password}`. If the vault key is not in memory (e.g., the extension was reloaded), the background worker triggers the unlock flow (BR-002b) before decrypting.

6. **Fill on click.** The background worker sends `{username, password}` to the content script via `browser.runtime.sendMessage`. The content script fills the form fields. **No automatic fill** — the user must click the icon and select a credential. The fill itself is a single `sendMessage` round-trip.

7. **Clear after fill.** The `{username, password}` pair is cleared from the content script's memory after fill. It is not persisted to `storage.local`, `localStorage`, or any persistent store.

### 5.2 Bridge-Mediated Path (Optional)

If the web app surfaces a credential-selection UI (e.g., the user has the web app open and the extension detects a form on a page the web app is displaying), the bridge messages `AUTOFILL_REQUEST` and `AUTOFILL_RESPONSE` are used:

1. Extension (content script) detects form → sends `AUTOFILL_REQUEST` to web app via `postMessage`.
2. Web app surfaces credential-selection UI (or ignores the request if the user has not configured it to do so).
3. User selects a credential in the web app UI.
4. Web app sends `AUTOFILL_RESPONSE` with `{username, password}` to the extension via `postMessage`.
5. Extension background worker relays `{username, password}` to the content script, which fills the form.

This path is **optional**. The extension may handle the entire flow itself without web app involvement. The architectural contract is that **both paths are supported** and the message types exist in `packages/shared/` regardless.

### 5.3 What Autofill Must Not Do

- **No automatic fill.** The extension must not fill a form without an explicit user action (click on the icon or click on a resource in the popup). This is a Passbolt-inspired control (ADR-001 Section 6) — adapted to our Firefox-first MV3 architecture.
- **No fill on page load.** The extension must not fill a form when a page loads, even if the page matches a known login URL. The user must invoke.
- **No silent fill.** The extension must not fill a form without the user seeing which credential was filled. The popup must show the selected resource before the fill happens.
- **No full secret object to the content script.** The content script only receives `{username, password}`. It never receives the full decrypted secret object (which may contain notes, custom fields, TOTP seeds, etc.).
- **No fill on pages that are not login forms.** The content script must not attempt to fill on pages that do not have a detectable login form (username + password fields). It may detect other form types (e.g., signup forms) but must not fill them without an explicit, separate user action.

---

## 6. What the Bridge Must NOT Do

This section is the negative constraint on the bridge. It is recorded here (and in ADR-002 Section 6.6) so that implementors and reviewers have an explicit checklist.

- **Do not carry the master password** between the web app and the extension in any bridge message.
- **Do not carry the vault key** (plaintext or encrypted) between the web app and the extension in any bridge message. The vault key lives in the web app's memory (React state) and/or the extension's background worker memory — never in a bridge message.
- **Do not carry ciphertext** between the web app and the extension in any bridge message. The extension fetches encrypted data from the API directly.
- **Do not allow the extension to trigger autofill without explicit user action.** The user must click the icon and select a credential.
- **Do not allow the content script to access the vault key or any decrypted secret.** The content script only receives `{username, password}` after the background worker has decrypted.
- **Do not allow any origin other than the web app's origin** (extension side) or the extension's `moz-extension://` URL (web side) to send or receive bridge messages.
- **Do not send bridge messages that include tokens, session identifiers, or API credentials.** The extension authenticates to the API with its own JWT session — not with a token passed through the bridge.
- **Do not use the bridge as a persistent channel.** Each message is a discrete `postMessage` round-trip. The bridge does not maintain a persistent connection or stream.

---

## 7. Bridge vs. API: Clear Separation

The bridge and the API are separate channels with separate responsibilities. This separation is an original architectural decision (#5 in ADR-002 Section 8.2) — it prevents the bridge from becoming a backdoor into the API and keeps the extension's API access bounded by its own JWT session.

| Concern | Bridge (`postMessage`) | API (HTTPS REST) |
|---|---|---|
| Lock-state sync | Yes (primary) | No |
| Autofill orchestration | Yes (optional) | No |
| Credential fetch | No (extension fetches from API directly) | Yes |
| Authentication | No (uses extension's own JWT session for API calls) | Yes (JWT + refresh token) |
| Secrets in transit | No | No (only ciphertext in API responses) |
| Message validation | Origin validation (Section 3) | API auth middleware (JWT, permissions) |
| Transport | `postMessage` (same-origin, browser-mediated) | HTTPS (TLS-protected, cross-origin) |

**Key point:** The bridge does not authenticate the extension to the web app. The extension's identity is established by the browser's `moz-extension://` origin and the origin validation check. The extension's access to vault data is governed by its own JWT session with the API — not by any credential passed through the bridge.

---

## 8. Passbolt-Inspired vs. Original Decisions

Per the IP boundary rule (PROJECT_BRIEF.md Section 4, ADR-001 Section 1), each decision in this ADR is flagged as **inspired by Passbolt** (studied from Passbolt's public docs/repo, adapted to our architecture) or **original** (our own design, not derived from Passbolt).

### 8.1 Decisions Inspired by Passbolt (with adaptation noted)

| # | Decision | Passbolt source | Our adaptation |
|---|---|---|---|
| 1 | Message types defined in a shared contract package (`packages/shared/`) | Passbolt's extension and web are separate repos with no shared TS package; their message contract is implicit in the extension code | We use a single shared package with TypeScript interfaces for all bridge messages. **Inspired-by with structural change.** |
| 2 | Origin validation on `postMessage` | Passbolt's extension validates message origins (ADR-001 Section 6) | Same principle; exact origin checks are our own specification (Section 3). **Adapted.** |
| 3 | Minimal extension permissions (`activeTab`, `scripting`, `storage`, host permission for API domain only) | Passbolt's MV3 extension uses the same minimal permission set (ADR-001 Section 6) | Direct adoption. **Adapted.** |
| 4 | Explicit-user-action autofill (no automatic fill) | Passbolt's extension requires user invocation for autofill (ADR-001 Section 6) | Same control. **Adapted.** |
| 5 | Content scripts detect forms and relay; no crypto in content scripts | Passbolt's content scripts are form detection + relay only (ADR-001 Section 6) | Same pattern. **Adapted.** |
| 6 | `AUTOFILL_REQUEST`/`AUTOFILL_RESPONSE` split — web-mediated credential selection is optional | Passbolt's extension handles autofill primarily in the extension; web mediation is not a documented pattern in Passbolt's public docs | We define both paths explicitly in the contract. **Adapted — the message split is our own design, inspired by the principle that the extension can operate independently.** |
| 7 | `SameSite=Strict` cookie fallback for lock-state sync | Passbolt's extension uses cookies for some state sync (not documented in detail in public docs; inferred from extension behavior) | We specify the fallback explicitly (Section 3.3) with security properties. **Inspired-by with explicit specification.** |
| 8 | Bridge does not carry secrets | Passbolt's extension fetches secrets from the API directly (not through the web app) | Same principle. **Adapted.** |
| 9 | Bridge vs. API separation (bridge is orchestration only, not an auth channel) | Passbolt's extension authenticates to the API independently | Same pattern. **Adapted.** |

### 8.2 Decisions That Are Original (not Passbolt-inspired)

| # | Decision | Why original |
|---|---|---|
| 1 | **Lightweight message envelope** (`{ type, payload, ts? }`) with silent drop of unknown types | Passbolt's message protocol is not documented in the same way in its public docs. Our envelope is a minimal, explicit contract for type-safe dispatch. |
| 2 | **`EXTENSION_READY` handshake message** | Passbolt's extension does not document a handshake message. We define `EXTENSION_READY` so the web app knows the extension is present before sending lock-state messages. |
| 3 | **`VAULT_SEARCH`/`VAULT_SEARCH_RESPONSE` message pair** (optional, web-mediated search) | Passbolt's extension searches the API directly. We define an optional web-mediated search path for cases where the web app holds a different permission context. |
| 4 | **Explicit fallback security properties** (Section 3.3) — `SameSite=Strict; Secure; HttpOnly` with a documented statement that the fallback is less secure and is a fallback only | Passbolt's fallback mechanism (if any) is not documented in public docs. Our specification is an original architectural choice for transparency. |
| 5 | **Permission model table for the bridge** (Section 4) — explicit statement that the bridge does not introduce new permissions and does not grant the extension any API access beyond its own JWT session | Passbolt's permission model is documented at a high level (ADR-001 Section 6) but does not include a bridge-specific permission table. Our table is an original artifact for review clarity. |
| 6 | **Bridge vs. API separation table** (Section 7) — explicit comparison of responsibilities | Original artifact for review clarity. Passbolt's separation is implicit; we make it explicit. |

### 8.3 Decisions Explicitly Rejected from Passbolt (cross-reference ADR-001)

See ADR-001 Section "Patterns NOT Adopted" for the full list. The most bridge-relevant rejections for this ADR are:

- **OpenPGP/GPGAuth** → we use symmetric AEAD (SEC-001). The extension does not perform any crypto — it never has.
- **Server-side keyring recovery** → we use a user-managed recovery kit (SEC-001 Decision 7). The bridge does not participate in recovery.
- **Metadata plaintext by default** → we encrypt metadata from V1 (opt-in per resource, ADR-003). The extension's search results (if web-mediated) return metadata that may be encrypted per-resource.

---

## 9. Consequences

### 9.1 Positive

- **Single source of truth for bridge messages.** `packages/shared/` is the only place where message types are defined. Both web and extension import from it. This prevents drift between the web app's expected message format and the extension's sent format.
- **Explicit origin validation rules.** Both sides have a clear, reviewable checklist (Section 3). QA can verify the implementation against this checklist.
- **Explicit negative constraints.** Section 6 is a checklist for reviewers. Any PR that adds a bridge message carrying a secret, or that allows autofill without user action, is rejected by construction.
- **Bridge vs. API separation is explicit.** Section 7 prevents the bridge from becoming a backdoor. The extension's API access is bounded by its own JWT session.
- **Passbolt-inspired decisions are flagged.** Section 8 allows QA to scan for Passbolt code/schemas/config without ambiguity about what is adapted vs. original.

### 9.2 Negative / Risks

- **The `packages/shared/` contract is only as good as the types it contains.** If a message type is missing a field or has the wrong shape, both web and extension will import the wrong contract. The contract must be reviewed as part of any bridge message addition. AR-6 (code review for crypto changes) does not cover bridge message changes — a separate review gate for `packages/shared/` changes may be needed. This is flagged for DOC-001e (doc policy + validation CI).
- **The fallback cookie path (Section 3.3) is less secure.** If the primary `postMessage` path is reliable (it should be for a self-hosted app where the user has installed the extension), the fallback may never be used — but it must still be implemented per SEC-001 Decision 9. Implementors must not treat the fallback as the default path.
- **The `AUTOFILL_REQUEST`/`AUTOFILL_RESPONSE` path is optional.** If the web app does not surface a credential-selection UI, these messages are never used. The contract still must define them (for type safety and future use), but implementors must not assume they are always in play.
- **Origin validation relies on the browser's `postMessage` implementation.** If a browser bug or extension vulnerability allows a malicious page to spoof `sender.origin`, the extension would be tricked. This is an accepted residual risk — the browser's `postMessage` implementation is the trust boundary, and we rely on it as such.

### 9.3 Downstream Impact

- **BR-001f (Message Protocol Implementation):** Must implement the message types from Section 2.1 in `packages/shared/` and the `postMessage` handlers on both sides.
- **BR-002a (Vault Session Sync):** Must implement `LOCK_STATE_CHANGED` and the lock-state sync flow (Section 3, Section 5).
- **BR-002d (Origin Validation):** Must implement the origin validation rules from Section 3 on both sides.
- **BR-002e (Vault Key in Extension Memory):** Must ensure the vault key is held in the background worker's memory only and cleared on lock/reload/sleep — the bridge does not carry the vault key.
- **BR-003 (Autofill):** Must implement the autofill flow from Section 5, respecting the negative constraints in Section 5.3.
- **DOC-001e (Doc Policy + Validation CI):** Should include a lint rule that bans direct crypto imports outside `packages/crypto/` and a check that bridge messages do not carry secrets (by scanning message handler code for secret-field names).

---

## 10. Open Questions (carried into downstream tasks)

1. **Extension ID configuration:** How is the extension's `moz-extension://` URL or extension ID passed to the web app at build time? Is it a manifest constant, an environment variable, or discovered at runtime via `browser.runtime`? **Owner: BR-001f.**
2. **`WEB_APP_ORIGIN` configuration:** How is the web app's origin configured in the extension? Is it a manifest constant, an environment variable, or discovered at runtime? **Owner: BR-001f.**
3. **`AUTOFILL_REQUEST`/`AUTOFILL_RESPONSE` — is the web-mediated path used at all in MVP?** If the web app does not surface a credential-selection UI, these messages are dead code in the contract. **Owner: BR-003 (decide whether to implement the web-mediated path in V1).**
4. **`VAULT_SEARCH`/`VAULT_SEARCH_RESPONSE` — is the web-mediated search path used at all in MVP?** If the extension searches the API directly, these messages are dead code in the contract. **Owner: BR-003 (decide whether to implement the web-mediated path in V1).**
5. **Fallback cookie name and format:** What is the cookie name and what value does it hold? **Owner: BR-002a.**

---

## 11. Sign-off

| Role | Name | Date | Signature |
|---|---|---|---|
| Architect | Architect (Solar Pro4, Upstage) | 2026-09-16 | Signed — reviewed in full |
| QA | (pending) | | |

**Architect sign-off rationale (summary):** This ADR documents the extension bridge protocol — message types, origin validation, permission model, and autofill flow — as required by the acceptance criteria. It references ADR-001 for all Passbolt-inspired patterns and explicitly flags each decision as inspired-by vs. original (Section 8). It references SEC-001 Decision 9 for all bridge security requirements. It references ADR-002 Section 6 as the architectural source for the contract. It does not introduce any new crypto decisions — the bridge carries no secrets, performs no crypto, and the vault key never passes through it. Open questions are flagged for downstream owners.

**QA sign-off is still required.** This ADR is `Proposed` until QA reviews and signs. Downstream tasks (BR-001f, BR-002a, BR-002d, BR-003) are blocked on ADR-005 + ADR-002 + ADR-001 + SEC-001 per the backlog dependency graph.

---

## 12. Changelog

| Date | Change | Author |
|---|---|---|
| 2026-09-16 | Initial draft | Architect |

---

*Date: 2026-09-16 · Author: Architect · Status: Proposed · References: ADR-001, ADR-002, SEC-001, PROJECT_BRIEF.md*
