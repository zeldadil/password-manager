/** @fileoverview BE-002d: POST /auth/refresh + auto-lock integration tests.

 * Test type: integration (spins up real Fastify server via createServer()).
 * Covers:
 *   AC1 — POST /auth/refresh returns new access token + rotated refresh token
 *         when presented with a valid refresh token within the inactivity window.
 *   AC1 — POST /auth/refresh rotates refresh token (old token rejected on reuse).
 *   AC1 — POST /auth/refresh returns 401 "Session expired due to inactivity"
 *         when lastUsedAt exceeds config.autoLockTimeoutMs.
 *   AC2 — GET /auth/status also enforces auto-lock (inactivity check).
 *   AC2 — refresh token survives "restart" (DB-backed, server-agnostic lookup).
 *
 * Prerequisite: a registered + unlocked user with a valid session.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../../src/schema';
import { createServer } from '../../src/server';
import { setTestDbOverride } from '../../src/db';
import { hashRefreshToken } from '../../src/auth/jwt';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, and, desc, isNull } from 'drizzle-orm';

const tmpDir = mkdtempSync(join(tmpdir(), 'pm-be002d-'));
const dbPath = join(tmpDir, 'test.db');

describe('BE-002d: POST /auth/refresh + auto-lock', () => {
  let server: ReturnType<typeof createServer>;
  let registeredEmail: string;
  let registeredUserId: string;
  let accessToken: string;
  let refreshToken: string;

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

    const regRes = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        masterPassword: 'test-refresh-password-98765',
        email: 'refresh.test@example.test',
        username: 'refreshtest',
      },
    });
    expect(regRes.statusCode).toBe(201);
    const rb = regRes.json() as { id: string; email: string; username: string };
    registeredUserId = rb.id;
    registeredEmail = rb.email;

    const unlockRes = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        masterPassword: 'test-refresh-password-98765',
        email: registeredEmail,
      },
    });
    expect(unlockRes.statusCode).toBe(200);
    const ub = unlockRes.json() as { accessToken: string; refreshToken: string };
    accessToken = ub.accessToken;
    refreshToken = ub.refreshToken;
    expect(accessToken).toBeTruthy();
    expect(refreshToken).toMatch(/^[0-9a-f]{64}$/);
  });

  afterAll(async () => {
    await server.close();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  // ── Helper: backdate session lastUsedAt by refresh token hash ────────────────

  async function backdateSessionByRefreshToken(refreshToken: string, minutesAgo: number) {
    const { db: liveDb } = await import('../../src/db');
    const { sessions, refreshTokens } = await import('../../src/schema');
    const { hashRefreshToken } = await import('../../src/auth/jwt');
    const ago = new Date(Date.now() - minutesAgo * 60 * 1000);
    const tokenHash = hashRefreshToken(refreshToken);
    const rows = await liveDb.query.sessions.findMany({
      where: and(eq(sessions.refreshTokenHash, tokenHash), isNull(sessions.deletedAt)),
      limit: 1,
    });
    if (rows[0]) {
      // Soft-delete all OTHER active sessions for this user so findActiveSession
      // picks the backdated one (status uses userId lookup, not token hash).
      const userId = rows[0].userId;
      const allActive = await liveDb.query.sessions.findMany({
        where: and(eq(sessions.userId, userId), isNull(sessions.deletedAt)),
      });
      for (const s of allActive) {
        if (s.id !== rows[0].id) {
          await liveDb.update(sessions).set({ deletedAt: ago, updatedAt: ago }).where(eq(sessions.id, s.id));
          if (s.refreshTokenHash) {
            await liveDb.update(refreshTokens).set({ revokedAt: ago, updatedAt: ago }).where(eq(refreshTokens.tokenHash, s.refreshTokenHash));
          }
        }
      }
      await liveDb.update(sessions).set({ lastUsedAt: ago, updatedAt: ago }).where(eq(sessions.id, rows[0].id));
    }
  }

  // ── AC1: happy-path refresh + rotation ───────────────────────────────────────

  it('AC1: POST /auth/refresh returns 200 + new tokens, rotates refresh token', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      tokenType: string;
    };
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toMatch(/^[0-9a-f]{64}$/);
    expect(body.expiresIn).toBe(900);
    expect(body.tokenType).toBe('Bearer');
    // Rotation: new refresh token differs from the one we sent.
    expect(body.refreshToken).not.toBe(refreshToken);
  });

  it('AC1: old refresh token rejected after rotation', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken }, // the now-revoked old token
    });
    expect(res.statusCode).toBe(401);
  });

  // ── AC1: invalid / missing inputs ────────────────────────────────────────────

  it('returns 401 when refreshToken is missing', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for an invalid refresh token', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: 'deadbeef' + '0'.repeat(56) },
    });
    expect(res.statusCode).toBe(401);
  });

  // ── AC1: auto-lock on refresh ────────────────────────────────────────────────

  it('AC1: POST /auth/refresh returns 401 "inactivity" when lastUsedAt exceeds timeout', async () => {
    // Fresh unlock → get new tokens.
    const uRes = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: { masterPassword: 'test-refresh-password-98765', email: registeredEmail },
    });
    const ub = uRes.json() as { refreshToken: string };
    const freshRt = ub.refreshToken;

    // Backdate session lastUsedAt to 16 min ago (> 15 min default timeout).
    await backdateSessionByRefreshToken(freshRt, 16);

    const res = await server.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: freshRt },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: string; message: string };
    expect(body.error).toBe('Unauthorized');
    expect(body.message).toContain('inactivity');
  });

  // ── AC2: auto-lock on status ─────────────────────────────────────────────────
  // Cleans up all other sessions so findActiveSession picks the backdated one.

  it('AC2: GET /auth/status returns 401 "inactivity" when session is auto-locked', async () => {
    const { db: liveDb } = await import('../../src/db');
    const { sessions, refreshTokens } = await import('../../src/schema');
    const { eq, and, isNull } = await import('drizzle-orm');

    // Clean slate: revoke + soft-delete all existing sessions/refresh tokens.
    const existingSessions = await liveDb.query.sessions.findMany({
      where: and(eq(sessions.userId, registeredUserId), isNull(sessions.deletedAt)),
    });
    for (const s of existingSessions) {
      await liveDb.update(sessions).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(sessions.id, s.id));
      if (s.refreshTokenHash) {
        await liveDb.update(refreshTokens).set({ revokedAt: new Date(), updatedAt: new Date() }).where(eq(refreshTokens.tokenHash, s.refreshTokenHash));
      }
    }

    // Fresh unlock → exactly one active session.
    const uRes = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: { masterPassword: 'test-refresh-password-98765', email: registeredEmail },
    });
    expect(uRes.statusCode).toBe(200);
    const ub = uRes.json() as { accessToken: string; refreshToken: string };
    const token = ub.accessToken;

    // Backdate this session's lastUsedAt to 16 min ago.
    await backdateSessionByRefreshToken(ub.refreshToken, 16);

    // Verify DB state: the session should be the only active one and backdated.
    const checkRows = await liveDb.query.sessions.findMany({
      where: and(eq(sessions.userId, registeredUserId), isNull(sessions.deletedAt)),
    });
    expect(checkRows).toHaveLength(1);
    expect(checkRows[0].lastUsedAt!.getTime()).toBeLessThan(Date.now() - 15 * 60 * 1000);

    const res = await server.inject({
      method: 'GET',
      url: '/auth/status',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: string; message: string };
    expect(body.message).toContain('inactivity');
  });

  // ── AC2: lock then refresh fails ─────────────────────────────────────────────
  // Cleans up all other sessions so the lock targets the right one.

  it('after lock, POST /auth/refresh returns 401 (session revoked)', async () => {
    const { db: liveDb } = await import('../../src/db');
    const { sessions, refreshTokens } = await import('../../src/schema');
    const { eq, and, isNull } = await import('drizzle-orm');

    // Clean slate: revoke + soft-delete all existing sessions/refresh tokens.
    const existingSessions = await liveDb.query.sessions.findMany({
      where: and(eq(sessions.userId, registeredUserId), isNull(sessions.deletedAt)),
    });
    for (const s of existingSessions) {
      await liveDb.update(sessions).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(sessions.id, s.id));
      if (s.refreshTokenHash) {
        await liveDb.update(refreshTokens).set({ revokedAt: new Date(), updatedAt: new Date() }).where(eq(refreshTokens.tokenHash, s.refreshTokenHash));
      }
    }

    // Fresh unlock → exactly one active session + refresh token.
    const uRes = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: { masterPassword: 'test-refresh-password-98765', email: registeredEmail },
    });
    expect(uRes.statusCode).toBe(200);
    const ub = uRes.json() as { accessToken: string; refreshToken: string };

    // Verify exactly one active session before lock.
    const preLock = await liveDb.query.sessions.findMany({
      where: and(eq(sessions.userId, registeredUserId), isNull(sessions.deletedAt)),
    });
    expect(preLock).toHaveLength(1);

    // Lock it.
    const lockRes = await server.inject({
      method: 'POST',
      url: '/auth/lock',
      headers: { authorization: `Bearer ${ub.accessToken}` },
    });
    expect(lockRes.statusCode).toBe(200);

    // Verify session was soft-deleted.
    const postLock = await liveDb.query.sessions.findMany({
      where: and(eq(sessions.userId, registeredUserId), isNull(sessions.deletedAt)),
    });
    expect(postLock).toHaveLength(0);

    // Refresh with the now-revoked token should fail.
    const res = await server.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: ub.refreshToken },
    });
    expect(res.statusCode).toBe(401);
  });

  // ── AC2: refresh token survives restart ──────────────────────────────────────

  it('AC2: refresh token survives server restart (DB-backed)', async () => {
    const uRes = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: { masterPassword: 'test-refresh-password-98765', email: registeredEmail },
    });
    const rt = (uRes.json() as { refreshToken: string }).refreshToken;

    // Close current server, reopen fresh, try refresh on the new instance.
    await server.close();
    const sql2 = new Database(dbPath);
    sql2.exec('PRAGMA foreign_keys = ON;');
    const liveDb2 = drizzle(sql2, { schema });
    setTestDbOverride(liveDb2);
    const server2 = createServer({ logger: false });
    await server2.ready();

    const res = await server2.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: rt },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { accessToken: string; refreshToken: string };
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toMatch(/^[0-9a-f]{64}$/);

    await server2.close();

    // Reopen for remaining tests.
    const sql3 = new Database(dbPath);
    sql3.exec('PRAGMA foreign_keys = ON;');
    const liveDb3 = drizzle(sql3, { schema });
    setTestDbOverride(liveDb3);
    server = createServer({ logger: false });
    await server.ready();
  });
});
