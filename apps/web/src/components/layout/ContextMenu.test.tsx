import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ContextMenu from './ContextMenu'
import type { ContextMenuItem } from './ContextMenu'

function renderMenu(items: ContextMenuItem[], position: { x: number; y: number } | null, onSelect?: ReturnType<typeof vi.fn>, onClose?: ReturnType<typeof vi.fn>) {
  return render(
    <ContextMenu
      items={items}
      position={position}
      onSelect={onSelect ?? vi.fn()}
      onClose={onClose ?? vi.fn()}
    />,
  )
}

describe('ContextMenu', () => {
  it('renders nothing when position is null', () => {
    const onSelect = vi.fn()
    renderMenu([{ label: 'One' }], null, onSelect)
    expect(document.querySelector('.folder-context-menu')).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('renders nothing when items is empty', () => {
    const onSelect = vi.fn()
    renderMenu([], { x: 100, y: 100 }, onSelect)
    expect(document.querySelector('.folder-context-menu')).toBeNull()
  })

  it('renders each item as a menuitem button with its label', () => {
    const items: ContextMenuItem[] = [
      { label: 'Create' },
      { label: 'Rename' },
      { label: 'Delete', danger: true },
    ]
    renderMenu(items, { x: 50, y: 50 })
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Create' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy()
  })

  it('calls onSelect with the correct index when an item is clicked', () => {
    const onSelect = vi.fn()
    const items: ContextMenuItem[] = [
      { label: 'First' },
      { label: 'Second' },
    ]
    renderMenu(items, { x: 50, y: 50 }, onSelect)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Second' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('renders the shortcut text next to the label when provided', () => {
    const items: ContextMenuItem[] = [
      { label: 'New folder', shortcut: 'Ins' },
      { label: 'Rename', shortcut: 'F2' },
    ]
    renderMenu(items, { x: 50, y: 50 })
    const firstItem = screen.getByRole('menuitem', { name: 'New folder' })
    expect(firstItem.querySelector('.folder-context-menu__shortcut')).toHaveTextContent('Ins')
    const secondItem = screen.getByRole('menuitem', { name: 'Rename' })
    expect(secondItem.querySelector('.folder-context-menu__shortcut')).toHaveTextContent('F2')
  })

  it('does not render a shortcut span when shortcut is omitted', () => {
    const items: ContextMenuItem[] = [
      { label: 'Delete', danger: true },
    ]
    renderMenu(items, { x: 50, y: 50 })
    const item = screen.getByRole('menuitem', { name: 'Delete' })
    expect(item.querySelectorAll('.folder-context-menu__shortcut')).toHaveLength(0)
  })

  it('sets aria-disabled on disabled items', () => {
    const items: ContextMenuItem[] = [
      { label: 'Enabled' },
      { label: 'Disabled', disabled: true },
    ]
    renderMenu(items, { x: 50, y: 50 })
    const disabledItem = screen.getByRole('menuitem', { name: 'Disabled' })
    expect(disabledItem).toHaveAttribute('aria-disabled', 'true')
    expect(disabledItem).toBeDisabled()
  })

  it('applies danger class to danger items', () => {
    const items: ContextMenuItem[] = [
      { label: 'Safe' },
      { label: 'Dangerous', danger: true },
    ]
    renderMenu(items, { x: 50, y: 50 })
    const dangerItem = screen.getByRole('menuitem', { name: 'Dangerous' })
    expect(dangerItem).toHaveClass('folder-context-menu__item--danger')
    const safeItem = screen.getByRole('menuitem', { name: 'Safe' })
    expect(safeItem).not.toHaveClass('folder-context-menu__item--danger')
  })

  it('renders inside a portal on document.body', () => {
    const items: ContextMenuItem[] = [{ label: 'Portal item' }]
    renderMenu(items, { x: 50, y: 50 })
    expect(document.body.querySelector('.folder-context-menu')).toBeTruthy()
  })

  it('clamps active index when items shrink', () => {
    const onSelect = vi.fn()
    const { rerender } = renderMenu(
      [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
      { x: 50, y: 50 },
      onSelect,
    )
    // Trigger ArrowDown a couple times to move active index
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    // Now rerender with fewer items
    rerender(
      <ContextMenu
        items={[{ label: 'Only' }]}
        position={{ x: 50, y: 50 }}
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    )
    // Active index should be clamped to 0
    const first = screen.getByRole('menuitem', { name: 'Only' })
    expect(first).toHaveClass('folder-context-menu__item--active')
  })

  it('navigates with ArrowDown and ArrowUp', () => {
    const items: ContextMenuItem[] = [
      { label: 'Alpha' },
      { label: 'Beta' },
      { label: 'Gamma' },
    ]
    renderMenu(items, { x: 50, y: 50 })
    const menu = screen.getByRole('menu')

    const alpha = screen.getByRole('menuitem', { name: 'Alpha' })
    expect(alpha).toHaveClass('folder-context-menu__item--active')

    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Beta' })).toHaveClass('folder-context-menu__item--active')

    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Gamma' })).toHaveClass('folder-context-menu__item--active')

    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    // Clamped at last
    expect(screen.getByRole('menuitem', { name: 'Gamma' })).toHaveClass('folder-context-menu__item--active')

    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(screen.getByRole('menuitem', { name: 'Beta' })).toHaveClass('folder-context-menu__item--active')

    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(screen.getByRole('menuitem', { name: 'Alpha' })).toHaveClass('folder-context-menu__item--active')

    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    // Clamped at first
    expect(screen.getByRole('menuitem', { name: 'Alpha' })).toHaveClass('folder-context-menu__item--active')
  })

  it('fires onSelect when Enter is pressed on the active item', () => {
    const onSelect = vi.fn()
    const items: ContextMenuItem[] = [
      { label: 'One' },
      { label: 'Two' },
    ]
    renderMenu(items, { x: 50, y: 50 }, onSelect)
    const menu = screen.getByRole('menu')

    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    fireEvent.keyDown(menu, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('fires onSelect when Space is pressed on the active item', () => {
    const onSelect = vi.fn()
    const items: ContextMenuItem[] = [{ label: 'Launch' }]
    renderMenu(items, { x: 50, y: 50 }, onSelect)
    fireEvent.keyDown(screen.getByRole('menu'), { key: ' ' })
    expect(onSelect).toHaveBeenCalledWith(0)
  })

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    renderMenu([{ label: 'Exit' }], { x: 50, y: 50 }, vi.fn(), onClose)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when a click occurs outside the menu', () => {
    const onClose = vi.fn()
    renderMenu([{ label: 'Outside' }], { x: 50, y: 50 }, vi.fn(), onClose)
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not call onClose when clicking inside the menu', () => {
    const onClose = vi.fn()
    const onSelect = vi.fn()
    renderMenu([{ label: 'Inner' }], { x: 50, y: 50 }, onSelect, onClose)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Inner' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(onSelect).toHaveBeenCalledWith(0)
  })

  it('has an aria-label on the menu container', () => {
    renderMenu([{ label: 'Item' }], { x: 50, y: 50 })
    expect(screen.getByRole('menu', { name: 'Folder actions' })).toBeTruthy()
  })
})
