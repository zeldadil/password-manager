import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App.tsx'

describe('App', () => {
  it('renders the application heading', () => {
    render(<App />)
    const heading = screen.getByRole('heading', { name: /password manager/i })
    expect(heading).toBeTruthy()
  })
})
