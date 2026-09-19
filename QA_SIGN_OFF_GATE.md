# QA_SIGN_OFF_GATE.md — QA Verdict & Evidence Sign-off Gate

**Maintained by:** `qa` · **Consumed by:** all profiles (`architect`, `backend`, `frontend`, `browser`, `docs`, `product`, `qa`)
**Task:** QA-001h (`t_430aa9a3`) · **Status:** Active — enforced from `2026-09-17T15:00:00Z`
**Normative source:** `TEST_STRATEGY.md` §11 (evidence) + §12 (verdict/sign-off gate) — this document is their **operational annex**: the exact rules, the recording format, and the tooling that enforces them.

---

## 1. The rule

> **No task reaches `done` without a QA verdict and attached evidence.**

Stated exactly, one card may only complete when **all** of the following hold:

1. **A verdict is recorded on the card** in the §12 vocabulary — `pass`, `pass-with-conditions`, `fail`, `blocked` — recorded by the `qa` profile, **or** the card carries a valid **deferral** to a QA-owned downstream card (§5.4).
2. **Evidence is attached to the card** — a Kanban attachment, a CI run URL, or a committed path that actually exists in the repo (`tests/evidence/<task-id>/…`).
3. For **crypto / bridge / auth cards** the Architect half of the AR-6 sign-off is recorded too (§5.5).
4. The verdict is **terminal-consistent** (`fail`/`blocked` never sits on a `done` card) and, for `pass-with-conditions`, its conditions are tracked.

The gate is mechanical: `scripts/qa/signoff-gate.mjs` evaluates it, a Hermes `pre_tool_call` shell hook **blocks `kanban_complete`** while a rule fails, and the same script audits the whole board on demand.

**Why:** verification must be evidence-based, never a claim. TEST_STRATEGY §2 already says a card "may not be marked `done` on a claim alone"; SEC-001's absolute rules (AR-2 no secrets, AR-3 crypto tests, AR-5 migrations, AR-6 crypto review) are only real if something refuses the transition when they are missing. The gate is the mechanism that refuses.

---

## 2. Scope and enforcement layers

| Layer | Mechanism | Effect |
|---|---|---|
| **Blocking (pre-completion)** | Hermes shell hook `pre_tool_call` with matcher `^kanban_complete$` in every profile's `config.yaml`, `fail_closed: true` | `kanban_complete` returns a block directive with the failing rule ids and the fix. The card stays in its current column. |
| **Detection (board audit)** | `node scripts/qa/signoff-gate.mjs audit` (exit 1 on violations) | Full-board report for QA / release / retro audits; suitable for cron or a CI job. |
| **Human review** | `kanban_request_review` / `kanban_request_changes` | Unchanged: the gate never replaces review, it only guarantees a verdict+evidence exists. |

### What the gate is *not*

The board database and the profile configs live on the trusted host, and the hook runs with the worker's own credentials. The gate therefore guarantees **no accidental or silent non-compliant completion, plus a durable audit trail** — it is a process control, not a tamper-proof boundary against a hostile agent (any agent with shell access could edit the board or touch the kill switch). Tamper *detection* is the audit layer's job: `hermes hooks doctor` flags hook-script drift, and the verifier below compares the installed gate against the reviewed repo copy by SHA-256.

---

## 3. Verdict vocabulary and where it is recorded

| Source | How it is detected | Accepted for |
|---|---|---|
| **Marker comment** (preferred) | body contains `QA-VERDICT: <token>` — case/spacing-insensitive, `QA verdict — <token>` also parses | any card |
| **QA-authored comment** | comment by the `qa` profile containing `verdict … <token>` | any card |
| **Structured handoff** | completed run metadata `verdict` (e.g. `_metadata_.verdict` written by `kanban_complete`) | QA's own artifact cards (self-validation per §12 row 4) |
| **Deferral** | `QA-VERDICT: deferred — t_xxxxxxxx`, or a linked child card assigned to `qa` **when the card records no verdict of its own** | any card whose QA review is a downstream card |

When several sources exist, the **newest** one is the operative verdict.

---

## 4. Rules

`R*` failures block; `A*` findings are advisory. Rule ids are stable and appear verbatim in the block message and the audit JSON.

