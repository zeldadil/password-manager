/**
 * Drizzle Kit configuration for the API service.
 *
 * See ARCHITECTURE: ADR-002 (overall), ADR-003 (data model).
 * Migration output goes to ./migrations (SQL files, .sql).
 * The sqlite dialect targets SQLite v1 (dev); Postgres is the
 * production target and will be swapped via the same schema (ADR-003 Sec 9.2).
 *
 * Crypto boundary (ADR-002 Sec 5.1): this file defines column shapes only.
 * No KDF, no AEAD, no key material here.
 */

import type { Config } from 'drizzle-kit';

export default {
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? './dev.db',
  },
} satisfies Config;
