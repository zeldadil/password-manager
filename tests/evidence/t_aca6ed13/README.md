# FE-003b: Sidebar — QA Evidence

**Task:** t_aca6ed13 (FE-003b)
**Landed on master via:** PR #90, commit 02f4c2c (2026-09-25)

## Starting state

`blocked` — its last four runs (768/774/783/784) all crashed the same
way ("worker exited cleanly without calling `kanban_complete`" — a
protocol violation), most recently 2026-09-25 14:40, after hitting the
retry limit. Unlike most tasks worked this way in this sweep, the actual
work here had already been pushed and merged as a real, standalone PR
(#90, based directly on `master`, merged 14:35 — 5 minutes before the
final crash) before the agent failed to call `kanban_complete`. This is
the "real work succeeded, the task just never got closed out" pattern,
not a "zero surviving code" one — verified by reading and re-running the
actual merged code, not assumed from the crash log.

## Acceptance criterion

> Folder tree (expand/collapse, drag-drop move), tag list (filter on
> click)

**Met.**
- **`FolderTree.tsx`**: real ARIA tree pattern (`role="tree"`/`"treeitem"`,
  `aria-level`, `aria-expanded`), expand/collapse per node, drag-and-drop
  move with cycle prevention and drop-target highlighting. 22 tests.
- **`TagsList.tsx`**: toggles an active tag on click, supports both
  controlled (`activeTagId` prop) and uncontrolled (internal state)
  modes, `aria-pressed` on each tag button. 12 tests (up from the
  pre-existing 2).
- **`Sidebar.tsx`**: wires both into the `<aside>` landmark with
  labelled nav sections, passing `onFilterTag`/`activeTagId` through.
  9 tests (up from 3).

These are self-contained, reusable sidebar components with a clean
prop interface (`onFilter`, `activeTagId`, `onDragStart`/`onDrop`) —
wiring them into `VaultPage`'s actual resource-list filtering is not
part of this task's acceptance criterion (the sidebar component itself,
not end-to-end vault filtering) and is not claimed here.

## Verification run (2026-09-28, fresh clone at commit 02f4c2c)

```
pnpm install         — clean
pnpm -r typecheck     — clean (apps/services/api, apps/web, packages/crypto)
pnpm -r test          — 258 web (up from 214 before this PR: +22
                         FolderTree, +9 Sidebar net, +10 TagsList net,
                         +3 AppShell/layout.contract adjustments) +
                         615 api + 53 crypto, all passing
pnpm test:a11y        — 21/21
pnpm lint             — clean (eslint 0 errors + prettier)
pnpm build            — clean
node scripts/qa/scan-test-data.mjs
                       — same 13 findings as the established baseline,
                         all pre-existing/documented false positives;
                         nothing new from this PR's files
gitleaks detect --no-git
                       — 147 findings, matching the established
                         baseline (143 + 4 already-accepted FE-002g
                         synthetic-password findings)
trufflehog filesystem --results=verified,unknown --fail
  (AppShell.test.tsx, FolderTree.tsx/.test.tsx, Sidebar.tsx/.test.tsx,
   TagsList.tsx/.test.tsx, layout.contract.test.tsx)
                       — 0 verified, 0 unverified: clean
```

## Security

No real secret, credential, or PII in this file, the reviewed diff, or
the merged code. This is a pure UI-component task — no secret material
passes through the folder tree or tag list (folder/tag names and ids
only).

## Verdict

`pass` — see `QA-VERDICT` comment on this card.
