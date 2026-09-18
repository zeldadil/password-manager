import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Vitest configuration for the web workspace. Kept separate from vite.config.ts so
// test-only settings (jsdom environment, globals for @testing-library auto-cleanup)
// never leak into the production build config.
//
// FE-001i: both lanes share this config. `pnpm test:unit` excludes
// `*.integration.test.*` (FE-001j) on the command line rather than here, so the
// `pnpm test:integration` filter can still select those specs — a config-level
// `exclude` would hide them from the integration lane too.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
