# ADR-001: Functional Patterns Inspired by Passbolt

**Status:** Accepted
**Date:** 2026-09-14
**Author:** Architect
**Decision-Makers:** Architect + QA

## Context

We are building a self-hosted password manager with a 6-agent Hermes AI team. Passbolt (AGPLv3) is a mature open-source password manager for teams. We may study its public repository and documentation for **functional inspiration only** — resource/folder/tag/group/permission concepts, high-level flows. We must **never** copy its code, file structure, schema definitions, or config verbatim. Every design decision must be written in our own words and adapted to our own architecture and threat model.

This ADR documents the functional patterns we extract from Passbolt as inspiration, explicitly flagging each as "inspired by Passbolt" vs. original to our project.

## Functional Patterns Extracted (Inspired by Passbolt)

### 1. Resource Model (Inspired by Passbolt)

**Passbolt pattern:** Resources are split into two entities:
- **Resource (metadata):** searchable fields — name (required), username, URI, description — stored in plaintext (or optionally encrypted in v5+)
- **Secret (encrypted payload):** password (required), description, custom fields — encrypted client-side with OpenPGP, signed by sender

**Resource types** (JSON schemas) define what fields belong to resource vs. secret. Examples: `password-and-description`, `username-password-uri`, TOTP, secure notes, custom fields.

**Our adaptation:** We adopt the **resource/secret separation** concept but will use our own AEAD construction (per SEC-001) instead of OpenPGP. Resource types become extensible schema definitions in our API. Metadata encryption is opt-in from V1 (not a later add-on).

### 2. Folder Hierarchy & Permission Masks (Inspired by Passbolt)

**Passbolt pattern:**
- Folders form a tree (parent/child), each with an owner permission (type 15 = Owner, 7 = Update, 1 = Read)
- Folder permissions act as **permission masks** — when a user creates/moves a resource into a folder, the folder's permission mask is applied to that resource *where possible*
- "Where possible" = only resources the user has Owner permission on; exceptions allowed (user may have more/less rights on item than folder)
- Folders do **not** enforce permissions continuously — only at create/move time
- Moving a shared folder into another shared folder: intersecting permissions removed, destination folder's permissions applied

**Our adaptation:** We adopt the **permission mask** concept for folder→resource permission propagation at create/move time. We simplify: three permission levels (Owner/Update/Read) mapped to our own RBAC. No continuous enforcement — explicit propagation on write operations only.

### 3. Tags (Inspired by Passbolt)

**Passbolt pattern:**
- Tags are flat (non-hierarchical), many-to-many with resources
- One resource → many tags; one tag → many resources
- Used as a secondary organization dimension orthogonal to folders
- Filterable in UI, searchable via API

**Our adaptation:** Direct adoption — flat tag system, many-to-many with resources, searchable/filterable. No hierarchy.

### 4. Groups & Sharing (Inspired by Passbolt)

**Passbolt pattern:**
- Groups = containers of users (many-to-many via `groups_users` junction with `is_admin` flag)
- Groups function as **AROs (Access Request Objects)** in ACO/ARO permission model
- Permissions granted to groups for resources/folders → all members inherit
- **Critical constraint:** Only a user with access to a secret can share it (must re-encrypt for new recipient)
- Adding user to group with shared resources → API returns `secretsNeeded` (dry-run) → client encrypts each secret with new user's public key → sends back in update
- Group deletion blocked if group is sole Owner (type 15) of any resource/folder

**Our adaptation:** We adopt the **group-as-ARO** model and **client-side re-encryption on membership change** for E2E encryption. Our crypto uses symmetric vault keys (per SEC-001) — group sharing = wrapping vault key for each member. Sole-owner protection on deletion adopted.

### 5. Permission Levels (Inspired by Passbolt)

**Passbolt pattern:** Three levels, bitmask-style:
- `1` = Read (view metadata + secret)
- `7` = Update (read + edit metadata/secret + delete)
- `15` = Owner (update + manage permissions/share)

**Our adaptation:** Same three levels, same semantics. Implemented as enum in our permission schema.

### 6. Browser Extension Architecture (Inspired by Passbolt)

