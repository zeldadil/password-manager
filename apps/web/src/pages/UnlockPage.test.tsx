/** @license
 * Unit tests for UnlockPage (FE-002b).
 *
 * Verifies the unlock form renders the master password input with the correct
 * autocomplete / type attributes, submits a POST to /auth/unlock with the
 * right payload shape, and navigates to /vault on a 200 response.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { routes } from '../routes'

function renderUnlock() {
  const router = createMemoryRouter(routes, { initialEntries: ['/unlock'] })
  render(<RouterProvider router={router} />)
}

describe('UnlockPage', () => {
  it('renders the heading, subtitle, and both required inputs', () => {
    renderUnlock()

    expect(screen.getByRole('heading', { name: 'Unlock', level: 1 })).not.toBeNull()

    const subtitle = screen.getByText('Vault locked — enter master password to unlock')
    expect(subtitle).not.toBeNull()

    const emailInput = screen.getByLabelText('Email')
    expect(emailInput).not.toBeNull()
    expect(emailInput).toHaveAttribute('type', 'email')

    const passwordInput = screen.getByLabelText('Master password')
    expect(passwordInput).not.toBeNull()
    expect(passwordInput).toHaveAttribute('type', 'password')
    expect(passwordInput).toHaveAttribute('autocomplete', 'off')
  })

  it('POSTs email + masterPassword to /auth/unlock and redirects to /vault on success', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          accessToken: 'tok',
          refreshToken: 'ref',
          expiresIn: 900,
          tokenType: 'Bearer',
        }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)

    renderUnlock()

    await user.type(screen.getByLabelText('Email'), 'user@example.test')
    await user.type(screen.getByLabelText('Master password'), 'unlock-test-master-password-001')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const [url, init] = fetchMock.mock.calls[0] as [RequestInfo, RequestInit]
    expect(url).toBe('/auth/unlock')
    const bodyStr = typeof init.body === 'string' ? init.body : JSON.stringify(init.body)
    expect(bodyStr).toContain('masterPassword')
    expect(bodyStr).toContain('unlock-test-master-password-001')
    // The real POST /auth/unlock endpoint requires email or username to
    // identify the user (it 400s otherwise — see apps/services/api/src/
    // auth/unlock.ts) — unlike LoginPage vs UnlockPage's original design
    // intent, a bare { masterPassword } body cannot succeed against the
    // actual backend contract, so email is required here too.
    expect(bodyStr).toContain('email')

    expect(screen.getByRole('heading', { name: 'Vault', level: 1 })).not.toBeNull()
  })

  it('shows an error message when the server returns 401', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ message: 'Invalid master password' }),
      } as unknown as Response),
    )

    renderUnlock()

    await user.type(screen.getByLabelText('Email'), 'user@example.test')
    await user.type(screen.getByLabelText('Master password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Invalid master password')
  })

  it('disables the submit button while loading', async () => {
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
                      accessToken: 'tok',
                      refreshToken: 'ref',
                      expiresIn: 900,
                      tokenType: 'Bearer',
                    }),
                } as unknown as Response),
              50,
            ),
          ),
      ),
    )

    renderUnlock()

    await user.type(screen.getByLabelText('Email'), 'user@example.test')
    await user.type(screen.getByLabelText('Master password'), 'unlock-test-master-password-001')
    const button = screen.getByRole('button', { name: 'Unlock' })
    expect(button).not.toBeDisabled()
    await user.click(button)
    expect(screen.getByRole('button', { name: 'Unlocking...' })).toBeDisabled()

    // Wait for the deliberately-delayed fetch to settle before the test ends —
    // otherwise the pending setLoading(false) in UnlockPage's `finally` block
    // fires after this test (and its jsdom environment) has been torn down,
    // throwing "window is not defined" as an unhandled rejection (same class
    // of bug fixed for LoginPage.test.tsx).
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Vault', level: 1 })).not.toBeNull(),
    )
  })
})
