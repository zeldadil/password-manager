import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Vitest configuration for the web workspace. Kept separate from vite.config.ts so
// test-only settings (jsdom environment, globals for @testing-library auto-cleanup)
// never leak into the production build config.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
