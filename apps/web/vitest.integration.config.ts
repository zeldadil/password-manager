import { defineConfig } from 'vitest/config'

// Integration-lane configuration (FE-001j owns the specs, FE-001i owns the lane).
//
// Separate config rather than a CLI filename filter: the `pnpm test:integration`
// script used to pass `'src/**/*.integration.test.{ts,tsx}'` as a positional
// filter, which Vitest 5 does not resolve into matching files — the lane reported
// "No test files found, exiting with code 0", i.e. a green check that ran nothing.
// An `include` glob cannot silently miss files this way.
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.integration.test.{ts,tsx}'],
  },
})
