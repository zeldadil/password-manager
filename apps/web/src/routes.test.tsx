import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { routes } from './routes'

function renderAt(initialPath: string) {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] })
  render(<RouterProvider router={router} />)
}

describe('route table', () => {
  it('defines the eight required screen paths', () => {
    const paths = new Set(routes.map((route) => route.path))
    for (const path of [
      '/login',
      '/unlock',
      '/vault',
      '/resources/:id',
      '/folders',
      '/tags',
      '/settings',
      '/generator',
    ]) {
      expect(paths.has(path)).toBe(true)
    }
  })
})

describe('route rendering', () => {
  it.each([
    ['Login', '/login'],
    ['Unlock', '/unlock'],
    ['Vault', '/vault'],
    ['Folders', '/folders'],
    ['Tags', '/tags'],
    ['Settings', '/settings'],
    ['Generator', '/generator'],
  ])('renders the %s screen at %s', (heading, path) => {
    renderAt(path)
    expect(screen.queryByRole('heading', { name: heading, level: 1 })).not.toBeNull()
  })

  it('renders the resource screen for a concrete id and exposes the id param', () => {
    renderAt('/resources/res-123')
    expect(screen.queryByRole('heading', { name: 'Resource', level: 1 })).not.toBeNull()
    expect(screen.queryByText('res-123')).not.toBeNull()
  })
})

describe('fallback navigation', () => {
  it('redirects the root path to /login', () => {
    renderAt('/')
    expect(screen.queryByRole('heading', { name: 'Login', level: 1 })).not.toBeNull()
  })

  it('redirects unknown paths to /login (fail closed)', () => {
    renderAt('/no/such/route')
    expect(screen.queryByRole('heading', { name: 'Login', level: 1 })).not.toBeNull()
  })
})
