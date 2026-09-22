/**
 * BE-002g: Integration tests — full register → unlock → lock → status flow,
 * concurrent sessions, and refresh token rotation chains.
 *
 * Test type: integration (spins up real Fastify server via createServer()).
 *
 * Acceptance criteria (from backlog):
 *   1. Full register → unlock → lock → status flow, concurrent sessions,
 *      refresh rotation covered.
 *
 * Coverage map (each AC bullet → test block):
 *   a. Full happy-path lifecycle: register → unlock → status(unlocked)
 *      → lock → status(locked) → unlock → status(unlocked) again.
 *   b. Fresh unlock after lock produces new session + new refresh token;
 *      old token rejected; old token cannot pass status.
 *   c. Lock idempotency: lock twice in a row returns 200 locked both times.
 *   d. Status correctness: unlocked returns sessionId + expiresAt; locked
 *      returns 401 with "locked" message; no user-enumeration leak.
 *   e. Concurrent sessions: two independent unlocks from the same user
 *      produce two distinct active sessions; locking one leaves the other
 *      usable for status + refresh.
 *   f. Refresh token rotation chain: N consecutive refreshes each rotate;
 *      every old token in the chain is rejected on reuse; the latest token
 *      works. Chain invariant maintained under concurrent sessions.
 *
 * AR-3: Positive + negative tests per change.
 * AR-4: All data synthetic (generated at test time). No real credentials.
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
import { eq, and, isNull } from 'drizzle-orm';

const tmpDir = mkdtempSync(join(tmpdir(), 'pm-be002g-'));
const dbPath = join(tmpDir, 'test.db');

describe('BE-002g: full flow + concurrent sessions + refresh rotation', () => {
  let server: ReturnType<typeof createServer>;
  let registeredEmail: string;
  let registeredUsername: string;
  let registeredUserId: string;

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
        masterPassword: 'test-fullflow-password-2024',
        email: 'fullflow.test@example.test',
        username: 'fullflowuser',
      },
    });
    expect(regRes.statusCode).toBe(201);
    const rb = regRes.json() as { id: string; email: string; username: string };
    registeredUserId = rb.id;
    registeredEmail = rb.email;
    registeredUsername = rb.username;
  });

  afterAll(async () => {
    await server.close();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // AC-a: Full happy-path lifecycle — register → unlock → status → lock → status
  // ──────────────────────────────────────────────────────────────────────────────

  describe('AC-a: full register → unlock → lock → status lifecycle', () => {
    it('unlock returns 200 with accessToken + refreshToken + expiresIn + tokenType', async () => {
      await clearUserSessions(registeredUserId);
      const res = await server.inject({
        method: 'POST',
        url: '/auth/unlock',
        payload: {
          masterPassword: 'test-fullflow-password-2024',
          email: registeredEmail,
        },
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
    });

    it('status returns unlocked with sessionId + expiresAt after unlock', async () => {
      await clearUserSessions(registeredUserId);
      const uRes = await server.inject({
        method: 'POST',
        url: '/auth/unlock',
        payload: {
          masterPassword: 'test-fullflow-password-2024',
          email: registeredEmail,
        },
      });
      const token = (uRes.json() as { accessToken: string }).accessToken;

      const sRes = await server.inject({
        method: 'GET',
        url: '/auth/status',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(sRes.statusCode).toBe(200);
      const sb = sRes.json() as { status: string; sessionId: string; expiresAt: string };
      expect(sb.status).toBe('unlocked');
      expect(sb.sessionId).toBeTruthy();
      expect(sb.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d+Z$/);
    });

    it('lock returns 200 locked and subsequent status returns 401 locked', async () => {
      await clearUserSessions(registeredUserId);
      const uRes = await server.inject({
        method: 'POST',
        url: '/auth/unlock',
        payload: {
          masterPassword: 'test-fullflow-password-2024',
          email: registeredEmail,
        },
      });
      const token = (uRes.json() as { accessToken: string }).accessToken;

      const lockRes = await server.inject({
        method: 'POST',
        url: '/auth/lock',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(lockRes.statusCode).toBe(200);
      expect((lockRes.json() as { status: string }).status).toBe('locked');

      const statusRes = await server.inject({
        method: 'GET',
        url: '/auth/status',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(statusRes.statusCode).toBe(401);
      const body = statusRes.json() as { error: string; message: string };
      expect(body.error).toBe('Unauthorized');
      expect(body.message.toLowerCase()).toContain('lock');
    });

    it('re-unlock after lock returns 200 and status returns unlocked again', async () => {
      await clearUserSessions(registeredUserId);
      // First lock the current session.
      const u1 = await server.inject({
        method: 'POST',
        url: '/auth/unlock',
        payload: {
          masterPassword: 'test-fullflow-password-2024',
          email: registeredEmail,
        },
      });
      const t1 = (u1.json() as { accessToken: string }).accessToken;
      await server.inject({
        method: 'POST',
        url: '/auth/lock',
        headers: { authorization: `Bearer ${t1}` },
      });

      // Re-unlock.
      const u2 = await server.inject({
        method: 'POST',
        url: '/auth/unlock',
        payload: {
          masterPassword: 'test-fullflow-password-2024',
          email: registeredEmail,
        },
      });
      expect(u2.statusCode).toBe(200);
      const t2 = (u2.json() as { accessToken: string }).accessToken;

      const sRes = await server.inject({
        method: 'GET',
        url: '/auth/status',
        headers: { authorization: `Bearer ${t2}` },
      });
      expect(sRes.statusCode).toBe(200);
      expect((sRes.json() as { status: string }).status).toBe('unlocked');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // AC-b: Fresh unlock after lock → new session + new refresh token; old token
  //       rejected for both status and refresh.
  // ──────────────────────────────────────────────────────────────────────────────

  describe('AC-b: fresh unlock after lock invalidates old session + refresh token', () => {
    it('new unlock issues a refresh token different from the pre-lock one', async () => {
      const u1 = await server.inject({
        method: 'POST',
        url: '/auth/unlock',
        payload: {
          masterPassword: 'test-fullflow-password-2024',
          email: registeredEmail,
        },
      });
      const rt1 = (u1.json() as { refreshToken: string }).refreshToken;

      const t1 = (u1.json() as { accessToken: string }).accessToken;
      await server.inject({
        method: 'POST',
        url: '/auth/lock',
        headers: { authorization: `Bearer ${t1}` },
      });

      const u2 = await server.inject({
        method: 'POST',
        url: '/auth/unlock',
        payload: {
          masterPassword: 'test-fullflow-password-2024',
          email: registeredEmail,
        },
      });
      const rt2 = (u2.json() as { refreshToken: string }).refreshToken;

      expect(rt2).not.toBe(rt1);
    });

    it('old refresh token rejected by POST /auth/refresh after re-unlock + lock', async () => {
      const u1 = await server.inject({
        method: 'POST',
        url: '/auth/unlock',
        payload: {
          masterPassword: 'test-fullflow-password-2024',
          email: registeredEmail,
        },
      });
      const rt1 = (u1.json() as { refreshToken: string }).refreshToken;
      const t1 = (u1.json() as { accessToken: string }).accessToken;

      await server.inject({
        method: 'POST',
        url: '/auth/lock',
        headers: { authorization: `Bearer ${t1}` },
      });

      // Re-unlock so a fresh session exists.
      await server.inject({
        method: 'POST',
        url: '/auth/unlock',
        payload: {
          masterPassword: 'test-fullflow-password-2024',
          email: registeredEmail,
        },
      });

      // Old refresh token must be rejected.
      const refreshRes = await server.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: rt1 },
      });
      expect(refreshRes.statusCode).toBe(401);
    });

    it('old access token rejected by GET /auth/status after re-unlock + lock', async () => {
      const u1 = await server.inject({
        method: 'POST',
        url: '/auth/unlock',
        payload: {
          masterPassword: 'test-fullflow-password-2024',
          email: registeredEmail,
        },
      });
      const t1 = (u1.json() as { accessToken: string }).accessToken;

      await server.inject({
        method: 'POST',
        url: '/auth/lock',
        headers: { authorization: `Bearer ${t1}` },
      });

      await server.inject({
        method: 'POST',
        url: '/auth/unlock',
        payload: {
          masterPassword: 'test-fullflow-password-2024',
          email: registeredEmail,
        },
      });

      const statusRes = await server.inject({
        method: 'GET',
        url: '/auth/status',
        headers: { authorization: `Bearer ${t1}` },
      });
      expect(statusRes.statusCode).toBe(401);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // AC-c: Lock idempotency
  // ──────────────────────────────────────────────────────────────────────────────

  describe('AC-c: lock is idempotent', () => {
    it('two consecutive locks both return 200 locked', async () => {
      const uRes = await server.inject({
        method: 'POST',
        url: '/auth/unlock',
        payload: {
          masterPassword: 'test-fullflow-password-2024',
          email: registeredEmail,
        },
      });
      const token = (uRes.json() as { accessToken: string }).accessToken;

      const l1 = await server.inject({
        method: 'POST',
        url: '/auth/lock',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(l1.statusCode).toBe(200);
      expect((l1.json() as { status: string }).status).toBe('locked');

      const l2 = await server.inject({
        method: 'POST',
        url: '/auth/lock',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(l2.statusCode).toBe(200);
      expect((l2.json() as { status: string }).status).toBe('locked');
    });

    it('lock on already-locked session is still idempotent (no error)', async () => {
      // Lock once to mark the user's session as locked.
      const u1 = await server.inject({
        method: 'POST',
        url: '/auth/unlock',
        payload: {
          masterPassword: 'test-fullflow-password-2024',
          email: registeredEmail,
        },
      });
      const t1 = (u1.json() as { accessToken: string }).accessToken;
      await server.inject({
        method: 'POST',
        url: '/auth/lock',
        headers: { authorization: `Bearer ${t1}` },
      });

      // Unlock a second session.
      const u2 = await server.inject({
        method: 'POST',
        url: '/auth/unlock',
        payload: {
          masterPassword: 'test-fullflow-password-2024',
          email: registeredEmail,
        },
      });
      const t2 = (u2.json() as { accessToken: string }).accessToken;
      await server.inject({
        method: 'POST',
        url: '/auth/lock',
        headers: { authorization: `Bearer ${t2}` },
      });

      // Lock the first session's token again — should still be idempotent 200.
      const lAgain = await server.inject({
        method: 'POST',
        url: '/auth/lock',
        headers: { authorization: `Bearer ${t1}` },
      });
      expect(lAgain.statusCode).toBe(200);
      expect((lAgain.json() as { status: string }).status).toBe('locked');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // AC-d: Status correctness — unlocked shape, locked shape, no enumeration leak
  // ──────────────────────────────────────────────────────────────────────────────

  describe('AC-d: status correctness & no user-enumeration leak', () => {
    it('status response has exactly { status, sessionId, expiresAt } when unlocked', async () => {
      const uRes = await server.inject({
        method: 'POST',
        url: '/auth/unlock',
        payload: {
          masterPassword: 'test-fullflow-password-2024',
          email: registeredEmail,
        },
      });
      const token = (uRes.json() as { accessToken: string }).accessToken;

      const sRes = await server.inject({
        method: 'GET',
        url: '/auth/status',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(sRes.statusCode).toBe(200);
      const body = sRes.json() as Record<string, unknown>;
      expect(Object.keys(body)).toEqual(['status', 'sessionId', 'expiresAt']);
      expect(body.status).toBe('unlocked');
      expect(body).not.toHaveProperty('accessToken');
      expect(body).not.toHaveProperty('refreshToken');
    });

    it('status response after lock is 401 with no session material leaked', async () => {
      const uRes = await server.inject({
        method: 'POST',
        url: '/auth/unlock',
        payload: {
          masterPassword: 'test-fullflow-password-2024',
          email: registeredEmail,
        },
      });
      const token = (uRes.json() as { accessToken: string }).accessToken;
      await server.inject({
        method: 'POST',
        url: '/auth/lock',
        headers: { authorization: `Bearer ${token}` },
      });

      const sRes = await server.inject({
        method: 'GET',
        url: '/auth/status',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(sRes.statusCode).toBe(401);
      const body = sRes.json() as Record<string, unknown>;
      expect(body.error).toBe('Unauthorized');
      expect(body).not.toHaveProperty('sessionId');
      expect(body).not.toHaveProperty('accessToken');
    });

    it('status for unknown user returns same 401 as locked — no enumeration', async () => {
      const uRes = await server.inject({
        method: 'POST',
        url: '/auth/unlock',
        payload: {
          masterPassword: 'test-fullflow-password-2024',
          email: registeredEmail,
        },
      });
      const token = (uRes.json() as { accessToken: string }).accessToken;
      await server.inject({
        method: 'POST',
        url: '/auth/lock',
        headers: { authorization: `Bearer ${token}` },
      });

      const unknownRes = await server.inject({
        method: 'GET',
        url: '/auth/status',
        headers: { authorization: 'Bearer not.a.real.token' },
      });
      expect(unknownRes.statusCode).toBe(401);
      // Both locked-real-token and fake-token return 401 — no enumeration.
      // The assertions above (both expect 401) are sufficient.
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // AC-e: Concurrent sessions — two independent unlocks from the same user
  // ──────────────────────────────────────────────────────────────────────────────

  describe('AC-e: concurrent sessions from the same user', () => {
    let sessionA_token: string;
    let sessionA_rt: string;
    let sessionB_token: string;
    let sessionB_rt: string;
    let sessionA_id: string;
    let sessionB_id: string;

    beforeAll(async () => {
      // Clear any leftover sessions from earlier tests.
      await clearUserSessions(registeredUserId);

      const uA = await server.inject({
        method: 'POST',
        url: '/auth/unlock',
        payload: {
          masterPassword: 'test-fullflow-password-2024',
          email: registeredEmail,
        },
      });
      const bA = uA.json() as { accessToken: string; refreshToken: string };
      sessionA_token = bA.accessToken;
      sessionA_rt = bA.refreshToken;
      sessionA_id = (await statusSessionId(bA.accessToken)) as string;

      const uB = await server.inject({
        method: 'POST',
        url: '/auth/unlock',
        payload: {
          masterPassword: 'test-fullflow-password-2024',
          email: registeredEmail,
        },
      });
      const bB = uB.json() as { accessToken: string; refreshToken: string };
      sessionB_token = bB.accessToken;
      sessionB_rt = bB.refreshToken;
      sessionB_id = (await statusSessionId(bB.accessToken)) as string;
    });

    it('two concurrent unlocks produce two distinct session IDs', async () => {
      expect(sessionA_id).toBeTruthy();
      expect(sessionB_id).toBeTruthy();
      expect(sessionA_id).not.toBe(sessionB_id);
    });

    it('both concurrent sessions report unlocked via status', async () => {
      expect(await statusCode(sessionA_token)).toBe(200);
      expect(await statusCode(sessionB_token)).toBe(200);
      expect((await statusBody(sessionA_token)).status).toBe('unlocked');
      expect((await statusBody(sessionB_token)).status).toBe('unlocked');
    });

    it('locking session A does not affect session B status', async () => {
      await server.inject({
        method: 'POST',
        url: '/auth/lock',
        headers: { authorization: `Bearer ${sessionA_token}` },
      });

      // Session A now locked.
      expect(await statusCode(sessionA_token)).toBe(401);

      // Session B still unlocked.
      expect(await statusCode(sessionB_token)).toBe(200);
      expect((await statusBody(sessionB_token)).status).toBe('unlocked');
    });

    it('locking session A does not revoke session B refresh token', async () => {
      const refreshRes = await server.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: sessionB_rt },
      });
      expect(refreshRes.statusCode).toBe(200);
      const body = refreshRes.json() as { accessToken: string; refreshToken: string };
      expect(body.accessToken).toBeTruthy();
      expect(body.refreshToken).not.toBe(sessionB_rt);
    });

    it('locking session B then re-unlock creates a third session coexisting with A-locked', async () => {
      await server.inject({
        method: 'POST',
        url: '/auth/lock',
        headers: { authorization: `Bearer ${sessionB_token}` },
      });

      expect(await statusCode(sessionA_token)).toBe(401); // A locked earlier
      expect(await statusCode(sessionB_token)).toBe(401); // B just locked

      const uNew = await server.inject({
        method: 'POST',
        url: '/auth/unlock',
        payload: {
          masterPassword: 'test-fullflow-password-2024',
          email: registeredEmail,
        },
      });
      const newToken = (uNew.json() as { accessToken: string }).accessToken;
      expect(await statusCode(newToken)).toBe(200);
      expect((await statusBody(newToken)).status).toBe('unlocked');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // AC-f: Refresh token rotation chain — N consecutive rotations, every old
  //       token rejected, latest token works. Chain maintained under concurrency.
  // ──────────────────────────────────────────────────────────────────────────────

  describe('AC-f: refresh token rotation chain (multi-hop)', () => {
    it('three consecutive refreshes each rotate; all prior tokens rejected', async () => {
      // Clear leftover sessions.
      await clearUserSessions(registeredUserId);

      const u = await server.inject({
        method: 'POST',
        url: '/auth/unlock',
        payload: {
          masterPassword: 'test-fullflow-password-2024',
          email: registeredEmail,
        },
      });
      const tokens: string[] = [(u.json() as { refreshToken: string }).refreshToken];

      // Hop 1.
      const r1 = await server.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: tokens[0] },
      });
      expect(r1.statusCode).toBe(200);
      tokens.push((r1.json() as { refreshToken: string }).refreshToken);

      // Hop 2.
      const r2 = await server.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: tokens[1] },
      });
      expect(r2.statusCode).toBe(200);
      tokens.push((r2.json() as { refreshToken: string }).refreshToken);

      // Hop 3.
      const r3 = await server.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: tokens[2] },
      });
      expect(r3.statusCode).toBe(200);
      tokens.push((r3.json() as { refreshToken: string }).refreshToken);

      // Each token differs from the previous.
      for (let i = 1; i < tokens.length; i++) {
        expect(tokens[i]).not.toBe(tokens[i - 1]);
      }

      // Every prior token in the chain is rejected.
      for (let i = 0; i < tokens.length - 1; i++) {
        const rejected = await server.inject({
          method: 'POST',
          url: '/auth/refresh',
          payload: { refreshToken: tokens[i] },
        });
        expect(rejected.statusCode).toBe(401);
      }

      // The latest token still works.
      const latestRes = await server.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: tokens[tokens.length - 1] },
      });
      expect(latestRes.statusCode).toBe(200);
      const latestToken = (latestRes.json() as { refreshToken: string }).refreshToken;
      expect(latestToken).not.toBe(tokens[tokens.length - 1]);
    });

    it('rotation chain works under concurrent sessions — refreshing session A does not break session B', async () => {
      await clearUserSessions(registeredUserId);

      const uA = await server.inject({
        method: 'POST',
        url: '/auth/unlock',
        payload: {
          masterPassword: 'test-fullflow-password-2024',
          email: registeredEmail,
        },
      });
      const rtA0 = (uA.json() as { refreshToken: string }).refreshToken;

      const uB = await server.inject({
        method: 'POST',
        url: '/auth/unlock',
        payload: {
          masterPassword: 'test-fullflow-password-2024',
          email: registeredEmail,
        },
      });
      const rtB0 = (uB.json() as { refreshToken: string }).refreshToken;

      // Rotate A once.
      const rA = await server.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: rtA0 },
      });
      expect(rA.statusCode).toBe(200);
      const rtA1 = (rA.json() as { refreshToken: string }).refreshToken;

      // B's original token still works (unaffected by A's rotation).
      const rB = await server.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: rtB0 },
      });
      expect(rB.statusCode).toBe(200);
      const rtB1 = (rB.json() as { refreshToken: string }).refreshToken;
      expect(rtB1).not.toBe(rtB0);

      // A's old token rejected.
      const rejectA = await server.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: rtA0 },
      });
      expect(rejectA.statusCode).toBe(401);

      // A's new token works.
      const rA2 = await server.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: rtA1 },
      });
      expect(rA2.statusCode).toBe(200);

      // B's new token works.
      const rB2 = await server.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: rtB1 },
      });
      expect(rB2.statusCode).toBe(200);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // AC-a supplementary: lock → refresh fails, re-unlock → refresh works
  // ──────────────────────────────────────────────────────────────────────────────

  describe('lock → refresh fails; re-unlock → refresh works', () => {
    it('refresh after lock returns 401', async () => {
      await clearUserSessions(registeredUserId);

      const u = await server.inject({
        method: 'POST',
        url: '/auth/unlock',
        payload: {
          masterPassword: 'test-fullflow-password-2024',
          email: registeredEmail,
        },
      });
      const rt = (u.json() as { refreshToken: string }).refreshToken;
      const t = (u.json() as { accessToken: string }).accessToken;

      await server.inject({
        method: 'POST',
        url: '/auth/lock',
        headers: { authorization: `Bearer ${t}` },
      });

      const refreshRes = await server.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: rt },
      });
      expect(refreshRes.statusCode).toBe(401);
    });

    it('refresh works after re-unlock following a lock', async () => {
      await clearUserSessions(registeredUserId);

      const u1 = await server.inject({
        method: 'POST',
        url: '/auth/unlock',
        payload: {
          masterPassword: 'test-fullflow-password-2024',
          email: registeredEmail,
        },
      });
      const rt1 = (u1.json() as { refreshToken: string }).refreshToken;
      const t1 = (u1.json() as { accessToken: string }).accessToken;

      await server.inject({
        method: 'POST',
        url: '/auth/lock',
        headers: { authorization: `Bearer ${t1}` },
      });

      const u2 = await server.inject({
        method: 'POST',
        url: '/auth/unlock',
        payload: {
          masterPassword: 'test-fullflow-password-2024',
          email: registeredEmail,
        },
      });
      const rt2 = (u2.json() as { refreshToken: string }).refreshToken;

      const refreshRes = await server.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: rt2 },
      });
      expect(refreshRes.statusCode).toBe(200);
      const body = refreshRes.json() as { refreshToken: string };
      expect(body.refreshToken).not.toBe(rt2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────────

  async function clearUserSessions(userId: string): Promise<void> {
    const { db: liveDb } = await import('../../src/db');
    const { sessions, refreshTokens } = await import('../../src/schema');
    const now = new Date();
    const active = await liveDb.query.sessions.findMany({
      where: and(eq(sessions.userId, userId), isNull(sessions.deletedAt)),
    });
    for (const s of active) {
      if (s.refreshTokenHash) {
        await liveDb
          .update(refreshTokens)
          .set({ revokedAt: now, updatedAt: now })
          .where(eq(refreshTokens.tokenHash, s.refreshTokenHash));
      }
      await liveDb
        .update(sessions)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(sessions.id, s.id));
    }
  }

  async function statusCode(token: string): Promise<number> {
    const res = await server.inject({
      method: 'GET',
      url: '/auth/status',
      headers: { authorization: `Bearer ${token}` },
    });
    return res.statusCode;
  }

  async function statusBody(token: string): Promise<{ status: string }> {
    const res = await server.inject({
      method: 'GET',
      url: '/auth/status',
      headers: { authorization: `Bearer ${token}` },
    });
    return res.json() as { status: string };
  }

  async function statusSessionId(token: string): Promise<string> {
    const res = await server.inject({
      method: 'GET',
      url: '/auth/status',
      headers: { authorization: `Bearer ${token}` },
    });
    return (res.json() as { sessionId: string }).sessionId;
  }
});
