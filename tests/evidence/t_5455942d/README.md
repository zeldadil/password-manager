# `t_5455942d` — QA sign-off gate: fail closed only on genuinely unverifiable input

**Task:** `t_5455942d` (QA) · **Defect source:** found live while completing `t_0af5aa3e`
· **Artifact:** `QA_SIGN_OFF_GATE.md` + `scripts/qa/signoff-gate.mjs` (QA-owned)
· **Branch:** `qa/t_5455942d-gate-fix` (based on `feature/t_430aa9a3`, the branch that owns the gate)

Three defects blocked **compliant** cards. All three were reproduced live against the real board first,
then fixed, re-installed in all 7 profiles, and re-verified.

## 1. What was wrong (reproduced, pre-fix)

`prefix-transcript.txt` — captured with the *installed* gate (`sha256 00807b00…`) on the real board:

| # | Defect | Live pre-fix result |
|---|---|---|
| 1 | Task-id resolution trusted `extra.task_id` **before** `$HERMES_KANBAN_TASK`, and `extra.task_id` is the Hermes **session id** — so a `kanban_complete()` without an explicit `task_id` blocked a compliant card | `{"decision":"block","reason":"signoff-gate: task 20260917_201256_021f5e is not on the board at /home/sap/.hermes/kanban.db. Failing closed."}` (exit 2) |
| 2 | `R5` resolved the evidence paths of **every** comment that parsed as a verdict, including superseded ones and a handoff that merely *quoted* the recommended `QA-VERDICT:` line | `R5_EVIDENCE_FILE_MISSING` × 3 on `t_0af5aa3e`: `tests/evidence/t_0af5aa3e/gitrepo-post-purge-state.md`, `tests/evidence/t_0af5aa3e/QA-VERDICT.md`, `scripts/qa/signoff-gate.selftest.mjs` (exit 1) |
| 3 | The "linked child card assigned to `qa` ⇒ verdict deferral" heuristic fired although the card carried an explicit terminal verdict | `warn A2_DEFERRAL_OPEN: QA verdict deferred to t_5455942d (qa, status=running)` |

`prefix-check-t_0af5aa3e.json` is the machine-readable pre-fix evaluation of `t_0af5aa3e`.

## 2. Root cause of defect 1 is deeper than the payload: the hook cannot see `HERMES_KANBAN_TASK`

`agent/inline_tool_executors.py::tool_hook_ids` passes `task_id=effective_task_id`, which for a dispatcher
worker is the **session id** — that is how the session id reaches `extra.task_id`. The natural fallback
(`$HERMES_KANBAN_TASK`) is **not available to the hook at all**: `agent/delegation_context.py` defines
`KANBAN_ENV_KEYS = (HERMES_KANBAN_TASK, HERMES_KANBAN_RUN_ID, HERMES_KANBAN_CLAIM_LOCK, HERMES_KANBAN_GOAL_MODE,
HERMES_KANBAN_GOAL_MAX_TURNS)` and `scrub_kanban_env()` strips them from **descendant** processes, and a hook
subprocess is a descendant.

`hook-env-probe.py` / `hook-env-probe.txt` prove it on this host (worker pid 182648 *has*
`HERMES_KANBAN_TASK=t_5455942d`; the hook env built through `build_subprocess_env()` does **not**):

```
HERMES_KANBAN_TASK present in the hook's env: False
HERMES_KANBAN_RUN_ID present in the hook's env: False
HERMES_KANBAN_WORKSPACE=/home/sap/.hermes/kanban/workspaces/t_5455942d   ← survives, and names the card
```

So a fix that only re-ordered the three payload sources would still have blocked the natural call. The
resolver therefore also derives the card from the worker's **location** (`$HERMES_KANBAN_WORKSPACE` basename,
the hook's `cwd` basename, `$HERMES_KANBAN_BRANCH` last segment), always verified against the board.
The scrub itself is deliberate runtime scoping and was **not** undone (recorded in §10 of the policy,
owner `architect`).

