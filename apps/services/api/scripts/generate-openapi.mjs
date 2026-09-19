/**
 * Build-time generator for apps/services/api/openapi.json.
 *
 * Reads the canonical OpenAPI 3.1 contract authored by `architect`
 * (architecture/adr/ADR-004-api-contract.yaml), adds the infra endpoints
 * that live outside the versioned /api/v1 contract, and writes a JSON
 * document that the server serves at GET /openapi.json.
 *
 * Run: pnpm build:openapi  (→ node scripts/generate-openapi.mjs)
 *
 * ADR-004 is the single source of truth — this script only AUGMENTS it
 * with the /health path (introduced in BE-001c) so the served spec never
 * drifts from the architecture doc.
 *
 * Plain JS (no TS types) because this runs via `node`, not tsx.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
// here = .../apps/services/api/scripts
// repo root is 4 levels up (scripts -> api -> services -> apps -> root)
const repoRoot = path.resolve(here, '../../../..');
const adrPath = path.join(repoRoot, 'architecture/adr/ADR-004-api-contract.yaml');
const outPath = path.join(here, '..', 'openapi.json');

const doc = yaml.load(fs.readFileSync(adrPath, 'utf-8'));

if (!doc || typeof doc !== 'object') {
  throw new Error('[openapi] failed to parse ADR-004 into an object');
}

if (doc.openapi !== '3.1.0') {
  throw new Error(`[openapi] ADR-004 has OpenAPI version ${doc.openapi}, expected 3.1.0`);
}

doc.components ??= {};
doc.components.schemas ??= {};
doc.components.schemas.HealthResponse = {
  type: 'object',
  description: 'Liveness/readiness probe response (BE-001c).',
  required: ['status', 'version', 'timestamp'],
  properties: {
    status: { type: 'string', const: 'ok', description: 'Always "ok" when the service is healthy.' },
    version: { type: 'string', description: 'API version (from package.json).' },
    timestamp: { type: 'string', format: 'date-time', description: 'Server time (UTC) of this response.' },
  },
};

doc.paths ??= {};

// GET /health — served by src/routes/health.ts (BE-001c).
doc.paths['/health'] = {
  get: {
    tags: ['Infrastructure'],
    summary: 'Service health check',
    description:
      'Liveness/readiness probe. Not part of the versioned /api/v1 contract; ' +
      'served at the root alongside the OpenAPI document. No authorization required.',
    responses: {
      '200': {
        description: 'Service is healthy.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/HealthResponse' },
          },
        },
      },
    },
  },
};

// GET /openapi.json — serves this document. Documented for completeness.
doc.paths['/openapi.json'] = {
  get: {
    tags: ['Infrastructure'],
    summary: 'OpenAPI specification',
    description: 'The OpenAPI 3.1 document for this API (this file).',
    responses: {
      '200': {
        description: 'OpenAPI document as JSON.',
        content: {
          'application/json': {
            schema: { type: 'object' },
          },
        },
      },
    },
  },
};

const json = JSON.stringify(doc, null, 2) + '\n';
fs.writeFileSync(outPath, json, 'utf-8');
console.log(`[openapi] generated ${outPath} (${json.length} bytes) from ${path.relative(repoRoot, adrPath)}`);
