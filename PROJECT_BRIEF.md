# PROJECT_BRIEF.md — Secure Password Manager

**Maintained by:** `product` · **Consumed by:** `architect`, `backend`, `frontend`, `browser`, `qa`, `docs`
**Status:** Active
**Last updated:** 2026-09-15

---

## 1. Vision

Build a self-hosted password manager, functionally inspired by Passbolt: encrypted vault, Web UI, Firefox extension,
built by a 6+1-agent Hermes AI team (`product`, `architect`, `backend`, `frontend`, `browser`, `qa`, `docs`).

The product is not a password generator — it is a full password manager: authentication/unlock, vault, resources,
folders, tags, search, secret generation, then browser extension and advanced features.

| Domain | V1 | After V1 |
|---|---|---|
| Vault | Yes — local/self-hosted | Multi-device/sync depending on architecture |
| Resources | Login, password, URL, notes, custom fields (TOTP later) | — |
| Organization | Folders, sub-folders, tags, search | Groups and sharing |
| Security | Encrypted vault, lock/unlock, threat model | Audit, rotation, advanced recovery |
| Browser | Firefox | Chrome/Chromium |
| Import/Export | Architecture prepared | Secure formats |
| Collaboration | Future architecture | Users, groups, permissions |

## 2. This project needs the `browser` agent

This project's scope includes a Firefox WebExtension (capture, controlled autofill) — `architect` should activate
and assign tasks to the `browser` profile (see `SOUL_browser_optional.md`).

## 3. Security sensitivity — security gate required

This project stores user secrets (master password, vault contents, resource secrets). `architect` must run a
security-gate task (threat model + crypto decisions) before any secret-storage code is written, per the generic
Security gate rule in `SOUL_core.md`. See `architecture/adr/` for the live threat model and crypto ADRs once written.

## 4. Reference product & IP boundary

**Reference product:** Passbolt (AGPLv3) — a mature open-source team password manager.
**Constraint:** Passbolt's license (AGPLv3) means we may study its public repo/docs for *functional* inspiration
only. We must never copy its code, file structure, schema definitions, or config verbatim. Every adapted pattern must
be written in our own words and explicitly flagged "inspired by Passbolt" vs. original in our ADRs (see the generic
Reference-product boundary rule in `architect`'s profile).

Functional patterns already extracted and adapted: resource/secret split, folder permission masks, flat tags,
group-as-ARO sharing with client-side re-encryption, 3-level permissions (Read/Update/Owner), MV3 extension
architecture, master-password+KDF auth flow (not OpenPGP), API envelope conventions. Full detail: `ADR-001-functional-patterns-from-passbolt.md`.

Patterns explicitly **not** adopted: OpenPGP/GPGAuth, server-side keyring recovery, PHP/CakePHP stack (we use
TypeScript/Node + React), plaintext-by-default metadata, JSON-schema resource-type registry (fixed types for now),
SSO, LDAP sync, comments, favorites, activity/audit log — all deferred or replaced, see ADR-001 for rationale.

## 5. Stack

TypeScript/Node (API) + React (Web) + Firefox WebExtension (Manifest V3). Monorepo: `apps/web/`,
`apps/browser-firefox/`, `apps/services/api/`, `packages/shared/`.

## 6. Roadmap (4 phases)

| Phase | Goal |
|---|---|
| 0 — AI Team | Hermes team + Kanban + profiles operational |
| 1 — Secure MVP | Vault + auth + resources + folders + tags + generator + search |
| 2 — Browser | Firefox extension + bridge + controlled capture/autofill |
| 3 — Hardening | Security review + QA + backup + audit + performance + docs |
| 4 — Advanced | Chrome + TOTP + sharing + groups + permissions + import/export |

Priority: a small, safe surface rather than a large, fragile product.

## 7. Current backlog

See `backlog.md` at the repo root (Kanban) for the live, decomposed task list — `SEC-001` (security gate) is the
root task, all secret-storage/crypto/bridge work depends on it.

## 8. Open questions / TBD

- Chrome support: deferred to Phase 4.
- TOTP: MVP has it as a stretch goal in the browser extension only (BR-003), not guaranteed in scope.
- SSO/LDAP/sharing/groups: explicitly post-MVP, not to be designed in detail yet.

## 9. Decisions Log (from kickoff — 2026-09-16)

Decisions ratified during the project kickoff walkthrough. Each entry records what was decided, by whom, and the rationale. These are living decisions — update this log as ADRs are written and gates close.

### Telegram status-updates channel
- **Decision:** Telegram bot configured for all 6 agent profiles (`architect`, `backend`, `frontend`, `browser`, `qa`, `docs`) using the bot token from `@BotFather` and `TELEGRAM_ALLOWED_USERS=956145756`.
- **Rationale:** Standing instruction requires every Kanban task completion (done/review) or block to be reported via `hermes send --to telegram` immediately — no batching, no waiting. The channel is the team's operational heartbeat.
- **Tested:** `hermes send --to telegram:956145756 "test"` succeeded from @backend profile. All profiles now have `.env` (token + allowed users) and `config.yaml` (target, home_channel, home_channel_name) set.
- **Owner:** architect
- **Credential handling:** The bot token is **never written into any repo file** — only in each profile's `.env` (which is gitignored) and in `config.yaml` (which is also gitignored via the profile's `.gitignore`). The PROJECT_BRIEF.md decision log records the *decision* and the *user ID*, never the token value. See incident report below for the one-time breach and its resolution.

