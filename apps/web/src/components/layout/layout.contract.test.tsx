import { fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import AppShell from './AppShell'
import FolderTree from './FolderTree'
import Header from './Header'
import Sidebar from './Sidebar'
import TagsList from './TagsList'
import type { FolderNode, TagNode } from './types'

/**
 * Layout component contract tests (FE-001i).
 *
 * FE-001c/FE-001e cover what the layout renders. These tests pin the wiring the
 * layout promises its callers and the accessibility baseline: the skip-link
 * target, landmark order, sidebar sections labelled by their headings, and the
 * header's default navigation for lock/sign-out/settings.
 */

const folders: FolderNode[] = [
  { id: 'work', name: 'Work', parentId: null },
  { id: 'engineering', name: 'Engineering', parentId: 'work' },
  { id: 'platform', name: 'Platform', parentId: 'engineering' },
  { id: 'personal', name: 'Personal', parentId: null },
]

const tags: TagNode[] = [
  { id: 't1', name: 'Production' },
  { id: 't2', name: 'Staging' },
]

function renderHeader(props: Record<string, unknown> = {}) {
  const router = createMemoryRouter(
    [
      { path: '/vault', element: <Header {...props} /> },
      { path: '/settings', element: <div>Settings screen</div> },
      { path: '/login', element: <div>Login screen</div> },
      { path: '/unlock', element: <div>Unlock screen</div> },
    ],
    { initialEntries: ['/vault'] },
  )
  render(<RouterProvider router={router} />)
  return router
}

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
  return router
}

describe('Header — navigation and disclosure wiring', () => {
  it('links the brand back to the vault', () => {
    renderHeader({ appName: 'Acme Vault' })

    const brand = screen.getByRole('link', { name: 'Acme Vault' })
    expect(brand.getAttribute('href')).toBe('/vault')
  })

  it('starts with the user menu collapsed and not referencing a panel', () => {
    renderHeader()

    const toggle = screen.getByRole('button', { name: 'Account' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.hasAttribute('aria-controls')).toBe(false)
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull()
  })

  it('navigates to /settings from the menu and closes it', () => {
    renderHeader({ userName: 'Ada Lovelace' })

    const toggle = screen.getByRole('button', { name: 'Ada Lovelace' })
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('link', { name: 'Settings' }))

    expect(screen.getByText('Settings screen')).toBeTruthy()
  })

  it('navigates to /login on sign out when no handler is supplied', () => {
    renderHeader({ userName: 'Ada Lovelace' })

    fireEvent.click(screen.getByRole('button', { name: 'Ada Lovelace' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(screen.getByText('Login screen')).toBeTruthy()
  })
})

describe('AppShell — shell contract', () => {
  it('exposes the main landmark as the skip-link target', () => {
    renderShell()

    const main = screen.getByRole('main')
    expect(main.getAttribute('id')).toBe('main-content')
    expect(main.getAttribute('tabindex')).toBe('-1')
  })

  it('orders header, sidebar, then main content', () => {
    renderShell()

    const header = screen.getByRole('banner')
    const sidebar = screen.getByRole('complementary')
    const main = screen.getByRole('main')

    expect(header.compareDocumentPosition(sidebar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(sidebar.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('passes folders and tags through to the sidebar', () => {
    renderShell({ folders, tags })

    const sidebar = screen.getByRole('complementary')
    expect(within(sidebar).getByText('Work')).toBeTruthy()
    expect(within(sidebar).getByText('Platform')).toBeTruthy()
    expect(within(sidebar).getByText('Production')).toBeTruthy()
  })
})

describe('Sidebar — labelled sections', () => {
  it('labels each section by its heading', () => {
    render(<Sidebar folders={folders} tags={tags} />)

    const foldersNav = screen.getByRole('navigation', { name: 'Folders' })
    const tagsNav = screen.getByRole('navigation', { name: 'Tags' })

    expect(within(foldersNav).getByText('Engineering')).toBeTruthy()
    expect(within(tagsNav).getByText('Staging')).toBeTruthy()
    expect(within(foldersNav).queryByText('Staging')).toBeNull()
    expect(within(tagsNav).queryByText('Engineering')).toBeNull()
  })

  it('renders empty sections without stray lists', () => {
    const { container } = render(<Sidebar />)

    expect(screen.getByRole('heading', { name: 'Folders' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Tags' })).toBeTruthy()
    expect(container.querySelectorAll('ul')).toHaveLength(0)
  })
})

describe('FolderTree — hierarchy', () => {
  it('renders three levels of nesting', () => {
    render(<FolderTree folders={folders} />)

    // Work → Engineering → Platform
    const work = screen.getByText('Work').closest('li') as HTMLElement
    const engineering = within(work).getByText('Engineering').closest('li') as HTMLElement
    const platform = within(engineering).getByText('Platform') as HTMLElement

    // Platform lives in a nested list below Engineering, not next to it.
    expect(platform.closest('ul')?.parentElement).toBe(engineering)
    // A sibling root folder never leaks into the Work subtree.
    expect(within(work).queryByText('Personal')).toBeNull()
  })

  it('keeps root folders in input order', () => {
    const { container } = render(<FolderTree folders={folders} />)

    const rootNames = Array.from((container.querySelector('ul') as HTMLElement).children).map(
      (li) => li.querySelector('span')?.textContent,
    )
    expect(rootNames).toEqual(['Work', 'Personal'])
  })
})

describe('TagsList — flat list', () => {
  it('renders one list item per tag, in input order', () => {
    const { container } = render(<TagsList tags={tags} />)

    const items = Array.from(container.querySelectorAll('li')).map((node) => node.textContent)
    expect(items).toEqual(['Production', 'Staging'])
  })
})
