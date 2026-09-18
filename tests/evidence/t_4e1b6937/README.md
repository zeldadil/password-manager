# FE-001i — Unit tests (t_4e1b6937)

**Task:** FE-001i — "Router guards, API client envelope parsing, theme toggle, layout components covered"
**Branch:** `feature/t_4e1b6937` · **PR:** https://github.com/zeldadil/password-manager/pull/26
**CI:** https://github.com/zeldadil/password-manager/actions/runs/35394746820 — 10/10 checks success
(install-lockfile, lint-typecheck, unit, integration, e2e, dependency-audit, secret-scan, sast, build, Semgrep OSS)

## 1. Why this task needed an integration branch

No parent branch contained the features the acceptance criterion names. The FE stacks are parallel branches off
FE-001a; FE-001i is their fan-in:

| Branch | Task | Provides |
|---|---|---|
| `feature/t_7d365ce0` | FE-001e | router + pages + layout + a11y baseline (test base) |
| `feature/t_e2b31691` | FE-001d | `theme.css` dark default + light variant |
| `feature/t_d19ced15` | FE-001g | typed API client, token store, TanStack Query, Zustand stores |
| `feature/t_f49d448c` | FE-001h | ESLint/Prettier/TS strict, vitest+jsdom+Testing Library, CI |

`master` was merged in as well, and master's 8-job CI workflow kept (FE-001h's branch carried an older 5-job copy
that predates the QA-001b/QA-001d merge).

## 2. Evidence — real execution on the integrated tree

Node 22.23.2 · pnpm 9.12.0 (corepack, as CI does)

```
corepack pnpm@9.12.0 install                 lockfile up to date after regeneration
corepack pnpm@9.12.0 typecheck (tsc -b)      clean
corepack pnpm@9.12.0 lint                    eslint 0 problems · prettier --check all files clean
corepack pnpm@9.12.0 test                    19 files / 143 tests passed
corepack pnpm@9.12.0 test:unit               19 files / 143 tests passed (unit lane)
corepack pnpm@9.12.0 test:integration        no specs yet, exit 0 (passWithNoTests — FE-001j)
corepack pnpm@9.12.0 build                   84 modules, 233.68 kB (gzip 74.91 kB)
```

Baseline before this task's tests: 15 files / 95 tests, 2 RED (integration defects, see §3).
CI run `35394746820` on the pushed head reproduced the unit lane: `Test Files 19 passed (19) · Tests 142 passed (142)`.
Round 2 (post-review fix, see §7) adds one spec: `19 files / 143 tests`.

## 3. Two RED defects found by integrating the parents (fixed here)

1. `src/theme.test.ts` (FE-001d) — hardcoded-color scan false-positived on `white-space: nowrap`
   (`index.css`, added by FE-001e *after* the test was written): the color-keyword alternation matched `white`
   inside the CSS property name. Fixed with a trailing `(?![\w-])` guard; real literals (`#fff`, `red`) still fail.
2. `src/App.test.tsx` (FE-001h) — asserted the scaffold heading, but `App` mounts the router (FE-001b). Rewritten
   to assert the app's real entry behaviour: mounts the router and fails closed to the sign-in screen.

## 4. New unit specs (4 files, 48 tests)

| File | Covers |
|---|---|
| `apps/web/src/routes.guards.test.tsx` | fail-closed redirects (unknown, nested-unknown, parameterless param route), replace-not-push history semantics via Back navigation, pre-auth/authenticated shell boundary across the whole route table, `/login → /vault → /unlock` transitions |
| `apps/web/src/api/envelope.test.ts` | URL normalization, 204 / body-less envelopes, success header with `code >= 400`, non-envelope JSON and non-JSON error payloads, malformed refresh response (session cleared + `onUnauthorized`), `refresh()` without a token, bearer token never echoed into the error (both the refresh-failure and the no-refresh 401 paths — see §7) |
| `apps/web/src/stores/themeToggle.test.ts` | toggle involution, subscriber notification, store ↔ `theme.css` selector/`color-scheme` contract for both modes, in-memory-only on toggle (no storage/cookie/network) |
| `apps/web/src/components/layout/layout.contract.test.tsx` | header navigation + disclosure wiring, shell landmark order + skip-link target, sidebar sections labelled by their headings, three-level folder nesting/order, tag-list order |

