# t_a352d5a3 — the marker path skips a quoted or code-wrapped QA-VERDICT

Author: qa (gate change). Author's self-check; architect counter-verifies and merges.
Base: origin/master @ b4bdf60 (PR #156). Node v22.23.4 (CI version).

## Defect
`collectVerdicts` read the first `VERDICT_MARKER_RE` match anywhere in a qa comment. Its leading boundary rejects a
backtick right before `QA`, but not a marker on a `>` quote line, inside a fenced block, or inside a code span that
starts earlier. A qa comment quoting another card's `QA-VERDICT: pass` counted as qa's verdict on this card.

## Fix (`scripts/qa/signoff-gate.mjs`, `markerVerdict()`)
The first marker that is not inside `codeRanges` and not on a block-quote line is the verdict. If none is left the
loose path (§5.8.1) is tried, with the same exclusions. Policy: QA_SIGN_OFF_GATE.md §5.8.2.

## AC2 — selftest
- `selftest-red.txt`: branch selftest against the unchanged master gate: 243/248. The 5 behaviour cases fail
  (fence, quote, code span, quoted fail then real pass, quoted foreign pass then real fail); the 3 controls pass
  (bare marker, bold marker, marker mid-line in prose).
- `selftest-green.txt`: 248/248 on the branch gate.

## AC3 — live board, before/after (snapshot 2026-11-03: 244 cards, 961 comments)
- `audit-before-after.txt` (`audit-compare.py`): `audit --strict-history --no-github`, master gate vs branch gate,
  172 done cards: **0 cards change** (failures 56 -> 56).
- `qa-comments-marker-change.txt` (`qa-comments-marker-change.mjs`): all 492 qa comments, open cards included;
  164 carry a marker; the marker reading changes for **0**. The fix is preventive on today's board.

## Out of scope
`collectDiscountedVerdicts` (A7, non-QA markers) still uses the raw regex: it only reports. `DEFERRAL_RE` unchanged.
