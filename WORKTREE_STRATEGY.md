# Worktree Strategy — `feature/<task-id>` per Kanban task

**Status:** Active · **Owner:** architect · **Last updated:** 2026-09-16

---

## 1. Why worktrees

The password-manager repo is a monorepo with four workspaces (`apps/web`, `apps/browser-firefox`, `apps/services/api`, `packages/shared`) plus `tests/`, `docs/`, and `architecture/adr/`. Multiple agents work in parallel on different Kanban tasks. Shared worktrees give each agent an isolated checkout of the same repo so:

- Agents never step on each other's uncommitted changes.
- Each task branch can be diffed, reviewed, and PR'd independently.
- The main branch stays clean — nothing lands on `master` except via merged PRs.

This matches the monorepo + parallel-agent model in PROJECT_BRIEF.md section 5 and the Kanban dispatch model.

---

## 2. Branch naming

Every Kanban task gets one branch:

```
feature/<task-id>
```

Examples:

- `feature/t_5f82ac57` — ARC-001e (repo structure + root config)
- `feature/t_ac6a1f3f` — next child task
- `feature/t_aed3f3d1` — next child task

Task IDs are the Kanban task IDs (e.g. `t_7ec83773`), not ARC codes. This keeps the branch name stable even if the ARC label changes.

**Rules:**

- One branch per task. No shared branches between tasks.
- Branch is created from `master` (the protected default), never from another feature branch.
- Branch is deleted after the PR is merged and the task is closed.

---

## 3. Worktree layout

Worktrees live under the repo's `.worktrees/` directory so they're colocated and easy to clean up:

```
password-manager/
├── .git/                 # main repo
├── .worktrees/
│   ├── t_5f82ac57/       # worktree for ARC-001e
│   ├── t_ac6a1f3f/       # worktree for next task
│   └── ...
├── apps/
├── packages/
├── tests/
├── docs/
├── architecture/
└── ...
```

Each worktree is a full checkout with its own working directory but shares the main repo's `.git` object store (standard git worktree behavior — no duplication of history).

---

## 4. Creating a worktree (agent workflow)

When an agent picks up a task:

```bash
# From the main repo root
cd /home/sap/password-manager

# Create the worktree (branch is created automatically)
git worktree add .worktrees/<task-id> -b feature/<task-id> master

# Work in the worktree
cd .worktrees/<task-id>

# ... do work, commit, push ...

# When done and PR merged, remove the worktree
git worktree remove .worktrees/<task-id>
```

**Important:** The branch must be pushed to GitHub so the PR can be created. The worktree local branch is not enough.

```bash
git push -u origin feature/<task-id>
```

---

## 5. PR workflow

1. Agent finishes work in the worktree, commits, and pushes the branch.
2. Agent creates a PR from `feature/<task-id>` → `master`.
3. PR title and body reference the Kanban task ID and ARC code.
4. CI runs the required status checks (see section 6).
5. On merge, the branch is deleted (GitHub setting: "Automatically delete head branches").
6. Agent removes the local worktree: `git worktree remove .worktrees/<task-id>`.

---

## 6. Required status checks (branch protection)

The `master` branch protection rule requires these status checks to pass before merge:

| Check        | What it validates                          | CI command (root)        |
|--------------|--------------------------------------------|--------------------------|
| `lint`       | ESLint/Prettier across all workspaces      | `pnpm lint`              |
| `typecheck`  | `tsc --noEmit` strict mode across all ws   | `pnpm typecheck`         |
| `unit`       | Unit tests per workspace                    | `pnpm test`              |
| `integration`| Integration/E2E tests                      | `pnpm test:integration`  |
| `secret-scan`| Gitleaks + TruffleHog against the branch   | `pnpm scan:secrets`      |

**Branch protection settings (master):**

- Require a pull request before merging (min 1 approval).
- Require status checks to pass before merging (the 5 above).
- Require branches to be up to date before merging.
- Do not allow bypassing the above (no admin bypass in V1).
- Restrict who can push to matching branches (maintainers only).

These checks are declared in the repo's CI config (GitHub Actions workflow file) — see the CI task in the backlog for the exact workflow definition.

---

## 7. CI workflow file (baseline)

The CI workflow is defined in `.github/workflows/ci.yml` (created by the CI setup task). It runs on every push to `feature/*` and on PRs to `master`. The `secret-scan` job runs gitleaks as a separate step so a failed scan blocks the PR independently of the build.

---

## 8. Housekeeping

- Stale worktrees (branches that exist but no active task) should be removed periodically: `git worktree list` to audit, `git worktree remove` + `git branch -d` to clean up.
- If a task is re-assigned or retried, reuse the same worktree path (`.worktrees/<task-id>`) — don't create a new one. If the old worktree still exists, remove it first.
- The `.worktrees/` directory is not committed (it's in `.gitignore` via the global git worktree behavior — worktrees are not tracked as part of the repo).

---

## 9. Reference

- Git worktree docs: `git worktree --help`
- Kanban task IDs are the source of truth for branch names — see the Kanban board (`/home/sap/.hermes/kanban.db`).
- This strategy is referenced by every agent task that touches the repo. Deviations require an ADR.
