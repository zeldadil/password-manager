# BE-003i: Unit Tests — QA Evidence

**Task:** t_a7b64b39 (BE-003i)
**Landed on master via:** PR #79, commit 2ccd22e (2026-09-23)

## Starting state

`blocked`, no diagnostic reason recorded, no workspace directory created
(`hermes kanban log t_a7b64b39` shows blocked immediately with no run
output). No branch, no PR anywhere referencing this task or BE-003i.
Unlike BE-003b/d/e/f/g/h, this is not an "implement from scratch" task —
its acceptance criterion asks for existing functionality to be covered by
unit tests, so the real work was an audit: verify what coverage already
exists, then fill genuine gaps rather than write redundant tests.

## Acceptance criterion

> Encryption/decryption roundtrip, permission checks, mask propagation
> logic, search filtering covered

**Audited, not assumed** — I read the actual test files for each of the
four named areas before concluding anything:

| Area | Existing coverage found | Source task |
|---|---|---|
| Encryption/decryption roundtrip | 37 tests in `packages/crypto/tests/crypto.test.ts` (AES-256-GCM encrypt/decrypt, tamper-detection on ciphertext/iv/tag/AAD, register→unlock roundtrip, storage-format round-trip) | BE-002a/b |
| Permission checks | 26 tests in `apps/services/api/tests/permissions.test.ts` (ownership, direct grants, group grants, `hasPermission`/`requirePermission` 404-vs-403) | BE-003f |
| Mask propagation logic | 5 tests in `permissions.test.ts`'s `applyFolderPermissionMask` describe block (Owner-only propagation, no-op cases, idempotency) | BE-003g |
| Search filtering | 6 unit tests (`query.test.ts`, the `search` filter field's parsing) + 8 integration tests (`resources.test.ts`) | BE-003h |

All four areas already had substantial coverage — three of them (crypto,
permissions, mask propagation) at the codebase's own "unit" tier (direct
DB/pure-function calls, no Fastify server), matching this task's `Test
Types: unit` field.

## Two genuine gaps found and filled

1. **No isolated unit coverage of the API layer's wire-encoding roundtrip
   or the search filter's escaping logic** — only indirect coverage via
   full HTTP integration tests. `b64ToBuffer`/`bufferToB64`
   (base64↔Buffer, the wire encoding underneath "encryption/decryption
   roundtrip" at the API boundary) and a newly-extracted pure
   `escapeLikeTerm` (the LIKE-wildcard escaping underneath "search
   filtering") were private, module-local functions in
   `routes/resources.ts` with no test importing them directly.
   Exported all three (no behavior change — `buildSearchCondition` now
   calls the extracted `escapeLikeTerm` instead of inlining the same
   regex) and added `tests/resources-helpers.test.ts`: 15 pure unit
   tests — no server, no DB — covering roundtrip correctness (including
   binary-safety, not just UTF-8 text), error paths, and every
   LIKE-wildcard escape case (`%`, `_`, `\`, combinations, empty string).

2. **No test proved secretCiphertext/secretIv/secretTag survive a real
   database roundtrip.** The existing "gets a single resource by id"
   integration test only asserted on `name`. The POST-create test that
   did check these fields only verifies the *immediate* response, which
   trivially echoes what the handler just computed at insert time — not
   proof the DB round-trips the bytes correctly. Added a dedicated test
   that creates a resource, then fetches it via a **separate** GET
   request, and asserts byte-exact (base64) equality on all three
   ciphertext-related fields.

No functional or behavioral changes were made anywhere — this task is
coverage-only, and every pre-existing test (596 in the api package before
this task's own additions) continued to pass unmodified.

## Verification run (2026-09-23, fresh clone at commit 2ccd22e)

```
pnpm install         — clean
pnpm -r typecheck     — clean (apps/services/api, apps/web, packages/crypto)
pnpm -r test          — 596 api (15 new resources-helpers.test.ts unit
                         tests + 1 new resources.test.ts roundtrip test)
                         + 172 web + 52 crypto, all passing
pnpm build            — clean, real tsc build for apps/services/api
                         (not just --noEmit)
node scripts/qa/scan-test-data.mjs
                       — same 13 findings as the established baseline,
                         all pre-existing/documented false positives;
                         nothing new from this task's files
gitleaks detect --no-git
                       — 143 findings, matching the established baseline
trufflehog filesystem --results=verified,unknown --fail
  (resources.ts, resources-helpers.test.ts, resources.test.ts)
                       — 0 verified, 0 unverified: clean
```

## Security

No real secret, credential, or PII in this file, the reviewed diff, or
the merged code. This task adds test coverage only — no new production
code paths, no new attack surface. The wire-encoding tests are careful to
use only synthetic byte sequences, never anything password- or
credential-shaped (AR-4).

## Verdict

`pass` — see `QA-VERDICT` comment on this card.
