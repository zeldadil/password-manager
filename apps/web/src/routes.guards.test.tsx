import { act, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { routes } from './routes'
import { SessionProvider } from './auth/SessionProvider'
import { createQueryClient } from './queryClient'

/** Wraps every child route in SessionProvider so components that call useSession()
 *  (AppShell, AutoLockBanner) render without throwing. SessionProvider calls
 *  useNavigate() internally, so it must live inside the router context — the
 *  RouterProvider owns that context, and SessionProvider is its child. */
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

/**
 * Router guard unit tests (FE-001i).
 *
 * The guard contract owned by the route table (FE-001b, fail-closed design):
 *
 *  1. every path the app does not own redirects to `/login` — including nested
 *     and parameterised paths that only look like real screens;
 *  2. the redirect *replaces* the guarded history entry, so the browser Back
 *     button never returns to a path the guard already rejected;
 *  3. the authenticated shell is rendered for authenticated screens only —
 *     pre-auth screens (`/login`, `/unlock`) never get the shell, and a guarded
 *     path never renders it;
 *  4. route transitions swap the pre-auth screen for the shell and back.
 *
 * A session-based guard (redirect a *known* screen when no session exists) is
 * not part of this table: no client session signal exists yet. See the FE-001i
 * handoff note.
 */

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

function collectPaths(routeList: RouteObject[]): string[] {
  const paths: string[] = []
  for (const route of routeList) {
    if (route.path) paths.push(route.path)
    if (route.children) paths.push(...collectPaths(route.children))
  }
  return paths
}

describe('router guards — fail closed', () => {
  it('redirects an unknown path to the sign-in screen', () => {
    renderAt('/no/such/route')

    expect(screen.getByRole('heading', { level: 1, name: 'Login' })).toBeTruthy()
  })

  it('redirects a nested unknown path under an authenticated section', () => {
    renderAt('/vault/does-not-exist')

    expect(screen.getByRole('heading', { level: 1, name: 'Login' })).toBeTruthy()
  })

  it('redirects a parameterised route addressed without its parameter', () => {
    renderAt('/resources/')

    expect(screen.getByRole('heading', { level: 1, name: 'Login' })).toBeTruthy()
  })

  it('never renders the authenticated shell for a guarded path', () => {
    renderAt('/vault/nope')

    expect(screen.queryByRole('banner')).toBeNull()
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('replaces the guarded history entry instead of pushing a new one', async () => {
    // History: ['/vault', '/no/such/route'] — the last entry is the guarded one.
    const router = renderEntries(['/vault', '/no/such/route'])

    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.historyAction).toBe('REPLACE')

    // Back must land on the last real screen, not on the rejected path. If the
    // guard pushed instead of replacing, Back would re-enter '/no/such/route'
    // and be redirected to the sign-in screen again.
    await act(async () => {
      await router.navigate(-1)
    })

    expect(router.state.location.pathname).toBe('/vault')
    expect(screen.getByRole('heading', { level: 1, name: 'Vault' })).toBeTruthy()
  })

  it('redirects the root path with a replace as well', () => {
    const router = renderAt('/')

    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.historyAction).toBe('REPLACE')
  })
})

describe('router guards — authenticated shell boundary', () => {
  const preAuthPaths = ['/login', '/unlock']
  // Every screen the route table owns except the guard paths ('/' and '*', both
  // of which redirect) and the standalone pre-auth screens.
  const shellPaths = collectPaths(routes).filter(
    (path) => path !== '/' && path !== '*' && !preAuthPaths.includes(path),
  )

  it('collects the authenticated screens from the route table', () => {
    expect(shellPaths).toEqual([
      '/vault',
      '/resources/:id',
      '/folders',
      '/tags',
      '/settings',
      '/generator',
    ])
  })

  it.each(preAuthPaths)('renders %s without the authenticated shell', (path) => {
    renderAt(path)

    expect(screen.queryByRole('banner')).toBeNull()
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it.each(shellPaths)('renders %s inside the authenticated shell', (path) => {
    renderAt(path.replace(':id', 'res-1'))

    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByRole('complementary')).toBeTruthy()
    expect(screen.getByRole('main')).toBeTruthy()
  })

  it('swaps the pre-auth screen for the shell on a route transition', async () => {
    const router = renderAt('/login')
    expect(screen.queryByRole('banner')).toBeNull()

    await act(async () => {
      await router.navigate('/vault')
    })

    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Vault' })).toBeTruthy()
  })

  it('returns to the pre-auth screen when the session ends', async () => {
    const router = renderAt('/vault')

    await act(async () => {
      await router.navigate('/unlock')
    })

    expect(screen.getByRole('heading', { level: 1, name: 'Unlock' })).toBeTruthy()
    expect(screen.queryByRole('banner')).toBeNull()
  })
})
