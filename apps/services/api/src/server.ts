/**
 * BE-001c: API server factory.
 *
 * Creates and configures the Fastify server. Routes are registered as
 * small, single-responsibility plugins so later tasks can compose them:
 *
 *   - healthPlugin   (this task)   → GET /health
 *   - openapiPlugin  (this task)   → GET /openapi.json
 *   - envelopePlugin (BE-001d)      → envelope middleware on /api/v1
 *   - resourcePlugin (BE-003b+)    → /api/v1/resources, etc.
 *
 * ADR-002 Sec 5.1: the server holds no vault key, master password, or
 * ciphertext. Crypto lives in packages/crypto (gated by SEC-001); until
 * BE-002a, the API surface is infra-only.
 */

import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { config } from './config';
import { healthPlugin } from './routes/health';
import { openapiPlugin } from './routes/openapi';

export interface CreateServerOptions {
  /** Override the logger (tests pass { logger: false } for clean output). */
  logger?: boolean;
}

/**
 * Build a Fastify instance with the skeleton routes registered.
 *
 * Safe to call repeatedly (e.g. in tests) — each call returns an
 * independent instance the caller is responsible for closing.
 */
export function createServer(opts?: CreateServerOptions): FastifyInstance {
  const server = Fastify({
    logger: opts?.logger ?? config.nodeEnv === 'development',
  });

  server.register(healthPlugin);
  server.register(openapiPlugin);

  return server;
}

export { config };
