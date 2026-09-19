import { fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import Header from './Header'

function renderHeader(props: Record<string, unknown> = {}) {
  const router = createMemoryRouter(
    [
      { path: '/vault', element: <Header {...props} /> },
      { path: '/unlock', element: <div>Unlock screen</div> },
    ],
    { initialEntries: ['/vault'] },
  )
  render(<RouterProvider router={router} />)
  return router
}

describe('Header', () => {
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

  it('invokes onLock when the lock button is clicked', () => {
    const onLock = vi.fn()
    renderHeader({ onLock })
    fireEvent.click(screen.getByRole('button', { name: /lock vault/i }))
    expect(onLock).toHaveBeenCalledTimes(1)
  })

  it('navigates to /unlock when locked without an onLock handler', () => {
    renderHeader()
    fireEvent.click(screen.getByRole('button', { name: /lock vault/i }))
    expect(screen.getByText('Unlock screen')).toBeTruthy()
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

  it('invokes onSignOut when Sign out is clicked', () => {
    const onSignOut = vi.fn()
    renderHeader({ userName: 'Ada Lovelace', onSignOut })
    fireEvent.click(screen.getByRole('button', { name: 'Ada Lovelace' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })
})
