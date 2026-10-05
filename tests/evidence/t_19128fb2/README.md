# Evidence — t_19128fb2 (FE-003g CI fixes)

> **Corrected 2026-10-05** after QA review (attachment 143 on t_069c605b). The previous version of this file
> cited a non-existent commit SHA, a failing CI run reported as passing, and CI job names that do not exist in
> `.github/workflows/ci.yml`. Every value below was re-checked against GitHub (`gh api` / `gh run view`).

## Commit
`3932bf6cb5373f0fd85d21095172973732eafdd5` — `fix(web): resolve FE-003g CI failures — unused import, theme false positive`

## Files changed in that commit
- `apps/web/src/components/layout/layout.contract.test.tsx` — removed unused `vi` import (TS6133)
- `apps/web/src/theme.test.ts` — fixed color-keyword false positive + shadow overlay detection

Note: an orphan, **untracked** `context-menu.css` was also removed from the local working tree. Because it was
never tracked by git, that removal is not part of any commit.

## CI evidence
- PR #101 (merged): https://github.com/zeldadil/password-manager/pull/101 — merge commit `882789d`
- Green run on the merge commit: run `36880419720` (workflow `CI`, event `push`, conclusion **success**)
  https://github.com/zeldadil/password-manager/actions/runs/36880419720
- Jobs (all `success`, 9/9): `install-lockfile`, `lint-typecheck`, `unit`, `integration`, `e2e`,
  `dependency-audit`, `secret-scan`, `sast`, `build`

Superseded run, kept for transparency: `36787415553` (pull_request, on pre-rebase commit `60f0693`) concluded
**failure** (`lint-typecheck` and `integration` failed). It is not evidence of a passing state.

## Independent re-verification (QA)
QA re-ran the CI commands on `master @ 9820b96` under Node 22: web unit 350/350, integration 43/43, typecheck
clean. (The local pre-push counts previously listed here could not be re-verified and have been removed.)
