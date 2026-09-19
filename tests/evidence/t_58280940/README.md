# t_58280940 — QA: R8 false positive on a stale deferral marker (gate defect, P1)

**Verdict: the defect is real, fixed, installed, and verified. The fix ships on this branch; the
board's ONLY affected card (`t_f49d448c`) now clears the gate on the gate's own merits.**

- Defect: `scripts/qa/signoff-gate.mjs` collected the **oldest** `QA-VERDICT: deferred — t_xxxxxxxx`
  marker (`.find()`) and evaluated **R8 unconditionally** — even when a valid QA verdict was recorded
  *after* the marker. A card whose verdict had already landed therefore stayed uncompletable forever,
  contradicting `QA_SIGN_OFF_GATE.md` §3 ("when several sources exist, the newest one is the operative
  verdict").
- Second, compounding defect: `DEFERRAL_RE` had no leading boundary, so a comment that merely **quoted**
  the marker (frontend's gate-defect report, `t_f49d448c` comment 95, which quotes
  `` `QA-VERDICT: deferred — t_930fddbe` ``) was parsed as the card's *live* deferral — and, being the
  newest comment, hijacked the newest-marker ordering after the first defect was fixed.
- Fix (one file, `scripts/qa/signoff-gate.mjs`): only the **newest** marker is operative; a marker
  superseded by a verdict recorded at/after it is history (`collectDeferral()` returns `null`); and
  `DEFERRAL_RE` now carries the same leading boundary as `VERDICT_MARKER_RE` (`t_c3cb6842`), so quoted
  markers are documentation, not deferrals.

## Fix under test

```
scripts/qa/signoff-gate.mjs
  pre-fix  sha256 44e15f95fcf133367d14f633ab1d2d812ccbe8f1b7666d78d762b65a73bc604b  (origin/master f74fb09, = the 7 installed copies before this run)
  post-fix sha256 0af4a45363280c134b19662840d04e43d6214b98fca278ec75efe2f824cc8d55  (installed in all 7 profiles)
```

## Evidence index (files in this directory)

| File | What it proves |
|---|---|
| `selftest-GREEN-fixed-gate.txt` | `node scripts/qa/signoff-gate.selftest.mjs` → **58/58 cases pass** with the fixed gate (49 pre-existing checks + 9 new checks over 5 new fixtures). |
| `selftest-RED-unfixed-gate.txt` | Same suite against the **unfixed** master gate → **51/58**: the 7 new checks that assert the fix fail; the 2 new checks that are controls for existing behaviour pass by design. RED→GREEN, non-vacuously. |
| `ab-live-unfixed-gate.txt` / `ab-live-fixed-gate.txt` | A/B **on the live board, same second**: unfixed → `exit=1 R8_DEFERRAL_TARGET_INVALID`; fixed → `exit=0`, `violations: []`. Proves the R8 clearance is the fix, not the human `X1` exception on that card (the exception does not suppress R8). |
| `hook-ab-fixture.txt` | A/B through **hook mode** on a fixture board: `t_fx000003` (stale marker + later verdict) is blocked by the pre-fix gate (`R8_DEFERRAL_TARGET_INVALID`) and allowed by the **installed** gate; the non-compliant control `t_fx000002` still blocks (`R1`, `R4`) and the compliant control `t_fx000001` still passes. |
| `ac1-installed-gate.txt` | **AC1**: `node <profile>/agent-hooks/signoff-gate.mjs check --task t_f49d448c --pre-complete` → **exit 0, no violations** (also with `--repo` resolved, and `--json`). |
| `installed-hashes.txt` | All 7 installed copies byte-identical to the reviewed repo copy (`0af4a453…`), 1 distinct hash, 0 drift. |
| `install-all-apply.txt` | `scripts/qa/hooks/install-signoff-gate.sh --all --apply` transcript (exit 0). |
| `verify-all-live.txt` | `scripts/qa/hooks/verify-signoff-gate.sh --all --live` → **84 ok · 4 warn · 3 FAIL**. The 3 FAILs are all the *pre-existing* mtime drift of the unrelated **secret-guard** hook in `architect`/`docs`/`qa` (file mtime `2026-09-18T08:38`, ≈12 h before this run, approved earlier) — the verifier tolerates exactly one drift warning per profile, so a profile with two hook-warning lines is reported FAIL. The live fires themselves passed in all 7 profiles (`ok` for the non-compliant block + compliant allow). |
| `audit-diff-prefix-vs-postfix.txt` | Whole-board audit, pre-fix vs post-fix: **exactly one** card changes (`t_f49d448c`), enforced failures 8 → 7. No card gains a violation — the change cannot create a false negative. |
| `check-t_f49d448c-fixed-source.txt` | Intermediate check with the *partial* fix (newest-marker only), which exposed the quoted-marker phantom target — the reason the `DEFERRAL_RE` boundary is part of the fix. |
| `fe001h-independent-verification.txt` | Independent QA re-verification of the deliverable on the blocked card: fresh clone @ `c918425`, pnpm 9.12.0 `--frozen-lockfile`, `lint` / `typecheck` / `test` / `test:integration` / `build` all exit 0. |
| `fe001h-config-inspection.txt` | The FE-001h configuration as committed at `c918425`: ESLint 9 flat config, Prettier config, `strict: true` in all three tsconfigs, CI workflow with the 5 checks. |
| `secret-scan-evidence.txt` | `scripts/qa/secret-guard.mjs check` run over every artifact above: **0 hits** (no secret-shaped value anywhere). |
| `selftest-GREEN-fixed-gate.txt` (case list) | The 9 new checks are also visible in this PR's diff of `scripts/qa/signoff-gate.selftest.mjs` (`BE-915`…`BE-919`). No separate patch file is shipped: a diff artifact that reproduces the removed `…_TOKEN, "<value>"` line trips gitleaks' `generic-api-key` rule on the CI `secret-scan` check. |

## Regression cases added to the gate selftest

| Case | Shape | Expectation |
|---|---|---|
| `BE-915` | marker → later verdict | 0 violations, `facts.deferral === null` |
| `BE-916` | marker to an **open QA child** → later verdict | 0 violations, **no** `A2_DEFERRAL_OPEN` |
| `BE-917` | verdict → **newer** marker to a non-QA card | `R8_DEFERRAL_TARGET_INVALID` — superseding is ordered, not amnesty |
| `BE-918` | only a **quoted** marker (code span) | `R1` fires, **`R8` must not** (no phantom deferral) |
| `BE-919` | real marker → later comment **quoting** it → verdict | 0 violations (the quote must not hijack the ordering) |

## Notes for the reviewer

1. `t_f49d448c` was closed by the human with a `qa-signoff-exception` (comment 96, author `human`) while
   this fix was in flight. That exception bypasses `R1`/`R4` **but not R8** — both A/B transcripts show
   the card failing `R8` with the unfixed gate and passing with the fixed one, so the gate is now clean
   on its own terms. The card also carries a `qa`-authored `QA-VERDICT: pass` (comment 97, §5.1 form).
2. The gate's tooling (`signoff-gate.selftest.mjs`, `scripts/qa/hooks/*`, `QA_SIGN_OFF_GATE.md`) is still
   **absent from master** — it lives on `qa/t_5455942d-gate-fix` and in open PR #16. This branch therefore
   ships the fix **together with the current selftest** (so the fix is covered on master), and the
   installer/verifier used here were taken from that branch.
   The selftest copy on that branch carries a pre-existing gitleaks `generic-api-key` false positive
   (the synthetic `…_TOKEN, "<rule id>"` fixture call; fingerprint
   `8a8b2e3034b8…:scripts/qa/signoff-gate.selftest.mjs:generic-api-key`) which failed this PR's CI
   `secret-scan`; it is fixed here, so whichever PR puts the selftest on master must carry that fix.
3. Until this branch is merged, a `verify-signoff-gate.sh` run from a **master** checkout will report
   SHA-256 drift against the installed copies — that is the drift check working as designed, not a fault.
4. No secret value appears anywhere in this evidence; the leaked-token incident (`t_0af5aa3e`,
   gate `t_930fddbe`) is referenced only by task id.
