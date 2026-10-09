# t_dbecf24d — SEC-GATE rollout: R9/R10 enforce for real (7 profiles) — QA evidence

Run: 2026-10-08, qa profile (run 1806). Repo gate on origin/master: `scripts/qa/signoff-gate.mjs`
sha256 `d2840803e5467d56d767cf1ef28709c506d4d15c52d53f5df8aea88d155fb0c2` (unchanged from 8e29a7f
through d612272), hook `qa-signoff-gate.sh` sha256 `4e1efa9e2e03…c2de`.

## Verdict per acceptance criterion

| # | criterion | result |
|---|---|---|
| 1 | hook reinstalled in the 7 profiles + verifier output | DONE, with verifier exit 1 caused by 2 verifier defects (see below) |
| 2 | `gh auth status` OK inside the hook env + open-PR fixture → `R9_PR_NOT_MERGED`, not `A11` | PASS 7/7 |
| 3 | scheduled audit counts and lists `A11` | FAIL: listed per card, never counted, never surfaced in exit code/summary |

### 1. Install
- `pre-install-hashes.txt`: before the rollout, 6 profiles ran gate `18e8d6fd…` and qa ran `f44d11dc…`.
  Neither is master; neither has R9 (see `pre-install/fires.txt`: 0/7 R9 on the open-PR fixture).
- `install-all-dryrun.txt`, `install-apply.txt`: `install-signoff-gate.sh --profile ×7 --apply`
  copied hook + gate into all 7 profiles. After that, all 7 installed copies hash to `d2840803…` (re-checked 21:03Z).
- `verify-live.txt` (16:26Z) and `verify-live-rerun.txt` (re-run now): 70 ok · 4 warn · 10 FAIL.
  All 10 FAILs are verifier false negatives, and the live fire passes in all 7 profiles:
  - 7× `hermes hooks list does not show the hook`: `verify-signoff-gate.sh` runs under `set -o pipefail`
    and does `hermes hooks list 2>/dev/null | grep -q …`. `grep -q` exits on the first match, so
    `hermes` gets a broken pipe and exits 120, and pipefail makes the test false. Repro: the hook is
    listed (stdout contains `qa-signoff-gate.sh`), `PIPESTATUS=120 0` with pipefail, exit 0 without it.
  - 3× doctor "2 warning(s)" (architect, docs, qa): the second warning is mtime drift on the
    **secret-guard.sh** hook (modified 2026-09-18, before this rollout). The verifier counts every `⚠`
    in the profile instead of only the warnings for qa-signoff-gate.sh.

### 2. Hook-env proof (`fire-profiles.sh`, `post-install/`)
For each profile, `hermes hooks test pre_tool_call --for-tool kanban_complete` with `HERMES_HOME=<profile>` fires
the profile's real configured hook against a `sqlite3 .backup` snapshot of the live board. The live board is never
written. Fixture card: `t_20f78461`, whose PR #110 was re-read as OPEN at fire time.
- A: probe gate (`hook-env-gh-probe.mjs`) runs inside the hook subprocess. `gh auth status` exit 0, logged in as
  zeldadil through `/home/sap/.config/gh/hosts.yml`. No GH_TOKEN/GITHUB_TOKEN in env. The installed gate
  reports `R9=true A11=false`.
- B: real hook, GitHub live: block, `R9_PR_NOT_MERGED` present.
- C: control with `QA_GATE_GITHUB=off`: no R9. This proves that R9 in B comes from reading GitHub.
- Result: `phase post-install: 7 PASS · 0 FAIL`.
- Limit: `hermes hooks test` fires the hook from a shell under the qa worker's environment (same user,
  same HOME, same dispatcher host). It is not a real `kanban_complete` issued by each profile's worker.
  No production R9/A11 event exists on the board yet to cross-check.

### 3. Audit (`audit-a11-probe.sh`, `audit/`)
I ran the master gate's `audit` on a board snapshot:
- GitHub live: 0 A11 (`audit/a11-summary-github-live.json`).
- GitHub off: 4 cards carry A11 (t_65c5a636, t_cbaa9f7d, t_75180b28, t_7e1cea21). They appear only as indented
  `warn A11_…` lines under each card. The text header has no A11 count. `--json` `counts` has no A11 key
  (`done_cards/enforced/failures/grandfathered`). Exit code depends only on violations, and so does the result
  of `qa-signoff-audit.yml`. t_cbaa9f7d is listed as `ok` with an A11 under it. A board where every card has
  A11 and no violation produces a **green** audit, so an A11 in production stays silent.
- Also: on the default `ubuntu-latest` runner the workflow ends with "AUDIT NOT RUN" because the runner has no
  board. A hosted `GITHUB_TOKEN` cannot read branch protection, so the audit's R10 required-check list would
  resolve to A11. Both points are escalated to architect on the card.

The pre-existing audit FAIL count (31 on the live board) is outside this card's scope.
