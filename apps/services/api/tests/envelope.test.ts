/**
 * BE-001d: Envelope middleware tests.
 *
 * Covers:
 *  - Pure helper functions (buildEnvelopeHeader, deriveAction, isEnvelope,
 *    createSuccessEnvelope) — no Fastify needed.
 *  - Hook integration via fastify.inject — envelope wrapping of /api/v1
 *    success responses, non-2xx passthrough, already-enveloped passthrough,
 *    non-object passthrough, and confirmation that infra endpoints
 *    (/health, /openapi.json) remain UNWRAPPED.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  buildEnvelopeHeader,
  createSuccessEnvelope,
  deriveAction,
  envelopePreSerialization,
  isEnvelope,
} from '../src/middleware/envelope';
import { createServer } from '../src/server';

/* ────────────────────────────────────────────────────────────────────── */
/*  Pure-function unit tests                                               */
/* ────────────────────────────────────────────────────────────────────── */

describe('buildEnvelopeHeader', () => {
  it('builds a header with all required fields', () => {
    const header = buildEnvelopeHeader({
      status: 'success',
      action: 'ListResources',
      code: 200,
    });

    expect(header.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(header.status).toBe('success');
    expect(header.action).toBe('ListResources');
    expect(header.code).toBe(200);
    expect(header.message).toBe('');
    expect(header.url).toBeUndefined();

    // servertime is a valid ISO-8601 UTC timestamp
    const parsed = new Date(header.servertime).getTime();
    expect(Number.isNaN(parsed)).toBe(false);
  });

  it('includes url when provided', () => {
    const header = buildEnvelopeHeader({
      status: 'success',
      action: 'CreateResource',
      code: 201,
      url: '/api/v1/resources/123',
    });
    expect(header.url).toBe('/api/v1/resources/123');
    expect(header.code).toBe(201);
  });

  it('defaults message to empty string when omitted', () => {
    const header = buildEnvelopeHeader({
      status: 'error',
      action: 'Authenticate',
      code: 401,
    });
    expect(header.message).toBe('');
  });

  it('uses the provided message', () => {
    const header = buildEnvelopeHeader({
      status: 'warning',
      action: 'SomeAction',
      code: 200,
      message: 'Rate limit approaching',
    });
    expect(header.message).toBe('Rate limit approaching');
    expect(header.status).toBe('warning');
  });

  it('produces a unique id per call', () => {
    const a = buildEnvelopeHeader({ status: 'success', action: 'A', code: 200 });
    const b = buildEnvelopeHeader({ status: 'success', action: 'A', code: 200 });
    expect(a.id).not.toBe(b.id);
  });
});

describe('deriveAction', () => {
  // Helper: build a minimal request-like object for the pure function.
  const req = (overrides: Partial<{
    method: string;
    url: string;
    routeOptions: { url?: string; config?: { operationId?: string } };
  }>): FastifyRequest =>
    ({
      method: 'GET',
      url: '/api/v1/resources',
      routeOptions: { url: '/api/v1/resources', config: {} },
      ...overrides,
    }) as unknown as FastifyRequest;

  it('returns the operationId when declared on the route', () => {
    expect(
      deriveAction(
        req({
          routeOptions: { url: '/api/v1/resources', config: { operationId: 'ListResources' } },
        }),
      ),
    ).toBe('ListResources');
  });

  it('falls back to List<Resource> for GET on a collection without operationId', () => {
    expect(
      deriveAction(req({ method: 'GET', url: '/api/v1/items', routeOptions: { url: '/api/v1/items' } })),
    ).toBe('ListItems');
  });

  it('falls back to Get<Resource> for GET on an item (path param) without operationId', () => {
    expect(
      deriveAction(
        req({ method: 'GET', url: '/api/v1/items/abc', routeOptions: { url: '/api/v1/items/:id' } }),
      ),
    ).toBe('GetItems');
  });

  it('falls back to Create<Resource> for POST without operationId', () => {
    expect(
      deriveAction(req({ method: 'POST', url: '/api/v1/items', routeOptions: { url: '/api/v1/items' } })),
    ).toBe('CreateItems');
  });

  it('falls back to Delete<Resource> for DELETE on an item without operationId', () => {
    expect(
      deriveAction(
        req({ method: 'DELETE', url: '/api/v1/items/abc', routeOptions: { url: '/api/v1/items/:id' } }),
      ),
    ).toBe('DeleteItems');
  });

  it('falls back to Update<Resource> for PATCH on an item without operationId', () => {
    expect(
      deriveAction(
        req({ method: 'PATCH', url: '/api/v1/items/abc', routeOptions: { url: '/api/v1/items/:id' } }),
      ),
    ).toBe('UpdateItems');
  });

  it('uses a generic action when the path has no resource segment', () => {
    expect(deriveAction(req({ method: 'GET', url: '/api/v1', routeOptions: { url: '/api/v1' } }))).toBe(
      'ListRequest',
    );
  });
});

describe('isEnvelope', () => {
  it('returns true for an object with header and body', () => {
    expect(isEnvelope({ header: { id: 'x' }, body: {} })).toBe(true);
  });

  it('returns false for an object with only header', () => {
    expect(isEnvelope({ header: { id: 'x' } })).toBe(false);
  });

  it('returns false for an object with only body', () => {
    expect(isEnvelope({ body: {} })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isEnvelope(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isEnvelope(undefined)).toBe(false);
  });

  it('returns false for primitives', () => {
    expect(isEnvelope('hello')).toBe(false);
    expect(isEnvelope(42)).toBe(false);
    expect(isEnvelope(true)).toBe(false);
  });

  it('returns false for arrays', () => {
    expect(isEnvelope([1, 2, 3])).toBe(false);
  });

  it('returns false for an envelope-shaped object that is an array', () => {
    // arrays have no 'header'/'body' own keys in the expected sense
    expect(isEnvelope([])).toBe(false);
  });
});

describe('createSuccessEnvelope', () => {
  it('wraps a payload with a success header', () => {
    const env = createSuccessEnvelope({ hello: 'world' }, 'GetTest', 200);
    expect(env.header.status).toBe('success');
    expect(env.header.action).toBe('GetTest');
    expect(env.header.code).toBe(200);
    expect(env.header.message).toBe('');
    expect(env.body).toEqual({ hello: 'world' });
  });

  it('accepts optional message and url', () => {
    const env = createSuccessEnvelope({ ok: true }, 'CreateTest', 201, {
      message: 'Created',
      url: '/api/v1/test/1',
    });
    expect(env.header.message).toBe('Created');
    expect(env.header.url).toBe('/api/v1/test/1');
  });

  it('preserves the exact payload reference in body', () => {
    const payload = { nested: { a: 1 } };
    const env = createSuccessEnvelope(payload, 'GetTest', 200);
    expect(env.body).toBe(payload); // same reference
  });
});

/* ────────────────────────────────────────────────────────────────────── */
/*  Hook integration tests (Fastify inject)                                */
/* ────────────────────────────────────────────────────────────────────── */

describe('envelopePreSerialization hook (integration)', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = createServer({ logger: false });

    // /api/v1 test routes — these are enveloped.
    server.get(
      '/api/v1/test',
      { config: { operationId: 'GetTestResource' } },
      async () => ({ hello: 'world', num: 42 }),
    );
    server.post(
      '/api/v1/test',
      { config: { operationId: 'CreateTestResource' } },
      async (_req, reply) => {
        reply.code(201);
        return { created: true };
      },
    );
    server.get(
      '/api/v1/items/:id',
      { config: { operationId: 'GetItemResource' } },
      async () => ({ id: 'abc', name: 'widget' }),
    );
    // No operationId → fallback derivation.
    server.get('/api/v1/bare', async () => ({ bare: true }));
    // Non-2xx path.
    server.get(
      '/api/v1/forbidden',
      { config: { operationId: 'GetForbidden' } },
      async (_req, reply) => {
        reply.code(403);
        return { reason: 'nope' };
      },
    );
    // Non-object (string) payload.
    server.get(
      '/api/v1/raw',
      { config: { operationId: 'GetRaw' } },
      async (_req, reply) => {
        reply.type('text/plain').code(200);
        return 'plain-string';
      },
    );
    // Already-enveloped payload (simulates what BE-001f error handler sends).
    server.get(
      '/api/v1/prebuilt',
      { config: { operationId: 'GetPrebuilt' } },
      async () => ({
        header: { id: 'prebuilt-id', status: 'error', code: 400, action: 'X', servertime: '', message: 'pre' },
        body: { errors: [] },
      }),
    );

    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it('wraps a 200 GET /api/v1 response in the envelope', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/test' });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.header).toBeDefined();
    expect(data.body).toEqual({ hello: 'world', num: 42 });
    expect(data.header.status).toBe('success');
    expect(data.header.code).toBe(200);
    expect(data.header.action).toBe('GetTestResource');
    expect(data.header.message).toBe('');
    expect(data.header.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    const parsed = new Date(data.header.servertime).getTime();
    expect(Number.isNaN(parsed)).toBe(false);
  });

  it('uses the HTTP status code in header.code', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/v1/test' });
    expect(res.statusCode).toBe(201);
    const data = JSON.parse(res.body);
    expect(data.header.code).toBe(201);
    expect(data.header.status).toBe('success');
    expect(data.header.action).toBe('CreateTestResource');
    expect(data.body).toEqual({ created: true });
  });

  it('reflects the route operationId as action', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/items/abc' });
    const data = JSON.parse(res.body);
    expect(data.header.action).toBe('GetItemResource');
    expect(data.body).toEqual({ id: 'abc', name: 'widget' });
  });

  it('derives a fallback action when operationId is absent', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/bare' });
    const data = JSON.parse(res.body);
    expect(data.header.action).toBe('ListBare');
  });

  it('does NOT wrap non-2xx responses (error envelopes are BE-001f)', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/forbidden' });
    expect(res.statusCode).toBe(403);
    const data = JSON.parse(res.body);
    // Not enveloped — raw payload passed through.
    expect(data.header).toBeUndefined();
    expect(data.body).toBeUndefined();
    expect(data.reason).toBe('nope');
  });

  it('does NOT wrap non-object payloads (e.g. plain strings)', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/raw' });
    expect(res.statusCode).toBe(200);
    // Plain-string response is not JSON — check the raw body (not enveloped).
    expect(res.body).toBe('plain-string');
    expect(res.headers['content-type']).toMatch(/text\/plain/);
  });

  it('does NOT double-wrap an already-enveloped payload', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/prebuilt' });
    const data = JSON.parse(res.body);
    // The pre-built envelope is returned as-is (id is the literal set value).
    expect(data.header.id).toBe('prebuilt-id');
    expect(data.header.status).toBe('error');
    expect(data.body).toEqual({ errors: [] });
  });

  it('produces a unique response id per request', async () => {
    const res1 = await server.inject({ method: 'GET', url: '/api/v1/test' });
    const res2 = await server.inject({ method: 'GET', url: '/api/v1/test' });
    const id1 = JSON.parse(res1.body).header.id;
    const id2 = JSON.parse(res2.body).header.id;
    expect(id1).not.toBe(id2);
  });

  it('does NOT envelope infra endpoints: /health', async () => {
    const res = await server.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.header).toBeUndefined();
    expect(data.status).toBe('ok');
  });

  it('does NOT envelope infra endpoints: /openapi.json', async () => {
    const res = await server.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.openapi).toBeDefined(); // e.g. '3.1.0'
    expect(data.header).toBeUndefined(); // not wrapped
  });

  it('includes all required envelope header fields', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/test' });
    const data = JSON.parse(res.body);
    const required = ['id', 'status', 'servertime', 'action', 'message', 'code'];
    for (const field of required) {
      expect(data.header).toHaveProperty(field);
    }
    // url is optional — may or may not be present on success
    expect(typeof data.header.id).toBe('string');
    expect(typeof data.header.status).toBe('string');
    expect(typeof data.header.servertime).toBe('string');
    expect(typeof data.header.action).toBe('string');
    expect(typeof data.header.message).toBe('string');
    expect(typeof data.header.code).toBe('number');
  });
});

