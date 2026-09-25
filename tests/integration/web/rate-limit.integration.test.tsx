/**
 * @license
 * FE-002g: Web integration tests — rate-limit UI.
 *
 * Test type: integration (real Fastify server + real SQLite + real React rendering
 * via @testing-library/react in jsdom).
 *
 * Verifies the full stack rate-limit flow: the backend tracks failed attempts
 * per user and locks out for 15 minutes after 5 consecutive failures; the UI
 * renders the countdown and disables the form when the server returns 401 after
 * the threshold is crossed.
 *
 * Acceptance criteria (from backlog):
 *   3. Rate-limit UI covered.
 *
 * AR-4: all data synthetic.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

// ── Real API server ──────────────────────────────────────────────────────────────
import { createServer } from '../../../apps/services/api/src/server';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../../../apps/services/api/src/schema';
import { setTestDbOverride } from '../../../apps/services/api/src/db';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDir = mkdtempSync(join(tmpdir(), 'pm-fe002g-ratelimit-'));
const dbPath = join(tmpDir, 'test.db');

// ── Route wrapping ───────────────────────────────────────────────────────────────
import { routes } from '../../../apps/web/src/routes';
import { SessionProvider } from '../../../apps/web/src/auth/SessionProvider';
import { createQueryClient } from '../../../apps/web/src/queryClient';

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
const TEST_EMAIL = 'rate-limit-test@example.test';
const TEST_PASSWORD = 'test-rate-limit-password-2024';
const WRONG_PASSWORD = 'wrong-password-0000';

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
    payload: { masterPassword: TEST_PASSWORD, email: TEST_EMAIL, username: 'ratelimituser' },
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
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

// ────────────────────────────────────────────────────────────────────────────────
// AC-3: Rate-limit UI — backend rate-limiting + UI countdown
// ────────────────────────────────────────────────────────────────────────────────
describe('AC-3: rate-limit UI (backend + frontend)', () => {
  it('backend locks out after 5 consecutive failed attempts', async () => {
    // 5 failed attempts with wrong password.
    for (let i = 0; i < 5; i++) {
      const res = await serverInstance.inject({
        method: 'POST',
        url: '/auth/unlock',
        payload: { email: TEST_EMAIL, masterPassword: WRONG_PASSWORD },
      });
      expect(res.statusCode).toBe(401);
      expect((res.json() as { message: string }).message).toBe('Invalid credentials');
    }

    // 6th attempt — should still be 401 but the user is now locked out.
    const lockedRes = await serverInstance.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: { email: TEST_EMAIL, masterPassword: WRONG_PASSWORD },
    });
    expect(lockedRes.statusCode).toBe(401);
    // Backend returns the same generic message — no enumeration.
    expect((lockedRes.json() as { message: string }).message).toBe('Invalid credentials');
  });

  it('correct password after lockout still fails (server-side lockout)', async () => {
    // Even the correct password should fail while locked out.
    const res = await serverInstance.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: { email: TEST_EMAIL, masterPassword: TEST_PASSWORD },
    });
    expect(res.statusCode).toBe(401);
  });

  it('UI shows rate-limit countdown after 5 consecutive failed attempts', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', stubFetchForServer());

    renderApp('/login');

    const emailInput = screen.getByLabelText('Email');
    const passwordInput = screen.getByLabelText('Master password');
    const submitButton = screen.getByRole('button', { name: 'Sign in' });

    // Type initial credentials.
    await act(async () => {
      fireEvent.change(emailInput, { target: { value: TEST_EMAIL } });
      fireEvent.change(passwordInput, { target: { value: WRONG_PASSWORD } });
      await Promise.resolve();
    });

    // 5 consecutive failed attempts — each clears the password field,
    // so we must re-type before each click. Each round trip runs a REAL
    // argon2id hash comparison via server.inject(), which is real async
    // CPU-bound work — a fixed handful of `await Promise.resolve()` ticks
    // only drains already-queued microtasks and isn't guaranteed to wait
    // long enough for that to finish, so we poll for the password field
    // to clear (LoginPage's own 401-handling side effect) as the signal
    // that this round's response was actually processed before moving on.
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        fireEvent.change(passwordInput, { target: { value: WRONG_PASSWORD } });
        await Promise.resolve();
      });
      fireEvent.click(submitButton);
      await waitFor(() => expect(passwordInput).toHaveValue(''));
    }

    // After 5 failures, the rate-limit message + countdown appear.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Too many failed attempts. Please try again later.');

    const countdown = screen.getByText(/try again in \d+:\d+/i);
    expect(countdown).not.toBeNull();

    // Form is disabled during lockout.
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    expect(screen.getByLabelText('Email')).toBeDisabled();
    expect(screen.getByLabelText('Master password')).toBeDisabled();
  });

  it('countdown decrements and form re-enables when it expires', async () => {
    vi.useFakeTimers();

    // Re-render a fresh login page.
    const user = userEvent.setup();
    vi.stubGlobal('fetch', stubFetchForServer());
    renderApp('/login');

    const emailInput = screen.getByLabelText('Email');
    const passwordInput = screen.getByLabelText('Master password');
    const submitButton = screen.getByRole('button', { name: 'Sign in' });

    await act(async () => {
      fireEvent.change(emailInput, { target: { value: TEST_EMAIL } });
      fireEvent.change(passwordInput, { target: { value: WRONG_PASSWORD } });
      await Promise.resolve();
    });

    for (let i = 0; i < 5; i++) {
      await act(async () => {
        fireEvent.change(passwordInput, { target: { value: WRONG_PASSWORD } });
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.click(submitButton);
        // `advanceTimersByTimeAsync` (not the sync `advanceTimersByTime`)
        // so pending real I/O — the stubbed fetch's server.inject() call,
        // which runs a real argon2id hash — actually gets to interleave
        // and resolve while fake timers are active. The sync variant
        // advances virtual time without yielding to the real event loop,
        // which left this submit permanently stuck in its loading state.
        await vi.advanceTimersByTimeAsync(1);
      });
    }

    // Initial countdown: 15:00.
    expect(screen.getByText(/try again in 15:00/i)).not.toBeNull();

    // Advance 1s → 14:59.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText(/try again in 14:59/i)).not.toBeNull();

    // Advance remaining 14m 58s → 0:01.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14 * 60 * 1000 + 58 * 1000);
    });
    expect(screen.getByText(/try again in 0:01/i)).not.toBeNull();

    // Final second — countdown expires, form re-enables.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.queryByText(/try again in/i)).toBeNull();

    // Inputs re-enable, but submit stays disabled (password was cleared).
    expect(screen.getByLabelText('Email')).not.toBeDisabled();
    expect(screen.getByLabelText('Master password')).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    expect(screen.getByLabelText('Master password')).toHaveValue('');

    vi.useRealTimers();
  });
});
