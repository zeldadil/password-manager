# Evidence — t_c015bda7 (QA gate: superseded invalid verdict token must not block)

Verification performed on 2026-10-03 against commit 3aba97b (origin/master) and
`kanban.db` with epoch 1789660000 (post-epoch).

## Reproduction — live board (t_c7c986c7)

Before fix (`scripts/qa/signoff-gate.mjs` original):
  `node scripts/qa/signoff-gate.mjs check --task t_c7c986c7 --pre-complete`
  → R2_QA_VERDICT_INVALID on "confirm" (comment #403) even though #406 ("pass",
  446 seconds newer, durable attachment 137) supersedes it.

After fix:
  → PASS (0 FAIL) with advisory A9_VERDICT_SUPERSEDED reporting the superseded
  token and the later valid verdict that replaced it. The audit trail preserves
  both comments untouched; no edit to #403 or #406.

## Ordering asymmetry (regression fixtures, 93/93 cases pass)

Fixture BE-946 (`t_c015bda7` self-test): invalid-then-valid → PASS + A9 advisory.
Fixture BE-947: valid-then-invalid → R2 still fires; advisory A9 NOT recorded
(because nothing supersedes the later bad token). Confirms a good verdict can
never mask a bad one that followed it.

## Change summary (diff in repo at fix time)

`scripts/qa/signoff-gate.mjs` (R2 + A9 advisory, ~18 lines added): an invalid
verdict token is only a violation when no later valid verdict exists; supersession
is computed from the newest valid verdict (`operativeVerdict`), matching the R5
rule stated at line 38 of the same file. Advisory `A9_VERDICT_SUPERSEDED` reports
the superseded token and its replacement for audit visibility.

`scripts/qa/signoff-gate.selftest.mjs`: fixtures BE-946 (invalid-then-valid,
PASS + A9) and BE-947 (valid-then-invalid, R2); assertions verify both directions.
Full self-test: 93/93 pass.

Full-board audit (post-fix): 0 new failures; 27 grandfathered (pre-epoch) cards
only; t_c7c986c7 passes; advisory A5 (existing) and A9 (new) visible in audit.
