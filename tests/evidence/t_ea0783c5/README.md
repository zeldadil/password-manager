# CI-001h evidence — scheduled QA sign-off gate board audit (`t_ea0783c5`)

**Deliverable:** `.github/workflows/qa-signoff-audit.yml` (new, dedicated workflow file — `ci.yml` untouched)
**PR:** https://github.com/zeldadil/password-manager/pull/17
**Workflow sha256:** `838e83c74d7e6661e3a3a9f9b8522ebe8bbf6b8ddf31494c62154896242cc139`
**Untouched baseline `ci.yml` sha256:** `b97341c9bcb43da8dc3a75b6db05e623bb4a638d0f4e43eecd05712016b605fb`
**Branch:** `feature/t_ea0783c5` (from `origin/master` = `543c396`)

Verdict: **pass** — every acceptance criterion is verified below with a captured transcript; the two
known gaps are stated in "Not verified / open gaps" and are not claimed as passing.

---

## 1. Acceptance criteria → evidence

| AC | Requirement | Evidence | Observed |
|---|---|---|---|
| 1 | New scheduled job `qa-signoff-audit`, weekly cron + `workflow_dispatch` | `check-workflow.txt`, `actionlint.txt` | job id/name `qa-signoff-audit`; triggers exactly `{schedule, workflow_dispatch}`; cron `17 6 * * 1` (weekly) |
| 2 | Runs `node scripts/qa/signoff-gate.mjs audit --repo <repo-root>`; surfaces counts + FAIL cards | `replay-*.txt`, `actions-run-demo-log.txt` L228–231, L306–320 | real invocation `audit --repo /home/runner/work/password-manager/password-manager --db …`; summary shows `enforced … pass: 1 · FAIL: 0`; fixture scenario shows the `FAIL t_deadbeef` card with `R1_QA_VERDICT_MISSING` / `R4_EVIDENCE_MISSING` |
| 3 | Not a required status check on `master` (no branch-protection change) | `branch-protection.json` / `.txt`, `check-workflow.txt` | live API: required contexts = `build, dependency-audit, e2e, install-lockfile, integration, lint-typecheck, secret-scan, unit` — `qa-signoff-audit` absent; no protection write was ever issued |
| 4 | Per-PR job graph in `ci.yml` unchanged (no `needs:`, no `pull_request` trigger) | `diff-vs-master.txt`, `check-workflow.txt` | `git diff … -- .github/workflows/ci.yml` empty; job has no `needs:`; parsed trigger map has no `pull_request`/`push` |
| 5 | Evidence: diff + a run URL (or a note why a dispatch run is impossible) | `diff-vs-master.txt`, `actions-run-demo*.txt`, `gh-workflow-dispatch-attempt.txt` | live run **35238945449** (success, artifact uploaded); pre-merge `workflow_dispatch` is impossible ⇒ `HTTP 404`, documented in §4 |

## 2. How it was verified (and what each method does *not* prove)

1. **`actionlint`** (`actionlint.txt`) — schema/expression/shell correctness of both the new workflow and
   every existing workflow in the repo. Does not prove runtime behaviour.
2. **`check-workflow.py`** (`check-workflow.txt`, exit 0) — mechanical acceptance-criteria assertions against
   the parsed workflow, `ci.yml` and the **live** branch-protection JSON. 30 assertions, all PASS.
3. **`replay-job.py`** (`replay-*.txt`) — a miniature Actions runner for this one job: it parses the real
   workflow file, resolves the `github`/`inputs`/`steps.*.outputs.*`/`runner.temp` contexts, honours `if:`,
   and executes the **actual `run:` scripts** with a real `GITHUB_OUTPUT` / `GITHUB_STEP_SUMMARY`, simulating
   the `uses:` steps. It is **not** GitHub Actions: runner image, action resolution and GitHub scheduling are
   out of reach. It is what proves the four behavioural scenarios:
   * `board-present` (schedule, real host board) → audit runs, summary written, artifact captured, **SUCCESS**;
   * `no-board` (schedule, no board anywhere) → `::warning::`, audit step skipped, summary `AUDIT NOT RUN`,
     **FAILURE** — the no-silent-green contract;
   * `dispatch-fixture-fail` (a synthetic post-epoch card with no verdict/evidence) → audit exit 1,
     FAIL card + rule ids in the summary, **FAILURE**  ⇒ a real detection path, not a vacuous pass;
   * `dispatch-strict-history` (`strict_history=true` against the real board) → exit 1 with the 27-card
     pre-epoch backlog ⇒ the `--strict-history` retro mode is wired, not decorative.
