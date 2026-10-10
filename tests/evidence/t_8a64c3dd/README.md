# Evidence — t_8a64c3dd: the weekly QA sign-off audit runs locally and reports on the board

Card: `t_8a64c3dd`. PR: #142, branch `qa/t_8a64c3dd-local-weekly-audit`.
Policy: `QA_SIGN_OFF_GATE.md` §6.5.
Maintenance card: `t_9c3f521a`, titled "AUDIT: résultats hebdomadaires du gate", in `triage`.

All runs below were executed on 2026-10-10 by `qa`, on the host that carries the board.
The board writes all go through the real Hermes cron scheduler (gateway pid 1027) in `no_agent` mode.
The kanban worker session is fenced from board writes, so it was not used for them.

## 1. Selftest — `selftest/`

`node scripts/qa/signoff-audit-local.selftest.mjs`, run on host Node 26: **41 passed, 0 failed**
(`selftest-41-green.txt`). The same selftest also runs on Node 22 in the PR CI job
`local-audit-reporter-fixture`, which is green on PR #142.

The selftest uses:
- a fixture board with the gate-selftest schema;
- a fixture repo;
- a stub `hermes` CLI that writes comments and attachments into the fixture board and logs every argv;
- the real `signoff-gate.mjs audit`, with `QA_GATE_GITHUB=off` (no network) and no `~/.hermes`.

What the cases cover:

| Area | Cases |
|---|---|
| Guard (`assertInertForGate`) | 8 gate-readable shapes are refused: `QA-VERDICT:`, a loose `verdict:` and `Verdict —`, the sign-off exception key (both spellings), and the `Evidence:` / `attachment:` / `Artifacts —` labels. A notice built from every rule id passes the guard. |
| Findings | Rules are deduplicated (R2 twice gives one R2). A11 cards are added. A malformed card id or rule id (`not-an-id; rm -rf`, `R1 $(touch …)`) is dropped. |
| **Negative control** | The fixture card in violation gets exactly one `qa` comment, `AUDIT 2026-10-12 : R1_QA_VERDICT_MISSING, R4_EVIDENCE_MISSING`. The A11 card gets `AUDIT 2026-10-12 : A11_CI_STATE_UNVERIFIABLE`. The compliant card gets nothing. |
| Maintenance card | The text and JSON reports are attached by `qa`. The synthesis is posted **last**, and its first line is `AUDIT-RUN: 2026-10-12T06:17:00Z`. The audited revision is named in the synthesis. |
| Read-only | Only `kanban comment` and `kanban attach` are called, every call carries `--author qa`, and every write goes to the audited board. Card status, assignee, title and body are unchanged. |
| **Gate inertness** | The fixture board is re-audited after posting. Every card's violation set and advisory set is identical. |
| Idempotence | A same-day re-run adds no duplicate notice (`0 posted, 2 already posted`). The next week's run posts again. |
| `check-stale` | A 1-day-old stamp gives OK. A stamp 8 days old plus 1 s gives exit 1 `AUDIT MISSING`. Exactly 8 days gives OK. No stamp gives exit 1 (`last: never`). None of these count as a run: a stamp written by `architect`, an `AUDIT-RUN-FAILED:` stamp, or a quoted stamp. A card that is not the maintenance card gives exit 3. |
| Failure paths | A wrong or missing maintenance card gives exit 2 and nothing is written. A missing option gives exit 3. A failing board write gives exit 2, **no** `AUDIT-RUN:`, and an `AUDIT-RUN-FAILED:` notice instead. A missing `hermes` CLI gives exit 2. `--dry-run` plans the writes but performs none. |

**RED run** (`selftest-40-mutant-RED.txt`, from the 40-case version): the mutant puts `verdict: fail` in the notice's first line and disables the guard.
- 14 cases fail.
- Among them, the gate-inertness re-audit fails because the fixture board really changed: `R1_QA_VERDICT_MISSING` became `R3_VERDICT_NOT_TERMINAL`. A notice that the gate could read would change verdicts. The test detects this.

## 2. Dress rehearsal on a copy of the live board — `rehearsal-1/`, `rehearsal-2/`

Script: a one-shot cron job of the `qa` profile, `no_agent`. It does the following:
1. Takes a `sqlite3 .backup` copy of `~/.hermes/kanban.db` into a directory outside `~/.hermes`.
2. Injects one fixture card, `t_fe000001`: done after every epoch, no verdict, no evidence.
3. Runs the **real wrapper** `scripts/qa/cron/qa-weekly-signoff-audit.sh` with `QA_AUDIT_REF` set to the PR branch.

Everything else in that run is real:
- the real `hermes` CLI writes to the copy (`HERMES_KANBAN_HOME` / `HERMES_KANBAN_ATTACHMENTS_ROOT` point at it);
- the real `gh` login is used;
- the wrapper uses its own clone and a throwaway worktree.

