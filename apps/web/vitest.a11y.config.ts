import { defineConfig } from 'vitest/config'

// Accessibility lane (FE-001k) — axe-core over every route.
//
// Mirrors vitest.integration.config.ts: an explicit `include` glob is used instead
// of a positional CLI filename filter, because Vitest 5 silently resolves a
// positional filter to "No test files found, exiting with code 0" — a green check
// that ran nothing. This lane must be able to fail.
//
// The specs are named `src/**/*.a11y.test.{ts,tsx}`, which the default
// `vitest.config.ts` include (`src/**/*.test.{ts,tsx}`) also matches — so the axe
// sweep is part of `pnpm test:unit` and therefore gated by the existing required CI
// `unit` check, with no new required status check on master (branch protection is
// architect-owned). This config is the focused entry point for local/QA runs:
// `pnpm test:a11y`.
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.a11y.test.{ts,tsx}'],
  },
})
