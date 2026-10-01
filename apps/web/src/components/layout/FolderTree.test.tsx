import { render, screen, within, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import FolderTree from './FolderTree'
import type { FolderNode } from './types'

const sampleTree: FolderNode[] = [
  { id: 'root1', name: 'Work', parentId: null },
  { id: 'child1', name: 'Engineering', parentId: 'root1' },
  { id: 'grandchild1', name: 'Frontend', parentId: 'child1' },
  { id: 'child2', name: 'Finance', parentId: 'root1' },
  { id: 'root2', name: 'Personal', parentId: null },
  { id: 'child3', name: 'Health', parentId: 'root2' },
]

describe('FolderTree — structure and rendering', () => {
  it('renders every root-level folder', () => {
    render(<FolderTree folders={sampleTree} />)
    expect(screen.getByText('Work')).toBeTruthy()
    expect(screen.getByText('Personal')).toBeTruthy()
  })

  it('nests child folders under their parent when expanded', () => {
    render(<FolderTree folders={sampleTree} />)
    // Expand Work to reveal children
    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement
    const toggle = workRow.querySelector('.folder-tree__toggle') as HTMLElement
    fireEvent.click(toggle)
    expect(screen.getByText('Engineering')).toBeTruthy()
    expect(screen.getByText('Finance')).toBeTruthy()
  })

  it('keeps sibling folders out of an unrelated parent subtree', () => {
    render(<FolderTree folders={sampleTree} />)
    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement
    const toggle = workRow.querySelector('.folder-tree__toggle') as HTMLElement
    fireEvent.click(toggle)
    const workItem = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement
    expect(within(workItem).queryByText('Personal')).toBeNull()
  })

  it('renders nothing when there are no folders', () => {
    const { container } = render(<FolderTree folders={[]} />)
    expect(container.querySelector('.folder-tree')).toBeNull()
  })

  it('renders expand/collapse chevrons for folders with children', () => {
    render(<FolderTree folders={sampleTree} />)
    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement
    expect(workRow.querySelector('.folder-tree__toggle')).not.toBeNull()
  })

  it('renders a dot chevron for leaf folders', () => {
    render(<FolderTree folders={sampleTree} />)
    // Finance is a leaf (Work → Finance, no children) → spacer, not chevron
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))
    const financeRow = screen.getByText('Finance').closest('.folder-tree__row') as HTMLElement
    expect(financeRow.querySelector('.folder-tree__spacer')).not.toBeNull()
  })

  it('expands and collapses a folder when its chevron is clicked', () => {
    render(<FolderTree folders={sampleTree} />)
    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement
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

  it('renders every root-level folder in input order', () => {
    render(<FolderTree folders={sampleTree} />)
    const rootItems = Array.from(screen.getAllByRole('treeitem')).filter(
      (el) => (el as HTMLElement).getAttribute('aria-level') === '1',
    ) as HTMLElement[]
    const rootNames = rootItems.map((li) => li.querySelector('.folder-tree__name')?.textContent)
    expect(rootNames).toEqual(['Work', 'Personal'])
  })

  it('nests grandchildren under children when expanded', () => {
    render(<FolderTree folders={sampleTree} />)
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))
    fireEvent.click(screen.getByRole('button', { name: /expand engineering/i }))
    expect(screen.getByText('Frontend')).toBeTruthy()
  })

  it('keeps a sibling root folder out of an expanded parent subtree', () => {
    render(<FolderTree folders={sampleTree} />)
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))
    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement
    expect(within(workRow).queryByText('Personal')).toBeNull()
  })

  it('renders role="tree" wrapper', () => {
    render(<FolderTree folders={sampleTree} />)
    expect(screen.getByRole('tree', { name: 'Folders' })).toBeTruthy()
  })

  it('marks root rows as treeitem with level 1', () => {
    render(<FolderTree folders={sampleTree} />)
    const workRow = screen.getByText('Work').closest('[role="treeitem"]') as HTMLElement
    expect(workRow.getAttribute('aria-level')).toBe('1')
  })

  it('marks child rows with increasing aria-level', () => {
    render(<FolderTree folders={sampleTree} />)
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))
    const engRow = screen.getByText('Engineering').closest('[role="treeitem"]') as HTMLElement
    expect(engRow.getAttribute('aria-level')).toBe('2')
    fireEvent.click(screen.getByRole('button', { name: /expand engineering/i }))
    const feRow = screen.getByText('Frontend').closest('[role="treeitem"]') as HTMLElement
    expect(feRow.getAttribute('aria-level')).toBe('3')
  })

  it('renders folder rows as draggable', () => {
    render(<FolderTree folders={sampleTree} />)
    const rows = document.querySelectorAll('.folder-tree__row[draggable="true"]')
    expect(rows.length).toBeGreaterThanOrEqual(2)
  })
})