### SEC-001 deliverable format
- **Decision:** SEC-001 threat model + 9 crypto decisions live in a **single ADR: `ADR-002-security-model.md`**. Atomic gate — Architect + QA sign off together; downstream tasks need one reference.
- **Rationale:** Gate is atomic by design; splitting across multiple ADRs would complicate sign-off and create versioning ambiguity before any code is written. Can be split in Phase 3 if it grows unwieldy, but V1 keeps it together.
- **Owner:** architect

### Passbolt contamination scan approach
- **Decision:** QA-001a owns proposing the scan approach — no existing tool mandated upfront. Recommended strategy: `gitleaks` + `truffleHog` (secret scan, already in CI baseline), forbidden-pattern grep (Passbolt-specific class names, table prefixes, GPG/OpenPGP imports, CakePHP conventions), AST-level diff (`ts-morph` / ESLint rule), license header scan (no AGPLv3 headers in our code). Deliverable: `SECURITY_SCAN.md` in `docs/` with runnable ruleset (`pnpm scan:passbolt`).
- **Rationale:** ADR-001 already commits to automated CI scanning; the concrete ruleset must be defined by QA who owns the test strategy, then approved by architect before CI wiring. No point mandating a specific tool before the repo exists.
- **Owner:** @qa-security-test-engineer (propose) + architect (approve)

### Repo structure + crypto package boundary
- **Decision:** Monorepo layout is exactly:
  ```
  apps/web/                 # React frontend
  apps/browser-firefox/     # Firefox MV3 extension
  apps/services/api/        # Node/TypeScript API
  packages/shared/          # Shared contracts (API types, extension↔web messages)
  packages/crypto/          # SEC-001 primitives — isolated, audited crypto wrappers at monorepo root
  ```
  `packages/crypto/` sits at the monorepo root (not inside `packages/shared/`) so it can be reviewed as a single security boundary. No app may bypass it. Runtime adapters (Web Crypto for browser, Node `crypto` for API) are thin wrappers in each app. (ADR-002 §2.1/§2.3/§5.3 — original architectural decision.)
- **Rationale:** Matches PROJECT_BRIEF.md stack section. Separating crypto interfaces from runtime implementations keeps the security boundary auditable and testable in isolation — critical for a product that stores user secrets. The isolated-root placement is an original decision (ADR-002 §2.3): Passbolt's PHP stack has no equivalent isolated crypto package.
- **Owner:** architect
- **Reconciliation note (2026-09-17):** PROJECT_BRIEF.md kickoff draft said `packages/shared/crypto/` (§9, commit fd555c1-era text). ADR-002 (§2.1, §2.3, §5.3, §9.3) records `packages/crypto/` at monorepo root as an original decision. ADR-002 wins — it is the authoritative architecture document. PROJECT_BRIEF.md text updated above to match. QA-001a's TEST_STRATEGY.md §15.1 followed the ADRs (correct); the earlier PROJECT_BRIEF.md text was the source of the contradiction.

