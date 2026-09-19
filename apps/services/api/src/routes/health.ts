/**
 * BE-001c: Health endpoint route.
 *
 * `GET /health` is the service liveness/readiness probe. It returns no
 * secret material — only the service version and the current server time,
 * matching the contract documented in openapi.json (`GET /health`).
 *
 * ADR-002 Sec 3.1 (Backend API) does not put /health under the versioned
 * `/api/v1` prefix; it is infra, served at the root alongside the OpenAPI
 * document. Authorization: none (a health probe must work before any
 * session exists).
 */

import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config';

export const healthPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/health',
    {
      schema: {
        description: 'Service health check (liveness/readiness probe).',
        tags: ['Infrastructure'],
        response: {
          200: {
            type: 'object',
            description: 'Service is healthy.',
            properties: {
              status: { type: 'string', const: 'ok', description: 'Always "ok" when healthy.' },
              version: { type: 'string', description: 'API version (from package.json).' },
              timestamp: { type: 'string', format: 'date-time', description: 'Server time (UTC) of this response.' },
            },
            required: ['status', 'version', 'timestamp'],
          },
        },
      },
    },
    async (_request, reply) => {
      return reply.send({
        status: 'ok',
        version: config.version,
        timestamp: new Date().toISOString(),
      });
    },
  );
};