4. **Live GitHub Actions run** (`actions-run-demo.txt`, `actions-run-demo-log.txt`) — the strongest available
   runtime proof, described in §3.
5. **Live branch protection** (`branch-protection.txt`) — AC3 read back from the GitHub API after the branch
   push, not just asserted from the file.

## 3. The live Actions run (AC5)

| field | value |
|---|---|
| run | https://github.com/zeldadil/password-manager/actions/runs/35238945449 (id `35238945449`) |
| workflow / job | `QA sign-off audit` / `qa-signoff-audit` (job id `105262067270`) |
| event / branch | `push` / `ci-001h-demo` (throwaway, **deleted** after capture) |
| result | **success**, job 7 s, run 11 s |
| artifact | `qa-signoff-audit` (id `10504782093`, 367 B) — content: the audit report, sha256 `dfdc28a73241739b83c140d260d55d9bb2acd34ccc52e0ac560d9ce24fd60f88` |

Real runner output (from the job log):

```
Board database: /home/runner/work/password-manager/password-manager/.ci-demo/board.db
+ node scripts/qa/signoff-gate.mjs audit --repo /home/runner/work/password-manager/password-manager --db …/.ci-demo/board.db
QA sign-off gate — audit (db: …/.ci-demo/board.db, epoch: 2026-09-17T15:00:00.000Z)
  enforced (done at/after epoch or pre-complete): 1  ·  pass: 1  ·  FAIL: 0
  ok   t_democard  CI-001h demo: synthetic compliant card @backend
```

The same run also proves three things a local replay cannot: GitHub accepts
`runs-on: ${{ vars.QA_SIGNOFF_AUDIT_RUNNER || 'ubuntu-latest' }}`; `${{ inputs.board_db }}` /
`${{ inputs.strict_history }}` render as **empty** on a non-dispatch event (`BOARD_INPUT:` /
`STRICT_HISTORY:` both empty in the log); and the `steps.board.outputs.available` output really reaches the
later steps (`if [ "true" != "true" ]`).

### Exact diff of the demo branch vs the shipped workflow

Only two edits, both marked `DEMO-ONLY EDIT` in that branch's copy:

```diff
 on:
+  push:
+    branches: [ci-001h-demo]
   schedule:
     - cron: "17 6 * * 1"
   workflow_dispatch:
@@
 env:
   NODE_VERSION: "22"
   PNPM_VERSION: "9.12.0"
+  HERMES_KANBAN_DB: ${{ github.workspace }}/.ci-demo/board.db
```

Plus, on that branch only: `scripts/qa/signoff-gate.mjs` (borrowed from PR #16, see §5),
`.ci-demo/board.db` (a schema-only board fixture with one synthetic compliant card `t_democard`) and
`tests/evidence/t_democard/README.md` (the evidence path the fixture card names, so R5 passes). All of it was
deleted with the branch. The `run:` scripts themselves were byte-identical to the shipped file.

## 4. Why there is no `workflow_dispatch` run URL

`.github/workflows/qa-signoff-audit.yml` is new, so it does not exist on the default branch yet, and GitHub
only accepts `workflow_dispatch` for workflow files that exist on the default branch:

```
$ gh workflow run qa-signoff-audit.yml --ref feature/t_ea0783c5
HTTP 404: Not Found (…/actions/workflows/qa-signoff-audit.yml)
$ gh workflow list --repo zeldadil/password-manager
CI      active  360493943        # the new workflow is not listed until it is on master
```

(`gh-workflow-dispatch-attempt.txt`.) The workflow becomes dispatchable the moment this PR merges. The §3 run
is the substitute for that run URL; the demo branch is deleted, so a future reader cannot confuse it with the
shipped trigger set.

## 5. Not verified / open gaps (stated, not hidden)

1. **A board cannot reach a GitHub-hosted runner.** The canonical board is `~/.hermes/kanban.db` on the
   trusted host; the hosted runner sees neither it nor `$HERMES_KANBAN_DB`. So the *scheduled* run is red
   (`AUDIT NOT RUN`) until the board transport decision lands — by design, and exactly why the job refuses to
   finish green when no board exists. Options are a self-hosted runner label
   (`vars.QA_SIGNOFF_AUDIT_RUNNER`) or a published board snapshot; the choice is an architect decision and is
   **out of this card's scope** (the card defers non-default/release boards and does not decide publishing
   board contents). A follow-up card is opened on the Kanban board for `architect`.
