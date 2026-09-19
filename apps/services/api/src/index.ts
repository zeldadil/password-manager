/**
 * Default entry point for the API service (BE-001c: server skeleton).
 *
 * Run directly to boot the server:
 *   pnpm dev        # tsx watch src/index.ts
 *   pnpm start      # tsx src/index.ts
 *
 * The module also re-exports the DB and schema (and now the server factory)
 * so other modules/tests can import from a single entry point. The listen()
 * call is guarded so that merely importing this file never starts a real
 * TCP server (important for the test process and for BE-001d+ composition).
 */

import { createServer } from './server';
import { config } from './config';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Library surface — re-exported for tests and future route modules.
export { createServer } from './server';
export { config } from './config';
export { createDb } from './db';
export type { Db } from './db';
export * as schema from './schema';

/**
 * Boot the HTTP server. Separated so it can be called only when this
 * module is the program entry point (see guard below).
 */
async function main(): Promise<void> {
  const server = createServer();

  // Graceful shutdown — close in-flight connections on SIGINT/SIGTERM.
  // (Auth/session teardown is added later by BE-002c.)
  const shutdown = async (signal: string) => {
    console.log(`\n[api] ${signal} received — closing server`);
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  const address = await server.listen({
    port: config.port,
    host: config.host,
  });
  console.log(
    `[api] ${config.name} v${config.version} listening at ${address} (${config.nodeEnv})`,
  );
}

// ESM "is this the main module?" guard. process.argv[1] is the entry script
// only when invoked directly (e.g. `tsx src/index.ts`), not when imported.
const entryPoint = resolve(process.argv[1] ?? '');
const modulePath = fileURLToPath(import.meta.url);
const isMain = entryPoint === modulePath;

if (isMain) {
  void main();
}
