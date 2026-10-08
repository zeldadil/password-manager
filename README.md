# Password Manager

Self-hosted, encrypted password manager — built by a Hermes AI team.

## What it is

A Passbolt-inspired password manager focused on a small, safe surface:

- **Encrypted vault** (AES-256-GCM; vault key derived from the master password via
  KDF). **Crypto primitives** (AES-256-GCM AEAD, Argon2id KDF, HMAC-SHA256) implemented
  in `packages/crypto` and used server-side (register/unlock). **Client-side end-to-end
  encryption is not yet wired** — awaiting Option B design approval (t_3f1b0521).
- **Web UI** (React 18 + TypeScript + Vite) for authentication/unlock, resources,
  folders, tags, search and password generation. **Implemented.**
- **Node/TypeScript API backend** (Fastify + Drizzle ORM) with resource, folder, tag
  and health routes. **Implemented.**
- **Firefox WebExtension (Manifest V3)** for capture and controlled autofill, with a
  strict-content-script bridge. **Planned / road map** — the MV3 manifest and bridge
  are designed ([ADR-002](architecture/adr/ADR-002-overall-architecture.md),
  [ADR-005](architecture/adr/ADR-005-extension-bridge-protocol.md)) but the extension
  is not yet merged into `master`.
- **Multi-device sync, groups/sharing, Chrome support, TOTP.** **Planned / road
  map** — deferred to Phase 4 (see [PROJECT_BRIEF.md](PROJECT_BRIEF.md) §6). V1 is a
  local/self-hosted, single-user vault manager.

## What it is NOT

- Not a password generator-first tool — it's a full vault manager (generation is a feature, not the product).
- Not OpenPGP-based — uses symmetric AEAD with a client-derived vault key.
- Not server-side keyring recovery — the server never sees the master password.

See [ADR-001](architecture/adr/ADR-001-functional-patterns-from-passbolt.md) for the full Passbolt functional-pattern audit and what was adopted vs. rejected.

## Stack

| Layer | Technology |
|---|---|
| API | Node.js + TypeScript + Fastify + Drizzle ORM |
| Web UI | React 18 + TypeScript + Vite |
| Firefox Extension | Manifest V3 + Web Extensions API + Web Crypto |
| Shared types | TypeScript `packages/shared/` |
| Crypto primitives | `packages/crypto/` (AEAD, vault, JWT) |
| Database (dev) | SQLite |
| Database (production target) | PostgreSQL |

## Monorepo layout

```
apps/web/                 # React frontend
apps/browser-firefox/     # Firefox MV3 extension (planned)
apps/services/api/        # Node/TypeScript API
packages/shared/          # Shared contracts, types, crypto interfaces
packages/crypto/          # Isolated, audited crypto primitives
tests/e2e/                # End-to-end tests
tests/security/           # Security-focused tests
docs/                     # Documentation
architecture/adr/         # Architecture Decision Records
```

## Prerequisites

- **Node.js 22** (pinned in [`.nvmrc`](.nvmrc), matching `NODE_VERSION` in CI; `engines.node` is `>=22 <23`). The web test suites fail on Node 26 (jsdom's `AbortSignal` conflicts with the `undici`-backed global `fetch`; Node 23–25 untested), so use the pinned version: `nvm use` (or `fnm use`) reads `.nvmrc`.
- **pnpm >= 9** (the repo is pinned to `pnpm@9.12.0` via `packageManager`).
- **Git** for cloning the repository.
- **Firefox** (recent release) if you plan to work on the WebExtension. The extension
  uses Manifest V3, so a current browser is required; a specific minimum version will
  be pinned once the extension ships.
- **Docker** is *not* required for the default local dev path — the V1 dev database is
  SQLite with zero external infrastructure. Docker Compose for a PostgreSQL-based
  setup is documented in the full setup guide.
- **Platform notes:** the toolchain is cross-platform (macOS, Linux, Windows WSL2).
  On Linux you may need `build-essential`/`python3` for native `argon2`/crypto
  dependencies. On macOS, ensure Xcode Command Line Tools are installed. Windows users
  are recommended to use [WSL2](https://learn.microsoft.com/en-us/windows/wsl/) for
  consistency with the team's Ubuntu-based development environment.

## Quick start

A fresh-machine walkthrough that takes under 10 minutes.

`pnpm install` refuses to run on an unsupported Node version (`ERR_PNPM_UNSUPPORTED_ENGINE`, enforced by `engine-strict=true` in `.npmrc`).

```bash
# 1. Clone
git clone https://github.com/zeldadil/password-manager.git
cd password-manager

# 2. Install dependencies
pnpm install

# 3. Configure local environment (SQLite dev DB — optional, sensible defaults exist)
cp .env.example .env.local

# 4. Run the API and the Web UI together
pnpm dev
```

`pnpm dev` starts the API (default `http://127.0.0.1:3000`) and the Web UI
(default `http://127.0.0.1:5173`) in parallel. Open the Web UI in your browser.

### Local environment (`.env.local`)

The local dev server runs with sensible defaults out of the box (SQLite, `PORT=3000`).
Only override what you need. Example values below are **synthetic** — replace with your
own and never commit real secrets:

```bash
# .env.local — synthetic example, do not commit
PORT=3000
HOST=127.0.0.1
NODE_ENV=development
# Optional: development database path (defaults to a local SQLite file)
DATABASE_URL=file:./dev.db
# Optional: auto-lock idle timeout in milliseconds (default 15 minutes)
AUTO_LOCK_TIMEOUT_MS=900000
```

### Common commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Run API + Web UI together (watch mode) |
| `pnpm build` | Build all workspaces |
| `pnpm lint` / `pnpm typecheck` | Lint and type-check all workspaces |
| `pnpm test` / `pnpm test:unit` | Run unit tests |
| `pnpm test:integration` | Run integration tests |
| `pnpm test:e2e` | Run Playwright end-to-end tests |
| `pnpm scan:secrets` | Run gitleaks secret scan over the repo |

### Migrations

```bash
pnpm --filter @password-manager/api migrate
```

See [docs/development/setup.md](docs/development/setup.md) for the full setup guide,
including database migrations, seeding and production configuration. *(Note: the full
setup guide is tracked on a separate task and will land in that path.)*

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
