# TEST_STRATEGY.md — Secure Password Manager

**Maintained by:** `qa` · **Consumed by:** `architect`, `backend`, `frontend`, `browser`, `docs`
**Status:** Proposed — pending Architect review
**Task:** QA-001a (`t_ac6a1f3f`) · **Last updated:** 2026-09-17

---

## 1. Purpose, Scope, Authority

This document is the **single source of truth for how quality is verified** in the Secure Password Manager
project. It defines the test levels, the tools, the coverage targets, the mandatory negative tests, the synthetic
data policy, the CI gates, and the evidence/sign-off rules that every other task on the board is measured against.

It is derived from — and must stay consistent with — the project's ratified security and architecture decisions:

| Source | What this strategy takes from it |
|---|---|
| `architecture/adr/SEC-001-threat-model.md` | 7 threat vectors (V1–V7), 9 crypto decisions, **Absolute Rules AR-1 … AR-6** |
| `architecture/adr/ADR-002-overall-architecture.md` | Monorepo layout, service boundaries, `packages/crypto/` isolation rule, extension bridge contract |
| `architecture/adr/ADR-003-data-model.md` | Entity model, ownership, centralized authorization |
| `architecture/adr/ADR-004-api-contract.yaml` | API surface that integration/negative tests assert against |
| `architecture/adr/ADR-005-extension-bridge-protocol.md` | Bridge message types, origin validation rules, permission model, autofill flow + its negative constraints |
| `PROJECT_BRIEF.md` | Product scope, roadmap, test-relevant ratified decisions |
| `architecture/kanban/backlog.md` | Task-level acceptance criteria, `Test Types` tags, QA dependency graph |

**Scope.** Three runtime units plus the shared layers:

- `apps/web/` — React Web UI (Vite)
- `apps/services/api/` — Node/TypeScript API
- `apps/browser-firefox/` — Firefox MV3 WebExtension
- `packages/shared/` — shared contracts (entities, bridge messages, validation)
- `packages/crypto/` — the isolated crypto boundary (created by the first crypto task; see §15)

**Out of scope of this document (owning tasks named):** CI *wiring* of the checks defined here (QA-001b), Playwright
browser-matrix *configuration* (QA-001c), SAST/dependency/secret-scan *configuration* (QA-001d), fixture and
threshold *implementation* (QA-001e), the negative-test *checklist artifact* (QA-001f), artifact *upload* plumbing
(QA-001g), board-level *enforcement* of the sign-off gate (QA-001h). This strategy specifies **what** those tasks
must implement and **what evidence** they must produce.

**Authority.** Where this document and a task body disagree on a *quality bar*, the task body wins and this document
is corrected. Where this document and SEC-001 disagree on a *security control*, SEC-001 wins. Deviations from any
mandatory item in this document require an ADR section or an explicit Architect + QA sign-off recorded on the Kanban
card.

---

## 2. Test-Type Vocabulary (board alignment)

Every Kanban card in `backlog.md` carries a `Test Types:` label. That label defines what "verified" means for the
card. The mapping below is normative — a card's evidence must match its declared type.

| Test type (board label) | Level | Primary tool | Required evidence artifact |
|---|---|---|---|
| `unit` | Unit | Vitest | Test report (JUnit XML) + coverage summary |
| `integration` | Integration | Vitest + real SQLite/crypto | Test report + DB/migration log |
| `e2e` | E2E | Playwright | HTML report + traces/screenshots on failure |
| `security` | Security | Vitest property tests + scanners | Test report + scanner output (gitleaks/Semgrep/audit JSON) |
| `security-review` | Security | Manual review against SEC-001 AR-1…AR-6 | Signed review note on the card |
| `threat-model-validation` | Security | Manual + automated vector mapping | Vector→test mapping table |
| `regression` | Regression | Playwright + Vitest tag `@regression` | Regression run report (100% pass) |
| `ci-validation` | CI | GitHub Actions | Run URL + job status table + uploaded artifacts |
| `doc-validation` | Doc | `scripts/qa/validate-docs.mjs` (or equivalent) | Validator stdout + exit code attached to the card |
| `repo-structure-validation` | Meta | Path/layout assertions script | Validator stdout |
| `manifest-validation` | Meta | `web-ext lint` + permission diff | `web-ext lint` output + permission table |
| `setup-reproducibility` | Meta | Clean-clone install/build/run script | Transcript of the clean-clone run |
| `a11y` | Unit/E2E | axe-core (+ Playwright for HTMLCS) | Violation report (zero violations) |
| `meta` | Meta | Reviewer checklist | Completed checklist on the card |
| `architecture-review` | Review | Reviewer against ADR set | Signed review note on the card |

**Rule:** a card may not be marked `done` on a claim alone — the evidence artifact named for its test type must be
attached (see §11, §12).

---

## 3. Test Levels

### 3.1 Unit

**Definition:** one function, class, module, or component in isolation; all I/O and dependencies mocked. No network,
no disk, no DB, no real crypto primitive invocation (the `packages/crypto/` boundary is mocked, so unit tests never
depend on library availability).

