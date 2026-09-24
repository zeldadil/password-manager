# BE-003h: Search Endpoint — QA Evidence

**Task:** t_d696f175 (BE-003h)
**Landed on master via:** PR #77, commit 443eb1b (2026-09-23)

## Starting state

`blocked`, no diagnostic reason recorded (`hermes kanban log t_d696f175`
shows a 5-second run with no output before blocking). Empty workspace, no
branch, no PR anywhere referencing this task or BE-003h — same "zero
surviving code, pure infra failure" pattern as the other BE-003 tasks
worked in this sweep. Implemented from scratch against the task body and
ADR-004's `filter[]`/`include[]` query parameter contract.

## Acceptance criterion

> `GET /resources?filter[search]=...&include=tags,folder,permissions` —
> searches metadata (name, username, uri)

**Met** for the operative requirement — search. `filter[search]=<term>`
(and the array form `filter[]=search:<term>`) performs a case-insensitive
substring match across `name`, `username`, and `uri`, the three fields the
criterion names. `include=tags,folder,permissions` in the example URL was
already parseable by the pre-existing query middleware (BE-001e) before
this task, and `tagIds`/`permissionIds` are already always present on
every Resource DTO per the ADR-004 schema (which has no embedded-object
fields for these relations — only id arrays); `folder` is accepted as a
valid include token but has no corresponding embedded field to expand
into, since the Resource schema doesn't define one. See the module
docblock in `routes/resources.ts` for the full reasoning — expanding to
embedded relation objects would be a schema change outside this task's
single, narrowly-worded acceptance criterion.

## Bug found and fixed while making the acceptance criterion's own example URL actually work

While wiring up search, I found that the literal example URL in the
acceptance criterion — `GET /resources?filter[search]=...` — did not
reach the query-parsing code at all. Fastify's default query-string
parser does not nest bracket keys: `filter[search]=foo` arrives at the
route as the *literal* key `"filter[search]"`, not as `filter: { search:
'foo' }`. `queryPreHandler` (`middleware/query.ts`) only ever read the
flat `filter`/`include` keys — so every bracket-form query the ADR-004
contract actually specifies (`filter[]=...`, `include[]=...`,
`filter[field]=value`) silently parsed to nothing, for every route that
uses this middleware (folders, resources, tags), not just this task's
endpoint. Confirmed empirically (`fastify.inject` + a debug echo route)
before fixing, not assumed.

Fixed by adding `collectBracketed()` in `middleware/query.ts`, which
normalizes `filter[]`, `filter[field]=value`, and `include[]` keys into
the flat string-array shape the existing pure parsing functions
(`query-parse.ts`) already handle — additive only: it doesn't touch the
pure parsing functions, doesn't add a dependency (no `qs`/bracket-parser
plugin), and existing flat `?filter=...`/`?include=...` usage is
unaffected. Verified via integration tests that hit the server with real
bracket-style URLs (`?filter[search]=...`, `?filter[]=search:...`), not
just unit tests of the pure parser.

## Design decisions made explicit in code and tests

- **`search` is a virtual field, not a real column.** Every other
  `filter[]` field requires an explicit operator (`field:operator:value`,
  e.g. `name:contains:foo`). `search` is the one exception: its value
  never needs an operator prefix (`filter[search]=foo` and
  `filter[]=search:foo` both mean "contains foo") — matching the literal
  form in the acceptance criterion's own example, and implemented as a
  special case in `tryParseOneFilter` (mirrored into
  `packages/shared/src/query.ts` per that module's existing sync
  convention).
- **`description` is deliberately excluded** from the searched columns —
  the acceptance criterion names only name/username/uri.
- **LIKE-wildcard escaping.** The caller's literal `%`, `_`, and `\` are
  escaped before being embedded in the `LIKE '%...%' ESCAPE '\'` pattern,
  so a search for "100%" matches that literal text rather than being
  silently reinterpreted as a SQL wildcard.
- **`metadataEncrypted` resources are only searchable by name.** Their
  `username`/`uri` are never persisted as plaintext (AR-2 — the server
  never decrypts), so a substring search naturally can't find anything in
  those columns for such resources. This is a real, intentional
  consequence of the encryption boundary, not a bug — documented in the
  module docblock and covered by a dedicated regression test.
- **Search stays scoped to the caller's own vault** — unchanged from
  BE-003b/BE-003f; search doesn't reach into permission-shared resources
  in other vaults, consistent with every other LIST endpoint in this
  codebase.

## Verification run (2026-09-23, fresh clone at commit 443eb1b)

```
pnpm install         — clean
pnpm -r typecheck     — clean (apps/services/api, apps/web, packages/crypto)
                        plus a standalone tsc check of packages/shared/
                        src/query.ts (not wired into `pnpm -r typecheck`,
                        since packages/shared has no typecheck script yet)
pnpm -r test          — 580 api (6 new query.test.ts unit tests + 8 new
                         resources.test.ts integration tests) + 172 web +
                         52 crypto, all passing
pnpm build            — clean, real tsc build for apps/services/api
                         (not just --noEmit)
node scripts/qa/scan-test-data.mjs
                       — same 13 findings as the established baseline,
                         all pre-existing/documented false positives;
                         nothing new from this task's files
gitleaks detect --no-git
                       — 143 findings, matching the established baseline
trufflehog filesystem --results=verified,unknown --fail
  (resources.ts, query.ts, query-parse.ts, query.test.ts,
   resources.test.ts, packages/shared/src/query.ts)
                       — 0 verified, 0 unverified: clean
```

## Security

No real secret, credential, or PII in this file, the reviewed diff, or
the merged code. AR-2 is explicitly preserved and tested: search never
decrypts anything and cannot find metadata that was encrypted, only
plaintext columns the server already held (name always; username/uri
only when `metadataEncrypted` is false).

## Verdict

`pass` — see `QA-VERDICT` comment on this card.
