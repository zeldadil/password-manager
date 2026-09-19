/**
 * Default entry point for the API service.
 *
 * BE-001a delivers the migration system only. The Fastify server
 * (BE-001c) and its routes/middleware hang off this file later.
 * For now it re-exports the DB and schema so other modules can import
 * from a single entry point.
 */

export { createDb } from './db';
export type { Db } from './db';
export * as schema from './schema';