| Target | Location | Examples |
|---|---|---|
| Pure logic (validation, serialization, transformation) | `packages/shared/**`, `apps/*/src/**` | Entity schema validation, message type guards, permission-mask logic, URL matching/selector helpers, password-generator logic |
| Crypto wrappers | `packages/crypto/src/**/*.test.ts` | KDF parameter validation, nonce-length checks, key-wrapping glue, error mapping (with the primitive mocked) |
| React logic (no DOM rendering) | `apps/web/src/**/*.test.ts(x)` | Reducers, selectors, hooks, form-validation logic |
| Extension background logic | `apps/browser-firefox/src/background/**/*.test.ts` | Message dispatch, lock-state machine, vault-key lifecycle, origin-check predicate |
| Content-script logic | `apps/browser-firefox/src/content/**/*.test.ts` | Login-form detection, field-selector resolution, icon-injection decisions |

**Tools:** Vitest, `@testing-library/react` (logic-level rendering only), `msw` for HTTP at the client seam.

**Isolation rules:** no real crypto primitive; no real network; `jsdom` only where component rendering is exercised;
no filesystem/DB — in-memory fakes only.

**Command:** `pnpm test:unit` · **CI:** required check `unit` on every PR.

### 3.2 Integration

**Definition:** two or more real components wired together — real HTTP server, real DB engine, real crypto library —
but no browser or extension runtime.

| Target | Location | Examples |
|---|---|---|
| API routes + DB + crypto | `apps/services/api/**/__tests__/` | Registration → KDF → vault-key storage; unlock/lock; resource CRUD; folder/tag CRUD; permission enforcement; search |
| Crypto primitives (real library, real params) | `packages/crypto/**/__tests__/` | Argon2id derive with stored params, AES-256-GCM encrypt/decrypt round-trip, tag verification, nonce uniqueness, key wrap/unwrap |
| Shared contracts | `packages/shared/**/__tests__/` | Bridge message round-trip, unknown-type silent drop, API envelope serialization, validation error shapes |
| Web API client | `apps/web/**/__tests__/` | Typed fetch wrapper, JWT/refresh handling, error mapping, lock-state propagation |
| API contract conformance | `apps/services/api/**/__tests__/contract/` | Request/response shapes vs. `ADR-004-api-contract.yaml` (schema-level assertions) |
| Migration up/down | `apps/services/api/**/__tests__/migration/` | AR-5: apply → verify → revert → verify, no data loss |

**Tools:** Vitest, real SQLite via Drizzle (`:memory:` per test file; file-based where a restart is simulated), real
`argon2`/`node:crypto` binding, `msw` for outbound-only services.

**DB strategy:** fresh in-memory DB per test file; migrations applied in `beforeAll`; no shared state across files;
no reliance on execution order.

**Command:** `pnpm test:integration` · **CI:** required check `integration` on every PR.

### 3.3 Security

**Definition:** automated, repeatable assertions of the security properties SEC-001 mandates. These are **not**
penetration tests — they are the codified controls that the threat model claims exist, each with at least one test
that fails if the control is removed (see §6).

#### 3.3.1 Crypto property tests (AR-3 — mandatory, hard gate)

Every change touching crypto-path code (KDF, AEAD, key handling, nonce generation, tag verification, lock/unlock,
recovery, backup, bridge) must ship with:

1. **Positive test** — correct password/ciphertext → correct plaintext.
2. **Negative tests, one per failure mode** — wrong password, tampered ciphertext (bit-flip), corrupted/truncated
   tag, wrong nonce, truncated ciphertext, wrong AAD (resource-ID mismatch), wrong key, wrong format version.
   Each asserts: operation fails, **generic** error (no crypto detail), **no plaintext** in the return value or the
   error object, and **no state mutation**.

**Location:** `tests/security/crypto-property.test.ts` (+ per-primitive tests in `packages/crypto/`).
**Command:** `pnpm test:security:crypto` · **Gate:** blocks merge on any missing negative case for changed crypto code.

#### 3.3.2 Leakage scans (AR-2 — mandatory, hard gate)

| Control | Tool | Where it fails the build |
|---|---|---|
| Real secrets in the working tree / staged files / history | `gitleaks` (+ `truffleHog` for entropy) | `pnpm scan:secrets` |
| Secret-bearing log/error paths | ESLint rule banning `console.*` in production code paths; structured-logger redaction test asserting `password`, `secret`, `token`, `key`, `salt`, `iv`, `tag`, `ciphertext` are redacted | `pnpm lint` + `pnpm test:security:leakage` |
| Direct crypto imports outside the boundary | ESLint `no-restricted-imports` for `node:crypto`, `crypto.subtle`, crypto libraries — only `packages/crypto/**` may import them | `pnpm lint` |
| Secrets in URLs | Route test asserting no auth/secret value appears in query strings or path segments | `pnpm test:security:leakage` |
| SAST | Semgrep (default + security rulesets) or CodeQL, wired by QA-001d | CI job `sast` |
| Dependencies | `pnpm audit --prod --audit-level high` (fails on high/critical), SBOM via CycloneDX | `pnpm audit` |

#### 3.3.3 Threat-vector coverage (V1–V7)

Each vector in SEC-001 must have at least one automated test asserting the documented control; the mapping is kept in
`tests/security/vectors/README.md` (vector → test file → assertion).

