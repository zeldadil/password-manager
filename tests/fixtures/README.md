# Synthetic Fixtures — `tests/fixtures/`

Owned by QA-001e (`t_204ae591`). Implements TEST_STRATEGY.md §7 (Synthetic Data
Policy) and SEC-001 **AR-4 (Synthetic Fixtures Only)**.

## What this is

The single source of test data for the whole repo. Every factory here is
**synthetic by construction**:

| Category | Source | Example |
|---|---|---|
| IDs / UUIDs | `node:crypto.randomUUID()` | `c1d3…-…` |
| Timestamps | fixed constant | `2026-01-01T00:00:00.000Z` |
| Usernames / emails | reserved TLD only | `testuser`, `user-2@example.test` |
| Resource names | fixed index patterns | `test-resource-1`, `db-test-account-2` |
| URLs | reserved TLD only (`.test`) | `https://app.example.test/login` |
| Tags / folders | fixed vocabulary / index | `test`, `test-folder-1` |
| Master passwords | `randomBytes(18)` per run | (36-char hex, ~144 bit) |
| Secrets | `test-secret-<randomhex>` per run | `test-secret-9f2a…` |
| Keys / salt / nonce / tag | `randomBytes(n)` per run | hex |
| Crypto vectors | published RFC vectors, cited | `JBSWY3DPEHPK3PXP` (RFC 4648 §10) |

**No real password, key, token, username, domain, or PII exists anywhere in this
directory.** No `.json` / `.csv` data dumps — code only (TEST_STRATEGY §7).

## Design rules

1. **Structured data is deterministic** where reproducibility matters (fixed
   constants / index patterns, and a seeded PRNG — `seed.ts` — for bulk variety).
2. **Secret material is crypto-random per run** — `node:crypto.randomBytes`,
   never `Math.random`, never a dictionary word, never memorized (AR-4, SEC-001
   Decision 4).
3. **Zero runtime dependencies.** The factories import only `node:crypto` and
   each other, so they run during the monorepo bootstrap (no `pnpm install`
   needed) and are trivially auditable. The TEST_STRATEGY §7 note about
   `@faker-js/faker` is satisfied in spirit — fixed seed + determinism — without
   a bootstrap-blocking dependency; faker can be layered on later if richer
   structured data is wanted.

## Usage

```ts
import { syntheticUser, syntheticResource, syntheticSecretRecord, syntheticMasterPassword } from "./index.ts";

const user = syntheticUser();              // deterministic username/email, unique id
const resource = syntheticResource(1);     // "test-resource-1", uri on .test
const secret = syntheticSecretRecord(resource.id); // generated per run, never real
const master = syntheticMasterPassword();  // random 36-hex, never a word
```

Import with an explicit `.ts` extension. Consumers that run `tsc --noEmit`
should enable `allowImportingTsExtensions: true` (or add `tests/fixtures` to
their tsconfig `include` with that flag). The `node --experimental-strip-types`
runner and Vitest/esbuild both handle `.ts`-extension imports without config.

## Enforcement

- `pnpm scan:test-data` → `scripts/qa/scan-test-data.mjs` scans this directory
  (and all other test code) for forbidden patterns (real TLDs, dictionary
  passwords, secret-shaped blobs, PII). Pre-commit + CI.
- `scripts/qa/validate-fixtures.mjs` proves determinism (same seed → same
  structured output) and synthetic-only (secrets are random-generated, not
  hard-coded).

## See also

- `tests/fixtures/fixtures.test.ts` — the Vitest determinism + hygiene suite (CI).
- `tests/evidence/t_204ae591/` — self-validation evidence for this card.
