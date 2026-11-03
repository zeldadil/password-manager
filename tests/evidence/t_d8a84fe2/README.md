# t_d8a84fe2 — the loose verdict path reads only qa's own verdict

Author: qa (gate change). This is the author's self-check; architect counter-verifies before the merge.
Base: origin/master @ 1ff19e6. Node v22.23.4 (CI version).

## Defect
`VERDICT_LOOSE_RE` was applied to the first `verdict: <token>` anywhere in a qa comment. A qa note that only
mentioned another actor's verdict was recorded as a QA verdict. Live: qa note #954 on t_93cf5611
(`ARCH-VERDICT: approved`) gave R2 "approved". Worse: a quoted foreign `verdict: pass` was a QA pass.

## Fix (`scripts/qa/signoff-gate.mjs`, `looseVerdict()`)
An occurrence is skipped when it is inside a code span / fence (`codeRanges`), on a block-quote line, or right after
the name of another actor (arch/architect, frontend, backend, browser, docs, product, worker, dashboard, human).
The first remaining occurrence is the loose verdict. `reviewer` / `author` are not excluded: qa uses them for itself
(t_80fc0326 #63). Policy in QA_SIGN_OFF_GATE.md §5.8.1.

## Selftest
- `selftest-red.txt`: branch selftest against the unchanged master gate: 234/240, the 6 behaviour cases fail
  (1-5, 8); controls 6, 7, 9, 10 pass.
- `selftest-green.txt`: 240/240 on the branch gate.

## Board snapshot (2026-11-03, 243 cards, 957 comments)
- `qa-comments-reading-change.txt` (script `.mjs`): 490 qa comments, 24 reach the loose path, the reading changes
  for 6, all mentions (5 backticked quotes, 1 ARCH-VERDICT), none a genuine record.
- `audit-before-after.txt` (script `audit-compare.py`): `audit --strict-history --no-github`, master gate vs branch
  gate, 171 done cards, 4 change, failures 54 -> 56:
  - t_df8e644a: pass -> none (R1). Its pass came from a backticked example in qa comment 173; there is no genuine
    QA verdict on that card.
  - t_6df8813b, t_8a64c3dd: a "fail" read from a backticked quote disappears (R3 -> R1 / R4).
  - t_1e217ae2: gains R8, its deferral target t_6df8813b has no verdict any more.
  No card loses a genuine verdict. The 4 cards need follow-up after the merge (owners decide).

## Residual
"NOT a verdict: the …" still reads `the` and fails closed (R2). The marker path has no quote/code exclusion
(§10 item 5 stays open).