| Vector | Assertion the suite must contain |
|---|---|
| **V1** Local file/backup access | DB file permissions test; no plaintext in any on-disk artifact; backup archive is encrypted and its integrity check detects corruption |
| **V2** Partial API compromise | Permission enforcement on every endpoint (read/update/owner matrix); metadata-encryption opt-in honored; JWT lifetime ≤ 15m; error handler strips stack traces in production mode |
| **V3** Hostile extension / malicious page | Manifest permission audit (no `<all_urls>`, only `activeTab`/`scripting`/`storage`/API host); CSP header test; origin validation on both bridge sides; **no autofill without explicit user action** |
| **V4** Leakage via logs/errors/URLs/telemetry | Redaction tests per §3.3.2; no telemetry/analytics calls in the bundle (import scan) |
| **V5** Stolen device / unlocked session | Auto-lock default 15m enforced; manual lock clears vault key and UI state; no plaintext secret in `localStorage`/`IndexedDB`/`storage.local` |
| **V6** Forgotten master password | No server-side recovery path exists (negative test: reset without recovery material is impossible); registration warning rendered; vault key is wrap-able under a recovery key |
| **V7** Corrupted backup / failed migration | Backup integrity check fails closed on corruption; migration up→verify→down cycle (AR-5); vault format version tag present; no in-place destructive overwrite |

**Command:** `pnpm test:security` (crypto + leakage + vectors) · **CI:** PR gate for changed-crypto/secret paths;
nightly and release-branch gate for the full vector set.

#### 3.3.4 Extension-specific security tests

- Manifest validation: `web-ext lint` clean; permission list matches ADR-005 §4.1 exactly (a diff test fails if a
  permission is added without an ADR update).
- Bridge negative tests (every message type in ADR-005 §2.1): wrong origin, unknown type, malformed payload,
  missing/extra fields, replayed message, oversized payload — each must be dropped silently **without** logging the
  rejected origin (ADR-005 §3.1).
- Bridge content test: no bridge message may carry the master password, vault key, or ciphertext (ADR-005 §6) —
  enforced by a static scan of message payload construction plus a runtime assertion in the bridge tests.
- Content-script confinement: content scripts must contain no crypto API usage and never receive the vault key or a
  full secret object (only `{username, password}`).

### 3.4 End-to-End (E2E)

**Definition:** complete user flows through the full stack in a real browser.

**Tools:** Playwright. Browser matrix (per QA-001c): **Chromium, Firefox, WebKit**; plus a dedicated Firefox
MV3-extension project (`playwright-firefox` with the extension loaded from `apps/browser-firefox/dist`).

**Environments:** ephemeral per-run API + fresh DB + built web bundle (production mode, not dev server) so CSP and
header behavior are exercised realistically.

#### 3.4.1 Web UI critical flows

| ID | Flow | Priority |
|---|---|---|
| E2E-WEB-001 | Register → unlock → create resource → reveal secret → lock → unlock → secret persists | P0 |
| E2E-WEB-002 | Folder create/move/delete with permission propagation | P0 |
| E2E-WEB-003 | Tag create/assign/filter/search | P1 |
| E2E-WEB-004 | Generator → create resource with generated password | P1 |
| E2E-WEB-005 | Search across resources/folders/tags | P1 |
| E2E-WEB-006 | Auto-lock after configured inactivity | P0 |
| E2E-WEB-007 | Manual lock clears UI state and returns to unlock | P0 |
| E2E-WEB-008 | Refresh-token rotation keeps session without re-entering master password (within window) | P1 |
| E2E-WEB-009 | Wrong password → generic error, no lockout/account-state leak | P0 |
| E2E-WEB-010 | Protected deep-link while locked → redirected to unlock, target preserved | P0 |
| E2E-WEB-011 | Import/export (architecture-prepared path) | P2 |

#### 3.4.2 Extension critical flows

| ID | Flow | Priority |
|---|---|---|
| E2E-EXT-001 | Extension loads, announces itself, receives lock-state sync | P0 |
| E2E-EXT-002 | Web locks → extension state becomes locked | P0 |
| E2E-EXT-003 | Extension locks → web shows locked | P0 |
| E2E-EXT-004 | Content script detects login form and injects the icon on user trigger | P0 |
| E2E-EXT-005 | Click icon → popup lists matching resources → select → form filled | P0 |
| E2E-EXT-006 | **No** automatic fill on page load, on navigation, or on form detection | P0 |
| E2E-EXT-007 | Extension fetches encrypted data with its own JWT session (bridge is not an auth channel) | P1 |
| E2E-EXT-008 | Vault key cleared on lock / extension reload / browser sleep — autofill then requires unlock | P0 |
| E2E-EXT-009 | Malicious page (different origin) cannot trigger autofill or inject a bridge message | P0 |
| E2E-EXT-010 | Extension cannot fetch from non-API domains (no `<all_urls>`) | P1 |
| E2E-EXT-011 | Fallback `SameSite=Strict; Secure; HttpOnly` cookie path still yields correct lock state | P2 |

#### 3.4.3 Cross-app flows

| ID | Flow | Priority |
|---|---|---|
| E2E-CROSS-001 | Web unlock → extension autofill works without re-unlock | P0 |
| E2E-CROSS-002 | Extension unlock → web reflects unlocked state | P0 |
| E2E-CROSS-003 | Web creates resource → extension search finds it immediately | P1 |

**Command:** `pnpm test:e2e` (per-project selection via `--project`). **Gate:** all **P0** flows must pass on the
release candidate; the full suite runs nightly and on release branches.

