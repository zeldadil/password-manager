/**
 * BE-001f: error-handler coverage.
 *
 * Test types: unit (pure mapping/redaction), integration (fastify.inject),
 * security (stack-trace / secret-leak regression).
 *
 * Security note (SEC-001 AR-4): NO real credential ever appears in this file.
 * Any token-like value is assembled at runtime from fragments so it cannot
 * be matched by gitleaks and so the file stays clean on public master.
 */
import type { FastifyBaseLogger, FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { createServer } from '../src/server';
import {
  createErrorHandler,
  buildErrorEnvelope,
  redactSecrets,
} from '../src/middleware/error-handler';
import { isEnvelope } from '../src/middleware/envelope';

// ──────────────────────────────────────────────────────────────
// A telegram-bot-token look-alike, assembled at runtime so no literal
// token is ever committed (gitleaks-clean). Used to prove redaction.
//  ─ a synthetic, non-functional placeholder.
const RUNTIME_FAKE_TOKEN = '9' + '9999999' + ':' + 'Z' + 'f'.repeat(40);

function stubRequest(url: string, method = 'GET'): FastifyRequest {
  return {
    method,
    url,
    routeOptions: { url, config: {} },
  } as unknown as FastifyRequest;
}

// ── Unit: redactSecrets ─────────────────────────────────────────────────
describe('redactSecrets', () => {
  it('redacts telegram-bot-token patterns', () => {
    expect(redactSecrets(`leaked ${RUNTIME_FAKE_TOKEN} tail`)).toBe('leaked <REDACTED> tail');
    expect(redactSecrets(RUNTIME_FAKE_TOKEN)).toBe('<REDACTED>');
  });

  it('redacts bearer tokens', () => {
    const bearer = 'Authorization: Bearer ' + 'a'.repeat(40);
    expect(redactSecrets(bearer)).toBe('Authorization: Bearer <REDACTED>');
  });

  it('redacts key-style assignments', () => {
    expect(redactSecrets('password=' + 'x'.repeat(20))).toMatch(/<REDACTED>/);
  });

  it('leaves non-secret text untouched', () => {
    const text = 'the requested resource could not be found';
    expect(redactSecrets(text)).toBe(text);
  });

  it('returns empty string for non-string input', () => {
    expect(redactSecrets(undefined)).toBe('');
    expect(redactSecrets(null)).toBe('');
    expect(redactSecrets(42)).toBe('');
  });
});

// ── Unit: buildErrorEnvelope (pure mapping) ──────────────────────────────
describe('buildErrorEnvelope', () => {
  it('maps a 404 to a friendly, non-revealing envelope', () => {
    const error = Object.assign(new Error('No path /api/v1/_hidden'), {
      statusCode: 404,
      code: 'FST_ERR_NOT_FOUND',
    });
    const env = buildErrorEnvelope(error as FastifyError, stubRequest('/api/v1/_hidden'));

    expect(env.header.status).toBe('error');
    expect(env.header.code).toBe(404);
    // Internal routing detail ("No path /api/v1/_hidden") must NOT leak.
    expect(env.header.message).toBe('The requested resource could not be found.');
    expect(env.header.message).not.toContain('_hidden');
    expect(env.body.errors[0].code).toBe('NOT_FOUND');
    expect(env.body.errors[0].message).toBe('The requested resource could not be found.');
    // 404 (no real operation) normalizes the action to "NotFound".
    expect(env.header.action).toBe('NotFound');
  });

  it('maps an unexpected error (no statusCode) to a generic 500', () => {
    const error = new Error('db refused connection to db.internal.corp:5432');
    const env = buildErrorEnvelope(error as FastifyError, stubRequest('/api/v1/resources'));

    expect(env.header.code).toBe(500);
    expect(env.header.status).toBe('error');
    expect(env.header.message).toBe('An internal server error occurred.');
    // Internal host/port must NOT leak to the client.
    expect(JSON.stringify(env)).not.toMatch(/db\.internal\.corp|5432/);
  });

  it('maps 400 validation errors to field-level ErrorDetail[]', () => {
    const error = Object.assign(new Error('Validation failed'), {
      statusCode: 400,
      code: 'FST_ERR_VALIDATION',
      validation: [{ instancePath: '/name', message: 'must be string' }],
    });
    const env = buildErrorEnvelope(error as FastifyError, stubRequest('/api/v1/resources', 'POST'));

    expect(env.header.code).toBe(400);
    expect(env.body.errors.length).toBe(1);
    expect(env.body.errors[0].code).toBe('VALIDATION_ERROR');
    expect(env.body.errors[0].field).toBe('/name');
    expect(env.body.errors[0].message).toBe('must be string');
  });

  it('redacts secrets embedded in echoed validation messages', () => {
    const error = Object.assign(new Error('validation'), {
      statusCode: 400,
      validation: [{ instancePath: '/note', message: `must be <${RUNTIME_FAKE_TOKEN}>` }],
    });
    const env = buildErrorEnvelope(error as FastifyError, stubRequest('/api/v1/_t'));

    expect(env.body.errors[0].message).not.toContain(RUNTIME_FAKE_TOKEN);
    expect(env.body.errors[0].message).toContain('<REDACTED>');
  });

  it('derives 4xx client codes without collapsing to 500', () => {
    for (const c of [400, 401, 403, 404, 409, 429] as const) {
      const error = Object.assign(new Error('x'), { statusCode: c });
      const env = buildErrorEnvelope(error as FastifyError, stubRequest('/api/v1/x'));
      expect(env.header.code).toBe(c);
    }
  });

  it('never embeds a stack trace or internal path', () => {
    const error = Object.assign(new Error('boom'), {
      statusCode: 500,
      stack: 'Error: boom\n    at /secret/internal/path.js:1:1\n    at Object.<anonymous>',
    });
    const env = buildErrorEnvelope(error as FastifyError, stubRequest('/api/v1/_t'));

    const dumped = JSON.stringify(env);
    expect(dumped).not.toMatch(/stack/);
    expect(dumped).not.toMatch(/\/secret\/internal\/path\.js/);
  });
});

// ── Integration + security via fastify.inject ───────────────────────────
describe('error handler (integration)', () => {
  let server: ReturnType<typeof createServer>;

  beforeAll(async () => {
    server = createServer({ logger: false });
    // createServer wires the global error handler already; register throwaway
    // routes on the root scope to exercise the 5xx and 400 paths.
    server.get(
      '/api/v1/_test/throw',
      { config: { operationId: 'ThrowError' } },
      async () => {
        throw Object.assign(new Error('leaked:' + RUNTIME_FAKE_TOKEN), { statusCode: 500 });
      },
    );
    server.post(
      '/api/v1/_test/echo',
      {
        config: { operationId: 'EchoResource' },
        schema: {
          body: {
            type: 'object',
            required: ['name'],
            properties: { name: { type: 'string' } },
          },
        },
      },
      async (req, reply) => {
        reply.send({ yourName: (req.body as { name: string }).name });
      },
    );
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it('returns a consistent error envelope for a 404', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/does-not-exist' });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(isEnvelope(body)).toBe(true);
    expect(body.header.status).toBe('error');
    expect(body.header.code).toBe(404);
    expect(body.header.action).toBe('NotFound');
  });

  it('returns a consistent error envelope for an infra-path 404', async () => {
    const res = await server.inject({ method: 'GET', url: '/openapi/unknown.json' });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(isEnvelope(body)).toBe(true);
    expect(body.header.status).toBe('error');
    expect(body.header.code).toBe(404);
  });

  it('never leaks a stack trace in a 500 response', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/_test/throw' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toMatch(/stack|at .*\(node|at .*\(internal|at .*\(file:/i);
    const body = JSON.parse(res.body);
    expect(body.header.code).toBe(500);
    expect(body.header.status).toBe('error');
    expect(body.body.errors[0].message).toBe('An internal server error occurred.');
  });

  it('redacts a secret from a thrown error so none reach the client', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/_test/throw' });
    expect(res.body).not.toContain(RUNTIME_FAKE_TOKEN);
    expect(res.body).not.toContain('leaked:');
  });

  it('maps a validation failure to a 400 envelope with field details', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/_test/echo',
      payload: {},
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(isEnvelope(body)).toBe(true);
    expect(body.header.code).toBe(400);
    expect(body.body.errors.length).toBeGreaterThan(0);
    expect(body.body.errors.some((e: { field: string }) => e.field.includes('name'))).toBe(true);
  });

  it('does NOT double-wrap an envelope (BE-001d contract)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/_test/echo',
      payload: { name: 'adil' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(isEnvelope(body)).toBe(true);
    expect(body.header.status).toBe('success');
    // The original payload is the envelope body (not nested under `data`).
    expect(body.body).toEqual({ yourName: 'adil' });
  });
});

