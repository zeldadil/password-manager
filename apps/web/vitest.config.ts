import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // Fail fast on a Node major other than the pinned one (t_cf31ee46).
    globalSetup: ['./vitest.node-guard.ts'],
    setupFiles: ['./src/setupTests.ts'],
  },
})
