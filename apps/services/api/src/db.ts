/**
 * Database connection factory and Drizzle ORM instance.
 *
 * Uses better-sqlite3 (synchronous SQLite driver for Node.js).
 * ADR-002 Sec 3.1: Node.js backend with SQLite v1 (dev).
 * ADR-002 Sec 5.1: this module manages the connection only — it never
 * inspects or logs ciphertext, vault keys, salts, or any cryptographic
 * material. Those blobs flow through the DB as opaque buffers.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

/**
 * Create a Drizzle ORM instance backed by better-sqlite3.
 *
 * @param url — SQLite database path. Use ':memory:' for ephemeral/test DBs.
 */
export function createDb(
  url: string = process.env.DATABASE_URL ?? './dev.db',
) {
  const client = new Database(url);
  client.exec(`PRAGMA foreign_keys = ON;`);
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;

/**
 * Default singleton for production/runtime use.
 * Tests should call `createDb(':memory:')` for isolation.
 */
export const db = createDb();