### 3.5 Exploratory

**Definition:** time-boxed, unscripted sessions run by QA to find what the scripted suite cannot anticipate.

**Cadence:** one 2-hour session per sprint, plus an ad-hoc session after any merge to a crypto/bridge/auth path.

**Charter rotation (by risk, aligned with the roadmap):**

| Session | Charter |
|---|---|
| 1 | Registration/unlock edge cases (empty, unicode, very long, leading/trailing whitespace, paste behavior) |
| 2 | Folder/tag/permission edge cases (nested moves, cyclic references, orphaned resources, permission downgrade with open session) |
| 3 | Extension autofill on hostile DOMs (SPA route changes, shadow DOM, iframes, hidden fields, multiple forms) |
| 4 | Search edge cases (special characters, unicode, very long queries, no results, encrypted-metadata interaction) |
| 5 | Lock/unlock race conditions (rapid toggling, network partition during unlock, two sessions, background tab) |
| 6 | Recovery-kit flow (when implemented) |
| 7 | Backup/restore and vault-format versioning (when implemented) |
| 8 | Migration/upgrade scenarios (when implemented) |

**Output:** `tests/exploratory/EXPLORATORY-SESSION-<YYYY-MM-DD>.md` containing charter, environment, observations,
defects raised (with card IDs), risk assessment, and follow-ups. Findings that are P0/P1 are raised as cards the same
day. (Location follows ADR-002 §2.1, which sanctions `tests/` for test artifacts; `docs/` stays user/developer docs.)

### 3.6 Regression

**Definition:** the fixed, re-runnable suite that runs against every release candidate and every merge to `master`.

**Composition:** all P0 E2E flows (web + extension + cross-app) · all crypto property and vector tests · all leakage
and secret scans · unit/integration tests tagged `@regression` (every bug-fix PR adds one).

**Rule:** a bug fix is not complete until it ships a regression test that failed before the fix (verified by running
it against the parent commit in a `spike`-style check, evidence attached). Tests tagged `@regression` are never
deleted without a documented reason (code path removed by an ADR).

**Command:** `pnpm test:regression` · **Gate:** 100% pass before a release tag; nightly on `master`.

---

## 4. Tools

| Category | Tool | Version policy | Purpose |
|---|---|---|---|
| Unit/integration runner | Vitest | latest 2.x, pinned in lockfile | ESM/TS-native test runner |
| Component logic | `@testing-library/react` | 16.x | Reducer/hook/component logic |
| HTTP mocking | `msw` | 2.x | Client-seam mocking |
| E2E | Playwright | current stable, pinned | Chromium/Firefox/WebKit + extension project |
| Extension E2E | `playwright-firefox` + MV3 build | — | Loads the real extension |
| Extension lint | `web-ext lint` (Mozilla) | current stable | Manifest/permission/API validation |
| Unit coverage | v8 via Vitest | built-in | Coverage gates |
| Secret scanning | `gitleaks` (+ `truffleHog`) | 8.x / 3.x | AR-2 enforcement |
| SAST | Semgrep (or CodeQL) | current stable | Source-level security patterns (QA-001d) |
| Dependency audit | `pnpm audit --prod` | built-in | Vulnerable production deps |
| SBOM | CycloneDX | current stable | Supply-chain inventory |
| a11y | axe-core (via Playwright) | current stable | FE-001k gate |
| Mutation testing | Stryker | Phase 3 | Test-suite strength on the crypto boundary |
| Doc validation | `scripts/qa/validate-docs.mjs` | in-repo | Validates this document (§14) |

**Version pinning rule:** every tool above must be pinned in `package.json`/lockfile; CI installs from the lockfile
(`install-lockfile` job) and fails on drift. Tool upgrades are their own PR with a full re-run of the suite.

---

## 5. Coverage Targets

Two tiers, deliberately separated so nothing is ambiguous:

**Tier A — CI-enforced minimum (mandated by backlog QA-001e; hard failure if below):**

| Scope | Line | Branch |
|---|---|---|
| Unit (`packages/shared`, `apps/*/src` excluding bootstrap) | ≥ 80% | ≥ 70% |
| Integration (API routes, DB layer) | ≥ 70% | ≥ 60% |
| Critical paths — `auth`, `vault`, `crypto`, permissions | ≥ 90% | ≥ 85% |

**Tier B — project target (aspirational; a downward move needs an Architect+QA note on the card):**

| Scope | Line | Branch |
|---|---|---|
| Unit | ≥ 90% | ≥ 85% |
| Integration | ≥ 85% | ≥ 80% |
| Crypto boundary (`packages/crypto/**`) | **100%** on changed lines | **100%** on changed lines |

**Hard rules (not negotiable by coverage math):**

1. `packages/crypto/**` — every changed line must be covered by a test in the same PR (Tier B rule; the crypto
   boundary is the one place where "good enough" coverage is not acceptable). Uncovered changed line = merge blocked.
2. **Negative-test density (AR-3):** each crypto failure mode has its own test case — coverage percentage never
   substitutes for a missing failure-mode case.
3. **Vector coverage (SEC-001):** 100% of V1–V7 have at least one automated assertion; a vector with no test is a
   build failure regardless of coverage numbers.
