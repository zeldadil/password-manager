import { defineConfig } from 'vitest/config';
import { INTEGRATION, CRITICAL_PATHS, CRITICAL_PATH_GLOBS } from '../../coverage-gates/thresholds.ts';

/**
 * Web integration tests config (FE-002g).
 *
 * jsdom environment for React component rendering against a real API server.
 * Includes integration tests from tests/integration/web/.
 */
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/integration/web/setupTests.ts'],
    include: [
      'tests/integration/web/**/*.test.ts',
      'tests/integration/web/**/*.test.tsx',
    ],
  },
  coverage: {
    provider: 'v8',
    reporter: ['text', 'lcov', 'html'],
    include: ['apps/web/src/**'],
    exclude: [
      '**/*.d.ts',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/index.ts',
      'apps/web/src/main.tsx',
    ],
    thresholds: {
      ...INTEGRATION,
      ...Object.fromEntries(CRITICAL_PATH_GLOBS.map((g) => [g, CRITICAL_PATHS])),
    },
  },
});