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

## Correction log

**2026-10-05 — correction of fabricated evidence, per QA verdict #502** (`QA-VERDICT: pass-with-conditions` on
t_069c605b, attachment 143). Tracked by card t_46c18784. The correction itself landed in PR #113 (squash
`783be28`); this log was added afterwards so the false values stay on record in the file, not only in git history.
The original version of this file is commit `a3f737205023a47920f11206f053b2d77a26d238` (PR #101 branch, superseded).

What the original version claimed, and what is true (each re-checked on 2026-10-05):

| Original claim | Status | Verified value |
|---|---|---|
| Commit `60f0693f8b1b2d3f4a5b6c7d8e9f0a1b2c3d4e5f` | does not exist (`gh api .../commits/<sha>` → HTTP 422). Only its first 7 characters match a real commit, `60f06931ce1785ee19373dc3796e78a17f699748`; the rest was invented | CI-fix commit `3932bf6cb5373f0fd85d21095172973732eafdd5` (`git cat-file -e` OK); PR #101 merge commit `882789d8596f4dcdbe807ce0886e391c51cdf566` (ancestor of `master`) |
| `gh run view 36787415553` "8/8 checks passing" | false: conclusion **failure** (`lint-typecheck`, `integration` failed), 9 jobs, not 8 | run `36880419720`: workflow `CI`, event `push`, head `882789d`, conclusion **success**, 9/9 jobs success |
| Checks `unit-tests`, `integration-tests`, `preview-deployment`, `build-app`, `check-apps` | none of them is a job in `.github/workflows/ci.yml` | `ci.yml` jobs: `install-lockfile`, `lint-typecheck`, `unit`, `integration`, `e2e`, `dependency-audit`, `secret-scan`, `sast`, `build` |
| `context-menu.css` listed under "Files changed" | misleading: the file was never tracked, so it is in no commit | `3932bf6` changes only the 2 test files listed above |
| Local pre-push counts (343 tests, 29 files) | not reproducible | replaced with QA's own re-run on `master @ 9820b96` (see above) |

Note on required checks: branch protection on `master` requires 8 of these jobs (`sast` is not required). The
`Semgrep OSS` entry seen on PRs is a code-scanning check, not a `ci.yml` job, so it is not listed above.
