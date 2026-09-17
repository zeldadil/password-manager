# QA review report — t_b51a1ff3, round 2 (lens: execution)

Reviewed revision: **9f5daab** (implementer: architect, run 475). Review run **477**.
Method: fresh `git clone --single-branch` of the pushed branch; every claim re-executed on this host.
Raw transcript: branch `qa/t_b51a1ff3-review-r2` @ `70e453a` →
`tests/evidence/t_b51a1ff3/review-r2/` (`round2-execution-transcript.txt`,
`verify-secret-guard-all-live-r2.txt`, `reproduce-review-r2.sh`, `gitleaks-r2.json`).

## Verdict: changes requested — B1, B2, B3

| Round-1 defect | Status after run 475 |
|---|---|
| D1 guard not in the repo / unpushed | **FIXED** — 9f5daab is origin's branch tip; all 8 files under `scripts/qa/` tracked |
| D2 `kanban_complete.result` / top-level `artifacts` unscanned | **PARTIAL** — fixed in source, deployed to 1 of 7 profiles |
| D3 verifier reports false results | **NOT FIXED** — one of the two false checks fixed, the other now false-greens |
| AC1/A2 fixture that does not match the rule | **FIXED** — matching fixture; I reproduced block + allow |

## B1 (blocking) — 6 of 7 profiles run the stale, pre-D2 guard

sha256 of `agent-hooks/secret-guard.mjs`, installed vs `9f5daab`:

```
2e60bb23…  architect     <- matches the reviewed repo copy
5cfffb0e…  backend browser docs frontend product qa   <- pre-D2 version (13654 B vs 17487 B)
```

Live evidence, true runtime wire shape (`tool_input`, as `agent/shell_hooks.py::_payload_fields`
emits it), synthetic shape-matching fixture:

- CASE A installed **qa** hook + token in `kanban_complete.result` → `{}` **exit 0 = ALLOWED**
- CASE B installed **architect** hook, same payload → **exit 2 = BLOCKED**
- CASE C repo copy, same payload → **exit 2 = BLOCKED**
- CASE D control: installed qa hook + token in a comment **body** → **exit 2 = BLOCKED**

CASE D proves the payload plumbing works, so CASE A is stale code, not a plumbing artifact:
for 6 profiles the exact failure mode D2 was raised to close is still live.
Independent corroboration from the card's own verifier: `verify-secret-guard.sh --all --live`
→ **78 ok · 6 FAIL**, every FAIL = "installed gate differs from the repo copy … reinstall".
Nothing re-installs the `.mjs` at dispatch, so this does not self-heal (unlike the A1 allowlist case).

Required: `scripts/qa/hooks/install-secret-guard.sh --all --apply`, then
`verify-secret-guard.sh --all --live` must return 0 FAIL, and that output committed.
SECURITY.md "Hook coverage" must state the real rollout state.

## B2 (blocking) — the verifier still reports false results (D3 residue)

1. Doctor check: `grep -qi "issue(s)? found"` (BRE) can never match doctor's literal wording
   `2 issue(s) found.` → verified `grep` exit **1** on the real line. Consequence: the verifier
   printed "hermes hooks doctor clean" for 6 profiles whose own doctor transcript reports issues —
   for backend including `✗ not allowlisted — hook will NOT fire at runtime`.
2. Consent check: greps the whole `hooks list` output for `✓ allowed`. Backend passes only because
   the **qa-signoff-gate** line says `✓ allowed`, while `secret-guard.sh` itself is
   `✗ not allowlisted`. The check must be scoped to the secret-guard line.
3. Add a `result`-field live-fire case: today's live-fire only exercises a comment body, which is
   why 78 ok hid B1.

## B3 (blocking) — AC3's gitleaks verification is not clean

`gitleaks detect --source . --no-banner --redact` on the reviewed revision: **exit 1**,
1 finding — `generic-api-key` at `scripts/qa/secret-guard.selftest.mjs:41` (comment naming the real
bot id followed by a literal `***`), introduced by commit `9f5daab3`. trufflehog
(`--results=verified,unknown`) → 0 verified / 0 unverified: that half passes.
Repo-wide there are 6 findings, including this one; master's `secret-scan` job runs gitleaks-action
plus `trufflehog … --fail`, and `.gitleaksignore` has no entry for `9f5daab3:…selftest.mjs:41`,
so merging this branch fails the repo's own hard secret-scan gate.
Fix: reword line 41 / use a fully synthetic id (also retires A7), re-run both scanners clean, commit.

## Advisories (not conditions of the verdict)

- SECURITY.md contradicts the evidence it references: "Selftest: 16/16" (evidence: 21/21),
  "Live-fire: 9/9" (live-fire.txt has 2 cases), "the only `.gitleaksignore` entry" (there are 2;
  neither exempts a hook/test file).
- Run 475 claims "A6: SECURITY.md states this is process control, not a tamper-proof boundary" —
  no such statement exists anywhere on the branch (grep: 0 hits).
- A5 is code-only: the guard handles 6 tools, every installed config matcher still names 3.
- Deliverable sits on an unmerged branch 4 commits behind master (which added CI); rebase before
  merge so AC3 is gated by CI rather than by review.
- `secret-guard.mjs` docstring misstates the wire contract: `_payload_fields` emits
  `tool_name/tool_input/session_id/cwd/profile/extra` — never a top-level `args` (that key is only
  excluded from `extra` at `agent/shell_hooks.py:49`). Harmless (tool_input is handled), doc wrong.

## Verified working — do not regress

- selftest 21/21 on a fresh clone; block cases for summary / result / artifacts / request_review /
  block / request_changes; malformed payload fails closed; kill switch allows.
- My own live-fire with a matching synthetic fixture: block exit 2 quoting **rule ids only**, allow exit 0.
- AC5 PASS: 0 allowlist/exclusion constructs in the guard source, kill switch absent,
  `.gitleaksignore`'s 2 entries cover no hook or test file.
- AC2 PASS with A4 still open (`QA_SIGN_OFF_GATE.md` not in-tree; rule + evaluation order present in
  SECURITY.md §"Secrets in Kanban"; open item recorded with owner `qa`).
- Deliverable 3: rotation question posted on `t_0af5aa3e` (comment 57); the human answer is still
  pending and does not gate AC1–AC5; held recommendation unchanged.

No secret value was printed, copied, committed or attached during this review. No implementation
file was edited by the reviewer.
