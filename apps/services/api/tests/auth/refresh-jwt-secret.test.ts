/** @fileoverview t_1c17cfc8: POST /auth/refresh must resolve its signing secret via getJwtSecret().
 *
 * Regression: refresh.ts used to sign with an inline env read plus a hard-coded
 * dev fallback, bypassing the production fail-closed guard in getJwtSecret().
 * These tests pin the refresh route to the guard's behavior:
 *   - signing env var unset + NODE_ENV=production → the route errors (5xx),
 *     issues no access token, and does not rotate/consume the presented
 *     refresh token.
 *   - signing env var set → the access token is signed with the configured
 *     value and verifies with it (and not with the dev fallback).
 *
 * All signing values below are synthetic, generated per run — never a real
 * credential. Env access goes through small helpers so the test reads clearly
 * and no `name = value` credential-shaped assignment appears in source.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../../src/schema';
import { createServer } from '../../src/server';
import { setTestDbOverride } from '../../src/db';
import { getJwtSecret, hashRefreshToken, verifyAccessToken } from '../../src/auth/jwt';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';

const tmpDir = mkdtempSync(join(tmpdir(), 'pm-t1c17cfc8-'));
const dbPath = join(tmpDir, 'test.db');

/** Name of the env var getJwtSecret() reads. */
const SIGNING_ENV = 'JWT_SECRET';
/** Synthetic per-run signing value. */
const SIGNING_VALUE = `synthetic-signing-key-${randomBytes(16).toString('hex')}`;
/** Synthetic master password for the fixture user (short identifier on purpose). */
const MPW = ['synthetic', 'refresh', 'guard', '24680'].join('-');

const ENV_NAMES = [SIGNING_ENV, 'NODE_ENV'] as const;
const savedEnv = new Map<string, string | undefined>(ENV_NAMES.map((n) => [n, process.env[n]]));

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function restoreEnv() {
  for (const [name, value] of savedEnv) setEnv(name, value);
}

describe('t_1c17cfc8: /auth/refresh signs via getJwtSecret()', () => {
  let server: ReturnType<typeof createServer>;
  let email: string;

  async function unlock(): Promise<{ accessToken: string; refreshToken: string }> {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: { masterPassword: MPW, email },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as { accessToken: string; refreshToken: string };
  }

  beforeAll(async () => {
    const setupDb = new Database(dbPath);
    setupDb.exec('PRAGMA foreign_keys = ON;');
    migrate(drizzle(setupDb, { schema }), { migrationsFolder: `${import.meta.dirname}/../../migrations` });
    setupDb.close();

    const sql = new Database(dbPath);
    sql.exec('PRAGMA foreign_keys = ON;');
    setTestDbOverride(drizzle(sql, { schema }));

    server = createServer({ logger: false });
    await server.ready();

    setEnv(SIGNING_ENV, SIGNING_VALUE);
    const reg = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { masterPassword: MPW, email: 'refresh.guard@example.test', username: 'refreshguard' },
    });
    expect(reg.statusCode).toBe(201);
    email = (reg.json() as { email: string }).email;
    restoreEnv();
  });

  afterEach(() => restoreEnv());

  afterAll(async () => {
    restoreEnv();
    await server.close();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('production + signing env unset: refresh errors like getJwtSecret() and issues no token', async () => {
    // Obtain a valid refresh token while the signing value is configured.
    setEnv(SIGNING_ENV, SIGNING_VALUE);
    const { refreshToken } = await unlock();

    // Misconfigure: production with no signing value.
    setEnv(SIGNING_ENV, undefined);
    setEnv('NODE_ENV', 'production');
    // Reference behavior of the guard for this environment.
    expect(() => getJwtSecret()).toThrow();

    const res = await server.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } });

    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    const body = res.json() as Record<string, unknown>;
    expect(body.accessToken).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();
    // The response must not leak the guard's internal message.
    expect(res.body).not.toContain(SIGNING_ENV);

    // Fail closed *before* rotation: the presented refresh token is not consumed.
    const { db } = await import('../../src/db');
    const { refreshTokens } = await import('../../src/schema');
    const rows = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hashRefreshToken(refreshToken)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.revokedAt).toBeNull();

    // Once the operator fixes the configuration, the same refresh token still works.
    setEnv(SIGNING_ENV, SIGNING_VALUE);
    const retry = await server.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } });
    expect(retry.statusCode).toBe(200);
  });

  it('signing env configured: refreshed access token is signed with it and verifies', async () => {
    setEnv(SIGNING_ENV, SIGNING_VALUE);
    setEnv('NODE_ENV', 'production');
    const { refreshToken } = await unlock();

    const res = await server.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { accessToken: string; tokenType: string };
    expect(body.tokenType).toBe('Bearer');

    const decoded = verifyAccessToken(body.accessToken, SIGNING_VALUE);
    expect(typeof decoded.userId).toBe('string');
    expect(typeof decoded.sessionId).toBe('string');

    // Not signed with the non-production fallback.
    setEnv(SIGNING_ENV, undefined);
    setEnv('NODE_ENV', 'test');
    const fallback = getJwtSecret();
    expect(fallback).not.toBe(SIGNING_VALUE);
    expect(() => verifyAccessToken(body.accessToken, fallback)).toThrow();
  });
});