| Rule | Check | How to satisfy |
|---|---|---|
| `R1_QA_VERDICT_MISSING` | no QA verdict and no valid deferral | record a verdict comment, or defer to a QA-owned child card |
| `R2_QA_VERDICT_INVALID` | a verdict token outside `pass · pass-with-conditions · fail · blocked` | use an exact vocabulary token |
| `R3_VERDICT_NOT_TERMINAL` | card is `done` while its latest verdict is `fail`/`blocked` | fix the defect and re-verdict, or move the card back to the owning agent |
| `R4_EVIDENCE_MISSING` | no attachment, no named artifact, no run-metadata artifact | attach the file (`kanban attach`) or name a CI run URL / committed path in the verdict comment |
| `R5_EVIDENCE_FILE_MISSING` | an evidence file/directory **claimed by the operative (newest) verdict** (§5.7 — inside its `Evidence:` label, or outside code spans/fences when it carries no label) does not exist — in the worker's checkout or on any other ref of the repo | commit the artifact, fix the path, or name the CI run instead |
| `R6_CONDITIONS_UNTRACKED` | `pass-with-conditions` with no follow-up card id / issue link / follow-up item | enumerate the conditions and the card or issue that tracks each one |
| `R7_SECURITY_TRACK_SIGNOFF_MISSING` | crypto/bridge/auth card (security Test Type + crypto-bridge keyword heuristic) with no Architect sign-off comment | Architect reviews and comments (any of `signed off`, `approved`, `ARCH-VERDICT: …`) |
| `R8_DEFERRAL_TARGET_INVALID` | deferral names a missing card, a non-QA card, or a QA card that is `done` without verdict + evidence | defer to a real `qa`-assigned card that carries its own verdict + evidence |
| `A1_HISTORY_UNGATED` | card completed **before** the gate epoch (grandfathered) | advisory only; `--strict-history` turns it into a failure for retrofit audits |
| `A2_DEFERRAL_OPEN` | deferral target still open | audit tracks it until the QA card lands |
| `A3_EVIDENCE_UNVERIFIED` | evidence path could not be checked (no repo root available) | report-only |
| `A4_EVIDENCE_OFF_TREE` | operative evidence exists in the repo **on another ref**, not in this worker's checkout | report-only — accepted as committed evidence (§5.3) |
| `A5_EVIDENCE_SUPERSEDED` | a path named in a **superseded** verdict/handoff is absent from this checkout | report-only — history must not block a compliant card |
| `A6_EVIDENCE_CITED` | a path named in the operative verdict only as a **citation** — reporting another card's artifact, cross-checking it, quoting a defect transcript — is absent from this checkout | report-only — the card that *reports* a broken pointer elsewhere must stay completable (§5.7) |
| `X1_EXCEPTION` | a recorded `qa-signoff-exception:` marker (§5.6) | report-only — exceptions stay visible in every audit |

**Fail closed only on genuinely unverifiable input** (added 2026-09-17, `t_5455942d`). The gate blocks when it cannot
establish the facts it needs (no resolvable task id, unreadable board, unparseable payload, a violation it *can*
prove) — not when a resolvable question was resolved to the wrong object. Concretely: `R5` and the deferral
heuristic are scoped to the operative verdict, and a task id must have the shape `t_[0-9a-z]+`.

---

## 5. Recording a verdict

### 5.1 Command and shape

```
hermes kanban comment <task-id> --author qa --body "QA-VERDICT: <token> — <one-line basis>. Evidence: <artifact>"
```

The **evidence pointer must be in the same comment** (or attached via `kanban attach`) — "tests pass" alone is not evidence (TEST_STRATEGY §11). Keep the `Evidence:` label: it is what the gate reads as *this card's own* evidence (§5.7), and it is what lets the same comment quote another card's path without claiming it.

### 5.2 Examples

```
QA-VERDICT: pass — unit 42/42 + integration 11/11 green at 6660601.
Evidence: https://github.com/zeldadil/password-manager/actions/runs/35234119567
```

```
QA-VERDICT: pass-with-conditions — CI artifacts wired but inert until the lockfile bootstrap
lands. Follow-ups: t_ee24fd37 (lockfile), t_18ae13ea (scanner versions).
Evidence: tests/evidence/t_78b46688/README.md
```

```
QA-VERDICT: fail — AR-3 negative case missing for tag verification (CRY-04).
Defect card: t_1234abcd. Evidence: tests/security/NEGATIVE_TEST_CHECKLIST.md
```