4. **P0 flow coverage:** 100% of P0 E2E flows exist and pass on the release candidate.

**Exclusions (must be declared in `vitest.config.ts`, never implied):** app bootstrap/entry files, generated types
(`*.d.ts`), type-only modules, test fixtures, and Drizzle-generated migration SQL (covered instead by the up/down
migration test in §3.2). Any new exclusion requires a comment naming the reason.

**Reporting:** coverage reports (text + lcov + HTML) are uploaded per run; the PR gate fails on Tier A regressions.
Ratchet rule: a PR may not *lower* Tier B coverage of the files it touches.

---

## 6. Negative Test Requirements

**Principle:** every positive assertion needs a matching negative assertion that proves the system **fails safely,
generically, and without side effects**. A negative test that only asserts "it threw" is not acceptable.

### 6.1 What every negative test must assert

1. **Correct failure semantics** — exact error code/HTTP status from ADR-004 (or the documented error shape).
2. **Generic message** — no cryptographic detail, no stack trace, no existence oracle.
3. **No secret leakage** — the response/log must not contain `password`, `secret`, `token`, `key`, `vaultKey`,
   `salt`, `iv`, `tag`, `ciphertext`, `plaintext`, or any hex/base64 blob that could be secret material.
4. **No side effects** — a failed operation must not mutate DB state, session state, or in-memory key material
   (asserted by before/after snapshots).
5. **Vector reference** — the test names the SEC-001 vector it defends (or `n/a — general robustness`).

### 6.2 Mandatory categories

**A. Crypto (AR-3, per change):** wrong password · tampered ciphertext (single-bit flip) · corrupted tag ·
truncated tag · wrong nonce · truncated ciphertext · wrong AAD/resource binding · wrong key · wrong format version ·
nonce reuse detection.

**B. API (per endpoint):** missing/expired/malformed/revoked JWT · another user's resource (ownership) · insufficient
permission level (read vs update vs owner) · deleted resource · missing/invalid/oversized fields · wrong types ·
out-of-range values · injection payloads (SQL, NoSQL, template, XSS) · duplicate/conflicting business state ·
concurrent update conflict · encrypted-payload tampering · pagination/search abuse (huge limit, negative offset).

**C. Bridge (per message type in ADR-005 §2.1):** wrong origin · unknown type · malformed envelope · missing field ·
extra/unexpected field · oversized payload · replayed message · secret-bearing payload (must never occur) ·
content-script message with a non-web origin.

**D. Extension runtime:** no autofill without user action · no fill on page load · no fill on non-login forms ·
no vault key or secret object reaching a content script · no vault key in `storage.local` · permissions unchanged
without ADR update · CSP violation attempt blocked.

**E. Web UI:** empty/invalid form input · XSS payload in every free-text field · deep-link to protected route while
locked · action submitted while API is down/timeouts → no partial state · lock during in-flight request → no
plaintext left in state · back/forward navigation after lock.

**F. Migration/backup (AR-5):** migration failure partway → rollback leaves data readable · down-script restores
previous schema/format · corrupted backup archive → integrity check fails closed · version-tag mismatch → clear,
non-destructive error.

### 6.3 Delivery rule

Negative tests are part of the PR that introduces the behavior — never deferred to a later card. For every endpoint
or message type, the count of negative cases must be ≥ the count of documented failure modes; the reviewer's job is
to check that enumeration, not the raw test count. The consolidated checklist artifact for this section is QA-001f
(`tests/security/NEGATIVE_TEST_CHECKLIST.md`), which must enumerate every case above with its owning test path.

---

## 7. Synthetic Data Policy (AR-4)

**Absolute rule:** no real credential, secret, URL, username, or key material may exist anywhere in this repository
or in any test run — not in fixtures, not in seeds, not in E2E data, not in mock responses, not in snapshots.

**Allowed (synthetic, clearly fake):**

| Category | Pattern |
|---|---|
| Resource names | `test-resource-1`, `login-example`, `db-test-account` |
| Usernames | `testuser`, `user-a@example.test`, `ci-bot` |
| URLs | `https://example.test`, `https://app.example.test/login` (reserved TLDs only: `.test`, `.invalid`, `.example`) |
| Tags/folders | `test`, `integration`, `Fixture Folder`, `Nested/Subfolder` |
| Secrets | generated per run (`crypto.randomUUID()`-derived, `test-secret-<random>`) — never a human-chosen password |
| UUIDs/timestamps | generated / fixed synthetic constants (`2026-01-01T00:00:00.000Z`) |
| Crypto material | RFC test vectors only (e.g. TOTP `JBSWY3DPEHPK3PXP`), cited inline with the RFC number |
| Master passwords | per-test random value, never a dictionary word or a memorized string |

**Forbidden:** real domains (`github.com`, `amazonaws.com`, company domains) · real usernames/emails · real
resource names that map to a real service · any base64/hex blob that could be real key material · real PII ·
human-memorized passwords (`password123`, `correct-horse-battery-staple`) · production vault exports of any kind.

**Generation:** fixtures are TypeScript factory functions with a **fixed seed** for determinism
(`@faker-js/faker` with `faker.seed(<constant>)`); `tests/fixtures/` contains code only — never `.json`/`.csv` data
dumps. E2E users are created through the real registration API, never by direct DB insert, and are removed after the
run.

