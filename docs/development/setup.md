# Development setup

A step-by-step guide that takes you from a fresh clone to a running API and Web UI,
with a database, and with the tests passing.

- **Verified against:** `master` at `dd7ec14`, on Ubuntu 24.04 (Linux 6.8) with
  Node.js v22.23.3 and pnpm 9.12.0, on 2026-10-10. Every command in this guide was
  run from a fresh clone. Where a command printed something, the output is quoted.
- **Example values:** all emails, passwords and secrets in this guide are
  **synthetic**. Never put real credentials into examples, `.env` files or issues.

> **Implemented vs. planned.** Some steps in the original setup checklist are not
> needed yet, or do not exist yet. They are marked **Planned** below and are
> collected in [Planned / not yet available](#planned--not-yet-available). Do not
> look for them in the repository.
>
> | Topic | Status on `master` |
> |---|---|
> | Node + pnpm workspace install | Implemented |
> | Environment variables (all optional in development) | Implemented |
> | Database: SQLite file, created by the migration command | Implemented |
> | Database: PostgreSQL via Docker Compose | **Planned**. There is no `docker-compose.yml` and no Docker is needed. |
> | Migrations (`migrate`) | Implemented, idempotent |
> | Dev seed data command (`db:seed`) | **Planned**. Does not exist. |
> | `pnpm dev`: API (port 3000) + Web UI (port 5173) | Implemented |
> | OpenAPI document (`/openapi.json`) | Implemented |
> | Swagger UI (interactive API docs page) | **Planned**. Not served. |
> | Web UI talking to the API under `pnpm dev` | **Known gap**: no Vite dev proxy yet ([§7.3](#73-known-gap-web-ui--api-in-local-dev)) |
> | Playwright E2E | Implemented as a browser-matrix smoke test. It does not drive the app yet. |

---

## 1. Prerequisites

| Tool | Required version | Why / source of truth |
|---|---|---|
| **Node.js** | **22.x** (`>=22 <23`) | `engines.node` in `package.json`, and `.nvmrc` (`22`) |
| **pnpm** | **9.12.0** | `packageManager` in `package.json`. Corepack provisions it. |
| **git** | any recent version | to clone |
| **curl** | any | used in the verification steps |
| Docker / Docker Compose | **not required** | the development database is a SQLite file (see [§4](#4-database)) |
| C/C++ build toolchain | normally **not** required | `better-sqlite3` ships prebuilt binaries for Node 22 on common platforms. If `pnpm install` falls back to compiling it, install `python3`, `make` and `g++` (Debian/Ubuntu: `build-essential`). |

### Install Node 22 (example using nvm)

If you already have Node 22, skip this step. With [nvm](https://github.com/nvm-sh/nvm),
run this from the repository root (after cloning, §2). nvm reads `.nvmrc`:

```bash
nvm install      # installs the version in .nvmrc (22)
nvm use          # -> Now using node v22.x.x
node --version   # -> v22.x.x
```

### Enable pnpm through Corepack

Corepack ships with Node and installs the exact pnpm version pinned in
`package.json`:

```bash
corepack enable
pnpm --version   # -> 9.12.0 (run inside the repository)
```

If `corepack enable` fails with a permissions error (for example, with a
system-wide Node), run `npm install -g pnpm@9.12.0` instead.

---

## 2. Clone and install

```bash
git clone https://github.com/zeldadil/password-manager.git
cd password-manager
nvm use            # only if you use nvm
corepack enable
pnpm install
```

This is a **pnpm workspace** (`pnpm-workspace.yaml`). One `pnpm install` at the
repository root installs every package. You do not need extra flags. Workspace
packages:

| Package | Path | What it is |
|---|---|---|
| `@password-manager/api` | `apps/services/api` | Fastify REST API + SQLite (Drizzle ORM) |
| `@password-manager/web` | `apps/web` | React + Vite Web UI |
| `@password-manager/crypto` | `packages/crypto` | Client-side crypto library |
| `@password-manager/shared` | `packages/shared` | Shared TypeScript types and contracts |
| `@password-manager/browser-firefox` | `apps/browser-firefox` | Firefox extension **scaffold only** (manifest, no scripts). The extension is planned. |

`pnpm install` finishes with no errors. On the verification machine, it took about
3 s with a warm pnpm store. A cold store takes longer because it downloads.

---

## 3. Environment variables

**In development you do not need any environment variables.** Every variable has a
default. Skip this section unless you want to override a default.

| Variable | Default | Required? | Description | Synthetic example |
|---|---|---|---|---|
| `PORT` | `3000` | no | API listen port | `3001` |
| `HOST` | `127.0.0.1` | no | API bind interface | `127.0.0.1` |
| `NODE_ENV` | `development` | no | `development` \| `test` \| `production` | `development` |
| `DATABASE_URL` | `./dev.db` | no | SQLite **file path**, relative to `apps/services/api` | `./dev.db` |
| `AUTO_LOCK_TIMEOUT_MS` | `900000` (15 min) | no | Vault auto-lock idle timeout, in milliseconds | `900000` |
| `JWT_SECRET` | built-in development fallback | **yes when `NODE_ENV=production`** | Signing secret for access tokens | generate one: `openssl rand -hex 32` |
| `E2E_BASE_URL` | unset | no | Base URL for Playwright (only for future app-level E2E flows) | `http://localhost:5173` |

### Important: nothing loads `.env` files automatically

The repository has **no dotenv loader and no `--env-file` flag**. A file named
`.env` or `.env.local` has **no effect** unless you export its variables into your
shell yourself. To use a file, run this from the repository root:

```bash
cp .env.example .env.local          # then edit .env.local, with synthetic values only
set -a; . ./.env.local; set +a      # export every variable defined in the file
```

Run the pnpm commands (§5, §7) **in the same shell**. The exports last only for that
shell session. `.env.local` is git-ignored. Do not commit it.

For a one-off override, put the variable in front of the command instead:

```bash
PORT=3001 pnpm --filter @password-manager/api dev
```

**Verified:** with `.env.local` edited to `PORT=3101` and `DATABASE_URL=./dev-alt.db`
and then exported, `migrate` created `apps/services/api/dev-alt.db`, and the API
answered `/health` on port 3101.

### Pitfalls

- `DATABASE_URL` must be a **plain file path** such as `./dev.db`, **not** a
  `file:` URL. `better-sqlite3` treats `file:./dev.db` as a literal path and fails
  with *"Cannot open database because the directory does not exist"*.
- Relative `DATABASE_URL` paths are resolved from `apps/services/api`, because pnpm
  runs the API scripts in that directory.
- `JWT_SECRET` in production: if it is not set when `NODE_ENV=production`, the API
  still starts and `/auth/register` still works, but every request that has to sign
  a token fails closed. For example, `/auth/unlock` returns HTTP 500 with
  `"An internal server error occurred."` (verified), because the code throws
  `JWT_SECRET must be set in production`. Outside production, the API uses a
  hard-coded development fallback. That fallback is **only** for local
  development.

---

## 4. Database

### Implemented: SQLite (no Docker)

The V1 development database is a single **SQLite file**. There is no database
server to start, so you do not need `docker compose up`. The migration command in
§5 creates the file. With the default `DATABASE_URL`, the file is:

```
apps/services/api/dev.db
```

It is git-ignored. To start over with an empty database, stop the API, delete the
file and run the migrations again:

```bash
rm apps/services/api/dev.db
pnpm --filter @password-manager/api migrate
```

### Planned: PostgreSQL via Docker Compose

PostgreSQL is the **production target**. The plan is to switch to it through the
same Drizzle schema during Phase 3 hardening (see `PROJECT_BRIEF.md`, "DB: SQLite
v1 dev → Postgres production-ready"). The repository has **no**
`docker-compose.yml`, `db` service, healthcheck or Postgres driver yet. This
section will document `docker compose up -d db` when that work lands.

---

## 5. Migrations

```bash
pnpm --filter @password-manager/api migrate
```

Expected output (last line):

```
[migrate] All migrations applied successfully.
```

- **Idempotent:** you can run it as often as you like. The second run applies
  nothing and prints the same success line. It exits with code 0 both times
  (verified).
- Applied migrations are recorded in the `__drizzle_migrations` table. On current
  `master` there are 3 migrations (`apps/services/api/migrations/`).
- After migrating, the database contains these tables: `users`, `sessions`,
  `refresh_tokens`, `vaults`, `folders`, `resources`, `secrets`, `tags`,
  `resource_tags`, `groups`, `group_members`, `permissions` (plus
  `__drizzle_migrations`).
- `pnpm dev` does **not** run migrations for you. Run `migrate` after every
  `git pull` that changes `apps/services/api/migrations/`.

**Contributors changing the schema:** edit the Drizzle schema, then generate a new
migration with `pnpm --filter @password-manager/api migrate:generate`. On an
unchanged tree this prints `No schema changes, nothing to migrate` (verified).

---

## 6. Seed data

**Planned. There is no dev seed command yet.** `pnpm db:seed` (or similar) does
**not** exist. A freshly migrated database is empty.

To get a user to work with, register a synthetic account through the API (§8,
step 3). That is the supported way to create local data today.

`tests/fixtures/` (`seed.ts`, factories) is **test-only** code. It generates
deterministic synthetic fixtures for the automated test suites (SEC-001 AR-4,
"Synthetic Fixtures Only"). It does not write to `dev.db`, and there is no command
to load it into the development database.

---

## 7. Run the apps

### 7.1 Everything at once

From the repository root:

```bash
pnpm dev
```

This runs the `dev` script of every workspace package in parallel. In watch mode,
both apps reload on file changes. Expected output (abridged):

```
Scope: 5 of 6 workspace projects
apps/web dev$ vite
apps/services/api dev$ tsx watch src/index.ts
apps/web dev:   VITE v8.x  ready in ~300 ms
apps/web dev:   ➜  Local:   http://localhost:5173/
apps/services/api dev: [api] @password-manager/api v0.1.0 listening at http://127.0.0.1:3000 (development)
```

| App | URL | Port setting |
|---|---|---|
| API | `http://127.0.0.1:3000` | `PORT` / `HOST` |
| Web UI | `http://localhost:5173` | Vite. If 5173 is taken, Vite picks the next free port and prints the URL. |

Stop both with `Ctrl+C`.

### 7.2 One app at a time

```bash
pnpm --filter @password-manager/api dev     # API only, watch mode
pnpm --filter @password-manager/api start   # API only, no watch
pnpm --filter @password-manager/web dev     # Web UI only
```

### 7.3 Known gap: Web UI ↔ API in local dev

The Web UI calls the API with relative URLs (`/auth/*`, `/api/v1/*`), but
`apps/web/vite.config.ts` does not configure a dev proxy. The page loads on port
5173, but its API calls reach the Vite server, not the API on port 3000. As a
result, **login and unlock from the browser do not work yet under `pnpm dev`**.
Until a dev proxy (or an equivalent) is added, use the `curl` checks in §8 to
exercise the API.

### 7.4 Running in production mode (local check only)

```bash
NODE_ENV=production JWT_SECRET="$(openssl rand -hex 32)" \
  pnpm --filter @password-manager/api start
```

This generates a throw-away random secret for the session (tokens become invalid
when you restart). Never commit a secret value.

Verified: the API logs `listening at http://127.0.0.1:3000 (production)`, register
and unlock work, and on `SIGTERM` it logs `[api] SIGTERM received — closing server`
and shuts down cleanly. Use a strong, randomly generated secret for any real
deployment. Never use the example value above. The deployment and runbook
documentation is not part of this guide.

---

## 8. Verification checklist

With `pnpm dev` running (§7.1), open a **second terminal**. All values are
synthetic.

**1. API health**

```bash
curl http://127.0.0.1:3000/health
```

Expected: HTTP 200, `{"status":"ok","version":"0.1.0",...}`

**2. OpenAPI document**

```bash
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:3000/openapi.json
```

Expected: `200 application/json; charset=utf-8`. The API contract is served as
OpenAPI JSON. To browse it, paste it into any OpenAPI viewer. A Swagger UI page is
**planned** and not served by the API.

**3. Register and unlock a synthetic user**

```bash
curl -X POST http://127.0.0.1:3000/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.test","username":"alice","masterPassword":"correct-horse-battery-staple"}'
```

Expected: HTTP 201 with `id`, `email`, `username` and `kdfParams`
(`"algorithm":"argon2id"`). If you register the same email again, you get HTTP 409
`"A user with this email already exists"`. That is expected when you repeat this
checklist against the same `dev.db`.

```bash
curl -X POST http://127.0.0.1:3000/auth/unlock \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.test","masterPassword":"correct-horse-battery-staple"}'
```

Expected: HTTP 200 with `accessToken`, `refreshToken`, `"expiresIn":900` and
`"tokenType":"Bearer"`.

**4. Call an authenticated endpoint**

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:3000/auth/unlock \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.test","masterPassword":"correct-horse-battery-staple"}' \
  | sed -E 's/.*"accessToken":"([^"]+)".*/\1/')

curl -X POST http://127.0.0.1:3000/api/v1/folders \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Synthetic folder"}'

curl http://127.0.0.1:3000/api/v1/folders -H "authorization: Bearer $TOKEN"
```

Expected: the `POST` returns HTTP 201 with the new folder. The `GET` returns HTTP
200 and lists it. Without the `authorization` header, `/api/v1/folders` returns
HTTP 401.

**5. Web UI**

Open `http://localhost:5173` in a browser. The page loads. Browser login does not
work yet ([§7.3](#73-known-gap-web-ui--api-in-local-dev)).

**6. Tests**

Run these in a shell where `pnpm dev` is **not** needed. Stop it first if you like.

```bash
pnpm typecheck     # TypeScript, all packages
pnpm lint          # ESLint + Prettier (web reports a few warnings, 0 errors)
pnpm test          # unit tests (Vitest), all packages
```

On the verification run, all three exited with code 0. `pnpm test` reported
`53 passed` (crypto), `393 passed` (web) and `615 passed` (api).

**7. E2E smoke test (Playwright)**

Install the browsers once. `--with-deps` also installs the operating-system
libraries the browsers need. On Linux it uses `sudo apt-get`:

```bash
pnpm test:e2e:install
pnpm test:e2e
```

Expected: `3 passed`, one per engine (chromium, firefox, webkit). On the
verification machine, `pnpm test:e2e:install` was **not** run because it needs
`sudo`. chromium and firefox passed. webkit failed only because of missing system
libraries (see below), which is exactly what `--with-deps` installs. The current
smoke test (`tests/e2e/smoke.spec.ts`) only proves that each browser engine
launches and renders a DOM. It does **not** start or drive the app. App-level E2E
flows are planned (QA-002), and so is `E2E_BASE_URL`.

If you cannot use `sudo`, install only the browsers with
`pnpm exec playwright install chromium` and run one engine:

```bash
pnpm test:e2e --project=chromium   # verified: "1 passed"
```

If the system libraries are missing, an engine fails with *"Host system is missing
dependencies to run browsers"* and a list of the missing libraries (for example,
WebKit needs `libgtk-4.so.1`). Run `pnpm test:e2e:install`, which uses
`--with-deps`, to fix it.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Error: listen EADDRINUSE: address already in use 127.0.0.1:3000` | Another process (often an earlier `pnpm dev`) holds the port. Stop it, or use another port: `PORT=3001 pnpm dev`. |
| *"Cannot open database because the directory does not exist"* | `DATABASE_URL` is a `file:` URL or points to a missing directory. Use a plain path such as `./dev.db` (§3). |
| API errors about missing tables (`no such table: users`) | Migrations were not run against this database file. Run `pnpm --filter @password-manager/api migrate` with the same `DATABASE_URL` the API uses. |
| Changes in `.env.local` have no effect | The file is not loaded automatically. Run `set -a; . ./.env.local; set +a` in the shell where you run pnpm (§3). |
| `Unsupported engine` / wrong Node version warnings | Use Node 22 (`nvm use`). |
| `pnpm: command not found` or the wrong pnpm version | Run `corepack enable` (§1). |
| Unlock fails with HTTP 500 when `NODE_ENV=production` | `JWT_SECRET` is not set (§3). |
| Browser login does nothing under `pnpm dev` | Known gap, no Vite dev proxy (§7.3). Use `curl`. |

---

## Planned / not yet available

These items are **not implemented** on `master`. This guide will be updated when
the owning tasks land:

- **PostgreSQL via Docker Compose** (`docker compose up -d db`, service healthcheck,
  `docker compose logs db`). The production database target, Phase 3.
- **Dev seed command** (`pnpm db:seed` or similar) to load synthetic demo data into
  `dev.db`.
- **Swagger UI** page for the API. Only `/openapi.json` is served today.
- **Vite dev proxy** (or equivalent) so the Web UI can reach the API under
  `pnpm dev`.
- **App-level Playwright E2E flows** (QA-002) that start the app and use
  `E2E_BASE_URL`.
- **Browser extension** (`apps/browser-firefox` is a scaffold only).
