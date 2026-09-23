import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import Header from './Header'
import { SessionProvider } from '../../auth/SessionProvider'

function renderHeader(props: Record<string, unknown> = {}) {
  const router = createMemoryRouter(
    [
      { path: '/vault', element: <Header {...props} /> },
      { path: '/unlock', element: <div>Unlock screen</div> },
      { path: '/login', element: <div>Login screen</div> },
    ],
    { initialEntries: ['/vault'] },
  )
  render(
    <SessionProvider>
      <RouterProvider router={router} />
    </SessionProvider>,
  )
  return router
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

    renderHeader()
    await user.click(screen.getByRole('button', { name: /lock vault/i }))

    await waitFor(() => expect(screen.getByText('Unlock screen')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledWith(
      '/auth/lock',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer ***',
        }),
      }),
    )
  })

  it('navigates to /unlock even when /auth/lock fails', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValueOnce(new TypeError('NetworkError')),
    )

    renderHeader()
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
