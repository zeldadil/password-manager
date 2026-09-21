import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Vitest 5.x native config loader doesn't expose __dirname — use
// import.meta.dirname (Node 22+, which is what this project targets).
const sharedSrc = resolve(import.meta.dirname, '../../../packages/shared/src');
const cryptoSrc = resolve(import.meta.dirname, '../../../packages/crypto/src');

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    deps: {
      interopDefault: true,
    },
  },
  resolve: {
    alias: {
      '@shared': sharedSrc,
      '@crypto': cryptoSrc,
    },
  },
});
