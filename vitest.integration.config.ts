import { defineConfig } from "vitest/config";
import { INTEGRATION, CRITICAL_PATHS, CRITICAL_PATH_GLOBS } from "./tests/coverage-gates/thresholds.ts";

/**
 * Root Vitest config — INTEGRATION tier (TEST_STRATEGY §3.2, §5).
 *
 * Enforces Tier A coverage on `pnpm test:integration`:
 *   - global floor: INTEGRATION (line >= 70, branch >= 60)
 *   - critical paths (auth/vault/crypto/permissions): CRITICAL_PATHS (>= 90/85)
 *
 * Integration suites use real DB/crypto and live under `tests/integration/`
 * plus app-local `__tests__/`. See tests/coverage-gates/README.md for workspace wiring.
 */
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts", "apps/services/api/**/__tests__/**/*.test.ts", "packages/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["apps/services/api/src/**", "packages/**/src/**"],
      exclude: ["**/*.d.ts", "**/*.test.ts", "**/index.ts", "**/migrations/**"],
      thresholds: {
        ...INTEGRATION,
        ...Object.fromEntries(CRITICAL_PATH_GLOBS.map((g) => [g, CRITICAL_PATHS])),
      },
    },
  },
});
