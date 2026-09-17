import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import AppShell from './AppShell'
import type { FolderNode, TagNode } from './types'

const folders: FolderNode[] = [
  { id: 'work', name: 'Work', parentId: null },
]

const tags: TagNode[] = [{ id: 't1', name: 'Production' }]

function renderShell(props: Record<string, unknown> = {}) {
  const router = createMemoryRouter(
    [
      {
        element: <AppShell {...props} />,
        children: [{ path: '/vault', element: <div>Vault content</div> }],
      },
    ],
    { initialEntries: ['/vault'] },
  )
  render(<RouterProvider router={router} />)
}

describe('AppShell', () => {
  it('renders a persistent header', () => {
    renderShell({ userName: 'Ada Lovelace' })
    expect(screen.getByRole('banner')).toBeTruthy()
    expect(screen.getByText('Password Manager')).toBeTruthy()
    expect(screen.getByRole('button', { name: /lock vault/i })).toBeTruthy()
  })

  it('renders the sidebar with folder tree and tags list', () => {
    renderShell({ folders, tags })
    expect(screen.getByRole('complementary')).toBeTruthy()
    expect(screen.getByText('Work')).toBeTruthy()
    expect(screen.getByText('Production')).toBeTruthy()
  })

  it('renders the main content area with the routed page', () => {
    renderShell()
    expect(screen.getByRole('main')).toBeTruthy()
    expect(screen.getByText('Vault content')).toBeTruthy()
  })
})
