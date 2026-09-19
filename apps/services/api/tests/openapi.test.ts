/**
 * BE-001c integration tests: GET /openapi.json.
 *
 * Test type: integration. Verifies the OpenAPI 3.1 document served at
 * /openapi.json is valid and faithful to ADR-004 (the canonical contract).
 *
 * Security: the spec is validated structurally only — no secrets, keys,
 * or PII are asserted or logged (SEC-001 AR-4).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/server';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const openapiPath = resolve(__dirname, '..', 'openapi.json');

describe('BE-001c: GET /openapi.json', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = createServer({ logger: false });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it('responds with 200 and content-type JSON', async () => {
    const res = await server.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('returns a valid OpenAPI 3.1 document', async () => {
    const res = await server.inject({ method: 'GET', url: '/openapi.json' });
    const doc = JSON.parse(res.body);
    expect(doc.openapi).toBe('3.1.0');
    expect(typeof doc.info).toBe('object');
    expect(doc.info.title).toBe('Secure Password Manager API');
    expect(doc.info.version).toBe('1.0.0');
    expect(typeof doc.paths).toBe('object');
    expect(doc.paths).not.toBe(null);
  });

  it('serves a document identical to the committed openapi.json artifact', async () => {
    const res = await server.inject({ method: 'GET', url: '/openapi.json' });
    const served = JSON.parse(res.body);
    const committed = JSON.parse(readFileSync(openapiPath, 'utf-8'));
    expect(served).toEqual(committed);
  });

  it('documents the /health and /openapi.json infra endpoints', async () => {
    const res = await server.inject({ method: 'GET', url: '/openapi.json' });
    const doc = JSON.parse(res.body);
    expect(doc.paths['/health']).toBeDefined();
    expect(doc.paths['/health'].get).toBeDefined();
    expect(doc.paths['/openapi.json']).toBeDefined();
    expect(doc.paths['/openapi.json'].get).toBeDefined();
  });

  it('declares the JWT BearerAuth security scheme (ADR-004 Sec securitySchemes)', async () => {
    const res = await server.inject({ method: 'GET', url: '/openapi.json' });
    const doc = JSON.parse(res.body);
    expect(doc.components.securitySchemes).toBeDefined();
    expect(doc.components.securitySchemes.BearerAuth).toBeDefined();
    expect(doc.components.securitySchemes.BearerAuth.type).toBe('http');
    expect(doc.components.securitySchemes.BearerAuth.scheme).toBe('bearer');
    expect(doc.components.securitySchemes.BearerAuth.bearerFormat).toBe('JWT');
  });

  it('preserves the ADR-004 envelope components (header/body)', async () => {
    const res = await server.inject({ method: 'GET', url: '/openapi.json' });
    const doc = JSON.parse(res.body);
    expect(doc.components.schemas.EnvelopeHeader).toBeDefined();
    expect(doc.components.schemas.EnvelopeSuccess).toBeDefined();
    expect(doc.components.schemas.EnvelopeError).toBeDefined();
    expect(doc.components.schemas.HealthResponse).toBeDefined();
  });

  it('does not mutate the spec between requests (cached, stable)', async () => {
    const r1 = await server.inject({ method: 'GET', url: '/openapi.json' });
    const r2 = await server.inject({ method: 'GET', url: '/openapi.json' });
    expect(r1.body).toEqual(r2.body);
  });

  // ── negative cases ──────────────────────────────────────────────
  it('rejects POST /openapi.json (GET-only)', async () => {
    const res = await server.inject({ method: 'POST', url: '/openapi.json' });
    expect(res.statusCode).toBe(404);
  });
});
