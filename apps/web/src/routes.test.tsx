import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { routes } from './routes'
import { SessionProvider } from './auth/SessionProvider'

/** Wraps every child route in SessionProvider so components that call useSession()
 *  (AppShell, AutoLockBanner) render without throwing. */
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

function renderAt(initialPath: string) {
  const router = createMemoryRouter(routesWithSession, { initialEntries: [initialPath] })
  render(<RouterProvider router={router} />)
}

// Route tables may nest (e.g. the AppShell layout route); collect every path,
// including children, so the acceptance check covers nested screen paths too.
function collectPaths(routeList: typeof routes): string[] {
  const paths: string[] = []
  for (const route of routeList) {
    if (route.path) paths.push(route.path)
    if (route.children) paths.push(...collectPaths(route.children))
  }
  return paths
}

describe('route table', () => {
  it('defines the eight required screen paths', () => {
    const paths = new Set(collectPaths(routes))
    for (const path of [
      '/login',
      '/unlock',
      '/vault',
      '/resources/:id',
      '/folders',
      '/tags',
      '/settings',
      '/generator',
    ]) {
      expect(paths.has(path)).toBe(true)
    }
  })
})

describe('route rendering', () => {
  it.each([
    ['Login', '/login'],
    ['Unlock', '/unlock'],
    ['Vault', '/vault'],
    ['Folders', '/folders'],
    ['Tags', '/tags'],
    ['Settings', '/settings'],
    ['Generator', '/generator'],
  ])('renders the %s screen at %s', (heading, path) => {
    renderAt(path)
    expect(screen.queryByRole('heading', { name: heading, level: 1 })).not.toBeNull()
  })

  it('renders the resource screen for a concrete id and exposes the id param', () => {
    renderAt('/resources/res-123')
    expect(screen.queryByRole('heading', { name: 'Resource', level: 1 })).not.toBeNull()
    expect(screen.queryByText('res-123')).not.toBeNull()
  })
})

describe('app shell', () => {
  it('wraps authenticated screens in the shell (header + sidebar + main)', () => {
    renderAt('/vault')
    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByRole('complementary')).toBeTruthy()
    expect(screen.getByRole('main')).toBeTruthy()
  })

  it('renders pre-auth screens without the shell', () => {
    renderAt('/login')
    expect(screen.queryByRole('banner')).toBeNull()
    expect(screen.queryByRole('complementary')).toBeNull()
  })
})

describe('fallback navigation', () => {
  it('redirects the root path to /login', () => {
    renderAt('/')
    expect(screen.queryByRole('heading', { name: 'Login', level: 1 })).not.toBeNull()
  })

  it('redirects unknown paths to /login (fail closed)', () => {
    renderAt('/no/such/route')
    expect(screen.queryByRole('heading', { name: 'Login', level: 1 })).not.toBeNull()
  })
})
