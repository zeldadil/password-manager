# t_7dd3b960 — QA-001i: gate-tooling §10 open items 1–3 (audit CI, pre-epoch backlog, R7)

Deliverable: **`docs/decisions/qa-signoff-gate-s10-open-items-t_7dd3b960.md`** (QA-001i decision record).
This directory holds the raw evidence behind every number in that record. Nothing here is a summary of a
summary: each file was produced by the command named next to it, on this host, against the live board.

## Environment the evidence was produced in

| input | value |
|---|---|
| board | `~/.hermes/kanban.db` (129 cards, 43 done, 16 done post-epoch, 27 done pre-epoch) |
| gate epoch | `2026-09-17T15:00:00Z` |
| gate under test | `scripts/qa/signoff-gate.mjs` sha256 `0af4a45363280c134b19662840d04e43d6214b98fca278ec75efe2f824cc8d55` (PR #25 revision; installed in all 7 profiles) |
| comparison revision | master's copy sha256 `44e15f95fcf133367d14f633ab1d2d812ccbe8f1b7666d78d762b65a73bc604b` (PR #24) |
| toolchain | node v22.23.2, sqlite3 3.45.1, actionlint 1.7.12 |
| repo | `zeldadil/password-manager`, `master@f74fb09` |

## Files

| file | produced by | what it proves |
|---|---|---|
| `audit-default.txt` / `audit-default.json` | `run-pre-epoch-audit.sh` (§A, §D) | enforced view of the real board: 6 FAIL of 16 post-epoch done cards |
| `audit-strict-history.txt` / `.json` | `run-pre-epoch-audit.sh` (§B, §C) | retrofit view: 24 of 27 pre-epoch cards fail `A1_HISTORY_UNGATED` |
| `analysis.txt` | `analyze.mjs` | per-card rule + evidence state for all 43 done cards; the 27-card backlog table with verdict/evidence flags |
| `audit-master-gate.txt` / `.json` | `ab-gate-revisions.sh` | the same board under **master's** gate → 8 FAIL |
| `ab-gate-revisions.txt` | `ab-compare.mjs` | rule-level diff: the two extra FAILs are the R8 false positives PR #25 fixes (`t_f49d448c`, `t_58280940`) |
| `job-B-shallow-clone.json` / `job-replay-compare.txt` | `job-replay.sh`, `replay-compare.mjs` | `actions/checkout@v4` default `fetch-depth: 1` turns 6 FAILs into 8 (`t_ea0783c5`, `t_28951254` falsely `R5`). Scenario A is `audit-default.json` — the full-clone run was byte-identical, so it is not duplicated |
| `job-C-no-board.txt` | `job-replay.sh` (§C) | with no board the gate exits 3 — the CI job's "AUDIT NOT RUN" red is reachable |
| `item1-verification.txt` | `verify-item1.sh` | `actionlint` clean on both workflow revisions; `scripts/qa/signoff-gate.mjs` **absent** from PR #17's head and present on PR #18's; `VERDICT_MARKER_RE` has no code-span exclusion (§10 item 5); no non-default board exists (§10 item 4) |
| `r7-analysis.txt` | `r7-analysis.mjs` | `R7` heuristic vs the ADR-derived scope: 7 flagged, 18 in-scope cards missed |
| `r7-tokens.txt` | `r7-tokens.mjs` | which literal strings the shipped regex has and what each missed card contains |
| `r7-variants.txt` | `r7-variants.mjs` | options A–D measured over all 129 cards (7 / 26 / 24 / 9) |
| `verify-durable-records.txt` | `verify-records.sh` | `docs/decisions/qa-signoff-gate-followups-t_33dcad7d.md` was never committed on any ref; `PROJECT_BRIEF.md` §9 on master carries no grandfathering record |
| `card-t_ea0783c5.txt`, `card-t_33dcad7d.txt` | `show-cards.mjs` | the two upstream cards (CI-001h and the 2026-09-17 follow-up decisions) read in full, for context |
| `probe.sh` | — | repo/branch orientation: PR-branch trees, installed-gate hashes, toolchain versions |

The `.sh` / `.mjs` files in this directory are the **actual scripts that produced the evidence** — re-runnable.

## Not committed, by design

`dump-board.sh` and `dump-comments.sh` write `board-tasks.json` and `board-comments.json` into this directory:
**they are not committed.** This repository is public and those dumps carry every card title, body, comment,
evidence path and assignee (the same reason the board-snapshot transport was rejected in
`docs/decisions/qa-signoff-gate-followups-t_527d4720.md`). Regenerate them locally against your own board before
re-running the analyses. No secret value appears in any committed file — the evidence was scanned for
token-shaped strings and with `gitleaks` before the push.

## Dogfood transcripts (the gate checking this card)

| file | what it shows |
|---|---|
| `dogfood-before-verdict.txt` | `check --task t_7dd3b960 --pre-complete` before any verdict comment → `R4_EVIDENCE_MISSING` |
| `dogfood-after-verdict.txt` | after the first verdict comment, which **quoted** another card's missing evidence path while reporting a defect → `R5_EVIDENCE_FILE_MISSING` on *this* card, for a path it never claimed (P1 finding, routed as a follow-up card) |
| `dogfood-after-superseding-verdict.txt` | after a superseding verdict comment without the quoted path → exit 0, and that same path is then correctly downgraded to the `A5_EVIDENCE_SUPERSEDED` advisory |
