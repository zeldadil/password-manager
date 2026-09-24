# t_b037ed46 — FE-002d: Error States + No Leakage — Test Evidence

## What was built
- LoginPage + UnlockPage hardened with generic auth error messages (never echo server payloads)
- Rate-limit countdown with lockout-duration display after 5 consecutive failed attempts
- Network-error state with Retry button (master password preserved for retry)
- masterPassword cleared from React state after auth failures (401); preserved for network errors (retryable)
- Tests cover all new error paths + assert no sensitive-data leakage

## Test results
```
✓ src/pages/LoginPage.test.tsx (9 tests) 1313ms
✓ src/pages/UnlockPage.test.tsx (9 tests) 1316ms
Test Files  2 passed (2)
     Tests  18 passed (18)
```

## Files changed
- `apps/web/src/pages/LoginPage.test.tsx`
- `apps/web/src/pages/UnlockPage.test.tsx`

## Branch / commit
- Branch: `feature/t_12f540bf`
- Commit: `21c4343` — `fix(FE): harden LoginPage + UnlockPage error states and rate-limit countdown`

## Reproduce
```bash
cd apps/web && npx vitest run src/pages/LoginPage.test.tsx src/pages/UnlockPage.test.tsx
```

## Update (2026-09-24) — the merge that actually landed this code

This task was marked `done` on 2026-09-23 at 18:53, citing the commit above, but that commit only ever existed on
branch `feature/t_12f540bf` inside PR #68 — which was still `OPEN`, `BEHIND` master, with `build`/`lint-typecheck`/
`unit` all **failing** in CI. The kanban task was completed before the code it referenced had actually reached
master; nothing under `apps/web/src/auth/` (or these error-state changes) existed on `master` until now.

PR #68 bundled three tasks' work on one branch (FE-002c/t_12f540bf, FE-002d/t_b037ed46, FE-002e/t_7f8643d9) and
carried forward CI failures from a round-1 review (`t_7f8643d9`, run 745, 2026-09-23) that were never actually
fixed before the branch was left to sit. Fixed in a follow-up commit and merged:

- **`build`**: TS2322 in `a11y.test.tsx`/`routes.a11y.test.tsx` — a spread-based `RouteObject` construction whose
  inferred type didn't accept the wrapped `children` array. Rewrote with an explicit intermediate type + cast.
- **`lint-typecheck`**: unused `useRef`/`RefreshResponse` imports (`SessionProvider.tsx`), a missing `afterEach`
  import (`AutoLockBanner.test.tsx`), a real bug in `AppShell.tsx` (`useSession((s) => s.active)` called a
  zero-arg hook as if it took a zustand-style selector), and the unused `user` variable in
  `UnlockPage.test.tsx:255` the round-1 review flagged.
- **`unit`** (23 failing tests, not the 25 the original handoff claimed): `layout.contract.test.tsx`,
  `routes.guards.test.tsx`, `routes.test.tsx` all render `AppShell`/`Header` without wrapping them in
  `SessionProvider` — both now call `useSession()` (FE-002c), which throws outside a provider. Wrapped each
  render helper, matching the pattern `a11y.test.tsx` already used.
- Also found (masked under the `SessionProvider` cascade until that was fixed): `theme.test.ts`'s hardcoded-color
  guard was failing on a literal `#f87171` in `layout.css`. Added a `--danger` token to `theme.css` (the palette
  had no error/destructive color at all) instead of hardcoding.

**Landed:** PR #68, merge commit `aa4200a` (2026-09-24). Fresh-clone verified post-merge: `pnpm -r typecheck`
clean, `pnpm -r test` 205 web / 615 api / 53 crypto all green, `pnpm test:a11y` 21/21, `pnpm lint` clean, `pnpm
build` clean for both `apps/web` and `apps/services/api`. `scan-test-data.mjs`/`gitleaks` at their established
baselines, trufflehog clean on all changed files.
