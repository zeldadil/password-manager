# FE-003b — Sidebar: Verification Evidence

**Task:** t_aca6ed13 · **Date:** 2026-09-25
**Branch:** feat/t_aca6ed13
**Commit:** 02f4c2c (`FE-003b: Sidebar — folder tree (expand/collapse, drag-drop move), tag list (filter on click) (#90)`)
**PR:** #90 (merged)

## Acceptance criteria

> Folder tree (expand/collapse, drag-drop move), tag list (filter on click)

All three components implemented with full test coverage and ARIA accessibility.

## Components built

### FolderTree (`apps/web/src/components/layout/FolderTree.tsx`)
- Expand/collapse via toggle buttons with `aria-expanded`, `aria-controls`, `aria-label`
- ARIA tree pattern: `role="tree"` root, `role="treeitem"` rows with `aria-level` (increases per depth)
- Drag-and-drop: `draggable="true"`, `dragstart`/`dragover`/`dragleave`/`drop`/`dragend` wiring
- `canAcceptDrop`: cycle prevention — builds parentMap lookup, walks up from target to reject if source is ancestor
- Drop-target highlighting: `drop-target` class toggled via `dropTargetId` state propagated through TreeNode props
- `textContent?.trim()` on `.folder-tree__name` to handle whitespace text nodes introduced by JSX formatting

### TagsList (`apps/web/src/components/layout/TagsList.tsx`)
- Toggle active tag on click, controlled via `activeTagId` prop or uncontrolled internal state
- `aria-pressed` on each tag button, `tags-list__tag--active` CSS class
- `role="list"` on container, `aria-label="Tags"`

### Sidebar (`apps/web/src/components/layout/Sidebar.tsx`)
- `aside` landmark with `aria-label="Vault navigation"`
- Two `nav` sections, each labelled by its heading (Folders / Tags)
- Wires FolderTree + TagsList with callback passthrough (`onMoveFolder`, `onFilterTag`)

## Test results (fresh worktree at origin/master pre-merge, commit 02f4c2c)

```
pnpm test           → 249 web unit tests, 26 api unit tests, 53 crypto unit tests: ALL PASS
pnpm build          → dist built successfully
pnpm typecheck      → clean (fixed pre-existing unused vi sidebar in AppShell.test.tsx)
pnpm lint           → prettier formatting clean after fmt
```

### CI (PR #90, 10 checks — all green)
- install-lockfile: pass
- secret-scan: pass
- sast: pass
- Semgrep OSS: pass
- dependency-audit: pass
- build: pass
- lint-typecheck: pass
- unit: pass
- integration: pass
- e2e: pass

## Fixes applied during implementation

1. **canAcceptDrop cycle check broken for leaf nodes** — original O(n²) ancestor walk
   through `grouped` broke when a node had no children (grouped.get returned undefined,
   loop exited prematurely). Fixed by building a `parentMap: Map<childId, parentId>`
   once and walking up via `parentMap.get(current)`.

2. **Shared vi.fn() spy polluted across drag-drop tests** — `onMove` defined once in
   describe block, never cleared. Added `beforeEach(() => onMove.mockClear())`.

3. **layout.contract.test.tsx expected old scaffold behavior** — 4 tests assumed inline
   children (no expand/collapse). Adapted: expand toggles clicked before asserting children
   visible; rootNames selector uses `.trim()` to handle whitespace text nodes.

4. **AppShell.test.tsx pre-existing lint/typecheck errors** — unused `vi` import and
   unused `sidebar` variable. Removed both (not related to FE-003b scope, but blocked CI).

## Files changed (8 files, +745/-83 +84/-34 across 2 commits)

- `FolderTree.tsx` — full ARIA tree + drag-drop implementation
- `FolderTree.test.tsx` — 22 tests (structure, expand/collapse, drag-drop, edge cases)
- `Sidebar.tsx` — aside landmark wiring
- `Sidebar.test.tsx` — 8 tests
- `TagsList.tsx` — toggle + aria-pressed
- `TagsList.test.tsx` — 12 tests
- `AppShell.test.tsx` — removed unused imports (pre-existing)
- `layout.contract.test.tsx` — adapted to expand/collapse tree

## Evidence sources

- PR #90: https://github.com/zeldadil/password-manager/pull/90
- CI run: https://github.com/zeldadil/password-manager/actions/runs/36148282548
- Commit 02f4c2c on master: `git log origin/master --oneline -1`
