# BE-003b: Resource CRUD API + Schema — QA Evidence

**Task:** t_ddd8fb1e (BE-003b)
**Landed on master via:** PR #66, commit eff5c04 (2026-09-23)

## Starting state

Task was `blocked` — 7 dispatched runs, all `rate_limited` or `crashed`
(final run crashed on a malformed Nous Portal request unrelated to task
content). No branch, no PR, empty workspace — zero code had ever been
produced. Implemented from scratch, same situation as BE-003d
(`t_b6f633c3`, handled immediately before this in the same sweep).

## Acceptance criteria

1. `POST/GET/PATCH/DELETE /resources` — metadata in request/response, API
   never sees plaintext secret — **met**. `secretCiphertext`/`secretIv`/
   `secretTag` are handled as opaque base64 blobs throughout; the API
   decodes/encodes the wire encoding only, never inspects or transforms
   the plaintext they represent.
2. Resource schema per ADR-003 (`id, vault_id, folder_id?, name, username?,
   uri?, description?, resource_type, metadata_encrypted, created_at,
   updated_at, deleted_at`) — **met**, already present on `master`'s
   `schema.ts` (`resources` table); this task wires the API layer to it.

See `apps/services/api/tests/resources.test.ts` (26 tests): create
(plaintext + encrypted metadata, missing-field validation, invalid type,
folder/tag attachment, invalid folderId/tagId, invalid base64, vaultId
mismatch), list (own-vault scoping, soft-delete filtering via
`include_deleted`), get (404 for nonexistent + cross-user), update (field
updates, secret rotation, `metadataEncrypted` toggle on/off with
plaintext-clearing/ciphertext-clearing semantics, tag replace, folder
move, cross-user 404), delete (soft-delete, cross-user 404 with no
side-effect).

## Scope boundaries (verified against ADR-003 §3.3/§3.4/§6.3 and the live board)

- Folder `permissionMask` propagation to resources at create/move time is
  explicitly **not** this task's job — ADR-003 §3.4/§6.3 assigns that to
  **BE-003g** ("Folder Permission Mask Propagation"), confirmed still
  `todo`. `folderId` is validated (must exist, must be in the caller's
  vault) but the mask itself is inert here — same boundary as BE-003d.
- Tag entity CRUD (creating/renaming/deleting tags) is **BE-003e**'s job,
  confirmed still `todo`. This task only attaches/detaches *existing* tag
  ids via the `resource_tags` junction (the `tagIds` field on the
  resource itself, per ADR-004).
- Authorization is ownership-only. Grantee-based `permissions`-table
  enforcement is **BE-003f**'s job, confirmed still `todo` — ownership is
  ADR-003 §3.5's documented baseline in the meantime.

## Real defect found and fixed in this task's own test fixtures

`scan-test-data.mjs` flagged a literal `https://github.com` URI in the
draft test fixtures — a real, live domain, not synthetic. Fixed to
`https://example.test` (RFC 2606 reserved) before landing, matching this
repo's established convention.

## Verification run (2026-09-23, fresh clone at commit eff5c04)

```
pnpm install        — clean
pnpm typecheck       — clean (apps/services/api, apps/web, packages/crypto)
pnpm test            — 507 api (26 new for this task) + 172 web + 52
                        crypto = 731/731 passing
pnpm build           — clean, real tsc build (not just --noEmit)
node scripts/qa/scan-test-data.mjs
                      — same 13 findings as before this task, all
                        pre-existing/documented false positives; nothing
                        new from resources.test.ts's synthetic fixtures
                        (after the github.com fix above)
gitleaks detect --no-git
                      — no findings in any new/changed file
trufflehog filesystem — no findings in any new/changed file
```

## Security

No real secret, credential, or PII in this file, the reviewed diff, or the
merged code. The "secrets" exercised in tests are synthetic opaque byte
strings the API never decrypts — AR-2 is satisfied by construction (this
module performs no crypto and never touches a vault key or master
password).

## Verdict

`pass` — see `QA-VERDICT` comment on this card.
