# t_b102b100 — the audit counts and surfaces A11 (`--fail-on-a11`, workflow summary)

Card: `t_b102b100` (criterion 3 of `t_dbecf24d`, failed in qa verdict #595). Branch
`qa/t_b102b100-a11-surface`, based on `origin/master` `aab61520d3f73efe8e884a87e50f2005c344b6d5`.
Every file here was produced by the scripts in this directory. The selftest and the
workflow simulation ran on Node v22.23.3 (the official tarball, checked against
SHASUMS256.txt), the same Node major as CI.

## What changed

- `scripts/qa/signoff-gate.mjs`:
  - `audit` prints one **"bypasses & degradations"** block in the report header: one line
    per type, with a counter and the card ids. A11 is the only type for now. The block is
    built from `DEGRADATION_TYPES`, following architect's design note on the card, so
    `t_5b5b61e2` can add exceptions and CLI bypasses as new entries.
  - Every card that carries A11 is tagged `[A11: CI state unverified — §5.9 not evaluated]`
    on its own line, whether it is shown as `ok`, `FAIL` or grandfathered.
  - `--json` adds `counts.a11`, `a11_task_ids` and `degradations[]` (one entry per type:
    `count`, `task_ids`, `fail_flag`, `fail_flag_on`, `fails_audit`, and `cards` with the
    detail for each card).
  - `--json-out FILE` writes that same document to a file while the text report goes to
    stdout. Both come from one evaluation, so GitHub is read only once.
  - `--fail-on-a11` makes the audit exit 1 when at least 1 card carries A11. Without it,
    the exit code is unchanged. The flag takes no value: `--fail-on-a11 false` is
    refused with exit 3. It applies to `audit` only: `check --fail-on-a11` is refused
    with exit 3, and the hook never fails on A11.
- `scripts/qa/signoff-audit-summary.mjs` (new): reads the `--json-out` document. It
  appends a "Bypasses and degradations" section to `$GITHUB_STEP_SUMMARY` (a counter row
  per type, then a table of cards for each type that has any) and prints one `::warning::`
  per card, with workflow-command escaping. If the document is missing, or has no
  `degradations` block, it writes `not available` plus a warning, never 0. It never
  decides the run's colour.
- `.github/workflows/qa-signoff-audit.yml`: the audit step passes `--fail-on-a11` and
  `--json-out`. The summary step runs the summary script. The JSON is uploaded with the
  text report.
- `QA_SIGN_OFF_GATE.md`: §5.9 (A11 in the board audit), the §6 table, open item 10 and the
  changelog.

## Criterion 1: counter in the header, card list, `counts.a11` + ids, no bare `ok`

- Selftest section 9, run on the branch: `selftest-green.txt` shows **172/172**, exit 0.
- On the fixture board with only A11 cards:
  `A11 (CI state unverifiable — R9/R10 not evaluated): 2  ·  cards: t_a11a0001, t_a11a0002`,
  and both cards are tagged. See `workflow/A-fixture-a11-only.txt`.
- On a snapshot of the live board with GitHub off, the same line reads
  `A11 … : 8  ·  cards: t_65c5a636, t_cbaa9f7d, …`. The card from the bug report shows
  `ok   t_cbaa9f7d  Draft Disclosure Policy section @docs  [A11: CI state unverified — §5.9 not evaluated]`.
  See `workflow/D-live-board-github-off.step_summary.md`.
- With GitHub live (`gh` authenticated as the owner on this host) the count is 0: every
  card in scope was evaluated. See `workflow/C-live-board-github-live.txt`.

## Criterion 2: `--fail-on-a11` exit code, unchanged without it, non-vacuity

Selftest section 9, all passing in `selftest-green.txt`:

| Case | Expected | Result |
|---|---|---|
| A11-only board, no flag | exit 0 | ok |
| A11-only board, `--fail-on-a11` | exit 1, 0 card violations | ok |
| Board without A11, no flag | exit 0 | ok |
| Board without A11, `--fail-on-a11` | exit 0 (non-vacuity control) | ok |

Two more cases in the same section: a board with real violations still exits 1 with
`counts.a11 = 0`, and the hook still allows a card that carries only A11.

**RED check.** `selftest-red.txt` runs the branch's selftest against the master gate
(`aab6152`, sha256 `3c2d72b3884f387ef0a23e1664447c9c0bb4496ef82b78496d99f5ebc8dc6749`).
Result: **153/172**. All 19 failures are new section-9 cases. The 3 new cases that pass
do not depend on the gate change: the hook-allow control and the two summary cases that
run without a JSON document. All 150 earlier cases pass.

**No regression on the live board.** `ab-live-board.txt` compares the master gate and the
branch gate on one read-only snapshot of 141 done cards, with GitHub live and with
GitHub off:

- 0 cards change their set of violations or advisories.
- Without the flag, exit codes are identical (1 = the 29 enforced FAILs that already
  exist, unrelated to this card).
- `a11_task_ids` matches the A11 advisories in `results`.

## Criterion 3: the workflow passes `--fail-on-a11` and writes the summary and annotations

`workflow-fixture-run.sh` takes the `run:` bodies of the workflow's own steps ("Run the
board audit", "Write the run summary", "Enforce the audit outcome") verbatim with
`extract-step.py`. It runs them with `RUNNER_TEMP`, `GITHUB_OUTPUT`,
`GITHUB_STEP_SUMMARY` and `GITHUB_WORKSPACE` set as on a runner:

| Scenario | audit step | enforce step | `::warning::` | summary |
|---|---|---|---|---|
| A. fixture, A11 only, GitHub unreachable | 1 | **1 (red)** | 2, one per card | A11 row `2 · yes — red`, per-card table |
| B. same fixture, GitHub reachable | 0 | 0 | 0 | A11 row `0 · no (--fail-on-a11 on, count 0)` |
| C. live snapshot, GitHub live | 1 (29 existing FAILs) | 1 | 0 | A11 row `0` |
| D. live snapshot, GitHub off | 1 | 1 | 8 | A11 row `8 · yes — red` |

- `workflow/actionlint.txt`: actionlint 1.7.12 finds nothing (exit 0).
- `workflow/step-audit-has-fail-on-a11.txt`: the extracted audit step contains the flag.
- The fixture is the selftest's own section-9 board, kept with `--keep`.

## Not covered here (out of scope, stated on the card)

- A real run of the scheduled workflow, which needs a self-hosted runner and a token: that
  is a human decision tracked separately. Until a `gh` token with admin read is on that
  runner, the scheduled run is red on A11 by design (QA_SIGN_OFF_GATE.md open item 10).
- After the merge, the hook must be re-installed in all 7 profiles. The hook path does not
  change (A11 never blocks), but otherwise the installed copies stay behind master.

## Reproduce

    NODE_BIN=<node22>/bin BASE=aab61520d3f73efe8e884a87e50f2005c344b6d5 bash tests/evidence/t_b102b100/red-green-ab.sh
    NODE_BIN=<node22>/bin bash tests/evidence/t_b102b100/workflow-fixture-run.sh
