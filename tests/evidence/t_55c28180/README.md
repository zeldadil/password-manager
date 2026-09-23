# BE-003e: Tag CRUD — QA Evidence

**Task:** t_55c28180 (BE-003e)
**Landed on master via:** PR #70, commit 15be4de (2026-09-23)

## Starting state

Task was `blocked` with no diagnostic recorded, same as BE-003c
(`t_b51bf4b9`, its sibling under the same parent `t_ddd8fb1e`). Both
tasks were promoted and claimed together (runs #727/#728); `hermes kanban
log t_55c28180` shows a real attempt in progress (schema reads, a
~848-line draft diff for `tests/tags/be003e.tags.test.ts`) before it hit
the same sandbox `npx` security-scan block that stopped BE-003c's run.
No branch, no PR, no workspace content survived anywhere — implemented
independently against the task spec and ADR-003/ADR-004, not
reconstructed.

## Acceptance criterion

1. `POST/GET/PATCH/DELETE /tags` — flat, many-to-many via `resource_tags`
   — **met**. See `apps/services/api/tests/tags.test.ts` (17 tests):
   create (uniqueness within/across vaults case-insensitively, vaultId
   mismatch), list (own-vault scoping), get (404 vs cross-user), update
   (fields, rename-to-own-name allowed, rename-to-duplicate rejected,
   cross-user 404), delete (soft-delete, detachment from every tagged
   resource, cross-user 404 with no side-effect).

## Structural note verified against the existing schema

The `tags` table has no `ownerId` column — this was already the case in
`schema.ts` before this task (confirmed by inspection, not something this
task changed). ADR-004 states "vault owner owns all tags", so
authorization is vault-scoping only (`tag.vaultId === caller's vault`),
unlike Folder/Resource which also check `ownerId`. This is a real,
intentional asymmetry in the data model, not an oversight in this PR.

## Contract calls where ADR-004 needed a decision it doesn't fully spell out

- "Tag names unique within vault (case-insensitive)" — enforced at write
  time (create + rename) against every other non-deleted tag in the same
  vault. Verified: same name rejected within a vault (case-insensitive),
  allowed across two different vaults, allowed when a tag keeps its own
  current name on an unrelated-field update.
- DELETE "decrements tag reference count on resources" — implemented as
  detaching the tag from every resource that carries it (deleting the
  `resource_tags` rows) before soft-deleting the tag, so no junction row
  survives pointing at a deleted tag. Verified end-to-end: create a tag,
  attach it to a resource via `POST /api/v1/resources`'s `tagIds`, delete
  the tag, confirm the resource's `tagIds` becomes empty.
- `vaultId` in the create body: accepted for contract shape compatibility,
  never trusted for tenant scoping (403 on mismatch) — same rule as every
  other `/api/v1` route landed in this sweep.

## Verification run (2026-09-23, fresh clone at commit bd58723)

```
pnpm install        — clean
pnpm typecheck       — clean (apps/services/api, apps/web, packages/crypto)
pnpm test            — 530 api (17 new for this task) + 172 web + 52
                        crypto = 754/754 passing
pnpm build           — clean, real tsc build (not just --noEmit)
node scripts/qa/scan-test-data.mjs
                      — same 13 findings as before this task, all
                        pre-existing/documented false positives; nothing
                        new from tags.test.ts's synthetic fixtures
gitleaks detect --no-git
                      — no findings in any new/changed file
trufflehog filesystem — no findings in any new/changed file
```

## Security

No real secret, credential, or PII in this file, the reviewed diff, or the
merged code. Tags carry only non-secret metadata (name, color). AR-2 is
satisfied by construction — this module performs no crypto and never
touches a vault key, master password, or resource secret.

## Verdict

`pass` — see `QA-VERDICT` comment on this card.
