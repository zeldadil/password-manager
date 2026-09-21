import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);
console.log('[vitest.config] __filename=', __filename);
console.log('[vitest.config] __dir=', __dir);
console.log('[vitest.config] sharedSrc=', resolve(__dir, '../../../packages/shared/src'));
console.log('[vitest.config] cryptoSrc=', resolve(__dir, '../../../packages/crypto/src'));

const sharedSrc = resolve(__dir, '../../../packages/shared/src');
const cryptoSrc = resolve(__dir, '../../../packages/crypto/src');

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@shared': sharedSrc,
      '@crypto': cryptoSrc,
    },
  },
});
