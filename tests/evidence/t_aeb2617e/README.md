# Evidence — t_aeb2617e: Vite dev proxy so the Web UI reaches the API under `pnpm dev`

Collected on 2026-10-10 on Linux (Node v22.23.2, pnpm 9.12.0, Vite 8.3.0). The base was
`origin/master` at `38f3dae`, with the dev DB created by
`pnpm --filter @password-manager/api migrate`. All credentials are synthetic
(`@example.test`). Tokens are never printed; the harness logs only the key names.

## Change

- `apps/web/dev-proxy.ts`: `createApiDevProxy(env)` returns Vite `server.proxy`
  entries for `^/auth/` and `^/api/v1/`. Target: `API_PROXY_TARGET`, else
  `http://$HOST:$PORT` (the same variables the API reads, so `PORT=3001 pnpm dev`
  stays consistent; a wildcard host maps to 127.0.0.1), else `http://127.0.0.1:3000`.
- `apps/web/vite.config.ts`: `server.proxy: createApiDevProxy(process.env)`.
- `apps/web/dev-proxy.test.ts`: 8 tests (unit lane). Three of them start a **real Vite
  dev server from `vite.config.ts`** in front of a stub API and check that:
  - `POST /auth/unlock` arrives at the API with its body intact;
  - `GET /api/v1/resources` returns API JSON instead of `index.html`;
  - SPA routes are still served by Vite.

## Automated test: RED before, GREEN after

Before `vite.config.ts` was wired (master config), `pnpm exec vitest run dev-proxy.test.ts`
gave `2 failed | 6 passed`:
`expected 404 to be 200` on POST /auth/unlock, and
`expected 'text/html' to contain 'application/json'` on GET /api/v1/resources.
This is exactly the reported bug.

After:

```
 ✓ dev-proxy.test.ts (8 tests) 261ms
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

Full web suites after the change: `pnpm test` 33 files / 401 tests passed;
`test:unit` 358 passed; `test:integration` 43 passed; `test:a11y` 21 passed;
`typecheck` clean; `lint` 0 errors (7 pre-existing warnings in `src/`, none in the
touched files); `build` OK.

## Live `pnpm dev`, real Chromium (Playwright): BEFORE (master `vite.config.ts`)

```
## curl via :5173 (no proxy)
POST :5173/auth/unlock -> 404
GET :5173/api/v1/resources -> 200 text/html
## harness
register via http://localhost:5173/auth/register -> HTTP 404
harness exit 1
```

## Live `pnpm dev`, real Chromium (Playwright): AFTER (this branch)

`node tests/evidence/t_aeb2617e/browser-unlock.mjs` fills the real login form at
`http://localhost:5173/login` and clicks "Sign in". The text in parentheses on the
curl lines was added by hand; everything else is raw output:

```
## curl via :5173 (with proxy)
POST :5173/auth/unlock -> 400 application/json; charset=utf-8      (empty body -> answered by the API's JSON handler, not Vite)
GET :5173/api/v1/resources -> 401 application/json; charset=utf-8  (API auth envelope, not index.html)
GET :5173/unlock (SPA route) -> 200 text/html
## harness
v22.23.2
register via http://localhost:5173/auth/register -> HTTP 201
in-page GET /api/v1/resources (no token): {"status":401,"contentType":"application/json; charset=utf-8"}
final URL: http://localhost:5173/vault
vault h1: Vault
API responses seen by the page:
  {"method":"POST","path":"/auth/unlock","status":200,"contentType":"application/json; charset=utf-8","bodyKeys":["accessToken","refreshToken","expiresIn","tokenType"]}
  {"method":"GET","path":"/api/v1/resources","status":401,"contentType":"application/json; charset=utf-8","bodyKeys":["<non-JSON body>"]}
RESULT: PASS
harness exit 0
```

The `GET /api/v1/resources` response line comes from the harness's own
unauthenticated in-page probe. The page did not make that request (see the known
issue below). Its `<non-JSON body>` marker means the harness's response hook could
not parse that body; I did not investigate why. The status (401) and content type
(JSON) are the API's.

`vault-after-unlock.png` (sha256 `3430a18fcfd3eefc864e6258499b866f46cf53961bc4165373f9f5f88d8c1273`)
shows the result: the user is signed in and on `/vault`.

## Known separate issue (not part of this task): t_76755bb3

After unlock, the Vault page stays on "Loading resources…" and the page itself never
sends `GET /api/v1/resources`. The cause is not the proxy: `ApiClient`
(`apps/web/src/api/client.ts:57`) stores `window.fetch` unbound and calls it as
`this.fetchImpl(...)`, which Chromium rejects with `TypeError: ... Illegal invocation`.
The same pattern was reproduced in Chromium. This is tracked as Kanban card
**t_76755bb3**, routed through `architect` and suggested for `frontend`.

## Reproduce

```bash
pnpm install
pnpm --filter @password-manager/api migrate
pnpm dev                                           # terminal 1
node tests/evidence/t_aeb2617e/browser-unlock.mjs  # terminal 2 (needs: pnpm test:e2e:install)
```
