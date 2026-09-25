# FE-002h: a11y Tests — QA Evidence

**Task:** t_a526419e (FE-002h)
**Landed on master via:** PR #88, commit 09b91f3 (2026-09-25)

## Starting state

This task was previously marked `done` (2026-09-24 12:36) with a
`QA-VERDICT: pass` comment, citing commit `791665a` on branch
`feature/t_12f540bf` and PR #87 — which was still `DIRTY`/`CONFLICTING`
against master at the time, and stayed that way (a live sibling agent,
t_63323ce5, kept pushing to the same branch until it stalled overnight).
The commit this task's completion cited never actually reached master.
See `tests/evidence/t_63323ce5/README.md` for the full timeline of how
PR #87 got untangled into PR #88.

## Acceptance criterion

> axe-core on both pages, screen-reader announcements verified

**Already met on master before this task's own commit was even
evaluated.** PR #85 (2026-09-24, landed earlier the same day as this
task's original attempt) independently fixed the real defect this
task's a11y suite depends on — the converse route-coverage spec in
`routes.a11y.test.tsx` was structurally unable to fail (see
`tests/evidence/t_782802ac/README.md`). This task's own commit
(`791665a`, "resolve merge-conflict markers in a11y test suites")
resolved a git conflict between its stale base and a version of that
fix, choosing one of two functionally-equivalent implementations. When
rebuilding PR #87 onto current master, that commit was **skipped
entirely** — a no-op, since master already carried the same fix content
through a different, already-verified path — rather than re-applied and
re-conflicting.

The 50 a11y-domain tests this task's handoff cited (`a11y.test.tsx`
29/29, `routes.a11y.test.tsx` 21/21) are real and pass on master today —
they're the same suite `t_782802ac`/PR #85 already verified, now also
exercised as part of PR #88's fresh-clone verification (`pnpm test:a11y`
— 21/21; the 29 `a11y.test.tsx` tests run under `pnpm -r test`'s 214
web tests).

## Verification run (2026-09-25, fresh clone at commit 09b91f3)

Identical to `tests/evidence/t_63323ce5/README.md`'s verification
section — `pnpm -r typecheck`, `pnpm -r test` (214 web / 615 api / 53
crypto), `pnpm test:a11y` (21/21), `pnpm build`, all clean. All 10 CI
checks green on the merged PR.

## Security

No real secret, credential, or PII in this file, the reviewed diff, or
the merged code.

## Verdict

`pass` — see `QA-VERDICT` comment on this card.
