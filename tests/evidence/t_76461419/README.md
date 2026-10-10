# Evidence — t_76461419 (gitleaks full-history baseline + weekly schedule)

Human-readable justification and the run table: `docs/security/gitleaks-baseline.md`.
No file in this directory contains a secret value (fingerprints, sha256 prefixes,
HTTP codes and redacted log lines only).

| file | what |
|---|---|
| `tg_revocation_check.py` | getMe check of every distinct `telegram-token` value, values kept in memory only |
| `tg-check.out` | its output (2026-10-10): 11 detections, 4 distinct values, **4 × HTTP 401**, `RESULT: no value answered 200` |
| `shape.py` | classification helper: key name + masked shape of the value + source line with the match replaced; never prints a value (dotted code expressions excepted) |
| `build_baseline.py` | groups G1–G6 → appended fingerprints + doc tables, from the **redacted** report |
| `ci-green1-secret-scan.log` | run 38074698633 (dispatch, all refs): no leaks found |
| `ci-red-secret-scan.log` | run 38074823974 (negative control pushed): leaks found: 1 = the control commit `a5331dd` |
| `ci-green2-secret-scan.log` | run 38074938982 (control branch deleted): no leaks found |
| `ci-fullhistory-38075597533.log` | post-merge `secret-scan-full-history` run 38075597533 (dispatch, `9a439d3`): 303 commits, no leaks found |
| `ci-logs.sha256` | sha256 of the four `ci-*.log` files above |
| `format-guard-*.out`, `format-guard-bad-sample.ign` | format guard refuses a bare string and a commit-less entry (exit 1); accepts the real baseline (exit 0) |

The four `ci-*.log` files are the raw `secret-scan` / `secret-scan-full-history` **job**
logs, downloaded with `gh api repos/zeldadil/password-manager/actions/jobs/<job-id>/logs`
on 2026-10-10 and committed unmodified (gitleaks ran with `--redact`; GitHub masks
`GITHUB_TOKEN`). They were missing from PR #137 because `.gitignore` ignores `*.log`;
they are force-added by `t_764a497a` (AC4). Before committing they were scanned with
`gitleaks dir` 8.24.3 (0 findings), `trufflehog filesystem` (0 detectors), a
telegram-token shape grep (0) and a check that every `Secret:` line reads `REDACTED`.
Job ids: green1 114279119920, red 114279506138, green2 114279845179,
full-history 114281791403.

## Reproduce

    git clone https://github.com/zeldadil/password-manager.git && cd password-manager
    git checkout <this PR or master after merge>
    gitleaks detect --redact --exit-code=2          # gitleaks 8.24.3; reads .gitleaks.toml + .gitleaksignore
    # expected: "no leaks found" (a plain clone has every branch under refs/remotes, as in CI)

To recompute the uncovered set, move `.gitleaksignore` out of the working tree
(gitleaks always loads it from the source root, even with
`--gitleaks-ignore-path`) and scan with `--redact --report-format=json`.

## Observations outside this card's scope (reported on the card, not fixed here)

1. `tests/evidence/t_e348e0b7/trufflehog-origin-master-output.txt` on the
   master tip still holds the original incident token in clear (3 lines;
   fingerprints in group G6). The value is dead (401). Removing it from the tip
   would not remove it from history; whether to do so is a decision for
   architect.
2. Branch `qa/t_b51a1ff3-review-r2` (commit `9f5daab3`) holds the rotated value
   `sha256 df5ccd96…` in `scripts/qa/secret-guard.selftest.mjs`; dead (401).
   Not deleted: branches tied to the incident are subject to the evidence-citation
   check before any deletion.
3. `apps/services/api/src/auth/refresh.ts` signs with
   `process.env.JWT_SECRET ?? '<dev fallback>'` directly (line 206) instead of
   the guarded resolver `getJwtSecret()` in `jwt.ts`, which throws in
   production when `JWT_SECRET` is unset — although `jwt.ts`'s own comment says
   refresh.ts uses it. Low impact (verification goes through `getJwtSecret()`),
   but it is a second copy of the fallback outside the guard.
