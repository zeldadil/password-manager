import { act, fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { routes } from '../routes'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const utils = render(<RouterProvider router={router} />)
  return { router, ...utils }
}

describe('accessibility baseline', () => {
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
  })
})
