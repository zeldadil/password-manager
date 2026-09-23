# FE-002e — Accessibility: Verification Evidence

**Task:** t_7f8643d9 · **Date:** 2026-09-23

## What was verified

### Acceptance Criteria: Form labels, error announcements (aria-live), focus management, keyboard-only operable

**LoginPage.tsx** and **UnlockPage.tsx** implement all required accessibility features:

1. **Form labels (WCAG 1.3.1):** Both email and master password inputs have visible `<label>` elements linked via `htmlFor`/`id`. Tested in `a11y.test.tsx` — 2 tests (1 login + 1 unlock) asserting label tag name, `for` attribute matches input `id`.

2. **Error announcements — aria-live (WCAG 4.1.3):**
   - Auth errors: `<p role="alert" aria-live="assertive">` — announced immediately by screen readers. Tested: 2 tests assert `aria-live="assertive"` and correct text content.
   - Rate-limit countdown: `<p aria-live="polite">` inside `<main aria-live="polite">` — announced politely. Tested: 2 tests assert `aria-live="polite"` on both the countdown and the main landmark.
   - `aria-describedby` links password inputs to their error element (`login-error` / `unlock-error`). Tested: 2 tests assert the linkage.

3. **Focus management (WCAG 2.4.3):**
   - On auth error: focus moves to master password field. Tested: 2 tests assert `toHaveFocus()` on the password input after error.
   - On rate-limit: focus moves to `<main>` landmark. Tested: 2 tests assert `main` has focus.
   - Route change: `RouteFocusManager` moves focus to `<main>` on navigation, does not steal focus on initial load. Tested in `a11y.test.tsx`: 2 tests.

4. **Keyboard-only operable (WCAG 2.1.1):**
   - Enter key submits form from either input. Tested: 2 tests using `user.keyboard('{Enter}')`.
   - Submit button is keyboard-reachable (`type="submit"`), disabled only while loading. Tested: 2 tests.
   - User dropdown closes on Escape, returns focus to toggle. Tested in `a11y.test.tsx`.

### axe-core sweep (routes.a11y.test.tsx — 21/21 passing)
Zero violations on all 10 routes (login, unlock, vault, resource detail, folders, tags, settings, generator, root guard, not-found guard), plus the shell with user disclosure open. Vacuity guards confirm ≥20 graded rules and all `REQUIRED_PASSES` rules pass on every route. Harness sensitivity tests confirm the sweep catches injected defects.

## Test results

```
$ cd apps/web && pnpm vitest run src/a11y/ --reporter=verbose
✓ src/a11y/a11y.test.tsx — 29/29
✓ src/a11y/routes.a11y.test.tsx — 21/21
Total: 50/50 passing
```

- `a11y.test.tsx`: 29 tests covering skip link, document titles (8 routes), focus management, status announcements, keyboard navigation, login form a11y (7 tests), unlock form a11y (7 tests).
- `routes.a11y.test.tsx`: 21 tests — axe-core zero violations on 10 routes + shell, route coverage tied to route table, harness sensitivity (4 mutations), document/rule-set integrity (4 tests).

## Files changed

- `apps/web/src/pages/LoginPage.tsx` — a11y attributes (labels, aria-describedby, aria-live regions, focus refs)
- `apps/web/src/pages/UnlockPage.tsx` — a11y attributes (same pattern)
- `apps/web/src/pages/LoginPage.test.tsx` — existing unit tests (FE-002a + FE-002d), not modified for FE-002e
- `apps/web/src/pages/UnlockPage.test.tsx` — existing unit tests (FE-002b + FE-002d), not modified for FE-002e
- `apps/web/src/a11y/a11y.test.tsx` — new: 29 FE-002e form accessibility tests
- `apps/web/src/a11y/routes.a11y.test.tsx` — modified: SessionProvider wrapping for pre-auth routes

## Commit

`5b05086` — `fix(a11y): repair FE-002e test suite — literal \n, fake-timer deadlock, missing vitest config`

## PR

https://github.com/zeldadil/password-manager/pull/68

## Notes

The implementation (LoginPage.tsx / UnlockPage.tsx) already contained all FE-002e accessibility features — the task's gap was in the test files: (1) literal `\n\n` on line 243 of a11y.test.tsx broke esbuild, (2) rate-limit tests timed out because `vi.useFakeTimers()` was still active when `findByRole` polled (same fix as LoginPage.test.tsx — call `vi.useRealTimers()` first), (3) `vi.advanceTimersByTime(0)` didn't unblock interval ticks. These were fixed and verified.

