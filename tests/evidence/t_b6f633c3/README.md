# BE-003d: Folder CRUD + Tree + Permission Mask — QA Evidence

**Task:** t_b6f633c3 (BE-003d)
**Landed on master via:** PR #64, commit 2977b85 (2026-09-23)

## Starting state

Task was `blocked`, not `todo` — 19 dispatched runs, all `rate_limited` or
`crashed` (one run exited cleanly without calling `kanban_complete`/
`kanban_block`/`kanban_request_review`, a protocol violation; the final run
crashed on a malformed Nous Portal request unrelated to the task content).
No branch, no PR, empty workspace — zero code had ever been produced for
this task. Implemented from scratch rather than salvaged from a stale
branch (unlike the BE-002/FE-002 cards handled earlier in this sweep).

## Acceptance criterion

1. `POST/GET/PATCH/DELETE /folders` — tree structure (`parent_id`),
   permission mask (owner/update/read) — **met**. See
   `apps/services/api/tests/folders.test.ts` (23 tests): create (root +
   child + permissionMask), list (own-vault scoping only), get (404 for
   nonexistent, 404 — not 403 — for another user's folder), update (field
   updates, re-parenting, self-parent rejection, cycle rejection,
   permissionMask set/clear), delete (soft-delete, child folders
   re-parented to root, cross-user 404).

## Scope boundaries (verified against ADR-003 §3.4/§3.5 and the live board)

- `permissionMask` is stored/returned on the folder but **not** propagated
  to resources at create/move time — ADR-003 §3.4 assigns that explicitly
  to a separate task, **BE-003g** ("Folder Permission Mask Propagation"),
  confirmed still `todo` on the board. Not silently dropped from this
  card's scope; the code's own docblock states the boundary.
- Authorization is ownership-only (`folder.ownerId === caller`). The
  `permissions`-table grantee-based enforcement is **BE-003f**'s scope
  ("Permission Model + Enforcement Middleware"), confirmed still `todo`.
  Ownership is ADR-003 §3.5's documented baseline in the meantime.

## Real prerequisite gap found and fixed

Nothing in the codebase created a user's vault (`vaults` table) before
this task — not registration, not anywhere else. ADR-003 §3.2 specifies
exactly one vault per user in MVP, and `folders.vaultId` is a `NOT NULL`
FK to it, so folder creation could not have succeeded for any user without
this fix. Added vault auto-creation to `POST /auth/register`
(`apps/services/api/src/auth/register.ts`).

## Verification run (2026-09-23, fresh clone at commit 2977b85)

```
pnpm install        — clean
pnpm typecheck       — clean (apps/services/api, apps/web, packages/crypto)
pnpm test            — 481 api (23 new for this task) + 172 web + 52 crypto
                        = 705/705 passing
pnpm build           — clean, real tsc build (not just --noEmit)
node scripts/qa/scan-test-data.mjs
                      — same 13 findings as before this task, all
                        pre-existing/documented false positives; nothing
                        new from folders.test.ts's synthetic fixtures
gitleaks detect --no-git
                      — no findings in any new/changed file
trufflehog filesystem — no findings in any new/changed file
```

## Security

No real secret, credential, or PII in this file, the reviewed diff, or the
merged code. Folders carry only non-secret metadata (name, description,
icon, color) — AR-2 is satisfied by construction (the module never touches
vault keys, master passwords, or ciphertext).

## Verdict

`pass` — see `QA-VERDICT` comment on this card.