### 5.3 Evidence formats the gate accepts

| Form | Example | Verified by the gate |
|---|---|---|
| Task attachment | `kanban attach <task-id> report.json` | stored path exists |
| CI run / PR / issue URL | `https://github.com/zeldadil/password-manager/actions/runs/123` | format only (offline) |
| Committed repo path | `tests/evidence/<task-id>/README.md`, `coverage/lcov.info` | **file must exist** in the worker's checkout (`payload.cwd`) **or on any ref of that repo** (`A4_EVIDENCE_OFF_TREE`) |
| Directory path | `tests/evidence/<task-id>/` | directory must exist (same rule) |
| Path **cited** about another card (not claimed) | a quote inside a defect report: ``… names `tests/evidence/t_xxxxxxxx/README.md`, absent from every ref …`` | never resolved by `R5`; reported as `A6_EVIDENCE_CITED` when absent (§5.7) |
| Run-metadata `artifacts` (structured handoff) | `metadata.artifacts: [...]` | same rules as above, for the run that carries the operative verdict |

Only the **operative (newest) verdict's** paths are resolved for existence (`R5`). Paths cited by a superseded
verdict, an earlier worker's handoff, or an older run are reported as `A5_EVIDENCE_SUPERSEDED` — a card that once
cited an artifact from another branch or another worker's checkout must stay completable.

Within the operative verdict, `R5` resolves only the paths that verdict **claims as its own evidence**; a path it
merely quotes about another card is a citation (`A6_EVIDENCE_CITED`). §5.7 defines the two — a verdict that reports
a broken evidence pointer on another card stays completable, which is the whole point of being able to report it.

### 5.4 Deferring QA to a downstream card

Legal **only** when the QA review genuinely happens in another card (a pre-created QA/review child, e.g. QA-002 aggregation):

```
hermes kanban comment <task-id> --author qa --body "QA-VERDICT: deferred — t_xxxxxxxx (QA-002 release verification). Evidence: tests/evidence/<task-id>/README.md"
```

The named card must exist and be assigned to a QA profile. The gate then requires **that** card to carry the verdict + evidence; while it is open the audit reports `A2_DEFERRAL_OPEN`. A deferral is not a way to skip QA — it is a way to move the verdict to the card that actually performs it.

**Linked-child heuristic (narrowed 2026-09-17, `t_5455942d`).** A card that records **no verdict of its own** and has a
`qa`-assigned child card is read as a deferral to that child (convenience for pre-created review children). That
heuristic is **suppressed as soon as the card carries an explicit verdict** in the §12 vocabulary: creating unrelated
`qa`-owned repair work under a card must not re-read the card as a verdict deferral (it used to raise a false
`A2_DEFERRAL_OPEN`, and would have judged the repair card's verdict). An explicit `QA-VERDICT: deferred — t_...`
marker always wins.

### 5.5 Architect sign-off (crypto / bridge / auth)

AR-6 requires Architect **and** QA sign-off on anything touching the crypto boundary. The Architect records it as a comment on the same card, e.g.
`AR-6 review — nonce handling and key-wrap interface reviewed; signed off (architect, 2026-09-17)`.
The gate treats a comment authored by `architect` containing `signed off` / `approved` / `ARCH-VERDICT:` / `LGTM` as that sign-off. The heuristic that identifies a "security track" card is deliberately conservative (security Test Type **and** a crypto/bridge keyword); a false positive is cleared by the Architect commenting, or by a §5.6 exception.

### 5.6 Exceptions (audited, never silent)

```
hermes kanban comment <task-id> --author qa --body "qa-signoff-exception: <reason> (approved by <who>, expires <when>)"
```

An exception marker bypasses `R1`–`R8` for that card and is reported as `X1_EXCEPTION` in **every** audit, so it cannot be forgotten. Exceptions are for incidents and hotfixes, not for routine work.

---

### 5.7 Whose evidence is it? — claimed vs cited (the label rule)

**Policy (decided 2026-09-18, `t_99e408c5`).** *Naming a path is not claiming it.* A path recorded in a verdict is
treated as **this card's evidence** only when the verdict **claims** it; the gate resolves exactly the claims for
existence, and `R5` may only block on a claim:

1. **Claimed evidence** — everything from an **evidence label** to the end of that label's paragraph (a blank line,
   heading or table row closes it). The labels are `Evidence:`, `Artifact:`/`Artifacts:`, `Attachment:`/`Attachments:`
   — case-insensitive, bold (`**Evidence:**`) or plain, anywhere in the comment. The `Evidence:` of §5.1 is therefore
   **normative, not decoration**.
