/**
 * @license
 * FE-001j: Web integration tests — route transitions, auth redirect (fail-closed),
 * and layout responsiveness.
 *
 * Test type: integration (jsdom + real React rendering via @testing-library/react).
 * Runs in the integration lane (apps/web/vitest.integration.config.ts), excluded
 * from the hermetic unit lane (pnpm test:unit excludes *.integration.test.*).
 *
 * Acceptance criteria (from backlog, re-scoped by architect decision t_4a892f1d):
 *   1. Route transitions, auth redirect (unauthenticated → /login), layout
 *      responsiveness covered.
 *
 * Scope note (architect decision t_4a892f1d, verdict PASS):
 *   The "auth redirect (unauthenticated → /login)" AC is scoped to the route
 *   table's fail-closed redirect only — `/` and `*` redirect to `/login` with
 *   `replace`. There is no session-based guard (nothing reads the token store
 *   for routing), so a known screen like /vault is NOT redirected when there is
 *   no session. That guard is a separate concern owned by a future card.
 *
 * Lane split (FE-001i handoff):
 *   pnpm test:unit          — hermetic unit lane; excludes integration specs
 *                             (the unit lane's own exclude pattern wins over this
 *                             file, so it never leaks into the unit run).
 *   pnpm test:integration   — picks up integration specs from the web app src
 *                             tree via the dedicated vitest.integration.config.ts,
 *                             which lists its own include pattern so the lane can't
 *                             silently miss files the way the old positional-filter
 *                             script did.
 *
 * AR-4: all data synthetic — this spec uses createMemoryRouter (no real server).
 *      Real-server integration tests live in tests/integration/web/ (FE-002g).
 */

import '@testing-library/jest-dom'
import '@testing-library/jest-dom'
import { act, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { routes } from './routes'
import { SessionProvider } from './auth/SessionProvider'
import { createQueryClient } from './queryClient'
import { MAIN_CONTENT_ID } from './a11y/RouteFocusManager'

/** Wraps every child route in SessionProvider so components that call useSession()
 *  (AppShell, AutoLockBanner, Header) render without throwing. SessionProvider
 *  calls useNavigate() internally, so it must live inside the router context —
 *  the RouterProvider owns that context, and SessionProvider is its child.
 *
 *  Note: A11yLayout (the root layout route in routes.tsx) already renders its own
 *  SessionProvider around its Outlet. The wrapper below therefore produces nested
 *  SessionProviders (React contexts with the same value coalesce at render time,
 *  and each component sees the nearest one). The unit-test suite
 *  (routes.guards.test.tsx) uses the identical pattern, so we keep it for parity. */
function wrapRoutes(routeList: RouteObject[]): RouteObject[] {
  const root = routeList[0]
  const wrappedChildren: RouteObject[] | undefined = root.children?.map((child) => ({
    ...child,
    element: <SessionProvider>{child.element}</SessionProvider>,
  }))
  return [
    {
      ...root,
      children: wrappedChildren,
    } as RouteObject,
  ]
}

const routesWithSession: RouteObject[] = wrapRoutes(routes)

function renderEntries(entries: string[], index = entries.length - 1) {
  const router = createMemoryRouter(routesWithSession, {
    initialEntries: entries,
    initialIndex: index,
  })
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

function renderAt(path: string) {
  return renderEntries([path])
}

// ────────────────────────────────────────────────────────────────────────────────
// AC-1: Route transitions — pre-auth ↔ authenticated screen swaps
// ────────────────────────────────────────────────────────────────────────────────

describe('FE-001j: route transitions', () => {
  it('transitions from a pre-auth screen to an authenticated screen and mounts the shell', async () => {
    const router = renderAt('/login')

    // Initial state: pre-auth screen, no shell.
    expect(screen.getByRole('heading', { name: 'Login', level: 1 })).toBeTruthy()
    expect(screen.queryByRole('banner')).toBeNull()
    expect(screen.queryByRole('complementary')).toBeNull()

    // Transition to the vault — shell must now be present.
    await act(async () => {
      await router.navigate('/vault')
    })

    expect(screen.getByRole('heading', { name: 'Vault', level: 1 })).toBeTruthy()
    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByRole('complementary')).toBeTruthy()
    expect(screen.getByRole('main')).toBeTruthy()
  })

  it('transitions from an authenticated screen back to a pre-auth screen and unmounts the shell', async () => {
    const router = renderAt('/vault')

    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByRole('complementary')).toBeTruthy()

    await act(async () => {
      await router.navigate('/unlock')
    })

    expect(screen.getByRole('heading', { name: 'Unlock', level: 1 })).toBeTruthy()
    expect(screen.queryByRole('banner')).toBeNull()
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('transitions across authenticated screens without unmounting the shell', async () => {
    const router = renderAt('/vault')

    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByRole('complementary')).toBeTruthy()

    await act(async () => {
      await router.navigate('/settings')
    })

    expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeTruthy()
    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByRole('complementary')).toBeTruthy()
    expect(screen.getByRole('main')).toBeTruthy()
  })

  it('transitions through the resource detail screen and back', async () => {
    const router = renderAt('/vault')

    await act(async () => {
      await router.navigate('/resources/res-1')
    })

    expect(screen.getByRole('heading', { name: 'Resource', level: 1 })).toBeTruthy()
    expect(screen.queryByText('res-1')).toBeTruthy()
    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByRole('complementary')).toBeTruthy()

    await act(async () => {
      await router.navigate('/vault')
    })

    expect(screen.getByRole('heading', { name: 'Vault', level: 1 })).toBeTruthy()
    expect(screen.getByRole('banner')).toBeTruthy()
  })

  it('history action is PUSH on an authenticated-screen transition (not REPLACE)', async () => {
    const router = renderAt('/login')

    await act(async () => {
      await router.navigate('/vault')
    })

    expect(router.state.historyAction).toBe('PUSH')
    expect(router.state.location.pathname).toBe('/vault')
  })

  it('document title updates on each route transition', async () => {
    const router = renderAt('/login')

    expect(document.title).toBe('Sign in · Password Manager')

    await act(async () => {
      await router.navigate('/vault')
    })

    expect(document.title).toBe('Vault · Password Manager')

    await act(async () => {
      await router.navigate('/settings')
    })

    expect(document.title).toBe('Settings · Password Manager')

    await act(async () => {
      await router.navigate('/folders')
    })

    expect(document.title).toBe('Folders · Password Manager')
  })
})

