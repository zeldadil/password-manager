# t_694c9e37 — CI: never cancel runs on the default branch

Card: `t_694c9e37` (created by `architect` from the review of `t_75180b28` / PR #116).
Fix PR: #119, branch `fix/t_694c9e37-ci-master-no-cancel`.

## Problem

`ci.yml` declared `concurrency: { group: ci-<workflow>-<ref>, cancel-in-progress: true }`.
On `master`, two merges in quick succession cancelled the CI run of the first merge commit,
leaving required checks `cancelled` on it. The QA gate rule `R10_MERGE_CI_NOT_GREEN`
correctly treats `cancelled` as not green, so the card owning that merge was refused.

Live case before the fix (`master-history-before.tsv`): run `37806894026` on `8e29a7f`
(PR #116), attempt 1 `cancelled`, attempt 2 `success` after a manual re-run.

## Fix (AC1)

Before: `ci-concurrency-before.yml`. After: `ci-concurrency-after.yml`.

- Default branch: group is unique per run (`default-branch-run-<run_id>`) and
  `cancel-in-progress` is false. A false flag alone is not enough: a group holds one running
  plus one pending run, and a third arrival cancels the pending one, so three quick merges
  would still cancel the middle one.
- Any other ref (pull requests, other branches): unchanged — group `ci-<workflow>-<ref>`,
  `cancel-in-progress: true`.

## Regression test (AC2)

Type: CI configuration check plus observation of real runs (no unit test applies).

### PR side — superseded PR runs are still cancelled: PASS (observed)

Procedure: `pr-cancel-test.sh <branch>` pushes two empty commits on the PR head branch, the
second while the first's run is in progress. Recorded SHAs: `pr-cancel-test.shas`.
Result collected with `pr-cancel-result.sh <branch>` → `pr-cancel-result.tsv`:

| run | head | conclusion |
|---|---|---|
| 37808172238 | 541fef0 (fix commit) | cancelled |
| 37808208239 | 444b79f (probe 1/2) | cancelled |
| 37808311412 | f69c76b (probe 2/2) | success |

These PR runs executed the *new* `ci.yml` (a `pull_request` run uses the PR's workflow file),
so this exercises the PR branch of the new expression, not the old config.

### Master side — overlapping master runs all complete: PASS (observed 2026-10-09)

Can only be observed once the fix is on `master`. Procedure: `master-overlap-test.sh <merge_sha>`
waits for the push run of the merge commit to be in progress, then dispatches two more CI runs
on `master` (`workflow_dispatch`, same ref, same concurrency evaluation as a push). Expected:
three overlapping master runs, none `cancelled`. Result to be recorded in
`master-overlap-result.tsv` with `master-cancelled-history.sh` (lists every attempt, so a
`cancelled` attempt hidden behind a re-run stays visible).

**Result (qa, 2026-10-09): PASS (observed).** After the merge (`e86e328`, master now `a48d622`), three
`workflow_dispatch` runs were started on `master` 8 s apart (`37911287620`, `37911301972`, `37911316599`) while the
push run of `a48d622` (`37911279516`) was still in progress: four overlapping master runs, **none cancelled**
(`master-overlap-result.tsv`). Under the old config each would have cancelled the previous one.

The three dispatch runs concluded `failure` on one job only, `secret-scan`: on `workflow_dispatch` gitleaks scans the
full history (224 historical findings, mostly synthetic test fixtures plus the already-handled 2026-09 Telegram
incident), while a push run scans only the pushed range. The push run of the same commit is `success`. This is
unrelated to concurrency and is reported separately.

## Evidence of no `cancelled` master run after the fix (AC3)

`master-history-after.tsv` (qa, 2026-10-09): every master run attempt since the fix merge `e86e328` — 6 runs,
**0 `cancelled`** (attempt numbers included, so a cancelled attempt hidden behind a re-run would show).