## 3. The fix

`gate-fix.diff` is the complete diff (4 files, +632/−54).

1. **Task-id resolution** (`resolveTaskId`) — explicit payload sources first (`tool_input.task_id` → `extra.task_id`
   **only in `t_[0-9a-z]+` shape** → `$HERMES_KANBAN_TASK`), then the location fallbacks above; numeric candidates
   resolve through the board's own `task_runs` index. A shape-valid `tool_input.task_id` that is not on the board
   still blocks — and the reason **names the source**. Nothing resolvable → block listing every source tried.
2. **`R5` scoped to the operative verdict** — evidence pointers are tagged `operative` (newest verdict / the run
   that carries it / attachments); only operative paths can fail `R5`. Superseded paths become the advisory
   `A5_EVIDENCE_SUPERSEDED`, and an operative path that is absent from the checkout but present **on any ref**
   (`git rev-list --max-count=1 --all -- <path>`) is accepted as committed evidence with advisory
   `A4_EVIDENCE_OFF_TREE`.
3. **Deferral heuristic narrowed** — the linked-`qa`-child heuristic only applies while the card records **no**
   verdict in the §12 vocabulary; an explicit `QA-VERDICT: deferred — t_…` marker still wins.
4. **Verifier fixes** (`verify-signoff-gate.sh`) — it demanded the *quoted* YAML matcher spelling (Hermes rewrites
   it to a bare scalar when recording consent → 5 false failures), its `--live` allow-case could not pass for a
   path-based compliant card (new `--fixture-repo` sets the live fire's cwd), and `hermes hooks doctor` exits 0
   while printing issues, so "clean" is now judged from the report, not the exit code.
5. **Policy** — `QA_SIGN_OFF_GATE.md`: §4 rule table (`R5` scope, `A4`, `A5`), §5.3/§5.4 (cross-ref evidence,
   narrowed heuristic), **§6.4 task-id resolution table**, §8.1 troubleshooting (the session-id block + the
   `task_id="t_…"` workaround + the stale-install trap), §9 rollout, §10 open items 5–7, §11 changelog.

## 4. Acceptance criteria → evidence

| Criterion | Verdict | Evidence |
|---|---|---|
| No `tool_input.task_id`, session id in `extra.task_id` → **allows** the completion | **PASS** | `postfix-transcript.txt` fix 1a (`{}`, exit 0); selftest (a) |
| …and it also allows in the **real** worker env, where `$HERMES_KANBAN_TASK` is absent | **PASS** | `postfix-transcript.txt` fix 1b — the hook resolved **`t_5455942d`** (this card) from `HERMES_KANBAN_WORKSPACE` and reported its real R1/R4 gaps instead of the session id; selftest (f), (g) |
| Unknown task id still blocks, reason **names the source** | **PASS** | `postfix-transcript.txt` fix 1e (`task t_deadbeef (from tool_input.task_id) is not on the board`); selftest (d) |
| Genuinely unresolvable input is still fail-closed, with all sources listed | **PASS** | `postfix-transcript.txt` fix 1d; selftest (b), (h) |
| `R5` no longer fails on superseded comments; still fails on the operative verdict | **PASS** | `postfix-transcript.txt` (0 violations, 3 × `A5`); selftest `BE-911` / `BE-912` rule-coverage case |
| Operative evidence on another ref is accepted | **PASS** | selftest `BE-913` (`A4_EVIDENCE_OFF_TREE`, `facts.evidence[].via_ref` set) |
| `qa`-owned child no longer read as a deferral; the legacy heuristic still fires without a verdict | **PASS** | selftest `BE-914` (deferral `null`, no `A2`) + `BE-900e` control (`A2_DEFERRAL_OPEN` present) |
| **No rule weakened**: R1–R7 fire as before; all pre-existing controls clean | **PASS** | `selftest-matrix.txt` — **49/49** (the original 33 cases unchanged and green, +16 new) |
| No allowlist / exclusion added (TEST_STRATEGY §12.2) | **PASS** | `gate-fix.diff`; no `.gitleaksignore`/exclusion touched, `fail_closed` unchanged |
| Hook re-installed per profile, `hermes hooks doctor` re-run | **PASS (1 warn)** | `install-all-apply.txt` (7/7 copied), `hooks-doctor-qa.txt`, `verify-all-live.txt` — all 7 installed copies hash-match the repo copy (`2965fde1…`); doctor's only warning is the expected post-install *mtime drift* (approval refresh is interactive-only; `hooks_auto_accept: true` and the live fires prove the hook is active) |

Verification matrix: `verify-all-live.txt` — **84 ok · 7 warn · 0 FAIL** (was 79 ok · 12 FAIL before the
verifier fixes; the 12 were 5 false matcher failures + 7 `--live` allow-cases blocked by the fixture's cwd).

## 5. Reproduce

```
bash tests/evidence/t_5455942d/reproduce.sh          # selftest + live hook cases + check --pre-complete
node scripts/qa/signoff-gate.selftest.mjs            # 49/49
node scripts/qa/signoff-gate.selftest.mjs --keep     # leaves the fixture board + repo for the verifier
bash scripts/qa/hooks/verify-signoff-gate.sh --all --live \
  --fixture-db /tmp/signoff-gate-selftest-XXXX/board.db \
  --fixture-noncompliant t_b000000b --fixture-compliant t_b0000000 \
  --fixture-repo /tmp/signoff-gate-selftest-XXXX/repo
/…/hermes-agent/venv/bin/python tests/evidence/t_5455942d/hook-env-probe.py   # env the hook really sees
```

`reproduce-output.txt` is the recorded run of `reproduce.sh` on this host.

## 6. Findings routed / recorded

- **Not fixed here (deliberate core behaviour, owner `architect`, policy §10 item 7):** the payload's
  `extra.task_id` is the session id and the kanban identity keys are scrubbed from hook subprocesses. The gate
  compensates from the worker's location; un-scrubbing the identity keys for the gate's convenience would weaken
  the runtime scoping. **No Hermes-core change is required for this defect.**
- **New advisory (policy §10 item 6, owner `architect`):** the hook subprocess env still carries
  `HERMES_DASHBOARD_BASIC_AUTH_USERNAME/PASSWORD/SECRET` (see `hook-env-probe.txt`, values redacted — no credential
  value appears in this directory or on this branch).
- **Residual (policy §10 item 5, owner `qa`):** a comment that merely quotes the `QA-VERDICT:` template is parsed
  as a verdict; `R5` scoping contains the harm, but a *newest* quote would still become operative.

## 7. Contents

| File | What it is |
|---|---|
| `README.md` | this index + verdict basis |
| `reproduce.sh`, `reproduce-output.txt` | one-command reproduction and its recorded output |
| `prefix-transcript.txt` | pre-fix live reproduction (all three defects, real board) |
| `postfix-transcript.txt` | post-fix re-run of the same payloads against the installed gate |
| `prefix-check-t_0af5aa3e.json`, `postfix-check-t_0af5aa3e.json` | `check --pre-complete` before/after |
| `selftest-matrix.txt` | 49-case non-vacuity matrix |
| `verify-all-live.txt` | profile verifier: wiring, consent, hash, doctor, live block + allow fire |
| `install-all-apply.txt` | hook re-install in all 7 profiles |
| `hooks-doctor-qa.txt` | `hermes hooks doctor` for the `qa` profile |
| `hook-env-probe.py`, `hook-env-probe.txt` | proof that `HERMES_KANBAN_TASK` is scrubbed from the hook env |
| `gate-fix.diff` | full diff of the four changed files |
