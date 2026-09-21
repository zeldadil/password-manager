import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../../src/schema';
import { createServer } from '../../src/server';
import { setTestDbOverride } from '../../src/db';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDir = mkdtempSync(join(tmpdir(), 'pm-be002c-'));
const dbPath = join(tmpDir, 'test.db');

describe('BE-002c: POST /auth/lock + GET /auth/status', () => {
  let server: ReturnType<typeof createServer>;
  let registeredUserId: string;
  let registeredEmail: string;
  let registeredUsername: string;
  let accessToken: string;

  beforeAll(async () => {
    const setupDb = new Database(dbPath);
    setupDb.exec('PRAGMA foreign_keys = ON;');
    const migratedDb = drizzle(setupDb, { schema });
    migrate(migratedDb, { migrationsFolder: `${import.meta.dirname}/../../migrations` });
    setupDb.close();

    const sql = new Database(dbPath);
    sql.exec('PRAGMA foreign_keys = ON;');
    const liveDb = drizzle(sql, { schema });

    setTestDbOverride(liveDb);

    server = createServer({ logger: false });
    await server.ready();

    const registerRes = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        masterPassword: 'test-lock-password-67890',
        email: 'lock.test@example.test',
        username: 'locktest',
      },
    });

    expect(registerRes.statusCode).toBe(201);
    const registerBody = registerRes.json() as { id: string; email: string; username: string };
    registeredUserId = registerBody.id;
    registeredEmail = registerBody.email;
    registeredUsername = registerBody.username;

    const unlockRes = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        masterPassword: 'test-lock-password-67890',
        email: registeredEmail,
      },
    });

    expect(unlockRes.statusCode).toBe(200);
    const unlockBody = unlockRes.json() as { accessToken: string };
    accessToken = unlockBody.accessToken;
    expect(accessToken).toBeTruthy();
  });

  afterAll(async () => {
    await server.close();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  // AC1: POST /auth/lock
  it('AC1: POST /auth/lock with valid token returns 200 + locked status', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/lock',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string };
    expect(body.status).toBe('locked');
  });

  it('AC1: after lock, GET /auth/status returns 401 (vault locked)', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/auth/status',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: string; message: string };
    expect(body.error).toBe('Unauthorized');
    expect(body.message).toContain('locked');
  });

  it('AC1: after lock, POST /auth/lock again is idempotent (still 200 locked)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/lock',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string };
    expect(body.status).toBe('locked');
  });

  // AC2: GET /auth/status — unlocked state
  it('AC2: GET /auth/status returns unlocked before lock', async () => {
    const unlockRes = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        masterPassword: 'test-lock-password-67890',
        email: registeredEmail,
      },
    });
    expect(unlockRes.statusCode).toBe(200);
    const body = unlockRes.json() as { accessToken: string };
    const freshToken = body.accessToken;

    const statusRes = await server.inject({
      method: 'GET',
      url: '/auth/status',
      headers: { authorization: `Bearer ${freshToken}` },
    });
    expect(statusRes.statusCode).toBe(200);
    const statusBody = statusRes.json() as { status: string; sessionId: string; expiresAt: string };
    expect(statusBody.status).toBe('unlocked');
    expect(statusBody).toHaveProperty('sessionId');
    expect(statusBody).toHaveProperty('expiresAt');
    expect(new Date(statusBody.expiresAt).toISOString()).toBe(statusBody.expiresAt);
  });

  it('AC2: status sessionId matches the session created by unlock', async () => {
    const unlockRes = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        masterPassword: 'test-lock-password-67890',
        email: registeredEmail,
      },
    });
    const freshToken = (unlockRes.json() as { accessToken: string }).accessToken;

    const statusRes = await server.inject({
      method: 'GET',
      url: '/auth/status',
      headers: { authorization: `Bearer ${freshToken}` },
    });
    expect(statusRes.statusCode).toBe(200);
    const statusBody = statusRes.json() as { sessionId: string };

    const { db: liveDb } = await import('../../src/db');
    const { sessions } = await import('../../src/schema');
    const { eq } = await import('drizzle-orm');
    const row = await liveDb.query.sessions.findFirst({
      where: eq(sessions.id, statusBody.sessionId),
    });
    expect(row).toBeTruthy();
    expect((row as { userId: string }).userId).toBe(registeredUserId);
  });

  // Negative: no token
  it('returns 401 on /auth/lock when no Authorization header is sent', async () => {
    const res = await server.inject({ method: 'POST', url: '/auth/lock' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 on /auth/status when no Authorization header is sent', async () => {
    const res = await server.inject({ method: 'GET', url: '/auth/status' });
    expect(res.statusCode).toBe(401);
  });

  // Negative: malformed / invalid token
  it('returns 401 on /auth/lock with malformed Bearer header', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/lock',
      headers: { authorization: 'Bearer' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 on /auth/status with a totally invalid token', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/auth/status',
      headers: { authorization: 'Bearer not.a.valid.token' },
    });
    expect(res.statusCode).toBe(401);
  });

  // Security: lock response does not leak session or token material
  it('lock response contains only status', async () => {
    const unlockRes = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        masterPassword: 'test-lock-password-67890',
        email: registeredEmail,
      },
    });
    const freshToken = (unlockRes.json() as { accessToken: string }).accessToken;

    const lockRes = await server.inject({
      method: 'POST',
      url: '/auth/lock',
      headers: { authorization: `Bearer ${freshToken}` },
    });
    expect(lockRes.statusCode).toBe(200);
    const body = lockRes.json() as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['status']);
    expect(body).not.toHaveProperty('sessionId');
    expect(body).not.toHaveProperty('accessToken');
    expect(body).not.toHaveProperty('refreshToken');
  });

  // Security: using a token after lock fails status check
  it('after lock, a fresh unlock creates a new session that passes status', async () => {
    // Clear ALL active sessions for this user via direct DB ops.
    const { db: liveDb } = await import('../../src/db');
    const { sessions, refreshTokens } = await import('../../src/schema');
    const { eq, and, isNull } = await import('drizzle-orm');
    const now = new Date();

    const activeSessions = await liveDb.query.sessions.findMany({
      where: and(eq(sessions.userId, registeredUserId), isNull(sessions.deletedAt)),
    });

    for (const session of activeSessions) {
      if (session.refreshTokenHash) {
        await liveDb
          .update(refreshTokens)
          .set({ revokedAt: now, updatedAt: now })
          .where(eq(refreshTokens.tokenHash, session.refreshTokenHash));
      }
      await liveDb
        .update(sessions)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(sessions.id, session.id));
    }

    const unlockRes = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        masterPassword: 'test-lock-password-67890',
        email: registeredEmail,
      },
    });
    const freshToken = (unlockRes.json() as { accessToken: string }).accessToken;

    const statusRes = await server.inject({
      method: 'GET',
      url: '/auth/status',
      headers: { authorization: `Bearer ${freshToken}` },
    });
    expect(statusRes.statusCode).toBe(200);
    expect((statusRes.json() as { status: string }).status).toBe('unlocked');

    const lockRes2 = await server.inject({
      method: 'POST',
      url: '/auth/lock',
      headers: { authorization: `Bearer ${freshToken}` },
    });
    expect(lockRes2.statusCode).toBe(200);

    const statusRes2 = await server.inject({
      method: 'GET',
      url: '/auth/status',
      headers: { authorization: `Bearer ${freshToken}` },
    });
    expect(statusRes2.statusCode).toBe(401);
  });
});
