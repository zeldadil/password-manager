# FE-002g: Integration Tests — QA Evidence

**Task:** t_63323ce5 (FE-002g)
**Landed on master via:** PR #88, commit 09b91f3 (2026-09-25)

## Starting state

This task, along with two siblings under the same lineage — **t_a526419e**
(FE-002h: a11y Tests) and **t_a9d5cb1b** (FE-003a: Vault Dashboard) — had
its real work land on `feature/t_12f540bf`, opened as **PR #87**. That PR
sat `DIRTY`/`CONFLICTING` against master from 2026-09-24 15:40 onward,
because it was branched before PR #68 (FE-002c/d/e) and PR #85 (FE-001k-fu's
coverage fix) were merged into master, and because a live agent (this
task's own run #763, then #765) kept pushing further commits to that same
branch name until it finally stalled overnight (last heartbeat
2026-09-24 22:54, lock reclaimed as stale 2026-09-25 07:02).

Once that run stopped for good, the three tasks' work was untangled onto
current master via `git cherry-pick` (not merge — PR #87's base predates
master's own already-merged fixes) as **PR #88**, in a new branch
(`fe002g-h-fe003a-untangle`). FE-002h's one commit (conflict-marker
resolution) was skipped entirely — master's PR #85 already superseded it
with a real fix, making that commit's own change a no-op. FE-002g's and
FE-003a's commits were kept, then genuinely exercised end-to-end — not
just re-read — which surfaced the material below.

## Acceptance criterion

> Login → vault → lock → unlock flow, token refresh during session,
> rate-limit UI covered

**Met.** `tests/integration/web/` (3 suites, 18 tests, real Fastify
server + real SQLite + real React rendering):
- `auth-flow.integration.test.tsx` (10 tests) — the full login → vault →
  lock → unlock lifecycle, lock idempotency, `/auth/status` correctness,
  no user-enumeration leak, fresh-unlock-after-lock producing a new
  session + rejecting the old refresh token.
- `token-refresh.integration.test.ts` (4 tests) — multi-hop refresh
  rotation, concurrent sessions not interfering, lock→refresh failing,
  re-unlock→refresh working.
- `rate-limit.integration.test.tsx` (4 tests) — backend lockout after 5
  failed attempts, UI countdown rendering and decrementing, form
  re-enabling on expiry.

## The suite was not actually runnable before this task closed — found by trying to run it, not by reading it

`pnpm test:integration` (CI's literal command) could never have reached
these files:
1. `tests/integration/web/vitest.config.ts` referenced a `./setupTests.ts`
   that didn't exist.
2. That same config's `setupFiles`/`include` paths were written as if
   relative to the config file's own directory. Vitest resolves both
   relative to the invocation `root` (repo root), not the config file's
   location — so even with the file created, the path was wrong.
3. `tests/integration/web/` is not a pnpm workspace member. None of the
   packages its test files import directly — `vitest`, `@testing-library/react`,
   `@testing-library/user-event`, `@testing-library/jest-dom`,
   `react-router-dom`, `better-sqlite3`, `drizzle-orm`, `@tanstack/react-query`
   — were resolvable from there under pnpm's strict (non-hoisted)
   `node_modules`.
4. Nothing invoked this config at all. Root `test:integration` only fans
   out to each *workspace package's own* `test:integration` script
   (`pnpm -r --parallel --filter '**'`), which structurally cannot reach
   a directory outside every package.

Fixed all four: created `setupTests.ts` (`import
'@testing-library/jest-dom'`, matching `apps/web`'s own); corrected the
`setupFiles`/`thresholds` import paths to be root-relative; added the
missing packages as root `package.json` devDependencies (same
established pattern as `tests/e2e/` — Playwright is already a root
devDependency for the identical reason); added a `test:integration:web`
script and chained it onto the root `test:integration`, so CI's existing
`integration` job now actually executes these suites.

## Two real bugs found only because the suite could finally run against the real backend

- **`apps/services/api/src/config.ts`**: `new URL('../package.json',
  import.meta.url)` threw `"The URL must be of scheme file"` specifically
  under Vitest's `jsdom` environment (needed here for React rendering,
  while these suites also import the real Fastify server in the same
  process) — `jsdom` shims the global `URL` constructor with browser
  semantics, and building a `file://` URL via `new URL(relative, base)`
  through that shimmed constructor doesn't produce something
  `fs.readFileSync` accepts. Rewritten using `fileURLToPath` + `path.join`,
  which uses Node's own WHATWG URL parsing internally rather than the
  (possibly shimmed) global `URL` class. No behavior change in any other
  environment — verified against `apps/services/api`'s own `node`-environment
  test suite (still 615/615) and the real dev server.
- **`VaultPage.tsx`**: `resources.map is not a function` — `GET
  /resources` returns the ADR-004 envelope body shape `{ data, pagination
  }`, not a bare array. `VaultPage` treated `client.get<ResourceRow[]>(...)`
  as if it already were the array. This is exactly the class of bug an
  integration test against a *real* backend exists to catch — the unit
  tests' own hand-written mocks had copied the same wrong assumption
  (`mockResources([...])` passed a raw array as the envelope body), so
  they never caught it either. Both fixed together (see
  `tests/evidence/t_a9d5cb1b/README.md`).

## Two real timer/async bugs in the suite's own tests

- `rate-limit.integration.test.tsx`, "UI shows rate-limit countdown after
  5 consecutive failed attempts": called `vi.advanceTimersByTime(1)` in a
  loop without ever calling `vi.useFakeTimers()` — threw immediately on
  the first iteration, aborting the test after only 1 of 5 attempts (the
  assertion never actually exercised what it claimed to). Removed — the
  test doesn't assert on decrementing values, it doesn't need fake timers
  at all.
- The adjacent "countdown decrements and form re-enables when it
  expires" test *does* need fake timers (it asserts on the exact
  decrementing display), but used the *synchronous* `advanceTimersByTime`
  around a loop that also waits on real async I/O — `server.inject()`
  running a real argon2id hash comparison. The sync variant advances
  virtual time without yielding to the real event loop, so the pending
  hash never got a chance to resolve and the submit stayed stuck in its
  loading state forever. Switched to `advanceTimersByTimeAsync`, which is
  specifically designed to interleave with real pending work.

## A real production bug this task's own integration suite exposed, fixed in the same PR

`SessionProvider` (FE-002c) was never actually mounted anywhere in the
real app — only inside test files' own isolated route wrappers. Every
authenticated route crashed with `"useSession must be used within
SessionProvider"` (reported live during manual browser testing the day
before this PR). Fixed by mounting it once in `A11yLayout.tsx`, the root
layout every route renders under. `LoginPage`/`UnlockPage` also never
correctly wired the real unlock-response tokens into that session
(`session.login('tok', 'ref', 900)` — literal placeholder strings, not
the response body). Both fixed; see the PR #88 commit message and
`tests/evidence/t_a526419e/README.md` for the full breakdown, since this
bug blocked all three sibling tasks equally, not just this one.

## CI friction after landing — a genuine secret-scan false positive and a genuine flaky test, both fixed and verified live on CI

- `TEST_PASSWORD`/`WRONG_PASSWORD` synthetic constants in the three new
  integration test files tripped gitleaks' `generic-api-key` rule (same
  false-positive class already accepted elsewhere in this repo's
  `.gitleaksignore`, e.g. `auth/security.test.ts`). Recorded with real
  commit-scoped fingerprints. (A first attempt at the explanatory comment
  accidentally quoted the literal flagged pattern and got flagged itself
  — corrected.)
