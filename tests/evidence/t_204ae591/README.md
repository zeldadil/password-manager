# Evidence — QA-001e (`t_204ae591`): Synthetic Fixtures + Coverage Thresholds

Deliverables (branch `feature/t_204ae591`):

| Artifact | What it is |
|---|---|
| `tests/fixtures/` | Synthetic-only data generator (AR-4) — TS factories, zero runtime deps |
| `scripts/qa/scan-test-data.mjs` | `pnpm scan:test-data` enforcement scanner (real TLDs, dictionary passwords, secret shapes, PII) |
| `tests/coverage-gates/thresholds.ts` | Single source of truth for Tier A coverage gates (80/70, 70/60, 90/85) |
| `vitest.config.ts` + `vitest.integration.config.ts` | Reference Vitest configs that enforce those thresholds via `coverage.thresholds` |
| `tests/coverage-gates/README.md` | Workspace wiring + exclusion policy + ratchet rules |
| `scripts/qa/validate-fixtures.mjs` | Determinism + synthetic-only self-validation (dependency-free) |
| `scripts/qa/validate-coverage-thresholds.mjs` | Mechanical check that thresholds meet the 80/70/90 mandate |

## Acceptance criteria

1. [x] Synthetic-only data generator (no real passwords, keys, tokens)
2. [x] Coverage thresholds: unit ≥ 80%, integration ≥ 70%, critical paths (auth/vault/crypto) ≥ 90%

## Verification (real, reproduced — Node v22.23.2)

### 1. Fixtures are deterministic for structured data, synthetic-only for secrets

```
$ node --experimental-strip-types scripts/qa/validate-fixtures.mjs
```
See `validate-fixtures.txt` — 22 checks, exit 0. Proves: `mulberry32`/`seededRandom`
are deterministic for a fixed seed; master password (36-hex, 144-bit), secrets,
and keys are generated fresh per run and never dictionary-shaped; every
identifier/email/URI is reserved-TLD only (`@example.test`, `.example.test`).

### 2. Coverage thresholds meet the mandate

```
$ node scripts/qa/validate-coverage-thresholds.mjs
```
See `validate-coverage-thresholds.txt` — exit 0. Confirms `UNIT` 80/70,
`INTEGRATION` 70/60, `CRITICAL_PATHS` 90/85 are actually encoded, and the
critical-path globs cover auth/vault/crypto.

### 3. scan:test-data is clean on the repo's test tree (positive)

```
$ node scripts/qa/scan-test-data.mjs
```
See `scan-test-data-positive.txt` — 10 files scanned, 0 findings, exit 0.

### 4. scan:test-data flags violations (negative control — non-vacuous)

```
$ node scripts/qa/scan-test-data.mjs /tmp/negative-control.test.ts
```
See `scan-test-data-negative-control.txt` — 5 findings, exit 1. The control file
(held in /tmp, never committed) carries a real domain, a dictionary password, a
long base64 blob, and a non-reserved email; the scanner flags every one.

## Reproduction

```bash
pnpm scan:test-data                                    # exit 0 on a clean tree
pnpm validate:fixtures                                 # exit 0
pnpm validate:coverage-thresholds                      # exit 0
node scripts/qa/scan-test-data.mjs /tmp/negative-control.test.ts   # exit 1
```

## Notes for downstream (handoff)

- **CI wiring:** the coverage gate is enforced by `vitest.config.ts` /
  `vitest.integration.config.ts` via `coverage.thresholds`; once each workspace
  ships `test:unit`/`test:integration` running `vitest run --coverage`, the
  existing CI `unit`/`integration` jobs (QA-001b, PR #7) pick it up — no
  `ci.yml` edit needed. `scan:test-data` should be added as a step to the CI
  `secret-scan` job (or a pre-commit hook) when QA-001d wires the remaining
  scanners.
- **Vitest not yet installed** (bootstrap `t_ee24fd37`): the two `vitest.config.ts`
  files import `vitest/config` and resolve once vitest lands as a devDependency.
  The authoritative numbers in `thresholds.ts` are validated dependency-free.
- **QA correction (raise to `architect`):** TEST_STRATEGY.md §7 labels
  `JBSWY3DPEHPK3PXP` a "TOTP" vector; it is the RFC 4648 §10 base32 vector. TOTP
  vectors belong to RFC 6238 Appendix B and the TOTP task (BR-003d). Noted in
  `tests/fixtures/crypto.ts`.
