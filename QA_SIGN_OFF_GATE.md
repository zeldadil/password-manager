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

**Author rule (decided 2026-09-18, `t_338f47fd`).** A QA verdict is a record **made by the QA profile** — that is what
the block text, §5.1 and this table have always said. Until `t_338f47fd` the *marker* path did not check it: one
`QA-VERDICT: pass — evidence: …` comment written by `architect`, `frontend`, `dashboard` or any other profile
satisfied `R1`/`R2`/`R3` on that card and cleared the fail-closed completion hook. Every **comment**-based source
below now requires a `qa`-profile author; a marker from any other author is **discounted**, keeps `R1` unsatisfied,
and is reported as `A7_VERDICT_AUTHOR_IGNORED` on every audit (never silently dropped).

| Source | How it is detected | Author rule | Accepted for |
|---|---|---|---|
| **Marker comment** (preferred) | body contains `QA-VERDICT: <token>` — case/spacing-insensitive, `QA verdict — <token>` also parses | **`qa` profile only.** Another author's marker is not a verdict (`A7_VERDICT_AUTHOR_IGNORED`) | any card |
| **QA-authored comment** (loose) | comment by the `qa` profile containing `verdict: <token>` — **colon separator only** since `t_df8e644a` (§5.8) | **`qa` profile only** — unchanged: this path was always author-checked | any card |
| **Structured handoff** | completed run metadata `verdict` (e.g. `_metadata_.verdict` written by `kanban_complete`) | **none — deliberately author-independent.** The one documented exception: it is the completing run's own structured record, and `--pre-complete` evaluation happens *before* the run that carries it has ended. A non-QA run that self-declares is reported as `A8_VERDICT_SELF_DECLARED` on every audit, so the residual gap is visible instead of silent | QA's own artifact cards (self-validation per §12 row 4) |
| **Deferral** | `QA-VERDICT: deferred — t_xxxxxxxx` **from the `qa` profile**, or a linked child card assigned to `qa` **when the card records no verdict of its own** | marker: **`qa` profile only** (`A7`); the linked-child fallback is board state, not an authored record | any card whose QA review is a downstream card |

When several sources exist, the **newest** one is the operative verdict.

**Human overrides are exceptions, not verdicts.** A human (or the dashboard) closing a card does not write a QA
verdict: record `qa-signoff-exception: …` (§5.6), which the gate reports as `X1_EXCEPTION` in every audit. A
`QA-VERDICT:` marker written by `dashboard`/`human` is discounted like any other non-QA author — the audited escape
hatch is the exception marker, not a verdict written on QA's behalf.

