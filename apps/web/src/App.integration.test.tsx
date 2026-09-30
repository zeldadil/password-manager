import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { routes } from './routes'

/**
 * FE-001j — Integration tests (task t_4ccd2652).
 *
 * Scope (decision t_4a892f1d (b)): the app's route table is fail-closed —
 * `/` and `*` redirect to `/login` with `replace`, and there is no session-based
 * guard (nothing reads the token store for routing). These integration specs
 * exercise the full route table through the RouterProvider, covering:
 *
 *  1. Route transitions — every owned screen renders; transitions through the
 *     shell UI (header brand link, user menu) swap screens and preserve the
 *     shell boundary.
 *  2. Auth redirect (unauthenticated → /login) — the fail-closed redirect: root
 *     and unknown paths land on /login; known screens render without a session
 *     (no session guard exists yet — that is the scoped design, not a gap).
 *  3. Layout responsiveness — the AppShell grid renders at the jsdom default
 *     viewport and stays coherent when the viewport is narrowed. The sidebar
 *     collapse/expand control is not wired yet — that is flagged, not fabricated.
 *
 * We use createMemoryRouter (not createBrowserRouter) because jsdom has no URL
 * bar; initialEntries is the only way to set the initial location. The unit lane
 * owns guard semantics (replace-not-push via Back); this lane confirms every
 * screen renders and the shell boundary holds across transitions.
 */

// ── Helpers ────────────────────────────────────────────────────────────────────

function renderAt(initialPath: string) {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] })
  render(<RouterProvider router={router} />)
  return router
}

function renderEntries(initialEntries: string[], index = initialEntries.length - 1) {
  const router = createMemoryRouter(routes, { initialEntries, initialIndex: index })
  render(<RouterProvider router={router} />)
  return router
}

// ── 1. Route transitions ───────────────────────────────────────────────────────

