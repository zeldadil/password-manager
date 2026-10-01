import { render, screen, fireEvent } from '@testing-library/react'
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

describe('FolderTree — context menu integration', () => {
  const onAddSubfolder = vi.fn()
  const onRenameConfirm = vi.fn()
  const onMove = vi.fn()
  const onDelete = vi.fn()

  beforeEach(() => {
    onAddSubfolder.mockClear()
    onRenameConfirm.mockClear()
    onMove.mockClear()
    onDelete.mockClear()
  })

  function renderWithCallbacks() {
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

  it('opens a context menu on right-click of a folder row', () => {
    renderWithCallbacks()
    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement

    fireEvent.contextMenu(workRow)

    expect(screen.getByRole('menu', { name: /actions for work/i })).toBeTruthy()
  })

  it('positions the context menu at the cursor, clamped to viewport', () => {
    renderWithCallbacks()
    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement

    fireEvent.contextMenu(workRow, { clientX: 50, clientY: 60 })

    const menu = screen.getByRole('menu')
    expect(menu).toHaveStyle({ left: '50px', top: '60px' })
  })

  it('opens the create dialog and calls onAddSubfolder with name when "Create subfolder" is chosen', () => {
    renderWithCallbacks()
    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement
    fireEvent.contextMenu(workRow)

    // Choose "Create subfolder" — opens the create dialog.
    fireEvent.click(screen.getByRole('menuitem', { name: /create subfolder/i }))

    // The dialog should appear with default name.
    expect(screen.getByRole('dialog', { name: /create subfolder/i })).toBeTruthy()
    const input = screen.getByRole('textbox', { name: /name/i })
    expect(input).toHaveValue('New folder')

    // Submit with the default name.
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    // onAddSubfolder fires with parentId + name; dialog closes.
    expect(onAddSubfolder).toHaveBeenCalledWith(null, 'New folder')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens the rename dialog and calls onRenameConfirm when "Rename" is chosen', () => {
    renderWithCallbacks()
    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement
    fireEvent.contextMenu(workRow)

    // Choose "Rename" — opens the rename dialog.
    fireEvent.click(screen.getByRole('menuitem', { name: /rename/i }))

    expect(screen.getByRole('dialog', { name: /rename folder/i })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: /name/i })).toHaveValue('Work')

    // Submit with the current name (simulate Enter key).
    const input = screen.getByRole('textbox', { name: /name/i })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onRenameConfirm).toHaveBeenCalledWith('root1', 'Work')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('calls onMove with folder id and null parent when "Move" is chosen', () => {
    renderWithCallbacks()
    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement
    fireEvent.contextMenu(workRow)

    fireEvent.click(screen.getByRole('menuitem', { name: /move/i }))

    expect(onMove).toHaveBeenCalledWith('root1', null)
  })

  it('calls onDelete with the folder id when "Delete" is chosen', () => {
    renderWithCallbacks()
    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement
    fireEvent.contextMenu(workRow)

    fireEvent.click(screen.getByRole('menuitem', { name: /delete/i }))

    expect(onDelete).toHaveBeenCalledWith('root1')
  })

  it('closes the context menu when Escape is pressed', () => {
    renderWithCallbacks()
    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement
    fireEvent.contextMenu(workRow)
    expect(screen.getByRole('menu')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes the context menu when clicking outside', () => {
    renderWithCallbacks()
    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement
    fireEvent.contextMenu(workRow)
    expect(screen.getByRole('menu')).toBeTruthy()

    fireEvent.mouseDown(document.body)

    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('does not open a context menu for the tree background itself (only rows)', () => {
    renderWithCallbacks()
    const tree = screen.getByRole('tree')
    // A right-click on the tree element (not a row) should not open a menu.
    fireEvent.contextMenu(tree)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens context menu for a nested child folder', () => {
    renderWithCallbacks()
    // Expand Work first to see Engineering.
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))
    const engRow = screen.getByText('Engineering').closest('.folder-tree__row') as HTMLElement
    fireEvent.contextMenu(engRow)

    expect(screen.getByRole('menu', { name: /actions for engineering/i })).toBeTruthy()
  })

  it('cancels rename when Escape is pressed in the rename dialog', () => {
    renderWithCallbacks()
    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement
    fireEvent.contextMenu(workRow)
    fireEvent.click(screen.getByRole('menuitem', { name: /rename/i }))

    expect(screen.getByRole('dialog', { name: /rename folder/i })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onRenameConfirm).not.toHaveBeenCalled()
  })

  it('cancels create when Escape is pressed in the create dialog', () => {
    renderWithCallbacks()
    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement
    fireEvent.contextMenu(workRow)
    fireEvent.click(screen.getByRole('menuitem', { name: /create subfolder/i }))

    expect(screen.getByRole('dialog', { name: /create subfolder/i })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onAddSubfolder).not.toHaveBeenCalled()
  })

  it('closes the create dialog when clicking on the overlay backdrop', () => {
    renderWithCallbacks()
    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement
    fireEvent.contextMenu(workRow)
    fireEvent.click(screen.getByRole('menuitem', { name: /create subfolder/i }))

    const overlay = screen.getByRole('dialog').closest('.folder-name-dialog-overlay') as HTMLElement
    fireEvent.click(overlay, { target: overlay })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onAddSubfolder).not.toHaveBeenCalled()
  })

  it('does not close the create dialog when clicking inside the dialog box', () => {
    renderWithCallbacks()
    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement
    fireEvent.contextMenu(workRow)
    fireEvent.click(screen.getByRole('menuitem', { name: /create subfolder/i }))

    const contentBox = screen
      .getByRole('dialog')
      .querySelector('.folder-name-dialog') as HTMLElement
    fireEvent.click(contentBox)

    expect(screen.queryByRole('dialog')).toBeTruthy()
  })
})

describe('FolderTree — context menu and drag-drop coexist', () => {
  const onMove = vi.fn()

  beforeEach(() => {
    onMove.mockClear()
  })

  it('right-click opens context menu; drag on a different row keeps it open', () => {
    render(<FolderTree folders={sampleTree} onMove={onMove} />)
    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement

    // Open context menu on Work.
    fireEvent.contextMenu(workRow)
    expect(screen.getByRole('menu')).toBeTruthy()

    // Expand Work to reveal Engineering, then drag Engineering.
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))
    const engRow = screen.getByText('Engineering').closest('.folder-tree__row') as HTMLElement
    const dt = { effectAllowed: 'move', setData: vi.fn() }
    fireEvent.dragStart(engRow, { dataTransfer: dt as unknown as DataTransfer })

    expect(engRow.classList.contains('folder-tree__row--dragged')).toBe(true)
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('closes context menu when drag ends', () => {
    render(<FolderTree folders={sampleTree} onMove={onMove} />)
    const workRow = screen.getByText('Work').closest('.folder-tree__row') as HTMLElement
    fireEvent.contextMenu(workRow)
    expect(screen.getByRole('menu')).toBeTruthy()

    fireEvent.dragEnd(workRow)

    // dragEnd triggers mouse events that close the menu.
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
