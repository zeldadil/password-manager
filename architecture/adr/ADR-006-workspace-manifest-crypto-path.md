# ADR-006: Workspace Manifest + Crypto Package Path Reconciliation

**Status:** Proposed
**Date:** 2026-09-17
**Author:** Architect
**Decision-Makers:** Architect + QA
**References:** ADR-002 (§2.1, §2.3, §5.3, §9.3), PROJECT_BRIEF.md (§9), pnpm docs (workspace resolution)

---

## 1. Purpose

Resolve two issues found during QA-001a repo-path validation (task t_ac6a1f3f, child t_ee24fd37):

1. **`pnpm-workspace.yaml` was uncommitted** — pnpm resolves workspace members from this file only, not from `package.json`'s `workspaces` field. Without it committed, CI `pnpm install --frozen-lockfile` treats the repo as a single project.
2. **Crypto package path contradiction** — PROJECT_BRIEF.md §9 said `packages/shared/crypto/`; ADR-002 §2.1/§2.3/§5.3/§9.3 says `packages/crypto/` at monorepo root.

## 2. Decisions

### 2.1 Workspace manifest — committed, pnpm file is source of truth

`pnpm-workspace.yaml` is committed on `master` (commit c9d9efa) with members:
```
apps/web
apps/browser-firefox
apps/services/api
packages/shared
packages/crypto
```

The `workspaces` field is **removed** from root `package.json` — pnpm ignores it anyway, and keeping both creates drift risk. The pnpm file is now the single source of truth.

`packages/crypto` is listed in the workspace manifest now (even though the directory does not exist yet) so that when BE-002a creates it, `pnpm install` in CI will resolve it without another manifest change. Empty/unbuilt workspace members are harmless to pnpm as long as their `package.json` exists.

### 2.2 Crypto package path — ADR-002 wins

**Decision:** `packages/crypto/` at monorepo root (sibling of `packages/shared/`), per ADR-002 §2.1/§2.3/§5.3/§9.3.

**Rationale:**
- ADR-002 §2.3 explicitly calls the isolated-root placement an "original decision for our project."
- ADR-002 §5.3 states: "apps import from `packages/crypto` — they do not import `node:crypto` or `crypto.subtle` directly."
- ADR-002 §9.3 downstream impact lists `packages/crypto/` creation as a BE-002a responsibility.
- PROJECT_BRIEF.md §9 was written during kickoff before ADR-002 existed; it was not reconciled when ADR-002 was committed. ADR-002 is the authoritative architecture document and postdates the brief's decision log entry.
- QA-001a's TEST_STRATEGY.md §15.1 correctly followed the ADRs (flagged the contradiction without taking a side).

**Effect:** PROJECT_BRIEF.md §9 text updated (commit pending) to match. No other document changes needed — ADR-003, ADR-004, ADR-005, SEC-001 all already reference `packages/crypto/` correctly.

## 3. Evidence

- `git show fd555c1:package.json` — committed root `package.json` had `workspaces` field (now removed).
- `git ls-tree -r --name-only master feature/* | grep pnpm-workspace.yaml` — no output before this commit (verified by QA-001a).
- `pnpm-workspace.yaml` now committed at c9d9efa.
- ADR-002 §2.1, §2.3, §5.3, §9.3 — all say `packages/crypto/`.
- PROJECT_BRIEF.md §9 (pre-reconciliation) — said `packages/shared/crypto/`.

---

*Date: 2026-09-17 · Author: Architect · Status: Proposed*