**Test-secret hygiene:** generated test secrets live in memory for the duration of the test only; they are never
written to disk, never logged (log redaction applies to tests too), and never committed in a snapshot/report.

**Enforcement (implemented by QA-001e, gated by QA-001d):**

- `pnpm scan:test-data` — pre-commit + CI check for forbidden patterns (real TLDs, dictionary passwords, committed
  base64 blobs, PII patterns) across `tests/`, fixtures, snapshots, and E2E specs.
- `gitleaks`/`truffleHog` cover the same ground for anything that looks like a real secret (§3.3.2).
- Reviewer checklist item on every PR touching tests.

---

## 8. Test Organization

Aligned with ADR-002 §2.1 (`tests/` at the monorepo root; `docs/` stays user/developer documentation):

```
tests/
├── unit/                  # cross-cutting unit suites (app-local __tests__ live next to source)
├── integration/           # cross-app integration (API+DB+crypto, contracts, migrations)
├── e2e/
│   ├── web/
│   ├── extension/
│   └── cross-app/
├── security/
│   ├── crypto-property.test.ts
│   ├── leakage.test.ts
│   ├── vectors/           # V1–V7 suites + README.md mapping table
│   ├── bridge.test.ts
│   └── NEGATIVE_TEST_CHECKLIST.md      # QA-001f deliverable
├── exploratory/
│   └── EXPLORATORY-SESSION-<date>.md
├── regression/
│   └── registry.json      # bug ID → regression test path
├── evidence/
│   └── <task-id>/         # evidence artifacts referenced by Kanban verdicts (§11)
└── fixtures/              # synthetic factories ONLY (no data files)
```

App-local `__tests__/` directories are allowed only for suites tightly coupled to that app's implementation
(component logic, route handlers). Everything that crosses a boundary belongs under `tests/`.

---

## 9. Test Data and Environment Management

| Concern | Unit | Integration | E2E |
|---|---|---|---|
| Database | none (in-memory fakes) | SQLite `:memory:` per file | SQLite file per worker, fresh per run |
| Users | n/a | factory-created rows | created via public registration API |
| Crypto | primitive mocked | real library, real params | real library through the app |
| Network | mocked | local server, mocked outbound | real local server, outbound blocked |
| Cleanup | automatic | per-file teardown | per-worker teardown; no cross-test state |
| Parallelism | full | per-file isolation | workers isolated by DB file + port |

**Ports/artifacts:** E2E uses ephemeral ports; artifacts (traces, videos, screenshots, reports) are written under
`test-results/<run-id>/` and uploaded by CI (§11). Local runs may keep artifacts; CI always uploads and retains for
14 days (release candidates: 90 days).

**Environment variables:** test runs use only synthetic values; deployed environments must never contain test
credentials. A committed `.env*` file is a secret-scan failure by definition.

---

## 10. CI/CD Integration

The pipeline **order is fixed by backlog QA-001b**; each job blocks merge on failure:

```
install-lockfile → lint-typecheck → unit → integration → e2e → dependency-audit → secret-scan → build
```

| Job | Command | Blocks | Notes |
|---|---|---|---|
| `install-lockfile` | `pnpm install --frozen-lockfile` | PR | Fails on lockfile drift |
| `lint-typecheck` | `pnpm lint && pnpm typecheck` | PR | Includes the no-console / crypto-import restrictions |
| `unit` | `pnpm test:unit` + coverage gate | PR | Tier A thresholds enforced |
| `integration` | `pnpm test:integration` | PR | Includes migration up/down and contract tests |
| `e2e` | `pnpm test:e2e` | PR | Smoke subset on PR; full matrix (Chromium/Firefox/WebKit + extension) nightly/release |
| `dependency-audit` | `pnpm audit --prod --audit-level high` | PR | High/critical fails; full audit nightly |
| `secret-scan` | `pnpm scan:secrets` (gitleaks + truffleHog) | PR | Fails on any detection (AR-2) |
| `build` | `pnpm build` (all workspaces) | PR | Includes `web-ext lint` for the extension |
| `sast` | Semgrep/CodeQL (QA-001d) | PR | Advisory → enforcing once baseline is clean |
| `security-tests` | `pnpm test:security` | PR when crypto/secret paths change; nightly otherwise | AR-3 + vectors |
| `regression` | `pnpm test:regression` | Release tag | 100% pass |
| `a11y` | axe-core suite (FE-001k) | PR for web changes | Zero violations |

Branch protection on `master` already registers `lint`, `typecheck`, `unit`, `integration`, `secret-scan` as required
checks (ARC-001f); the remaining jobs become required as their workflows land (QA-001b onward), and any new required
check is added to branch protection in the same PR that adds the job.

**Flake policy:** a test that fails intermittently is a **P1 defect**, not a retry candidate. It is quarantined
(`@quarantine` tag + card raised within one business day) and may not be silently retried in CI; quarantine is capped
at one sprint, after which the test is fixed or deleted with recorded justification.

---

## 11. Evidence Collection (QA-001g)

Every test type in §2 produces a machine-readable artifact. QA-001g owns the upload plumbing; this section fixes
**what** must exist and **where** it is referenced.

