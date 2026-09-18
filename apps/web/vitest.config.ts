import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Vitest configuration for the web workspace. Kept separate from vite.config.ts so
// test-only settings (jsdom environment, globals for @testing-library auto-cleanup)
// never leak into the production build config.
//
// FE-001i: integration specs (`*.integration.test.tsx`, owned by FE-001j) are excluded
// from the unit run, so `pnpm test` stays the fast hermetic unit lane while
// `pnpm test:integration` owns the cross-component lane.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', 'src/**/*.integration.test.{ts,tsx}'],
  },
})