2. **No label in the comment** — the whole comment is read as the claim (legacy behaviour), *except* paths inside
   **code spans or fenced blocks**, which are documentation — a pasted command, a quoted recording template, a defect
   transcript. This is the same principle already applied to deferral markers (`t_c3cb6842`, `t_58280940`).
3. **Attachments** (`kanban attach`) and run-metadata `artifacts` are always claims.
4. **Everything else** named in the operative verdict — a defect report about another card, a cross-check, a table row
   — is a **citation**: never `R5`, and reported as `A6_EVIDENCE_CITED` when it is absent from the checkout *and* from
   every ref of the repo.

**Why.** A card whose verdict *reports* a broken evidence pointer on another card names that card's path in the
process. Before this rule the gate failed the reporting card itself with `R5_EVIDENCE_FILE_MISSING` for the quoted
path, so the finding could only be recorded by not naming it — the gate penalised the defect report (`t_7dd3b960`,
reproduced on the live board: `tests/evidence/t_99e408c5/ab-replay-reported-instance.txt`). Enforcement is unchanged
where it matters: a **claimed** artifact that does not exist still fails `R5` — written plain, in backticks, or inside
the label (selftest cases `QA-922`/`QA-923`/`QA-925` in `scripts/qa/signoff-gate.selftest.mjs`).

**How to record.** Put your own artifacts after an `Evidence:` label (§5.1). When reporting another card's broken
pointer, quote the path freely — the audit shows it as `A6_EVIDENCE_CITED`.

---

## 6. Enforcement tooling

All paths are relative to the repo root.

| Command | Purpose |
|---|---|
| `node scripts/qa/signoff-gate.mjs audit` | whole board; exit 1 while any enforced card fails; `--json`, `--repo DIR`, `--epoch-iso ISO`, `--strict-history` |
| `node scripts/qa/signoff-gate.mjs check --task t_xxxxxxxx [--pre-complete]` | one card; `--pre-complete` evaluates a card that is not `done` yet (exactly what the hook does) |
| `echo '<payload>' \| node scripts/qa/signoff-gate.mjs hook` | hook entry point: `{}` + exit 0 = allow, `{"decision":"block",…}` + exit 2 = block |
| `node scripts/qa/signoff-gate.selftest.mjs` | 66-case non-vacuity proof on a throwaway fixture board (every rule fires; every compliant control passes; the `t_5455942d`, `t_58280940` and `t_99e408c5` regressions are covered) |
| `scripts/qa/hooks/install-signoff-gate.sh --all [--apply]` | install / refresh the hook in every profile (dry-run by default, config backed up) |
| `scripts/qa/hooks/verify-signoff-gate.sh --all --live --fixture-db … --fixture-noncompliant … --fixture-compliant …` | verify wiring, consent, hash, `hermes hooks doctor`, and fire both paths live |

Board DB resolution: `$HERMES_KANBAN_DB` → `~/.hermes/kanban.db`. Reads go through the `sqlite3` CLI (present on the host and on ubuntu runners) with a `node:sqlite` fallback.

### 6.1 Installed hook (per profile)

```yaml
hooks:
  pre_tool_call:
    - matcher: "^kanban_complete$"
      command: "<profile-home>/agent-hooks/qa-signoff-gate.sh"
      timeout: 30
      fail_closed: true
hooks_auto_accept: true
```

- `fail_closed: true` — a missing `node`, a missing gate script, an unparseable payload or an unreadable board **blocks** completion (with the reason) instead of silently allowing it.
- `hooks_auto_accept: true` — dispatcher-spawned workers are non-TTY; without it Hermes skips un-allowlisted hooks (documented behaviour), which would make the gate silently inert.
- After changing `scripts/qa/signoff-gate.mjs`, **re-run the installer** (the profile copy is what executes) and re-run the verifier — it fails on hash drift.

### 6.2 Kill switch (operational escape)

```
touch ~/.hermes/signoff-gate.disabled     # every completion is allowed again, hook logs why
```

