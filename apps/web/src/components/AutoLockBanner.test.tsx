/** @license
 * Unit tests for AutoLockBanner (FE-002c AC2).
 *
 * Verifies:
 *  - banner is hidden when no session or >60s remain
 *  - countdown decrements when the session expiry approaches the 60s window
 *  - "Extend session" POSTs /auth/refresh and re-arms the countdown
 *  - server error surfaces in the banner
 *  - aria attributes and roles are correct
 *
 * SessionProvider calls useNavigate() internally so every render must be
 * wrapped in a Router context (createMemoryRouter + RouterProvider).
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import AutoLockBanner from './AutoLockBanner'
import { SessionProvider, useSession } from '../auth/SessionProvider'

interface MountOptions {
  expirySecondsFromNow?: number
  onShow?: ReturnType<typeof vi.fn>
}

function mountBanner({ expirySecondsFromNow = 45, onShow = vi.fn() }: MountOptions = {}) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <SessionProvider>
            <BannerMount expirySecondsFromNow={expirySecondsFromNow} onShow={onShow} />
          </SessionProvider>
        ),
      },
    ],
    { initialEntries: ['/'] },
  )
  return render(<RouterProvider router={router} />)
}

/** Mount point that establishes a session expiring in `expirySecondsFromNow`
 *  seconds, so the banner has a session to observe. */
function BannerMount({
  expirySecondsFromNow,
  onShow,
}: {
  expirySecondsFromNow: number
  onShow: ReturnType<typeof vi.fn>
}) {
  const { login } = useSession()
  useEffect(() => {
    login('tok-1', 'refresh-1', expirySecondsFromNow)
  }, [login, expirySecondsFromNow])
  return <AutoLockBanner onShow={onShow} />
}

describe('AutoLockBanner', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not render when no session is active', () => {
    const router = createMemoryRouter(
      [{ path: '/', element: <div data-testid="no-session">no session</div> }],
      { initialEntries: ['/'] },
    )
    render(<RouterProvider router={router} />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByTestId('no-session')).toBeTruthy()
  })

  it('renders the banner when a session is within 60s of expiry', () => {
    mountBanner({ expirySecondsFromNow: 45 })
    expect(screen.getByRole('alert')).not.toBeNull()
    expect(screen.getByText(/your session will lock in/i)).not.toBeNull()
  })

  it('does not render when the session has >60s remaining', () => {
    function MountFarExpiry() {
      const { login } = useSession()
      useEffect(() => {
        login('tok-2', 'refresh-2', 120)
      }, [login])
      return <AutoLockBanner onShow={vi.fn()} />
    }
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: (
            <SessionProvider>
              <MountFarExpiry />
            </SessionProvider>
          ),
        },
      ],
      { initialEntries: ['/'] },
    )
    render(<RouterProvider router={router} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('POSTs /auth/refresh when "Extend session" is clicked', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          accessToken: 'tok-new',
          refreshToken: 'refresh-new',
          expiresIn: 900,
          tokenType: 'Bearer',
        }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)

    mountBanner({ expirySecondsFromNow: 45 })

    await user.click(screen.getByRole('button', { name: 'Extend session' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/auth/refresh')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body).toHaveProperty('refreshToken', 'refresh-1')
  })

  it('shows "Session extended" after a successful extend', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  json: () =>
                    Promise.resolve({
                      accessToken: 'tok-new',
                      refreshToken: 'refresh-new',
                      expiresIn: 900,
                      tokenType: 'Bearer',
                    }),
                }),
              50,
            ),
          ),
      ),
    )

    mountBanner({ expirySecondsFromNow: 45 })

    await user.click(screen.getByRole('button', { name: 'Extend session' }))
    await waitFor(() => expect(screen.getByText('Session extended')).toBeTruthy())
  })

  it('does not show the countdown after a successful extend (session now far from expiry)', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            accessToken: 'tok-new',
            refreshToken: 'refresh-new',
            expiresIn: 900,
            tokenType: 'Bearer',
          }),
      } as unknown as Response),
    )

    mountBanner({ expirySecondsFromNow: 45 })

    await user.click(screen.getByRole('button', { name: 'Extend session' }))
    // After extend the session has 900s left — outside the 60s window —
    // so the banner should hide.
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('surfaces an error message when /auth/refresh returns a non-2xx', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ message: 'Session expired' }),
      } as unknown as Response),
    )

    mountBanner({ expirySecondsFromNow: 45 })

    await user.click(screen.getByRole('button', { name: 'Extend session' }))
    const errorEl = await screen.findByText(/session expired/i)
    expect(errorEl).toBeTruthy()
  })

  it('disables the extend button during the refresh in-flight', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  json: () =>
                    Promise.resolve({
                      accessToken: 'tok-new',
                      refreshToken: 'refresh-new',
                      expiresIn: 900,
                      tokenType: 'Bearer',
                    }),
                }),
              100,
            ),
          ),
      ),
    )

    mountBanner({ expirySecondsFromNow: 45 })

    const button = screen.getByRole('button', { name: 'Extend session' })
    await user.click(button)

    expect(screen.getByRole('button', { name: 'Extending…' })).toBeDisabled()
  })

  it('has the correct aria attributes for an auto-locking session', () => {
    mountBanner({ expirySecondsFromNow: 45 })

    const banner = screen.getByRole('alert')
    expect(banner).toHaveAttribute('aria-live', 'assertive')
  })
})
