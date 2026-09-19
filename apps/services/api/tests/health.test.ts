/**
 * BE-001c integration tests: GET /health.
 *
 * Test type: integration (per backlog BE-001c). Spins up a real Fastify
 * instance via createServer() and exercises the route through fastify.inject
 * (no TCP port needed).
 *
 * Security: synthetic data only (SEC-001 AR-4). The response carries no
 * secrets — only a version string and an ISO timestamp.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/server';

describe('BE-001c: GET /health', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = createServer({ logger: false });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it('responds with 200 and the { status, version, timestamp } envelope', async () => {
    const res = await server.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body).toEqual({
      status: 'ok',
      version: expect.any(String),
      timestamp: expect.any(String),
    });
  });

  it('returns status "ok" exactly', async () => {
    const res = await server.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
  });

  it('returns the package version (0.1.0 pre-release)', async () => {
    const res = await server.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(res.body);
    expect(body.version).toBe('0.1.0');
  });

  it('returns a valid ISO-8601 UTC timestamp', async () => {
    const res = await server.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(res.body);
    expect(body.timestamp).toContain('Z'); // UTC
    expect(() => new Date(body.timestamp).getTime()).not.toThrow();
    expect(Number.isNaN(new Date(body.timestamp).getTime())).toBe(false);
  });

  it('sets content-type to JSON', async () => {
    const res = await server.inject({ method: 'GET', url: '/health' });
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('does not include any secret fields in the body', async () => {
    const res = await server.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['status', 'timestamp', 'version']);
  });

  // ── negative cases ──────────────────────────────────────────────
  it('returns 404 for unknown /health sub-paths', async () => {
    const res = await server.inject({ method: 'GET', url: '/health/unknown' });
    expect(res.statusCode).toBe(404);
  });

  it('only serves GET on /health (OPTIONS is not handled)', async () => {
    const res = await server.inject({ method: 'OPTIONS', url: '/health' });
    // Fastify returns 404 for a method with no registered handler.
    expect(res.statusCode).toBe(404);
  });
});
