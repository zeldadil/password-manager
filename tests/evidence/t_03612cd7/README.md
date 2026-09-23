# BE-003f: Permission Model + Enforcement Middleware — QA Evidence

**Task:** t_03612cd7 (BE-003f)
**Landed on master via:** PR #73, commit 0ff6c95 (2026-09-23)

## Starting state

One real file survived in the task workspace
(`apps/services/api/src/services/permissions.ts`) from an earlier blocked
run — a genuine attempt, not zero-signal boilerplate. It was not trusted
at face value: read in full, checked against ADR-003 §6.1-6.2, and
verified with new tests before being adapted. Doing so surfaced a real
bug (below), which the salvaged file's own history had no test coverage
to catch.

## Bug found and fixed while adapting the salvaged code

`resolvePermissionLevel` originally picked the effective level for direct
grants and for group grants using
`db.query.permissions.findFirst({ ..., orderBy: (p, { desc }) => [desc(p.level)] })`.
`level` is a TEXT enum column (`'read' | 'update' | 'owner'`), so
`desc(level)` sorts **alphabetically** ("update" > "read" > "owner"), not
by actual permission strength. If a grantee ever had more than one
permission row for the same target (nothing in the schema prevents this),
the ORDER BY could return `'update'` when an `'owner'` row also existed,
silently under-authorizing — or, for group grants, pick a weaker group's
level over a stronger one.

Fixed by fetching **all** matching rows (`findMany`, no `orderBy`) and
reducing to the strongest via the numeric `PERMISSION_VALUES` mapping
(`read: 1, update: 7, owner: 15`) in application code, for both the
direct-grant and group-grant resolution paths. Two regression tests in
`permissions.test.ts` insert rows in an order that would trip the
alphabetical-sort bug if it were still present (read-then-owner for
direct grants; two groups with different levels) and assert the highest
level wins.

## Acceptance criteria

1. Centralized permission resolution (ownership → direct grant → group
   grant, highest wins) — **met**. See `apps/services/api/src/services/permissions.ts`
   and `apps/services/api/tests/permissions.test.ts` (21 unit tests, no
   server): pure `levelMeets` logic, ownership on resources and folders,
   stranger gets `null`, direct grants (read/update), the orderBy
   regression above, soft-deleted grants not honored, group grants
   (single + multiple, regression), non-member gets nothing, direct+group
   combine to the higher of the two, `hasPermission`/`requirePermission`
   happy and error paths (404 on no access, 403 on insufficient access).
2. Enforcement wired into folders and resources routes, replacing the
   ownership-only checks from BE-003b/BE-003d — **met**. GET requires
   Read+, PATCH/DELETE require Update+ (ADR-003 §6.2 — delete does not
   require Owner, a detail easy to get backwards by assuming DELETE needs
   the highest privilege level). No access at all → 404 (existence isn't
   confirmed to a total stranger); some access below the required level →
   403 (existence is already implied by the grant itself). Verified via 4
   new integration tests each in `folders.test.ts` and `resources.test.ts`:
   read-grant enables GET but not PATCH (403, not 404), update-grant
   enables both PATCH and DELETE, and a shared item does not appear in
   the grantee's own LIST.

## Scope decisions made explicit in code and tests

- **LIST/CREATE remain own-vault-scoped only.** ADR-004's
  `listFolders`/`listResources` descriptions say only "in authenticated
  user's vault", with no mention of aggregating cross-vault shared items
  into that list — merging shared items into LIST would be a materially
  larger, unspecified feature, not a natural extension of this task.
  Regression tests explicitly assert a shared folder/resource does *not*
  appear in the grantee's own LIST, so this boundary breaks loudly if
  someone later assumes LIST should include shared items.
- **PATCH's relational sub-field validation now scopes to the target
  entity's own vault, not the caller's.** Once cross-vault access became
  possible, `validateParent` (folders) and `validateFolderId`/
  `validateTagIds` (resources) had to check against `folder.vaultId` /
  `resource.vaultId` — the entity being edited — rather than the caller's
  own vault, since a grantee's own vault (if they even have one) is
  irrelevant to what tree/folder-set/tag-set the shared entity's
  sub-fields must reference. Covered implicitly by the existing PATCH
  tests (which continue to pass unchanged) plus the new sharing tests
  exercising PATCH through a grant.

## Verification run (2026-09-23, fresh clone at commit 0ff6c95)

```
pnpm install         — clean
pnpm -r typecheck     — clean (apps/services/api, apps/web, packages/crypto)
pnpm -r test          — 558 api (21 permissions + 8 new folders/resources
                         sharing tests) + 172 web + 52 crypto, all passing
pnpm build            — clean, real tsc build for apps/services/api
                         (not just --noEmit; Piège n°6)
node scripts/qa/scan-test-data.mjs
                       — same 13 findings as the established baseline,
                         all pre-existing/documented false positives
                         (Piège n°7); nothing new from this task's files
gitleaks detect --no-git
                       — 143 findings, matching the established baseline
trufflehog filesystem --results=verified,unknown --fail
  (permissions.ts, permissions.test.ts, folders.ts, resources.ts,
   folders.test.ts, resources.test.ts, error-handler.ts, auth-guard.ts)
                       — 0 verified, 0 unverified: clean
```

## Security

No real secret, credential, or PII in this file, the reviewed diff, or the
merged code. This task governs authorization decisions (who may read/
write which folder/resource), not the encryption or storage of secret
values themselves — AR-2 is unaffected; no vault key, master password, or
resource secret is read, logged, or persisted anywhere in this change.

## Verdict

`pass` — see `QA-VERDICT` comment on this card.
