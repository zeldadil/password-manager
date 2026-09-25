import { render, screen, fireEvent } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import AppShell from './AppShell'
import { SessionProvider } from '../../auth/SessionProvider'
import type { FolderNode, TagNode } from './types'

const folders: FolderNode[] = [
  { id: 'work', name: 'Work', parentId: null },
  { id: 'eng', name: 'Engineering', parentId: 'work' },
]

const tags: TagNode[] = [
  { id: 't1', name: 'Production' },
  { id: 't2', name: 'Staging' },
]

function renderShell(props: Record<string, unknown> = {}) {
  const router = createMemoryRouter(
    [
      {
        element: (
          <SessionProvider>
            <AppShell {...props} />
          </SessionProvider>
        ),
        children: [{ path: '/vault', element: <div>Vault content</div> }],
      },
    ],
    { initialEntries: ['/vault'] },
  )
  return render(<RouterProvider router={router} />)
}

describe('AppShell — shell contract', () => {
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

  it('passes folders and tags through to the sidebar', () => {
    renderShell({ folders, tags })
    expect(screen.getByText('Work')).toBeTruthy()
    expect(screen.getByText('Production')).toBeTruthy()
    // Engineering hidden until expanded
    expect(screen.queryByText('Engineering')).toBeNull()
  })

  it('expands folder in sidebar when toggle clicked', () => {
    renderShell({ folders, tags })
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))
    expect(screen.getByText('Engineering')).toBeTruthy()
  })
})
