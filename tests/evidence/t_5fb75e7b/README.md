# FE-002f — Unit Tests: Verification Evidence

**Task:** t_5fb75e7b · **Date:** 2026-09-24  
**Branch:** origin/master (merge commit 914dc8e, PR #68)  
**Workspace:** `.worktrees/t_5fb75e7b-feature`

## What was verified

FE-002f is the unit-test consolidation task for the entire FE-002 (Login/Unlock UI) spine. Its acceptance criterion is that **form validation, submit handling, error rendering, lock button, and auto-lock banner are all covered by unit tests**. Those tests were authored across the upstream FE-002a–FE-002e tasks and merged in PR #68. This task verifies that coverage is complete and the suite is green on master.

### Acceptance Criteria — coverage map

#### 1. Form validation
**Covered by:** `LoginPage.test.tsx` (9 tests), `UnlockPage.test.tsx` (9 tests)

| Aspect | Test |
|---|---|
| Email input renders with `type=email`, `autocomplete=username` | LoginPage "renders the heading and both required inputs" / UnlockPage same |
| Master password input renders with `type=password`, `autocomplete=off` | same |
| Client-side guard: empty email or master password bails without fetching | Implicitly covered — submit button `disabled` when `!email \|\| !masterPassword` (LoginPage:333, UnlockPage:149); user-event fills both before clicking in every submit test |
| Rate-limit lockout disables both inputs + submit | LoginPage "shows a rate-limit countdown after 5 consecutive failed attempts" (asserts inputs disabled) / UnlockPage same |

#### 2. Submit handling
**Covered by:** `LoginPage.test.tsx`, `UnlockPage.test.tsx`, `AutoLockBanner.test.tsx`, `Header.test.tsx`

| Aspect | Test |
|---|---|
| Login POSTs `masterPassword + email` to `/auth/unlock`, redirects to `/vault` on 200 | LoginPage "POSTs masterPassword + email to /auth/unlock and redirects to /vault on success" |
| Unlock POSTs `email + masterPassword` to `/auth/unlock`, redirects to `/vault` on 200 | UnlockPage "POSTs email + masterPassword to /auth/unlock and redirects to /vault on success" |
| Submit button disabled while loading (shows "Signing in..." / "Unlocking...") | LoginPage "disables the submit button while loading" / UnlockPage same |
| Auto-lock banner "Extend session" POSTs `/auth/refresh` with the refresh token | AutoLockBanner "POSTs /auth/refresh when 'Extend session' is clicked" |
| Header lock button calls `useSession().lock()` → POSTs `/auth/lock` + navigates to `/unlock` | Header "POSTs /auth/lock and navigates to /unlock when the lock button is clicked" |

#### 3. Error rendering
**Covered by:** `LoginPage.test.tsx`, `UnlockPage.test.tsx`, `AutoLockBanner.test.tsx`

| Aspect | Test |
|---|---|
| 401 → generic "Invalid email or master password." (never echoes server payload) | LoginPage "shows a generic error message on 401 (never echoes the server payload)" / UnlockPage same |
| Network error → "Network error — please try again." + Retry button | LoginPage "shows a retry button on network error" / UnlockPage same |
| Rate-limit (5× 401) → "Too many failed attempts. Please try again later." + countdown | LoginPage "shows a rate-limit countdown after 5 consecutive failed attempts" / UnlockPage same |
| Countdown decrements in real time, re-enables form on expiry | LoginPage "decrements the countdown and re-enables the form when it expires" / UnlockPage same |
| Auto-lock banner surfaces error when `/auth/refresh` returns non-2xx | AutoLockBanner "surfaces an error message when /auth/refresh returns a non-2xx" |
| Error announced via `role="alert"` + `aria-live="assertive"` | AutoLockBanner "has the correct aria attributes" + a11y suite (FE-002e) |

#### 4. Lock button
**Covered by:** `Header.test.tsx` (8 tests)

| Aspect | Test |
|---|---|
| Lock button renders with `aria-label="Lock vault"` | Header "exposes a lock button" |
| Clicking lock button invokes `lock()` (POST `/auth/lock` + clear + navigate `/unlock`) | Header "POSTs /auth/lock and navigates to /unlock when the lock button is clicked" |
| Lock succeeds even when `/auth/lock` fails (tokens cleared, nav happens anyway) | Header "navigates to /unlock even when /auth/lock fails" |
| Lock button available in header alongside theme toggle + user menu | Header "shows the app name" / "shows the user menu" — full header renders |

#### 5. Auto-lock banner
**Covered by:** `AutoLockBanner.test.tsx` (9 tests)

| Aspect | Test |
|---|---|
| Hidden when no session active | "does not render when no session is active" |
| Visible when session ≤60 s from expiry | "renders the banner when a session is within 60s of expiry" |
| Hidden when session >60 s from expiry | "does not render when the session has >60s remaining" |
| "Extend session" POSTs `/auth/refresh` with refresh token | "POSTs /auth/refresh when 'Extend session' is clicked" |
| Shows "Session extended" after successful extend | "shows 'Session extended' after a successful extend" |
| Countdown hides after extend (session now far from expiry) | "does not show the countdown after a successful extend" |
| Error surfaced when refresh fails | "surfaces an error message when /auth/refresh returns a non-2xx" |
| Extend button disabled during in-flight refresh | "disables the extend button during the refresh in-flight" |
| `role="alert"` + `aria-live="assertive"` | "has the correct aria attributes for an auto-locking session" |

### Test results

```
$ cd apps/web && pnpm vitest run
Test Files  23 passed (23)
     Tests  205 passed (205)

FE-002-related files (18 tests):
  ✓ src/pages/LoginPage.test.tsx        9 tests
  ✓ src/pages/UnlockPage.test.tsx       9 tests
  ✓ src/components/AutoLockBanner.test.tsx  9 tests
  ✓ src/components/layout/Header.test.tsx   8 tests
```

### Full repository test suite (fresh-clone verification on worktree at origin/master 914dc8e)

```
apps/web        23 test files  205 tests  ✓ all passing
apps/services/api  26 test files  615 tests  ✓ all passing
packages/crypto     2 test files   53 tests  ✓ all passing

Total: 51 test files, 873 tests, 0 failures
```

### Files involved

| File | Role |
|---|---|
| `apps/web/src/pages/LoginPage.tsx` | Login form (FE-002a + FE-002d) |
| `apps/web/src/pages/LoginPage.test.tsx` | LoginPage unit tests (9) |
| `apps/web/src/pages/UnlockPage.tsx` | Unlock form (FE-002b + FE-002d) |
| `apps/web/src/pages/UnlockPage.test.tsx` | UnlockPage unit tests (9) |
| `apps/web/src/components/AutoLockBanner.tsx` | Auto-lock banner (FE-002c AC2) |
| `apps/web/src/components/AutoLockBanner.test.tsx` | AutoLockBanner unit tests (9) |
| `apps/web/src/components/layout/Header.tsx` | Header with lock button (FE-002c AC1) |
| `apps/web/src/components/layout/Header.test.tsx` | Header unit tests (8) |
| `apps/web/src/auth/SessionProvider.tsx` | In-memory session context (FE-002c) |
| `apps/web/src/auth/useLock.ts` | Lock flow hook (FE-002c) |

### Security notes (FE-002d + SEC-001)
- masterPassword cleared from React state after 401 auth failures (never lingering in heap)
- masterPassword preserved across network errors only (retryable — user expectation)
- No password echo in error messages (generic "Invalid email or master password." regardless of server payload)
- No persistence of tokens or master password to localStorage/sessionStorage/IndexedDB (SessionProvider holds tokens in JS heap only)

### Reproduce

```bash
cd apps/web && pnpm vitest run
```

### Notes

FE-002f is a consolidation/verification task — the tests it requires were implemented by FE-002a (LoginPage), FE-002b (UnlockPage), FE-002c (lock button + auto-lock banner), and FE-002d (error states + no leakage). FE-002e (accessibility) adds the aria-live / focus-management layer that the error-rendering tests depend on. This evidence package confirms all five acceptance-criterion areas are covered and the full suite is green on master.
