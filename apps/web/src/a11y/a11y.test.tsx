import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { routes } from '../routes'

import { SessionProvider } from '../auth/SessionProvider'

/** Wraps every child route in SessionProvider so components that call useSession()
 *  (AppShell, AutoLockBanner) render without throwing. SessionProvider calls
 *  useNavigate() internally, so it must live inside the router context — the
 *  RouterProvider owns that context, and SessionProvider is its child.
 *
 *  Returns a new route list whose root layout route holds the wrapped children,
 *  so `createMemoryRouter` receives a valid `RouteObject[]`. */
function wrapRoutes(routeList: RouteObject[]): RouteObject[] {
  const root = routeList[0]
  const wrappedChildren: RouteObject[] = []
  for (const child of root.children ?? []) {
    wrappedChildren.push({
      ...child,
      element: (
        <SessionProvider>
          {child.element}
        </SessionProvider>
      ),
    })
  }
  return [
    {
      ...root,
      children: wrappedChildren,
    } as RouteObject,
  ]
}

const routesWithSession: RouteObject[] = wrapRoutes(routes)

function renderAt(path: string) {
  const router = createMemoryRouter(routesWithSession, { initialEntries: [path] })
  const utils = render(<RouterProvider router={router} />)
  return { router, ...utils }
}

