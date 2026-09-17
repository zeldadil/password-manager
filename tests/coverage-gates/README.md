# Coverage Thresholds — `tests/coverage-gates/`

Owned by QA-001e (`t_204ae591`). Implements TEST_STRATEGY.md §5 **Tier A**
(CI-enforced minimum) and the QA-001e acceptance criterion
"unit ≥ 80%, integration ≥ 70%, critical paths (auth/vault/crypto) ≥ 90%".

## The numbers (single source of truth: `thresholds.ts`)

| Scope | Line | Branch | Constant |
|---|---|---|---|
| Unit | ≥ 80% | ≥ 70% | `UNIT` |
| Integration | ≥ 70% | ≥ 60% | `INTEGRATION` |
| Critical paths (auth / vault / crypto / permissions) | ≥ 90% | ≥ 85% | `CRITICAL_PATHS` |

These are the **hard floor**. Tier B (aspirational: unit 90/85, integration
85/80, crypto boundary 100% on changed lines) is documented in TEST_STRATEGY §5
and enforced manually, not in CI.

## How enforcement works

1. **`tests/coverage-gates/thresholds.ts`** — the authoritative numbers, machine-checked
   by `scripts/qa/validate-coverage-thresholds.mjs` (exit 0 = numbers meet the
   mandate).
2. **`vitest.config.ts`** — unit tier: global floor = `UNIT`, per-glob override
   = `CRITICAL_PATHS` for critical-path globs.
3. **`vitest.integration.config.ts`** — integration tier: global floor =
   `INTEGRATION`, same critical-path override.

Coverage is enforced by Vitest's `coverage.thresholds` — when `vitest run
--coverage` loads a config with thresholds, a breach fails the run (exit 1),
which is exactly what the CI `unit` / `integration` jobs need to block a PR.

## Workspace wiring (each app/package)

Each workspace ships its own `test:unit` / `test:integration` script that runs
Vitest **with coverage and thresholds** (fails on zero tests too, closing the
vacuous-pass gap flagged in QA-001b):

```jsonc
// apps/services/api/package.json (example)
{
  "scripts": {
    "test:unit": "vitest run --coverage --config vitest.config.ts",
    "test:integration": "vitest run --coverage --config vitest.integration.config.ts"
  }
}
```

A workspace Vitest config re-uses the shared thresholds (do not copy the numbers):

```ts
import { defineConfig } from "vitest/config";
import { UNIT, CRITICAL_PATHS, CRITICAL_PATH_GLOBS } from "../../tests/coverage-gates/thresholds.ts";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
  coverage: {
    provider: "v8",
    reporter: ["text", "lcov", "html"],
    include: ["src/**"],
    thresholds: {
      ...UNIT,
      ...Object.fromEntries(CRITICAL_PATH_GLOBS.map((g) => [g, CRITICAL_PATHS])),
    },
  },
});
```

## Exclusions (TEST_STRATEGY §5 — declared, never implied)

Default exclusions baked into the shared configs: `**/*.d.ts`, `**/*.test.ts`,
`**/*.test.tsx`, `**/index.ts` (barrel), and `**/migrations/**` (integration;
covered by the up/down migration test instead). App bootstrap/entry files
(`main.tsx`, `main.ts`, `background.ts` entrypoints) must be added to each
workspace's `coverage.exclude` with a comment naming the reason — never silently
left uncovered.

## Rules that coverage math cannot override

- `packages/crypto/**` — every changed line must be covered in the same PR
  (Tier B hard rule; AR-6 review).
- Negative-test density (AR-3) and vector coverage (V1–V7) are separate hard
  gates — a percentage never substitutes for a missing failure-mode case.
- Ratchet: a PR may not *lower* Tier B coverage of the files it touches.

## Verification

```bash
node scripts/qa/validate-coverage-thresholds.mjs   # exit 0 — numbers meet mandate
```

## Note on Vitest availability

`vitest.config.ts` / `vitest.integration.config.ts` import `vitest/config`,
which resolves once `vitest` is installed as a devDependency (bootstrap task
`t_ee24fd37`). Until then the configs are inert files; the authoritative numbers
in `thresholds.ts` are validated independently and require no dependency. Verify
the exact `coverage.thresholds` glob syntax against the pinned Vitest major when
the first workspace wires its `test:unit`.