**What this rule does and does not claim.** The board is writable by the profiles themselves (see "What the gate is
not" above), so the author rule removes the *quiet* path to a verdict nobody issued — the one that needed no forgery
at all, only the wrong author — not a hostile agent's ability to edit the board. Consequence to expect: cards that
were passing on a non-QA record now surface as `R1` failures rather than passing; the measured live-board delta is in
`tests/evidence/t_338f47fd/README.md`.

---

## 4. Rules

`R*` failures block; `A*` findings are advisory. Rule ids are stable and appear verbatim in the block message and the audit JSON.

| Rule | Check | How to satisfy |
|---|---|---|
| `R1_QA_VERDICT_MISSING` | no QA verdict and no valid deferral | record a verdict comment **from the `qa` profile** (§3 — a marker written by another profile is discounted, `A7`), or defer to a QA-owned child card |
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
| `A7_VERDICT_AUTHOR_IGNORED` | a `QA-VERDICT: <token>` (or `deferred`) comment written by a profile other than `qa` — **discounted, not a verdict** (§3, `t_338f47fd`) | report-only — it does not satisfy `R1`, so the card must record its verdict from the `qa` profile; the advisory is what tells you the comment you are looking at is not the one the gate reads |
| `A8_VERDICT_SELF_DECLARED` | the operative verdict comes from the run metadata of a **non-`qa`** run — accepted per §3 (the one author-independent source) | report-only — a self-declared verdict must never be invisible; the card should still carry a QA review |
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

The **evidence pointer must be in the same comment** (or attached via `kanban attach`) — "tests pass" alone is not evidence (TEST_STRATEGY §11). Keep the `Evidence:` label: it is what the gate reads as *this card's own* evidence (§5.7), and it is what lets the same comment quote another card's path without claiming it. The **author is normative too** (§3): the comment must be written by the `qa` profile — a `QA-VERDICT:` marker written by any other profile is discounted as `A7_VERDICT_AUTHOR_IGNORED` and leaves `R1` unsatisfied.

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

**Only the `qa` profile may record a deferral marker** (§3, `t_338f47fd`): `QA-VERDICT: deferred — …` written by
another profile is discounted (`A7_VERDICT_AUTHOR_IGNORED`). It neither satisfies `R1` nor is judged by `R8` — which
also removes a whole class of false `R8`: on `t_f49d448c` an **architect**-authored `deferred` marker governed a card
whose QA verdict had already landed (§8, `t_58280940`), and on `t_80fc0326` the reverse held — an architect marker hid
a broken chain (its `qa` child `t_c3cb6842` is `done` without a verdict), so that `R8` now fires.

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

### 5.8 The loose verdict path — colon separator only (`t_df8e644a`)

**Policy (decided 2026-09-19, `t_df8e644a`).** A verdict a `qa` comment records in prose is read only when the
word `verdict` is followed by a **colon**: `verdict: <token>`. The loose path now carries exactly the marker's
separator rule and nothing else:

```
VERDICT_MARKER_RE = /(?:^|[\s(])qa[\s_-]*verdict\s*:\s*([a-z][a-z-]*)/i;
VERDICT_LOOSE_RE  =               /verdict\s*:\s*([a-z][a-z-]*)/i;
```

**Why.** The loose path used to accept `-` and `—` as separators, so a `qa` comment that merely *cited* a file
name it does not record was read as a verdict record: `tests/evidence/t_0af5aa3e/QA-VERDICT-ROTATION.md`
matched as `VERDICT-ROTATION` → token `rotation` → `R2_QA_VERDICT_INVALID` on the citing card. Reproduced on
the live board — `qa` comment 49 on `t_80fc0326` — as the residual half of `t_c3cb6842`, which had already
fixed the marker path. The gate must never read *a path it is shown* as a verdict token; this was the third
instance of that class (the earlier two are `t_5455942d` and `t_c3cb6842`). A colon is what §5.1 records and what a file name
never carries, so the **separator**, not the surrounding markup, is what separates a record from a path:
plain, backticked and fenced citations are equally inert with no code-span rule needed.

**What was deliberately not done.** Neither a code-span/fence exclusion nor the marker's leading boundary was
added to this path:

- the leading boundary would *break live records* — `**QA-VERDICT: pass**` is rejected by `VERDICT_MARKER_RE`
  (the `*` of the bold markup precedes `qa`) and is read *only* through this path (`t_f49d448c`, `t_4e1b6937`,
  `t_cdd23d35`, `t_58280940` on the live board);
- a code-span/fence exclusion would add a place to hide a real off-vocabulary record inside a fence. That is
  the same verdict-*detection* change §10 item 5 keeps open for the marker path; this card does not pre-empt it.

**Measured on the live board (copy `7832413c…`, 2026-09-19; A/B in `tests/evidence/t_df8e644a/`).** Loose
matches on `qa`-authored comments 14 → 12; path-shaped matches 1 → 0 (board-wide, every author: 61 → 57 loose
matches, 3 → 0 path-shaped). `t_80fc0326` drops from three `R2` rows to two: the `"ROTATION"` row disappears,
both genuine `"CHANGES"` rows stay, and no other card's violation set changes.

One genuine prose record is *narrowed*: the em-dash form `QA-001g verdict — pass-with-conditions` on
`t_78b46688` is no longer read. That card keeps its run-metadata `pass-with-conditions`, so its outcome and
rule set are unchanged — and the direction of the narrowing is a block (`R1`), never a silent pass.
Re-admitting a prose form with a path guard is recorded as §10 item 9.

**Residual (an explicit non-claim).** A path that itself contains `verdict:` verbatim — a file literally named
`verdict:pass.md` — would still match. No evidence-path convention in this repo produces that shape, and the
measured scan finds 0 such matches on the live board. Record a new gate defect if one ever appears.

---

## 6. Enforcement tooling

All paths are relative to the repo root.

| Command | Purpose |
|---|---|
| `node scripts/qa/signoff-gate.mjs audit` | whole board; exit 1 while any enforced card fails; `--json`, `--repo DIR`, `--epoch-iso ISO`, `--strict-history` |
| `node scripts/qa/signoff-gate.mjs check --task t_xxxxxxxx [--pre-complete]` | one card; `--pre-complete` evaluates a card that is not `done` yet (exactly what the hook does) |
| `echo '<payload>' \| node scripts/qa/signoff-gate.mjs hook` | hook entry point: `{}` + exit 0 = allow, `{"decision":"block",…}` + exit 2 = block |
| `node scripts/qa/signoff-gate.selftest.mjs` | 90-case non-vacuity proof on a throwaway fixture board (every rule fires; every compliant control passes; the `t_5455942d`, `t_58280940`, `t_99e408c5`, `t_338f47fd` and `t_df8e644a` — cited-file-name — regressions are covered) |
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
| 5 | A comment that *quotes* the recommended `QA-VERDICT: …` line (e.g. an Architect handoff showing the exact command to paste) is parsed as a verdict. With `R5` scoped to the operative verdict the harm is contained, but if such a quote is the *newest* record it becomes operative. **Partly decided (`t_99e408c5`, 2026-09-18):** §5.7 now defines code spans/fences as documentation for **evidence extraction** (claim vs citation, `A6_EVIDENCE_CITED`), and `VERDICT_MARKER_RE`/`DEFERRAL_RE` already carry the leading-boundary guard (`t_c3cb6842`/`t_58280940`). **Half of the remaining half closed (`t_df8e644a`, 2026-09-19):** the *loose* path can no longer read a quoted **file name** as a token — it is colon-only (§5.8), so `…/QA-VERDICT-ROTATION.md` is inert in plain prose, in a code span and in a fence. What remains open is giving the **marker** regexes the code-span/fence exclusion — a change to verdict *detection*, deliberately not bundled with either fix | `qa` (gate lane) |
| 6 | Hermes-core observation (config, not a repo defect): the hook subprocess env still carries `HERMES_DASHBOARD_BASIC_AUTH_USERNAME/PASSWORD/SECRET` — see `hook-env-probe.py`. Any hook script of any profile can read the dashboard admin credentials; consider whether hooks need them (they do not) | `architect` (owns the Hermes install/profile config) |
| 7 | Hermes-core observation (payload, not a repo defect): the `pre_tool_call` payload's `extra.task_id` is the *session id* (`agent/inline_tool_executors.py::tool_hook_ids` → `effective_task_id`), and the kanban identity keys are scrubbed from hook subprocesses (`agent/delegation_context.py::scrub_kanban_env`). The gate now compensates from the worker's location §6.4; do **not** "fix" this by un-scrubbing the identity keys — that scrub is deliberate runtime scoping | `architect` (record only) |
| 8 | Run-metadata `verdict` is the one author-independent verdict source, kept deliberately by `t_338f47fd` (AC 1c: "run-metadata sources keep their current behaviour"), so a non-QA run still satisfies `R1` by self-declaring; `A8_VERDICT_SELF_DECLARED` makes it visible. Decide whether `R1` should also reject a non-`qa` run's metadata — one live card depends on it today (`t_710ed14c`, an `architect` run), so the decision needs that card's QA review first | `qa` (gate lane) |
| 9 | Prose verdict records that are **not** colon-separated are no longer read at all (§5.8, `t_df8e644a`): the live em-dash form `QA-001g verdict — pass-with-conditions` (`t_78b46688`, whose card keeps a run-metadata verdict, so no outcome changed) and any `verdict — <token>` form. Re-admit one only with a path guard (a match whose span is part of a path/file name stays inert) rather than by re-widening the separator, and only with its own regression cases. Measured cost of the narrowing: 1 live comment; the failure direction is `R1`, never a silent pass | `qa` (gate lane) |

---

## 11. Changelog

| Date | Change |
|---|---|
| 2026-09-17 | Initial gate: rules R1–R8 + advisories, blocking `kanban_complete` hook in all 7 profiles, board audit, 33-case selftest, epoch `2026-09-17T15:00:00Z`, kill switch and exception protocol |
| 2026-09-17 | `t_5455942d` — fail closed only on genuinely unverifiable input: (1) task-id resolution requires the `t_[0-9a-z]+` shape, so a session id in `extra.task_id` no longer blocks a compliant completion; the hook then falls back to `$HERMES_KANBAN_TASK`, the workspace basename, the checkout `cwd` and the branch name (Hermes scrubs the kanban identity vars from hook subprocesses — §6.4), and resolves a numeric run id through the board; (2) `R5` resolves the **operative (newest) verdict's** evidence only, accepts a path present on **any ref** (`A4_EVIDENCE_OFF_TREE`) and reports superseded paths as `A5_EVIDENCE_SUPERSEDED`; (3) the "linked QA child ⇒ deferral" heuristic is suppressed once the card carries an explicit verdict. Selftest 33 → 49 cases; §8.1 troubleshooting + §6.4 resolution table added; verifier fixed (matcher quoting, `--fixture-repo`); hook re-installed in all 7 profiles |
| 2026-09-18 | `t_58280940` — a deferral marker is operative only while it is the **newest** QA record on the card, and `DEFERRAL_RE` gained the same leading boundary as `VERDICT_MARKER_RE`, so a stale or merely *quoted* `QA-VERDICT: deferred — t_…` no longer hijacks `R8` on a card whose verdict has landed. Selftest 49 → 58 cases |
| 2026-09-18 | `t_99e408c5` — **§5.7 claim vs citation**: `R5` resolves only the paths the operative verdict *claims* (inside an `Evidence:`/`Artifacts:` label, or outside code spans/fences when it carries no label); a path the verdict merely quotes about another card is a citation reported as `A6_EVIDENCE_CITED`, so a card can report a broken evidence pointer elsewhere without failing on it. Evidence pointers now carry `scope` (`claim`/`citation`/`history`) in the `--json` facts; a cited path that exists in the repo no longer emits `A4`. Claimed-but-missing evidence still fails `R5` in every shape. Selftest 58 → 66 cases; hook re-installed in all 7 profiles (see `tests/evidence/t_99e408c5/`) |
| 2026-09-18 | `t_338f47fd` — **§3 author rule**: a *comment* records a verdict only when the `qa` profile wrote it. `VERDICT_MARKER_RE` was matched without any author check, so one `QA-VERDICT: <token>` comment from `architect`/`frontend`/`dashboard` satisfied `R1`/`R2`/`R3` and cleared the fail-closed completion hook (reproduced on `0af4a453` and the installed `28b0b771`). The marker path and the deferral marker now require a `qa` author; a discounted record is reported as `A7_VERDICT_AUTHOR_IGNORED` instead of being dropped, and a non-QA run-metadata verdict — still accepted, the one documented author-independent source — is reported as `A8_VERDICT_SELF_DECLARED`. Run metadata and the loose `verdict: …` path keep their behaviour (§10 item 8). Selftest 66 → 81 cases; live-board A/B, the reported fixture replay and the re-install are in `tests/evidence/t_338f47fd/` |
| 2026-09-19 | `t_df8e644a` — **§5.8 loose path is colon-only** (the residual half of `t_c3cb6842`): `VERDICT_LOOSE_RE` accepted `-`/`—` as separators, so a `qa` comment that merely *cited* the evidence file name `tests/evidence/t_0af5aa3e/QA-VERDICT-ROTATION.md` was read as the token `rotation` → `R2_QA_VERDICT_INVALID` (reproduced on the live board, `qa` comment 49 on `t_80fc0326`). The loose path now uses the marker's separator and nothing else; the marker's leading boundary and any code-span/fence exclusion were deliberately **not** added (§5.8 records why — the first would break `**QA-VERDICT: pass**`, the second is §10 item 5's open detection question). Measured: loose matches on `qa` comments 14 → 12, path-shaped 1 → 0, `t_80fc0326` `R2`×3 → `R2`×2 with both genuine `"CHANGES"` rows kept and no other card's violation set changed; one em-dash prose record narrowed (§10 item 9). Selftest 81 → 90 cases (9 cases named after this card: three citation shapes, the masked-record shape, the live shape, and three anti-degradation controls). A/B, the RED/GREEN selftest pair and the re-install transcript are in `tests/evidence/t_df8e644a/` |
