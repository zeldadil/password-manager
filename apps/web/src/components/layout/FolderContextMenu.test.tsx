import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FolderContextMenu from './FolderContextMenu'

const folder = { id: 'f1', name: 'Work' }
const position = { x: 100, y: 100 }

function renderMenu(overrides: Partial<Parameters<typeof FolderContextMenu>[0]> = {}) {
  const onAddSubfolder = vi.fn()
  const onRename = vi.fn()
  const onMove = vi.fn()
  const onDelete = vi.fn()
  const onClose = vi.fn()
  return {
    ...render(
      <FolderContextMenu
        folder={folder}
        position={position}
        onAddSubfolder={onAddSubfolder}
        onRename={onRename}
        onMove={onMove}
        onDelete={onDelete}
        onClose={onClose}
        {...overrides}
      />,
    ),
    spies: { onAddSubfolder, onRename, onMove, onDelete, onClose },
  }
}

describe('FolderContextMenu — rendering', () => {
  it('renders role="menu" with an accessible label', () => {
    renderMenu()
    expect(screen.getByRole('menu', { name: /actions for work/i })).toBeTruthy()
  })

  it('renders all four action items as menuitem buttons', () => {
    renderMenu()
    expect(screen.getByRole('menuitem', { name: /create subfolder/i })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /rename/i })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /move/i })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /delete/i })).toBeTruthy()
  })

  it('positions itself fixed at the given coordinates', () => {
    const { container } = renderMenu()
    const menu = container.querySelector('.folder-context-menu') as HTMLElement
    expect(menu).toHaveStyle({ position: 'fixed', left: '100px', top: '100px', zIndex: '1000' })
  })
})

describe('FolderContextMenu — item activation', () => {
  function clickItem(name: string) {
    const { spies } = renderMenu()
    const item = screen.getByRole('menuitem', { name: new RegExp(name, 'i') })
    fireEvent.click(item)
    return spies
  }

  it('calls onAddSubfolder and closes when "Create subfolder" is clicked', () => {
    const { onAddSubfolder, onClose } = clickItem('create subfolder')
    expect(onAddSubfolder).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onRename and closes when "Rename" is clicked', () => {
    const { onRename, onClose } = clickItem('rename')
    expect(onRename).toHaveBeenCalledWith('')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onMove and closes when "Move" is clicked', () => {
    const { onMove, onClose } = clickItem('move')
    expect(onMove).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onDelete and closes when "Delete" is clicked', () => {
    const { onDelete, onClose } = clickItem('delete')
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('FolderContextMenu — keyboard navigation', () => {
  function openMenu() {
    return renderMenu()
  }

  it('starts with the first item focused (ArrowDown cycles to next)', () => {
    openMenu()
    const firstItem = screen.getByRole('menuitem', { name: /create subfolder/i })
    // Focus is managed via ref; verify item is rendered.
    expect(firstItem).toBeTruthy()

    fireEvent.keyDown(document, { key: 'ArrowDown' })
    // After ArrowDown, the second item should be the focused one.
    const secondItem = screen.getByRole('menuitem', { name: /rename/i })
    expect(secondItem).toHaveClass('folder-context-menu__item--focused')
  })

  it('ArrowUp cycles to the previous item', () => {
    openMenu()
    // From initial focus (index 0), ArrowUp wraps to last item.
    fireEvent.keyDown(document, { key: 'ArrowUp' })
    const lastItem = screen.getByRole('menuitem', { name: /delete/i })
    expect(lastItem).toHaveClass('folder-context-menu__item--focused')
  })

  it('Enter activates the focused item', () => {
    const { spies } = openMenu()
    fireEvent.keyDown(document, { key: 'ArrowDown' }) // move to Rename
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(spies.onRename).toHaveBeenCalledWith('')
    expect(spies.onClose).toHaveBeenCalledTimes(1)
  })

  it('Space activates the focused item', () => {
    const { spies } = openMenu()
    fireEvent.keyDown(document, { key: 'ArrowDown' }) // Rename
    fireEvent.keyDown(document, { key: ' ' })
    expect(spies.onRename).toHaveBeenCalledWith('')
    expect(spies.onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape closes the menu without activating any item', () => {
    const { spies } = openMenu()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(spies.onClose).toHaveBeenCalledTimes(1)
    // No action callbacks should fire.
    expect(spies.onAddSubfolder).not.toHaveBeenCalled()
    expect(spies.onDelete).not.toHaveBeenCalled()
  })

  it('mouse enter moves focus to the hovered item', () => {
    openMenu()
    const deleteItem = screen.getByRole('menuitem', { name: /delete/i })
    fireEvent.mouseEnter(deleteItem)
    expect(deleteItem).toHaveClass('folder-context-menu__item--focused')
  })
})

describe('FolderContextMenu — close on outside click', () => {
  it('closes when clicking outside the menu', () => {
    const { spies } = renderMenu()
    // Click on document body (outside menu).
    fireEvent.mouseDown(document.body)
    expect(spies.onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when clicking inside the menu', () => {
    const { spies } = renderMenu()
    const item = screen.getByRole('menuitem', { name: /rename/i })
    fireEvent.mouseDown(item)
    // onClose should NOT be called for an inside click.
    expect(spies.onClose).not.toHaveBeenCalled()
  })
})

describe('FolderContextMenu — aria-selected on focused item', () => {
  it('marks the initially focused item with aria-selected="true"', () => {
    renderMenu()
    const firstItem = screen.getByRole('menuitem', { name: /create subfolder/i })
    expect(firstItem).toHaveAttribute('aria-selected', 'true')
  })

  it('updates aria-selected as focus moves', () => {
    renderMenu()
    const firstItem = screen.getByRole('menuitem', { name: /create subfolder/i })
    const secondItem = screen.getByRole('menuitem', { name: /rename/i })

    expect(firstItem).toHaveAttribute('aria-selected', 'true')
    expect(secondItem).toHaveAttribute('aria-selected', 'false')

    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(firstItem).toHaveAttribute('aria-selected', 'false')
    expect(secondItem).toHaveAttribute('aria-selected', 'true')
  })
})
