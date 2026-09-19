import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Sidebar from './Sidebar'
import type { FolderNode, TagNode } from './types'

const folders: FolderNode[] = [
  { id: 'work', name: 'Work', parentId: null },
  { id: 'engineering', name: 'Engineering', parentId: 'work' },
]

const tags: TagNode[] = [
  { id: 't1', name: 'Production' },
  { id: 't2', name: 'Staging' },
]

describe('Sidebar', () => {
  it('renders the folder tree section', () => {
    render(<Sidebar folders={folders} tags={tags} />)
    expect(screen.getByRole('heading', { name: 'Folders' })).toBeTruthy()
    expect(screen.getByText('Work')).toBeTruthy()
    expect(screen.getByText('Engineering')).toBeTruthy()
  })

  it('renders the tags list section', () => {
    render(<Sidebar folders={folders} tags={tags} />)
    expect(screen.getByRole('heading', { name: 'Tags' })).toBeTruthy()
    expect(screen.getByText('Production')).toBeTruthy()
    expect(screen.getByText('Staging')).toBeTruthy()
  })

  it('is a complementary landmark', () => {
    render(<Sidebar folders={folders} tags={tags} />)
    expect(screen.getByRole('complementary')).toBeTruthy()
  })
})
