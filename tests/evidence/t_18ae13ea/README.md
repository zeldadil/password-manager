# QA-001d — Security Scanning Config: Evidence

**Task:** t_18ae13ea · QA-001d · `ci-validation`, `security`
**Date:** 2026-09-17
**Branch:** feature/t_18ae13ea (stacked on feature/t_5fe41426) · PR #12

Acceptance criterion (binding): SAST (CodeQL or Semgrep), dependency audit
(npm audit/OWASP), secret scan (gitleaks) wired into CI.

## 1. What was wired

| Scanner | Tool | CI job / step | Status |
|---|---|---|---|
| SAST | Semgrep (`p/security-audit`, `p/owasp-top-ten`) | `sast` job (added this card) | NEW |
| Dependency audit | `pnpm audit --prod --audit-level high` | `dependency-audit` job (QA-001b) | already present, verified |
| Secret scan | gitleaks (`gitleaks-action@v2`) | `secret-scan` job (QA-001b) | already present, verified |
| Secret scan (entropy) | truffleHog `3.97.5` | `secret-scan` job (added this card) | NEW |

Changes to `.github/workflows/ci.yml`:

1. Added a `sast` job — Semgrep in the `semgrep/semgrep` container, OWASP Top 10
   + security-audit rulesets, SARIF uploaded to GitHub code scanning and retained
   as a build artifact (feeds QA-001g).
2. Added a truffleHog step to `secret-scan` (entropy + verified-live detection),
   complementing gitleaks' pattern scan.
3. Removed `needs: [install-lockfile]` from `secret-scan`, and made `sast`
   independent of it. Rationale: secret/SAST scans do not need installed
   dependencies, and a gate that is *skipped* while the lockfile is out of sync
   hides real findings. `dependency-audit` keeps its `install-lockfile` gate
   because `pnpm audit` genuinely needs the resolved dependency graph.

## 2. Validation performed

| Check | Command | Result |
|---|---|---|
| Workflow lint | `actionlint v1.7.12 .github/workflows/ci.yml` | exit 0, no findings |
| Secret scan (gitleaks, local full-history) | `gitleaks v8.30.1 detect` | **1 finding** — see §3 |
| Secret scan (truffleHog, local full-history) | `trufflehog v3.97.5 git file://. --results=verified,unknown` | **1 verified finding** — see §3 |
| SAST (live CI) | GitHub Actions run 35222615679, job `sast` | **pass** — 690 rules, 17 files, 0 findings; SARIF (134 KB) uploaded to code scanning + artifact 10496994554 |
| Secret scan (live CI) | run 35222615679, job `secret-scan` | **fail** — truffleHog verified the leaked token (§3) |

Semgrep was not runnable locally (pip install blocked by the runtime's package
security scanner), so SAST is evidenced by the live GitHub Actions run.

### gitleaks vs truffleHog coverage (important nuance)

`gitleaks/gitleaks-action@v2` is **diff-aware**: it runs
`gitleaks detect ... <base>^..<head>` (only the PR's own commits), so it catches
*new* secrets a PR introduces but not pre-existing ones already in history. The
parent's `fetch-depth: 0` comment ("full history so committed secrets are
detected too") is therefore misleading for the gitleaks step.

The truffleHog step (`trufflehog git file://.`) scans the **full git history**
and verifies findings live, so it catches *pre-existing* leaks that are still
active. The two scanners are complementary: gitleaks = new-secret gate,
truffleHog = live-secret gate across history.

## 3. P0 security finding — live bot token in public git history

While validating the secret-scan wiring, both scanners independently detected a
committed Telegram bot API token. This is **not** a false positive: truffleHog
*verified* the token is live (Telegram `getMe` resolved the bot username
`AASLlmHermesBot`).

- **Rule:** `telegram-bot-api-token`
- **Location:** `PROJECT_BRIEF.md` line 87 (token value intentionally omitted here)
- **Introduced in:** commit `a503e4d` ("docs: ARC-001f — GitHub repo created")
- **Exposed in (≥14 commits, all branches, public repo):** `a503e4d`,
  `2f60212`, `4aa2058`, `8aa0dc3`, `9d18272`, `515491f`, `c9d9efa`, `60a4400`,
  `ac40fa4`, `ae92b3f`, `69e80b4`, `f9b8185`, `c4aeaea`, `908ebf0`
- **Redacted only in:** `b9f4e97` (branch `feature/t_f49d448c`, **not merged to master**)
- **Impact:** repo is public → token is world-readable and still valid. Anyone
  can drive the team's Telegram bot (read/send messages, impersonate status
  updates, exfiltrate channel content).

**Required remediation (AR-2 rotation rule — rotate, don't just delete):**

1. **Rotate the token NOW** via `@BotFather` → `/revoke` + `/token` (human action;
   updates the bot token for all 6 agent profiles' `.env`).
2. After rotation, purge the token from git history (`git filter-repo` +
   force-push all branches) *and/or* document it as a dead rotated credential.
   Purging is preferred since the repo is public.
3. Update `PROJECT_BRIEF.md` §9 to reference the token by placeholder only
   (owner: `product`), and ensure no `.env`/`config.yaml` with a real token is
   ever committed.
4. Add a gitleaks/truffleHog allowlist entry **only after rotation** if a
   residual historical match remains, with QA + Architect sign-off
   (TEST_STRATEGY §12.2 forbids undocumented exclusions).

Note: once the token is rotated (dead), the truffleHog step — which reports only
`verified,unknown` results — will stop flagging it, so the `secret-scan` gate
goes green without needing a history purge. Purging remains recommended hygiene
for a public repo, but rotation is the security-critical step.

The `secret-scan` job is **expected red** until step 1 lands; that is the gate
working as designed. No allowlist was added in this card — masking a live secret
would be wrong.

## 4. Verdict

`pass-with-conditions`. All three mandated scanners are wired into CI, the
workflow passes actionlint, and the `sast` job ran green in CI (SARIF uploaded to
code scanning + artifact). The secret-scan wiring is proven effective — it caught
a real, live leaked token. The residual `secret-scan` red is the P0 incident in
§3 (token rotation), not this card.
