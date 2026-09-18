/**
 * QA reviewer probe config (FE-001k / t_cdd23d35) — scratch, not part of the
 * deliverable. Keeps the probe spec out of the delivered a11y/unit lanes.
 */
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['qa-probe/**/*.spec.tsx'],
  },
})