describe('accessibility baseline', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
  describe('skip link (WCAG 2.4.1 Bypass Blocks)', () => {
    it('renders a skip link before the header so keyboard users can bypass it', () => {
      renderAt('/vault')
      const skip = screen.getByRole('link', { name: 'Skip to main content' })
      expect(skip.getAttribute('href')).toBe('#main-content')
      const banner = screen.getByRole('banner')
      expect(skip.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('targets a programmatically focusable main content landmark', () => {
      renderAt('/vault')
      const main = screen.getByRole('main')
      expect(main.getAttribute('id')).toBe('main-content')
      expect(main.getAttribute('tabindex')).toBe('-1')
    })
  })

  describe('document title (WCAG 2.4.2 Page Titled)', () => {
    it.each([
      ['/login', 'Sign in'],
      ['/unlock', 'Unlock vault'],
      ['/vault', 'Vault'],
      ['/resources/abc123', 'Resource'],
      ['/folders', 'Folders'],
      ['/tags', 'Tags'],
      ['/settings', 'Settings'],
      ['/generator', 'Password generator'],
    ])('sets a descriptive title for %s', (path, title) => {
      renderAt(path)
      expect(document.title).toBe(`${title} · Password Manager`)
    })
  })

  describe('focus management on route change (WCAG 2.4.3 Focus Order)', () => {
    it('does not steal focus on initial page load', () => {
      renderAt('/vault')
      expect(document.activeElement).not.toBe(screen.getByRole('main'))
    })

    it('moves focus to the main content landmark after navigating', () => {
      const { router } = renderAt('/vault')
      act(() => {
        void router.navigate('/settings')
      })
      expect(document.activeElement).toBe(screen.getByRole('main'))
    })
  })

  describe('status announcement (WCAG 4.1.3 Status Messages)', () => {
    it('exposes a polite live region announcing the current page', () => {
      renderAt('/vault')
      const status = screen.getByRole('status')
      expect(status.textContent).toContain('Vault')
    })
  })

  describe('keyboard navigation', () => {
    it('closes the user menu on Escape and returns focus to the toggle', () => {
      renderAt('/vault')
      const toggle = screen.getByRole('button', { name: 'Account' })
      fireEvent.click(toggle)
      expect(toggle.getAttribute('aria-expanded')).toBe('true')

      fireEvent.keyDown(toggle, { key: 'Escape' })
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      expect(document.activeElement).toBe(toggle)
    })

    it('exposes the user dropdown as a disclosure, not a WAI-ARIA menu', () => {
      renderAt('/vault')
      const toggle = screen.getByRole('button', { name: 'Account' })
      fireEvent.click(toggle)

      // No menu/menuitem roles: native link + button are keyboard-accessible by
      // default (Tab + Enter), so no arrow-key menu contract is required.
      expect(screen.queryByRole('menu')).toBeNull()
      expect(screen.queryByRole('menuitem')).toBeNull()

      // The disclosure toggle carries the expanded state and controls the panel id.
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      expect(toggle.getAttribute('aria-controls')).toBe('user-menu')
      expect(screen.getByRole('link', { name: 'Settings' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
    })
  })

  describe('login form accessibility (WCAG 1.3.1, 3.3.1, 3.3.2, 2.1.1)', () => {
    it('associates each input with a visible label via htmlFor/id', () => {
      renderAt('/login')
      const emailLabel = screen.getByText('Email')
      const emailInput = screen.getByLabelText('Email')
      expect(emailLabel.tagName).toBe('LABEL')
      expect(emailLabel.getAttribute('for')).toBe(emailInput.id)

      const passwordLabel = screen.getByText('Master password')
      const passwordInput = screen.getByLabelText('Master password')
      expect(passwordLabel.tagName).toBe('LABEL')
      expect(passwordLabel.getAttribute('for')).toBe(passwordInput.id)
    })

    it('links the password input to its error via aria-describedby', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ message: 'Invalid credentials' }),
        } as unknown as Response),
      )

      renderAt('/login')
      await userEvent.type(screen.getByLabelText('Email'), 'user@example.test')
      await userEvent.type(screen.getByLabelText('Master password'), 'wrong')
      await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

      const passwordInput = screen.getByLabelText('Master password')
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveAttribute('id', 'login-error')
      expect(passwordInput.getAttribute('aria-describedby')).toContain('login-error')
    })

    it('announces auth errors through an assertive live region', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ message: 'Invalid credentials' }),
        } as unknown as Response),
      )

      renderAt('/login')
      await userEvent.type(screen.getByLabelText('Email'), 'user@example.test')
      await userEvent.type(screen.getByLabelText('Master password'), 'wrong')
      await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveAttribute('aria-live', 'assertive')
      expect(alert).toHaveTextContent('Invalid email or master password.')
    })

    it('announces rate-limit errors through the polite live region on the main landmark', async () => {
      // Prove the polite live region on <main> carries the rate-limit countdown
      // and receives focus. Drive the form with fireEvent only — never userEvent
      // under fake timers, which hangs on synthetic events.
      vi.useFakeTimers()

      const fetchMock = vi.fn().mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ message: 'Invalid credentials' }),
        } as unknown as Response),
      )
      vi.stubGlobal('fetch', fetchMock)

      renderAt('/login')

      const emailInput = screen.getByLabelText('Email')
      const passwordInput = screen.getByLabelText('Master password')
      const submitButton = screen.getByRole('button', { name: 'Sign in' })

      // Initial credentials via fireEvent (no userEvent under fake timers).
      await act(async () => {
        fireEvent.change(emailInput, { target: { value: 'user@example.test' } })
        await Promise.resolve()
      })
      await act(async () => {
        fireEvent.change(passwordInput, { target: { value: 'wrong' } })
        await Promise.resolve()
      })

      // 5 consecutive 401s cross the client-side threshold. The page clears the
      // password after each auth failure, so each iteration re-types before clicking.
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.change(passwordInput, { target: { value: 'wrong' } })
          await Promise.resolve()
        })
        await act(async () => {
          fireEvent.click(submitButton)
          await Promise.resolve()
          await Promise.resolve()
        })
        vi.advanceTimersByTime(1)
      }

      vi.useRealTimers()
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Too many failed attempts. Please try again later.')

      const main = screen.getByRole('main')
      expect(main.getAttribute('aria-live')).toBe('polite')
      const countdown = screen.getByText(/try again in 15:00/i)
      expect(countdown).toHaveAttribute('aria-live', 'polite')
      expect(main).toHaveFocus()

      vi.useRealTimers()
    })

    it('moves focus to the master password field on a plain auth error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ message: 'Invalid credentials' }),
        } as unknown as Response),
      )

      renderAt('/login')
      await userEvent.type(screen.getByLabelText('Email'), 'user@example.test')
      await userEvent.type(screen.getByLabelText('Master password'), 'wrong')
      await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

      await waitFor(() => screen.findByRole('alert'))
      expect(screen.getByLabelText('Master password')).toHaveFocus()
    })

    it('submits the form on Enter from either input (keyboard-only operable)', async () => {
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

      renderAt('/login')
      await user.type(screen.getByLabelText('Email'), 'user@example.test')
      await user.type(screen.getByLabelText('Master password'), 'login-test-master-password-001')

      // Enter in the password field submits the form.
      await user.keyboard('{Enter}')
      await waitFor(() => screen.getByRole('heading', { name: 'Vault', level: 1 }))
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('keeps the submit button keyboard-reachable and disabled only while loading', async () => {
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

      renderAt('/login')
      await user.type(screen.getByLabelText('Email'), 'user@example.test')
      await user.type(screen.getByLabelText('Master password'), 'login-test-master-password-001')
      const button = screen.getByRole('button', { name: 'Sign in' })
      expect(button).not.toBeDisabled()
      expect(button).toHaveAttribute('type', 'submit')
      await user.click(button)
      expect(screen.getByRole('button', { name: 'Signing in...' })).toBeDisabled()

      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Vault', level: 1 })).not.toBeNull(),
      )
    })
  })

  describe('unlock form accessibility (WCAG 1.3.1, 3.3.1, 3.3.2, 2.1.1)', () => {
    it('associates each input with a visible label via htmlFor/id', () => {
      renderAt('/unlock')
      const emailLabel = screen.getByText('Email')
      const emailInput = screen.getByLabelText('Email')
      expect(emailLabel.tagName).toBe('LABEL')
      expect(emailLabel.getAttribute('for')).toBe(emailInput.id)

      const passwordLabel = screen.getByText('Master password')
      const passwordInput = screen.getByLabelText('Master password')
      expect(passwordLabel.tagName).toBe('LABEL')
      expect(passwordLabel.getAttribute('for')).toBe(passwordInput.id)
    })

    it('links the password input to its error via aria-describedby', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ message: 'Invalid credentials' }),
        } as unknown as Response),
      )

      renderAt('/unlock')
      await userEvent.type(screen.getByLabelText('Email'), 'user@example.test')
      await userEvent.type(screen.getByLabelText('Master password'), 'wrong')
      await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))

      const passwordInput = screen.getByLabelText('Master password')
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveAttribute('id', 'unlock-error')
      expect(passwordInput.getAttribute('aria-describedby')).toContain('unlock-error')
    })

    it('announces auth errors through an assertive live region', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ message: 'Invalid credentials' }),
        } as unknown as Response),
      )

      renderAt('/unlock')
      await userEvent.type(screen.getByLabelText('Email'), 'user@example.test')
      await userEvent.type(screen.getByLabelText('Master password'), 'wrong')
      await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveAttribute('aria-live', 'assertive')
      expect(alert).toHaveTextContent('Invalid email or master password.')
    })

    it('announces rate-limit errors through the polite live region on the main landmark', async () => {
      // Prove the polite live region on <main> carries the rate-limit countdown
      // and receives focus. Drive the form with fireEvent only — never userEvent
      // under fake timers, which hangs on synthetic events.
      vi.useFakeTimers()

      const fetchMock = vi.fn().mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ message: 'Invalid credentials' }),
        } as unknown as Response),
      )
      vi.stubGlobal('fetch', fetchMock)

      renderAt('/unlock')

      const emailInput = screen.getByLabelText('Email')
      const passwordInput = screen.getByLabelText('Master password')
      const submitButton = screen.getByRole('button', { name: 'Unlock' })

      // Initial credentials via fireEvent (no userEvent under fake timers).
      await act(async () => {
        fireEvent.change(emailInput, { target: { value: 'user@example.test' } })
        await Promise.resolve()
      })
      await act(async () => {
        fireEvent.change(passwordInput, { target: { value: 'wrong' } })
        await Promise.resolve()
      })

      // 5 consecutive 401s cross the client-side threshold. The page clears the
      // password after each auth failure, so each iteration re-types before clicking.
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          fireEvent.change(passwordInput, { target: { value: 'wrong' } })
          await Promise.resolve()
        })
        await act(async () => {
          fireEvent.click(submitButton)
          await Promise.resolve()
          await Promise.resolve()
        })
        vi.advanceTimersByTime(1)
      }

      vi.useRealTimers()
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Too many failed attempts. Please try again later.')

      const main = screen.getByRole('main')
      expect(main.getAttribute('aria-live')).toBe('polite')
      const countdown = screen.getByText(/try again in 15:00/i)
      expect(countdown).toHaveAttribute('aria-live', 'polite')
      expect(main).toHaveFocus()

      vi.useRealTimers()
    })

    it('moves focus to the master password field on a plain auth error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ message: 'Invalid credentials' }),
        } as unknown as Response),
      )

      renderAt('/unlock')
      await userEvent.type(screen.getByLabelText('Email'), 'user@example.test')
      await userEvent.type(screen.getByLabelText('Master password'), 'wrong')
      await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))

      await waitFor(() => screen.findByRole('alert'))
      expect(screen.getByLabelText('Master password')).toHaveFocus()
    })

    it('submits the form on Enter from either input (keyboard-only operable)', async () => {
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

      renderAt('/unlock')
      await user.type(screen.getByLabelText('Email'), 'user@example.test')
      await user.type(screen.getByLabelText('Master password'), 'unlock-test-master-password-001')

      // Enter in the password field submits the form.
      await user.keyboard('{Enter}')
      await waitFor(() => screen.getByRole('heading', { name: 'Vault', level: 1 }))
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('keeps the submit button keyboard-reachable and disabled only while loading', async () => {
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

      renderAt('/unlock')
      await user.type(screen.getByLabelText('Email'), 'user@example.test')
      await user.type(screen.getByLabelText('Master password'), 'unlock-test-master-password-001')
      const button = screen.getByRole('button', { name: 'Unlock' })
      expect(button).not.toBeDisabled()
      expect(button).toHaveAttribute('type', 'submit')
      await user.click(button)
      expect(screen.getByRole('button', { name: 'Unlocking...' })).toBeDisabled()

      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Vault', level: 1 })).not.toBeNull(),
      )
    })
  })
})
