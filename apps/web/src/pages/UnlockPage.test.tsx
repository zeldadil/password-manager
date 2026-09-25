/** @license
 * Unit tests for UnlockPage (FE-002b + FE-002d).
 *
 * Verifies the unlock form renders the master password input with the correct
 * autocomplete / type attributes, submits a POST to /auth/unlock with the
 * right payload shape, and navigates to /vault on a 200 response.
 *
 * FE-002d additions — error states + no-leakage:
 *   - Generic error message on 401 (never echoes the server payload)
 *   - Rate-limit countdown after 5 consecutive failed attempts
 *   - Network error with a retry affordance
 *   - Master password cleared from state after auth failures
 */

import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { routes } from '../routes'
import { SessionProvider } from '../auth/SessionProvider'
import { createQueryClient } from '../queryClient'

/** Wraps every child route element in SessionProvider so that navigating to
 *  /vault (after a successful unlock) renders AppShell without throwing.
 *  SessionProvider calls useNavigate() internally, so it must be inside the
 *  RouterProvider context — we wrap each child's element, not the provider. */
function wrapRoutes(routeList: RouteObject[]): RouteObject[] {
  const root = routeList[0]
  return [
    {
      ...root,
      children: root.children?.map((child) => ({
        ...child,
        element: <SessionProvider>{child.element}</SessionProvider>,
      })),
    },
  ] as RouteObject[]
}

const routesWithSession: RouteObject[] = wrapRoutes(routes)

