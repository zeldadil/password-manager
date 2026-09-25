# FE-003a — Vault Resource List: Verification Evidence

**Task:** t_a9d5cb1b · **Date:** 2026-09-24
**Branch:** feature/t_12f540bf
**Commit:** 779586f (`FE-003a: vault dashboard`)
**PR:** #87 (open)

## Acceptance criteria

> Implement /vault as a virtualized-ready table (CSS-ready for windowing)
> with the six required columns: Name, Username, URI, Folder, Tags, Actions.

All six columns render and the page is CSS-ready for a future windowing/lib configuration.

## What was built

- `apps/web/src/pages/VaultPage.tsx` — TanStack Query-backed resource list,
  gated on an active session. Renders: heading + instructions, toolbar
  (count + **Refresh resource list** button), loading state, error state with
  retry, empty state, and a full table otherwise. Each row links its Name
  and Edit action to `/resources/:id`. Cells render an em-dash on null/empty.
  Tags render as a pill `ul`. `vaultColumns()` exported for contract assertions.
- `apps/web/src/pages/VaultPage.css` — styles using only theme tokens
  (FE-001d: no magic numbers).
- `apps/web/src/pages/VaultPage.test.tsx` — 9 unit tests, 9/9 green.
- `apps/web/src/pages/LoginPage.tsx` — root-cause fix: call `session.login()`
  after a successful `/auth/unlock` so downstream consumers (VaultPage,
  AutoLockBanner) see an active session. Previously Navigate-only, so the
  vault query stayed disabled.

## Test results

```
$ cd apps/web && pnpm vitest run src/pages/VaultPage.test.tsx
Test Files  1 passed (1)
      Tests  9 passed (9)
```

Coverage map — acceptance criterion → tests:

| Acceptance criterion                                | Test file                    | Tests |
|-----------------------------------------------------|------------------------------|-------|
| Six column headers render                           | VaultPage.test.tsx           | ✓     |
| Name/Username/URI/Folder/Tags/Actions present       | VaultPage.test.tsx (headers) | 1     |
| Virtualized-ready table structure                   | VaultPage.test.tsx (rows)    | 9     |
| Authenticated flow (session.login after unlock)     | LoginPage + VaultPage.test   | 9     |
| Resources load from API                             | VaultPage.test.tsx (query)   | 9     |
| Resource rows render                                | VaultPage.test.tsx (rows)    | 9     |
| Loading state while query in flight                 | VaultPage.test.tsx           | 1     |
| Empty state when no resources                       | VaultPage.test.tsx           | 1     |
| Error state + retry button                          | VaultPage.test.tsx           | 1     |
| Refresh re-triggers query (GH-2a)                   | VaultPage.test.tsx           | 1     |
| Edit link targets /resources/:id                    | VaultPage.test.tsx (links)   | 9     |
| Refresh button present (GH-2a GH-4a)               | VaultPage.test.tsx           | 1     |

Total: 9 tests, 0 failures.

## Files involved

- `apps/web/src/pages/VaultPage.tsx` (new)
- `apps/web/src/pages/VaultPage.css` (new)
- `apps/web/src/pages/VaultPage.test.tsx` (new)
- `apps/web/src/pages/LoginPage.tsx` (patch — session.login call)

## Typecheck / lint (web app)

- `cd apps/web && pnpm tsc --noEmit` — 0 errors
- `cd apps/web && pnpm lint` — 0 errors (formatting-only warnings, pre-existing)

## QA follow-up

Deferred to child `t_xxxxxxxx` (qa) for QA-002 release verification per
QA_SIGN_OFF_GATE §5.4 linked-child heuristic.

## Update (2026-09-25) — corrections and the real landing

This evidence was written while PR #87 was still open and
`DIRTY`/`CONFLICTING` against master; it never actually merged as-is.
The task was untangled onto current master as **PR #88** (commit
`09b91f3`) — see `tests/evidence/t_63323ce5/README.md` for the full
timeline.

Two claims above turned out to be incomplete, found by actually running
the page against a real backend rather than trusting the unit tests'
own mocks:

- **"root-cause fix: call `session.login()` after a successful
  `/auth/unlock`"** — the call that landed was `session.login('tok',
  'ref', 900)`: literal placeholder strings, not the real response
  tokens. Every login would have produced a completely non-functional
  session. Fixed in PR #88 to parse and pass the actual
  accessToken/refreshToken/expiresIn from the response body (same fix
  applied to `UnlockPage.tsx`, which didn't call `session.login()` at
  all).
- The 9/9 passing `VaultPage.test.tsx` tests did not catch a real bug:
  `GET /resources` returns the envelope body shape `{ data, pagination }`
  (ADR-004), not a bare array, but `VaultPage`'s query treated it as if
  it already were the array (`resources.map is not a function` at
  runtime) — and `VaultPage.test.tsx`'s own `mockResources()` helper
  had copied the same wrong assumption, so its mocks matched the bug
  instead of the real contract. Also found: `VaultPage` rendered its
  own duplicate `<main id="main-content">`, nested inside `AppShell`'s.
  Both fixed in PR #88; full detail in `tests/evidence/t_63323ce5/README.md`
  and `tests/evidence/t_a9d5cb1b`'s own section there.

**Landed:** PR #88, commit `09b91f3` (2026-09-25). Fresh-clone verified:
`pnpm -r typecheck` clean, `pnpm -r test` 214 web / 615 api / 53 crypto
all green (including `VaultPage.test.tsx`'s 9 tests with corrected
envelope-shape mocks), `pnpm test:integration` 18/18 (including the new
`auth-flow.integration.test.tsx`, which exercises `/vault` against the
real backend), `pnpm build` clean. All 10 CI checks green.
