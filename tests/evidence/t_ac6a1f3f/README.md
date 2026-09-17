# QA Evidence — QA-001a: Test Strategy Document (`t_ac6a1f3f`)

**Verdict:** PASS (self-validation) — document complete and mechanically validated; Architect review pending on §15 items 1 and 4.
**Date (UTC):** 2026-09-17T11:38:16Z
**Branch:** `feature/t_ac6a1f3f` (worktree `.worktrees/t_ac6a1f3f`, based on `master` @ `a503e4d`)
**Toolchain:** node v22.23.2, pnpm 9.12.0 (no test suites exist yet — this card's test type is `doc-validation`)

## Deliverables in this commit

| Path | Purpose |
|---|---|
| `TEST_STRATEGY.md` | QA-001a deliverable — test levels, tools, coverage targets, negative-test requirements, synthetic data policy, CI gates, evidence + sign-off policy |
| `scripts/qa/validate-docs.mjs` | Runnable doc validator used as this card's evidence (and reusable for CI on `.md` changes) |

## Commands run (verbatim, from the worktree root)

```
node scripts/qa/validate-docs.mjs TEST_STRATEGY.md
node scripts/qa/validate-docs.mjs /tmp/qa-negative-control.md
```

## Artifacts

| File | Content | Exit code |
|---|---|---|
| `doc-validation-positive.txt` | Validator stdout for the deliverable — 6 checks OK, 0 errors | 0 |
| `doc-validation-negative-control.txt` | Validator stdout for a **deliberately non-compliant** document — all 5 check groups fire | 1 |

### Why the negative control exists

A validator that only ever passes proves nothing. The negative control is a throwaway markdown file kept in `/tmp`
(**not committed** — it contains secret-shaped strings, per this strategy's §7 / SEC-001 AR-4) that violates every
rule. The captured run shows each check group firing:

- completeness — 6 required topics missing
- references — 2 referenced files do not exist
- board-alignment — 15 board `Test Types` labels uncovered
- policy-hygiene — AWS-key-shaped string, two non-reserved domains, one non-reserved email
- traceability — AR-1 … AR-6 not referenced

## Checks performed on the deliverable

| Check | Result |
|---|---|
| Required topics present (unit, integration, security, E2E, exploratory, regression, tools, coverage targets, negative tests, synthetic data) | 10/10 |
| Referenced existing repo paths resolve | 12 files verified (`PROJECT_BRIEF.md`, `SECURITY.md`, `WORKTREE_STRATEGY.md`, all 5 ADRs, `architecture/kanban/backlog.md`, `package.json`, …) |
| Paths that do not exist yet are the ADR-002 target layout, listed as planned, not failures | 6 (`packages/shared`, `tests/security/*`, `apps/browser-firefox/dist`, …) |
| Board `Test Types` vocabulary coverage | 15/15 distinct labels used in `backlog.md` |
| SEC-001 absolute rules referenced | AR-1 … AR-6 all present |
| Policy hygiene (no secrets / non-reserved domains / PII in the doc) | clean |

## Source hashes at this commit

```
932130343d1079c1cdeee2e8f07a48faba6b3df046d07710faea4f0ea0724469  TEST_STRATEGY.md
65aa7b2ed09a4e48c1980e2fe89a6cf055d13e4f80357cb196a36851d8bef7b7  scripts/qa/validate-docs.mjs
```

## Findings handed off (not defects in this deliverable)

1. **Repo layout is not committed on `master`.** `package.json` (committed, ARC-001e) declares
   `workspaces: [apps/web, apps/browser-firefox, apps/services/api, packages/shared]` and pins `packageManager:
   pnpm@9.12.0`, but `pnpm-workspace.yaml`, `apps/`, `packages/`, `tests/`, `docs/`, `scripts/` are **untracked** in
   the main working tree and absent from `master`. QA-001b's `install-lockfile` job (`pnpm install --frozen-lockfile`)
   has no committed workspace definition to install from. Report: needs an owning task (architect / repo owner).
2. **Root CI scripts do not exist yet.** The strategy's pipeline (§10) calls `pnpm test:unit`, `pnpm test:integration`,
   `pnpm test:e2e`, `pnpm test:security`, `pnpm scan:secrets`, `pnpm audit`. The committed root `package.json` defines
   only `dev`/`build`/`lint`/`typecheck`/`test`/`clean` — QA-001b must add the rest.
3. **`.gitignore` ignores `*.js` repo-wide.** Hand-written `.js` tooling (as opposed to `.mjs`/`.ts`) cannot be
   committed. This validator uses `.mjs` for that reason; the constraint should be documented in the CI task.
4. **`PROJECT_BRIEF.md` §9 contradicts ADR-002** on the crypto package path (`packages/shared/crypto/` vs
   `packages/crypto/`). Recorded as open item §15.1 in the strategy, owner: architect.
5. **ADR-005 §9.2** flags that AR-6 does not cover `packages/shared/` bridge message changes (recorded as §15.4).