function renderUnlock() {
  const router = createMemoryRouter(routesWithSession, { initialEntries: ['/unlock'] })
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
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

    // At least the /auth/unlock call — VaultPage may also fire its own
    // resources fetch once the session becomes active post-unlock, so the
    // total call count is no longer exactly 1.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const unlockCall = fetchMock.mock.calls.find(([url]) => url === '/auth/unlock')
    expect(unlockCall).toBeDefined()
    const [url, init] = unlockCall as [RequestInfo, RequestInit]
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

  it('shows a generic error message on 401 (never echoes the server payload)', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ message: 'Invalid master password' }),
      } as unknown as Response),
    )

    renderUnlock()

    await user.type(screen.getByLabelText('Email'), 'user@example.test')
    await user.type(screen.getByLabelText('Master password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    const alert = await screen.findByRole('alert')
    // Generic frontend message — never echoes the server payload, never
    // hints at whether the email address exists.
    expect(alert).toHaveTextContent('Invalid email or master password.')
    expect(alert).not.toHaveTextContent('Invalid master password')
  })

  it('clears the master password from state after a 401 response', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ message: 'Invalid master password' }),
      } as unknown as Response),
    )

    renderUnlock()

    await user.type(screen.getByLabelText('Email'), 'user@example.test')
    await user.type(screen.getByLabelText('Master password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    await waitFor(() => screen.findByRole('alert'))

    // Security: the master password must not linger in React state after an
    // auth failure — it is cleared so it cannot be captured by browser
    // autofill, saved-state snapshots, or JS heap inspection.
    const passwordInput = screen.getByLabelText('Master password')
    expect(passwordInput).toHaveValue('')
  })

  it('shows a retry button on network error', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Network error')))

    renderUnlock()

    await user.type(screen.getByLabelText('Email'), 'user@example.test')
    await user.type(screen.getByLabelText('Master password'), 'test-password')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Network error — please try again')
    // Network errors keep the master password in state so the retry path can
    // resubmit with the same credentials without forcing the user to retype
    // (see FE-002d discussion). The retry button below reuses the running
    // handler, so it never needs to read the input value directly.
    const passwordInput = screen.getByLabelText('Master password')
    expect(passwordInput).toHaveValue('test-password')
    const retryButton = await screen.findByRole('button', { name: 'Retry' })
    expect(retryButton).not.toBeDisabled()
    // The submit button is disabled during a network error to prevent
    // accidental re-submission; the Retry button is the intended way forward.
    const submitButton = screen.getByRole('button', { name: 'Unlock' })
    expect(submitButton).toBeDisabled()
  })

  it('keeps the master password in state after a network error so the retry path can resubmit', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Network error')))

    renderUnlock()

    await user.type(screen.getByLabelText('Email'), 'user@example.test')
    await user.type(screen.getByLabelText('Master password'), 'test-password')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    await waitFor(() => screen.findByRole('alert'))

    // Network errors are retryable — we intentionally keep the master password
    // in state so the retry affordance can resubmit without forcing the user to
    // retype. This diverges from the 401 path, which clears because those
    // credentials are demonstrably wrong.
    const passwordInput = screen.getByLabelText('Master password')
    expect(passwordInput).toHaveValue('test-password')
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

  it('shows a rate-limit countdown after 5 consecutive failed attempts', async () => {
    vi.useFakeTimers()

    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ message: 'Invalid master password' }),
      } as unknown as Response),
    )
    vi.stubGlobal('fetch', fetchMock)

    renderUnlock()

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Email'), {
        target: { value: 'user@example.test' },
      })
      fireEvent.change(screen.getByLabelText('Master password'), {
        target: { value: 'wrong-password' },
      })
      await Promise.resolve()
    })

    // 5 consecutive 401s cross the client-side threshold that mirrors the
    // backend's BE-002e/BE-002f lockout (5 attempts → 15 min).
    //
    // React 18 batches setState calls.  We must split the change and the
    // click into separate act() blocks so the password state commits BEFORE
    // handleSubmit reads it.  A third act() drains the fetch microtask.
    const passwordInput = screen.getByLabelText('Master password')
    const submitButton = screen.getByRole('button', { name: 'Unlock' })
    for (let i = 0; i < 5; i++) {
      // Step 1: commit the password re-type (page cleared it after last attempt).
      await act(async () => {
        fireEvent.change(passwordInput, { target: { value: 'wrong-password' } })
        await Promise.resolve()
      })
      // Step 2: submit — handleSubmit runs, awaits fetch, then sets state.
      await act(async () => {
        fireEvent.click(submitButton)
        // Drain the fetch continuation + setState from handleSubmit.
        await Promise.resolve()
        await Promise.resolve()
      })
      vi.advanceTimersByTime(1)
    }

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Too many failed attempts. Please try again later.')

    const countdown = screen.getByText(/try again in \d+:\d+/i)
    expect(countdown).not.toBeNull()

    // During the countdown the entire form is disabled.
    const submitButtonAfter = screen.getByRole('button', { name: 'Unlock' })
    expect(submitButtonAfter).toBeDisabled()
    expect(screen.getByLabelText('Email')).toBeDisabled()
    expect(screen.getByLabelText('Master password')).toBeDisabled()

    vi.useRealTimers()
  })

  it('decrements the countdown and re-enables the form when it expires', async () => {
    vi.useFakeTimers()

    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ message: 'Invalid master password' }),
      } as unknown as Response),
    )
    vi.stubGlobal('fetch', fetchMock)

    renderUnlock()

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Email'), {
        target: { value: 'user@example.test' },
      })
      fireEvent.change(screen.getByLabelText('Master password'), {
        target: { value: 'wrong-password' },
      })
      await Promise.resolve()
    })

    // Re-type before each click — the page clears masterPassword after each
    // 401, so only the first click (with the value typed above) submits;
    // subsequent clicks would bail out early without re-typing.
    for (let i = 0; i < 5; i++) {
      // Step 1: re-type the password (page cleared it after last attempt).
      await act(async () => {
        fireEvent.change(screen.getByLabelText('Master password'), {
          target: { value: 'wrong-password' },
        })
        await Promise.resolve()
      })
      // Step 2: submit — handleSubmit runs, awaits fetch, then sets state.
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
        // Drain the fetch microtask + the setState inside handleSubmit.
        await Promise.resolve()
        await Promise.resolve()
      })
      vi.advanceTimersByTime(1)
    }

    // Initial countdown reads 15:00 (900 s).
    expect(screen.getByText(/try again in 15:00/i)).not.toBeNull()

    // Advance 1 s → 14:59.  `act` commits the interval tick's setState to the
    // DOM; the two Promise.resolve calls drain the microtask queue React
    // schedules for the re-render so the synchronous `getByText` below sees it.
    act(() => {
      vi.advanceTimersByTime(1000)
      Promise.resolve().then(() => Promise.resolve())
    })
    expect(screen.getByText(/try again in 14:59/i)).not.toBeNull()

    // Advance the remaining 14 min 58 s → 0:01.  This advances the fake clock
    // past many interval ticks at once — `vi.advanceTimersByTime` fires every
    // queued timer ≤ the advanced amount, so all intermediate countdown
    // decrements are processed in one `act` call.
    act(() => {
      vi.advanceTimersByTime(14 * 60 * 1000 + 58 * 1000)
      Promise.resolve().then(() => Promise.resolve())
    })
    expect(screen.getByText(/try again in 0:01/i)).not.toBeNull()

    // Final second — countdown expires, error clears, form re-enables.
    act(() => {
      vi.advanceTimersByTime(1000)
      Promise.resolve().then(() => Promise.resolve())
    })
    expect(screen.queryByText(/try again in/i)).toBeNull()

    // After lockout expiry the inputs re-enable (the form is usable again),
    // but the submit button stays disabled because masterPassword was cleared
    // during the failed attempts and must be re-entered.
    expect(screen.getByLabelText('Email')).not.toBeDisabled()
    expect(screen.getByLabelText('Master password')).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeDisabled()
    expect(screen.getByLabelText('Master password')).toHaveValue('')

    vi.useRealTimers()
  })
})