| Artifact | Produced by | Retention |
|---|---|---|
| JUnit XML per suite | Vitest (`--reporter=junit`) | 14 days (RC: 90) |
| Coverage report (text + lcov + HTML) | Vitest coverage | 14 days (RC: 90) |
| Playwright HTML report + traces/screenshots on failure | Playwright | 14 days (RC: 90) |
| gitleaks/truffleHog JSON | `scan:secrets` | 90 days |
| Semgrep/CodeQL SARIF | `sast` | 90 days |
| `pnpm audit` JSON + SBOM | audit job | 90 days |
| `web-ext lint` output | build job | 14 days |
| Doc/structure validator stdout | `scripts/qa/validate-docs.mjs` etc. | 90 days |
| Manual evidence (exploratory reports, review notes, permission diffs) | QA reviewer | Commit to `tests/evidence/<task-id>/` |

**Rule:** a Kanban verdict must name at least one artifact (CI run URL and/or a committed file under
`tests/evidence/<task-id>/`). "Tests pass" without an artifact is not evidence and the card is returned.

---

## 12. QA Verdict and Sign-off Gate (QA-001h)

**Board rule (enforced by QA-001h):** no task reaches `done` without a QA verdict and attached evidence.

| Card type | Required before `done` |
|---|---|
| Any implementation card | Its declared `Test Types` evidence + QA verdict comment on the card |
| Crypto / bridge / auth card | Above **plus** AR-6 review: explicit Architect **and** QA sign-off recorded on the card |
| Release track | The §12.2 checklist complete, signed by QA |
| QA's own artifact cards (this one included) | Self-validation evidence + Architect review where the card demands it |

**Verdict vocabulary:** `pass` (evidence attached) · `pass-with-conditions` (conditions enumerated, follow-up cards
created) · `fail` (defect cards created, card returned to the owning agent) · `blocked` (reason + what is needed).

### 12.1 Review obligations per change type

- **Every PR:** unit + integration tests for new/changed behavior.
- **Crypto PRs:** AR-3 positive + per-failure-mode negative tests (CI gate) + AR-6 sign-off.
- **API PRs:** negative tests per §6.2-B; ADR-004 conformance for any changed shape.
- **Extension/bridge PRs:** §6.2-C/D negative tests; permission diff; no-autofill-on-load test.
- **Test-only PRs:** synthetic-data policy check (§7).

### 12.2 Release sign-off checklist

- [ ] All Tier A coverage thresholds met (and no Tier B ratchet regression)
- [ ] All P0 E2E flows pass on Chromium, Firefox, WebKit + extension project
- [ ] Full security suite passes (AR-3 suite, leakage, V1–V7 vectors, bridge negatives)
- [ ] Secret scan clean (no findings, no exclusions added without QA+Architect approval)
- [ ] Dependency audit clean (no high/critical)
- [ ] Regression suite 100% pass; zero open quarantined tests past their sprint
- [ ] No open P0/P1 defects
- [ ] Migration up/down verified for every migration in the release
- [ ] Exploratory session for the sprint completed and its P0/P1 findings resolved
- [ ] Evidence bundle attached to the release card

Sign-off is recorded in the GitHub release notes **and** as a Kanban comment on the release card.

---

## 13. Defect Classification and SLAs

| Severity | Definition | Examples | SLA from detection |
|---|---|---|---|
| **P0 Critical** | Secret exposure, auth/permission bypass, crypto failure, data loss | plaintext secret in a log, vault key in `storage.local`, tag verification bypassed, autofill without user action, decrypt failure accepted | Block release; fix immediately (hours); hotfix path |
| **P1 High** | Core flow broken or a security control missing/weak | auto-lock not enforced, permission edge-case bypass, wrong field filled, missing negative test for a shipped endpoint, flaky P0 test | Fix before next release (≤ 1 sprint), tracked daily |
| **P2 Medium** | Non-core flow broken, degraded UX, coverage below Tier B, missing evidence artifact | search slow, tag filter bug, doc drift, missing regression tag | Next sprint |
| **P3 Low** | Cosmetic, documentation, test hygiene | typo, missing JSDoc, unused fixture | Backlog |

