# BE-001g: Unit Tests — Evidence

Branch: `feature/t_7918f010`
Commit: `a88ba5d`
PR: https://github.com/zeldadil/password-manager/pull/50

## Test Results

### vitest (219/219 passed, 7 test files)

| Test File | Tests | Covers |
|---|---|---|
| tests/migration.test.ts |  — | BE-001a: migration up (baseline applies, all 11 tables + drizzle tracking, columns/types/defaults, FK enforcement, unique indexes, soft-delete, crypto boundary) |
| tests/envelope.test.ts |  — | BE-001d: envelope middleware (pure helpers buildEnvelopeHeader/deriveAction/isEnvelope/createSuccessEnvelope + preSerialization hook via fastify.inject) |
| tests/query.test.ts | 58 | BE-001e: query parsers (parseIncludes 16, parseFilters 17, parsePagination 14, parseQuery 11) |
| tests/error-handler.test.ts |  — | BE-001f: error envelope handler (setErrorHandler + setNotFoundHandler, bearer redaction) |
| tests/health.test.ts |  — | BE-001c: health endpoint |
| tests/openapi.test.ts |  — | BE-001c: OpenAPI spec served |
| tests/schema-indexes.test.ts |  — | BE-001b: FK indexes on core tables |

### typecheck
`tsc --noEmit` — exit 0 (clean)

### Summary by acceptance criterion

1. **Migration up/down** — `tests/migration.test.ts` covers:
   - Baseline migration `0000_baseline_schema.sql` applies cleanly to in-memory SQLite
   - All 11 ADR-003 tables created (`users`, `vaults`, `folders`, `resources`, `tags`, `resource_tags`, `permissions`, `groups`, `group_members`, `sessions`, `refresh_tokens`) + `__drizzle_migrations`
   - Column types verified (BLOB for salt/KDF/vault-key/recovery-kit, TEXT for kdf_params/settings)
   - No plaintext secret columns (master_password, password, etc. absent)
   - FK enforcement (reject invalid parent, cascade behavior)
   - Unique constraints (`users_email_unique`, `users_username_unique`, `refresh_tokens_token_hash_unique`)
   - Soft-delete: `deleted_at` nullable on all entity tables

2. **Envelope middleware** — `tests/envelope.test.ts` covers:
   - Pure helpers: `buildEnvelopeHeader` (UUID v4 id, ISO-8601 servertime, status/action/code/message/url), `deriveAction` (operationId + verb+noun fallback), `isEnvelope` (header+body duck-type, false for primitives/arrays/null), `createSuccessEnvelope`
   - Hook integration via `fastify.inject`: /api/v1 2xx object responses wrapped in `{header, body}` envelope; non-2xx, non-object, already-enveloped, and infra (`/health`, `/openapi.json`) passed through without double-wrapping
   - Unique response id per request

3. **Include/filter parsers** — `tests/query.test.ts` (58 tests) covers:
   - `parseIncludes` (16): empty/null/undefined/empty-string/empty-array → empty set; single value, comma-separated string, array (include[] form); de-duplication (within string + across array); whitespace trimming; unknown value dropping (silent); mixed array with unknowns; empty strings in array; non-string/array primitives → empty; all four allowed relations (permissions/tags/folder/group); case-sensitivity (wrong case rejected)
   - `parseFilters` (17): empty/null/undefined/empty-string → empty clauses; single clause `field:operator:value`; all 8 operators (eq/ne/gt/gte/lt/lte/contains/in); colons preserved in value (ISO timestamps); array of clauses; object form (`filter[field]=operator:value`); drops malformed (no colon, unknown operator, empty field, empty value, no operator value, field starts with colon); mixed valid/invalid; object form non-string values dropped; clause order preserved; whitespace trimming; array with empty/whitespace strings; object form value without colon dropped
   - `parsePagination` (14): defaults (page=1, per_page=20, offset=0, limit=20); page=1/5; per_page=50; both together; clamp page<1 to 1; clamp per_page>100 to 100; clamp per_page<1 to 1; non-numeric → defaults; numeric inputs; fractional floor; high page offset computation
   - `parseQuery` (11): empty defaults; combine include+filter+pagination; filter object form + include; unknown top-level params ignored; per_page underscore; cap at MAX_PER_PAGE in combined form; clamp page to 1 in combined form; all four includes + multiple filters + pagination