// ── Integration: createErrorHandler factory in isolation ─────────────────
describe('createErrorHandler (factory)', () => {
  it('logs and emits an envelope without throwing', () => {
    const sent: { status: number; body: unknown }[] = [];
    class FakeReply {
      status = 200;
      code(s: number) {
        this.status = s;
        return this;
      }
      send(body: unknown) {
        sent.push({ status: this.status, body });
        return this;
      }
    }
    const fakeReply = new FakeReply() as unknown as FastifyReply;

    const logged: unknown[] = [];
    const noopLog = {
      warn: () => {},
      error: () => {},
      fatal: () => {},
      info: () => {},
      trace: () => {},
      debug: () => {},
      child: () => noopLog,
      flush: () => {},
    } as unknown as FastifyBaseLogger;
    const fakeLog = {
      warn: (obj: unknown, msg?: string) => {
        logged.push(['warn', obj, msg]);
      },
      error: (obj: unknown, msg?: string) => {
        logged.push(['error', obj, msg]);
      },
      fatal: () => {},
      info: () => {},
      trace: () => {},
      debug: () => {},
      child: () => noopLog,
      flush: () => {},
    } as unknown as FastifyBaseLogger;

    const handler = createErrorHandler({ log: fakeLog, nodeEnv: 'production' });
    const error = Object.assign(new Error('internal ' + RUNTIME_FAKE_TOKEN), {
      statusCode: 500,
    }) as FastifyError;

    expect(() => handler(error, stubRequest('/api/v1/_x'), fakeReply)).not.toThrow();
    expect(sent[0].status).toBe(500);
    // Production: no stack logged in the warn payload
    expect(JSON.stringify(logged)).not.toMatch(/stack/);
    // The redacted message (no secret) reaches the log line
    const [, , msg] = logged[0] as [string, unknown, string | undefined];
    expect(msg).not.toContain(RUNTIME_FAKE_TOKEN);
  });
});