Use only while the gate itself is being repaired; remove immediately afterwards. The file is checked on every fire, and allowed completions are written to the hook's stderr log.

### 6.3 Rollback

```
cp <profile>/config.yaml.bak.<timestamp> <profile>/config.yaml   # per profile
rm -rf <profile>/agent-hooks
```

### 6.4 How the hook finds the card (task-id resolution)

`kanban_complete` may be called without `task_id` (it defaults to `$HERMES_KANBAN_TASK` inside the tool), so the hook
payload does not always name the card. The hook resolves it in this order, and **verifies every candidate against
the board** before evaluating it:

| # | Source | Notes |
|---|---|---|
| 1 | `tool_input.task_id` | explicit argument; if it has task-id shape but is not on the board, the gate **blocks and names the source** |
| 2 | `extra.task_id` | the Hermes kwarg `task_id` — carried as the **session id** for dispatcher workers, accepted only in `t_[0-9a-z]+` shape |
| 3 | `$HERMES_KANBAN_TASK` | the dispatcher's identity variable |
| 4 | basename of `$HERMES_KANBAN_WORKSPACE` | the worker's workspace is `<root>/workspaces/<task-id>` |
| 5 | basename of the hook's `cwd` | the worker's checkout (`<repo>/.worktrees/<task-id>`) |
| 6 | last segment of `$HERMES_KANBAN_BRANCH` | `wt/<task-id>`, `<project>/<task-id>` |

A numeric candidate is resolved through the board's own `task_runs` index (run id → card), never guessed. If nothing
resolves, the block reason lists every source and what it carried.

Sources 4–6 exist because **Hermes deliberately scrubs the kanban identity variables out of descendant processes**:
`agent/delegation_context.py` defines `KANBAN_ENV_KEYS = (HERMES_KANBAN_TASK, _RUN_ID, _CLAIM_LOCK, _GOAL_MODE,
_GOAL_MAX_TURNS)` and `scrub_kanban_env()` removes them, so a hook subprocess (a descendant) never sees
`HERMES_KANBAN_TASK` — confirmed empirically in `tests/evidence/t_5455942d/` (`hook-env-probe.py`). That scrub is a
deliberate runtime-scoping behaviour and must not be undone for the gate's convenience.

---

## 7. Effective date and grandfathering

Enforcement starts at **`2026-09-17T15:00:00Z`** (`GATE_EPOCH_ISO` in `scripts/qa/signoff-gate.mjs`; override with `--epoch-iso`). Cards already `done` before that instant are **grandfathered**: the audit lists them with `A1_HISTORY_UNGATED` advisories but does not fail the run.

Grandfathering is not an amnesty: `node scripts/qa/signoff-gate.mjs audit --strict-history` reports the full pre-epoch backlog (26 cards at activation) so it can be retrofitted by decision rather than by habit.

---

## 8. When the gate blocks you

1. Read the rule ids in the block message — they name the exact gap.
2. Fix the gap **on the card** (record the verdict, attach/named evidence, deferral, exception).
3. Re-issue `kanban_complete`.
4. If the block itself looks wrong (false positive), do **not** touch the kill switch: comment the card and route it to `qa` — a rule defect is a gate defect, and gate defects are P1 for QA.

Repeated blocking for the same non-compliance is not an infrastructure failure; it is the gate doing its job. The default fix is to record what you actually verified — not to lower the bar.

### 8.1 Troubleshooting the hook itself

**`signoff-gate: task 20260917_201256_021f5e is not on the board …`** — the id in the message is the Hermes
**session id**, not a card id. This was a gate defect: a `kanban_complete` call that omits `task_id` carries the
session id in the payload's `extra.task_id`, and the resolver used to trust it. It is fixed — a task id must match
`t_[0-9a-z]+`, and when the payload names nothing usable the hook resolves the card from the worker's location
(`$HERMES_KANBAN_WORKSPACE`, the checkout `cwd`, `$HERMES_KANBAN_BRANCH`), see §6.4. **If you still see it**, the
workaround is one argument:

```
kanban_complete(task_id="t_xxxxxxxx", summary=..., metadata=...)
```

Then report it to `qa`: the hook is supposed to resolve this by itself, and a recurrence means the installed copy is
stale (see below), not that you did something wrong.

