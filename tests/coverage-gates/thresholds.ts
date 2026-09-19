/**
 * tests/coverage-gates/thresholds.ts — single source of truth for coverage gates.
 *
 * Owned by QA-001e. Implements TEST_STRATEGY.md §5 Tier A (CI-enforced minimum).
 * These numbers are the hard floor enforced in CI; Tier B (aspirational) lives
 * only in the strategy document and is not encoded here.
 *
 * The values are ALSO mechanically asserted by
 * `scripts/qa/validate-coverage-thresholds.mjs`, so the mandated minima
 * (unit >= 80%, integration >= 70%, critical paths >= 90%) cannot silently
 * drift below the backlog acceptance criteria.
 */

/** A Vitest coverage threshold object (percent, 0–100). Only the two dimensions
 *  mandated by the backlog/strategy (line + branch) are gated; functions and
 *  statements are intentionally left unenforced until Tier B. */
export interface CoverageThreshold {
  lines: number;
  branches: number;
}

/** Tier A — unit tests (TEST_STRATEGY §5: line >= 80, branch >= 70). */
export const UNIT: CoverageThreshold = {
  lines: 80,
  branches: 70,
};

/** Tier A — integration tests (TEST_STRATEGY §5: line >= 70, branch >= 60). */
export const INTEGRATION: CoverageThreshold = {
  lines: 70,
  branches: 60,
};

/** Tier A — critical paths: auth, vault, crypto, permissions
 *  (TEST_STRATEGY §5: line >= 90, branch >= 85). */
export const CRITICAL_PATHS: CoverageThreshold = {
  lines: 90,
  branches: 85,
};

/** Glob patterns that identify a "critical path" source file. A file matching
 *  any of these must meet CRITICAL_PATHS, not just the unit/integration floor.
 *  Kept in sync with TEST_STRATEGY §5's "auth, vault, crypto, permissions". */
export const CRITICAL_PATH_GLOBS = [
  "**/auth/**",
  "**/vault/**",
  "**/crypto/**",
  "packages/crypto/**",
  "**/permissions/**",
  "**/permission*",
] as const;