**Mutation checks** — each new spec must fail when the behaviour it pins is broken; every mutation was reverted
afterwards (`git status` verified clean, suite green again). Rows M10/M12/M13 are the secret-hygiene sensors
added in round 2 (§7); `tests/evidence/t_4e1b6937/d1_sensitivity.py` re-runs M10/M12/M13 end-to-end and prints
the pass/fail verdict per scenario:

| Mutation | Result |
|---|---|
| `routes.tsx` catch-all `replace` removed | `replaces the guarded history entry instead of pushing a new one` → FAIL (`expected 'PUSH' to be 'REPLACE'`) |
| `client.ts` `header.code >= 400` branch removed | `treats a success-status envelope with code >= 400 as an error` → FAIL |
| `themeStore.ts` toggle flattened to always `light` | `toggleTheme is an involution: dark → light → dark` → FAIL |
| `Header.tsx` `aria-controls` always set | `starts with the user menu collapsed and not referencing a panel` → FAIL |
| `errors.ts` `documentationUrl: body?.documentationUrl ?? 'Bearer <marker>'` (M10) | `never echoes the bearer token into the thrown error` → FAIL, both hygiene specs, `JSON.stringify(error)` observed as `…"documentationUrl":"Bearer <marker>"…`; the **pre-fix** fixture left this mutation 10/10 GREEN (that is the round-1 defect, reproduced) |
| `errors.ts` marker appended to the envelope error `message` (M13) | both hygiene specs → FAIL (`expected 'Unauthorized' to be 'Unauthorized Bearer <marker>'`) |
| `client.ts` marker appended to the *generic* (non-envelope) error `message` (M12) | `normalizes a non-envelope JSON error payload into a generic ApiError` + `normalizes a non-JSON error payload into a generic ApiError` → FAIL (the hygiene specs deliberately exercise the envelope branch only) |

_`<marker>` = the in-memory token marker string used by the specs; no credential appears in this file (SEC-001)._

## 5. Lane split

- `pnpm test:unit` = hermetic unit lane (CI `unit` job); excludes `*.integration.test.*` via CLI `--exclude`.
- `pnpm test:integration` = `vitest run --config vitest.integration.config.ts`. The previous script passed
  `'src/**/*.integration.test.{ts,tsx}'` as a positional filter, which Vitest 5 does not resolve — the lane
  reported "No test files found, exiting with code 0", a green check that ran nothing. Verified fixed with a
  temporary probe spec (integration config ran it; unit lane excluded it), probe removed before commit.

## 6. Findings for the reviewer (not silently "fixed")

1. **No client session guard exists.** Route guards are fail-closed redirects only: nothing redirects a *known*
   screen (`/vault`) when no session exists, and no component/hook reads the token store for routing. FE-001j's
   "auth redirect (unauthenticated → `/login`)" needs that guard to exist (or an explicit decision that the
   fail-closed redirect *is* the guard under test).
2. **No theme toggle control exists.** `useThemeStore.toggleTheme` exists and is tested, but no component renders a
   toggle and nothing writes `data-theme`/`color-scheme` from React, so the light variant is not reachable in the
   running UI. Tests cover the store ↔ stylesheet contract; wiring a control is new feature work.
3. **`WORKTREE_STRATEGY.md` §2 deviation** (same as FE-001f/g/h): the branch is the parents' stack rather than a
   fresh branch off `master`.
4. `FolderTree` silently drops folders whose `parentId` points at a missing folder. Left as-is (documented renderer
   behaviour); worth an architect decision if orphan folders are possible.

