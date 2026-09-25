import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
  it('renders the folder tree section with root folders', () => {
    render(<Sidebar folders={folders} tags={tags} />)
    expect(screen.getByRole('heading', { name: 'Folders' })).toBeTruthy()
    expect(screen.getByText('Work')).toBeTruthy()
    // Engineering is hidden until Work is expanded
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

  it('renders expand toggle for folders with children', () => {
    render(<Sidebar folders={folders} tags={tags} />)
    expect(screen.getByRole('button', { name: /expand work/i })).toBeTruthy()
  })

  it('passes onMoveFolder callback through to FolderTree', () => {
    const onMoveFolder = vi.fn()
    render(<Sidebar folders={folders} tags={tags} onMoveFolder={onMoveFolder} />)

    // Expand Work first
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))
    const engRow = screen.getByText('Engineering').closest('.folder-tree__row') as HTMLElement
    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement

    const dt = { effectAllowed: 'move', setData: vi.fn() }
    fireEvent.dragStart(engRow, { dataTransfer: dt as unknown as DataTransfer })
    fireEvent.drop(workRow, { dataTransfer: dt as unknown as DataTransfer })

    expect(onMoveFolder).toHaveBeenCalledWith('engineering', 'work')
  })

  it('passes onFilterTag callback through to TagsList', () => {
    const onFilterTag = vi.fn()
    render(<Sidebar folders={folders} tags={tags} onFilterTag={onFilterTag} />)

    fireEvent.click(screen.getByRole('button', { name: 'Production' }))
    expect(onFilterTag).toHaveBeenCalledWith('t1')
  })

  it('passes activeTagId to TagsList for controlled highlight', () => {
    render(<Sidebar folders={folders} tags={tags} activeTagId="t1" />)
    expect(screen.getByRole('button', { name: 'Production' })).toHaveClass('tags-list__tag--active')
    expect(screen.getByRole('button', { name: 'Staging' })).not.toHaveClass('tags-list__tag--active')
  })

  it('renders empty folder and tag sections with headings but no lists', () => {
    const { container } = render(<Sidebar />)
    expect(screen.getByRole('heading', { name: 'Folders' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Tags' })).toBeTruthy()
    expect(container.querySelectorAll('ul')).toHaveLength(0)
  })

  it('renders both folder rows with expand/collapse toggles where children exist', () => {
    render(<Sidebar folders={folders} tags={tags} />)
    // Work has children → toggle
    expect(screen.getByRole('button', { name: /expand work/i })).toBeTruthy()
    // Engineering is child of Work, hidden until expanded
    expect(screen.queryByText('Engineering')).toBeNull()
  })
})