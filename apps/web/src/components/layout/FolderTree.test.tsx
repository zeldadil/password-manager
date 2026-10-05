import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

describe('FolderTree — context menu', () => {
  const onCreate = vi.fn()
  const onRename = vi.fn()
  const onDelete = vi.fn()
  const onMove = vi.fn()

  beforeEach(() => {
    onCreate.mockClear()
    onRename.mockClear()
    onDelete.mockClear()
    onMove.mockClear()
  })

  function renderWithCallbacks() {
    return render(
      <FolderTree
        folders={sampleTree}
        onCreate={onCreate}
        onRename={onRename}
        onDelete={onDelete}
        onMove={onMove}
      />,
    )
  }

  it('opens a context menu on right-click over a folder row', () => {
    renderWithCallbacks()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const financeRow = screen.getByText('Finance').closest('.folder-tree__row') as HTMLElement
    const dt = { effectAllowed: 'move', setData: vi.fn() }
    fireEvent.contextMenu(financeRow, { clientX: 300, clientY: 200, dataTransfer: dt as unknown as DataTransfer })

    expect(screen.getByRole('menu', { name: 'Folder actions' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Move to root' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'New subfolder' })).toBeTruthy()
  })

  it('opens a context menu on right-click over the root tree background', () => {
    renderWithCallbacks()
    const tree = screen.getByRole('tree')
    const dt = { effectAllowed: 'move', setData: vi.fn() }
    fireEvent.contextMenu(tree, { clientX: 50, clientY: 50, dataTransfer: dt as unknown as DataTransfer })

    expect(screen.getByRole('menu', { name: 'Folder actions' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'New folder' })).toBeTruthy()
  })

  it('has exactly one menu item for root context (New folder)', () => {
    renderWithCallbacks()
    const tree = screen.getByRole('tree')
    const dt = { effectAllowed: 'move', setData: vi.fn() }
    fireEvent.contextMenu(tree, { clientX: 50, clientY: 50, dataTransfer: dt as unknown as DataTransfer })

    const items = screen.getAllByRole('menuitem')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('New folder')
  })

  it('has four menu items for a folder context', () => {
    renderWithCallbacks()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const financeRow = screen.getByText('Finance').closest('.folder-tree__row') as HTMLElement
    const dt = { effectAllowed: 'move', setData: vi.fn() }
    fireEvent.contextMenu(financeRow, { clientX: 300, clientY: 200, dataTransfer: dt as unknown as DataTransfer })

    const items = screen.getAllByRole('menuitem')
    expect(items).toHaveLength(4)
  })

  it('calls onCreate with null when "New folder" is selected from root context', () => {
    renderWithCallbacks()
    const tree = screen.getByRole('tree')
    const dt = { effectAllowed: 'move', setData: vi.fn() }
    fireEvent.contextMenu(tree, { clientX: 50, clientY: 50, dataTransfer: dt as unknown as DataTransfer })

    fireEvent.click(screen.getByRole('menuitem', { name: 'New folder' }))
    expect(onCreate).toHaveBeenCalledWith(null)
  })

  it('calls onCreate with the folder id when "New subfolder" is selected', () => {
    renderWithCallbacks()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const financeRow = screen.getByText('Finance').closest('.folder-tree__row') as HTMLElement
    const dt = { effectAllowed: 'move', setData: vi.fn() }
    fireEvent.contextMenu(financeRow, { clientX: 300, clientY: 200, dataTransfer: dt as unknown as DataTransfer })

    fireEvent.click(screen.getByRole('menuitem', { name: 'New subfolder' }))
    expect(onCreate).toHaveBeenCalledWith('child2')
  })

  it('opens the inline rename input when "Rename" is selected from context menu', () => {
    renderWithCallbacks()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const financeRow = screen.getByText('Finance').closest('.folder-tree__row') as HTMLElement
    const dt = { effectAllowed: 'move', setData: vi.fn() }
    fireEvent.contextMenu(financeRow, { clientX: 300, clientY: 200, dataTransfer: dt as unknown as DataTransfer })

    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))

    // The rename input should be in the DOM with the Finance folder's name as initial value
    const input = screen.getByRole('textbox', { name: /rename finance/i })
    expect(input).toBeTruthy()
    expect(input).toHaveValue('Finance')
  })

  it('commits the rename on Enter in the inline rename input', () => {
    renderWithCallbacks()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const financeRow = screen.getByText('Finance').closest('.folder-tree__row') as HTMLElement
    const dt = { effectAllowed: 'move', setData: vi.fn() }
    fireEvent.contextMenu(financeRow, { clientX: 300, clientY: 200, dataTransfer: dt as unknown as DataTransfer })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))

    const input = screen.getByRole('textbox', { name: /rename finance/i })
    fireEvent.change(input, { target: { value: 'NewFinance' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onRename).toHaveBeenCalledWith('child2', 'NewFinance')
  })

  it('commits the rename on blur in the inline rename input', () => {
    renderWithCallbacks()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const financeRow = screen.getByText('Finance').closest('.folder-tree__row') as HTMLElement
    const dt = { effectAllowed: 'move', setData: vi.fn() }
    fireEvent.contextMenu(financeRow, { clientX: 300, clientY: 200, dataTransfer: dt as unknown as DataTransfer })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))

    const input = screen.getByRole('textbox', { name: /rename finance/i })
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.blur(input)

    expect(onRename).toHaveBeenCalledWith('child2', 'Renamed')
  })

  it('cancels the rename without calling onRename when Escape is pressed', () => {
    renderWithCallbacks()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const financeRow = screen.getByText('Finance').closest('.folder-tree__row') as HTMLElement
    const dt = { effectAllowed: 'move', setData: vi.fn() }
    fireEvent.contextMenu(financeRow, { clientX: 300, clientY: 200, dataTransfer: dt as unknown as DataTransfer })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))

    const input = screen.getByRole('textbox', { name: /rename finance/i })
    fireEvent.change(input, { target: { value: 'Changed' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onRename).not.toHaveBeenCalled()
    // Input should be gone
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('does not commit rename when the input is empty', () => {
    renderWithCallbacks()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const financeRow = screen.getByText('Finance').closest('.folder-tree__row') as HTMLElement
    const dt = { effectAllowed: 'move', setData: vi.fn() }
    fireEvent.contextMenu(financeRow, { clientX: 300, clientY: 200, dataTransfer: dt as unknown as DataTransfer })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))

    const input = screen.getByRole('textbox', { name: /rename finance/i })
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onRename).not.toHaveBeenCalled()
  })

  it('restores the original name in the input after a cancelled rename', () => {
    renderWithCallbacks()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const financeRow = screen.getByText('Finance').closest('.folder-tree__row') as HTMLElement
    const dt = { effectAllowed: 'move', setData: vi.fn() }
    fireEvent.contextMenu(financeRow, { clientX: 300, clientY: 200, dataTransfer: dt as unknown as DataTransfer })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))

    const input = screen.getByRole('textbox', { name: /rename finance/i })
    fireEvent.change(input, { target: { value: 'Altered' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    // After cancel, the rename input should be removed
    expect(screen.queryByRole('textbox')).toBeNull()
    // The folder name should still display as Finance
    expect(screen.getByText('Finance')).toBeTruthy()
  })

  it('calls onDelete with the folder id when "Delete" is selected', () => {
    renderWithCallbacks()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const financeRow = screen.getByText('Finance').closest('.folder-tree__row') as HTMLElement
    const dt = { effectAllowed: 'move', setData: vi.fn() }
    fireEvent.contextMenu(financeRow, { clientX: 300, clientY: 200, dataTransfer: dt as unknown as DataTransfer })

    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(onDelete).toHaveBeenCalledWith('child2')
  })

  it('calls onMove with the folder id and null when "Move to root" is selected', () => {
    renderWithCallbacks()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const financeRow = screen.getByText('Finance').closest('.folder-tree__row') as HTMLElement
    const dt = { effectAllowed: 'move', setData: vi.fn() }
    fireEvent.contextMenu(financeRow, { clientX: 300, clientY: 200, dataTransfer: dt as unknown as DataTransfer })

    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to root' }))
    expect(onMove).toHaveBeenCalledWith('child2', null)
  })

  it('closes the context menu when an item is selected', () => {
    renderWithCallbacks()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const financeRow = screen.getByText('Finance').closest('.folder-tree__row') as HTMLElement
    const dt = { effectAllowed: 'move', setData: vi.fn() }
    fireEvent.contextMenu(financeRow, { clientX: 300, clientY: 200, dataTransfer: dt as unknown as DataTransfer })

    expect(screen.queryByRole('menu')).not.toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes the context menu on Escape', () => {
    renderWithCallbacks()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const financeRow = screen.getByText('Finance').closest('.folder-tree__row') as HTMLElement
    const dt = { effectAllowed: 'move', setData: vi.fn() }
    fireEvent.contextMenu(financeRow, { clientX: 300, clientY: 200, dataTransfer: dt as unknown as DataTransfer })

    expect(screen.queryByRole('menu')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes the context menu when clicking outside', () => {
    renderWithCallbacks()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const financeRow = screen.getByText('Finance').closest('.folder-tree__row') as HTMLElement
    const dt = { effectAllowed: 'move', setData: vi.fn() }
    fireEvent.contextMenu(financeRow, { clientX: 300, clientY: 200, dataTransfer: dt as unknown as DataTransfer })

    expect(screen.queryByRole('menu')).not.toBeNull()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('double-clicking a folder row opens the inline rename input', () => {
    renderWithCallbacks()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const financeRow = screen.getByText('Finance').closest('.folder-tree__row') as HTMLElement
    fireEvent.doubleClick(financeRow)

    const input = screen.getByRole('textbox', { name: /rename finance/i })
    expect(input).toHaveValue('Finance')
  })

  it('shows a context-target outline on the row under the context menu', async () => {
    renderWithCallbacks()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const financeRow = screen.getByText('Finance').closest('.folder-tree__row') as HTMLElement
    fireEvent.contextMenu(financeRow, { clientX: 300, clientY: 200 })
    fireEvent.contextMenu(financeRow, { clientX: 300, clientY: 200 })

    // Verify the event handler fired (context menu opened with folder items)
    expect(screen.queryByRole('menu')).not.toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy()

    await waitFor(() => {
      const updatedRow = screen.getByText('Finance').closest('.folder-tree__row')
      expect(updatedRow).toHaveClass('folder-tree__row--context-target')
    })
  })

  it('right-clicking a different folder moves the context target', () => {
    renderWithCallbacks()
    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const financeRow = screen.getByText('Finance').closest('.folder-tree__row') as HTMLElement
    const personalRow = screen.getByText('Personal').closest('.folder-tree__row') as HTMLElement
    fireEvent.contextMenu(financeRow, { clientX: 300, clientY: 200, dataTransfer: { effectAllowed: 'move', setData: () => {} } as unknown as DataTransfer })
    fireEvent.contextMenu(personalRow, { clientX: 400, clientY: 300, dataTransfer: { effectAllowed: 'move', setData: () => {} } as unknown as DataTransfer })

    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy()
    // The menu should now show folder-level items (Rename, Delete, etc.) not "New folder"
    expect(screen.getByText('Rename')).toBeTruthy()
  })
})

describe('FolderTree — context menu keyboard navigation', () => {
  const onCreate = vi.fn()
  const onRename = vi.fn()
  const onDelete = vi.fn()
  const onMove = vi.fn()

  beforeEach(() => {
    onCreate.mockClear()
    onRename.mockClear()
    onDelete.mockClear()
    onMove.mockClear()
  })

  it('activates the first item and navigates with arrow keys', () => {
    render(
      <FolderTree
        folders={sampleTree}
        onCreate={onCreate}
        onRename={onRename}
        onDelete={onDelete}
        onMove={onMove}
      />,
    )

    const tree = screen.getByRole('tree')
    const dt = { effectAllowed: 'move', setData: vi.fn() }
    fireEvent.contextMenu(tree, { clientX: 50, clientY: 50, dataTransfer: dt as unknown as DataTransfer })

    const menu = screen.getByRole('menu')
    const firstItem = screen.getByRole('menuitem', { name: 'New folder' })
    expect(firstItem).toHaveClass('folder-context-menu__item--active')

    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    // Only one item, so it stays active
    expect(firstItem).toHaveClass('folder-context-menu__item--active')
  })

  it('selects the active item with Enter', () => {
    render(
      <FolderTree
        folders={sampleTree}
        onCreate={onCreate}
        onRename={onRename}
        onDelete={onDelete}
        onMove={onMove}
      />,
    )

    const tree = screen.getByRole('tree')
    const dt = { effectAllowed: 'move', setData: vi.fn() }
    fireEvent.contextMenu(tree, { clientX: 50, clientY: 50, dataTransfer: dt as unknown as DataTransfer })

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Enter' })
    expect(onCreate).toHaveBeenCalledWith(null)
  })
})
