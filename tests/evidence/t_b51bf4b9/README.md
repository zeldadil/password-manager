# BE-003c: Secret Schema — QA Evidence

**Task:** t_b51bf4b9 (BE-003c)
**Landed on master via:** PR #69, commit eec2e33 (2026-09-23)

## Starting state

Task was `blocked` with no diagnostic recorded. `hermes kanban log
t_b51bf4b9` shows a real, in-progress attempt (reading `schema.ts`,
locating the insertion point, confirming no `secrets` table existed yet)
that got mid-flight blocked by a sandbox security-scan gate on an `npx`
command before it could commit anything — a different failure mode from
the pure crash/rate-limit pattern on BE-003b/d, but the net result was
the same: no branch, no PR, no workspace content, zero code landed
anywhere. Implemented independently against the task spec and ADR-003,
not reconstructed from that attempt (nothing from it survived to inspect).

## Acceptance criterion

1. `id, resource_id, user_id, ciphertext, iv, tag, created_at, updated_at`
   — one secret per resource per user (for sharing) — **met**. The
   `secrets` table (`apps/services/api/src/schema.ts`) has exactly these
   columns (plus the standard `id` primary key already implied). See
   `apps/services/api/tests/migration.test.ts`'s new `secrets table —
   per-grantee encrypted copies for sharing (BE-003c)` block (4 tests:
   column presence, BLOB typing on ciphertext/iv/tag, FKs to resources +
   users, absence of `deleted_at`) and the updated `Cascade delete
   behavior` block.

## Scope note

Test Types on this task's own spec is `unit` only — no HTTP verbs are
listed in its body, unlike BE-003b/d/e. Confirmed this is schema-only by
design: no `/api/v1/secrets` endpoint exists or was expected. A future
sharing endpoint (once BE-003f permission enforcement exists to gate who
may create a share) is what will write/read these rows.

## Design decisions verified against precedent already in this schema

- No `deleted_at` on `secrets`: matches `resource_tags`' junction-table
  treatment (hard-delete on revoke), not the soft-delete convention used
  for standalone entities — confirmed via a dedicated negative test.
- No DB-level composite unique constraint on `(resource_id, user_id)`:
  matches `group_members`' existing `(group_id, user_id)` pairing, which
  also has no DB-level uniqueness — the "one secret per resource per
  user" invariant is left to the future sharing endpoint, consistent with
  this codebase's established pattern (e.g. folder cycle-prevention is
  also application-level, not a DB constraint).
- `onDelete: cascade` on both FKs: matches `resource_tags`' precedent for
  this class of table.

Two existing schema-truth test files each independently asserted a fixed
table count/list (`migration.test.ts`'s `ALL_TABLES`,
`schema-indexes.test.ts`'s own separate list + `FK_TABLES`) — both needed
updating for the new table; found and fixed both, not just the first one
encountered.

## Verification run (2026-09-23, fresh clone at commit eec2e33)

```
pnpm install        — clean
pnpm typecheck       — clean (apps/services/api, apps/web, packages/crypto)
pnpm test            — 513 api (11 new/updated for this task) + 172 web +
                        52 crypto = 737/737 passing
pnpm build           — clean, real tsc build (not just --noEmit)
node scripts/qa/scan-test-data.mjs
                      — same 13 findings as before this task, all
                        pre-existing/documented false positives
gitleaks detect --no-git
                      — no findings in any new/changed file
trufflehog filesystem — no findings in any new/changed file
```

## Security

No real secret, credential, or PII in this file, the reviewed diff, or the
merged code. This is a schema-only change — no route handler, no crypto,
no request/response path exists yet to carry real data through it.

## Verdict

`pass` — see `QA-VERDICT` comment on this card.
