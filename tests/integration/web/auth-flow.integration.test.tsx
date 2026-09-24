/**
 * @license
 * FE-002g: Web integration tests — Login → vault → lock → unlock flow.
 *
 * Test type: integration (real Fastify server + real SQLite + real React rendering
 * via @testing-library/react in jsdom).
 *
 * Spins up a real API server via createServer() with an in-memory SQLite DB,
 * registers a synthetic test user, then renders LoginPage / UnlockPage / VaultPage
 * and drives them through the full auth lifecycle using server.inject() for HTTP.
 *
 * Acceptance criteria (from backlog):
 *   1. Login → vault → lock → unlock flow covered.
 *
 * Coverage map:
 *   a. Full happy-path lifecycle: login → vault → lock → unlock → vault again.
 *   b. Lock idempotency: lock twice → 200 locked both times.
 *   c. Status correctness: unlocked → sessionId + expiresAt; locked → 401;
 *      no user-enumeration leak.
 *   d. Fresh unlock after lock produces new session + new refresh token;
 *      old token rejected for status + refresh.
 *
 * AR-3: Positive + negative tests. AR-4: all data synthetic.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';

// ── Real API server (integration: real server + real DB + real crypto) ──────────
import { createServer } from '../../../apps/services/api/src/server';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../../../apps/services/api/src/schema';
import { setTestDbOverride } from '../../../apps/services/api/src/db';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDir = mkdtempSync(join(tmpdir(), 'pm-fe002g-'));
const dbPath = join(tmpDir, 'test.db');

// ── Route wrapping (same pattern as web unit tests) ─────────────────────────────
import { routes } from '../../../apps/web/src/routes';
import { SessionProvider } from '../../../apps/web/src/auth/SessionProvider';

function wrapRoutes(routeList: RouteObject[]): RouteObject[] {
  const root = routeList[0];
  return [
    {
      ...root,
      children: root.children?.map((child) => ({
        ...child,
        element: (
          <SessionProvider>
            {child.element}
          </SessionProvider>
        ),
      })),
    },
  ] as RouteObject[];
}

const routesWithSession: RouteObject[] = wrapRoutes(routes);

// ── Test fixtures ────────────────────────────────────────────────────────────────
const TEST_EMAIL = 'integration-auth-flow@example.test';
const TEST_USERNAME = 'authflowuser';
const TEST_PASSWORD = 'test-auth-flow-password-2024';

let serverInstance: ReturnType<typeof createServer>;

beforeAll(async () => {
  // 1. Setup DB with migrations.
  const setupDb = new Database(dbPath);
  setupDb.exec('PRAGMA foreign_keys = ON;');
  const migratedDb = drizzle(setupDb, { schema });
  migrate(migratedDb, { migrationsFolder: `${import.meta.dirname}/../../../apps/services/api/migrations` });
  setupDb.close();

  // 2. Live DB connection + override.
  const sql = new Database(dbPath);
  sql.exec('PRAGMA foreign_keys = ON;');
  const liveDb = drizzle(sql, { schema });
  setTestDbOverride(liveDb);

  // 3. Create real server.
  serverInstance = createServer({ logger: false });
  await serverInstance.ready();

  // 4. Register a synthetic test user.
  const regRes = await serverInstance.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { masterPassword: TEST_PASSWORD, email: TEST_EMAIL, username: TEST_USERNAME },
  });
  expect(regRes.statusCode).toBe(201);
});

afterAll(async () => {
  await serverInstance.close();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// ── Helper: replace global.fetch with server.inject() wrapper ────────────────────
function stubFetchForServer() {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const body =
      init?.body != null
        ? JSON.parse(typeof init.body === 'string' ? init.body : JSON.stringify(init.body))
        : undefined;
    const headerObj =
      init?.headers != null
        ? (typeof init.headers === 'object' && !Array.isArray(init.headers)
            ? Object.fromEntries(new Headers(init.headers))
            : init.headers)
        : undefined;

    const res = await serverInstance.inject({ method, url: urlStr, payload: body, headers: headerObj });
    const json = await res.json();
    return new Response(JSON.stringify(json), {
      status: res.statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

function renderApp(initialPath: string) {
  const router = createMemoryRouter(routesWithSession, { initialEntries: [initialPath] });
  return render(<RouterProvider router={router} />);
}

// ────────────────────────────────────────────────────────────────────────────────
// AC-a: Full happy-path lifecycle — login → vault → lock → unlock → vault again
// ────────────────────────────────────────────────────────────────────────────────
describe('AC-a: full login → vault → lock → unlock lifecycle', () => {
  it('login POSTs masterPassword + email to /auth/unlock and redirects to /vault', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', stubFetchForServer());

    renderApp('/login');

    await user.type(screen.getByLabelText('Email'), TEST_EMAIL);
    await user.type(screen.getByLabelText('Master password'), TEST_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Vault', level: 1 })).not.toBeNull()
    );
  });

  it('lock navigates to /unlock after clicking the lock button on the vault page', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', stubFetchForServer());

    // Login first.
    renderApp('/login');
    await user.type(screen.getByLabelText('Email'), TEST_EMAIL);
    await user.type(screen.getByLabelText('Master password'), TEST_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Vault', level: 1 })).not.toBeNull()
    );

    // Click the lock button.
    const lockButton = screen.getByRole('button', { name: /lock/i });
    expect(lockButton).not.toBeNull();
    await user.click(lockButton);

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Unlock', level: 1 })).not.toBeNull()
    );
  });

  it('re-unlock after lock returns to /vault', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', stubFetchForServer());

    // Login.
    renderApp('/login');
    await user.type(screen.getByLabelText('Email'), TEST_EMAIL);
    await user.type(screen.getByLabelText('Master password'), TEST_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Vault', level: 1 })).not.toBeNull()
    );

    // Lock.
    await user.click(screen.getByRole('button', { name: /lock/i }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Unlock', level: 1 })).not.toBeNull()
    );

    // Re-unlock.
    await user.type(screen.getByLabelText('Email'), TEST_EMAIL);
    await user.type(screen.getByLabelText('Master password'), TEST_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Vault', level: 1 })).not.toBeNull()
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// AC-b: Fresh unlock after lock invalidates old session + refresh token
// ────────────────────────────────────────────────────────────────────────────────
describe('AC-b: fresh unlock after lock invalidates old session', () => {
  it('new unlock issues a different refresh token from the pre-lock one', async () => {
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

    expect(rt2).not.toBe(rt1);
  });

  it('old access token rejected by GET /auth/status after re-unlock + lock', async () => {
    const u1 = await serverInstance.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: { email: TEST_EMAIL, masterPassword: TEST_PASSWORD },
    });
    const t1 = (u1.json() as { accessToken: string }).accessToken;

    await serverInstance.inject({
      method: 'POST',
      url: '/auth/lock',
      headers: { authorization: `Bearer ${t1}` },
    });

    await serverInstance.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: { email: TEST_EMAIL, masterPassword: TEST_PASSWORD },
    });

    const statusRes = await serverInstance.inject({
      method: 'GET',
      url: '/auth/status',
      headers: { authorization: `Bearer ${t1}` },
    });
    expect(statusRes.statusCode).toBe(401);
  });

  it('old refresh token rejected by POST /auth/refresh after re-unlock + lock', async () => {
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

    await serverInstance.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: { email: TEST_EMAIL, masterPassword: TEST_PASSWORD },
    });

    const refreshRes = await serverInstance.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: rt1 },
    });
    expect(refreshRes.statusCode).toBe(401);
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// AC-c: Lock idempotency
// ────────────────────────────────────────────────────────────────────────────────
describe('AC-c: lock is idempotent', () => {
  it('two consecutive locks both return 200 locked', async () => {
    const u = await serverInstance.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: { email: TEST_EMAIL, masterPassword: TEST_PASSWORD },
    });
    const token = (u.json() as { accessToken: string }).accessToken;

    const l1 = await serverInstance.inject({
      method: 'POST',
      url: '/auth/lock',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(l1.statusCode).toBe(200);
    expect((l1.json() as { status: string }).status).toBe('locked');

    const l2 = await serverInstance.inject({
      method: 'POST',
      url: '/auth/lock',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(l2.statusCode).toBe(200);
    expect((l2.json() as { status: string }).status).toBe('locked');
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// AC-d: Status correctness & no user-enumeration leak
// ────────────────────────────────────────────────────────────────────────────────
describe('AC-d: status correctness & no enumeration leak', () => {
  it('status response has exactly { status, sessionId, expiresAt } when unlocked', async () => {
    const u = await serverInstance.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: { email: TEST_EMAIL, masterPassword: TEST_PASSWORD },
    });
    const token = (u.json() as { accessToken: string }).accessToken;

    const sRes = await serverInstance.inject({
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
    const u = await serverInstance.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: { email: TEST_EMAIL, masterPassword: TEST_PASSWORD },
    });
    const token = (u.json() as { accessToken: string }).accessToken;
    await serverInstance.inject({
      method: 'POST',
      url: '/auth/lock',
      headers: { authorization: `Bearer ${token}` },
    });

    const sRes = await serverInstance.inject({
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
    const u = await serverInstance.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: { email: TEST_EMAIL, masterPassword: TEST_PASSWORD },
    });
    const token = (u.json() as { accessToken: string }).accessToken;
    await serverInstance.inject({
      method: 'POST',
      url: '/auth/lock',
      headers: { authorization: `Bearer ${token}` },
    });

    const unknownRes = await serverInstance.inject({
      method: 'GET',
      url: '/auth/status',
      headers: { authorization: 'Bearer not.a.real.token' },
    });
    expect(unknownRes.statusCode).toBe(401);
  });
});
