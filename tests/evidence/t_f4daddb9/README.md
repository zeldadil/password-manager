# t_f4daddb9 — a mention by an unmerged PR triggers R9 (never satisfies it)

Card: `t_f4daddb9` (follow-up of `t_7e8bf917`, architect objection #597).
Rule implemented (architect decision written in the card): when **no** PR declares the card, a mention by a PR that is
**not merged** (open, or closed unmerged) makes `R9` applicable (`applies = true`, `R9_PR_NOT_MERGED` until a declaring
PR is merged). A mention can trigger `R9`, never satisfy it. A mention by a merged PR stays `A14_PR_MENTIONS_CARD` only.

Everything here is read-only: no board write, no GitHub write. Node v26.7.0 (the gate is zero-dep; the selftest runs
on the same Node the gate was last verified on).

| File | What it shows |
|---|---|
| `selftest-green.sh` / `selftest-green.txt` | branch selftest vs branch gate: **230/230**, exit 0 |
| `selftest-red.sh` / `selftest-red.txt` | the same selftest vs the `b1db88f` gate (the master the card reproduced on; the gate blob is identical on `0930d9f`): **225/230**, exit 1. Failing: the 4 new trigger cases (open title-only #931, closed-unmerged #933, the exact `evaluatePrRule` reproduction, branch list unreadable) + the amended "#114 shape" case. Passing on both sides: the 4 new controls (merged title-only #932, merged prose #921 on a `Deliverable: code` card, GitHub down → A11, pure-function merged control) |
| `audit-ab.sh` / `audit-ab.txt` / `audit-diff.mjs` | board-wide `audit --json` A/B (reference gate vs branch gate) on one sqlite `.backup` snapshot of the live board (235 cards, 161 done), live `gh` reads: **0 cards whose violation set changes**, default view and `--strict-history` view; 15 done cards carry an A14 mention, none from an unmerged PR |
| `pr-ab.mjs` / `pr-ab.txt` | the audit covers only done cards, so `evaluatePrRule` of both revisions over the **63 not-done** cards of the same snapshot, with one shared GitHub reader: **1 card changes** — `t_6fabf929` (QA-002, todo) gets `R9` from PR #32 (closed unmerged 2026-09-19, delivered `t_782802ac`), whose body only cites it as out of scope. That is the documented false-positive cost of the trigger (§5.9 Known limits). It only bites if QA-002 completes without a merged PR that declares it |

The board snapshot and the raw audit JSON are not committed (public repo, they carry card text).

Reproduce from a clone of this branch:

    git worktree add --detach ../ref-b1db88f b1db88f
    bash tests/evidence/t_f4daddb9/selftest-green.sh
    bash tests/evidence/t_f4daddb9/selftest-red.sh ../ref-b1db88f
    bash tests/evidence/t_f4daddb9/audit-ab.sh ../ref-b1db88f ../ab          # needs gh auth + ~/.hermes/kanban.db
    node tests/evidence/t_f4daddb9/pr-ab.mjs ../ref-b1db88f/scripts/qa/signoff-gate.mjs scripts/qa/signoff-gate.mjs ../ab/board-snapshot.db
