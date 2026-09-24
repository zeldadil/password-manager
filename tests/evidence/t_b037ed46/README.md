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
