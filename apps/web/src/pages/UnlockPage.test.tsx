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
import UnlockPage from './UnlockPage'
import { routes } from '../routes'

function renderUnlock() {
  const router = createMemoryRouter(routes, { initialEntries: ['/unlock'] })
  render(<RouterProvider router={router} />)
}

describe('UnlockPage', () => {
  it('renders the heading, subtitle, and master password input', () => {
    renderUnlock()

    expect(screen.getByRole('heading', { name: 'Unlock', level: 1 })).not.toBeNull()

    const subtitle = screen.getByText('Vault locked — enter master password to unlock')
    expect(subtitle).not.toBeNull()

    const passwordInput = screen.getByLabelText('Master password')
    expect(passwordInput).not.toBeNull()
    expect(passwordInput).toHaveAttribute('type', 'password')
    expect(passwordInput).toHaveAttribute('autocomplete', 'off')
  })

  it('POSTs masterPassword to /auth/unlock and redirects to /vault on success', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ accessToken: 'tok', refreshToken: 'ref', expiresIn: 900, tokenType: 'Bearer' }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)

    renderUnlock()

    await user.type(screen.getByLabelText('Master password'), 'correct-horse-battery-staple')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const [url, init] = fetchMock.mock.calls[0] as [RequestInfo, RequestInit]
    expect(url).toBe('/auth/unlock')
    const bodyStr = typeof init.body === 'string' ? init.body : JSON.stringify(init.body)
    expect(bodyStr).toContain('masterPassword')
    expect(bodyStr).toContain('correct-horse-battery-staple')
    // Does NOT contain email — unlock is for an already-authenticated session
    expect(bodyStr).not.toContain('email')

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

    await user.type(screen.getByLabelText('Master password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Invalid master password')
  })

  it('disables the submit button while loading', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 50))),
    )

    renderUnlock()

    await user.type(screen.getByLabelText('Master password'), 'correct-horse-battery-staple')
    const button = screen.getByRole('button', { name: 'Unlock' })
    expect(button).not.toBeDisabled()
    await user.click(button)
    expect(screen.getByRole('button', { name: 'Unlocking...' })).toBeDisabled()
  })
})
