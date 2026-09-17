# QA review — t_b51a1ff3 (round 1, lens: artifact)

**Reviewer:** qa · **Implementer:** architect (run 473) · **Reviewed revision:** `48b89a3`
(branch `fix/telegram-token-rotation-t_28951254`, repo `/home/sap/password-manager`)
**Date:** 2026-09-17 ~21:23Z · **Verdict: changes requested** (3 blocking defects)

Every claim below was reproduced on this host in review run 474. Raw output:
`transcript-review.txt` (in this attachment set); rerun with `reproduce-review.sh`.
No secret value was printed, copied or committed during this review — the only
board text ever touched (the leaked comment on `t_0af5aa3e`) was piped straight
into the guard and only its exit code + rule id were read.

---

## What is verified working (do not regress while fixing)

| Check | Evidence |
|---|---|
| Selftest control matrix | `node scripts/qa/secret-guard.selftest.mjs` → **16/16**, incl. block cases (Telegram shape, key=value, AWS key id), compliant controls, malformed-payload fail-closed, kill switch |
| `hermes hooks test` live-fire, qa profile | block case `kanban_comment`+token → exit 2, `parsed: {"action":"block",...rule ids...}`; allow case → exit 0, `{}` |
| `hermes hooks test` live-fire, architect profile | block case → exit 2 + rule ids |
| **Real end-to-end enforcement** | a genuine `kanban_comment` tool call from this worker session carrying a synthetic fixture was **refused by the hook**; board confirms `0` comments on `t_b51a1ff3` |
| Block reason leaks nothing | reason quotes rule ids only (`R_SECRET_TELEGRAM_BOT_TOKEN`) — inspected verbatim |
| Guard catches the *real* leaked value | board comment from `t_0af5aa3e` piped into `check` mode → exit 1, `R_SECRET_TELEGRAM_BOT_TOKEN` (value never printed) |
| Whole-board audit | `audit` → exit 1, flags exactly `t_0af5aa3e`; matches the known incident (comment 46/47) |
| Guard source contains no credential | trufflehog on `scripts/qa` → `verified_secrets: 0, unverified_secrets: 0`; gitleaks `--source .`: 6 findings, **none** in `secret-guard.mjs`, `secret-guard.selftest.mjs` or `hooks/` (all 6 pre-existing: 2 historical telegram tokens, 3 familiar `generic-api-key` FPs at `signoff-gate.selftest.mjs:353`, 1 sha256-fingerprint FP) |
| Installed copy == repo copy | sha256 `5cfffb0e7be3…` in all 7 profiles; `fail_closed: true` + correct matcher in all 7 `config.yaml` |
| No silencing surface | no allowlist/exclusion inside the guard; `.gitleaksignore` has one pre-existing historical entry that does not exempt any hook/test file; kill switch absent in all profiles |
| Non-TTY auto-accept mechanism | `agent/shell_hooks.py:504-509` (`accept_hooks=True` → `_record_approval`, no TTY needed) + empirical: qa allowlist entry written at `21:16:47Z`, one second after run 474 spawned — the hook self-registers at worker startup |
| Process rule committed | `SECURITY.md` §"Secrets in Kanban — absolute rule" carries the required wording (only distribution channel = profile `.env`; a worker reads it programmatically) |
| Rotation question asked | `t_0af5aa3e` comment **57** (architect, 21:07:36Z, 1475 B, contains no token-shaped text per the guard audit) — human decision pending, does **not** gate AC 1–5 |

---

## Blocking defects

### D1 — The guard does not exist in the repository (deliverable 1 not delivered)

`48b89a3` adds only `SECURITY.md` + the three evidence files. **All** implementation
artifacts are untracked in the working tree and present in **no** commit on **any** branch:

- `scripts/qa/secret-guard.mjs`, `scripts/qa/secret-guard.selftest.mjs`
- `scripts/qa/hooks/{secret-guard.sh,install-secret-guard.sh,verify-secret-guard.sh,patch-config.py}`

Evidence: `git ls-files scripts/qa/` → empty; `git status --short` → `?? scripts/`;
`git grep secret-guard $(git rev-list --all)` → only `SECURITY.md` + the 3 evidence files;
`git check-ignore` exit 1 (not ignored — simply never added). Additionally **`48b89a3` is
unpushed**: `origin/fix/telegram-token-rotation-t_28951254` is still `9a0a4bb`.

Why it violates the card: a fresh clone / CI / any other profile cannot obtain, install,
re-run or audit the guard; the committed evidence cites `scripts/qa/secret-guard.mjs`, a path
that does not exist in the repo; and the committed `SECURITY.md` "Reference" section points at
the same phantom files. This is also the exact failure the standing rule "workspace is
ephemeral — commit and push before done" exists to prevent.

**Minimum fix:** commit the guard + selftest + hooks + installer/verifier and push the branch
(keeping the evidence secret-free, per the sibling `t_0af5aa3e` regression).

### D2 — `kanban_complete` coverage hole: `result` (and top-level `artifacts`) are not scanned

`scanPayload()` inspects `input.summary` and `input.metadata.{evidence,artifacts,evidence_paths}`
only. Reproduced:

- token in `summary` → **block** (exit 2) ✔
- token in `result` → **allow** (exit 0, `{}`) ✘

