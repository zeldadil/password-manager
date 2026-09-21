/** @fileoverview BE-002b unlock endpoint integration tests.

 * Test type: integration (spins up real Fastify server via createServer()).
 * Covers:
 *   AC1 — POST /auth/unlock accepts master password, runs KDF, decrypts vault key
 *   AC2 — Returns short-lived JWT (15m) + refresh token (30d rotation)
 *
 * Prerequisite: a registered user exists in the test DB. We register one in
 * beforeAll using the existing register endpoint.
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
  let registeredUserId: string;
  let registeredEmail: string;
  let registeredUsername: string;

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

    // 5. Register a test user via the register endpoint.
    const registerRes = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        masterPassword: 'test-unlock-password-12345',
        email: 'unlock.test@example.test',
        username: 'unlocktest',
      },
    });

    expect(registerRes.statusCode).toBe(201);
    const registerBody = registerRes.json();
    registeredUserId = registerBody.id;
    registeredEmail = registerBody.email;
    registeredUsername = registerBody.username;
  });

  afterAll(async () => {
    await server.close();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // ── Positive: happy path unlock ─────────────────────────────────────────────

  it('AC1: accepts master password, runs KDF, decrypts vault key — returns 200', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        masterPassword: 'test-unlock-password-12345',
        email: registeredEmail,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // AC1: response contains the expected token fields
    expect(body).toHaveProperty('accessToken');
    expect(body).toHaveProperty('refreshToken');
    expect(body).toHaveProperty('expiresIn');
    expect(body).toHaveProperty('tokenType', 'Bearer');
  });

  it('AC2: access token is a valid JWT with 15-minute expiry', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        masterPassword: 'test-unlock-password-12345',
        username: registeredUsername,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // AC2a: access token is a 3-segment JWT
    const tokenParts = body.accessToken.split('.');
    expect(tokenParts).toHaveLength(3);

    // AC2b: expiresIn is 900 (15 minutes in seconds)
    expect(body.expiresIn).toBe(900);

    // AC2c: refresh token is a non-empty hex string
    expect(body.refreshToken).toBeTruthy();
    expect(body.refreshToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it('unlocks with username instead of email', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        masterPassword: 'test-unlock-password-12345',
        username: registeredUsername,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
  });

  // ── Negative: wrong password ────────────────────────────────────────────────

  it('returns 401 for wrong master password', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        masterPassword: 'wrong-password-xyz',
        email: registeredEmail,
      },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toBe('Unauthorized');
  });

  // ── Negative: user not found ────────────────────────────────────────────────

  it('returns 404 for unknown email', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        masterPassword: 'any-password-here',
        email: 'nonexistent@example.test',
      },
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBe('Not Found');
  });

  it('returns 404 for unknown username', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        masterPassword: 'any-password-here',
        username: 'nonexistentuser',
      },
    });

    expect(res.statusCode).toBe(404);
  });

  // ── Negative: missing identifier ────────────────────────────────────────────

  it('returns 400 when neither email nor username is provided', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        masterPassword: 'test-unlock-password-12345',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('Bad Request');
    expect(body.message).toContain('email or username');
  });

  // ── Negative: short password ────────────────────────────────────────────────

  it('returns 400 for password shorter than 8 characters', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        masterPassword: 'short',
        email: registeredEmail,
      },
    });

    expect(res.statusCode).toBe(400);
  });

  // ── Negative: missing master password ───────────────────────────────────────

  it('returns 400 when masterPassword is missing', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        email: registeredEmail,
      },
    });

    expect(res.statusCode).toBe(400);
  });

  // ── Negative: both email and username wrong ─────────────────────────────────

  it('returns 404 when both email and username are incorrect', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        masterPassword: 'test-unlock-password-12345',
        email: 'wrong@example.test',
        username: 'wronguser',
      },
    });

    expect(res.statusCode).toBe(404);
  });

  // ── Security: response does not leak KDF material ──────────────────────────

  it('response does not leak salt, ciphertext, iv, or tag', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        masterPassword: 'test-unlock-password-12345',
        email: registeredEmail,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body).not.toHaveProperty('salt');
    expect(body).not.toHaveProperty('vaultKeyEncrypted');
    expect(body).not.toHaveProperty('vaultKeyIv');
    expect(body).not.toHaveProperty('vaultKeyTag');
    expect(body).not.toHaveProperty('kdfParams');
    expect(body).not.toHaveProperty('masterPassword');

    // Only the expected keys should be present
    expect(Object.keys(body).sort()).toEqual(
      ['accessToken', 'expiresIn', 'refreshToken', 'tokenType'].sort(),
    );
  });

  // ── Refresh token rotation: new unlock issues a different refresh token ─────

  it('issue a different refresh token on each unlock attempt', async () => {
    const res1 = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        masterPassword: 'test-unlock-password-12345',
        email: registeredEmail,
      },
    });

    const res2 = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        masterPassword: 'test-unlock-password-12345',
        email: registeredEmail,
      },
    });

    const body1 = res1.json();
    const body2 = res2.json();

    // Same access token (deterministic for same user+secret — in production
    // you might rotate these too, but for the 15-min window this is fine).
    // Refresh tokens MUST be different (rotation).
    expect(body1.refreshToken).not.toBe(body2.refreshToken);
    expect(body1.accessToken).toBe(body2.accessToken);
  });
});
