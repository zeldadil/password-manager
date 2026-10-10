# t_5b5b61e2 — the audit lists every X1 exception and every completion made outside the hook

Card: `t_5b5b61e2` (criterion 6 of qa's request on `t_b8001b55`, sequenced after `t_b102b100`).
Branch `qa/t_5b5b61e2-bypass-audit-v2`, based on `origin/master`
`92f01d7ae99040558d8ac59f0ef4af2feb012b6a` (after PR #127 / `t_b102b100` and PR #128 / `t_b2588ee7`).
Every file here was produced by the scripts in this directory. They ran on Node v22.23.3, the official
tarball checked against SHASUMS256.txt, which is the CI's Node major.

## What changed

- `scripts/qa/signoff-gate.mjs`
  - The `t_b102b100` "bypasses & degradations" block gets three bypass types next to `A11`:
    `X1_EXCEPTION` (exception in force + redundant records repeating it), `X2_EXCEPTION_WITHDRAWN`
    (history, not active, as qa's consistency note on the card asked) and the new report-only
    `X3_COMPLETED_OUTSIDE_HOOK`.
  - Each type lists **one line per occurrence**: card, date, author, reason, state. The text report
    prints them under the type's counter line, sorted by date. `--json` carries them as per-card
    `records`, a per-type `occurrences` count and a per-type `trend`, plus `counts.exceptions`,
    `counts.exceptions_withdrawn` and `counts.completed_outside_hook`.
  - `X3` reads `task_events`. It covers a `completed` event whose run Hermes synthesized
    (`status = outcome = 'completed'`), which is the CLI or dashboard path. It also covers a
    `completed` event with no run and a `manual_complete` event. A worker run (`status = 'done'`) is
    not listed. Hermes has no `--override "<reason>"` flag (`hermes kanban complete --help`) and
    does not record who ran the command. The report says "not recorded" and does not guess.
  - Trend and threshold: counts per month, the last 30 days against the previous 30, and a watch
    threshold per type (`BYPASS_WATCH_30D`: X1 2, X2 2, X3 10). Above the threshold the report says
    `ABOVE — review`. **The exit code never changes for a bypass.** `--now-iso` (audit only) fixes
    the window for a replay.
  - AR-2: every reason goes through `secret-guard.mjs` `scanText` at full length, before it is cut
    to 200 characters. On a match the reason is withheld and only the rule ids are printed. If the
    scanner cannot be loaded, every reason is withheld. Fence-length backtick and tilde runs are
    shortened. The `--json` facts carry the sanitised reasons only.
  - A board without `task_events` shows `X3` as **not available**, never 0. The read is tolerant,
    so the fail-closed hook is not affected.
- `scripts/qa/signoff-audit-summary.mjs`: the counter table now has one row per type, with cards
  and occurrences. A trend table follows, then a per-occurrence table for each bypass type.
  Free text is Markdown-escaped. Annotations: one `::warning::` for each X1, one `::notice::` for
  each non-empty X2/X3 type (GitHub keeps only the first annotations of a step), and one
  `::warning::` for each type above its threshold.
- `.github/workflows/qa-signoff-audit.yml`: comments updated. A new **PR-only** job,
  `bypass-report-fixture`, runs the selftest and then the real audit and summary commands against
  the selftest's synthetic bypass board. It only runs when the gate files change. It never reads
  the board and is not required. The board audit job is skipped on `pull_request`. Like
  `secret-scan` and `sast`, neither job depends on `install-lockfile`.
- `QA_SIGN_OFF_GATE.md`: new §5.10, rule table row `X3`, §5.9 CLI paragraph, §6 table, §10
  item 13, changelog.

## Criterion 1: every X1 is listed with card, author, reason and date, readable without the board

- Selftest section 10, cases 2–4 (`selftest-green.txt`). The fixture board has 13 cards. X1 lists
  exactly the 5 cards with an exception in force (6 occurrences, including a redundant one). It
  never lists the quoted key, the executing-profile author, the security-track card or the
  withdrawn exception, which follows `t_b8001b55`'s author model.
- PR job simulation `workflow/F-pr-job.step_summary.md`: the run summary as GitHub renders it,
  with `#### X1_EXCEPTION: 6 occurrences on 5 cards` and one table row per occurrence.
- Live board, read-only snapshot. `live-board-bypass-block.txt` has the reasons replaced by their
  length because the repo is public. `workflow/L-live-snapshot.txt` has the counter and trend rows.
  Result: **X1 = 5 occurrences on 5 cards** (`dashboard` ×4, `human` ×1).
  The card body expected "10 occurrences on 7 cards (`architect` ×5, `dashboard` ×4, `human` ×1)",
  a count taken on 2026-10-05, before `t_b8001b55`. The `dashboard`/`human` records are exactly
  the 5 listed. Every `architect` record on a done card is a key quoted in a code span (6
  `A10_EXCEPTION_IGNORED` on this snapshot), and the gate has not applied those since `bd62d76`.
  The card's own parent note asks for exactly this: the audit must not list exceptions that the
  gate already ignores.

## Criterion 2: CLI overrides are listed by the same job

- Selftest section 10, cases 6–8. These cover a synthesized-run completion, a no-run completion
  with `closure_method`, and two `manual_complete` events (one outside the 30-day window). They are
  listed with method, date, reason and assignee. The worker-run control is not listed. `check
  --task` shows the `X3` advisory, and violations are unchanged.
- Live snapshot: **X3 = 54 occurrences on 54 cards**, in the same block, table and job as X1. They
  are `2026-09: 33`, `2026-10: 21`.

## Criterion 3: the job never fails on a bypass, and the output names a threshold and a trend

- Selftest section 10, case 1: on a board whose only findings are bypasses, the audit exits 0 with
  `ok = true`, even with `--fail-on-a11`. Every bypass entry has `fails_audit = false` and no fail
  flag.
- `workflow/F-pr-job.txt`: the PR job's steps run verbatim and give selftest step exit 0 and audit
  step exit 0.
- `workflow/L-live-snapshot.txt`: the scheduled job's steps on the live snapshot with GitHub off.
  The run is red because of the 29 existing enforced FAILs and A11 (by design, `t_b102b100`). The
  A/B below shows that the bypasses add **no** failure.
- Trend and threshold appear in the text report, the JSON and the summary trend table. On the live
  snapshot, both X1 (5 > 2) and X3 (54 > 10) are above the proposed thresholds. The values are a QA
  proposal for architect (§10 item 13).

## No regression, RED/GREEN

- `selftest-green.txt`: **207/207** on the branch, exit 0.
- `selftest-red.txt`: the branch selftest against the base gate and summary (`92f01d7`, gate
  sha256 `f0f2abcb3fb3d980273772d483e7b05ea8b0d36664d8d1677bbf4ce287b97865`) gives **189/207**,
  exit 1. All 18 failures are new section-10 cases. The one new case that passes there is the
  hook-on-legacy-board control, which does not depend on the change. All 188 earlier cases pass.
- `ab-live-board.txt`: base gate against branch gate on one read-only snapshot (144 done cards),
  with GitHub live and with GitHub off. **0 violation-set changes**, identical exit codes, and the
  only advisory change is the new `X3` on 54 cards.
  `ab-live-board-run1.txt` is an earlier run of the same script. In its GitHub-live half, one `A11`
  appears in the base run and not in the branch run (base `a11 = 3`, branch `2`). That is GitHub
  read flakiness between two sequential live runs. The GitHub-off half of the same run, and both
  halves of the later run, are identical apart from X3. Both files are kept so the difference is
  not hidden.
- `workflow/actionlint.txt`: actionlint 1.7.12, exit 0.

## Not covered here, stated

- A real run of the scheduled audit job needs the self-hosted runner with the board (CI-001h /
  §10 item 10). The PR job runs for real on GitHub when this PR is opened. Its run is the
  "exécution réelle du workflow sur une PR" evidence and is referenced on the card.
- Hook deployment is `t_dbecf24d`'s scope. The installed hooks still run an older gate. The new
  gate imports `secret-guard.mjs` from its own directory. 6 of 7 profiles have it next to
  `signoff-gate.mjs`. `product/agent-hooks/` does not, so after a reinstall there, reasons in
  advisory details would be withheld. That is safe, but install `secret-guard.mjs` there too.
- `hermes kanban complete --force` on a running card, and a CLI call made with a worker's own run
  id, look exactly like a worker completion and are not listed. Closing that gap is a Hermes change
  (§10 item 13).

## Reproduce

    NODE_BIN=<node22>/bin BASE=92f01d7ae99040558d8ac59f0ef4af2feb012b6a bash tests/evidence/t_5b5b61e2/red-green-ab.sh
    NODE_BIN=<node22>/bin bash tests/evidence/t_5b5b61e2/workflow-fixture-run.sh
