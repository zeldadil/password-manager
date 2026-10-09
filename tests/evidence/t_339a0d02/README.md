# t_339a0d02 — R10 judges the merge's push run only

Author: qa (gate change). This is the **author's self-check**; architect counter-verifies before the merge.
Base: origin/master @ 261d74a. All runs under Node 22 (CI version).

## What changed

`scripts/qa/signoff-gate.mjs`:

- The commit-checks reader now returns, for each check run, its `id` and `check_suite_id`, plus every
  workflow run of the SHA with its `event` (`GET repos/{repo}/actions/runs?head_sha=<sha>`).
- `requiredCheckState` splits check runs by the event of the workflow run that owns their suite:
  - suite of a `push` run, or suite no workflow run owns (another app): **judged**;
  - suite of any other event (`workflow_dispatch`, `schedule`, …): **set aside**, reported as the new
    advisory `A15_NON_PUSH_RUN_ON_MERGE_COMMIT` when it disagrees with the push run, never `R10`.
- Within one suite only the newest check run of a name counts, so a re-run of the push run (same suite,
  new attempt) replaces its earlier attempt.
- A required check carried **only** by non-push runs is `no-push-run` → `R10`.
- Fixtures written before this change carry no `workflow_runs`: their meaning is unchanged (no split).

## Deviation from the card, for architect to decide

AC1 says "if the push run does not exist, `A11`". I implemented **`R10` (`no-push-run`)** instead, and only
when manual runs exist and carry the check. Reason: `A11` is non-blocking, so with `A11` a merge whose push
run never ran could complete on a green manual run, which is the "repair" path this card closes. When GitHub
cannot be read at all, the existing `A11` path is unchanged. If architect prefers the card's wording, it is
a one-line change in `requiredCheckState` plus case (5) of the selftest.

## AC2 — selftest

- `selftest-red.txt`: the 7 new cases against the **unchanged** master gate: 145/150, the 5 behaviour cases
  fail; the non-vacuity case (4, push red alone → R10) and the other-app control (6) pass, as they must.
- `selftest-green.txt`: 150/150 on the branch gate (143 earlier cases unchanged + 7 new).

| Case | Fixture | Expected | Result |
|---|---|---|---|
| 1 | push green, later dispatch red on `build` | no R10, A15 naming `build` + `workflow_dispatch` | ok |
| 1b | same | judged states = push run's (all success) | ok |
| 2 | push red on `integration`, later dispatch green | R10 `integration=failure`, A15 | ok |
| 3 | push red then re-run green, same suite | no R10, no A15 | ok |
| 4 | push red alone (non-vacuity) | R10, no A15 | ok |
| 5 | no push run, only a green dispatch run | R10 `no-push-run` | ok |
| 6 | `build` from a suite no workflow run owns | judged as before, allowed | ok |

## AC3 — live replay on GitHub (2026-10-09)

- **`t_7e8bf917`** (`live-t_7e8bf917-master.json` vs `live-t_7e8bf917-branch.json`, same board): master gate
  `R10_MERGE_CI_NOT_GREEN: secret-scan=failure` on `a48d622`; branch gate **no R10**, `A15` names
  `secret-scan=failure (workflow_dispatch; push run: success)`. The remaining advisory `A9` is unrelated.
- **Negative control, a real red push run** (`negative-control.json`, `red-push-runs.txt`): PR #88, merge
  `09b91f3`, push run 36134078688 failed on `secret-scan` → branch gate still raises `R10`. No card on the
  board links PR #88, so the control evaluates `evaluatePrRule` directly with the live GitHub reader and a
  synthetic card declaring it (`live-control.mjs`).
- **Re-run control** (`rerun-control.json`): PR #116, merge `8e29a7f`, push run 37806894026 attempt 1
  cancelled, attempt 2 success → branch gate green (same script with PR 116).
- **Board audit before/after** (`audit-before-after.txt`): 140 done cards, master gate vs branch gate on the
  same board and live GitHub: **0 cards** change violation set or gain `A15`; no done card has a red push
  run (the board-wide answer to "find one in the board history, or show there is none").