describe('FolderTree — expand/collapse', () => {
  it('starts with all folders collapsed (no children visible)', () => {
    render(<FolderTree folders={sampleTree} />)
    expect(screen.queryByText('Engineering')).toBeNull()
    expect(screen.queryByText('Frontend')).toBeNull()
  })

  it('expands a folder and shows its children when toggle is clicked', () => {
    render(<FolderTree folders={sampleTree} />)
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))
    expect(screen.getByText('Engineering')).toBeTruthy()
    expect(screen.getByText('Finance')).toBeTruthy()
  })

  it('collapses an expanded folder when toggle is clicked again', () => {
    render(<FolderTree folders={sampleTree} />)
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))
    expect(screen.getByText('Engineering')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /collapse work/i }))
    expect(screen.queryByText('Engineering')).toBeNull()
  })

  it('shows aria-expanded="true" on the toggle when expanded', () => {
    render(<FolderTree folders={sampleTree} />)
    const toggle = screen.getByRole('button', { name: /expand work/i })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Engineering')).toBeTruthy()
  })

  it('shows aria-expanded="false" on the toggle when collapsed from expanded state', () => {
    render(<FolderTree folders={sampleTree} />)
    const toggle = screen.getByRole('button', { name: /expand work/i })
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Engineering')).toBeNull()
  })

  it('does not render a toggle button for a leaf folder', () => {
    render(<FolderTree folders={sampleTree} />)
    // Finance is a leaf — only visible when Work expanded
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))
    const financeRow = screen.getByText('Finance').closest('.folder-tree__row') as HTMLElement
    expect(financeRow.querySelector('.folder-tree__toggle')).toBeNull()
  })

  it('renders a spacer element where a toggle would be on a leaf row', () => {
    render(<FolderTree folders={sampleTree} />)
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))
    const financeRow = screen.getByText('Finance').closest('.folder-tree__row') as HTMLElement
    expect(financeRow.querySelector('.folder-tree__spacer')).toBeTruthy()
  })

  it('renders a toggle for every folder that has children', () => {
    render(<FolderTree folders={sampleTree} />)
    expect(screen.getByRole('button', { name: /expand work/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /expand personal/i })).toBeTruthy()
  })
})

describe('FolderTree — drag and drop', () => {
  const onMove = vi.fn()

  beforeEach(() => {
    onMove.mockClear()
  })

  function renderWithMove() {
    return render(<FolderTree folders={sampleTree} onMove={onMove} />)
  }

  it('calls onMove with source and new parent when dropped on a folder', () => {
    renderWithMove()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const financeRow = screen.getByText('Finance').closest('.folder-tree__row') as HTMLElement
    const personalRow = screen.getByText('Personal').closest('.folder-tree__row') as HTMLElement

    const dt = { effectAllowed: 'move', setData: vi.fn() }
    fireEvent.dragStart(financeRow, { dataTransfer: dt as unknown as DataTransfer })
    fireEvent.drop(personalRow, { dataTransfer: dt as unknown as DataTransfer })

    expect(onMove).toHaveBeenCalledWith('child2', 'root2')
  })

  it('calls onMove with null parent when dropped on root tree background', () => {
    renderWithMove()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const financeRow = screen.getByText('Finance').closest('.folder-tree__row') as HTMLElement
    const tree = screen.getByRole('tree')

    const dt = { effectAllowed: 'move', setData: vi.fn() }
    fireEvent.dragStart(financeRow, { dataTransfer: dt as unknown as DataTransfer })
    fireEvent.drop(tree, { dataTransfer: dt as unknown as DataTransfer })

    expect(onMove).toHaveBeenCalledWith('child2', null)
  })

  it('does not call onMove when dropping a folder on itself', () => {
    renderWithMove()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement
    const dt = { effectAllowed: 'move', setData: vi.fn() }
    fireEvent.dragStart(workRow, { dataTransfer: dt as unknown as DataTransfer })
    fireEvent.drop(workRow, { dataTransfer: dt as unknown as DataTransfer })

    expect(onMove).not.toHaveBeenCalled()
  })

  it('prevents dropping a folder on its own descendant (cycle prevention)', () => {
    renderWithMove()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))
    fireEvent.click(screen.getByRole('button', { name: /expand engineering/i }))

    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement
    const frontendRow = screen.getByText('Frontend').closest('.folder-tree__row') as HTMLElement

    const dt = { effectAllowed: 'move', setData: vi.fn() }
    fireEvent.dragStart(workRow, { dataTransfer: dt as unknown as DataTransfer })
    fireEvent.drop(frontendRow, { dataTransfer: dt as unknown as DataTransfer })

    expect(onMove).not.toHaveBeenCalled()
  })

  it('allows dropping a folder onto a sibling (valid move)', () => {
    renderWithMove()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const financeRow = screen.getByText('Finance').closest('.folder-tree__row') as HTMLElement
    const personalRow = screen.getByText('Personal').closest('.folder-tree__row') as HTMLElement

    const dt = { effectAllowed: 'move', setData: vi.fn() }
    fireEvent.dragStart(financeRow, { dataTransfer: dt as unknown as DataTransfer })
    fireEvent.drop(personalRow, { dataTransfer: dt as unknown as DataTransfer })

    expect(onMove).toHaveBeenCalledWith('child2', 'root2')
  })

  it('clears dragged state after drag ends', () => {
    renderWithMove()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement
    const dt = { effectAllowed: 'move', setData: vi.fn() }
    fireEvent.dragStart(workRow, { dataTransfer: dt as unknown as DataTransfer })
    expect(workRow.classList.contains('folder-tree__row--dragged')).toBe(true)

    fireEvent.dragEnd(workRow)
    expect(workRow.classList.contains('folder-tree__row--dragged')).toBe(false)
  })

  it('applies drop-target class to the row being hovered during drag', () => {
    renderWithMove()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const financeRow = screen.getByText('Finance').closest('.folder-tree__row') as HTMLElement
    const personalRow = screen.getByText('Personal').closest('.folder-tree__row') as HTMLElement

    const dt = { effectAllowed: 'move', setData: vi.fn() }
    fireEvent.dragStart(financeRow, { dataTransfer: dt as unknown as DataTransfer })

    fireEvent.dragOver(personalRow, { dataTransfer: dt as unknown as DataTransfer })
    expect(personalRow.classList.contains('drop-target')).toBe(true)

    fireEvent.dragLeave(personalRow)
    expect(personalRow.classList.contains('drop-target')).toBe(false)
  })

  it('does not show drop-target on rows when no drag is in progress', () => {
    renderWithMove()
    expect(document.querySelectorAll('.drop-target').length).toBe(0)
  })
})