/* ────────────────────────────────────────────────────────────────────── */
/*  Direct hook unit test (no route registration)                          */
/* ────────────────────────────────────────────────────────────────────── */

describe('envelopePreSerialization (direct invocation)', () => {
  it('returns the payload unchanged when path is not /api/v1', async () => {
    const request = { url: '/health', method: 'GET' } as unknown as FastifyRequest;
    const reply = { statusCode: 200 } as unknown as FastifyReply;
    const payload = { status: 'ok' };
    const result = await envelopePreSerialization(request, reply, payload);
    expect(result).toBe(payload);
  });

  it('wraps a 2xx object payload under /api/v1', async () => {
    const request = {
      url: '/api/v1/test',
      method: 'GET',
      routeOptions: { config: { operationId: 'DirectTest' } },
    } as unknown as FastifyRequest;
    const reply = { statusCode: 200 } as unknown as FastifyReply;
    const payload = { value: 1 };
    const result = (await envelopePreSerialization(request, reply, payload)) as {
      header: { status: string; action: string; code: number };
      body: unknown;
    };
    expect(result.header.status).toBe('success');
    expect(result.header.action).toBe('DirectTest');
    expect(result.header.code).toBe(200);
    expect(result.body).toBe(payload);
  });

  it('passes through when statusCode is not 2xx', async () => {
    const request = {
      url: '/api/v1/test',
      method: 'GET',
      routeOptions: { config: { operationId: 'DirectTest' } },
    } as unknown as FastifyRequest;
    const reply = { statusCode: 500 } as unknown as FastifyReply;
    const payload = { error: 'boom' };
    const result = await envelopePreSerialization(request, reply, payload);
    expect(result).toBe(payload); // not wrapped
  });

  it('passes through a null payload', async () => {
    const request = { url: '/api/v1/test', method: 'GET' } as unknown as FastifyRequest;
    const reply = { statusCode: 200 } as unknown as FastifyReply;
    const result = await envelopePreSerialization(request, reply, null);
    expect(result).toBeNull();
  });
});