`result` is durable board content (`task_runs.result`, shown in Run History and injected into
downstream worker context) — i.e. exactly the "one careless copy away from a public leak"
surface this card exists to close. Top-level `artifacts` (a real `kanban_complete` parameter)
is likewise unscanned.

**Minimum fix:** scan every string-bearing field of the guarded tools, or at minimum add
`result` and top-level `artifacts` (+ a selftest case proving the block).

### D3 — The card's own verifier reports false results in both directions

`scripts/qa/hooks/verify-secret-guard.sh --all` prints **`63 ok · 7 FAIL`**, where every FAIL is
`hook is not allowlisted — non-TTY workers would silently skip it` — including for `architect`
and `qa`, which **are** allowlisted (doctor + `hermes hooks list` + the live e2e block prove the
hook fires). Cause: line 94 greps `hermes hooks list` for the literal `✓ allowlisted`, but Hermes
prints `✓ allowed` → the grep can never match. Conversely line 102-103 prints
`ok - hermes hooks doctor clean` whenever `hermes hooks doctor` **exits 0** — which it does while
printing `2 issue(s) found. Fix before relying on these hooks.` So the "doctor clean" lines are
unsupported claims, and the summary reads as if enforcement were broken everywhere.

This matters because AC1/AC4 rest on this tool being trustworthy proof.

**Minimum fix:** match the real consent token (`✓ allowed`) and judge doctor by its report text
(not its exit code — the documented pitfall), then re-run `--all --live` and commit the output.

---

## Advisories (fix in the same pass where cheap; not blockers)

- **A1 — evidence scope.** `tests/evidence/t_b51a1ff3/hooks-doctor.txt` covers the architect
  profile only; the card asks for the profiles that write to the board. Doctor output for all 7
  is in my transcript — note that 5 profiles (`backend, browser, docs, frontend, product`) still
  read `✗ not allowlisted` until their first dispatch, which is expected to self-heal via
  `hooks_auto_accept: true` (mechanism verified above). The handoff wording "installed + allowlisted
  for all 7" should be corrected to state that.
- **A2 — AC1 evidence form.** AC1 asks for `hermes hooks test` transcripts; the committed
  `live-fire.txt` used direct hook invocation instead, and its fixture is written as
  `8615677595:AAA...AAA`, which does **not** match the guard rule (I get exit 0/allow for that
  exact text). The transcript is therefore not reproducible as committed — use a synthetic
  fixture that actually matches, with the raw `hermes hooks test` output.
- **A3 — deliverable wording.** "State the evaluation order / interaction in the decision log"
  currently lives only inside the evidence file `hooks-doctor.txt`; `SECURITY.md` has zero
  mentions of "evaluation order" / "sign-off gate". Record it in the doc that survives.
- **A4 — AC2 cross-reference.** `QA_SIGN_OFF_GATE.md` is absent from this branch's tree **and**
  from `origin/master` (`git ls-files` → 0 hits, `git ls-tree origin/master` → 0 hits). It lives
  only on the unmerged `qa/t_5455942d-gate-fix`. So the "referenced from the gate documentation"
  half of AC2 is unmet in the tree; either land the reference once that branch merges, or make
  `SECURITY.md` self-contained and record the gate-doc link as an open item with an owner.
- **A5 — matcher breadth.** `kanban_request_review(summary)`, `kanban_block(reason)` and
  `kanban_request_changes(reason)` carry text into durable board/run state and are outside the
  matcher. The card scoped three tools, so this is not a violation — but the same failure mode
  applies; widening costs one line.
- **A6 — honest caveat.** `SECURITY.md` should state that this is a process control, not a
  tamper-proof boundary (board, config and hook run with the worker's own credentials) — the
  sibling gate policy makes the same caveat.
- **A7 — bot id in evidence.** `live-fire.txt` embeds the real bot id `8615677595`. Not a
  credential on its own (the secret half is non-guessable and absent), but a fully synthetic id
  would honour AC3's spirit.

---

## Acceptance-criteria map

| AC | Status | Basis |
|---|---|---|
| 1 — guard present, installed, proven live-fire + selftest | **FAIL** | D1 (guard absent from the repo), A2 (required `hermes hooks test` transcript not the committed one), D3 (verifier unreliable). Enforcement itself is real: hooks test block/allow + a genuine tool call refused |
| 2 — rule committed + referenced from the gate doc | **FAIL (partial)** | rule committed in `SECURITY.md` ✔; gate-doc cross-reference absent from the tree (A4); evaluation order only in an evidence file (A3) |
| 3 — no value in the reason; guard file credential-free | **PASS** | reason quotes rule ids only; trufflehog `0/0` on `scripts/qa`; none of the 6 gitleaks findings touch the guard |
| 4 — evidence incl. `hermes hooks doctor` | **PASS (thin)** | committed, but only 1 of 7 profiles (A1) |
| 5 — no allowlist/exclusion silences the guard | **PASS** | no internal allowlist; the single `.gitleaksignore` entry is historical and exempts no hook/test file; kill switch absent; the remaining silencing vector (un-allowlisted hook) is closed by `hooks_auto_accept: true`, proven for a non-TTY worker |

## Verdict

**changes requested** — D1, D2 and D3 are correctable and must land before this card can pass.
`t_0af5aa3e` comment 57 (rotation decision) stays open for the human and is not a condition of
this verdict; the recommendation recorded there (hold while the board stays on the trusted host;
rotate if board content leaves it; treat as exposed-once until then) is unchanged.
