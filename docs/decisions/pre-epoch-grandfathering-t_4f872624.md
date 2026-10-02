# Pre-epoch grandfathering decision — durable record

**Task:** `t_4f872624` (architect, child of `t_7dd3b960` / QA-001i).
**Date recorded:** 2026-09-18.
**Corrects:** `t_33dcad7d` (2026-09-17) claimed "26 cards stay grandfathered … decision recorded in PROJECT_BRIEF.md §9"; verified on this host: `PROJECT_BRIEF.md` §9 carries no `grandfather|pre-epoch|sign-off gate` text; `docs/decisions/qa-signoff-gate-followups-t_33dcad7d.md` was never committed on any ref; no attachment on `kanban_attachments t_33dcad7d`. The audit is the source of truth.

## Decision (durable)
- The pre-epoch backlog is **27 cards** (not 26) — derived from `node scripts/qa/signoff-gate.mjs audit --db ~/.hermes/kanban.db --repo <repo>` (default view: 43 done / 16 enforced / 27 grandfathered; strict-history: 30 FAIL, 24 of 27 fail `A1_HISTORY_UNGATED`).
- **Disposition:** retro-verify 3 (B-cards) / record-repair 3 (C-cards) / grandfather 21 (A-cards). No blanket retrofit (would fabricate verdicts for work QA did not verify at the time — the failure mode the gate exists to prevent).
- **Rule applied (per card, see §3.2 of `docs/decisions/qa-signoff-gate-s10-open-items-t_7dd3b960.md`):**
  - B (retro-verify, dated, labelled, evidence-linked): `t_9840ccdd` (SEC-001 — the only pre-epoch card R7 flags as security-track), `t_3ca45da2` (ADR-002 — the classification list R7 validates against), `t_08b02da9` (ADR-005 — the other half of that list; also the `bridge-*` word-boundary miss).
  - C (record repair — verdict present but pointer stale/incomplete): `t_ac6a1f3f` (stale absolute path `/tmp/qa-negative-control.md` → R5 failure), `t_a2cf1744` (verdict present, no evidence pointer `R4`), `t_5fe41426` (deferral target `t_a2cf1744` carries verdict but no evidence `R4`).
  - A (grandfather — 21): `t_258f91c8`, `t_ad18d4ed`, `t_5f82ac57`, `t_7ec83773`, `t_f8a5c949`, `t_f463b44f`, `t_415897da`, `t_7c572465`, `t_aed3f3d1`, `t_53b034b7`, `t_767aca4b`, `t_e2b31691`, `t_7d365ce0`, `t_f82e53b6`, `t_d19ced15`, `t_18ae13ea`, `t_204ae591`, `t_11c01f92`, `t_78b46688`, `t_430aa9a3`, `t_ee24fd37`.
- **Audit command (re-runnable):** `node scripts/qa/signoff-gate.mjs audit --db ~/.hermes/kanban.db --repo <clone> [--strict-history]`. Source list: `tests/evidence/t_7dd3b960/analysis.txt`.
- **Grandfathering is not amnesty:** `A1_HISTORY_UNGATED` advisories stay visible on every audit run (`QA_SIGN_OFF_GATE.md` §7); the 3 B-cards must be retro-verified; the 3 C-cards repaired.

## 6 post-epoch audit gaps routed (per-card owner)
Each is a real gap in the record (measured by the audit, not opinion):

| card | rules | owner | missing / routed |
|---|---|---|---|
| `t_28f60dc1` (ARCH, parent) | `R5` | `architect` | verdict names `tests/evidence/t_28f60dc1/README.md` — not in repo on any ref (scratch-workspace only) |
| `t_527d4720` | `R2` | `architect` | token `"pass (comment 42)"` in run metadata — off-vocabulary |
| `t_80fc0326` | `R2` × 3 | `architect` | tokens `ROTATION`, `CHANGES` |
| `t_b51a1ff3` | `R2` × 2 | `architect` | token `changes` |
| `t_7918f010` | `R1` + `R4` | `backend` | BE-001f — no verdict, no evidence pointer |
| `t_c3cb6842` | `R1` + `R4` | `qa` | QA's repair card; follow-up verdict landed on `t_5455942d` instead |

Two patterns noted, not decided here (need architect + qa dual sign-off): P1 — verdict-by-run-metadata (`metadata.verdict`) is invisible to the hook; P2 — scratch workspace cannot satisfy R5; evidence must be a committed path or attachment.

## Out of scope for this record
- Executing the retrofit (`t_4242bee8`, qa) and the CI spec (`t_710ed14c`, architect) — separate cards.
- The R7 v2 security-track decision (`t_18230e85` / `t_75799b2e`) — separate card, needs dual architect + qa sign-off.

---
Audit source of truth: `tests/evidence/t_7dd3b960/analysis.txt` (27-card table + 6 gap table above). Evidence index: `docs/decisions/qa-signoff-gate-s10-open-items-t_7dd3b960.md` (branch `qa/t_7dd3b960-s10-open-items`, PR #27, commit `6e1df59`).