describe('App — route transitions (integration)', () => {
  // ── Every owned screen renders ──────────────────────────────────────────────

  it('renders the login screen at the app entry point (fail-closed from /)', () => {
    renderAt('/')

    expect(screen.getByRole('heading', { level: 1, name: 'Login' })).toBeTruthy()
  })

  it('renders the login screen for an unknown path (fail-closed)', () => {
    renderAt('/no/such/path')

    expect(screen.getByRole('heading', { level: 1, name: 'Login' })).toBeTruthy()
  })

  it('renders the login screen when the wildcard catches an unknown path', () => {
    renderAt('/something/bogus/with/many/segments')

    expect(screen.getByRole('heading', { level: 1, name: 'Login' })).toBeTruthy()
  })

  it('renders vault inside the authenticated shell', () => {
    renderAt('/vault')

    expect(screen.getByRole('heading', { level: 1, name: 'Vault' })).toBeTruthy()
    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByRole('complementary')).toBeTruthy()
    expect(screen.getByRole('main')).toBeTruthy()
  })

  it('renders folders inside the authenticated shell', () => {
    renderAt('/folders')

    expect(screen.getByRole('heading', { level: 1, name: 'Folders' })).toBeTruthy()
    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByRole('main')).toBeTruthy()
  })

  it('renders tags inside the authenticated shell', () => {
    renderAt('/tags')

    expect(screen.getByRole('heading', { level: 1, name: 'Tags' })).toBeTruthy()
    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByRole('main')).toBeTruthy()
  })

  it('renders settings inside the authenticated shell', () => {
    renderAt('/settings')

    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy()
    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByRole('main')).toBeTruthy()
  })

  it('renders the generator inside the authenticated shell', () => {
    renderAt('/generator')

    expect(screen.getByRole('heading', { level: 1, name: 'Generator' })).toBeTruthy()
    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByRole('main')).toBeTruthy()
  })

  it('renders a resource detail for a concrete id inside the shell', () => {
    renderAt('/resources/res-123')

    expect(screen.getByRole('heading', { level: 1, name: 'Resource' })).toBeTruthy()
    expect(screen.getByText('res-123')).toBeTruthy()
  })

  // ── Route transitions via shell UI ──────────────────────────────────────────

  it('transitions from vault to settings through the user menu', async () => {
    const user = userEvent.setup()
    renderAt('/vault')

    await user.click(screen.getByRole('button', { name: 'Account' }))
    await user.click(screen.getByRole('link', { name: 'Settings' }))

    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy()
  })

  it('transitions from settings back to vault through the header brand link', async () => {
    const user = userEvent.setup()
    renderAt('/settings')

    await user.click(screen.getByRole('link', { name: 'Password Manager' }))

    expect(screen.getByRole('heading', { level: 1, name: 'Vault' })).toBeTruthy()
  })

  it('transitions vault -> settings -> vault through the shell UI', async () => {
    const user = userEvent.setup()
    renderAt('/vault')

    // Vault -> Settings
    await user.click(screen.getByRole('button', { name: 'Account' }))
    await user.click(screen.getByRole('link', { name: 'Settings' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy()

    // Settings -> Vault
    await user.click(screen.getByRole('link', { name: 'Password Manager' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Vault' })).toBeTruthy()
  })

  // ── Pre-auth screens render without the shell ────────────────────────────────

  it('does not render the authenticated shell on the login screen', () => {
    renderAt('/login')

    expect(screen.queryByRole('banner')).toBeNull()
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('does not render the authenticated shell on the unlock screen', () => {
    renderAt('/unlock')

    expect(screen.queryByRole('banner')).toBeNull()
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  // ── History semantics (replace, not push) ───────────────────────────────────
  // The unit lane (routes.guards.test.tsx) pins replace-not-push with a Back
  // navigation; this integration lane confirms the same contract end-to-end
  // through the memory router.

  it('redirects the root path with a replace history action', () => {
    const router = renderAt('/')

    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('redirects an unknown path with a replace history action', () => {
    const router = renderAt('/no/such/route')

    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('back from a guarded path lands on the previous real screen', async () => {
    // History: ['/vault', '/no/such/route'] — the last entry is the guarded one.
    const router = renderEntries(['/vault', '/no/such/route'], 1)

    // entryIndex 1 = '/no/such/route' -> redirected to /login with replace.
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.historyAction).toBe('REPLACE')

    // Back (router.navigate(-1)) should land on /vault (the last real screen),
    // not re-enter the guarded path (which would redirect to /login again).
    await router.navigate(-1)

    expect(router.state.location.pathname).toBe('/vault')
  })
})

// ── 2. Auth redirect: fail-closed to /login ───────────────────────────────────

describe('App — auth redirect: fail-closed to /login (integration)', () => {
  /**
   * The route table is fail-closed: `/` and `*` redirect to `/login` with
   * `replace`. There is no session-based guard, so a known screen (`/vault`)
   * renders even with no session. This is the scoped design — see t_4a892f1d (b).
   */

  it('redirects the root path to /login and sets the title', () => {
    renderAt('/')

    expect(screen.getByRole('heading', { level: 1, name: 'Login' })).toBeTruthy()
    expect(document.title).toBe('Sign in · Password Manager')
  })

  it('redirects an unknown path to /login', () => {
    renderAt('/no/such/route')

    expect(screen.getByRole('heading', { level: 1, name: 'Login' })).toBeTruthy()
  })

  it('redirects the wildcard path to /login', () => {
    renderAt('/something/bogus/with/many/segments')

    expect(screen.getByRole('heading', { level: 1, name: 'Login' })).toBeTruthy()
  })

  it('renders a known screen without a session (no session guard exists)', () => {
    // The scoped AC (t_4a892f1d (b)) owns this behaviour: there is no session
    // guard, so /vault renders for an unauthenticated visitor. The unit lane
    // pins the shell boundary; this integration confirms the route table honours
    // that contract end to end.
    renderAt('/vault')

    expect(screen.getByRole('heading', { level: 1, name: 'Vault' })).toBeTruthy()
    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByRole('main')).toBeTruthy()
  })

  it('sets the document title for each owned route', () => {
    const titleCases = [
      ['/login', 'Sign in · Password Manager'],
      ['/unlock', 'Unlock vault · Password Manager'],
      ['/vault', 'Vault · Password Manager'],
      ['/resources/res-1', 'Resource · Password Manager'],
      ['/folders', 'Folders · Password Manager'],
      ['/tags', 'Tags · Password Manager'],
      ['/settings', 'Settings · Password Manager'],
      ['/generator', 'Password generator · Password Manager'],
    ]

    for (const [path, expectedTitle] of titleCases) {
      renderAt(path)

      expect(document.title).toBe(expectedTitle)
    }
  })

  it('updates the document title on a route transition', async () => {
    const user = userEvent.setup()
    renderAt('/vault')

    expect(document.title).toBe('Vault · Password Manager')

    await user.click(screen.getByRole('button', { name: 'Account' }))
    await user.click(screen.getByRole('link', { name: 'Settings' }))

    expect(document.title).toBe('Settings · Password Manager')
  })
})

// ── 3. Layout responsiveness ───────────────────────────────────────────────────

describe('App — layout responsiveness (integration)', () => {
  /**
   * The AppShell is a CSS grid (header + sidebar + main). These specs render the
   * full route table at the jsdom default viewport (1024x768) and at a narrowed
   * viewport to confirm the shell stays coherent. The sidebar collapse/expand
   * control is not wired yet (useUiStore.toggleSidebar exists but is not connected
   * to Sidebar) — that is flagged, not fabricated here.
   */

  it('renders the shell layout at the default viewport', () => {
    renderAt('/vault')

    const banner = screen.getByRole('banner')
    const complementary = screen.getByRole('complementary')
    const main = screen.getByRole('main')

    // Header, sidebar, main exist and are in DOM-order.
    expect(
      banner.compareDocumentPosition(complementary) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      complementary.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    // Content lands in main.
    expect(main.textContent).toContain('Vault')
  })

  it('keeps the shell coherent when the viewport is narrowed', () => {
    // Simulate a narrow viewport (mobile-like). jsdom does not evaluate CSS media
    // queries, so this asserts the component tree, not a visual breakpoint.
    Object.defineProperty(window, 'innerWidth', { value: 390, writable: true })
    window.dispatchEvent(new Event('resize'))

    renderAt('/vault')

    // The shell still renders all three regions at a narrow width — nothing collapses
    // yet (sidebar toggle not wired), but the layout must not blow up.
    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByRole('complementary')).toBeTruthy()
    expect(screen.getByRole('main')).toBeTruthy()
    expect(screen.getByText('Vault')).toBeTruthy()
  })

  it('renders the sidebar sections at the default viewport', () => {
    renderAt('/vault')

    expect(screen.getByRole('heading', { name: 'Folders' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Tags' })).toBeTruthy()
  })

  it('renders the sidebar with folder tree and tags list at narrow width', () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, writable: true })
    window.dispatchEvent(new Event('resize'))

    renderAt('/vault')

    expect(screen.getByRole('heading', { name: 'Folders' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Tags' })).toBeTruthy()
    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByRole('main')).toBeTruthy()
  })
})
