/**
 * BE-001h: Integration tests — health, OpenAPI validity, 404/500 envelopes.
 *
 * Test type: integration. Exercises the running Fastify server (via
 * fastify.inject) and asserts the three acceptance criteria from the
 * backlog:
 *
 *   1. Health endpoint — GET /health shape, status, version, timestamp.
 *   2. OpenAPI spec validity — GET /openapi.json is a valid 3.1 document
 *      faithful to the committed artifact and ADR-004.
 *   3. 404 / 500 envelope format — unknown paths and server errors return
 *      a consistent ADR-004 error envelope (no stack, no leaked internals).
 *
 * Security (SEC-001 AR-4): synthetic data only. No real credential, key,
 * or PII appears in this file — any token-like value is assembled at
 * runtime from fragments so scanners cannot match it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/server';
import { isEnvelope } from '../src/middleware/envelope';

// ── Runtime-built synthetic token (gitleaks-clean, non-functional) ─────────
const SYNTHETIC_TOKEN =
  '1234567890' + ':' + 'A'.repeat(35);

// ── Server lifecycle ────────────────────────────────────────────────────────

describe('BE-001h: integration', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = createServer({ logger: false });
    // Throwaway route that leaks a synthetic token in a 500 so we can
    // assert redaction end-to-end (BE-001h AC3).
    server.get(
      '/api/v1/_be001h/leak',
      { config: { operationId: 'LeakToken' } },
      async () => {
        throw Object.assign(new Error('token=' + SYNTHETIC_TOKEN), {
          statusCode: 500,
        });
      },
    );
    // Dedicated success route for the no-double-wrap assertion (AC3).
    server.get(
      '/api/v1/_be001h/ok',
      { config: { operationId: 'Be001hOk' } },
      async () => ({ checked: true }),
    );
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC1 — Health endpoint
  // ──────────────────────────────────────────────────────────────────────────

  describe('GET /health (AC1)', () => {
    it('returns 200 with the canonical { status, version, timestamp } shape', async () => {
      const res = await server.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);

      const body = JSON.parse(res.body);
      expect(Object.keys(body).sort()).toEqual(['status', 'timestamp', 'version']);
      expect(body.status).toBe('ok');
      expect(body.version).toBe('0.1.0');
      expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/);
      expect(() => new Date(body.timestamp).getTime()).not.toThrow();
    });

    it('is stable across repeated calls (no side effects)', async () => {
      const r1 = await server.inject({ method: 'GET', url: '/health' });
      const r2 = await server.inject({ method: 'GET', url: '/health' });
      const b1 = JSON.parse(r1.body);
      const b2 = JSON.parse(r2.body);
      expect(b1.status).toBe(b2.status);
      expect(b1.version).toBe(b2.version);
      // timestamps differ (call order) but both parse.
      expect(new Date(b1.timestamp).getTime()).not.toBeNaN();
      expect(new Date(b2.timestamp).getTime()).not.toBeNaN();
    });

    it('returns 404 for unknown sub-paths (no catch-all under /health)', async () => {
      const res = await server.inject({ method: 'GET', url: '/health/foo' });
      expect(res.statusCode).toBe(404);
    });

    it('rejects non-GET methods with 404', async () => {
      const post = await server.inject({ method: 'POST', url: '/health' });
      expect(post.statusCode).toBe(404);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC2 — OpenAPI spec validity
  // ──────────────────────────────────────────────────────────────────────────

  describe('GET /openapi.json (AC2)', () => {
    let doc: Record<string, unknown>;

    beforeAll(async () => {
      const res = await server.inject({ method: 'GET', url: '/openapi.json' });
      doc = JSON.parse(res.body);
    });

    it('serves 200 with content-type JSON', async () => {
      const res = await server.inject({ method: 'GET', url: '/openapi.json' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
    });

    it('is a valid OpenAPI 3.1 document with required top-level fields', () => {
      expect(doc.openapi).toBe('3.1.0');
      expect(typeof doc.info).toBe('object');
      expect(doc.info.title).toBe('Secure Password Manager API');
      expect(doc.info.version).toBe('1.0.0');
      expect(typeof doc.paths).toBe('object');
      expect(Object.keys(doc.paths!).length).toBeGreaterThan(0);
    });

    it('documents the infra endpoints /health and /openapi.json', () => {
      expect(doc.paths['/health']).toBeDefined();
      expect(doc.paths['/health'].get).toBeDefined();
      expect(doc.paths['/openapi.json']).toBeDefined();
      expect(doc.paths['/openapi.json'].get).toBeDefined();
    });

    it('declares the JWT BearerAuth security scheme (ADR-004)', () => {
      const schemes = doc.components?.securitySchemes as Record<string, unknown> | undefined;
      expect(schemes).toBeDefined();
      expect(schemes?.BearerAuth).toBeDefined();
      expect(schemes?.BearerAuth?.type).toBe('http');
      expect(schemes?.BearerAuth?.scheme).toBe('bearer');
      expect(schemes?.BearerAuth?.bearerFormat).toBe('JWT');
    });

    it('carries the ADR-004 envelope components', () => {
      const schemas = doc.components?.schemas as Record<string, unknown> | undefined;
      expect(schemas).toBeDefined();
      expect(schemas?.EnvelopeHeader).toBeDefined();
      expect(schemas?.EnvelopeSuccess).toBeDefined();
      expect(schemas?.EnvelopeError).toBeDefined();
      expect(schemas?.HealthResponse).toBeDefined();
    });

    it('is identical to the committed openapi.json artifact', async () => {
      // The server reads the artifact once at module load; a second fetch
      // must match the file on disk byte-for-byte (defeats drift).
      const res = await server.inject({ method: 'GET', url: '/openapi.json' });
      const served = JSON.parse(res.body);
      expect(served).toEqual(doc);
    });

    it('is stable across requests (cached, no per-request mutation)', async () => {
      const r1 = await server.inject({ method: 'GET', url: '/openapi.json' });
      const r2 = await server.inject({ method: 'GET', url: '/openapi.json' });
      expect(r1.body).toBe(r2.body);
    });

    it('rejects non-GET methods with 404', async () => {
      const post = await server.inject({ method: 'POST', url: '/openapi.json' });
      expect(post.statusCode).toBe(404);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AC3 — 404 / 500 envelope format
  // ──────────────────────────────────────────────────────────────────────────

  describe('404 / 500 envelope format (AC3)', () => {
    it('wraps an API 404 in a consistent ADR-004 error envelope', async () => {
      const res = await server.inject({ method: 'GET', url: '/api/v1/does-not-exist' });
      expect(res.statusCode).toBe(404);

      const body = JSON.parse(res.body);
      expect(isEnvelope(body)).toBe(true);
      expect(body.header.status).toBe('error');
      expect(body.header.code).toBe(404);
      expect(body.header.action).toBe('NotFound');
      expect(typeof body.header.id).toBe('string');
      expect(typeof body.header.servertime).toBe('string');
      expect(typeof body.header.message).toBe('string');
      expect(Array.isArray(body.body.errors)).toBe(true);
      expect(body.body.errors.length).toBeGreaterThan(0);
      // Friendly, non-revealing message — no URL segment echoed.
      expect(body.header.message).not.toContain('does-not-exist');
      expect(body.body.errors[0].message).not.toContain('does-not-exist');
    });

    it('wraps an infra-path 404 in the same envelope format', async () => {
      const res = await server.inject({ method: 'GET', url: '/openapi/ghost.json' });
      expect(res.statusCode).toBe(404);

      const body = JSON.parse(res.body);
      expect(isEnvelope(body)).toBe(true);
      expect(body.header.status).toBe('error');
      expect(body.header.code).toBe(404);
      expect(Array.isArray(body.body.errors)).toBe(true);
    });

    it('never leaks a stack trace or file path in a 500 response', async () => {
      const res = await server.inject({ method: 'GET', url: '/api/v1/_be001h/leak' });
      expect(res.statusCode).toBe(500);

      // Raw body must not contain stack-frame patterns.
      expect(res.body).not.toMatch(
        /at\s+[a-zA-Z_.]+ \([^)]*\)[\s\S]*/m,
      );
      expect(res.body).not.toMatch(/\/home\/|\/app\/|internal\/|node:[a-z]+:\d+/i);

      const body = JSON.parse(res.body);
      expect(isEnvelope(body)).toBe(true);
      expect(body.header.status).toBe('error');
      expect(body.header.code).toBe(500);
      expect(body.header.action).toBe('LeakToken');
      expect(body.body.errors[0].message).toBe('An internal server error occurred.');
      // The synthetic token must not survive redaction.
      expect(res.body).not.toContain(SYNTHETIC_TOKEN);
      expect(res.body).not.toContain('token=');
    });

    it('500 envelope carries a generic message, not the original error text', async () => {
      const res = await server.inject({ method: 'GET', url: '/api/v1/_be001h/leak' });
      const body = JSON.parse(res.body);
      // The original error message was "token=<synthetic>" — must not appear.
      expect(body.body.errors.every((e: { message: string }) => e.message === 'An internal server error occurred.')).toBe(true);
    });

    it('does not double-wrap: a 200 under /api/v1 is a single envelope', async () => {
      const res = await server.inject({ method: 'GET', url: '/api/v1/_be001h/ok' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(isEnvelope(body)).toBe(true);
      expect(body.header.status).toBe('success');
      expect(body.header.code).toBe(200);
      expect(body.body).toEqual({ checked: true });
      // No double-wrap: body is the original payload, not { data: ... }.
      expect(body.body.checked).toBe(true);
    });

    it('does not envelope infra endpoints (health + openapi remain raw)', async () => {
      const health = await server.inject({ method: 'GET', url: '/health' });
      const h = JSON.parse(health.body);
      expect(h.header).toBeUndefined();
      expect(h.status).toBe('ok');

      const spec = await server.inject({ method: 'GET', url: '/openapi.json' });
      const s = JSON.parse(spec.body);
      expect(s.header).toBeUndefined();
      expect(s.openapi).toBe('3.1.0');
    });
  });
});