**No security defect is P2/P3.** Any suspected secret exposure is treated as P0 and triggers the AR-2 rotation rule
(rotate the secret, don't just delete the commit) before anything else.

**Reproduction requirement:** every defect raised by QA carries exact steps, environment (commit SHA, browser,
build mode), observed vs. expected, and an evidence artifact. A defect without reproduction steps is returned to QA,
not to the implementer.

---

## 14. Validating This Document (doc-validation)

This card's test type is `doc-validation`, so the document itself is verified mechanically:

```
node scripts/qa/validate-docs.mjs TEST_STRATEGY.md
```

The validator checks:

1. **Completeness** — every topic required by QA-001a's acceptance criteria is present: unit, integration, security,
   E2E, exploratory, regression, tools, coverage targets, negative test requirements, synthetic data policy.
2. **Reference integrity** — every repo path referenced in this document (ADRs, `PROJECT_BRIEF.md`,
   `architecture/kanban/backlog.md`, `tests/**`) exists or is explicitly marked as future/not-yet-created.
3. **Board alignment** — the `Test Types` vocabulary in §2 covers every distinct type used in `backlog.md`.
4. **Policy hygiene** — no real-looking secret, real domain, or PII appears in this document or its examples (AR-4
   applied to the docs themselves).
5. **Traceability** — each SEC-001 absolute rule (AR-1…AR-6) is referenced by at least one section.

**Validator output is the evidence artifact for this card** and is committed under `tests/evidence/t_ac6a1f3f/`.
A `doc-validation` card whose file fails the validator is `fail` by definition, regardless of prose quality.

Also applied to this document: the same validator runs in CI on every PR touching `.md` files, so documentation
drift (e.g. a renamed ADR) fails the build rather than silently aging.

---

## 15. Known Inconsistencies and Open Questions

Recorded here because QA must not silently paper over conflicting sources. Each item is a card or a follow-up for a
named owner.

| # | Inconsistency / open question | Sources in conflict | Resolution owner |
|---|---|---|---|
| 1 | **Crypto package path.** This strategy follows `packages/crypto/` (monorepo root). | ADR-002 §2.1/§2.2 and ADR-005 §9.3 say `packages/crypto/`; `PROJECT_BRIEF.md` §9 decision log says `packages/shared/crypto/` | Architect — align the brief with ADR-002 (ADR wins until amended) |
| 2 | **Coverage thresholds.** Tier A follows the backlog minimums (80/70/90); the draft targets once proposed (90/85/100) are kept as Tier B. | backlog QA-001e vs this document's earlier draft | QA-001e implements Tier A as the CI gate; any tightening to Tier B is an explicit, documented step |
| 3 | **Exploratory report location.** `tests/exploratory/` used here. | ADR-002 §2.1 (`tests/`) vs. earlier drafts placing reports under `docs/` | QA — fixed in this revision; ADR-002 layout governs |
| 4 | **Bridge review gate.** ADR-005 §9.2 flags that AR-6 does not cover `packages/shared/` bridge message changes. | ADR-005 §9.2 open item | Architect — decide whether a separate review gate is required |
| 5 | **Fallback cookie contract** (name, value, format) — needed before E2E-EXT-011 can be written. | ADR-005 §10 open question 5 | BR-002a |
| 6 | **Extension ID / `WEB_APP_ORIGIN` configuration** — needed before origin-validation E2E tests can assert exact origins. | ADR-005 §10 open questions 1–2 | BR-001f |
| 7 | **Client-side vs. server-side decryption** for API-only clients — affects where crypto negative tests live. | ADR-002 §4.2 / open question 3 | BE-002a |
| 8 | **`AUTOFILL_*` / `VAULT_SEARCH_*` web-mediated path in MVP?** E2E for the web-mediated path is P2 until decided. | ADR-005 §10 open questions 3–4 | BR-003 |

---

## 16. QA Task Map (who implements what from this strategy)

| Task | Implements from this document |
|---|---|
| **QA-001a** (this card) | `TEST_STRATEGY.md` + doc validator + evidence |
| QA-001b | §10 pipeline, fixed job order, per-job blocking behavior |
| QA-001c | §3.4 Playwright matrix: Chromium, Firefox, WebKit, extension project |
| QA-001d | §3.3.2 SAST, dependency audit, secret scan wiring |
| QA-001e | §7 fixtures/generator + §5 Tier A thresholds in CI |
| QA-001f | §6 consolidated negative-test checklist artifact |
| QA-001g | §11 artifact upload + retention |
| QA-001h | §12 verdict/evidence gate enforcement |
| QA-002 | §3.4.1 P0 web E2E suite as specified here |

---

## 17. References

- `architecture/adr/SEC-001-threat-model.md` — threat vectors V1–V7, crypto decisions 1–9, **Absolute Rules AR-1…AR-6**
- `architecture/adr/ADR-001-functional-patterns-from-passbolt.md` — functional patterns + IP boundary
- `architecture/adr/ADR-002-overall-architecture.md` — layout, boundaries, `packages/crypto/` isolation
- `architecture/adr/ADR-003-data-model.md` — entities, ownership, authorization
- `architecture/adr/ADR-004-api-contract.yaml` — API contract asserted by integration/negative tests
- `architecture/adr/ADR-005-extension-bridge-protocol.md` — bridge messages, origin validation, autofill constraints
- `PROJECT_BRIEF.md` — product scope, roadmap, ratified decisions
- `architecture/kanban/backlog.md` — task acceptance criteria and `Test Types` labels
- `WORKTREE_STRATEGY.md` — branch/worktree conventions used for QA evidence commits
- OWASP ASVS 4.0.3 (Level 2 target), OWASP Testing Guide v4.2, OWASP Cryptographic Storage Cheat Sheet
- NIST SP 800-38D (GCM); RFC 9106 (Argon2); RFC 6238 (TOTP test vectors)

---

## 18. Changelog

| Date | Change | Author |
|---|---|---|
| 2026-09-17 | Initial strategy: levels, tools, coverage tiers, negative tests, synthetic data, CI, evidence, sign-off gate | QA (QA-001a) |

---

## 19. Review and Sign-off

| Role | Name | Date | Signature |
|---|---|---|---|
| QA | `qa` profile | 2026-09-17 | Drafted — self-validated with `scripts/qa/validate-docs.mjs` (evidence committed) |
| Architect | (pending) | | |

**Next steps:** Architect review of this document (§15 items 1 and 4 need a decision); QA-001b implements §10;
QA-001f produces the §6 checklist artifact; QA-001e implements §5 Tier A + §7 fixtures.
