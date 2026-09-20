# BE-001e: Query Middleware — Evidence

## Acceptance criteria status

| # | Criterion | Status |
|---|---|---|
| 1 | `include[]` parser for eager loading (permissions, tags, folder, group) | ✅ Pass |
| 2 | `filter[]` and pagination (`page`, `per_page`) middleware | ✅ Pass |

## Test run

```
cd apps/services/api && npx vitest run --config vitest.config.ts tests/query.test.ts

Test Files  1 passed (1)
Tests       58 passed (58)
Duration    257ms
```

All 58 tests in `apps/services/api/tests/query.test.ts` pass.

## Files delivered

- `packages/shared/src/query.ts` — pure parsing functions + `QueryParsed` type alias
- `packages/shared/src/index.ts` — re-exports from `./query`
- `apps/services/api/src/middleware/query.ts` — Fastify `queryPreHandler` hook
- `apps/services/api/tests/query.test.ts` — 58 unit tests

## PR

https://github.com/zeldadil/password-manager/pull/48
