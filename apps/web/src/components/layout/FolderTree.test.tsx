import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import FolderTree from './FolderTree'
import type { FolderNode } from './types'

const sample: FolderNode[] = [
  { id: 'work', name: 'Work', parentId: null },
  { id: 'engineering', name: 'Engineering', parentId: 'work' },
  { id: 'finance', name: 'Finance', parentId: 'work' },
  { id: 'personal', name: 'Personal', parentId: null },
]

describe('FolderTree', () => {
  it('renders every root-level folder', () => {
    render(<FolderTree folders={sample} />)
    expect(screen.getByText('Work')).toBeTruthy()
    expect(screen.getByText('Personal')).toBeTruthy()
  })

  it('nests child folders under their parent', () => {
    render(<FolderTree folders={sample} />)
    const workItem = screen.getByText('Work').closest('li')
    expect(workItem).not.toBeNull()
    const withinWork = within(workItem as HTMLElement)
    expect(withinWork.getByText('Engineering')).toBeTruthy()
    expect(withinWork.getByText('Finance')).toBeTruthy()
  })

  it('keeps sibling folders out of an unrelated parent subtree', () => {
    render(<FolderTree folders={sample} />)
    const workItem = screen.getByText('Work').closest('li') as HTMLElement
    expect(within(workItem).queryByText('Personal')).toBeNull()
  })

  it('renders nothing when there are no folders', () => {
    const { container } = render(<FolderTree folders={[]} />)
    expect(container.querySelector('ul')).toBeNull()
  })
})
