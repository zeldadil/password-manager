/**
 * @license
 * FE-002g: Web integration tests — token refresh during session.
 *
 * Test type: integration (real Fastify server + real SQLite).
 *
 * Spins up a real API server via createServer() and verifies the full
 * refresh token rotation chain works end-to-end: consecutive refreshes
 * each rotate, old tokens rejected, concurrent sessions don't interfere.
 *
 * Acceptance criteria (from backlog):
 *   2. Token refresh during session covered.
 *
 * AR-4: all data synthetic.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../../../apps/services/api/src/schema';
import { setTestDbOverride } from '../../../apps/services/api/src/db';
import { createServer } from '../../../apps/services/api/src/server';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDir = mkdtempSync(join(tmpdir(), 'pm-fe002g-refresh-'));
const dbPath = join(tmpDir, 'test.db');

const TEST_EMAIL = 'refresh-token-test@example.test';
const TEST_PASSWORD = 'test-refresh-password-2024';

let serverInstance: ReturnType<typeof createServer>;

beforeAll(async () => {
  const setupDb = new Database(dbPath);
  setupDb.exec('PRAGMA foreign_keys = ON;');
  const migratedDb = drizzle(setupDb, { schema });
  migrate(migratedDb, { migrationsFolder: `${import.meta.dirname}/../../../apps/services/api/migrations` });
  setupDb.close();

  const sql = new Database(dbPath);
  sql.exec('PRAGMA foreign_keys = ON;');
  const liveDb = drizzle(sql, { schema });
  setTestDbOverride(liveDb);

  serverInstance = createServer({ logger: false });
  await serverInstance.ready();

  const regRes = await serverInstance.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { masterPassword: TEST_PASSWORD, email: TEST_EMAIL, username: 'refreshuser' },
  });
  expect(regRes.statusCode).toBe(201);
});

afterAll(async () => {
  await serverInstance.close();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// ────────────────────────────────────────────────────────────────────────────────
// AC-f: Refresh token rotation chain — N consecutive rotations, every old
//       token rejected, latest token works. Chain maintained under concurrency.
// ────────────────────────────────────────────────────────────────────────────────
describe('AC-f: refresh token rotation chain (multi-hop)', () => {
  it('three consecutive refreshes each rotate; all prior tokens rejected', async () => {
    const u = await serverInstance.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: { email: TEST_EMAIL, masterPassword: TEST_PASSWORD },
    });
    const tokens: string[] = [(u.json() as { refreshToken: string }).refreshToken];

    // Hop 1.
    const r1 = await serverInstance.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: tokens[0] },
    });
    expect(r1.statusCode).toBe(200);
    tokens.push((r1.json() as { refreshToken: string }).refreshToken);

    // Hop 2.
    const r2 = await serverInstance.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: tokens[1] },
    });
    expect(r2.statusCode).toBe(200);
    tokens.push((r2.json() as { refreshToken: string }).refreshToken);

    // Hop 3.
    const r3 = await serverInstance.inject({
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
      const rejected = await serverInstance.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: tokens[i] },
      });
      expect(rejected.statusCode).toBe(401);
    }

    // The latest token still works.
    const latestRes = await serverInstance.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: tokens[tokens.length - 1] },
    });
    expect(latestRes.statusCode).toBe(200);
    const latestToken = (latestRes.json() as { refreshToken: string }).refreshToken;
    expect(latestToken).not.toBe(tokens[tokens.length - 1]);
  });

  it('rotation chain works under concurrent sessions — refreshing A does not break B', async () => {
    const uA = await serverInstance.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: { email: TEST_EMAIL, masterPassword: TEST_PASSWORD },
    });
    const rtA0 = (uA.json() as { refreshToken: string }).refreshToken;

    const uB = await serverInstance.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: { email: TEST_EMAIL, masterPassword: TEST_PASSWORD },
    });
    const rtB0 = (uB.json() as { refreshToken: string }).refreshToken;

    // Rotate A once.
    const rA = await serverInstance.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: rtA0 },
    });
    expect(rA.statusCode).toBe(200);
    const rtA1 = (rA.json() as { refreshToken: string }).refreshToken;

    // B's original token still works (unaffected by A's rotation).
    const rB = await serverInstance.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: rtB0 },
    });
    expect(rB.statusCode).toBe(200);
    const rtB1 = (rB.json() as { refreshToken: string }).refreshToken;
    expect(rtB1).not.toBe(rtB0);

    // A's old token rejected.
    const rejectA = await serverInstance.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: rtA0 },
    });
    expect(rejectA.statusCode).toBe(401);

    // A's new token works.
    const rA2 = await serverInstance.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: rtA1 },
    });
    expect(rA2.statusCode).toBe(200);

    // B's new token works.
    const rB2 = await serverInstance.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: rtB1 },
    });
    expect(rB2.statusCode).toBe(200);
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// AC-a supplementary: lock → refresh fails, re-unlock → refresh works
// ────────────────────────────────────────────────────────────────────────────────
describe('lock → refresh fails; re-unlock → refresh works', () => {
  it('refresh after lock returns 401', async () => {
    const u = await serverInstance.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: { email: TEST_EMAIL, masterPassword: TEST_PASSWORD },
    });
    const rt = (u.json() as { refreshToken: string }).refreshToken;
    const t = (u.json() as { accessToken: string }).accessToken;

    await serverInstance.inject({
      method: 'POST',
      url: '/auth/lock',
      headers: { authorization: `Bearer ${t}` },
    });

    const refreshRes = await serverInstance.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: rt },
    });
    expect(refreshRes.statusCode).toBe(401);
  });

  it('refresh works after re-unlock following a lock', async () => {
    const u1 = await serverInstance.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: { email: TEST_EMAIL, masterPassword: TEST_PASSWORD },
    });
    const rt1 = (u1.json() as { refreshToken: string }).refreshToken;
    const t1 = (u1.json() as { accessToken: string }).accessToken;

    await serverInstance.inject({
      method: 'POST',
      url: '/auth/lock',
      headers: { authorization: `Bearer ${t1}` },
    });

    const u2 = await serverInstance.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: { email: TEST_EMAIL, masterPassword: TEST_PASSWORD },
    });
    const rt2 = (u2.json() as { refreshToken: string }).refreshToken;

    const refreshRes = await serverInstance.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: rt2 },
    });
    expect(refreshRes.statusCode).toBe(200);
    const body = refreshRes.json() as { refreshToken: string };
    expect(body.refreshToken).not.toBe(rt2);
  });
});
