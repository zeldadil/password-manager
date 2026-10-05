import { createPortal } from 'react-dom'
import { useCallback, useEffect, useRef, useState } from 'react'

export interface ContextMenuItem {
  label: string
  danger?: boolean
  disabled?: boolean
  shortcut?: string
  action?: string
}

export interface ContextMenuProps {
  items: ContextMenuItem[]
  position: { x: number; y: number } | null
  onSelect: (index: number) => void
  onClose: () => void
}

export default function ContextMenu({
  items,
  position,
  onSelect,
  onClose,
}: ContextMenuProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Clamp active index when items change
  useEffect(() => {
    setActiveIndex((prev) => Math.min(prev, Math.max(0, items.length - 1)))
  }, [items.length])

  // Close on outside click / Escape
  useEffect(() => {
    if (position === null) return

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (menuRef.current && !menuRef.current.contains(target)) {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKey)
    document.addEventListener('mousedown', handleClick)
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [position, onClose])

  // Scroll active item into view (jsdom has no scrollIntoView — guard).
  useEffect(() => {
    const el = itemRefs.current[activeIndex]
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, items.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect(activeIndex)
      }
    },
    [activeIndex, items.length, onSelect],
  )

  if (position === null || items.length === 0) return null

  const menu = (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Folder actions"
      className="folder-context-menu"
      onKeyDown={handleKeyDown}
    >
      {items.map((item, i) => (
        <button
          key={i}
          ref={(el) => { itemRefs.current[i] = el }}
          type="button"
          role="menuitem"
          className={`folder-context-menu__item ${item.danger ? 'folder-context-menu__item--danger' : ''} ${i === activeIndex ? 'folder-context-menu__item--active' : ''}`}
          aria-disabled={item.disabled || undefined}
          disabled={item.disabled}
          onClick={() => onSelect(i)}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseEnter={() => setActiveIndex(i)}
        >
          <span className="folder-context-menu__label">{item.label}</span>
          {item.shortcut && (
            <span className="folder-context-menu__shortcut" aria-hidden="true">{item.shortcut}</span>
          )}
        </button>
      ))}
    </div>
  )

  return createPortal(menu, document.body)
}