// ────────────────────────────────────────────────────────────────────────────────
// AC-1 (continued): auth redirect — fail-closed (architect decision t_4a892f1d)
// ────────────────────────────────────────────────────────────────────────────────

describe('FE-001j: auth redirect — fail-closed (no session guard)', () => {
  /**
   * Scope (architect decision t_4a892f1d): this suite verifies the route table's
   * fail-closed redirect only — paths the app does not own redirect to /login.
   * There is no session-based guard: /vault does NOT redirect when there is no
   * session, because nothing reads the token store for routing. That guard is a
   * separate, unsanctioned concern (not owned by this card).
   */

  it('redirects an unknown path to /login', () => {
    renderAt('/no/such/route')

    expect(screen.getByRole('heading', { name: 'Login', level: 1 })).toBeTruthy()
  })

  it('redirects the root path to /login', () => {
    const router = renderAt('/')

    expect(router.state.location.pathname).toBe('/login')
    expect(screen.getByRole('heading', { name: 'Login', level: 1 })).toBeTruthy()
  })

  it('redirects a nested unknown path under an authenticated section to /login', () => {
    renderAt('/vault/does-not-exist')

    expect(screen.getByRole('heading', { name: 'Login', level: 1 })).toBeTruthy()
  })

  it('redirects a parameterised route addressed without its parameter to /login', () => {
    renderAt('/resources/')

    expect(screen.getByRole('heading', { name: 'Login', level: 1 })).toBeTruthy()
  })

  it('redirects a totally unrecognised path to /login', () => {
    renderAt('/completely-fake-path-12345')

    expect(screen.getByRole('heading', { name: 'Login', level: 1 })).toBeTruthy()
  })

  it('replaces the guarded history entry so the Back button does not re-enter the rejected path', async () => {
    // History: ['/vault', '/no/such/route'] — the last entry is the guarded one.
    const router = renderEntries(['/vault', '/no/such/route'])

    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.historyAction).toBe('REPLACE')

    // Back must land on the last real screen, not on the rejected path.
    await act(async () => {
      await router.navigate(-1)
    })

    expect(router.state.location.pathname).toBe('/vault')
    expect(screen.getByRole('heading', { name: 'Vault', level: 1 })).toBeTruthy()
  })

  it('does NOT redirect a known authenticated screen when there is no session (no session guard)', () => {
    // This is the explicit fail-closed-only behaviour per architect decision
    // t_4a892f1d. /vault renders (the shell + the page component) even though
    // there is no session — the route table owns the path and does not guard it.
    // VaultPage's useQuery is disabled without an accessToken, so it renders the
    // empty-state UI rather than fetching.
    renderAt('/vault')

    expect(screen.getByRole('heading', { name: 'Vault', level: 1 })).toBeTruthy()
    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByRole('complementary')).toBeTruthy()
    expect(screen.getByRole('main')).toBeTruthy()
    // Without a session the resource query is disabled; the empty state renders.
    expect(screen.getByText('No resources yet.')).toBeTruthy()
  })

  it('does NOT redirect a known pre-auth screen (no session guard needed there either)', () => {
    renderAt('/login')

    expect(screen.getByRole('heading', { name: 'Login', level: 1 })).toBeTruthy()
    expect(screen.queryByRole('banner')).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────────────────────
// AC-1 (continued): layout responsiveness — shell boundary + layout contract
// ────────────────────────────────────────────────────────────────────────────────

describe('FE-001j: layout responsiveness — shell boundary and layout contract', () => {
  /**
   * Layout responsiveness here means: the app shell (header + sidebar + main)
   * renders for authenticated screens and is absent for pre-auth screens, and the
   * layout structure (grid areas, landmarks) is correct. The sidebar collapse/
   * expand control (useUiStore.toggleSidebar) exists in the store but is NOT yet
   * wired to the Sidebar component — flagging that gap; this suite does not
   * depend on collapse/expand behaviour to pass.
   */

  it('renders the authenticated shell (header + sidebar + main) for every authenticated screen', () => {
    // Header = banner landmark, Sidebar = complementary landmark, Main = main landmark.
    for (const path of ['/vault', '/folders', '/tags', '/settings', '/generator']) {
      renderAt(path)

      expect(screen.getByRole('banner')).toBeTruthy()
      expect(screen.getByRole('complementary')).toBeTruthy()
      expect(screen.getByRole('main')).toBeTruthy()
    }
  })

  it('renders the resource detail screen inside the authenticated shell', () => {
    renderAt('/resources/res-1')

    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByRole('complementary')).toBeTruthy()
    expect(screen.getByRole('main')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Resource', level: 1 })).toBeTruthy()
  })

  it('renders pre-auth screens without the authenticated shell', () => {
    for (const path of ['/login', '/unlock']) {
      renderAt(path)

      expect(screen.queryByRole('banner')).toBeNull()
      expect(screen.queryByRole('complementary')).toBeNull()
      // Pre-auth screens still have the main landmark (A11yLayout mounts it).
      expect(screen.getByRole('main')).toBeTruthy()
    }
  })

  it('main content landmark carries the shared focus target id', () => {
    renderAt('/vault')

    expect(screen.getByRole('main')).toHaveAttribute('id', MAIN_CONTENT_ID)
    expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1')
  })

  it('sidebar carries the vault navigation label', () => {
    renderAt('/vault')

    expect(screen.getByRole('navigation', { name: 'Vault navigation' })).toBeTruthy()
  })

  it('header brand links back to the vault', () => {
    renderAt('/settings')

    const brand = screen.getByRole('link', { name: 'Password Manager' })
    expect(brand).toHaveAttribute('href', '/vault')
  })

  it('header exposes a lock button and a theme toggle', () => {
    renderAt('/vault')

    expect(screen.getByRole('button', { name: 'Lock vault' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeTruthy()
  })

  it('header user menu exposes settings and sign-out actions', () => {
    renderAt('/vault')

    const toggle = screen.getByRole('button', { name: 'Account' })
    expect(toggle).toBeTruthy()

    // Open the menu.
    toggle.click()

    expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })

  /**
   * Layout gap (flagged, not a test failure):
   * The UI store (useUiStore.toggleSidebar / setSidebarOpen) exists and holds the
   * sidebar open/closed state, but the Sidebar component is not wired to it — the
   * sidebar always renders expanded and there is no collapse/expand control in the
   * header or sidebar. Responsive collapse/expand behaviour (e.g. a hamburger on
   * narrow viewports, or a collapse button) is therefore not yet testable and is
   * owned by a future card. This suite asserts the layout contract that IS wired;
   * it does not depend on collapse/expand to pass.
   */
})