**`R5_EVIDENCE_FILE_MISSING: … does not exist`** — check *which* verdict names the path. Only the newest (operative)
verdict is resolved; a path from a superseded verdict or another worker's handoff shows up as
`A5_EVIDENCE_SUPERSEDED` instead, and a path the operative verdict only *quotes about another card* shows up as
`A6_EVIDENCE_CITED` (§5.7). If the operative verdict genuinely claims a missing file, commit it, fix the path, or cite
the CI run URL. A path that exists only on another branch is accepted (`A4_EVIDENCE_OFF_TREE`). If the message points at
a path you never claimed, the blocked card is a gate false positive — report it to `qa` rather than deleting the
sentence that named it.

**The installed copy may be stale.** The hook executes `<profile>/agent-hooks/signoff-gate.mjs`, not the repo file.
Any gate change must be re-installed, or you are debugging old logic:

```
scripts/qa/hooks/install-signoff-gate.sh --all --apply
scripts/qa/hooks/verify-signoff-gate.sh --all --live
hermes hooks doctor
```

`verify-signoff-gate.sh` fails on SHA-256 drift between the repo copy and the installed copies; `hermes hooks doctor`
flags exec-bit/consent/mtime drift.

**`hermes hooks doctor` after a re-install: 2 issues per profile is expected on this host, not a defect.** Every
profile runs **two** hooks (`qa-signoff-gate.sh` and `secret-guard.sh`), and `doctor` reports `script modified since
approval` for each one whose mtime moved — for the sign-off gate that is exactly what a re-install does. The approval
refresh (`hermes hooks revoke` + re-approve) is interactive-only, so a headless re-install cannot clear it. The
verifier tolerates **one** such warning and therefore reports FAIL on such a profile; read the warning text before
treating it as drift: both entries must be `script modified since approval`, with `script exists and is executable`,
`allowlisted` and `produced valid JSON` all green.

**Confirm what the gate would decide, without touching the kill switch:**

```
node scripts/qa/signoff-gate.mjs check --task t_xxxxxxxx --pre-complete --repo "$PWD"
```

---

## 9. Rollout status (2026-09-17)

| Profile | Hook installed | Config patched (`fail_closed`, auto-accept) | Live fire (block + allow) |
|---|---|---|---|
| `architect` | ✅ | ✅ | ✅ |
| `backend` | ✅ | ✅ | ✅ |
| `browser` | ✅ | ✅ | ✅ |
| `docs` | ✅ | ✅ | ✅ |
| `frontend` | ✅ | ✅ | ✅ |
| `product` | ✅ | ✅ | ✅ |
| `qa` | ✅ | ✅ | ✅ |

Verified by `scripts/qa/hooks/verify-signoff-gate.sh --all --live` → **91 checks, 0 failures** (transcript in `tests/evidence/t_430aa9a3/`). Config backups: `<profile>/config.yaml.bak.20260917*`.

**Re-installed 2026-09-17 (post `t_5455942d`)** with the fixed gate + hook in all 7 profiles
(`install-signoff-gate.sh --all --apply`), followed by `verify-signoff-gate.sh --all --live` and
`hermes hooks doctor`; all installed copies match the repo copy by SHA-256 (transcript in
`tests/evidence/t_5455942d/`). One profile (`architect`) had carried a local, uncommitted hand-patch of the gate
(resolving *run* ids ad hoc); it was overwritten by the reviewed repo copy — that local edit is what the
re-install + hash check exists to catch.

The verifier itself needed two fixes to report the truth (same card): it demanded the *quoted* YAML spelling of the
matcher, which Hermes rewrites to a bare scalar when it records hook consent (5 false `matcher is not
^kanban_complete$` failures), and its `--live` allow-case could not pass for a compliant fixture card whose evidence
is a repo path, because the live payload's `cwd` was the verifier's own checkout. `--fixture-repo DIR` now sets the
`cwd` of the live payload; pass the fixture repo that holds the compliant card's evidence.

---

## 10. Open items

