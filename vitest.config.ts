import { defineConfig } from "vitest/config";
import { UNIT, CRITICAL_PATHS, CRITICAL_PATH_GLOBS } from "./tests/coverage-gates/thresholds.ts";

/**
 * Root Vitest config — UNIT tier (TEST_STRATEGY §3.1, §5).
 *
 * Enforces Tier A coverage on `pnpm test:unit`:
 *   - global floor: UNIT (line >= 80, branch >= 70)
 *   - critical paths (auth/vault/crypto/permissions): CRITICAL_PATHS (>= 90/85)
 *
 * Workspaces do NOT copy this file; each workspace runs `vitest run --coverage`
 * with its own config that extends these thresholds (see tests/coverage-gates/README.md).
 * This root config exists so a single `vitest run --config vitest.config.ts`
 * can aggregate the cross-cutting suites under `tests/unit/`.
 *
 * NOTE: per-glob thresholds syntax must be verified against the pinned Vitest
 * version when workspaces wire their `test:unit` scripts (Vitest 2.x supports
 * glob-keyed `coverage.thresholds`). The authoritative numbers live in
 * `tests/coverage-gates/thresholds.ts` regardless of config syntax.
 */
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "packages/**/src/**/*.test.ts", "apps/**/src/**/*.test.ts", "apps/**/src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["packages/**/src/**", "apps/**/src/**"],
      exclude: ["**/*.d.ts", "**/*.test.ts", "**/*.test.tsx", "**/index.ts"],
      thresholds: {
        ...UNIT,
        ...Object.fromEntries(CRITICAL_PATH_GLOBS.map((g) => [g, CRITICAL_PATHS])),
      },
    },
  },
});
