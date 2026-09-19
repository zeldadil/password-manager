# QA-001i decision record — QA sign-off gate §10 open items 1–3

**Card:** `t_7dd3b960` (QA-001i, child of `t_28f60dc1`). **Author:** `qa`. **Date:** 2026-09-18.
**Subject:** the three open items in `QA_SIGN_OFF_GATE.md` §10 that the architect card `t_28f60dc1` routed to QA:
(1) the board audit as a CI job, (2) the pre-epoch backlog, (3) `R7` security-track classification.
**Every claim below was measured on this host**, against the live board and the shipped gate script; the commands
are in §7 and the transcripts in `tests/evidence/t_7dd3b960/`.

| measurement input | value |
|---|---|
| board snapshot | `~/.hermes/kanban.db`, taken 2026-09-18 ~21:1x UTC: **129 cards, 43 done, 16 done post-epoch, 27 done pre-epoch** |
| gate epoch | `2026-09-17T15:00:00Z` (`GATE_EPOCH_ISO`) |
| gate revision measured | `scripts/qa/signoff-gate.mjs` sha256 `0af4a45363280c134b19662840d04e43d6214b98fca278ec75efe2f824cc8d55` — the revision from PR #25 (`qa/t_58280940-r8-stale-deferral`), **bit-identical to the copy installed in all 7 profiles** |
| second revision measured | master's copy, sha256 `44e15f95fcf133367d14f633ab1d2d812ccbe8f1b7666d78d762b65a73bc604b` (PR #24) — what the CI job checks out **today** |
| repo state | `master@f74fb09`; open gate PRs: **#16** `feature/t_430aa9a3`, **#17** `feature/t_ea0783c5`, **#18** `feat/t_527d4720-runner`, **#25** `qa/t_58280940-r8-stale-deferral` |

### What this card does *not* claim

* No GitHub Actions run was triggered by this card, and **no scheduled `qa-signoff-audit` run has been observed
  at all** (see §2.3/S5). CI-side claims are either the other cards' recorded live-run URLs or local replays of the
  job's own commands (§2.2).
* The pre-epoch cards have **not** been retrofitted here; §3 proposes the disposition and names the owner. Nothing
  was silently closed.
* No secret value, and no card body, is reproduced in this document or in the evidence — the board dumps that the
  analyses read are deliberately **not** committed (public repo, §7).
* The gate script, the policy doc and the workflow files were **not** edited: the policy changes proposed in §3/§4
  are decisions that need the owners named in §6 (`QA_SIGN_OFF_GATE.md` is also a cross-PR hotspot, §8).

---

## 1. Summary of the three items

| # | §10 item | Verdict of this card | Owner of the remaining work |
|---|---|---|---|
| 1 | board audit as a CI job | **Closed as designed + implemented + re-verified.** The job exists (`qa-signoff-audit.yml`) and its design is sound; **three spec requirements are still unmet** (§2.3) and it must not be read as green before the first real scheduled run. | `architect` (merge/CI lane) |
| 2 | pre-epoch backlog (27 cards, was "26 at activation") | **Audited; disposition proposed; the grandfathering decision is *not* durable** (§3.4). Recommendation: no blanket retrofit — retro-verify 3, repair 3 records, grandfather 21, and **record that decision where it survives** (§3.3). | `architect` (record the decision) + `qa` (the 6 named cards) |
| 3 | `R7` classification | **Re-classified against the ADRs; the 2026-09-17 "correct and complete" sign-off is contradicted by board evidence** (§4.3): 18 in-scope cards are missed, 5 of them for a regex gap. Recommendation: scope-driven `R7` v2 (option C, §4.4) — needs `architect` + `qa` dual sign-off before the gate changes. | `architect` (security/policy decision) + `qa` (implementation) |

---

## 2. Item 1 — the board audit as a CI job

### 2.1 Status: implemented, decided, verified by its own cards — with unmet spec requirements

Both halves of item 1 landed:

