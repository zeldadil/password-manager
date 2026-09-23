import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useEffect } from 'react'
import Header from './Header'
import { SessionProvider, useSession } from '../../auth/SessionProvider'

function renderHeaderWithSession(element: React.ReactNode) {
  const router = createMemoryRouter(
    [
      { path: '/vault', element },
      { path: '/unlock', element: <div>Unlock screen</div> },
      { path: '/login', element: <div>Login screen</div> },
    ],
    { initialEntries: ['/vault'] },
  )
  return render(<RouterProvider router={router} />)
}

function renderHeader(props: Record<string, unknown> = {}) {
  return renderHeaderWithSession(
    <SessionProvider>
      <Header {...props} />
    </SessionProvider>,
  )
}

/** Renders Header inside a SessionProvider with an active session so lock()
 *  actually calls POST /auth/lock. */
function renderHeaderWithSessionActive() {
  const router = createMemoryRouter(
    [
      { path: '/', element: (
        <SessionProvider>
          <HeaderWithLogin />
        </SessionProvider>
      ) },
      { path: '/unlock', element: <div>Unlock screen</div> },
      { path: '/login', element: <div>Login screen</div> },
    ],
    { initialEntries: ['/'] },
  )
  return render(<RouterProvider router={router} />)
}

function HeaderWithLogin() {
  const { login } = useSession()
  useEffect(() => {
    login('access-1', 'refresh-1', 900)
  }, [login])
  return <Header />
}

describe('Header', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the app name', () => {
    renderHeader({ appName: 'Acme Vault' })
    expect(screen.getByText('Acme Vault')).toBeTruthy()
  })

  it('falls back to the default app name', () => {
    renderHeader()
    expect(screen.getByText('Password Manager')).toBeTruthy()
  })

  it('exposes a lock button', () => {
    renderHeader()
    expect(screen.getByRole('button', { name: /lock vault/i })).toBeTruthy()
  })

  it('POSTs /auth/lock and navigates to /unlock when the lock button is clicked', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: 'locked' }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)

    renderHeaderWithSessionActive()
    await user.click(screen.getByRole('button', { name: /lock vault/i }))

    await waitFor(() => expect(screen.getByText('Unlock screen')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/auth/lock')
  })

  it('navigates to /unlock even when /auth/lock fails', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValueOnce(new TypeError('NetworkError')),
    )

    renderHeaderWithSessionActive()
    await user.click(screen.getByRole('button', { name: /lock vault/i }))

    await waitFor(() => expect(screen.getByText('Unlock screen')).toBeTruthy())
  })

  it('shows the user menu with the user name, Settings, and Sign out', () => {
    renderHeader({ userName: 'Ada Lovelace' })
    fireEvent.click(screen.getByRole('button', { name: 'Ada Lovelace' }))
    expect(screen.getByRole('link', { name: 'Settings' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })

  it('exposes the user dropdown as a disclosure, not a WAI-ARIA menu', () => {
    renderHeader({ userName: 'Ada Lovelace' })
    const toggle = screen.getByRole('button', { name: 'Ada Lovelace' })
    fireEvent.click(toggle)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByRole('menuitem')).toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.getAttribute('aria-controls')).toBe('user-menu')
  })

  it('navigates to /login when Sign out is clicked', async () => {
    const user = userEvent.setup()
    renderHeader({ userName: 'Ada Lovelace' })
    fireEvent.click(screen.getByRole('button', { name: 'Ada Lovelace' }))
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(screen.getByText('Login screen')).toBeTruthy()
  })
})
