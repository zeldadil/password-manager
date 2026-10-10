# QA evidence — t_99248680: independent verdict for t_aeb2617e (Vite dev proxy, PR #145 → b1db88f)

Collected 2026-10-10 by the `qa` profile, on a fresh `git clone` of
`https://github.com/zeldadil/password-manager` with `origin/master` = `b1db88f`
(`git ls-remote` tip = `b1db88fa694fe47331628b24c6d10321209fad39`). Node v22.23.3, pnpm 9.12.0
(`pnpm install --frozen-lockfile`, exit 0). Linux host.

Verdict: **pass**. The implementer's evidence lives in `tests/evidence/t_aeb2617e/`.
This directory holds QA's own re-execution and does not reuse it.

## 1. Delivery on master

- `git merge-base --is-ancestor b1db88f origin/master`: true. b1db88f is the master tip.
- Push CI run 38085436514: `conclusion=success`, `headSha=b1db88f…`. All 9 jobs succeeded
  (sast, install-lockfile, secret-scan, e2e, lint-typecheck, integration, build, unit, dependency-audit).
- The code matches the claim. `apps/web/vite.config.ts` sets `server.proxy: createApiDevProxy(process.env)`.
  `apps/web/dev-proxy.ts` proxies `^/auth/` and `^/api/v1/`. The target is chosen in this order:
  1. `API_PROXY_TARGET`
  2. `http://HOST:PORT`, where a wildcard host becomes 127.0.0.1
  3. `http://127.0.0.1:3000`

  The QA card body lists this order backwards. The code, the PR handoff and `api/src/config.ts` all agree with the order above.

## 2. Unit and real-Vite tests (`vitest-devproxy.log`, `mutation.txt`, `mut.sh`)

- `cd apps/web && npx vitest run dev-proxy.test.ts`: **8/8 passed**.
- Mutation check: I swapped in `vite.config.ts` from `b1db88f^`, the config before the fix.
  The run gave **2 failed / 6 passed**:
  - `expected 404 to be 200` on POST /auth/unlock
  - `expected 'text/html' to contain 'application/json'` on GET /api/v1/resources

  After restoring the file, the run gave 8/8 again. The real-Vite-server tests therefore detect the bug.

- `pnpm typecheck` (apps/web) exit 0. `eslint dev-proxy.ts dev-proxy.test.ts vite.config.ts` exit 0.

## 3. Live `pnpm dev` + real Chromium (`live-default.txt`, `live-port3301.txt`, `live.sh`)

The reviewer of round 1 did not run this step. QA ran it twice:

| Run      | API env                                                 | migrate | harness `browser-unlock.mjs` |
| -------- | ------------------------------------------------------- | ------- | ---------------------------- |
| default  | PORT/HOST/API_PROXY_TARGET unset → 127.0.0.1:3000       | exit 0  | `RESULT: PASS`, exit 0       |
| port3301 | `PORT=3301` for both API and Vite (via root `pnpm dev`) | exit 0  | `RESULT: PASS`, exit 0       |

In both runs:

- register through :5173 returned 201.
- The login form returned POST /auth/unlock **200**, with body keys `accessToken, refreshToken, expiresIn, tokenType`.
- The final URL was `/vault`, with h1 `Vault`.
- The in-page `GET /api/v1/resources` returned the API's JSON 401 envelope, not `index.html`.

The second run proves the PORT path of the target resolution end to end.

Screenshot: `vault-after-unlock-default.png`, sha256
`3430a18fcfd3eefc864e6258499b866f46cf53961bc4165373f9f5f88d8c1273`. It shows /vault signed in,
with the Lock and Account buttons and "Loading resources…".

Caveat: these bytes are identical to the implementer's committed screenshot. The page renders deterministically,
so the same bytes are expected. The screenshot therefore corroborates the run but does not prove it on its own.
The primary evidence is the harness transcript.

## 4. Boundary and abuse cases (same transcripts)

| Request via :5173                                                          | Result                     | Assessment                                                                              |
| -------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------- |
| `/login`, `/vault`, `/authors`, `/auth` (no slash), `/api/v2/x`, `/health` | 200 text/html (Vite)       | correct: only the anchored prefixes are proxied                                         |
| POST `/auth/unlock` with `Host: evil.example.test`                         | 403 text/plain             | Vite's host check blocks DNS-rebinding-style requests, and the proxy does not weaken it |
| `/auth/../health`, `/auth/%2e%2e/health` (`curl --path-as-is`)             | 200 application/json (API) | informational, see below                                                                |

Informational, not blocking: a `..` segment after the proxied prefix still reaches other API routes (here
`/health`). It crosses no trust boundary. This is a dev-only server, and the API it reaches already listens
directly on loopback with its own auth. Production uses a reverse proxy, not this config. No card was filed.

Secret hygiene: the dev-server log mentions `masterPassword` once. That mention is the API's schema-validation
message for the deliberately empty-body curl probe (`body must have required property 'masterPassword'`), so it
names the field, not a value. Neither the synthetic password nor any token value appears in the log. The harness
prints only key names. This directory commits no dev log.

## 5. Out of scope / follow-ups

- Vault list stuck on "Loading resources…": **t_76755bb3** (ApiClient unbound `fetch`), already filed.
- t_aeb2617e's third acceptance line says docs will remove the README Quick Start "Known gap" note after the merge.
  No docs card for that exists on the board yet. It is a docs action, not part of the FE deliverable.
  It is flagged on the card for the owner to file.

## Reproduce

`live.sh` and `mut.sh` are committed as run. They hard-code the QA scratch workspace path in `W=`, so edit `W`
before running them elsewhere. Then:

1. `bash mut.sh`
2. `bash live.sh default`
3. `bash live.sh port3301 3301`

Requirements: Node 22 on PATH, a free port 5173, and Playwright Chromium installed.
