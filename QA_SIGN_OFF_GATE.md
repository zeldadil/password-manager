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
5. For a **code card**, a linked pull request is **merged into `master`** and every required CI check is **green on its merge commit**, read from GitHub at check time (§5.9, `t_75180b28`).

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
| `R7_SECURITY_TRACK_SIGNOFF_MISSING` | crypto/bridge/auth card with no Architect sign-off comment. Since `t_90a4bd73` (scope-v2, §5.5) the card is classified by the crypto/bridge boundary it names, and its Test Type is no longer read. A card completed before `R7_V2_EPOCH_ISO` keeps the v1 classification | Architect reviews and comments (any of `signed off`, `approved`, `ARCH-VERDICT: …`) |
| `R8_DEFERRAL_TARGET_INVALID` | deferral names a missing card, a non-QA card, or a QA card that is `done` without verdict + evidence | defer to a real `qa`-assigned card that carries its own verdict + evidence |
| `R9_PR_NOT_MERGED` | code card (§5.9) with no linked PR merged into `master`: PR open, closed unmerged, merged into another branch, or no PR at all for a pushed branch / `Deliverable: code` card. Read from GitHub, never from the card | open/merge the PR; the author moves the card to `review` with `PR: #<n>`, the merger completes it after the merge (§5.9) |
| `R10_MERGE_CI_NOT_GREEN` | the newest linked PR merged into `master` has a required check (from `master`'s branch protection) that is not green on its merge commit — failed, cancelled, still running, or never ran | fix `master`, wait for its run, or re-run a cancelled run (`gh run rerun`) |
| `A1_HISTORY_UNGATED` | card completed **before** the gate epoch (grandfathered) | advisory only; `--strict-history` turns it into a failure for retrofit audits |
| `A2_DEFERRAL_OPEN` | deferral target still open | audit tracks it until the QA card lands |
| `A3_EVIDENCE_UNVERIFIED` | evidence path could not be checked (no repo root available) | report-only |
| `A4_EVIDENCE_OFF_TREE` | operative evidence exists in the repo **on another ref**, not in this worker's checkout | report-only — accepted as committed evidence (§5.3) |
| `A5_EVIDENCE_SUPERSEDED` | a path named in a **superseded** verdict/handoff is absent from this checkout | report-only — history must not block a compliant card |
| `A6_EVIDENCE_CITED` | a path named in the operative verdict only as a **citation** — reporting another card's artifact, cross-checking it, quoting a defect transcript — is absent from this checkout | report-only — the card that *reports* a broken pointer elsewhere must stay completable (§5.7) |
| `A7_VERDICT_AUTHOR_IGNORED` | a `QA-VERDICT: <token>` (or `deferred`) comment written by a profile other than `qa` — **discounted, not a verdict** (§3, `t_338f47fd`) | report-only — it does not satisfy `R1`, so the card must record its verdict from the `qa` profile; the advisory is what tells you the comment you are looking at is not the one the gate reads |
| `A8_VERDICT_SELF_DECLARED` | the operative verdict comes from the run metadata of a **non-`qa`** run — accepted per §3 (the one author-independent source) | report-only — a self-declared verdict must never be invisible; the card should still carry a QA review |
| `A10_EXCEPTION_IGNORED` | a `qa-signoff-exception:` record the gate **refused** (§5.6, `t_b8001b55`): written by an author outside `human` · `dashboard` · `user` · `architect` · `qa` (including the anonymous `worker`), quoted only inside a code span/fence, or recorded on a security-track card | report-only — the refused record waives nothing, so `R1`/`R4`/`R7` apply as if it were absent; the advisory says which of the three reasons applied |
| `X1_EXCEPTION` | a recorded `qa-signoff-exception:` marker (§5.6) **that the gate applied** — allowed author, outside code, non-security card | report-only — exceptions stay visible in every audit; since `t_5b5b61e2` the audit lists every occurrence (card, date, author, reason) in its bypass block (§5.10) |
| `X3_COMPLETED_OUTSIDE_HOOK` | the card was completed **without** the `pre_tool_call` hook: `hermes kanban complete` from a terminal or a dashboard approval (Hermes synthesized the run), a completion with no run, or a `manual_complete` event (direct board edit) — §5.10, `t_5b5b61e2` | report-only — the override is legitimate (architect decision on `t_75180b28`); the audit lists it with date, method and reason so it is never silent. Hermes does not record who ran the command |
| `X2_EXCEPTION_WITHDRAWN` | an applied exception that a later `qa-signoff-exception withdrawn: <reason>` record **ended** (§5.6, `t_b2588ee7`) — names who recorded the exception, who withdrew it and why | report-only — the withdrawn exception waives nothing any more (`R1`–`R8` apply again), but it stays visible next to its withdrawal |
| `A16_EXCEPTION_WITHDRAWAL_IGNORED` | a withdrawal record the gate **did not apply** (§5.6, `t_b2588ee7`): written by an author outside the exception allowlist (including `worker`), quoted only inside a code span/fence, or posted when no exception was in force (before any exception, on a card without one, or on a security-track card whose exceptions are all refused) | report-only — a refused withdrawal leaves the exception in force; a no-op withdrawal changes nothing; the advisory says which case applied |
| `A17_R7_SCOPE_V2_UNGATED` | a card that only R7 **scope-v2** classifies as security-track (§5.5, `t_90a4bd73`), completed **before** `R7_V2_EPOCH_ISO`, with no Architect sign-off comment | report-only. The card was completed under the v1 classification, which did not require the sign-off, so it is not re-judged (decision `t_18230e85`: no retroactive cliff). An Architect comment clears it. Open cards and cards completed after the epoch get `R7` |
| `A11_CI_STATE_UNVERIFIABLE` | GitHub could not be read for `R9`/`R10` (offline, `gh` missing/unauthenticated, rate limit, time budget, branch protection unreadable/empty) | report-only — **never** a violation (§5.9); re-run the check when GitHub is reachable |
| `A12_LINKED_PR_OPEN` | the card's merged PR is judged green, but another PR **declaring** the card (§5.9) is still open | report-only — make sure no part of the deliverable lives only in the open PR |
| `A13_EARLIER_MERGE_CI_NOT_GREEN` | an earlier merged PR of the card landed with a non-green required check on `master` (the newest merge is judged) | report-only — recorded so a red merge is never silent |
| `A14_PR_MENTIONS_CARD` | a PR **mentions** the card id (title, body prose, quote or code) without declaring it (§5.9, `t_7e8bf917`) | report-only — **not a link**: it neither triggers nor satisfies `R9`/`R10`; if that PR does deliver the card, add a `Closes <id>` line to its body |
| `A15_NON_PUSH_RUN_ON_MERGE_COMMIT` | a run on the merge commit that the merge did not trigger (`workflow_dispatch`, `schedule`, …) disagrees with the merge's `push` run on a required check (§5.9, `t_339a0d02`) | report-only — **never judged**: `R10` reads only the push run (its latest attempt included), so a manual run can neither break nor repair a merged card |

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
The gate treats a comment authored by `architect` containing `signed off` / `approved` / `ARCH-VERDICT:` / `LGTM` as that sign-off. A §5.6 exception no longer clears it (`t_b8001b55`): on a security-track card exceptions are refused (`A10_EXCEPTION_IGNORED`).

**Which cards are security-track: scope-v2 (`t_90a4bd73`).** The decision is `docs/decisions/ARCH-DECISION-t_18230e85.md`, option C, with dual architect + qa sign-off. The architect half is in the record itself. The qa half is the `QA-VERDICT: pass` comment by `qa` on `t_18230e85` (2026-10-05), because the record's own "qa:" line was written by architect. A card is security-track when its title or body names an artifact inside the crypto or bridge boundary, **and** it is not assigned to `qa`. The `security` Test Type is no longer read. v1 required it, and that AND hid in-scope cards such as a "KDF + Vault Key Storage" card that declared `Test Types: unit`. The boundary tokens are `SCOPE_V2_TOKENS` in `scripts/qa/signoff-gate.mjs`, each with its ADR reference:

- `packages/crypto` and the crypto module boundary;
- KDF, AEAD, Argon2id, AES-256-GCM, GCM tag, nonce, IV;
- key wrapping, vault key, master key, sub-key, recovery kit/key, encrypted backup/export;
- lock/unlock, `randomBytes`, `getRandomValues`, `node:crypto`, `crypto.subtle`;
- `packages/shared`, bridge protocol/message, autofill (including `AUTOFILL_REQUEST`/`_RESPONSE`), `LOCK_STATE_CHANGED`, `VAULT_SEARCH`, vault session sync;
- origin validation, allowed origin, `sender.origin`, `postMessage`.

Bridge and origin-validation work is in scope: the decision record (§2) closes ADR-005 §9.2's AR-6 gap this way. Tokens carry no trailing word boundary, so `AUTOFILL_REQUEST`, `bridge messages`, `bridge_message` and `crypto boundaries` match. `nonce` must not sit inside a word (French "annonce"). `vault key` and `master key` do not match `…keyboard`. A false positive is cleared by the Architect commenting.

**Cut-over (`R7_V2_EPOCH_ISO`, `--r7-v2-epoch-iso`).** Open cards, and cards completed at or after the epoch, are judged by scope-v2. A card completed before the epoch keeps its v1 obligation: if v1 classified it, `R7` still applies. A card that only v2 classifies is reported as `A17_R7_SCOPE_V2_UNGATED` and is never failed. The decision assumed there would be no retroactive cliff. On the 2026-10-10 board, scope-v2 without the epoch would turn 11 already-completed post-gate cards red (`tests/evidence/t_90a4bd73/README.md`).

### 5.6 Exceptions (audited, never silent)

```
hermes kanban comment <task-id> --author qa --body "qa-signoff-exception: <reason> (approved by <who>, expires <when>)"
```

An applied exception marker (see the three conditions below) bypasses `R1`–`R8` for that card and is reported as `X1_EXCEPTION` in **every** audit, so it cannot be forgotten. It never bypasses `R9`/`R10` (§5.9). Exceptions are for incidents and hotfixes, not for routine work.

**Who may record one, and where it never applies** (added 2026-10-05, `t_b8001b55`). Until then the gate displayed
the exception's author but never checked it. An exception is applied only when all three conditions hold:

1. **Allowed author**: `human`, `dashboard`, `user` (the human surfaces), `architect` or `qa`. Any other profile is
   refused. The generic `worker` author is refused too, because it names no profile and so no one is accountable for
   the waiver.
2. **Outside code**: the key must appear outside every code span (`` `…` ``) and fenced block. A quoted key is
   documentation, the same rule as deferral markers and evidence pointers (§5.7). Live origin: the comment that
   reported this defect on `t_75180b28` quoted the key between backticks, and the gate treated the quote as that
   card's exception. Each occurrence is checked on its own, so a comment that quotes the key and then records a real
   one still counts.
3. **Not a security-track card** (§5.5): AR-6 needs an Architect **and** a QA sign-off on the crypto/bridge/auth
   boundary. Those are signed, never waived, so no exception, whoever wrote it, disarms `R1`, `R4` or `R7` there.
   `R7` no longer consults the exception at all.

A refused record is reported as `A10_EXCEPTION_IGNORED`, never dropped silently. The first record that meets all
three conditions is the operative exception; a refused record earlier in the thread no longer hides it.

**Withdrawing an exception** (added 2026-10-09, `t_b2588ee7`). Until then an applied exception was irrevocable: the
gate kept the first one and nothing could replace it, so an exception recorded in error (or one whose incident is
over) waived the card forever. Everything else in the gate is corrected by a *newer* comment, never by editing or
deleting one — the immutable thread is what makes the audit trustworthy — so a withdrawal is a new comment too:

```
hermes kanban comment <task-id> --author qa --body "qa-signoff-exception withdrawn: <reason>"
```

- **Explicit key, not "the last occurrence wins".** "Last wins" cannot express *no exception* — a later key can
  only swap one waiver for another, so withdrawing would still need a sentinel value, i.e. an explicit key in
  disguise. It would also silently change the operative reason on every card that already carries several keys,
  whereas the explicit key changes nothing on a card that never records one (board delta measured at 0 on 142 done
  cards). And a withdrawal is an audit event of its own: greppable, with its own author and reason. The cost is one
  more key to know — this paragraph.
- **Same rules as recording one.** Allowed authors only (`human`, `dashboard`, `user`, `architect`, `qa`; never
  `worker` or an executing profile) and outside code spans/fences. A profile that may not record an exception may not
  withdraw one either; its withdrawal is refused and the exception stays in force.
- **Posting order.** Records are replayed in posting order (comments by time then id; inside one comment, by
  position). A withdrawal ends the exception in force *at that point*; posted before any exception (or on a card
  without one) it does nothing — it does not pre-empt a later exception. A new exception after a withdrawal re-arms
  the waiver; while one is in force, a further one is redundant and the first keeps governing.
- **Spellings.** `qa-signoff-exception withdrawn: …`, `qa-signoff-exception-withdrawn: …` and
  `qa-signoff-exception: withdrawn — …` are all withdrawals, never exceptions (before this change the last two were
  read as an exception whose reason was "withdrawn…"). The reason is optional but should always be given.
- **Reporting.** A withdrawn exception is `X2_EXCEPTION_WITHDRAWN` (it waives nothing any more, so `R1`–`R8` apply
  again); a refused or no-op withdrawal is `A16_EXCEPTION_WITHDRAWAL_IGNORED`.

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

### 5.9 Code cards: PR merged into master, CI green on the merge commit (`R9`/`R10`, `t_75180b28`)

**Policy (decided 2026-10-05, architect answers on `t_75180b28`).** A card whose deliverable is code completes only
when **(a)** a pull request linked to it is **merged into `master`** — not open, not closed unmerged, not merged into
a stacked branch — and **(b)** every **required** status check is **green on that PR's merge commit on `master`**.
Both facts are read from GitHub through `gh` **at check time**; the card's own summary, comments and run metadata are
never consulted for them. *Why:* completion summaries claimed "all CI green" while required checks were red on the PR
(2026-09-30), and a branch was pushed without any PR at all (audit `t_8577a5a9`, 12 branches) — a written rule did not
stop either.

**Which cards are code cards.** A card is judged by this rule when any of these holds, otherwise it is out of scope
(`facts.pr_rule.applies = false`, no finding):

1. a pull request (any state) **declares** the card — the *linked* PRs (see *How a PR declares a card* below; a mere
   mention does not link, `t_7e8bf917`);
2. a **pushed branch** on GitHub carries the card id in its name, and no PR links the card → `R9` (pushed, never
   opened as a PR);
3. the card body declares `Deliverable: code` (bold/bullet tolerated) and no PR links the card → `R9`. Architect:
   add this line to code cards whose branch name will not carry the id.

**How a PR declares a card (the linking vocabulary, `t_7e8bf917`, 2026-10-08).** A PR is linked to a card **only** when
one of these holds:

| Form | Example | Notes |
|---|---|---|
| head branch named after the card | `qa/t_7e8bf917-declarative-pr-link`, `feature/t_7e8bf917` | the id as a whole word anywhere in the head ref name |
| a body line `Closes <id>` | `Closes t_7e8bf917` | GitHub closing-keyword form; the colon is optional (`Closes: <id>`) |
| a body line `Card: <id>` | `Card: t_7e8bf917` | the colon is **required** |
| a body line `Task: <id>` | `- **Task:** t_7e8bf917` | the colon is **required** |

On a declaration line: case-insensitive keyword at the start of the line (≤ 3 leading spaces), an optional list bullet
(`-` `*` `+`) and optional bold/italic around the keyword or the id are tolerated, and several ids may follow, separated
by `,` `;` `&` `+` or `and`, each optionally followed by a `(label)` — e.g. `Task: t_aaaaaaaa (BE-1), t_bbbbbbbb (BE-2)`.
The id must come **right after** the keyword: `Closes the gap found in t_…` is prose, not a declaration.

**Not a declaration** — reported as the advisory `A14_PR_MENTIONS_CARD` (naming the PR, its state and where the id
was seen), **never** a link, so it can neither trigger nor satisfy `R9`/`R10` and never produces `A12`:

- the id in the **PR title** only (`feat: … (t_…)`) — titles are prose;
- the id anywhere in the body **prose** (a reference, a fixture description, an audit citation);
- a `Closes`/`Card:`/`Task:` line inside a **code fence** (```` ``` ```` / `~~~`), an **indented code block** or an
  **inline code span**, or inside a **block quote** (`> Closes t_…`) — that is documentation of the syntax, not a claim.

*Why:* linking by mention let PR #114 (which only quotes `t_75180b28` in a fixture) be named by `R9` on `t_75180b28`
and — the dangerous direction — would let a merged PR that merely cites a card satisfy `R9` for it without delivering
its code. Measured live before/after on 2026-10-08 (`tests/evidence/t_7e8bf917/`): on `t_75180b28` the linked PRs go
from `#114, #116` to `#116` (head branch) with `#114` as `A14`; on `t_b8001b55` the judged PR changes from the foreign
`#116` to its own `#114`. **Authors: put `Closes t_xxxxxxxx` on its own line in the PR body** (or name the head branch
after the card) — `WORKTREE_STRATEGY.md` §5 step 3.

**How the linked PRs are judged.**

| Situation | Result |
|---|---|
| no linked PR is merged into the default branch (`master`) | `R9_PR_NOT_MERGED` — the message lists every linked PR with its state: open, closed without being merged, or merged into a branch other than `master` |
| the **newest** merged-to-`master` linked PR has a required check that is not `success`/`neutral`/`skipped` on its merge commit (`failure`, `cancelled`, `in_progress`, `queued`, or `missing` — never ran) | `R10_MERGE_CI_NOT_GREEN` — names the PR number, the merge commit and each failing check with its state |
| a required check is red/green only in a run the merge did **not** trigger (`workflow_dispatch`, `schedule`, …) on the same SHA | judged on the merge's **`push` run only** (`t_339a0d02`): the other run is `A15_NON_PUSH_RUN_ON_MERGE_COMMIT`, never `R10` either way. A re-run of the push run (`gh run rerun`) is the same run — its newest attempt counts. A required check carried **only** by non-push runs is `no-push-run` → `R10` (fail closed: a manual run never satisfies `R10`). A check from a suite no workflow run owns (another app) is judged as before |
| a merged PR is judged green while another linked PR is still open | allowed + `A12_LINKED_PR_OPEN` (make sure no part of the deliverable lives only there) |
| an **earlier** merged linked PR landed with a non-green required check | allowed + `A13_EARLIER_MERGE_CI_NOT_GREEN` — the newest merge commit is judged because it contains every earlier merge of the card; the red one is recorded, never silent |
| GitHub cannot be read — `gh` missing or unauthenticated, network down, rate limit, time budget exhausted, branch protection unreadable or empty | `A11_CI_STATE_UNVERIFIABLE` — **advisory, never a violation**, so no card becomes uncompletable offline. A partial outage only disarms the step it hit: with the PR list readable but the protection not, `R9` is still enforced and only `R10` degrades to `A11` |

- **Required checks come from the branch protection of `master`** (`GET …/branches/master/protection/required_status_checks`),
  never from a hard-coded list — it has changed before (8 required today, 10 running, `sast` and Semgrep are not
  required). A check bound to an app id must come from that app; an unbound one may also be a legacy commit status.
- **The `§5.6` exception does not waive `R9`/`R10`**: they are facts about the repository, not about the QA record.
- **Repository**: `--gh-repo OWNER/NAME` → `$QA_GATE_GH_REPO` → the checkout's `origin` remote → `zeldadil/password-manager`
  (a worker's scratch workspace is not a git checkout, so the hook relies on the last fallback).
- **Time budget**: all GitHub reads of one run share `QA_GATE_GH_BUDGET_MS` (default 20 000 ms, each call ≤ 10 s), far
  inside the hook's 30 s timeout; a full live lookup measured 2–7 s (`tests/evidence/t_75180b28/degradation.txt`).
- **Effective date**: `PR_RULE_EPOCH_ISO = 2026-10-06T00:00:00Z` (override `--pr-epoch-iso`). Every pre-completion check
  and every card completed at/after it is judged; earlier `done` cards are not looked up at all (`facts.pr_rule.in_scope = false`).
- **Switch off** for an offline run: `--no-github` or `QA_GATE_GITHUB=off` (every in-scope card then reports `A11`).
  The selftest uses `QA_GATE_GITHUB_FIXTURE=<json>` and never calls the network.
- **A11 in the board audit** (`t_b102b100`). A11 stays an advisory per card — never a violation, so a GitHub outage
  cannot make a card uncompletable, and `check` / the hook never fail on it. The **audit** counts it instead: the
  report header carries one **"bypasses & degradations"** block (one line per type: counter + card ids; A11 today,
  the §5.6 exceptions and the CLI bypasses join it with `t_5b5b61e2`), every card that carries A11 is tagged
  `[A11: …]` on its own line (never a bare `ok`), and `--json` exposes `counts.a11`, `a11_task_ids` and the
  generic `degradations[]` block. `--fail-on-a11` makes the audit exit 1 when at least one card carries A11;
  without it the exit code is unchanged (local / offline runs). The weekly local audit (§6.5, `t_8a64c3dd`) passes
  `--fail-on-a11`: it runs **with** GitHub, so an A11 there is a real degradation (token, branch-protection read,
  time budget) and the run reports FAIL; each A11 card gets an `AUDIT` comment. `qa-signoff-audit.yml` (fixture
  boards only since `t_8a64c3dd`) writes the block to the run summary and one `::warning::` annotation
  per card (`scripts/qa/signoff-audit-summary.mjs`, fed by `--json-out`). The exceptions (§5.6) and the
  completions made outside the hook are counted in the same block (§5.10) but **never** fail the audit.

**The normative completion path for a code card** (architect, Q2) — *the merger completes the card, never the author*:

1. the author pushes its branch, opens the PR **with a `Closes <card id>` line in the PR body** (or a head branch named
   after the card — a mere mention does not link, see above), and moves the card to `review`
   (`kanban_request_review`) with `PR: #<n>` in the summary or a comment — not `kanban_complete`;
2. `qa` records its `QA-VERDICT:` on the card;
3. the **merger** (the architect, in practice) merges, waits for the `master` CI run of the merge commit, checks the
   content on master with `git fetch && git show origin/master:<file>` (not `gh pr view`), then completes the card
   **citing the merge commit hash**. The hook re-checks `R9`/`R10` at that moment.

Side effect, intended: no agent closes its own code card, which also closes the self-signature path.

**The CLI path (`hermes kanban complete`)** bypasses the `pre_tool_call` hook (it is not the `kanban_complete` tool).
It is **not wrapped**: `hermes_cli` is code outside this repository, a patch would be lost on the next Hermes update and
could not be tested in this CI. The path is documented as a **human override**, reserved for the human (Adil) and the
architect's integration role — and it is **not silent**: the board **audit applies `R9`/`R10` to every card completed
at/after the rule epoch**, so a card closed through the CLI with an unmerged PR or a red merge commit is reported as a
FAIL by the next audit (the weekly local audit, §6.5). Agents use the CLI too (the architect confirmed it on
`t_75180b28`), so the audit — not the CLI — is the enforcement point for that path; anyone using it should run
`node scripts/qa/signoff-gate.mjs check --task <id> --pre-complete --repo <clone>` first. Since `t_5b5b61e2` every
completion made this way is also **listed** by the audit (`X3_COMPLETED_OUTSIDE_HOOK`, §5.10), whatever the rules say
about the card.

**Known limits (stated, not hidden).**

- *Mentions are not links* (`t_7e8bf917`, replaces the former limit "incidental mentions link a PR"). A PR that
  delivers a card but only *mentions* it (title or prose) is not linked: a card with `Deliverable: code` or a pushed
  branch then gets `R9` until the PR body gains a `Closes <id>` line — the `R9` message and the `A14` advisory both say
  so. A PR body can be edited after the merge, so the fix never needs a new PR.
- *Cancelled master runs.* Until `t_694c9e37`, `ci.yml` used `concurrency: ci-<workflow>-<ref>` with
  `cancel-in-progress: true`, so two merges in quick succession cancelled the first merge commit's `master` run →
  `R10 …=cancelled` for that card. Since `t_694c9e37` a run on the default branch is never cancelled (per-run group,
  `cancel-in-progress` false; PR runs still cancel each other). A `cancelled` merge commit predating the fix (or a run
  cancelled by hand) is still re-run with `gh run rerun <id>`.
- *Token rights.* Reading branch protection needs admin read on the repository: the owner token used on the host has
  it; a GitHub-hosted `GITHUB_TOKEN` does not, so an audit run there reports `A11` for `R10` — one more reason the
  weekly audit runs on the host (§6.5, `t_8a64c3dd`).

### 5.10 Bypasses are listed by the audit, never failed on (`t_5b5b61e2`)

A sign-off exception (§5.6) and a completion made outside the hook are two forms of the same thing: a card that
reached `done` without the gate's normal path. Both are legitimate; neither may be silent. The board audit lists
them in its **"bypasses & degradations"** block, next to `A11` (§5.9), so "how many bypasses this month, by whom, on
which cards" is answered by the report itself — text report, `--json`, and the workflow run summary — without
opening the board.

| Type | What is listed (one line per **occurrence**) | Source on the board |
|---|---|---|
| `X1_EXCEPTION` | every exception **in force** on a `done` card (author model of `t_b8001b55`: allowed author, outside code, non-security card), plus the later valid records that repeat it (`redundant`) — card, date, author, reason, state | `task_comments` |
| `X2_EXCEPTION_WITHDRAWN` | every withdrawn exception (§5.6, `t_b2588ee7`) — **history, not an active bypass**: who recorded it, who withdrew it, when and why | `task_comments` |
| `X3_COMPLETED_OUTSIDE_HOOK` | every completion the `pre_tool_call` hook did not see — card, date, method, reason (the completion summary or the `manual_complete` reason), assignee | `task_events` + `task_runs` |

How `X3` is detected — from what Hermes records, nothing guessed:

- a `completed` event whose run Hermes **synthesized** (`_synthesize_ended_run`: `status = outcome = 'completed'`,
  zero duration) — `hermes kanban complete` from a terminal or a dashboard approval of a card no worker had claimed;
  a worker run is ended with `status = 'done'` and is not listed;
- a `completed` event with no run (its `closure_method`, e.g. `human_direct_db_edit`, is shown);
- a `manual_complete` event (a direct board edit, with `payload.reason`).

Hermes has **no** `hermes kanban complete --override "<reason>"` flag (checked with `hermes kanban complete --help`):
the CLI is not wrapped (architect decision #505 on `t_75180b28`), so the audit reads what the board already holds.
Two limits follow, stated here so nobody reads more into the list than it says: **the actor is not recorded** (the
synthesized run's `profile` is the card's assignee, not the person who ran the command — the report says "not
recorded"), and `hermes kanban complete --force` on a card a worker is running closes **that worker's** run, which then
looks exactly like a worker completion and is not listed (§10 item 13).

Rules of the block:

- **A bypass never fails the audit** (no flag turns it red): an exception that broke CI would just be bypassed
  another way. It is made visible instead — `X1` per occurrence as a `::warning::` annotation, `X2`/`X3` as one
  `::notice::` per type (they can be numerous; GitHub keeps only the first annotations of a step).
- **Trend and threshold are named in the output**: per type, the count per month, the last 30 days vs the previous
  30 days, and a **watch threshold** per 30 days (`BYPASS_WATCH_30D` in the gate: `X1` 2, `X2` 2, `X3` 10). Above it
  the report says `ABOVE — review` and the run summary adds a `::warning::`; the exit code does not change. The
  values are policy — `architect` tunes them (§10 item 13). `--now-iso ISO` (audit only) anchors the window for a
  replay.
- **Not readable ≠ zero**: on a board without a readable `task_events` table `X3` is reported **not available**
  (text, JSON `available: false`, summary row + warning), never 0. The events read never makes the fail-closed hook
  fail.
- **Free text is untrusted (AR-2)**: reasons go through the repo's secret scanner (`scripts/qa/secret-guard.mjs`,
  loaded next to the gate) on their full length before truncation to 200 characters; a hit withholds the whole reason
  and names only the rule ids. If the scanner cannot be loaded every reason is withheld. Fence-length backtick/tilde
  runs are shortened (the workflow wraps the report in a fence); the summary Markdown-escapes reasons, titles and
  authors. Reasons travel as JSON from the gate to the summary script — never through a shell.
- The audit scope is the audit's own: **`done` cards**. A key posted on a card that is not `done` waives nothing yet.

Measured on a read-only snapshot of the live board (2026-10-10, see `tests/evidence/t_5b5b61e2/`): `X1` 5
occurrences on 5 cards (`dashboard` ×4, `human` ×1), `X2` 0, `X3` 54 on 54 cards. The card's starting expectation
— "10 occurrences on 7 cards (`architect` ×5, `dashboard` ×4, `human` ×1)", measured on 2026-10-05 — predates the
author model of `t_b8001b55`. The `dashboard` ×4 and `human` ×1 records are exactly the 5 listed; every `architect`
record on a `done` card is a key quoted in a code span (6 `A10_EXCEPTION_IGNORED` on the snapshot: `t_33dcad7d` ×4,
`t_75180b28`, `t_b8001b55`), which the gate has not applied since `bd62d76`, so the audit correctly does not list
them as exceptions (the 10-vs-11 count itself is `t_2bb5f1f2`'s subject).

---

## 6. Enforcement tooling

All paths are relative to the repo root.

| Command | Purpose |
|---|---|
| `node scripts/qa/signoff-gate.mjs audit` | whole board; exit 1 while any enforced card fails; `--json`, `--json-out FILE` (same document written to a file alongside the text report), `--repo DIR`, `--epoch-iso ISO`, `--strict-history`; `R9`/`R10` flags: `--gh-repo OWNER/NAME`, `--pr-epoch-iso ISO`, `--no-github`, `--fail-on-a11` (also exit 1 when ≥ 1 card carries `A11`, §5.9); `--now-iso ISO` anchors the bypass trend window (§5.10); bypasses never change the exit code |
| `node scripts/qa/signoff-audit-summary.mjs --json FILE [--summary-out FILE]` | renders the audit's "bypasses and degradations" block into `$GITHUB_STEP_SUMMARY`: counter rows, the bypass trend table, one row per A11 card and per bypass occurrence (§5.10); `::warning::` per A11 card and per `X1`, `::notice::` per non-empty `X2`/`X3` type, `::warning::` above a watch threshold; reports a missing document or an unreadable type as `not available`, never as 0; never decides the run's colour |
| `node scripts/qa/signoff-gate.mjs check --task t_xxxxxxxx [--pre-complete]` | one card; `--pre-complete` evaluates a card that is not `done` yet (exactly what the hook does) |
| `echo '<payload>' \| node scripts/qa/signoff-gate.mjs hook` | hook entry point: `{}` + exit 0 = allow, `{"decision":"block",…}` + exit 2 = block |
| `node scripts/qa/signoff-gate.selftest.mjs` | 207-case non-vacuity proof on a throwaway fixture board (every rule fires; every compliant control passes; the `t_5455942d`, `t_58280940`, `t_99e408c5`, `t_338f47fd`, `t_df8e644a` — cited-file-name — and `t_c015bda7` regressions are covered; `t_75180b28` adds 25 `R9`/`R10`/`A11`–`A13` cases on a JSON GitHub fixture, no network; `t_339a0d02` adds 7 push-run-only `R10`/`A15` cases; `t_b102b100` adds 22 audit A11 counter / `--fail-on-a11` / run-summary cases; `t_b2588ee7` adds 16 exception-withdrawal cases; `t_5b5b61e2` adds 19 bypass-report cases — X1/X2/X3 listing, trend/threshold, never-fails, AR-2 withholding, Markdown escaping, legacy board without `task_events`) |
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

### 6.5 Weekly board audit — local cron, reported on the board (`t_8a64c3dd`)

The weekly audit runs **on the host that carries the board**, never on a GitHub runner (Adil's decision 2026-10-09;
architect analysis #632 on `t_30d7dff5`): a hosted runner cannot see `~/.hermes/kanban.db`, and the repository is
public, so a self-hosted runner with the board mounted would let a fork PR execute code on the host. On the host the
board is local and the `gh` login reads branch protection, so `R9`/`R10` are evaluated for real and `--fail-on-a11`
is meaningful. There is no extra token and no runner.

| Piece | What it does |
|---|---|
| Hermes cron job `qa-weekly-signoff-audit` (profile `qa`) | `17 6 * * 1` (Monday 06:17 UTC), `no_agent` (no LLM, the script *is* the job), `deliver=local`, `failure_deliver=local` — **nothing is sent to Telegram** |
| `scripts/qa/cron/qa-weekly-signoff-audit.sh` (installed copy: `~/.hermes/profiles/qa/scripts/`) | keeps its own clone under `~/.hermes/profiles/qa/cache/signoff-audit/`, fetches, audits a **throwaway detached worktree of `origin/master`** (removed on exit; the shared clone `/home/sap/password-manager` is never touched), one run at a time (`flock`); sets `QA_GATE_GH_BUDGET_MS=600000` — the gate's 20 s default is sized for the hook and, on a whole-board audit, turned 13 cards into A11 "time budget exhausted" in the rehearsal |
| `node scripts/qa/signoff-audit-local.mjs run --db … --maintenance-card … --out-dir … --fail-on-a11` | runs `signoff-gate.mjs audit --json-out`, then reports **to the agents, on the board** (below). Exit 0 whatever the audit found; 2 = operational failure; 3 = usage |
| `node scripts/qa/signoff-audit-local.mjs check-stale --db … --maintenance-card … [--max-age-days 8]` | exit 1 + `AUDIT MISSING: …` when the newest `AUDIT-RUN:` stamp written by `qa` on the maintenance card is older than 8 days or absent — for **another** mechanism (architect's review cron): a job that did not run cannot report its own absence |
| `node scripts/qa/signoff-audit-local.selftest.mjs` | 40-case fixture proof (stub `hermes`, real gate audit, GitHub off); also run by `qa-signoff-audit.yml` on PRs that touch these files and on `workflow_dispatch` |

What each run writes — and nothing else (`hermes kanban comment` / `hermes kanban attach`, author `qa`; it never
unblocks, completes, reassigns or edits a card):

1. on the permanent maintenance card **`t_9c3f521a`** "AUDIT: résultats hebdomadaires du gate" (`triage`, never
   dispatched): the full text report and the `--json` document as **attachments**
   (`qa-signoff-audit-<YYYYMMDDTHHMMSSZ>.txt|.json`);
2. on **every card in violation**, and every card carrying `A11` (which fails the audit under `--fail-on-a11`): one
   comment whose first line is `AUDIT <YYYY-MM-DD> : <RULE>, <RULE>` — the owning agent reads it on its card. A
   same-day re-run does not repeat it;
3. on the maintenance card, **last**: a synthesis whose first line is the machine-readable stamp
   `AUDIT-RUN: <ISO8601>` (counts, bypass block, revision audited, cards with findings). A run that could not finish
   posts `AUDIT-RUN-FAILED: <ISO8601>` instead, which `check-stale` does not count as a run.

The `AUDIT` comments are **inert for the gate**: they carry no verdict marker, no loose `verdict:` path, no
sign-off-exception key and no evidence label (`assertInertForGate` refuses to post otherwise), and the selftest
re-audits the fixture board after posting and requires every card's violation and advisory set to be unchanged.

`qa-signoff-audit.yml` no longer has a `schedule` (it pointed at the dead `hermes-host` runner and produced a
`cancelled` run every week since 2026-09-21) and no real-board job: it is the fixture regression test above, on
`ubuntu-latest`.

---

## 7. Effective date and grandfathering

Enforcement starts at **`2026-09-17T15:00:00Z`** (`GATE_EPOCH_ISO` in `scripts/qa/signoff-gate.mjs`; override with `--epoch-iso`). Cards already `done` before that instant are **grandfathered**: the audit lists them with `A1_HISTORY_UNGATED` advisories but does not fail the run.

Grandfathering is not an amnesty: `node scripts/qa/signoff-gate.mjs audit --strict-history` reports the full pre-epoch backlog (26 cards at activation) so it can be retrofitted by decision rather than by habit.

`R9`/`R10` (§5.9) have their own effective date, **`2026-10-06T00:00:00Z`** (`PR_RULE_EPOCH_ISO`; override with `--pr-epoch-iso`): cards completed earlier are not looked up on GitHub at all. Measured before activation with the epoch moved back to `2026-09-25`: 34 cards in scope, 18 of them code cards, **0** `R9`/`R10` failures (`tests/evidence/t_75180b28/audit-epoch-0925.txt`).

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
verifier reads `doctor` **per hook section** (t_39a7e9eb): only the `qa-signoff-gate.sh` section is judged — a single
`script modified since approval` there is a `warn`, anything more (a second warning, any `✗`, or no section for the
sign-off hook at all) is a FAIL. Issues in another hook's section (e.g. `secret-guard.sh` drift) are printed as
`info` and never counted; that hook has its own verifier (`verify-secret-guard.sh`).

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
| 3 | **Implemented, pending merge (`t_90a4bd73`).** Classification re-derived from ADR-002 §5.3 and ADR-005 §9.2 (`t_7dd3b960` §4). The architect decided it in `docs/decisions/ARCH-DECISION-t_18230e85.md`: option C, scope-v2, with bridge/origin-validation in scope. Implemented in §5.5, including the `R7_V2_EPOCH_ISO` cut-over the architect is asked to confirm at review. Re-installing the gate in the 7 profiles is `t_f10ca03c` | `architect` + `qa` (dual sign-off) |
| 4 | Advisory-only cross-board audit: non-default boards (e.g. release-track boards) run the same hook, but the audit needs `--db` pointed at them | `qa` |
| 5 | A comment that *quotes* the recommended `QA-VERDICT: …` line (e.g. an Architect handoff showing the exact command to paste) is parsed as a verdict. With `R5` scoped to the operative verdict the harm is contained, but if such a quote is the *newest* record it becomes operative. **Partly decided (`t_99e408c5`, 2026-09-18):** §5.7 now defines code spans/fences as documentation for **evidence extraction** (claim vs citation, `A6_EVIDENCE_CITED`), and `VERDICT_MARKER_RE`/`DEFERRAL_RE` already carry the leading-boundary guard (`t_c3cb6842`/`t_58280940`). **Half of the remaining half closed (`t_df8e644a`, 2026-09-19):** the *loose* path can no longer read a quoted **file name** as a token — it is colon-only (§5.8), so `…/QA-VERDICT-ROTATION.md` is inert in plain prose, in a code span and in a fence. What remains open is giving the **marker** regexes the code-span/fence exclusion — a change to verdict *detection*, deliberately not bundled with either fix | `qa` (gate lane) |
| 6 | Hermes-core observation (config, not a repo defect): the hook subprocess env still carries `HERMES_DASHBOARD_BASIC_AUTH_USERNAME/PASSWORD/SECRET` — see `hook-env-probe.py`. Any hook script of any profile can read the dashboard admin credentials; consider whether hooks need them (they do not) | `architect` (owns the Hermes install/profile config) |
| 7 | Hermes-core observation (payload, not a repo defect): the `pre_tool_call` payload's `extra.task_id` is the *session id* (`agent/inline_tool_executors.py::tool_hook_ids` → `effective_task_id`), and the kanban identity keys are scrubbed from hook subprocesses (`agent/delegation_context.py::scrub_kanban_env`). The gate now compensates from the worker's location §6.4; do **not** "fix" this by un-scrubbing the identity keys — that scrub is deliberate runtime scoping | `architect` (record only) |
| 8 | Run-metadata `verdict` is the one author-independent verdict source, kept deliberately by `t_338f47fd` (AC 1c: "run-metadata sources keep their current behaviour"), so a non-QA run still satisfies `R1` by self-declaring; `A8_VERDICT_SELF_DECLARED` makes it visible. Decide whether `R1` should also reject a non-`qa` run's metadata — one live card depends on it today (`t_710ed14c`, an `architect` run), so the decision needs that card's QA review first | `qa` (gate lane) |
| 9 | Prose verdict records that are **not** colon-separated are no longer read at all (§5.8, `t_df8e644a`): the live em-dash form `QA-001g verdict — pass-with-conditions` (`t_78b46688`, whose card keeps a run-metadata verdict, so no outcome changed) and any `verdict — <token>` form. Re-admit one only with a path guard (a match whose span is part of a path/file name stays inert) rather than by re-widening the separator, and only with its own regression cases. Measured cost of the narrowing: 1 live comment; the failure direction is `R1`, never a silent pass | `qa` (gate lane) |
| 10 | `R9`/`R10` rollout (§5.9): after the merge, re-install the hook in all 7 profiles (`install-signoff-gate.sh --all --apply` + verifier) and confirm `gh auth status` succeeds **in the hook environment** of each profile — without it every completion only gets `A11`, i.e. the rule is silently advisory. The weekly audit runs on the host with its `gh` login (§6.5, `t_8a64c3dd`), which reads branch protection; it passes `--fail-on-a11`, so an A11 there is reported as a FAIL and on each A11 card — not a defect to silence | `qa` (install) + `architect` (runner/token) |
| 11 | `ci.yml` cancels an in-progress `master` run when the next merge lands (`concurrency … cancel-in-progress: true`), which leaves a merge commit with `cancelled` required checks → `R10` until re-run. Decide whether `push` runs on `master` should stop cancelling (e.g. `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`); `ci.yml` is a collision hotspot, so this is a decision, not a silent edit. **Decided and closed (`t_694c9e37`, card created by `architect`):** on the default branch the group is per run and `cancel-in-progress` is false; PR runs keep cancelling each other — evidence in `tests/evidence/t_694c9e37/` | `architect` |
| 12 | ~~Linking is by mention~~ — **closed by `t_7e8bf917` (2026-10-08)**: a PR links a card only by declaration (head branch, or a `Closes`/`Card:`/`Task:` body line outside code); mentions are `A14_PR_MENTIONS_CARD` (§5.9). Live: `#114` no longer links `t_75180b28`. Optional follow-up for `architect`: a PR template carrying a `Closes t_xxxxxxxx` line | `architect` |
| 13 | Bypass report (§5.10, `t_5b5b61e2`): (a) the watch thresholds `X1` 2 / `X2` 2 / `X3` 10 per 30 days are a QA proposal — on the 2026-10-10 snapshot both `X1` (5) and `X3` (54) are above them, so either the values or the practice need a decision; (b) Hermes records no actor for a CLI/dashboard completion and has no `--override "<reason>"` flag, and `hermes kanban complete --force` on a running card is indistinguishable from a worker completion — closing either gap is a Hermes-side change (or a CLI wrapper, which architect decision #505 declined); (c) the PR-only `bypass-report-fixture` job in `qa-signoff-audit.yml` adds a `pull_request` trigger limited to the gate files (fixture board only, never required) — confirm it is acceptable under CI-001h's "no PR trigger" design | `architect` |

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
| 2026-10-05 | `t_75180b28` — **§5.9 code cards: PR merged + merge-commit CI green** (`R9_PR_NOT_MERGED`, `R10_MERGE_CI_NOT_GREEN`; advisories `A11_CI_STATE_UNVERIFIABLE`, `A12_LINKED_PR_OPEN`, `A13_EARLIER_MERGE_CI_NOT_GREEN`). A card linked to a PR (id in PR body/title/head branch), with a pushed branch named after it, or declaring `Deliverable: code` completes only when a linked PR is merged into `master` and every required check of `master`'s branch protection is green on the merge commit — read from GitHub via `gh` at check time, never from the card. GitHub unreachable → `A11`, never a violation; the §5.6 exception does not waive it; own epoch `2026-10-06T00:00:00Z`; applied in `check --pre-complete`, the hook **and** the audit (the after-the-fact control for the unwrapped `hermes kanban complete` path, architect Q1). Normative completion path: author → `review` with `PR: #<n>`, `qa` verdict, the merger completes citing the merge hash (architect Q2). Selftest 93 → 118 cases (RED against the branch-point gate: the 22 rule cases fail, 3 allow-controls and all 93 earlier cases pass). Live checks, degradation runs, the pre-activation audit and the master-CI history are in `tests/evidence/t_75180b28/` |
| 2026-10-08 | `t_7e8bf917` — **§5.9 a PR links a card only by declaration**: its head branch is named after the card, or its body has a `Closes <id>` / `Card: <id>` / `Task: <id>` line outside code (fence, indented block, inline span) and outside a block quote. Any other occurrence of the id — PR title, body prose, quote, code — is the new advisory `A14_PR_MENTIONS_CARD`: never a link, so it neither triggers nor satisfies `R9`/`R10` and never yields `A12`. Before, any mention linked: live, PR #114 (only quoting `t_75180b28` in a fixture) was listed by `R9` on `t_75180b28`, and `t_b8001b55` was judged on the foreign PR #116; a merged PR merely citing a card would have satisfied `R9` for it. Selftest 132 → 143 cases (RED against the master gate: 9 of the 11 new cases fail, the `Closes` and longer-id controls pass). Live replay and a board-wide before/after audit (137 cards, 0 violation-set changes), the vocabulary probe and a census of every repo PR (7 of 47 title-named PR×card pairs no longer link, all pre-epoch or with another linked PR) are in `tests/evidence/t_7e8bf917/`; `WORKTREE_STRATEGY.md` §5 step 3 now asks for the `Closes` line; §10 item 12 closed |
| 2026-10-09 | `t_339a0d02` — **§5.9 `R10` judges the merge's `push` run only**. Live case: on `a48d622` (PR #120, `t_7e8bf917`) the push run was green, three `workflow_dispatch` runs started later on the same SHA failed on `secret-scan` (full-history scan on that event) and `R10` read them, so a merged card could not complete; the other way round, a manual run could repair a red merge. Check runs are now read with their check suite and matched to the SHA's workflow runs (`GET …/actions/runs?head_sha=`): a suite owned by a non-push run is set aside and reported as the new advisory `A15_NON_PUSH_RUN_ON_MERGE_COMMIT`; within a suite only the newest check run of a name counts (a re-run of the push run replaces its earlier attempt); a check carried only by non-push runs is `no-push-run` → `R10` (fail closed — deviation from the card's "A11 if no push run", for architect's counter-verification: `A11` is non-blocking, so it would let a merge with no push run complete); suites no workflow run owns are judged as before. Selftest 143 → 150 (RED against the master gate: 5 of the 7 new cases fail, the non-vacuity and other-app controls pass). Live replay, negative control (PR #88, push run really red → still `R10`), re-run control (PR #116) and a 140-card before/after audit (0 violation-set changes) are in `tests/evidence/t_339a0d02/` |
| 2026-10-09 | `t_b102b100` — **§5.9 A11 is counted and surfaced by the audit** (criterion 3 of `t_dbecf24d`, failed in qa verdict #595: a board with only `A11_CI_STATE_UNVERIFIABLE` cards audited green and `t_cbaa9f7d` showed a bare `ok`). The report header now carries one "bypasses & degradations" block (one line per type, counter + card ids — architect design note shared with `t_5b5b61e2`, which adds the exceptions and CLI bypasses to the same block); a card carrying A11 is tagged `[A11: …]`; `--json` adds `counts.a11`, `a11_task_ids` and `degradations[]`; `--json-out FILE` writes the same document from the same evaluation. New `--fail-on-a11` (audit only — refused on `check`, takes no value): exit 1 on ≥ 1 A11; without it the exit code is unchanged. A11 stays a per-card advisory: `check` and the hook never fail on it. `qa-signoff-audit.yml` passes `--fail-on-a11`, and `scripts/qa/signoff-audit-summary.mjs` writes the block to `$GITHUB_STEP_SUMMARY` with one `::warning::` per card (a missing JSON is `not available`, never 0). Selftest 150 → 172 (RED against the master gate: 19 of the 22 new cases fail; the hook-allow control and the two JSON-less summary cases pass, all 150 earlier cases pass). Workflow step bodies run verbatim against the fixture board and a live-board snapshot, and a master-vs-branch audit over 141 cards shows 0 rule-set changes (`tests/evidence/t_b102b100/`) |
| 2026-10-09 | `t_b2588ee7` — **§5.6 an exception can be withdrawn**. `findException` kept the first applied exception and nothing could replace it, so an exception recorded in error was the one irrevocable object of the gate. New explicit key `qa-signoff-exception withdrawn: <reason>` (chosen over "last occurrence wins", rationale in §5.6 and in the `findException` doc comment), under the same author allowlist and code-span rule as the exception itself; records replayed in posting order (`ORDER BY created_at, id` — a same-second tie keeps posting order); a withdrawal with no exception in force is a no-op; a later exception re-arms. `EXCEPTION_RE` no longer reads `qa-signoff-exception-withdrawn: …` / `qa-signoff-exception: withdrawn — …` as an exception. New report-only codes `X2_EXCEPTION_WITHDRAWN` and `A16_EXCEPTION_WITHDRAWAL_IGNORED` (A11–A15 were already taken). Selftest 172 → 188 (RED against the master gate: all 16 new cases fail, the 172 earlier cases pass). Master-vs-branch audit over a live-board snapshot (142 done cards): 0 violation-set, 0 advisory-set, 0 operative-exception changes (`tests/evidence/t_b2588ee7/`) |
| 2026-10-10 | `t_5b5b61e2` — **§5.10 the audit lists every bypass**, in the "bypasses & degradations" block `t_b102b100` opened: `X1_EXCEPTION` (each exception in force, plus the redundant records that repeat it), `X2_EXCEPTION_WITHDRAWN` (history, not an active bypass — consistent with `t_b2588ee7`) and the new report-only `X3_COMPLETED_OUTSIDE_HOOK` (a completion the hook never saw: synthesized-run completion from the CLI/dashboard, completion with no run, `manual_complete` event — read from `task_events`; Hermes has no `--override` flag and records no actor, both stated). One line per occurrence — card, date, author, reason, state — in the text report, `--json` (`counts.exceptions` / `exceptions_withdrawn` / `completed_outside_hook`, per-card `records`, per-type `trend`) and the run summary; a per-month trend, last-30-vs-previous-30 and a watch threshold per type (`BYPASS_WATCH_30D`, `--now-iso`). A bypass **never** changes the exit code. Reasons are secret-scanned on full length (`secret-guard.mjs`; withheld on a hit or when the scanner is missing), fence runs shortened, Markdown-escaped in the summary. A board without `task_events` reports `X3` as `not available`, and the hook is unaffected. `qa-signoff-audit.yml` gains a PR-only `bypass-report-fixture` job (fixture board, gate files only, not required — §10 item 13). Selftest 188 → 207 (RED against the master gate: 18 of the 19 new cases fail; the hook-on-legacy-board control passes; all 188 earlier cases pass). Master-vs-branch audit over a 144-card live snapshot: 0 violation-set changes, the only advisory change is `X3` on 54 cards (`tests/evidence/t_5b5b61e2/`) |
| 2026-10-10 | `t_90a4bd73` — **§5.5 `R7` security-track classification v2 (scope-v2)**, decision `t_18230e85` option C (committed byte-identical as `docs/decisions/ARCH-DECISION-t_18230e85.md`, sha256 `aaa3a94d…82fa1`). The regex is replaced by `SCOPE_V2_TOKENS`, which are ADR-referenced boundary tokens. The `security` Test-Type AND is dropped and the `¬qa` exemption kept. Tokens have no trailing `\b`, which fixes `AUTOFILL_REQUEST`, `bridge messages`, `bridge_message` and `crypto boundaries`. Measured on the live board, `nonce` was matched inside French "annonce" (2 false positives), so `nonce` now requires a non-letter before it. New `R7_V2_EPOCH_ISO` cut-over (`--r7-v2-epoch-iso`): a card completed before it keeps its v1 obligation, and a card only v2 classifies gets the new report-only `A17_R7_SCOPE_V2_UNGATED`. Without the cut-over, 11 already-completed post-gate cards would turn red. The architect confirms the cut-over at review. Also fixed: `--json` output to a pipe was cut at 65536 bytes, because `process.exit()` ran before stdout drained; it is now written, then exit (`writeThenExit`). Selftest 207 → 222. RED against the base gate: 11 of the 15 new cases fail, and the 4 guards pass. A mutation run with 8 mutants shows each new case fails on the mutant that removes what it guards. Before/after `audit --strict-history` on a live-board snapshot: 3 → 21 audited cards are security-track, R7 violations 0 → 0, 15 `A17`, FAIL count unchanged (49 → 49); without the cut-over FAIL 49 → 57 (11 `R7`). Tables and scripts are in `tests/evidence/t_90a4bd73/` |
| 2026-10-10 | `t_8a64c3dd` — **§6.5 the weekly board audit runs locally and reports on the board**. Adil's decision 2026-10-09 (public repo: no self-hosted runner, no new token; results go to the agents, not to Telegram). A `qa` Hermes cron job (`no_agent`, `deliver=local`) runs `scripts/qa/cron/qa-weekly-signoff-audit.sh`: own clone, throwaway worktree of `origin/master`, `signoff-audit-local.mjs run --fail-on-a11` on `~/.hermes/kanban.db`. Each run attaches the full report to the maintenance card `t_9c3f521a`, posts `AUDIT <date> : <rule>` (author `qa`) on every card in violation or with `A11`, then a synthesis whose first line is `AUDIT-RUN: <ISO8601>`; `check-stale` (exit 1 past 8 days or with no stamp) is the hook for architect's review cron (criterion 4). The comments are gate-inert (guarded, and re-audited in the selftest). `qa-signoff-audit.yml` loses its `schedule` (dead `hermes-host` runner, `cancelled` weekly since 2026-09-21) and its real-board job; it keeps `bypass-report-fixture` and gains `local-audit-reporter-fixture`, both on `pull_request` (gate/reporter paths) and `workflow_dispatch`. New selftest: 40 cases. Evidence in `tests/evidence/t_8a64c3dd/` |