- **Rehearsal 1** (commit `cb351bf`, the gate's default 20 s GitHub budget):
  - The negative-control card received its notice (`negative-control-comment.txt`).
  - The audit found 43 cards. **13 of them were A11, and every one of those A11 was `GitHub time budget (20000 ms) exhausted`** (`a11-details.txt`). The budget is sized for the completion hook; a whole-board audit needs more. That is a false red, caused by the audit's own budget.
  - This finding produced commit `960459f`: the wrapper now sets `QA_GATE_GH_BUDGET_MS=600000`. A real GitHub failure is still reported as A11.
- **Rehearsal 2** (commit `960459f`):
  - A11 dropped to 0. FAIL is 32: the 31 live violations plus the fixture card.
  - The negative-control card received `AUDIT 2026-10-10 : R1_QA_VERDICT_MISSING, R4_EVIDENCE_MISSING` (`negative-control-comment.txt`).
  - The board events written were only `commented` ×33 and `attached` ×2 (`events-written.txt`).
  - A re-audit of the copy at the same revision and with the same budget gives **identical violation and advisory sets on all 155 cards** (`sets.diff` is empty; `counts-before-after.json`).

Note on rehearsal 1's inertness check: the first comparison used my workspace clone as `--repo` while the run had used the job's own clone. That produced an `A6_EVIDENCE_CITED` difference on `t_f443682a`, a card that received no notice; the difference came from the repo refs, not from the comments. Re-run against the job's own clone at the same commit, the sets are identical (`rehearsal-1/sets.diff` is empty).

## 3. Real run on the real board — `realrun/`

This run is identical to the production job except that the audited revision is the PR branch at `960459f`, because the reporter is not on `origin/master` before the merge.
- One-shot cron job `t_8a64c3dd-realrun-premerge`. Its run time is in `cron-output.md`.
- `AUDIT-RUN: 2026-10-10T19:57:50Z`.
- Gate exit 1: **31 cards in violation, A11 0**, X1 5, X3 54.

Results:
- **31 notices** were posted, one per card in violation, all authored by `qa` (`notices.txt`). An example is in `sample-notice-t_f9d4d3bb.txt`.
- **2 attachments** were added to `t_9c3f521a` (`attachments.txt`): `qa-signoff-audit-20261010T195750Z.txt`, 101 376 bytes, and the `.json`, 526 516 bytes.
- **The synthesis** was posted last (`synthesis.txt`).
- On the commented cards and the maintenance card, the board events since the run started are only `commented` ×32 and `attached` ×2 (`events-on-commented-cards.txt`). The status and assignee of the 31 commented cards are unchanged (`status-before.txt` and `status-after.txt` are identical).
- **Gate inertness on the live board:** I re-audited after the run at the same revision with the same budget. The violation and advisory sets are identical on all 155 cards (`sets.diff` is empty; `counts-before-after.json`).
- `check-stale` on the live board:
  - now: `AUDIT OK: last AUDIT-RUN: 2026-10-10T19:57:50Z`, exit 0;
  - with `--now-iso 2026-10-19T19:57:51Z`: `AUDIT MISSING: … 9.0 days ago`, exit 1.

Known cosmetic defect in that run's synthesis: it says `revision: origin/master 960459f…` although the revision was the PR branch. The line had `origin/master` hard-coded. It was fixed in the next commit: the line now reads `revision audited: <ref> @ <sha>`, the wrapper passes `--revision-label "$REF"`, and a selftest case covers it.

## 4. The scheduled job

The Hermes cron job of the `qa` profile is `qa-weekly-signoff-audit` (id `730e2daf32cc`):
- `17 6 * * 1`, `no_agent`, script `qa-weekly-signoff-audit.sh`;
- `deliver=local`, `failure_deliver=local`, so **nothing is sent to Telegram**;
- first tick: 2026-10-12T06:17Z.

The installed copy at `~/.hermes/profiles/qa/scripts/qa-weekly-signoff-audit.sh` is byte-identical to `scripts/qa/cron/qa-weekly-signoff-audit.sh` on this branch; the sha256 is in the card comment.

The job audits `origin/master`, so a run before the PR is merged fails: `scripts/qa/signoff-audit-local.mjs` is missing on master. That failure is local and silent, and `check-stale` makes it visible after 8 days.

## 5. GitHub runner `hermes-host`

`gh api repos/zeldadil/password-manager/actions/runners` returns `{"total_count":0,"runners":[]}` (2026-10-10). No runner is registered, so there was nothing to delete. The repository variable `QA_SIGNOFF_AUDIT_RUNNER` cannot be read with the agents' token (`GET …/actions/variables` returns HTTP 403). The workflow no longer reads it; deleting it needs admin rights (architect with Adil).
