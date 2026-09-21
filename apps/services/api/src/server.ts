/**
 * API server factory.
 *
 * Creates and configures the Fastify server. Routes are registered as
 * small, single-responsibility plugins so later tasks can compose them:
 *
 *   - healthPlugin   (BE-001c)   → GET /health
 *   - openapiPlugin  (BE-001c)   → GET /openapi.json
 *   - envelopePlugin (BE-001d)   → envelope middleware on /api/v1
 *   - resourcePlugin (BE-003b+)  → /api/v1/resources, etc.
 *
 * ADR-002 Sec 5.1: the server holds no vault key, master password, or
 * ciphertext. Crypto lives in packages/crypto (gated by SEC-001); until
 * BE-002a, the API surface is infra-only.
 */

import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { config } from './config';
import { envelopePreSerialization } from './middleware/envelope';
import { createErrorHandler, notFoundHandler } from './middleware/error-handler';
import { healthPlugin } from './routes/health';
import { openapiPlugin } from './routes/openapi';
import { authPlugin } from './auth/register';

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

  // ── Envelope middleware (BE-001d) ──────────────────────────────
  // Installed at the ROOT scope (not via register) so the preSerialization
  // hook is inherited by every route plugin registered below — including
  // future /api/v1 sibling plugins (e.g. resourcePlugin, BE-003b). The hook
  // itself guards on the /api/v1 path prefix, so infra endpoints served at
  // the root (/health, /openapi.json) are left unwrapped (ADR-002 §3.1).
  server.addHook('preSerialization', envelopePreSerialization);

  // ── Global error handler (BE-001f) ────────────────────────────────
  // Every thrown error, 404, and validation failure is converted here into
  // an ADR-004 envelope (no stack traces, no leaked internals). Installed at
  // the ROOT scope so health/openapi/future resource plugins all inherit it.
  // See src/middleware/error-handler.ts.
  server.setErrorHandler(
    createErrorHandler({ log: server.log, nodeEnv: config.nodeEnv }),
  );

  // ── Global 404 handler (BE-001f) ────────────────────────────────
  // Fastify's default 404 bypasses setErrorHandler, so unknown paths would
  // return a raw Fastify body instead of an ADR-004 error envelope. This
  // handler throws a 404 error that flows through the error handler above,
  // giving every unmatched route a consistent error envelope (no stack leak).
  server.setNotFoundHandler(notFoundHandler);

  server.register(healthPlugin);
  server.register(openapiPlugin);
  server.register(authPlugin);

  return server;
}

export { config };