**Passbolt pattern:**
- Extension required for: cryptographic integrity, secure RNG, autofill, capture
- Manifest V3 (service worker background)
- Content scripts detect login forms, inject UI, communicate with background via `runtime.sendMessage`/`onMessage`
- Popup (action) for quick access, search, create, autofill trigger
- **Security controls:** Origin validation on messages, minimal permissions (`activeTab`, `scripting`, `storage`, host permissions for API domain), CSP strict
- Autofill: controlled — user must invoke (click icon in form or popup), not automatic

**Our adaptation:** Firefox-first WebExtension (MV3). Shared contract layer (`packages/shared`) for message types, validation logic. Background service worker holds vault session state. Content scripts only detect forms + relay; no crypto in content scripts. Explicit user action required for autofill (no silent fill).

### 7. Authentication Flow (Inspired by Passbolt)

**Passbolt pattern (GPGAuth legacy → JWT preferred):**
- **Server verification (optional):** Client challenges server with encrypted token → server decrypts → proves identity via header
- **Client verification:** Client sends keyid → server returns encrypted challenge → client decrypts → sends back → server validates → issues JWT access + refresh tokens
- Session cookie + CSRF token for browser clients
- MFA: TOTP, YubiKey, Duo — challenge returned in login response

**Our adaptation:** We use **master password + KDF → vault key** (per SEC-001), not OpenPGP. Session = JWT (short-lived) + refresh token (rotation). No server identity challenge (our threat model differs). MFA: TOTP only in MVP.

### 8. API Envelope & Conventions (Inspired by Passbolt)

**Passbolt pattern:**
- Every response: `{ header: { id, status, servertime, action, message, url, code }, body: ... }`
- `contain[]` query params for eager loading relations (permissions, favorites, groups, GPG keys)
- `filter[]` for search/filter
- Soft delete (`deleted` boolean) on all entities
- UUIDs for all IDs

**Our adaptation:** Same envelope structure (header/body). `include[]` instead of `contain[]` (naming preference). Soft delete, UUIDs, pagination standard.

---

## Patterns NOT Adopted (Explicitly Rejected)

| Passbolt Pattern | Reason |
|-----------------|--------|
| OpenPGP / GPGAuth | Our threat model uses symmetric vault encryption with master password (SEC-001) |
| Server-side keyring / account recovery via server | We keep zero-knowledge; recovery = user-managed backup kit |
| PHP/CakePHP stack | Our stack: TypeScript/Node (API) + React (Web) + WebExtension |
| Metadata plaintext by default | We encrypt metadata from V1 (opt-in per resource) |
| Complex resource types via JSON schema registry | We start with fixed resource types; extensibility later |
| SSO (SAML/OIDC) | Post-MVP |
| Directory sync (LDAP) | Post-MVP |
| Comments on resources | Post-MVP |
| Favorites/starred | Post-MVP (simple boolean flag in V1) |
| Resource activity/audit log | Post-MVP |

---

## Consequences

### Positive
- Proven UX patterns for resource/folder/tag/group/permission model
- Clear separation of concerns (metadata vs. secret, folder mask vs. item permission)
- Battle-tested extension architecture with security controls
- API conventions that scale

### Negative / Risks
- Must constantly guard against AGPLv3 contamination — no code/schema/config copying
- Passbolt's OpenPGP model differs fundamentally from our symmetric vault model — sharing/group logic must be re-designed for key wrapping
- Folder permission mask "where possible" introduces UX edge cases we must document clearly

---

## Validation

- SEC-001 threat model and crypto decisions must be signed off before any implementation
- ARC-001 architecture ADR will reference this ADR for data model decisions
- QA will verify no Passbolt code/schemas/config appear in our repo (automated scan in CI)

---

## References

- Passbolt API docs: https://www.passbolt.com/docs/api/
- Passbolt authentication: https://www.passbolt.com/docs/development/authentication
- Passbolt resources: https://www.passbolt.com/docs/development/resources/creating
- Passbolt sharing: https://github.com/passbolt/passbolt-docs/blob/main/docs/development/resources/sharing.mdx
- Passbolt roles/permissions: https://www.passbolt.com/docs/admin/user-provisioning/roles-and-permissions/
- Passbolt folders blog: https://www.passbolt.com/blog/introducing-the-new-folders-feature
- Passbolt security whitepaper: https://passbolt.com/docs/files/security_white_paper_-_passbolt_pro_edition_v5.10_-_(march_2026_-_rev10).pdf
- Passbolt browser extension repo: https://github.com/passbolt/passbolt_browser_extension