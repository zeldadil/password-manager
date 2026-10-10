# t_39a7e9eb — SEC-GATE verifier: false FAILs (pipefail on hooks list, doctor counts unrelated warnings)

Fix in `scripts/qa/hooks/verify-signoff-gate.sh` (+ the matching paragraph of `QA_SIGN_OFF_GATE.md`).
Origin: qa verdict #595 on `t_dbecf24d` (evidence PR #121) — 10 FAILs, all verifier defects.

## What changed

1. **Presence tests no longer depend on how a pipe ends.** `hermes config get hooks`, `hermes hooks list`
   are captured in full (`out="$(hermes …)"; rc=$?`), then filtered with a here-string. A non-zero hermes
   exit is now reported as `hermes … failed (exit N)` instead of masquerading as "hook not shown". The
   consent check reads the sign-off hook's own `hooks list` line (`✓ allowed`; the old pattern
   `✓ allowlisted` never appears in `hooks list` output). The live-fire `printf | grep -q` pipelines were
   converted too (same defect class).
2. **`hooks doctor` is judged per hook section.** Only the `[event] …/qa-signoff-gate.sh` section counts:
   one `script modified since approval` → `warn`; any other `⚠`, any `✗`, or no section for the sign-off
   hook → FAIL. Issues in any other hook's section are printed as `info` (new, not counted in ok/warn/FAIL)
   with the hook's path. The doctor transcript goes to `$TMPDIR` instead of a fixed `/tmp` path.

## Evidence (all produced by the scripts next to them, on 2026-10-10)

| File | Criterion | Result |
|---|---|---|
| `repro-ac1-pipefail.sh` → `repro-ac1-pipefail.txt` | AC1 | real `qa` profile, pipefail on, 5 runs: old test `ABSENT` 5/5 (`PIPESTATUS=120 0`), new test `present` 5/5 |
| `stub-cases.sh` → `stub-cases.txt` | AC1 + AC2 | 8 cases with a stub `hermes` + fake profile root: 8/8 as expected (2 green incl. the real architect/docs/qa doctor shape → warn + info, 6 negatives → FAIL) |
| same script, pre-fix verifier → `stub-cases.pre-fix.txt` | red control | `origin/master` verifier on the same cases: 7/8 misbehave (hooks-list false FAIL everywhere, doctor "2 warning(s)" FAIL) |
| `run-verify-real.sh` → `verify-real-7-profiles.txt` | AC3 | see below |

### AC3 — the 7 real profiles + negative control (`verify-real-7-profiles.txt`)

- **Run 2 — gate pinned at `fdaabca`** (the revision byte-identical to what is installed in all 7 profiles,
  sha256 `3c2d72b3884f…`): **84 ok · 7 warn · 0 FAIL · 3 info, exit 0**. The 7 warns are the sign-off
  hook's expected post-install mtime drift; the 3 infos are the `secret-guard.sh` drift on architect,
  docs, qa — reported, not counted. No `hooks list` FAIL on any profile.
- **Run 3 — negative control, real hermes**: a throwaway profile whose config has no sign-off hook →
  **9 FAIL, exit 1** (incl. `hermes hooks list does not show the hook` and
  `hermes hooks doctor does not check the sign-off hook`).
- **Run 1 — gate of this branch (= `origin/master` 1fc8907)**: 77 ok · 7 warn · **7 FAIL**. All 7 are
  `installed gate differs from the repo copy (installed 3c2d72b3884f… vs repo 413da76c5f8f…)` — a
  **genuine** finding, not a verifier defect: master's `signoff-gate.mjs` moved on with #127/#128/#129
  (t_b102b100, t_b2588ee7, t_5b5b61e2) after the last re-install, and none of the 7 profiles was
  re-installed. The verifier is right to stay red on it; reinstalling is out of this card's scope
  (reported to architect on the card).

## Reproduce

```bash
bash tests/evidence/t_39a7e9eb/repro-ac1-pipefail.sh qa
bash tests/evidence/t_39a7e9eb/stub-cases.sh
bash tests/evidence/t_39a7e9eb/run-verify-real.sh fdaabca   # read-only on the profiles
```

## Not done here (flagged on the card)

- `scripts/qa/hooks/verify-secret-guard.sh` (l.85/90/92/130) and `install-signoff-gate.sh` (l.115) carry the
  same `hermes … | grep -q` under `set -o pipefail` pattern.
- `secret-guard.sh` mtime drift (2026-09-18) on architect, docs, qa — out of scope per the card.
