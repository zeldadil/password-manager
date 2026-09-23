# BE-003g: Folder Permission Mask Propagation — QA Evidence

**Task:** t_d136be82 (BE-003g)
**Landed on master via:** PR #75, commit 266e30b (2026-09-23)

## Starting state

`blocked` with no diagnostic reason recorded (`hermes kanban log
t_d136be82` shows a short, confused run — it couldn't find `PROJECT_BRIEF.md`
in its working directory and poked around unrelated paths before stopping
at 31s). Empty workspace, no branch, no PR anywhere referencing this task
or BE-003g — same "zero surviving code, pure infra failure" pattern as
BE-003b/d/e. Implemented from scratch against the task body and
ADR-003 §3.4/§3.5.

## Acceptance criterion

> On resource create/move into folder, apply folder's permissions to
> resource where user has owner on it.

**Met.** The `folders` table already carried the `permissionMask*`
columns (from BE-001b's baseline schema) and `folders.ts` (BE-003d)
already accepted/returned `permissionMask` in its API contract — neither
needed changes for this task. What was missing was the propagation logic
itself: copying that mask onto a resource's `permissions` at the moment
it's created in, or moved into, the folder.

New `applyFolderPermissionMask(db, resourceId, folderId, userId)` in
`services/permissions.ts`, wired into `routes/resources.ts`:

- **POST /resources** (create): called unconditionally with the request's
  `folderId` (a no-op if `null`). The creator is always Owner of a
  resource they just created, so the mask always applies when the
  destination folder carries one.
- **PATCH /resources/:id** (move): called only when `body.folderId` is
  provided and non-null. Unlike create, the mover is not necessarily
  Owner — `requireResourceAccess(..., 'update')` only requires Update+ to
  perform the move itself, so `applyFolderPermissionMask` does its own,
  separate Owner check before copying anything. An Update-only mover
  successfully relocates the resource but does **not** propagate the
  folder's mask — this is the literal reading of "where possible...only
  resources the user has Owner permission on are affected" (ADR-003
  §3.4/ADR-001 §2/ADR-002 §8.1 item 4), and is covered by a dedicated
  regression test.

## Design decisions made explicit in code and tests

- **Idempotent.** Applying the same mask twice (e.g., re-saving the same
  `folderId` on a PATCH, or moving a resource out and back into the same
  folder) does not insert a duplicate `permissions` row — the function
  checks for an existing (targetType, targetId, granteeType, granteeId,
  level) match first. Verified by a dedicated unit test.
- **Scope boundary: resource-into-folder only, not folder-into-folder.**
  ADR-003 §3.5 point 3 separately describes a fuller resolution for
  "moving a shared folder into another shared folder: intersecting
  permissions removed, destination folder's permissions applied" — that
  is folder-tree-level mask interaction, a materially different and
  unscoped feature. This task's single acceptance criterion is
  resource-into-folder propagation, which is what's implemented; the
  folder-into-folder case is left for a task that actually names it.
- **One-time copy, not continuous enforcement** (ADR-003 §3.4): moving a
  resource back out of the folder does not revoke what was granted by the
  mask when it moved in — this was already true structurally (nothing
  added here ties a `permissions` row to "still being in that folder"),
  and is consistent with the same non-enforcement note already documented
  for folder-level access in BE-003f.

## Verification run (2026-09-23, fresh clone at commit 266e30b)

```
pnpm install         — clean
pnpm -r typecheck     — clean (apps/services/api, apps/web, packages/crypto)
pnpm -r test          — 567 api (5 new permissions.test.ts unit tests +
                         4 new resources.test.ts integration tests) +
                         172 web + 52 crypto, all passing
pnpm build            — clean, real tsc build for apps/services/api
                         (not just --noEmit)
node scripts/qa/scan-test-data.mjs
                       — same 13 findings as the established baseline,
                         all pre-existing/documented false positives;
                         nothing new from this task's files
gitleaks detect --no-git
                       — 143 findings, matching the established baseline
trufflehog filesystem --results=verified,unknown --fail
  (permissions.ts, resources.ts, folders.ts, permissions.test.ts,
   resources.test.ts)
                       — 0 verified, 0 unverified: clean
```

## Security

No real secret, credential, or PII in this file, the reviewed diff, or
the merged code. This task governs how an authorization grant is copied
between entities (folder → resource), not encryption or secret storage —
AR-2 is unaffected; no vault key, master password, or resource secret is
read, logged, or persisted anywhere in this change.

## Verdict

`pass` — see `QA-VERDICT` comment on this card.
