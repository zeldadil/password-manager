/** @license
 * Unit tests for LoginPage (FE-002a).
 *
 * Verifies the login form renders the two required inputs with the correct
 * autocomplete / type attributes, submits a POST to /auth/unlock with the
 * right payload shape, and navigates to /vault on a 200 response.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { routes } from '../routes'

function renderLogin() {
  const router = createMemoryRouter(routes, { initialEntries: ['/login'] })
  render(<RouterProvider router={router} />)
}

describe('LoginPage', () => {
  it('renders the heading and both required inputs', () => {
    renderLogin()

    expect(screen.getByRole('heading', { name: 'Login', level: 1 })).not.toBeNull()

    const emailInput = screen.getByLabelText('Email')
    expect(emailInput).not.toBeNull()
    expect(emailInput).toHaveAttribute('type', 'email')
    expect(emailInput).toHaveAttribute('autocomplete', 'username')

    const passwordInput = screen.getByLabelText('Master password')
    expect(passwordInput).not.toBeNull()
    expect(passwordInput).toHaveAttribute('type', 'password')
    expect(passwordInput).toHaveAttribute('autocomplete', 'off')
  })

  it('POSTs masterPassword + email to /auth/unlock and redirects to /vault on success', async () => {
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

    renderLogin()

    await user.type(screen.getByLabelText('Email'), 'user@example.test')
    await user.type(screen.getByLabelText('Master password'), 'login-test-master-password-001')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const [url, init] = fetchMock.mock.calls[0] as [RequestInfo, RequestInit]
    expect(url).toBe('/auth/unlock')
    const bodyStr = typeof init.body === 'string' ? init.body : JSON.stringify(init.body)
    expect(bodyStr).toContain('login-test-master-password-001')
    expect(bodyStr).toContain('user@example.test')

    expect(screen.getByRole('heading', { name: 'Vault', level: 1 })).not.toBeNull()
  })

  it('shows an error message when the server returns 401', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ message: 'Invalid credentials' }),
      } as unknown as Response),
    )

    renderLogin()

    await user.type(screen.getByLabelText('Email'), 'user@example.test')
    await user.type(screen.getByLabelText('Master password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Invalid credentials')
  })

  it('disables the submit button while loading', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 50))),
    )

    renderLogin()

    await user.type(screen.getByLabelText('Email'), 'user@example.test')
    await user.type(screen.getByLabelText('Master password'), 'login-test-master-password-001')
    const button = screen.getByRole('button', { name: 'Sign in' })
    expect(button).not.toBeDisabled()
    await user.click(button)
    expect(screen.getByRole('button', { name: 'Signing in...' })).toBeDisabled()
  })
})
