import { render, screen, within, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FolderTree from './FolderTree'
import type { FolderNode } from './types'

const sample: FolderNode[] = [
  { id: 'work', name: 'Work', parentId: null },
  { id: 'engineering', name: 'Engineering', parentId: 'work' },
  { id: 'finance', name: 'Finance', parentId: 'work' },
  { id: 'personal', name: 'Personal', parentId: null },
]

// Minimal fake client — only the shape FolderTree consumes.
const fakeClient = {
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
}

describe('FolderTree', () => {
  it('renders every root-level folder', () => {
    render(<FolderTree folders={sample} client={fakeClient as any} vaultId="v1" />)
    expect(screen.getByText('Work')).toBeTruthy()
    expect(screen.getByText('Personal')).toBeTruthy()
  })

  it('nests child folders under their parent when expanded', () => {
    render(<FolderTree folders={sample} client={fakeClient as any} vaultId="v1" />)
    // Expand Work to reveal children
    const workRow = screen.getByText('Work').closest('li') as HTMLElement
    const toggle = workRow.querySelector('.folder-tree__toggle') as HTMLElement
    fireEvent.click(toggle)
    const workItem = screen.getByText('Work').closest('li') as HTMLElement
    const withinWork = within(workItem)
    expect(withinWork.getByText('Engineering')).toBeTruthy()
    expect(withinWork.getByText('Finance')).toBeTruthy()
  })

  it('keeps sibling folders out of an unrelated parent subtree', () => {
    render(<FolderTree folders={sample} client={fakeClient as any} vaultId="v1" />)
    const workRow = screen.getByText('Work').closest('li') as HTMLElement
    const toggle = workRow.querySelector('.folder-tree__toggle') as HTMLElement
    fireEvent.click(toggle)
    const workItem = screen.getByText('Work').closest('li') as HTMLElement
    expect(within(workItem).queryByText('Personal')).toBeNull()
  })

  it('renders an empty root <ul> when there are no folders', () => {
    const { container } = render(<FolderTree folders={[]} client={fakeClient as any} vaultId="v1" />)
    expect(container.querySelector('.folder-tree')).not.toBeNull()
    // When there are no root folders, the root <ul> is still present but empty.
    expect(container.querySelector('.folder-tree > ul')).not.toBeNull()
    expect(container.querySelector('.folder-tree > ul > li')).toBeNull()
  })

  it('shows a "+ New folder" button at the bottom of the tree', () => {
    render(<FolderTree folders={sample} client={fakeClient as any} vaultId="v1" />)
    expect(screen.getByRole('button', { name: 'Create root-level folder' })).toBeTruthy()
  })

  it('renders expand/collapse chevrons for folders with children', () => {
    render(<FolderTree folders={sample} client={fakeClient as any} vaultId="v1" />)
    const workRow = screen.getByText('Work').closest('li') as HTMLElement
    expect(workRow.querySelector('.folder-tree__toggle')).not.toBeNull()
  })

  it('renders a dot chevron for leaf folders', () => {
    render(<FolderTree folders={sample} client={fakeClient as any} vaultId="v1" />)
    // Personal has no children → should show a dot
    const personalRow = screen.getByText('Personal').closest('li') as HTMLElement
    const chevron = personalRow.querySelector('.folder-tree__chevron')
    expect(chevron?.textContent).toBe('·')
  })

  it('expands and collapses a folder when its chevron is clicked', () => {
    render(<FolderTree folders={sample} client={fakeClient as any} vaultId="v1" />)
    const workRow = screen.getByText('Work').closest('li') as HTMLElement
    const toggle = workRow.querySelector('.folder-tree__toggle') as HTMLElement

    // Initially collapsed — children hidden
    expect(screen.queryByText('Engineering')).toBeNull()

    // Click toggle to expand
    fireEvent.click(toggle)
    expect(screen.getByText('Engineering')).toBeTruthy()
    expect(screen.getByText('Finance')).toBeTruthy()

    // Click again to collapse
    fireEvent.click(toggle)
    expect(screen.queryByText('Engineering')).toBeNull()
    expect(screen.queryByText('Finance')).toBeNull()
  })
})
