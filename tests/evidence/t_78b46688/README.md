# QA-001g — Evidence Collection: CI artifact upload

**Card:** QA-001g · **Assignee:** qa · **Test type:** ci-validation
**Acceptance criterion:** CI artifacts (test reports, coverage, scan results) uploaded on every run.

## What changed

`.github/workflows/ci.yml` — wired `actions/upload-artifact@v4` into every job that produces a
machine-readable report, per TEST_STRATEGY §11. Uploads run under `if: always()` so the evidence is
retained even when the gate FAILS (the failing run's report is the one you most need).

| Job | Artifact uploaded | Retention |
|---|---|---|
| `unit` | `coverage/`, `**/junit.xml`, `test-results/*.xml` | 14 days |
| `integration` | `coverage/`, `**/junit.xml`, `test-results/*.xml` | 14 days |
| `e2e` | `playwright-report/` (HTML) + `test-results/` (traces/screenshots) | 14 days |
| `dependency-audit` | `audit-report.json` (pnpm audit `--json`) | 90 days |
| `secret-scan` | `trufflehog-report.json` (redacted) | 90 days |
| `sast` | `semgrep.sarif` (was already uploaded by QA-001d) | 90 days |
| `build` | `web-ext-artifacts/`, `**/web-ext-lint*.txt` | 14 days |

`if-no-files-found: warn` keeps the upload non-fatal during the monorepo bootstrap (reporters wired
but no suite has produced a report yet).

## Security-sensitive behavior (this card, not just plumbing)

Two decisions here are security gates, not cosmetic:

1. **Redaction of the secret-scan report.** `trufflehog --json` embeds the *raw* detected secret in
   `Raw`/`RawV2`/`SecretParts.key/.value`. Uploading that verbatim would re-publish the very secret
   the scan found (the repo currently holds a live leaked Telegram token — P0 t_0af5aa3e). The step
   now redacts those fields with `jq` to the literal `REDACTED` before upload. **Verified locally:**
   raw report has 2 occurrences of the live token; redacted report has 0, and the finding metadata
   (detector, verified flag, file/line) is preserved.
2. **Exit-code preservation.** `trufflehog --fail` exits 183 on a finding and `pnpm audit` exits
   non-zero on high/critical. Both are wrapped in `set +e … STATUS=$? … set -e … exit $STATUS` so the
   JSON report is flushed AND the gate still fails. A naive `|| true` (my first draft) would have
   silently disabled the audit gate — caught and fixed before commit.

## Validation evidence

- `actionlint` v1.7.12 on `.github/workflows/ci.yml`: **exit 0** (no findings).
- truffleHog redaction: raw `trufflehog-raw.json` → `jq` redact → 0 live-token occurrences, valid JSON.
- The `sast` job's SARIF upload already ran green in QA-001d's live CI (artifact 10496994554);
  the other upload steps are new and will produce their first artifacts once the monorepo bootstrap
  (`install-lockfile`) is unblocked by t_ee24fd37.

## Conditions / deferred

- The unit/integration/e2e/audit/build upload steps cannot produce a live artifact yet: those jobs
  are gated behind `install-lockfile`, which is blocked by the pre-existing bootstrap deadlock
  (t_ee24fd37 — workspace package.jsons/lockfile). The upload plumbing is correct and will fire as
  soon as that lands; `if-no-files-found: warn` keeps them non-fatal until then.
- JUnit/coverage *reporters* (vitest `--reporter=junit`, coverage) are QA-001e's scope; QA-001g only
  wired the upload of whatever those reporters emit (`**/junit.xml`, `coverage/`).

## Findings flagged to owning agents (not fixed here)

- **P1 — gitleaks-action@v2 runtime EOL.** `gitleaks/gitleaks-action@v2` runs on the Node 20
  runtime, which GitHub removed from hosted runners 2026-09-16 (action's own README). It still
  executed in today's run, but it will break imminently and silently disable the secret-scan gate.
  Fix is a drop-in `@v2 → @v3` (Node 24). Owned by QA-001d's scanner wiring — flagged, not patched
  (scope boundary).
