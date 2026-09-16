# Password Manager

Self-hosted, encrypted password manager — built by a Hermes AI team.

## What it is

A Passbolt-inspired password manager focused on a small, safe surface:

- Encrypted vault (AES-256-GCM, vault key derived from master password via KDF)
- Web UI (React + TypeScript + Vite)
- Firefox WebExtension (Manifest V3) for capture and controlled autofill
- Node/TypeScript API backend

## What it is NOT

- Not a password generator-first tool — it's a full vault manager
- Not OpenPGP-based — uses symmetric AEAD with a client-derived vault key
- Not server-side keyring recovery — the server never sees the master password

See [ADR-001](architecture/adr/ADR-001-functional-patterns-from-passbolt.md) for the full Passbolt functional-pattern audit and what was adopted vs. rejected.

## Stack

| Layer | Technology |
|---|---|
| API | Node.js + TypeScript + Fastify/Express + Drizzle ORM |
| Web UI | React 18 + TypeScript + Vite |
| Firefox Extension | Manifest V3 + Web Extensions API + Web Crypto |
| Shared types | TypeScript packages/shared/ |
| Database (dev) | SQLite |
| Database (production target) | PostgreSQL |

## Monorepo layout

```
apps/web/                 # React frontend
apps/browser-firefox/     # Firefox MV3 extension
apps/services/api/        # Node/TypeScript API
packages/shared/          # Shared contracts, types, crypto interfaces
tests/e2e/                # End-to-end tests
tests/security/           # Security-focused tests
docs/                     # Documentation
architecture/adr/         # Architecture Decision Records
```

## Quick start

Prerequisites: Node.js >= 20, pnpm >= 9.

```bash
pnpm install
pnpm dev
```

See [docs/development/setup.md](docs/development/setup.md) for full setup instructions.

## Security

This product stores user secrets. Every architectural and implementation decision is gate-checked against the threat model.

- Threat model + crypto decisions: [SEC-001](architecture/adr/SEC-001-threat-model.md)
- Security overview and disclosure policy: [SECURITY.md](SECURITY.md)
- All ADRs: [architecture/adr/](architecture/adr/)

**No real credentials, keys, or secrets are ever committed to this repository.**

## ADRs (so far)

| ADR | Title | Status |
|---|---|---|
| ADR-001 | Functional patterns from Passbolt (inspired / rejected) | Accepted |
| ADR-002 | Overall Architecture (monorepo, service boundaries, data flow, crypto boundary, extension bridge) | Proposed |
| ADR-003 | Data Model (User, Vault, Resource, Folder, Tag, Permission, Group) | Proposed |
| ADR-004 | API Contract (OpenAPI 3.1 skeleton) | Proposed |
| ADR-005 | Extension Bridge Protocol (message types, origin validation, autofill flow) | Proposed |
| SEC-001 | Threat Model + Security Gate (7 vectors, 9 crypto decisions) | Proposed |

See [architecture/kanban/backlog.md](architecture/kanban/backlog.md) for the live task graph.

## License

AGPLv3 — see [LICENSE](LICENSE) (to be added).
