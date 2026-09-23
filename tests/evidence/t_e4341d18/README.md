# BE-003k: Security Tests — QA Evidence

**Task:** t_e4341d18 (BE-003k)
**Landed on master via:** PR #83, commit 3ddf0a6 (2026-09-23)

## Starting state

`ready` (not yet promoted), manually moved to `blocked` per user request
(`hermes kanban block t_e4341d18 ...`) so it could be processed directly
through the standard investigate/implement/verify/merge/evidence/
QA-VERDICT workflow used for BE-003b through BE-003j in this sweep,
rather than through a normal agent dispatch. No branch, no PR anywhere
referencing this task. This is a coverage/consolidation task — its
acceptance criterion asks for specific security properties to be tested,
not for new production features.

## Acceptance criterion

> Tampered ciphertext rejected, unauthorized access denied, metadata
> leakage check, IV/nonce reuse detection

## New dedicated security test suite

Created `apps/services/api/tests/security-be003.test.ts` (10 tests),
mirroring the structure `auth/security.test.ts` (BE-002h) established for
the auth domain, plus one addition to `packages/crypto/tests/crypto.test.ts`
(the only layer that actually generates IVs).

### IV/nonce reuse detection

The existing crypto test ("different iv each encryption") only proved
distinctness for a single pair. Added a statistical test: 5000
encryptions from the same key, asserting zero IV collisions
(`packages/crypto/tests/crypto.test.ts`). This is the correct layer for
this test — nothing in `apps/services/api` generates IVs; the server only
stores and returns the opaque bytes the client already encrypted.

### Unauthorized access denied — enumeration resistance

While investigating this item, found that `routes/resources.ts` /
`routes/folders.ts` throw internally different 404 messages depending on
cause: `"Resource not found"` (capital R, from the route's own existence
pre-check) vs. the lowercase `"resource not found"`
(`services/permissions.ts`'s `requirePermission`, thrown when the
resource exists but the caller has zero access). **Confirmed this is NOT
an actual leak** by reading `middleware/error-handler.ts`:
`buildErrorEnvelope` maps every thrown error through a FIXED
`friendlyMessage(statusCode)` lookup table and never echoes the internal
`httpError` message to the client — the specific string passed to
`httpError()` only ever reaches server-side logs.

Added tests that pin this architectural guarantee down explicitly for
this domain (it was previously true only by omission, not proven):
- a nonexistent resource id and someone else's private resource produce
  byte-identical 404 response bodies (modulo the per-request envelope
  id/timestamp, stripped for comparison);
- the same holds for folders;
- a malformed (non-UUID) id produces the identical 404 to a well-formed
  but missing one — no format-based signal either;
- every 404's message is exactly `"The requested resource could not be
  found."`, and the response payload never contains the internal
  `"Resource not found"` string.

If a future change ever made `httpError` messages more specific and
accidentally started echoing them to the client, this suite would catch
the regression before it became a real information-disclosure bug.

### Metadata leakage check

A resource created with `metadataEncrypted: true` and distinctive
plaintext `username`/`uri` values is checked against the **full raw
response body** (not just named fields) across create, get, list, patch,
and delete responses — plus a 400 error path triggered by the same
payload. The plaintext never appears anywhere. Checking the whole payload
string rather than specific fields guards against a future schema change
silently reintroducing a leak through a field this test wasn't written
with knowledge of.

### Tampered ciphertext rejected

Documented (not asserted against a live route, since there's nothing to
assert) that real AEAD tamper-detection — auth-tag verification, the
actual security property "tampered ciphertext rejected" refers to — is
entirely a client-side, `packages/crypto` concern. The server never holds
a vault key (AR-2), so it structurally cannot verify a tamper; it treats
`secretCiphertext`/`secretIv`/`secretTag` as opaque bytes end to end. The
real guarantee is already exhaustively covered by `crypto.test.ts`'s
"encrypt / decrypt (AES-256-GCM)" tests (tampered ciphertext, tampered
tag, wrong key, wrong AAD — all throw).

While writing this, found the API's base64 "validation" is looser than
its own test's name (`"returns 400 for non-base64 secretCiphertext"`)
implied: that test actually only exercises the *empty string* case.
`Buffer.from(x, 'base64')` never throws in Node — it lenient-decodes,
silently skipping characters outside the base64 alphabet — so genuinely
malformed (non-empty) content is **accepted** as an opaque blob, not
rejected. Documented this as intentional rather than patched: the server
never interprets these bytes, so their base64-well-formedness is
irrelevant to it; real corruption is caught client-side at decrypt time,
which is the only place it can actually be acted on. Patching this would
be a production-code scope decision belonging to a separate task, not
something a security-*test* task should slip in. Confirmed the actually
enforced constraint — empty/non-string rejected with 400 — holds on both
POST and PATCH (PATCH wasn't previously tested at all for this).

No functional or behavioral changes were made anywhere in this task.

## Verification run (2026-09-23, fresh clone at commit 3ddf0a6)

```
pnpm install         — clean
pnpm -r typecheck     — clean (apps/services/api, apps/web, packages/crypto)
pnpm -r test          — 615 api (10 new security-be003.test.ts tests) +
                         172 web + 53 crypto (1 new IV-reuse statistical
                         test), all passing
pnpm build            — clean, real tsc build for apps/services/api
                         (not just --noEmit)
node scripts/qa/scan-test-data.mjs
                       — same 13 findings as the established baseline,
                         all pre-existing/documented false positives;
                         nothing new from this task's files
gitleaks detect --no-git
                       — 143 findings, matching the established baseline
trufflehog filesystem --results=verified,unknown --fail
  (security-be003.test.ts, crypto.test.ts)
                       — 0 verified, 0 unverified: clean
```

## Security

No real secret, credential, or PII in this file, the reviewed diff, or
the merged code. This task's entire purpose is closing security-test
coverage gaps; the two real findings during the audit (the internal
404-message case difference, and the base64 lenient-decoding behavior)
were both investigated to their actual conclusion (neither is an
exploitable leak given the architecture) rather than assumed, and are
now pinned down by regression tests.

## Verdict

`pass` — see `QA-VERDICT` comment on this card.