| # | Item | Owner |
|---|---|---|
| 1 | Whether the board audit also runs as a CI job (`qa-signoff`) — `.github/workflows/ci.yml` is currently a collision hotspot across CI cards, so this needs a decision, not a silent edit | `architect` |
| 2 | Pre-epoch backlog (26 cards) — retrofit with verdict+evidence, or formally leave grandfathered | `architect` + `qa` |
| 3 | `R7` security-track detection is a keyword heuristic (security Test Type + crypto/bridge keyword); confirm the classification list against ADR-002 §5.3 / ADR-005 §9.2 | `architect` |
| 4 | Advisory-only cross-board audit: non-default boards (e.g. release-track boards) run the same hook, but the audit needs `--db` pointed at them | `qa` |
| 5 | A comment that *quotes* the recommended `QA-VERDICT: …` line (e.g. an Architect handoff showing the exact command to paste) is parsed as a verdict. With `R5` scoped to the operative verdict the harm is contained, but if such a quote is the *newest* record it becomes operative. **Partly decided (`t_99e408c5`, 2026-09-18):** §5.7 now defines code spans/fences as documentation for **evidence extraction** (claim vs citation, `A6_EVIDENCE_CITED`), and `VERDICT_MARKER_RE`/`DEFERRAL_RE` already carry the leading-boundary guard (`t_c3cb6842`/`t_58280940`). What remains open is giving the **marker** regexes the same code-span/fence exclusion — a change to verdict *detection*, deliberately not bundled with the evidence fix | `qa` (gate lane) |
| 6 | Hermes-core observation (config, not a repo defect): the hook subprocess env still carries `HERMES_DASHBOARD_BASIC_AUTH_USERNAME/PASSWORD/SECRET` — see `hook-env-probe.py`. Any hook script of any profile can read the dashboard admin credentials; consider whether hooks need them (they do not) | `architect` (owns the Hermes install/profile config) |
| 7 | Hermes-core observation (payload, not a repo defect): the `pre_tool_call` payload's `extra.task_id` is the *session id* (`agent/inline_tool_executors.py::tool_hook_ids` → `effective_task_id`), and the kanban identity keys are scrubbed from hook subprocesses (`agent/delegation_context.py::scrub_kanban_env`). The gate now compensates from the worker's location §6.4; do **not** "fix" this by un-scrubbing the identity keys — that scrub is deliberate runtime scoping | `architect` (record only) |

---

## 11. Changelog

| Date | Change |
|---|---|
| 2026-09-17 | Initial gate: rules R1–R8 + advisories, blocking `kanban_complete` hook in all 7 profiles, board audit, 33-case selftest, epoch `2026-09-17T15:00:00Z`, kill switch and exception protocol |
| 2026-09-17 | `t_5455942d` — fail closed only on genuinely unverifiable input: (1) task-id resolution requires the `t_[0-9a-z]+` shape, so a session id in `extra.task_id` no longer blocks a compliant completion; the hook then falls back to `$HERMES_KANBAN_TASK`, the workspace basename, the checkout `cwd` and the branch name (Hermes scrubs the kanban identity vars from hook subprocesses — §6.4), and resolves a numeric run id through the board; (2) `R5` resolves the **operative (newest) verdict's** evidence only, accepts a path present on **any ref** (`A4_EVIDENCE_OFF_TREE`) and reports superseded paths as `A5_EVIDENCE_SUPERSEDED`; (3) the "linked QA child ⇒ deferral" heuristic is suppressed once the card carries an explicit verdict. Selftest 33 → 49 cases; §8.1 troubleshooting + §6.4 resolution table added; verifier fixed (matcher quoting, `--fixture-repo`); hook re-installed in all 7 profiles |
| 2026-09-18 | `t_58280940` — a deferral marker is operative only while it is the **newest** QA record on the card, and `DEFERRAL_RE` gained the same leading boundary as `VERDICT_MARKER_RE`, so a stale or merely *quoted* `QA-VERDICT: deferred — t_…` no longer hijacks `R8` on a card whose verdict has landed. Selftest 49 → 58 cases |
| 2026-09-18 | `t_99e408c5` — **§5.7 claim vs citation**: `R5` resolves only the paths the operative verdict *claims* (inside an `Evidence:`/`Artifacts:` label, or outside code spans/fences when it carries no label); a path the verdict merely quotes about another card is a citation reported as `A6_EVIDENCE_CITED`, so a card can report a broken evidence pointer elsewhere without failing on it. Evidence pointers now carry `scope` (`claim`/`citation`/`history`) in the `--json` facts; a cited path that exists in the repo no longer emits `A4`. Claimed-but-missing evidence still fails `R5` in every shape. Selftest 58 → 66 cases; hook re-installed in all 7 profiles (see `tests/evidence/t_99e408c5/`) |
