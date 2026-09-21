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

const tmpDir = mkdtempSync(join(tmpdir(), 'pm-be002c-v2-'));
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

    server = createServer({ logger: true });
    await server.ready();

    // Capture server-side error logs
    const serverErrors: string[] = [];
    (server.log as any).error = (...args: any[]) => {
      serverErrors.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
    };

    // Register
    const registerRes = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        masterPassword: 'test-lock-password-67890',
        email: 'lockv2.test@example.test',
        username: 'lockv2test',
      },
    });

    if (registerRes.statusCode !== 201) {
      console.log('REGISTER FAILED:', registerRes.statusCode, registerRes.body.toString());
    }

    expect(registerRes.statusCode).toBe(201);
    const rb = registerRes.json() as { id: string; email: string; username: string };
    registeredUserId = rb.id;
    registeredEmail = rb.email;
    registeredUsername = rb.username;

    // Unlock
    const unlockRes = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: {
        masterPassword: 'test-lock-password-67890',
        email: registeredEmail,
      },
    });

    expect(unlockRes.statusCode).toBe(200);
    const ub = unlockRes.json() as { accessToken: string };
    accessToken = ub.accessToken;
    expect(accessToken).toBeTruthy();
  });

  afterAll(async () => {
    await server.close();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('AC1: POST /auth/lock returns 200 locked', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/lock',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { status: string }).status).toBe('locked');
  });

  it('AC1: after lock, GET /auth/status returns 401', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/auth/status',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: string }).error).toBe('Unauthorized');
  });

  it('AC1: lock is idempotent', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/lock',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('AC2: GET /auth/status returns unlocked after fresh unlock', async () => {
    const u = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: { masterPassword: 'test-lock-password-67890', email: registeredEmail },
    });
    expect(u.statusCode).toBe(200);
    const token = (u.json() as { accessToken: string }).accessToken;

    const s = await server.inject({
      method: 'GET',
      url: '/auth/status',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(s.statusCode).toBe(200);
    const sb = s.json() as { status: string; sessionId: string; expiresAt: string };
    expect(sb.status).toBe('unlocked');
    expect(sb).toHaveProperty('sessionId');
    expect(sb).toHaveProperty('expiresAt');
  });

  it('returns 401 on lock without token', async () => {
    const res = await server.inject({ method: 'POST', url: '/auth/lock' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 on status without token', async () => {
    const res = await server.inject({ method: 'GET', url: '/auth/status' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 on lock with malformed token', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/lock',
      headers: { authorization: 'Bearer' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 on status with invalid token', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/auth/status',
      headers: { authorization: 'Bearer invalid.token.here' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('lock response contains only status', async () => {
    const u = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: { masterPassword: 'test-lock-password-67890', email: registeredEmail },
    });
    const token = (u.json() as { accessToken: string }).accessToken;

    const res = await server.inject({
      method: 'POST',
      url: '/auth/lock',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['status']);
  });

  it('after lock, new unlock then status works, then lock blocks status', async () => {
    // Lock
    await server.inject({
      method: 'POST',
      url: '/auth/lock',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    // New unlock
    const u = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: { masterPassword: 'test-lock-password-67890', email: registeredEmail },
    });
    expect(u.statusCode).toBe(200);
    const freshToken = (u.json() as { accessToken: string }).accessToken;

    // Status should be unlocked
    const s = await server.inject({
      method: 'GET',
      url: '/auth/status',
      headers: { authorization: `Bearer ${freshToken}` },
    });
    expect(s.statusCode).toBe(200);
    expect((s.json() as { status: string }).status).toBe('unlocked');

    // Lock with fresh token
    const l = await server.inject({
      method: 'POST',
      url: '/auth/lock',
      headers: { authorization: `Bearer ${freshToken}` },
    });
    expect(l.statusCode).toBe(200);

    // Status blocked
    const s2 = await server.inject({
      method: 'GET',
      url: '/auth/status',
      headers: { authorization: `Bearer ${freshToken}` },
    });
    expect(s2.statusCode).toBe(401);
  });
});
