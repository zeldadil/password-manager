# BE-003j: Integration Tests — QA Evidence

**Task:** t_f4f3ec16 (BE-003j)
**Landed on master via:** PR #81, commit b561d15 (2026-09-23)

## Starting state

`blocked`, no diagnostic reason recorded, no workspace, no branch, no PR
anywhere referencing this task. Like BE-003i, this is a coverage task —
its acceptance criterion asks for existing functionality to be covered by
integration tests, so the real work was an audit against the actual test
suite, not implementation from scratch.

## Acceptance criterion

> Full resource lifecycle, folder tree ops, tag assignment, permission
> inheritance, sharing via group covered

**Audited, not assumed** — read the actual integration test files for
each of the five named areas before concluding anything:

| Area | Finding |
|---|---|
| Folder tree ops | Already thorough: `folders.test.ts` covers nested creation via `parentId`, re-parenting (PATCH), cycle detection (self-parent and descendant-cycle), and cascade-to-root on delete (both child folders and contained resources become root-level rather than being deleted). |
| Tag assignment | Already covered: `resources.test.ts` (attach/detach via `tagIds` on create and PATCH) + `tags.test.ts` (CRUD, case-insensitive uniqueness, detachment from every resource on tag delete). |
| Permission inheritance (folder `permissionMask` propagation) | Already integration-tested end-to-end — BE-003g's 4 tests in `resources.test.ts` (create-in-masked-folder, move-into-masked-folder, Update-only mover doesn't propagate, unmasked folder grants nothing). |
| Full resource lifecycle | Covered piecemeal across many individual CRUD tests, but no single test proved the whole flow (create → list → get → tag → move → rename → delete) works together end-to-end. |
| Sharing via group | **A real, significant gap.** `permissions.test.ts` has thorough group-grant coverage, but only at the unit tier (direct DB + service calls, no HTTP). No integration test anywhere exercised group-based sharing through the actual API — `granteeType: 'group'` appeared only in a TypeScript type annotation in `resources.test.ts`, never in an actual request. |

## What was added to close the gaps

1. **Sharing via group** — new `makeGroup(ownerId, memberIds)` and
   `grantGroupPermission(targetType, targetId, groupId, level, grantedBy)`
   test helpers (direct DB insert — no group CRUD endpoint exists yet,
   same reasoning already established for the existing `grantPermission`
   helper for user grants) in both `folders.test.ts` and
   `resources.test.ts`. New "sharing via group (BE-003j)" describe block
   in each, 4 tests per file:
   - a group member can GET via a group grant (404 before, 200 after);
   - a non-member of the group gets 404 (no access leak to outsiders);
   - a group grant insufficient for the requested operation is 403, not
     404 (existence is already implied by the grant they do hold);
   - **the one behavior nothing exercised at the integration tier
     before this task**: a direct grant and a group grant on the SAME
     user resolve to the HIGHER of the two (ADR-003 §6.1/§6.2 "effective
     level = max(ownership, direct grant, group grant)") — verified with
     a direct read grant + a group update grant on the same resource,
     confirming PATCH succeeds.
2. **Full resource lifecycle** — one new consolidated integration test in
   `resources.test.ts`: create → appears in the owner's LIST → GET
   returns expected fields → attach a tag via PATCH → move into a folder
   carrying a `permissionMask` (propagation takes effect for a third
   party, confirmed via that party's GET) → rename via PATCH (confirmed
   on a fresh GET) → soft-delete → confirm 404 on GET and absent from
   LIST, but present with `deleted: true` under `include_deleted=true`.

No functional or behavioral changes were made anywhere — this task is
coverage-only.

## Verification run (2026-09-23, fresh clone at commit b561d15)

```
pnpm install         — clean
pnpm -r typecheck     — clean (apps/services/api, apps/web, packages/crypto)
pnpm -r test          — 605 api (8 new group-sharing integration tests +
                         1 new full-lifecycle test) + 172 web + 52 crypto,
                         all passing
pnpm build            — clean, real tsc build for apps/services/api
                         (not just --noEmit)
node scripts/qa/scan-test-data.mjs
                       — same 13 findings as the established baseline,
                         all pre-existing/documented false positives;
                         nothing new from this task's files
gitleaks detect --no-git
                       — 143 findings, matching the established baseline
trufflehog filesystem --results=verified,unknown --fail
  (folders.test.ts, resources.test.ts)
                       — 0 verified, 0 unverified: clean
```

## Security

No real secret, credential, or PII in this file, the reviewed diff, or
the merged code. This task adds test coverage only — no new production
code paths, no new attack surface. The group-sharing tests specifically
close a coverage gap around access control (who can reach a shared
entity, and at what level), which is directly relevant to AR-2/AR-3 but
introduces no new risk itself.

## Verdict

`pass` — see `QA-VERDICT` comment on this card.
