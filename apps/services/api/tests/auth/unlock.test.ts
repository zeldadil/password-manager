/** @fileoverview BE-002b unlock endpoint integration tests.

 * Test type: integration (spins up real Fastify server via createServer()).
 * Covers AC1 (master password → KDF → decrypt vault key) and
 *        AC2 (short-lived JWT 15m + refresh token 30d rotation).
 *
 * AR-3: Positive + negative tests per crypto change.
 * AR-4: All data is synthetic (generated at test time).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import './test-env';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../../src/schema';
import { createServer } from '../../src/server';
import { setTestDbOverride } from '../../src/db';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDir = mkdtempSync(join(tmpdir(), 'pm-be002b-'));
const dbPath = join(tmpDir, 'test.db');

describe('BE-002b: POST /auth/unlock', () => {
  let server: ReturnType<typeof createServer>;

  beforeAll(async () => {
    // 1. Create the DB file and run migrations.
    const setupDb = new Database(dbPath);
    setupDb.exec('PRAGMA foreign_keys = ON;');
    const migratedDb = drizzle(setupDb, { schema });
    migrate(migratedDb, { migrationsFolder: `${import.meta.dirname}/../../migrations` });
    setupDb.close();

    // 2. Re-open a fresh drizzle connection to the now-migrated file.
    const sql = new Database(dbPath);
    sql.exec('PRAGMA foreign_keys = ON;');
    const liveDb = drizzle(sql, { schema });

    // 3. Override the server's db singleton BEFORE creating the server.
    setTestDbOverride(liveDb);

    // 4. Create the server.
    server = createServer({ logger: false });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  // ── Helper: register a user so we can unlock against them ──────────────

  async function registerUser(
    email: string,
    username: string,
    masterPassword: string,
  ) {
    return server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, username, masterPassword },
    });
  }

  // ── Positive: happy path unlock ────────────────────────────────────────

  it('unlocks with correct master password and returns access + refresh tokens', async () => {
    // Register first
    await registerUser(
      'unlock.user@example.test',
      'unlockuser',
      'my-secure-test-password-123',
    );

    // Now unlock
    const res = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        email: 'unlock.user@example.test',
        masterPassword: 'my-secure-test-password-123',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // AC2: short-lived JWT (15m) + refresh token (30d, rotation)
    expect(body).toHaveProperty('accessToken');
    expect(body).toHaveProperty('refreshToken');
    expect(body).toHaveProperty('expiresIn');
    expect(body).toHaveProperty('user');

    // Token shape checks
    expect(typeof body.accessToken).toBe('string');
    expect(body.accessToken.split('.')).toHaveLength(3); // JWT dot-separated

    expect(typeof body.refreshToken).toBe('string');
    expect(body.refreshToken.split('.')).toHaveLength(3); // JWT dot-separated

    // expiresIn should be ~900 seconds (15 min), allow 60s tolerance for test runtime
    expect(body.expiresIn).toBeGreaterThan(840);
    expect(body.expiresIn).toBeLessThanOrEqual(900);

    // User info returned (non-secret)
    expect(body.user).toEqual({
      id: expect.any(String),
      email: 'unlock.user@example.test',
      username: 'unlockuser',
    });
  });

  it('returns different refresh token on each unlock (rotation)', async () => {
    // Register a fresh user
    await registerUser(
      'rotation.user@example.test',
      'rotationuser',
      'rotation-password-789',
    );

    const res1 = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        email: 'rotation.user@example.test',
        masterPassword: 'rotation-password-789',
      },
    });

    const res2 = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        email: 'rotation.user@example.test',
        masterPassword: 'rotation-password-789',
      },
    });

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    const body1 = res1.json();
    const body2 = res2.json();

    // Each unlock issues a new refresh token (rotation)
    expect(body1.refreshToken).not.toBe(body2.refreshToken);
    // Access tokens should also differ (new jti each time)
    expect(body1.accessToken).not.toBe(body2.accessToken);
    // But both should be valid JWTs
    expect(body1.accessToken.split('.')).toHaveLength(3);
    expect(body2.accessToken.split('.')).toHaveLength(3);
  });

  // ── Negative: wrong password ───────────────────────────────────────────

  it('returns 401 for wrong master password', async () => {
    await registerUser(
      'wrongpw.user@example.test',
      'wrongpwuser',
      'correct-password-111',
    );

    const res = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        email: 'wrongpw.user@example.test',
        masterPassword: 'wrong-password-222',
      },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    // Handler returns { error: 'Unauthorized', message: 'Invalid credentials' }
    // (not enveloped — only thrown errors go through the envelope handler)
    expect(body.error).toBe('Unauthorized');
    expect(body.message).toBe('Invalid credentials');
  });

  // ── Negative: unknown email ────────────────────────────────────────────

  it('returns 401 for unknown email', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        email: 'nobody@example.test',
        masterPassword: 'some-password',
      },
    });

    expect(res.statusCode).toBe(401);
  });

  // ── Negative: missing fields ───────────────────────────────────────────

  it('returns 400 when email is missing', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        masterPassword: 'some-password',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when masterPassword is missing', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        email: 'test@example.test',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  // ── Negative: empty password (schema validation) ───────────────────────
  // Fastify minLength:1 validation rejects empty string as 400.

  it('returns 400 for empty master password (schema validation)', async () => {
    await registerUser(
      'empty.user@example.test',
      'emptyuser',
      'non-empty-password',
    );

    const res = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        email: 'empty.user@example.test',
        masterPassword: '',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  // ── Positive: tokens are verifiable JWTs ───────────────────────────────

  it('access token payload contains correct claims', async () => {
    await registerUser(
      'claims.user@example.test',
      'claimsuser',
      'claims-password-444',
    );

    const res = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        email: 'claims.user@example.test',
        masterPassword: 'claims-password-444',
      },
    });

    expect(res.statusCode).toBe(200);
    const { accessToken } = res.json();

    // Decode the JWT payload (base64url middle segment)
    const parts = accessToken.split('.');
    expect(parts).toHaveLength(3);

    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8'),
    );

    expect(payload).toHaveProperty('sub');
    expect(payload).toHaveProperty('aud', 'pm-api');
    expect(payload).toHaveProperty('exp');
    expect(payload).toHaveProperty('iat');
    expect(payload).toHaveProperty('jti');
    // exp should be ~15 min from now
    const now = Math.floor(Date.now() / 1000);
    expect(payload.exp).toBeGreaterThan(now + 840);
    expect(payload.exp).toBeLessThanOrEqual(now + 900 + 5); // small clock skew tolerance
  });

  // ── Positive: refresh tokens are persisted ─────────────────────────────

  it('issues distinct refresh tokens across multiple unlocks', async () => {
    await registerUser(
      'persist.user@example.test',
      'persistuser',
      'persist-password-555',
    );

    // Unlock 3 times
    const tokens: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await server.inject({
        method: 'POST',
        url: '/auth/unlock',
        payload: {
          email: 'persist.user@example.test',
          masterPassword: 'persist-password-555',
        },
      });
      expect(res.statusCode).toBe(200);
      tokens.push(res.json().refreshToken);
    }

    // All 3 should be distinct (rotation)
    expect(tokens[0]).not.toBe(tokens[1]);
    expect(tokens[1]).not.toBe(tokens[2]);
    expect(tokens[0]).not.toBe(tokens[2]);
  });
});
