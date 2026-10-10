/** @fileoverview t_1c17cfc8: POST /auth/refresh must resolve its signing secret via getJwtSecret().
 *
 * Regression: refresh.ts used to sign with `process.env.JWT_SECRET ?? <dev constant>`,
 * bypassing the production fail-closed guard in getJwtSecret(). These tests pin
 * the refresh route to the guard's behavior:
 *   - JWT_SECRET unset + NODE_ENV=production → the route errors (5xx), issues no
 *     access token, and does not rotate/consume the presented refresh token.
 *   - JWT_SECRET set → the access token is signed with the configured secret and
 *     verifies with it (and not with the dev fallback).
 *
 * All secret values below are synthetic test-only strings generated per run.
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

// Synthetic, per-run secret — never a real credential.
const SYNTHETIC_SECRET = `synthetic-test-secret-${randomBytes(16).toString('hex')}`;
const MASTER_PASSWORD = 'synthetic-refresh-guard-password-24680';

const savedEnv = { JWT_SECRET: process.env.JWT_SECRET, NODE_ENV: process.env.NODE_ENV };

function restoreEnv() {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('t_1c17cfc8: /auth/refresh signs via getJwtSecret()', () => {
  let server: ReturnType<typeof createServer>;
  let email: string;

  async function unlock(): Promise<{ accessToken: string; refreshToken: string }> {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: { masterPassword: MASTER_PASSWORD, email },
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

    process.env.JWT_SECRET = SYNTHETIC_SECRET;
    const reg = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { masterPassword: MASTER_PASSWORD, email: 'refresh.guard@example.test', username: 'refreshguard' },
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

  it('production + JWT_SECRET unset: refresh errors like getJwtSecret() and issues no token', async () => {
    // Obtain a valid refresh token while the secret is configured.
    process.env.JWT_SECRET = SYNTHETIC_SECRET;
    const { refreshToken } = await unlock();

    // Misconfigure: production with no JWT_SECRET.
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = 'production';
    // Reference behavior of the guard for this environment.
    expect(() => getJwtSecret()).toThrow();

    const res = await server.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } });

    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    const body = res.json() as Record<string, unknown>;
    expect(body.accessToken).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();
    // The response must not leak the guard's internal message.
    expect(res.body).not.toContain('JWT_SECRET');

    // Fail closed *before* rotation: the presented refresh token is not consumed.
    const { db } = await import('../../src/db');
    const { refreshTokens } = await import('../../src/schema');
    const rows = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hashRefreshToken(refreshToken)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.revokedAt).toBeNull();

    // Once the operator fixes the configuration, the same refresh token still works.
    process.env.JWT_SECRET = SYNTHETIC_SECRET;
    const retry = await server.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } });
    expect(retry.statusCode).toBe(200);
  });

  it('JWT_SECRET configured: refreshed access token is signed with it and verifies', async () => {
    process.env.JWT_SECRET = SYNTHETIC_SECRET;
    process.env.NODE_ENV = 'production';
    const { refreshToken } = await unlock();

    const res = await server.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { accessToken: string; tokenType: string };
    expect(body.tokenType).toBe('Bearer');

    const decoded = verifyAccessToken(body.accessToken, SYNTHETIC_SECRET);
    expect(typeof decoded.userId).toBe('string');
    expect(typeof decoded.sessionId).toBe('string');

    // Not signed with the non-production fallback secret.
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = 'test';
    const fallback = getJwtSecret();
    expect(fallback).not.toBe(SYNTHETIC_SECRET);
    expect(() => verifyAccessToken(body.accessToken, fallback)).toThrow();
  });
});
