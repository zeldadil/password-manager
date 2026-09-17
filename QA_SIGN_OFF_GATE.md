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

The board audit (`audit`) runs on demand for retro and release checks, and since the
`qa-signoff-audit` workflow was wired in CI-001h (`t_ea0783c5`, PR #17) it also runs as a scheduled
CI job (`.github/workflows/qa-signoff-audit.yml`, Mondays 06:17 UTC). The scheduled run is driven by
a self-hosted runner registered on the trusted host, selected by the repository variable
`QA_SIGNOFF_AUDIT_RUNNER` (the workflow `runs-on` already reads it as an escape hatch). A
GitHub-hosted runner cannot see the canonical board (`~/.hermes/kanban.db` on the trusted host), so
the scheduled job would be red every week without this transport; the decision that lands it is
recorded in `docs/decisions/qa-signoff-gate-followups-t_527d4720.md`. The audit reports; it is
deliberately not a required status check on `master` (CI-001h AC3/AC4) - branch protection is
unchanged.

### What the gate is *not*

The board database and the profile configs live on the trusted host, and the hook runs with the worker's own credentials. The gate therefore guarantees **no accidental or silent non-compliant completion, plus a durable audit trail** — it is a process control, not a tamper-proof boundary against a hostile agent (any agent with shell access could edit the board or touch the kill switch). Tamper *detection* is the audit layer's job: `hermes hooks doctor` flags hook-script drift, and the verifier below compares the installed gate against the reviewed repo copy by SHA-256.

---

## 3. Verdict vocabulary and where it is recorded

| Source | How it is detected | Accepted for |
|---|---|---|
| **Marker comment** (preferred) | body contains `QA-VERDICT: <token>` — case/spacing-insensitive, `QA verdict — <token>` also parses | any card |
| **QA-authored comment** | comment by the `qa` profile containing `verdict … <token>` | any card |
| **Structured handoff** | completed run metadata `verdict` (e.g. `_metadata_.verdict` written by `kanban_complete`) | QA's own artifact cards (self-validation per §12 row 4) |
| **Deferral** | `QA-VERDICT: deferred — t_xxxxxxxx`, or a linked child card assigned to `qa` | any card whose QA review is a downstream card |

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
| `R5_EVIDENCE_FILE_MISSING` | a named evidence file/directory does not exist | commit the artifact, fix the path, or name the CI run instead |
| `R6_CONDITIONS_UNTRACKED` | `pass-with-conditions` with no follow-up card id / issue link / follow-up item | enumerate the conditions and the card or issue that tracks each one |
| `R7_SECURITY_TRACK_SIGNOFF_MISSING` | crypto/bridge/auth card (security Test Type + crypto-bridge keyword heuristic) with no Architect sign-off comment | Architect reviews and comments (any of `signed off`, `approved`, `ARCH-VERDICT: …`) |
| `R8_DEFERRAL_TARGET_INVALID` | deferral names a missing card, a non-QA card, or a QA card that is `done` without verdict + evidence | defer to a real `qa`-assigned card that carries its own verdict + evidence |
| `A1_HISTORY_UNGATED` | card completed **before** the gate epoch (grandfathered) | advisory only; `--strict-history` turns it into a failure for retrofit audits |
| `A2_DEFERRAL_OPEN` | deferral target still open | audit tracks it until the QA card lands |
| `A3_EVIDENCE_UNVERIFIED` | evidence path could not be checked (no repo root available) | report-only |
| `X1_EXCEPTION` | a recorded `qa-signoff-exception:` marker (§5.6) | report-only — exceptions stay visible in every audit |

---

## 5. Recording a verdict

### 5.1 Command and shape

```
hermes kanban comment <task-id> --author qa --body "QA-VERDICT: <token> — <one-line basis>. Evidence: <artifact>"
```

The **evidence pointer must be in the same comment** (or attached via `kanban attach`) — "tests pass" alone is not evidence (TEST_STRATEGY §11).

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
| Committed repo path | `tests/evidence/<task-id>/README.md`, `coverage/lcov.info` | **file must exist** in the worker's checkout (`payload.cwd`) |
| Directory path | `tests/evidence/<task-id>/` | directory must exist |
| Run-metadata `artifacts` (structured handoff) | `metadata.artifacts: [...]` | same rules as above |

### 5.4 Deferring QA to a downstream card

Legal **only** when the QA review genuinely happens in another card (a pre-created QA/review child, e.g. QA-002 aggregation):

```
hermes kanban comment <task-id> --author qa --body "QA-VERDICT: deferred — t_xxxxxxxx (QA-002 release verification). Evidence: tests/evidence/<task-id>/README.md"
```

The named card must exist and be assigned to a QA profile. The gate then requires **that** card to carry the verdict + evidence; while it is open the audit reports `A2_DEFERRAL_OPEN`. A deferral is not a way to skip QA — it is a way to move the verdict to the card that actually performs it.

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

## 6. Enforcement tooling

All paths are relative to the repo root.

| Command | Purpose |
|---|---|
| `node scripts/qa/signoff-gate.mjs audit` | whole board; exit 1 while any enforced card fails; `--json`, `--repo DIR`, `--epoch-iso ISO`, `--strict-history` |
| `node scripts/qa/signoff-gate.mjs check --task t_xxxxxxxx [--pre-complete]` | one card; `--pre-complete` evaluates a card that is not `done` yet (exactly what the hook does) |
| `echo '<payload>' \| node scripts/qa/signoff-gate.mjs hook` | hook entry point: `{}` + exit 0 = allow, `{"decision":"block",…}` + exit 2 = block |
| `node scripts/qa/signoff-gate.selftest.mjs` | 33-case non-vacuity proof on a throwaway fixture board (every rule fires; every compliant control passes) |
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

---

## 10. Open items

| # | Item | Owner |
|---|---|---|
| 1 | Whether the board audit also runs as a CI job (`qa-signoff`) — **CLOSED by t_527d4720 (2026-09-17):** the audit runs as a scheduled CI job (`.github/workflows/qa-signoff-audit.yml`, Mondays 06:17 UTC) on a **self-hosted runner** registered on the trusted host, selected by the repository variable `QA_SIGNOFF_AUDIT_RUNNER`. The workflow ships with PR #17 (`feature/t_ea0783c5`); the transport decision (self-hosted runner chosen over a published snapshot, which was rejected because the repo is public and the board carries card titles/bodies/comments/evidence paths/assignees) is recorded in `docs/decisions/qa-signoff-gate-followups-t_527d4720.md`. The audit is deliberately **not** a required check on `master` (CI-001h AC3/AC4) — branch protection is unchanged; it reports, it does not gate merges. | `architect` (closed) |
| 2 | Pre-epoch backlog (26 cards) — retrofit with verdict+evidence, or formally leave grandfathered | `architect` + `qa` |
| 3 | `R7` security-track detection is a keyword heuristic (security Test Type + crypto/bridge keyword); confirm the classification list against ADR-002 §5.3 / ADR-005 §9.2 | `architect` |
| 4 | Advisory-only cross-board audit: non-default boards (e.g. release-track boards) run the same hook, but the audit needs `--db` pointed at them | `qa` |

---

## 11. Changelog

| Date | Change |
|---|---|
| 2026-09-17 | Initial gate: rules R1–R8 + advisories, blocking `kanban_complete` hook in all 7 profiles, board audit, 33-case selftest, epoch `2026-09-17T15:00:00Z`, kill switch and exception protocol |
