/** @fileoverview Folder context menu — right-click / keyboard-activated menu
 * for folder operations (create, rename, delete, move) in the sidebar.
 *
 * FE-003g. Opens on right-click or Shift+F10 on a folder row; closes on
 * Escape, outside click, or selection. Each item drives a callback the
 * parent (Sidebar / FolderTree) wires.
 *
 * ARIA: role="menu" with menuitem children, arrow-key navigation, Escape to
 * close. Focus is managed so screen readers announce the menu as a popup.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export interface FolderContextMenuProps {
  /** Folder the menu is open for. */
  folder: { id: string; name: string }
  /** Where to anchor the menu (row center, bottom). */
  position: { x: number; y: number }
  /** Called when "Create subfolder" is chosen. */
  onAddSubfolder: () => void
  /** Called when "Rename" is chosen — receives proposed new name (empty = cancel). */
  onRename: (newName: string) => void
  /** Called when "Move" is chosen — the UI resolves the target, then calls back. */
  onMove: () => void
  /** Called when "Delete" is chosen. */
  onDelete: () => void
  /** Called when the menu should close. */
  onClose: () => void
}

const items = [
  { label: 'Create subfolder', action: 'addSubfolder' as const },
  { label: 'Rename…', action: 'rename' as const },
  { label: 'Move…', action: 'move' as const },
  { label: 'Delete…', action: 'delete' as const },
] as const

type MenuItemAction = (typeof items)[number]['action']

export default function FolderContextMenu({
  folder,
  position,
  onAddSubfolder,
  onRename,
  onMove,
  onDelete,
  onClose,
}: FolderContextMenuProps) {
  const [focusedIndex, setFocusedIndex] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Keep focus inside the menu while open.
  useEffect(() => {
    triggerRef.current?.focus()
  }, [])

  // Close on Escape.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIndex((prev) => {
          const next =
            e.key === 'ArrowDown'
              ? (prev + 1) % items.length
              : (prev - 1 + items.length) % items.length
          return next
        })
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        handleAction(items[focusedIndex].action)
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [focusedIndex, onClose, onAddSubfolder, onRename, onMove, onDelete, folder.id])

  // Clamp focus when items array changes (stable here, but defensive).
  useEffect(() => {
    setFocusedIndex((i) => Math.min(i, items.length - 1))
  }, [items.length])

  const handleAction = useCallback(
    (action: MenuItemAction) => {
      switch (action) {
        case 'addSubfolder':
          onAddSubfolder()
          break
        case 'rename':
          onRename('') // caller opens dialog; empty = user cancelled later
          break
        case 'move':
          onMove()
          break
        case 'delete':
          onDelete()
          break
      }
      onClose()
    },
    [onAddSubfolder, onRename, onMove, onDelete, onClose],
  )

  // Close when clicking outside.
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const menu = menuRef.current
      if (menu && !menu.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  return (
    <div
      ref={menuRef}
      className="folder-context-menu"
      role="menu"
      aria-label={`Actions for ${folder.name}`}
      style={{
        left: position.x,
        top: position.y,
        position: 'fixed',
        zIndex: 1000,
      }}
    >
      {items.map((item, index) => {
        const isFocused = index === focusedIndex
        return (
          <button
            key={item.action}
            ref={isFocused ? triggerRef : undefined}
            type="button"
            role="menuitem"
            className={`folder-context-menu__item ${isFocused ? 'folder-context-menu__item--focused' : ''}`}
            onClick={() => handleAction(item.action)}
            onMouseEnter={() => setFocusedIndex(index)}
            aria-selected={isFocused}
            tabIndex={-1}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
