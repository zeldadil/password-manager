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
corepack pnpm@9.12.0 test                    19 files / 142 tests passed
corepack pnpm@9.12.0 test:unit               19 files / 142 tests passed (unit lane)
corepack pnpm@9.12.0 test:integration        no specs yet, exit 0 (passWithNoTests — FE-001j)
corepack pnpm@9.12.0 build                   84 modules, 233.68 kB (gzip 74.91 kB)
```

Baseline before this task's tests: 15 files / 95 tests, 2 RED (integration defects, see §3).
CI run `35394746820` on the pushed head reproduced the unit lane: `Test Files 19 passed (19) · Tests 142 passed (142)`.

## 3. Two RED defects found by integrating the parents (fixed here)

1. `src/theme.test.ts` (FE-001d) — hardcoded-color scan false-positived on `white-space: nowrap`
   (`index.css`, added by FE-001e *after* the test was written): the color-keyword alternation matched `white`
   inside the CSS property name. Fixed with a trailing `(?![\w-])` guard; real literals (`#fff`, `red`) still fail.
2. `src/App.test.tsx` (FE-001h) — asserted the scaffold heading, but `App` mounts the router (FE-001b). Rewritten
   to assert the app's real entry behaviour: mounts the router and fails closed to the sign-in screen.

## 4. New unit specs (4 files, 47 tests)

| File | Covers |
|---|---|
| `apps/web/src/routes.guards.test.tsx` | fail-closed redirects (unknown, nested-unknown, parameterless param route), replace-not-push history semantics via Back navigation, pre-auth/authenticated shell boundary across the whole route table, `/login → /vault → /unlock` transitions |
| `apps/web/src/api/envelope.test.ts` | URL normalization, 204 / body-less envelopes, success header with `code >= 400`, non-envelope JSON and non-JSON error payloads, malformed refresh response (session cleared + `onUnauthorized`), `refresh()` without a token, bearer token never echoed into the error |
| `apps/web/src/stores/themeToggle.test.ts` | toggle involution, subscriber notification, store ↔ `theme.css` selector/`color-scheme` contract for both modes, in-memory-only on toggle (no storage/cookie/network) |
| `apps/web/src/components/layout/layout.contract.test.tsx` | header navigation + disclosure wiring, shell landmark order + skip-link target, sidebar sections labelled by their headings, three-level folder nesting/order, tag-list order |

**Mutation checks** (each new spec must fail when the behaviour it pins is broken; all four reverted afterwards):

| Mutation | Result |
|---|---|
| `routes.tsx` catch-all `replace` removed | `replaces the guarded history entry instead of pushing a new one` → FAIL (`expected 'PUSH' to be 'REPLACE'`) |
| `client.ts` `header.code >= 400` branch removed | `treats a success-status envelope with code >= 400 as an error` → FAIL |
| `themeStore.ts` toggle flattened to always `light` | `toggleTheme is an involution: dark → light → dark` → FAIL |
| `Header.tsx` `aria-controls` always set | `starts with the user menu collapsed and not referencing a panel` → FAIL |

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