### Security checklist for gate enforcement
- **Decision:** Not yet codified — QA-001a owns it. Baseline (no secrets in console/logs/URLs/errors, origin/message control, minimal permissions, tamper detection, backup/restore tested, dependency scan clean) is the starting point. QA-001a expands into `SECURITY_CHECKLIST.md` with per-layer checks (API/Web/Extension), CI-enforced vs. manual-review items, mapping to SEC-001 threat vectors, and evidence requirements per check. Architect reviews and signs off before QA-001b wires it into CI.
- **Rationale:** The checklist must be derived from the threat model (SEC-001) and the actual implementation, not stipulated upfront. QA owns quality gates; architect owns architectural sign-off.
- **Owner:** @qa-security-test-engineer (codify) + architect (sign off)

### Backend ORM: Drizzle
- **Decision:** **Drizzle ORM** for BE-001a migration layer. Lightweight, migration-first, type-safe. No runtime ORM hydration overhead in cryptographic code paths — easier to audit and test than Prisma for a security-sensitive codebase. Knex rejected (too low-level — raw SQL for everything).
- **Rationale:** Aligns with "small, safe surface" priority. Drizzle's schema-as-code approach fits our monorepo + shared-package structure and produces portable migrations.
- **Owner:** architect (decision) + @backend-security-engineer (implement)

### DB: SQLite v1 dev → Postgres production-ready
- **Decision:** **SQLite for v1 dev bootstrap** (zero infra, runs everywhere, migrations portable). **Postgres as the production target** (documented in ARC-001a). Swap to Postgres via the same Drizzle schema when preparing Phase 3 hardening or multi-device sync. Migrations in BE-001a should be DB-agnostic where possible.
- **Rationale:** V1 is local/self-hosted — no need to impose Postgres infra on every developer. When we get to hardening/multi-device in Phase 3, Postgres is the natural target; Drizzle migrations make the swap straightforward.
- **Owner:** architect

### Browser extension: MV3 specifics locked
- **Decision:**
  - **Declarative content scripts** for form detection (static `matches` in manifest); dynamic injection via `browser.scripting` only for autofill icon injection (user-triggered).
  - **No offscreen document** — vault key + AEAD live in background service worker using Web Crypto API. Content scripts never touch crypto. Add offscreen later if PBKDF2-in-extension becomes necessary.
  - **`browser.runtime.sendMessage`** (request/response) for all bridge ops. `connect` only if streaming is needed (not in MVP).
  - **Shared contract in `packages/shared/`** — TypeScript interfaces for all extension↔web↔API messages.
- **Rationale:** Declarative content scripts give simpler CSP and clearer permissions. Background worker holds all crypto — content scripts are pure form detection + relay, matching ADR-001 section 6. `sendMessage` is simpler state machine, easier to test. These decisions will be formalized in ADR-005 (Extension Bridge Protocol) — ARC-001d.
- **Owner:** architect

### Next steps
- architect: start SEC-001 (threat model + crypto decisions) — `ADR-002-security-model.md`
- When SEC-001 → `done`, dispatcher auto-promotes ARC-001a, BE-002a, BR-002a, DOC-001d
- ARC-001a-f completes → unblocks BE-001a (Drizzle migrations, SQLite), FE-001a (React/Vite), QA-001a (test strategy), DOC-001a (README)

### GitHub repository (ARC-001f)
- **Decision:** GitHub repo `zeldadil/password-manager` created (public), `master` branch protected (PR required, 1 approving review, status checks: lint/typecheck/unit/integration/secret-scan, linear history required, force pushes/deletions blocked). Remote added as `origin`. Actual visibility: public (private repos require GitHub Pro for branch protection API).
- **Rationale:** Private repos on free GitHub tier don't support branch protection API — switching to public unlocks it. All repo content is open-source code/docs; no sensitive data in the repo itself (secrets live only in encrypted vault at runtime, never committed).
- **Owner:** architect
- **Commit:** `a503e4d` ("docs: ARC-001f — GitHub repo created + branch protection configured")