- `AutoLockBanner.test.tsx`'s "disables the extend button during the
  refresh in-flight" test (pre-existing, unrelated to this task's own
  files) only asserted the immediate disabled state and returned without
  waiting for its mocked fetch's real 100ms `setTimeout` to resolve —
  that resolution's state update then fired after the test's jsdom
  environment had torn down, throwing an unhandled `ReferenceError:
  window is not defined` that failed the whole CI `unit` job even though
  all 214 individual assertions passed. Fixed by waiting for the expected
  post-resolution UI state before the test ends.

## Verification run (2026-09-25, fresh clone at commit 09b91f3)

```
pnpm install         — clean
pnpm -r typecheck     — clean (apps/services/api, apps/web, packages/crypto)
pnpm -r test          — 214 web / 615 api / 53 crypto, all passing
pnpm test:integration — the literal CI command: api's own integration
                         suite + tests/integration/web/ (18 tests), all
                         passing
pnpm test:a11y        — 21/21
pnpm build            — clean for both apps/web and apps/services/api
```

Also verified live on GitHub Actions (not just locally): all 10 CI
checks green on the final push (`secret-scan`, `unit`, `integration`,
`e2e`, `build`, `lint-typecheck`, `sast`, `Semgrep OSS`,
`dependency-audit`, `install-lockfile`) — `mergeStateStatus: CLEAN`.

## Security

No real secret, credential, or PII in this file, the reviewed diff, or
the merged code. `TEST_PASSWORD`/`WRONG_PASSWORD` constants in the new
suites are synthetic (descriptive names, `.test` email domains
alongside them), matching AR-4.

## Verdict

`pass` — see `QA-VERDICT` comment on this card.
