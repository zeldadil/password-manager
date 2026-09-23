# FE-002b: Unlock Page — QA Evidence

**Task:** t_fdd2548e (FE-002b)
**Branch reviewed:** feature/t_fdd2548e (PR #59, closed unmerged — superseded)
**Landed on master via:** PR #62, commit 235217c (2026-09-23)

## Acceptance criterion

1. `/unlock` (for locked vault): same UI pattern as `/login`, shows "Vault
   locked — enter master password to unlock" — **met**, verified by
   `apps/web/src/pages/UnlockPage.test.tsx` (`renders the heading, subtitle,
   and both required inputs`).

## Independent re-verification (not taken on the implementer's self-report)

PR #59's own review-request summary claimed: "POSTs /auth/unlock with
masterPassword only (no email), ... 4/4 unit tests pass ... independently
artifact-reviewed by frontend." That summary was **not accurate against the
real, deployed backend contract**:

- `apps/services/api/src/auth/unlock.ts` (already on `master` via PR #58 at
  the time PR #59 was opened) requires `email` or `username` in the request
  body — the JSON schema allows a bare `masterPassword` through, but the
  handler itself returns `400 { error: 'Bad Request', message: 'Either
  email or username is required to identify the user' }` when neither is
  present.
- PR #59's `UnlockPage.tsx` sent `{ masterPassword }` only, and its own test
  suite explicitly asserted the body must **not** contain `email` (design
  comment: "unlock is for an already-authenticated session"). There is no
  session-scoped re-unlock code path anywhere in this codebase — tokens are
  held in memory only and cleared on lock (SEC-001 AR-1/AR-2), so nothing
  persists a user identifier across a lock event for the backend to key off.
- Net effect: as submitted, `/unlock` could never have completed a
  successful POST against the real API. The "4/4 unit tests pass" claim was
  true only because the tests mocked `fetch` directly and never exercised
  the real endpoint's contract.

Also found: PR #59's branch (`feature/t_fdd2548e`) was forked from a stale
pre-BE-002c-h worktree snapshot — 104 of its 111 changed files were either
byte-identical to current master or superseded by fixes already merged
(broken migration, `npm`-generated lockfile in a `pnpm`-only monorepo, a
debug `install.sh` hardcoding another session's workspace path, a duplicate
test file). Same class of problem as PR #53→#54 and #56→#58.

## Fix applied (PR #62)

- Added an `email` field to `UnlockPage.tsx`, matching `LoginPage`'s
  pattern — the minimal change that makes the page actually work against
  the real `/auth/unlock` contract.
- Updated `UnlockPage.test.tsx` to match (asserts the body **does** contain
  `email`, rather than asserting the opposite).
- Proactively applied the same fetch-mock-settling fix used for
  `LoginPage.test.tsx` (PR #61) to the "disables submit button while
  loading" test, since it used the identical delayed-promise pattern that
  caused that flaky CI failure.
- Reconstructed all other genuinely-superseded/excluded files per the
  Piège n°10 file-by-file classification (see PR #62's description for the
  full breakdown).

## Verification run (2026-09-23, fresh clone at commit 235217c)

```
pnpm install        — clean
pnpm typecheck       — clean (apps/services/api, apps/web, packages/crypto)
pnpm test            — 458 api + 172 web + 52 crypto = 682/682 passing
                        (web suite run 3x back-to-back — no unhandled-error
                        flakiness; the pre-fix teardown-race bug reproduced
                        intermittently before the fix, zero times after)
pnpm build           — clean, real tsc build (not just --noEmit),
                        per the rootDir-emit-path pitfall
node scripts/qa/scan-test-data.mjs
                      — same 13 findings as before this task, all
                        pre-existing/documented false positives
                        (ccTLD confusion, redaction-test-inherent
                        secret-shaped fixtures); nothing new
gitleaks detect --no-git
                      — no findings in the new/changed files
```

## Security

No real secret, credential, or PII in this file, the reviewed diff, or the
merged code. `UnlockPage.test.tsx`'s master-password fixtures are synthetic
literals (`unlock-test-master-password-001`), matching this repo's AR-4
convention.

## Verdict

`pass` — see `QA-VERDICT` comment on this card. The functional gap found
(missing `email` field) was fixed in the landed code before merge, not
deferred, so there is no outstanding condition to track.
