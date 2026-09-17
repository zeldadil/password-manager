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

- **P1 — gitleaks-action@v2 runtime deprecation.** The secret-scan live run emits:
  `Node.js 20 is deprecated. The following actions target Node.js 20 but are being forced to run on
  Node.js 24: actions/checkout@v4, actions/upload-artifact@v4, gitleaks/gitleaks-action@v2`.
  GitHub's own timeline (action README + changelog) removes the Node 20 runtime from hosted runners;
  today the runner force-runs these on Node 24 with a warning, but this is a deprecation that will
  become a hard break. Migrating `gitleaks-action@v2 → @v3` (Node 24) is a drop-in fix. Owned by
  QA-001d's scanner wiring — flagged, not patched (scope boundary).

## Live CI validation (workflow_dispatch run 35233831094)

- `sast` job: green — Semgrep ran, SARIF uploaded to code scanning AND retained as artifact
  (upload-artifact step succeeded).
- `secret-scan` job: red (correct — the leaked token is still live, P0 t_0af5aa3e). gitleaks found
  2 leaks (exit-code 2). truffleHog step was skipped on the first run because gitleaks failed first —
  **caught and fixed**: truffleHog now has `if: always()` so both scanners always emit their report.
  The uploaded `secret-scan-report` artifact was downloaded and inspected: **0 occurrences of the live
  token**, 2 findings each with `Raw`/`RawV2`/`SecretParts.key/.value` = `REDACTED`, metadata
  (DetectorName, Verified:true, file/line) preserved.
- Artifacts actually present on the run: `gitleaks-results.sarif` (8.5 KB, gitleaks action), 
  `semgrep-sarif` (134 KB), `secret-scan-report` (764 B, redacted) — three independent evidence streams
  on a single run.
- `install-lockfile` and its six downstream jobs: skipped (pre-existing bootstrap deadlock t_ee24fd37).
  The upload steps for those jobs are wired and non-fatal, and will produce their first artifacts once
  the bootstrap lands.
- PR #15 (feature/t_78b46688 → master) is OPEN. Its `pull_request`-event CI did not fire because the PR
  is a stacked QA branch (merges QA-001c + QA-001d, both still open) and GitHub reports
  `mergeable_state: dirty` with no merge commit — so the workflow only runs via `workflow_dispatch`
  until the stack resolves. Artifact upload was validated on the dispatch run instead.