2. **This branch cannot run the audit yet.** `scripts/qa/signoff-gate.mjs` lives on PR #16
   (`feature/t_430aa9a3`), not on `master`. The workflow's first step fails with an explicit
   `Gate script missing` error in that window; merge #16 first (or together). For the replays above the script
   was copied into this worktree **untracked** and never committed
   (`gate-script-borrowed.sha256`: `00807b004287985542c105f78e2a35759bc560744000e48e6f867b71e8df822f`, identical
   to the PR #16 file).
3. **Runtime verification is partly emulated.** §2.3 is a hand-written runner, and §3 ran with a fixture board
   (the real board cannot be shipped to a hosted runner). Neither is a scheduled production run against the
   real board — that is gap 1, not a gap in the job logic.
4. **Operational note for whoever reads the first real summary:** `audit --repo <root>` resolves named evidence
   paths against *that* checkout, so on `master` any evidence that only exists on an unmerged feature branch
   reports `R5_EVIDENCE_FILE_MISSING` (and pre-epoch cards report `A1_HISTORY_UNGATED` advisories). Default
   runs only fail on post-epoch cards; `--strict-history` deliberately fails everything pre-epoch.
5. **Not covered by this card (by scope):** retrofitting pre-epoch cards; non-default board audits; any change
   to `scripts/qa/signoff-gate.mjs`.

## 6. Reproduce

```bash
cd /home/sap/password-manager/.worktrees/t_ea0783c5        # branch feature/t_ea0783c5
mkdir -p scripts/qa && cp ../t_430aa9a3/scripts/qa/signoff-gate.mjs scripts/qa/   # PR #16 script (untracked)
bash tests/evidence/t_ea0783c5/run-evidence.sh             # regenerates every transcript here
```

`run-evidence.sh` needs `actionlint`, `python3` with `PyYAML`, `sqlite3`, `node` ≥22 and an authenticated
`gh`. It rewrites `branch-protection.txt` from the live API and attempts the `workflow_dispatch` (expected to
404 until this merges).

## 7. Security review of this change

* `permissions: {contents: read}` — no token scope beyond the checkout; no `issues: write` (the job reports in
  the run summary, it does not comment on issues or PRs).
* No repository secret is referenced anywhere in the workflow (`secrets.` does not appear).
* No board path, host path or credential is hardcoded: the board comes from the dispatch input or the
  `$HERMES_KANBAN_DB` / `$HOME/.hermes/kanban.db` environment of the runner it lands on.
* The job writes one file, `$RUNNER_TEMP/qa-signoff-audit.txt`, uploaded as an artifact (30-day retention) —
  it contains board card ids/titles and rule ids, i.e. the same information the audit prints locally.
* `concurrency: cancel-in-progress: false` — an in-flight audit is never cancelled, since its report is the
  evidence.
* No branch-protection mutation anywhere in the change (§1 AC3, verified against the live API).

## 8. Files here

| file | what it is |
|---|---|
| `actionlint.txt` | `actionlint` over the new workflow and every workflow in the repo |
| `check-workflow.txt` | acceptance-criteria checker output (30 assertions + live protection check) |
| `branch-protection.json` / `.txt` | live `master` protection read back from the GitHub API |
| `diff-vs-master.txt` | branch diffstat, proof `ci.yml` is untouched, file sha256s |
| `replay-board-present.txt` | local replay: schedule, real board → SUCCESS |
| `replay-no-board.txt` | local replay: no board anywhere → `AUDIT NOT RUN`, FAILURE |
| `replay-dispatch-fixture-fail.txt` | local replay: injected violating card → FAIL card surfaced, FAILURE |
| `replay-dispatch-strict-history.txt` | local replay: `--strict-history` → 27-card pre-epoch backlog, FAILURE |
| `gh-workflow-dispatch-attempt.txt` | why a pre-merge dispatch run is impossible (HTTP 404) |
| `actions-run-demo.txt` / `-log.txt` | the live GitHub Actions run 35238945449 |
| `workflow.sha256`, `gate-script-borrowed.sha256` | hashes of the workflow and of the borrowed gate script |
| `check-workflow.py`, `replay-job.py`, `run-evidence.sh` | the harnesses (re-runnable, see §6) |
