# PROJECT_BRIEF.md — Secure Password Manager

**Maintained by:** `product` · **Consumed by:** `architect`, `backend`, `frontend`, `browser`, `qa`, `docs`
**Status:** Active
**Last updated:** 2026-09-15

---

## 1. Vision

Build a self-hosted password manager, functionally inspired by Passbolt: encrypted vault, Web UI, Firefox extension,
built by a 6+1-agent Hermes AI team (`product`, `architect`, `backend`, `frontend`, `browser`, `qa`, `docs`).

The product is not a password generator — it is a full password manager: authentication/unlock, vault, resources,
folders, tags, search, secret generation, then browser extension and advanced features.

| Domain | V1 | After V1 |
|---|---|---|
| Vault | Yes — local/self-hosted | Multi-device/sync depending on architecture |
| Resources | Login, password, URL, notes, custom fields (TOTP later) | — |
| Organization | Folders, sub-folders, tags, search | Groups and sharing |
| Security | Encrypted vault, lock/unlock, threat model | Audit, rotation, advanced recovery |
| Browser | Firefox | Chrome/Chromium |
| Import/Export | Architecture prepared | Secure formats |
| Collaboration | Future architecture | Users, groups, permissions |

## 2. This project needs the `browser` agent

This project's scope includes a Firefox WebExtension (capture, controlled autofill) — `architect` should activate
and assign tasks to the `browser` profile (see `SOUL_browser_optional.md`).

## 3. Security sensitivity — security gate required

This project stores user secrets (master password, vault contents, resource secrets). `architect` must run a
security-gate task (threat model + crypto decisions) before any secret-storage code is written, per the generic
Security gate rule in `SOUL_core.md`. See `architecture/adr/` for the live threat model and crypto ADRs once written.

## 4. Reference product & IP boundary

**Reference product:** Passbolt (AGPLv3) — a mature open-source team password manager.
**Constraint:** Passbolt's license (AGPLv3) means we may study its public repo/docs for *functional* inspiration
only. We must never copy its code, file structure, schema definitions, or config verbatim. Every adapted pattern must
be written in our own words and explicitly flagged "inspired by Passbolt" vs. original in our ADRs (see the generic
Reference-product boundary rule in `architect`'s profile).

Functional patterns already extracted and adapted: resource/secret split, folder permission masks, flat tags,
group-as-ARO sharing with client-side re-encryption, 3-level permissions (Read/Update/Owner), MV3 extension
architecture, master-password+KDF auth flow (not OpenPGP), API envelope conventions. Full detail: `ADR-001-functional-patterns-from-passbolt.md`.

Patterns explicitly **not** adopted: OpenPGP/GPGAuth, server-side keyring recovery, PHP/CakePHP stack (we use
TypeScript/Node + React), plaintext-by-default metadata, JSON-schema resource-type registry (fixed types for now),
SSO, LDAP sync, comments, favorites, activity/audit log — all deferred or replaced, see ADR-001 for rationale.

## 5. Stack

TypeScript/Node (API) + React (Web) + Firefox WebExtension (Manifest V3). Monorepo: `apps/web/`,
`apps/browser-firefox/`, `apps/services/api/`, `packages/shared/`.

## 6. Roadmap (4 phases)

| Phase | Goal |
|---|---|
| 0 — AI Team | Hermes team + Kanban + profiles operational |
| 1 — Secure MVP | Vault + auth + resources + folders + tags + generator + search |
| 2 — Browser | Firefox extension + bridge + controlled capture/autofill |
| 3 — Hardening | Security review + QA + backup + audit + performance + docs |
| 4 — Advanced | Chrome + TOTP + sharing + groups + permissions + import/export |

Priority: a small, safe surface rather than a large, fragile product.

## 7. Current backlog

See `backlog.md` at the repo root (Kanban) for the live, decomposed task list — `SEC-001` (security gate) is the
root task, all secret-storage/crypto/bridge work depends on it.

## 8. Open questions / TBD

- Chrome support: deferred to Phase 4.
- TOTP: MVP has it as a stretch goal in the browser extension only (BR-003), not guaranteed in scope.
- SSO/LDAP/sharing/groups: explicitly post-MVP, not to be designed in detail yet.