describe('FolderTree — context menu', () => {
  const onAddSubfolder = vi.fn()
  const onRenameConfirm = vi.fn()
  const onDelete = vi.fn()
  const onMove = vi.fn()

  beforeEach(() => {
    onAddSubfolder.mockClear()
    onRenameConfirm.mockClear()
    onDelete.mockClear()
    onMove.mockClear()
  })

  function renderWithContext() {
    return render(
      <FolderTree
        folders={sampleTree}
        onMove={onMove}
        onAddSubfolder={onAddSubfolder}
        onRenameConfirm={onRenameConfirm}
        onDelete={onDelete}
      />,
    )
  }

  it('opens context menu on right-click', () => {
    renderWithContext()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement
    fireEvent.contextMenu(workRow)

    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('closes context menu on Escape', () => {
    renderWithContext()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement
    fireEvent.contextMenu(workRow)
    expect(screen.getByRole('menu')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('calls onAddSubfolder when Create subfolder is clicked', () => {
    renderWithContext()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement
    fireEvent.contextMenu(workRow)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Create subfolder' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(onAddSubfolder).toHaveBeenCalled()
  })

  it('calls onRenameConfirm when Rename is clicked and confirmed', () => {
    renderWithContext()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement
    fireEvent.contextMenu(workRow)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename…' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByLabelText('Name')).toHaveValue('Work')

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    expect(onRenameConfirm).toHaveBeenCalledWith('root1', 'Renamed')
  })

  it('calls onDelete when Delete is clicked', () => {
    renderWithContext()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement
    fireEvent.contextMenu(workRow)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }))
    expect(onDelete).toHaveBeenCalled()
  })

  it('calls onMove when Move… is clicked', () => {
    renderWithContext()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement
    fireEvent.contextMenu(workRow)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Move…' }))
    expect(onMove).toHaveBeenCalled()
  })
})

describe('FolderTree — edge cases', () => {
  it('handles a single root folder with no children', () => {
    const folders: FolderNode[] = [{ id: 'only', name: 'Only Folder', parentId: null }]
    render(<FolderTree folders={folders} />)
    expect(screen.getByText('Only Folder')).toBeTruthy()
    const row = screen.getByText('Only Folder').closest('.folder-tree__row') as HTMLElement
    expect(row.querySelector('.folder-tree__toggle')).toBeNull()
    expect(row.querySelector('.folder-tree__spacer')).toBeTruthy()
  })

  it('handles multiple root folders at same depth', () => {
    const folders: FolderNode[] = [
      { id: 'a', name: 'A', parentId: null },
      { id: 'b', name: 'B', parentId: null },
      { id: 'c', name: 'C', parentId: null },
    ]
    render(<FolderTree folders={folders} />)
    expect(screen.getByText('A')).toBeTruthy()
    expect(screen.getByText('B')).toBeTruthy()
    expect(screen.getByText('C')).toBeTruthy()
  })

  it('renders empty state when folders array is empty', () => {
    const { container } = render(<FolderTree folders={[]} />)
    expect(container.querySelector('.folder-tree')).toBeNull()
  })
})