_No secret value is reproduced in this file or in the task comments (SEC-001)._

## 7. Round 2 — D1 fix (round-1 review verdict: `fail`)

**Defect (round 1, `qa`):** `apps/web/src/api/envelope.test.ts` → `describe('ApiClient — secret hygiene in errors')`
used `vi.fn().mockResolvedValue(<one Response>)`. A `Response` body can be read only once, so the refresh call
re-read the already-consumed body, `tryReadJson()` (`client.ts`) swallowed the `TypeError` and returned `null`,
`parseErrorResponse` took the non-envelope branch, and the error under assertion was the generic
`ApiError` (`message: 'Request failed with status 401'`, `details: []`) instead of the envelope-derived one.
`not.toContain(<token>)` on a hardcoded generic message is trivially true — the spec could not fail for the leak
it names (M10 left it 10/10 green).

**Fix — test code only (`apps/web/src/api/envelope.test.ts`), no implementation file touched:**

1. The fixture now returns a **fresh `Response` per fetch call**
   (`vi.fn().mockImplementation(() => Promise.resolve(unauthorizedEnvelope()))`), with an inline comment
   recording the shared-`Response` pitfall so it is not reintroduced; the envelope carries **no
   `documentationUrl`**, so a credential stuffed into that fallback field is observable in the thrown error.
2. A **fixture guard** makes the assertion non-vacuous by construction: the spec now asserts the request was
   retried (`toHaveBeenCalledTimes(2)`), the error `message` is the *server* message (`'Unauthorized'`), and
   `kind`/`httpStatus`/`action`/`details` match the envelope. If the fixture ever degrades to the generic
   branch again, the spec fails on the guard rather than passing vacuously.
3. A second hygiene spec covers the **original 401 envelope** reaching the UI when no refresh is attempted
   (access token present, `getRefreshToken() === null`), so both entry points into `apiErrorFromEnvelope` are
   pinned. Helper `buildClient` now takes a `TokenStore` (not only `InMemoryTokenStore`) to allow that fixture.

**Sensitivity harness — `tests/evidence/t_4e1b6937/d1_sensitivity.py`** (applies each mutation to a source file,
runs `vitest run src/api/envelope.test.ts`, restores; exit 0 only if every scenario matches its expectation):

| # | Scenario | Expected | Observed |
|---|---|---|---|
| S0 | fixed spec, no mutation | PASS | PASS — 11/11 |
| S1 | **pre-fix** spec + M10 (token in the `documentationUrl` fallback) | PASS (defect reproduced) | PASS — 10/10 ⇒ the round-1 finding reproduces |
| S2 | **fixed** spec + M10 (same mutation) | FAIL | FAIL — 2 tests; `JSON.stringify(error)` = `{"kind":"http","httpStatus":401,"action":"TestAction","details":[…],"documentationUrl":"Bearer <marker>","name":"ApiError"}` |
| S3 | fixed spec + M13 (token in the envelope error `message`) | FAIL | FAIL — 2 tests |
| S4 | fixed spec + M12 (token in the generic branch `message`) | FAIL | FAIL — the two non-envelope specs |
| S5 | fixed spec, all mutations reverted | PASS | PASS — 11/11, `git status --porcelain` = only this spec modified |

**Re-verification on the fixed tree** (same toolchain as CI, Node 22.23.2 · pnpm 9.12.0):

```
pnpm typecheck        tsc -b Done (clean)
pnpm lint             eslint 0 problems · prettier "All matched files use Prettier code style!"
pnpm test:unit        19 files / 143 tests passed   (+1 spec vs round 1)
pnpm test:integration include src/**/*.integration.test.{ts,tsx} · no specs yet (FE-001j), exit 0
pnpm build            84 modules · 233.68 kB (gzip 74.91 kB)
gitleaks detect --no-git  no leaks found (includes the new evidence script)
```

