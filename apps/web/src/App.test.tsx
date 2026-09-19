import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App.tsx'

/**
 * Entry-point smoke test (FE-001i).
 *
 * `App` mounts the router built from `routes.tsx`, so the app's observable first
 * paint on an unauthenticated path is whatever the route guards resolve to — the
 * sign-in screen, not a standalone scaffold heading. (FE-001h's original version
 * of this test asserted the scaffold heading; the router from FE-001b supersedes
 * it once both stacks are integrated.)
 */
describe('App', () => {
  it('mounts the app router and fails closed to the sign-in screen', () => {
    render(<App />)

    expect(screen.getByRole('heading', { level: 1, name: 'Login' })).toBeTruthy()
  })
})
