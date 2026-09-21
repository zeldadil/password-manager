# BE-001h Integration Tests — Evidence

**Task:** t_cc570a8b (BE-001h)
**Branch:** feature/t_7918f010
**Commit:** be2c40d51b93341c52d26616742f38ec87453171
**Date:** 2026-09-21

## Test run

```
pnpm test  (vitest run)
Test Files  8 passed (8)
Tests       237 passed (237)
```

- 7 existing test files (219 tests) unchanged
- 1 new file: `apps/services/api/tests/be001h.integration.test.ts` (18 tests)
- Total: 8 files, 237 tests, 0 failures, 0 skipped

## Acceptance criterion coverage

### AC1 — Health endpoint
File: `tests/be001h.integration.test.ts` → `describe('GET /health (AC1)')`
- 200 + canonical `{ status, version, timestamp }` shape
- version = `0.1.0`, timestamp ISO-8601 UTC
- stability across repeated calls
- 404 on `/health/unknown`, 404 on non-GET methods

### AC2 — OpenAPI spec validity
File: `tests/be001h.integration.test.ts` → `describe('GET /openapi.json (AC2)')`
- 200 + content-type JSON
- OpenAPI 3.1.0 with info.title/version, paths
- `/health` and `/openapi.json` documented
- BearerAuth JWT security scheme
- EnvelopeHeader / EnvelopeSuccess / EnvelopeError / HealthResponse components
- Byte-identical to committed `openapi.json` artifact
- Request stability (cached, no mutation)
- 404 on non-GET methods

### AC3 — 404 / 500 envelope format
File: `tests/be001h.integration.test.ts` → `describe('404 / 500 envelope format (AC3)')`
- API 404 → ADR-004 error envelope (NotFound action, no URL segment leaked)
- Infra 404 → same envelope format
- 500 → no stack trace, no file path, no internal detail
- Synthetic token redacted end-to-end (runtime-built, gitleaks-clean)
- 500 body carries generic message only
- No double-wrap on 200 under `/api/v1`
- Infra endpoints (`/health`, `/openapi.json`) remain unwrapped

## Security
- No real credential, key, or PII in this file or the test file.
- Synthetic token assembled at runtime from fragments:
  `'1234567890' + ':' + 'A'.repeat(35)` — cannot be matched by gitleaks.

## PR
- PR #50: https://github.com/zeldadil/password-manager/pull/50
- Title: BE-001g + BE-001h: Unit + Integration Tests
- 12 commits, 8887 additions, 7 deletions, 45 changed files
