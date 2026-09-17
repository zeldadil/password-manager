/**
 * BE-001c: OpenAPI document endpoint.
 *
 * `GET /openapi.json` serves the API's OpenAPI 3.1 document. The document
 * is generated at build time from `architecture/adr/ADR-004-api-contract.yaml`
 * (the canonical contract authored by `architect`) plus the `/health` path
 * introduced by this task — see `scripts/generate-openapi.mjs`
 * (`pnpm build:openapi`). Serving a pre-generated JSON file keeps the
 * runtime free of any YAML parser dependency and avoids parsing the spec
 * on every request.
 *
 * The artifact (apps/services/api/openapi.json) is committed to the repo,
 * so reading it at module load is safe and fails fast if it is missing.
 */

import type { FastifyPluginAsync } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPENAPI_PATH = resolve(__dirname, '../../openapi.json');

// Parsed once at module load (the file is a committed build artifact) and
// reused for every request — never re-read from disk, never re-parsed.
const openapiDoc = JSON.parse(readFileSync(OPENAPI_PATH, 'utf-8'));

export const openapiPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get('/openapi.json', async (_request, reply) => {
    return reply.send(openapiDoc);
  });
};