### Branch protection: single-account review gate removed (2026-09-17)
- **Decision:** `required_approving_review_count` set to `0` (disabled) on `master` branch protection. The 8 required status checks remain unchanged: `install-lockfile`, `lint-typecheck`, `unit`, `integration`, `e2e`, `dependency-audit`, `secret-scan`, `build`.
- **Rationale:** Single GitHub account (`zeldadil`) owns the repo. There is no second human reviewer to approve PRs — the Kanban review workflow (architect + QA sign-off on task cards) is the review gate, not GitHub's PR approve mechanism. With `required_approving_review_count: 1`, every PR would be structurally blocked because no second account exists to click "Approve" — the gate would be dead weight, not rigor.
- **This is NOT a relaxation of security rigor.** The real safeguard is the CI status checks: no PR merges unless all 8 checks pass. `install-lockfile` catches missing lockfiles, `lint-typecheck` catches type/ lint errors, `unit`/`integration`/`e2e`/`secret-scan` catch regressions and leaked secrets. A PR that passes all 8 checks has been machine-verified far more thoroughly than a human "Approve" click would guarantee. The human review happens on the Kanban card (see QA-001h sign-off gate policy) before the task is marked `done` — that's where architect + QA exercise judgment.
- **Ownership:** architect (decision) + @user (GitHub config action)
- **Risk acknowledged:** Without the PR approve gate, a malicious or careless commit *could* merge if it passes CI. Mitigation: the 8 checks must all pass + the committer must be the single repo owner (no third parties). For a future multi-contributor project, re-enable `required_approving_review_count: 1` and add the second account as a collaborator.
- **Kanban cross-reference:** QA-001h (QA Sign-off Gate Policy) is the human review layer that compensates for the absent GitHub review gate. No task moves to `done` without a QA verdict + evidence attached — that's where the rigor lives.

### Credential incident: Telegram bot token in PROJECT_BRIEF.md (2026-09-17)
- **What happened:** During PROJECT_BRIEF.md §9 kickoff update (commit `a503e4d`, "docs: ARC-001f — GitHub repo created + branch protection configured"), the Telegram bot token `8615677595:...` was written verbatim into the decision log entry "Telegram status-updates channel". This was a violation of the credential discipline rule — the token belongs only in each profile's `.env` (gitignored) and `config.yaml` (gitignored), never in a tracked file.
- **Detection:** QA-001b's CI pipeline (`secret-scan` job using gitleaks) flagged the token as a `telegram-bot-api-token` rule hit on PR #2 (FE-001a) — the scan range included `a503e4d`. Frontend verified: the token is on disk in `PROJECT_BRIEF.md` line 87, and gitleaks reported exactly one leak, in that file only. Frontend's three commits were clean.
- **Impact:** The token is compromised by being in git history. Any fork/clone of the repo contains it. The token must be considered invalid and rotated immediately. The same token is (or was) active for all 6 agent profiles' Telegram status-ups.
- **Remediation (in progress):**
  1. `@user` — revoke the leaked token via @BotFather and generate a new one. The new token will replace the old one in every profile's `.env` + `config.yaml`.
  2. Architect — scrub the token from `PROJECT_BRIEF.md` (done above: the decision log now says "using the bot token from @BotFather" with no value; the user ID `956145756` is not a secret and remains). Commit + push to master.
  3. Architect — once the new token is issued, update all 6 profiles' `.env` + `config.yaml` with the replacement.
  4. Verify: re-run `secret-scan` on a PR that includes the scrub commit — it must pass.
- **Root cause prevention:** This incident is exactly the kind of error that the credential discipline rule exists to prevent. The fix is procedural, not technical: decision logs in PROJECT_BRIEF.md and ADRs must **never** contain live credentials — only the decision, the owner, and non-secret parameters (user IDs, channel names, config keys without values). This rule is now explicit. See also @frontend's `kanban-task-workflow` skill pitfall #5 (verify repo state, don't trust self-reported "done") — the leak was caught by CI, not by the author.
- **Sign-off:** This incident is documented here for the record. Architect + QA will review the remediation before any task that depends on Telegram status-ups is marked `done` again.
- **Owner:** architect (documentation) + @user (token rotation, the actual fix)