* **`t_ea0783c5` (CI-001h, PR #17)** delivered `.github/workflows/qa-signoff-audit.yml`: weekly `schedule: 17 6 * * 1`
  + `workflow_dispatch`, its own file so `ci.yml` (the known hotspot) gains no hunk, **not** a required check, audit
  output + exit code surfaced in the job summary, artifact uploaded, and a deliberate **"AUDIT NOT RUN" red** when no
  board is present (a green job that audited nothing would be worse than no job). The card's QA verdict is `pass` with
  a live run URL and a 4-scenario local replay.
* **`t_527d4720` (PR #18)** closed the transport question: the audit runs on a **self-hosted runner** selected by the
  repository variable `QA_SIGNOFF_AUDIT_RUNNER`; publishing a board snapshot was **rejected** because the board carries
  card titles, bodies, comments, evidence paths and assignees and the repo is public.

### 2.2 What this card re-verified first-hand (not taken on trust)

| check | result |
|---|---|
| `actionlint` on both workflow revisions | **clean** on PR #17 and PR #18 (`item1-verification.txt`) |
| the commands the job runs are supported by the gate | yes — the job's exact invocation (`audit --repo <workspace> --db <board> [--strict-history]`) was executed against the real board (§7) |
| "no board on the runner ⇒ red, never green" path | reproduced: without a board the gate exits **3** (`board database not found`) and the workflow's own guard exits **1** with `AUDIT NOT RUN` (`job-C-no-board.txt`) |
| merge-order claim in the `t_527d4720` decision doc ("this card's branch is based on `feature/t_430aa9a3` so the gate script is present") | **true for PR #18, false for PR #17.** `scripts/qa/signoff-gate.mjs` is **absent** from PR #17's head (`feature/t_ea0783c5`) → the job dies at its own `Verify the gate script is present` step until either PR #16 or master's copy is in the branch (`item1-verification.txt`) |
| is the audit a required status check on `master`? | no — the card's live API read-back shows the same 8 required contexts; nothing in either PR changes branch protection |

### 2.3 Spec requirements the merged job must meet (all measured, all still open)

**S1 — the checkout must not be shallow.** `actions/checkout@v4` defaults to `fetch-depth: 1`; the gate's off-tree
evidence lookup (`A4_EVIDENCE_OFF_TREE`) is `git rev-list --all`. Measured, same board, same gate, only the checkout
differs:

| checkout | audit failures |
|---|---|
| full clone (all refs) | **6** |
| `--depth 1 --single-branch` (= today's job) | **8** |

The two extra failures are **false positives**: `t_ea0783c5` and `t_28951254` are reported
`R5_EVIDENCE_FILE_MISSING` for `.github/workflows/qa-signoff-audit.yml` and `tests/evidence/t_28951254/README.md`
— both committed, both on branches the shallow clone cannot see (`job-replay-compare.txt`). Fix: `fetch-depth: 0`.

**S2 — the job must run the reviewed gate revision, not whatever is on `master`.** A/B of the two revisions over the
same board (`ab-gate-revisions.txt`):

| gate revision | audit failures |
|---|---|
| PR #25 revision (`0af4a453…`, installed in all 7 profiles) | **6** |
| `master` revision (`44e15f95…`, what CI checks out today) | **8** |

The two extra failures are the **R8 false positives that PR #25 exists to fix** (`t_f49d448c`, `t_58280940`).
So a weekly job merged *without* PR #25 will be red with two false positives every Monday and will train readers to
ignore it. `QA_SIGN_OFF_GATE.md` §2 promises tamper *detection* by the audit layer; a false-positive-red audit
delivers none.

**S3 — board transport + never-green-when-not-run.** Already implemented (`vars.QA_SIGNOFF_AUDIT_RUNNER`,
`workflow_dispatch.board_db`, the enforce step). Confirmed by replay, §2.2. No change requested.

**S4 — not a required check.** Already true; no branch-protection write in either PR. Keep it that way: the audit is
a reporting/retro control, the hook is the enforcement.

**S5 — the first real scheduled run is the acceptance evidence and has not happened yet.** Permission
`contents: read`, self-hosted runner, `node >= 22` and `sqlite3` present, board at `~/.hermes/kanban.db` — that is the
claim; a green Monday run (or a documented `workflow_dispatch` with `board_db`) is what turns it into a fact. **Owner:
`architect` (CI lane).** This is the one item-1 acceptance criterion that cannot be satisfied from this workspace.

**S6 — the `t_527d4720` decision doc's merge-order note is stale.** It says PR #16 must land first *"otherwise the job
fails at its Verify the gate script is present step"*. Since PR #24, `master` itself carries
`scripts/qa/signoff-gate.mjs`, so a rebase of #17 onto current master makes that step pass — **but then it runs
master's revision, which is exactly S2.** The correct ordering is: **#16 (policy + gate) → #25 (gate R8 fix) →
#17/#18 (workflow)**, or a rebase that takes the gate from #25.

**S7 — minor: the board-candidate list omits `$HERMES_HOME/kanban.db`.** The workflow tries `board_db` input →
`$HERMES_KANBAN_DB` → `$HOME/.hermes/kanban.db`; the gate's own default is `defaultDbPath()`, which resolves under
`$HERMES_HOME` when that is set (observed in the replay: the gate looked in `<HERMES_HOME>/kanban.db`). The job passes
`--db` explicitly so this is not a live bug — add the candidate or document the path via the dispatch input.

### 2.4 Owner / next action (item 1)

| action | owner | where it lands |
|---|---|---|
| set `fetch-depth: 0` in the job's checkout (S1) | `architect` (CI lane) | PR #17 / #18 (both branches carry the same file) |
| land #16 → #25 → #17/#18 in that order, or rebase #17/#18 onto #25's gate (S2, S6) | `architect` (merge lane) | GitHub PRs |
| capture the first real `qa-signoff-audit` run (S5) | `architect` | CI run URL on `t_ea0783c5` / `t_527d4720` |
| board-candidate list (S7) | `architect` | same PR |
| interpret audit outcomes / own the gate semantics | `qa` | `QA_SIGN_OFF_GATE.md` |

---

## 3. Item 2 — the pre-epoch backlog

### 3.1 The audit (method)

`node scripts/qa/signoff-gate.mjs audit --db ~/.hermes/kanban.db --repo <clone> [--strict-history]` at the revision
above. Results (`audit-default.txt`, `audit-strict-history.txt`, `analysis.txt`):

| view | done cards | enforced (post-epoch) | pre-epoch (grandfathered) | FAIL |
|---|---|---|---|---|
| default | 43 | 16 | 27 | **6** |
| `--strict-history` | 43 | 16 | 27 | **30** |

* The backlog is **27 cards**. `QA_SIGN_OFF_GATE.md` §7 says "26 cards at activation": the audit is the source of
  truth for the count, and every decision text that spells the number should be derived from it. Of the 27: **4**
  carry both a usable verdict and an evidence pointer (`t_ac6a1f3f`, `t_18ae13ea`, `t_78b46688`, `t_430aa9a3` — all
  `qa`-assigned), **1** carries a verdict but no evidence (`t_a2cf1744`), **5** carry evidence but no verdict, and
  **17** carry neither.
* Under `--strict-history`, **24 of 27** fail `A1_HISTORY_UNGATED`; 3 pass outright. So the strict run is not
  vacuous: it currently distinguishes 3 cards from 24.

### 3.2 Disposition of every pre-epoch card

Rule applied (stated so it can be argued with, not just obeyed):

* **B — retro-verify (`qa`, dated).** The card's subject is what the gate's own rules now depend on: the
  security-track card, and the two ADRs whose scope lists `R7` is validated against. QA re-checks the card's
  acceptance criteria against the **committed** artifact and records `QA-VERDICT: pass — retro-verified <date>`
  naming that path. A retro-verification is labelled as such; it never poses as a verdict recorded at the time.
* **C — record repair (`qa`, trivial).** The record is already there but its pointer is stale/incomplete.
* **A — formal grandfather (no action).** No security or normative claim depends on the verdict, and the artifact is
  committed; grandfathering is recorded once for the whole set (§3.3).

| card | disposition | why |
|---|---|---|
| `t_9840ccdd` SEC-001 Threat Model + Security Gate | **B** | the only pre-epoch card the shipped `R7` classifies security-track; it is the source the gate's security rules cite |
| `t_3ca45da2` ADR-002 Overall Architecture | **B** | §5.1–§5.5 is the classification list `R7` is validated against (§4.1) |
| `t_08b02da9` ADR-005 Extension Bridge Protocol | **B** | §9.2 is the other half of that list; also the card whose `bridge-*` wording `R7` misses (§4.3) |
| `t_ac6a1f3f` QA-001a Test Strategy | **C** | has verdict + evidence, but the evidence pointer is a stale absolute path (`/tmp/qa-negative-control.md`) → `R5` failure |
| `t_a2cf1744` QA-001c Playwright MCP + cross-browser E2E | **C** | verdict present, no evidence pointer (`R4`) |
| `t_5fe41426` QA-001b CI Pipeline | **C** | its deferral target (`t_a2cf1744`) carries a verdict but no evidence (`R4`); repaired by the same edit |
| `t_258f91c8` ADR-003 Data Model | A | committed artifact, no security claim |
| `t_ad18d4ed` ADR-004 API Contract | A | " |
| `t_5f82ac57` ARC-001e Repo Structure + Root Config | A | " |
| `t_7ec83773` ARC-001f GitHub Setup + Worktree Strategy | A | evidence present, verdict never recorded; infrastructure only |
| `t_f8a5c949` BE-001a DB Migration System | A | pre-gate work, superseded by later cards |
| `t_f463b44f` BE-001b Core Tables Schema | A | " |
| `t_415897da` BE-001c API Skeleton + OpenAPI + Health | A | " |
| `t_7c572465` BE-001d Envelope Middleware | A | " |
| `t_aed3f3d1` FE-001a Project Setup | A | " |
| `t_53b034b7` FE-001b Router + Routes | A | " |
| `t_767aca4b` FE-001c Layout Components | A | " |
| `t_e2b31691` FE-001d Theme System | A | " |
| `t_7d365ce0` FE-001e Accessibility Baseline | A | " |
| `t_f82e53b6` FE-001f API Client | A | " |
| `t_d19ced15` FE-001g State Management | A | " |
| `t_18ae13ea` QA-001d Security Scanning Config | A | verdict + evidence already on the card |
| `t_204ae591` QA-001e Synthetic Fixtures + Thresholds | A | " |
| `t_11c01f92` QA-001f Negative Test Checklist | A | " |
| `t_78b46688` QA-001g Evidence Collection | A | " |
| `t_430aa9a3` QA-001h Sign-off Gate Policy | A | " — the gate's own origin card |
| `t_ee24fd37` REPO-BLOCKER pnpm workspace manifest | A | infrastructure blocker, resolved; no security surface |

Totals: **B 3 · C 3 · A 21 = 27.**

### 3.3 Recommendation: do **not** blanket-retrofit; make the grandfathering decision durable

Retrofitting all 27 would mean QA writing verdict comments **today** for work completed on 2026-09-16/17 that QA did
not verify at the time. That is not a verdict, it is a signature on someone else's work — the precise failure mode the
gate exists to prevent (`QA_SIGN_OFF_GATE.md` §1). What is defensible:

1. **Grandfather the 21 A-cards, formally and in writing** — with the rule, the list and the audit command that
   derives it, in a record that is committed (`PROJECT_BRIEF.md` §9 or `docs/decisions/`), not only in a card comment.
2. **Retro-verify the 3 B-cards** (dated, labelled, evidence-linked). This also shrinks the strict-history failure set
   from 24 to 21, which is the measurable outcome.
3. **Repair the 3 C-records** — the cheapest honest fix in the whole backlog (a verdict without evidence is a
   one-comment gap).
4. Keep `A1_HISTORY_UNGATED` advisories on every run, so the backlog stays visible (`QA_SIGN_OFF_GATE.md` §7 already
   says grandfathering is not amnesty).

### 3.4 Finding: the 2026-09-17 grandfathering decision is **not durable** (root cause of §10 item 2 staying open)

`t_33dcad7d` (architect, `done`) decided *"26 cards stay grandfathered … Decision recorded in `PROJECT_BRIEF.md` §9"*
and recorded *"Evidence attached: `docs/decisions/qa-signoff-gate-followups-t_33dcad7d.md`"*. Verified on this host:

| claim | verification | result |
|---|---|---|
| decision recorded in `PROJECT_BRIEF.md` §9 | `git show origin/master:PROJECT_BRIEF.md`; §9 is *"Decisions Log (from kickoff — 2026-09-16)"*; grep for `grandfather|pre-epoch|sign-off gate` → **no hit** | **not there** |
| decision artifact committed | `git log --all` / `git rev-list --all -- docs/decisions/qa-signoff-gate-followups-t_33dcad7d.md` → **empty on every ref**; also `git rev-list --all -- tests/evidence/t_33dcad7d/` → empty (only the *later* `…-t_527d4720.md` exists, on PR #18) | **never committed** |
| artifact attached to the card | `kanban_attachments t_33dcad7d` → `[]` | **not attached** |

So the five decisions survive only as a card comment. That is a fine audit trail and a poor decision record — and it
is why §10 items 1–3 still read "open" in the policy today. This finding is the deliverable of item 2 as much as the
audit numbers are: **the backlog needs a record that a reader of the repo can find, and the architect's own
"Decision recorded in X" claims need the same existence check the gate applies to QA evidence (`R5`).**

### 3.5 Post-epoch context (not item 2, recorded so nothing is silently dropped)

The default (enforced) audit fails **6 of 16** post-epoch cards. Each is a real gap in the record, with a named owner:

| card | rule(s) | owner | what is missing |
|---|---|---|---|
| `t_28f60dc1` | `R5` | `architect` | its operative verdict names `tests/evidence/t_28f60dc1/README.md`, which is not in the repo on any ref (the artifact exists only in that card's `scratch` workspace). This is my own parent card — flagged, not fixed by QA |
| `t_7918f010` | `R1`+`R4` | `backend` | BE-001f completed with no verdict and no evidence pointer |
| `t_c3cb6842` | `R1`+`R4` | `qa` | QA's own repair card; the follow-up verdict landed on `t_5455942d` instead of here |
| `t_527d4720` | `R2` | `architect` | verdict token `"pass (comment 42)"` recorded in run metadata — off-vocabulary |
| `t_80fc0326` | `R2`×3 | `architect` | tokens `ROTATION`, `CHANGES` in QA-authored comments |
| `t_b51a1ff3` | `R2`×2 | `architect` | token `changes` |

Two patterns worth naming beyond the six cards:

* **P1 — verdict-by-run-metadata is invisible to the hook.** `hookMode` evaluates the *board* (`evaluateCard`, no
  `tool_input`), while the audit counts a `metadata.verdict` from a *completed run* as a verdict source
  (`QA_SIGN_OFF_GATE.md` §3). A worker whose only verdict is in `kanban_complete(metadata=…)` is therefore either
  blocked (`R1`, no verdict visible) or audited later (`R2`) — never enforced consistently. `t_527d4720` is the
  documented instance.
* **P2 — a `scratch` workspace cannot satisfy `R5`.** Evidence that exists only in an ephemeral workspace is
  unverifiable from any checkout; the hook evaluates with a non-repo `cwd` and (correctly, per the skill's note)
  degrades to `A3_EVIDENCE_UNVERIFIED`, so the completion passes and the audit fails afterwards. `t_28f60dc1` and
  `t_ea0783c5` are two instances with different endings (`t_ea0783c5` mirrored the bytes into the workspace; the
  parent did not). Recommend: for `scratch`-workspace cards, require the evidence pointer to be a **committed** path
  (or an attachment) — that is the only form the audit can prove.

### 3.6 Owner / next action (item 2)

| action | owner | where it lands |
|---|---|---|
| record the grandfathering decision (§3.3.1) with the 27-card list + rule + audit command | `architect` | `PROJECT_BRIEF.md` §9 or `docs/decisions/`, committed |
| retro-verify the 3 B-cards (§3.2), dated + labelled | `qa` | cards `t_9840ccdd`, `t_3ca45da2`, `t_08b02da9` on the board |
| repair the 3 C-records | `qa` | cards `t_ac6a1f3f`, `t_a2cf1744`, `t_5fe41426` |
| close the 6 post-epoch gaps (§3.5) | per-card owners above | the six cards |
| decide on P1/P2 (gate behaviour, not a record) | `architect`+`qa` (rule change ⇒ dual sign-off) | `QA_SIGN_OFF_GATE.md` + `signoff-gate.mjs` |

---

## 4. Item 3 — `R7` security-track classification

### 4.1 The classification list (this is the QA deliverable)

Derived from the ADRs, not from the regex. A card is security-track — i.e. it needs the Architect half of the AR-6
sign-off — when its deliverable is in one of these boundaries:

| boundary item | source | in the shipped `R7`? |
|---|---|---|
| KDF / Argon2id | ADR-002 §5.1, §5.3 (SEC-001 Decision 1) | yes (`KDF`, `Argon2id`) |
| AEAD / AES-256-GCM encrypt+decrypt | ADR-002 §5.1, §5.3 (Decision 2) | partly (`AEAD` only; **not** `AES-256-GCM`) |
| nonce/IV generation, never reused | ADR-002 §5.1, §5.3 (Decision 4) | **no** |
| 16-byte tag verification on every decrypt | ADR-002 §5.3 (Decision 5) | **no** |
| key wrapping, vault key / sub-keys | ADR-002 §5.1, §5.3 | partly (`vault key`; **not** `vaultKey`, `key wrapping`, `sub-key`) |
| lock/unlock lifecycle: derive → hold → clear | ADR-002 §5.1, §5.3 (Decision 6) | **no** |
| recovery kit (wrap vault key with a second key) | ADR-002 §5.3 (Decision 7) | **no** |
| encrypted backup export | ADR-002 §5.3 (Decision 8) | **no** |
| `packages/crypto` as the only caller of the crypto library | ADR-002 §5.2 | yes |
| RNG: `randomBytes` / `getRandomValues`, never `Math.random` | ADR-002 §5.4 | **no** |
| extension crypto boundary (no KDF/AEAD in the extension; key in background-worker memory, cleared on lock) | ADR-002 §5.5 (Decision 9) | partly (`vault key`) |
| bridge message types incl. `AUTOFILL_REQUEST`/`_RESPONSE`, `LOCK_STATE_CHANGED`, `VAULT_SEARCH` | ADR-005 §2.1, §5 | partly (`autofill` — see §4.3, the word-boundary defect) |
| origin validation (`sender.origin`, allowed origin) | ADR-005 §3, §9.3 (BR-002d) | **no** |
| `packages/shared/` message contract review | ADR-005 §9.2, §9.3 (BR-001e, DOC-001e) | **no** |
| autofill flow negative constraints | ADR-005 §5.3, §9.3 (BR-003) | yes (`autofill`) |
| no secrets in logs/errors/URLs/env/code; synthetic fixtures only | ADR-002 §5.3 (AR-2, AR-4) | n/a (cross-cutting; deserves its own rule, not `R7`) |

### 4.2 What the shipped heuristic actually catches

`SECURITY_TRACK_RE` (`packages/crypto | crypto-primitive/implementation/boundary/module/package | KDF | AEAD |
Argon2id | vault-key | bridge-protocol | bridge-message | autofill`) **AND** a `security` Test Type **AND**
assignee ≠ `qa` (`signoff-gate.mjs` §84–85, §553–562). Over all **129** cards:

* flagged today: **7** — `t_9840ccdd` (done, pre-epoch), `t_4278a1dc`, `t_c7258993`, `t_974b5e77`, `t_acd800fe`,
  `t_b1a8b77e`, `t_7b33595a`;
* **`R7` has never fired as an enforcement failure**: its single post-epoch-relevant card is pre-epoch, and every
  other card it flags is still `todo`/`triage`;
* no **false positives** among the 7 — every one is genuinely in a boundary above. The defect is one-directional.

### 4.3 Counter-evidence to the 2026-09-17 sign-off

`t_33dcad7d` recorded an architect sign-off that the classification list *"is correct and complete as shipped. No
keyword additions or removals needed … false negatives are unlikely given the AND condition and the vocabulary."*
Measured against §4.1, **18 cards in that scope are not flagged** (excluding `qa`-assigned cards), for two reasons:

**(a) The `security` Test-Type AND suppresses 13 in-scope cards** whose "Test Types:" line names the *kind of test*
(`unit`, `integration`, `e2e`, `architecture-review`) — a declaration that says nothing about whether AR-6 applies.
The starkest: **`t_16f8ad84` BE-002a "Registration + KDF + Vault Key Storage"** (KDF + vault key, `Test Types: unit`),
**`t_fe3b76ea` BE-003a "Vault Encryption"** (AEAD + vault key, `unit`), **`t_4d0c8439` BE-002b "Unlock Endpoint"**
(KDF + vault key, `unit, integration`), `t_91964616` BE-002f, `t_1f98942a` BR-001d, `t_979847fc` BR-002g,
`t_8e4c8bfa` BR-003e, plus the docs/arch cards `t_3ca45da2`, `t_08b02da9`, `t_5f82ac57`, `t_ee24fd37`, `t_d3074f1c`,
`t_bc7a8dfa`.

**(b) 5 in-scope cards miss the keyword list entirely** — and for `t_e5142129` (BR-001e "Message Protocol (shared
package)") for a *provable regex defect*: the `\bautofill\b` alternative cannot match the contract's own message names
(`AUTOFILL_REQUEST` / `AUTOFILL_RESPONSE`), because `_` is a word character, so `\b` fails after `autofill`. The
others miss because the boundary item simply has no token: `t_b51bf4b9` BE-003c (nonce), `t_e4341d18` BE-003k
(nonce; `Test Types: security`), `t_4f42e589` BR-001f **Origin Validation** (`Test Types: security` — ADR-005 §9.3's
BR-002d item), `t_83dc1b35` BR-002a (`postMessage`, lock/unlock sync). A latent instance of the same class:
`vault[\s-]*key` cannot match the camelCase identifier `vaultKey` used in ADR-002 §5.2/§5.3 (not yet on a board card).

### 4.4 Options, measured

| option | rule | cards flagged | vs shipped |
|---|---|---|---|
| **A** (no change) | keyword ∧ security-Test-Type ∧ ¬qa | 7 | — |
| **B** | keyword ∨ security-Test-Type ∧ ¬qa | 26 | **+19** |
| **C** *(recommended)* | scope-v2 regex ∧ ¬qa (test-type condition dropped) | **24** | **+17** |
| **D** | scope-v2 ∧ security-Test-Type ∧ ¬qa | 9 | +2 |

* **B** conflates "has security tests" with "is crypto/bridge code": it newly flags docs cards whose only signal is a
  `security` test type, i.e. it manufactures false positives (cleared only by an architect comment or an exception
  marker). 
* **D** is barely an improvement — it keeps the wrong AND.
* **C** flags exactly the crypto/bridge surface (plus the two diagram cards that legitimately touch
  `packages/crypto` geometry) and **does not break history**: of the 3 done cards it flags, `t_08b02da9` and
  `t_5f82ac57` are pre-epoch (grandfathered ⇒ advisory) and `t_ee24fd37` likewise. So there is no retroactive cliff;
  only *open* cards acquire a new obligation, which is the point.
* **C's new tokens** (each traceable to §4.1): `AES-256-GCM`, `GCM tag`, `nonce`, `key wrapping`, `vaultKey`,
  `master key`, `sub-key`, `recovery kit|key`, `encrypted backup|export`, `packages/shared`, `origin validation`,
  `allowed origin`, `postMessage`, `LOCK_STATE_CHANGED`, `vault session sync`, `crypto.subtle`, `node:crypto`,
  `AUTOFILL_[A-Z]+`, `lock/unlock` — and `autofill` re-spelled so `AUTOFILL_REQUEST` matches.

**One policy question this card will not decide unilaterally.** ADR-005 §9.2 states that *"AR-6 (code review for
crypto changes) does not cover bridge message changes — a separate review gate for `packages/shared/` changes may be
needed … flagged for DOC-001e."* Option C applies the **R7 architect sign-off** to bridge/origin-validation work,
which is *stricter* than AR-6 as written. That is defensible (the extension boundary is a separate threat model,
ADR-002 §5.5) but it is a security-policy choice: **`architect` must either confirm that bridge/origin-validation
cards need the Architect sign-off (then C stands) or scope `R7` to the crypto boundary alone** (then `R7` inherits
ADR-005's item and DOC-001e owns the bridge gate). Either answer is fine; leaving it implicit is not.

### 4.5 Owner / next action (item 3)

| action | owner | where it lands |
|---|---|---|
| decide option C vs a narrower `R7`, and the AR-6/bridge question above | `architect` (security policy) | `QA_SIGN_OFF_GATE.md` §5.5 + decision record |
| dual sign-off on the rule change (per `t_28f60dc1` Decision 1: structural changes to the gate need architect + QA) | `architect` + `qa` | same |
| implement `R7` v2 + selftest cases (one card: keyword miss, one: test-type suppression, one: `AUTOFILL_REQUEST`, one: control) | `qa` | `scripts/qa/signoff-gate.mjs`, `signoff-gate.selftest.mjs` |
| re-run the audit and publish the new classification table | `qa` | evidence on the implementation card |

---

## 5. §10 items 4–7 — status (not this card's scope; recorded so nothing is dropped)

| §10 | status verified on this host |
|---|---|
| 4 — advisory cross-board audit for non-default boards | **open, no-op today.** No non-default board exists (`~/.hermes/kanban/` holds only `kanban.db`), so there is nothing to point `--db` at. The CI job's `board_db` input already provides the mechanism. Owner `qa`, until a release-track board exists |
| 5 — a comment that quotes the verdict line is parsed as a verdict | **partially fixed.** `t_58280940` gave the **deferral** regex its leading boundary and code-span awareness (`DEFERRAL_RE`); `VERDICT_MARKER_RE` still has **no** code-span exclusion, so a *newest* quoting comment still becomes the operative verdict. Owner `qa` — open |
| 6 — hook subprocess env carries the dashboard credentials | unchanged Hermes-install fact; owner `architect` (config), record only |
| 7 — `extra.task_id` is the session id / kanban env scrubbed | unchanged runtime fact; §6.4 compensates; owner `architect`, record only |

---

## 6. Owner summary

| item | sub-item | owner | next action |
|---|---|---|---|
| 1 | S1 `fetch-depth: 0` | `architect` | edit PR #17/#18 workflow |
| 1 | S2/S6 gate-revision coupling + merge order | `architect` | land #16 → #25 → #17/#18 |
| 1 | S5 first scheduled run as acceptance | `architect` | capture run URL |
| 1 | S7 board candidate list | `architect` | same PR as S1 |
| 2 | durable grandfathering record (§3.3.1) | `architect` | commit to `PROJECT_BRIEF.md` §9 / `docs/decisions/` |
| 2 | retro-verify 3 B-cards | `qa` | verdict comments on the 3 cards |
| 2 | repair 3 C-records | `qa` | evidence pointers on the 3 cards |
| 2 | 6 post-epoch gaps (§3.5) | per-card owners | verdict/evidence/token fix |
| 2 | P1/P2 gate behaviour | `architect`+`qa` | rule change ⇒ dual sign-off |
| 3 | `R7` v2 decision + AR-6/bridge question | `architect` | decision record |
| 3 | `R7` v2 implementation + selftests | `qa` | `signoff-gate.mjs` |
| 4–7 | see §5 | `qa` (4, 5) / `architect` (6, 7) | as recorded |

---

## 7. Reproduction and evidence index

everything re-runs from a clone of the repo plus the local board:

```
node scripts/qa/signoff-gate.mjs audit --db ~/.hermes/kanban.db --repo <clone>                 # 6 FAIL
node scripts/qa/signoff-gate.mjs audit --db ~/.hermes/kanban.db --repo <clone> --strict-history # 30 FAIL
node scripts/qa/signoff-gate.mjs audit --db ~/.hermes/kanban.db --repo <shallow-clone>          # 8 FAIL (§2.3 S1)
node <master-revision>/signoff-gate.mjs audit --db … --repo …                                   # 8 FAIL (§2.3 S2)
```

| file in `tests/evidence/t_7dd3b960/` | content |
|---|---|
| `reproduce.sh` | the full re-run script (board dump → audits → A/Bs → analyses) |
| `audit-default.txt` / `.json` | enforced view, real board |
| `audit-strict-history.txt` / `.json` | retrofit view |
| `audit-master-gate.txt` / `.json` | the same board under master's gate revision (§2.3 S2) |
| `analysis.txt` | per-card rule + evidence state for all 43 done cards; the 27-card backlog table |
| `ab-gate-revisions.txt` | PR #25 vs master gate, rule-level diff |
| `job-replay.sh` + `job-A-full-clone.json` / `job-B-shallow-clone.json` / `job-C-no-board.txt` / `job-replay-compare.txt` | item 1 replays (§2.2, §2.3 S1) |
| `item1-verification.txt` | `actionlint` results, gate-script presence per PR branch, `VERDICT_MARKER_RE` (§5), boards present |
| `r7-analysis.txt`, `r7-tokens.txt`, `r7-variants.txt` | item 3: scope vs heuristic, missing tokens, options A–D |
| `verify-durable-records.txt` | §3.4's existence checks (`git log --all`, `git rev-list --all`, `PROJECT_BRIEF.md` §9) |
| `card-t_ea0783c5.txt`, `card-t_33dcad7d.txt` | the two upstream cards read in full (context; board text, not repo content) |

**Not committed, by design:** `board-tasks.json` / `board-comments.json` (raw board dumps — the repo is public and
those files carry every card title, body and comment). They are regenerable with `dump-board.sh` + `dump-comments.sh`
against the local board. No secret value appears in any committed file: the evidence was scanned for token-shaped
strings and by `gitleaks` before the push.

---

## 8. Upstream document updates needed

`QA_SIGN_OFF_GATE.md` is **not on `master`** — it lives on the PR #16 branch and on the gate-fix branches, so a §10
edit from this card would collide with those PRs. Rather than edit a hotspot, the replacement text for §10 rows 1–3 is
supplied here for the merge lane to paste when the policy doc lands (the §10 rows 4–7 text in §5 stays as is, with
row 5's status corrected):

| # | replacement §10 row | owner |
|---|---|---|
| 1 | **CLOSED (2026-09-18, `t_7dd3b960`)** — the audit runs as a scheduled CI job (`.github/workflows/qa-signoff-audit.yml`, weekly 06:17 UTC, not a required check) on a self-hosted runner selected by `vars.QA_SIGNOFF_AUDIT_RUNNER`; transport decided in `docs/decisions/qa-signoff-gate-followups-t_527d4720.md`. **Three spec requirements remain open** — `fetch-depth: 0`, running the PR #25 gate revision rather than master's, and a first real scheduled run — see `docs/decisions/qa-signoff-gate-s10-open-items-t_7dd3b960.md` §2.3 | `architect` |
| 2 | Open — audited 2026-09-18 (`t_7dd3b960`): backlog is **27** cards, 24 fail `--strict-history`; disposition proposed (retro-verify 3, repair 3, grandfather 21) and the 2026-09-17 grandfathering decision is **not durable** (`PROJECT_BRIEF.md` §9 on master carries no such record; the `t_33dcad7d` decision artifact was never committed). See §3 of that decision record | `architect` (record) + `qa` (6 cards) |
| 3 | Open — classification re-derived from ADR-002 §5.3 + ADR-005 §9.2; the shipped heuristic flags 7/129 cards and misses **18** in-scope ones (13 suppressed by the `security` Test-Type AND, 5 by keyword gaps including `AUTOFILL_REQUEST` vs `\bautofill\b`); recommended scope-driven `R7` v2 (option C) pending the AR-6/bridge decision | `architect` + `qa` (dual sign-off) |

---

## 9. Changelog

| date | change |
|---|---|
| 2026-09-18 | Initial record (`t_7dd3b960`): item 1 re-verified + 3 new spec requirements; item 2 audited (27 cards, full disposition, durability finding, 6 post-epoch gaps); item 3 re-classified against the ADRs with measured options A–D and the AR-6/bridge policy question routed to `architect` |
