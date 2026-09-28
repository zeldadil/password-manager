import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react'
import type { FolderNode } from './types'
import { deleteFolder, renameFolder, moveFolder, createFolder } from '../../api/folders'
import type { ApiClient } from '../../api/client'

// ── Helpers ────────────────────────────────────────────────────────────────────

function groupFoldersByParent(folders: readonly FolderNode[]): Map<string | null, FolderNode[]> {
  const grouped = new Map<string | null, FolderNode[]>()
  for (const folder of folders) {
    const key = folder.parentId ?? null
    const siblings = grouped.get(key)
    if (siblings) siblings.push(folder)
    else grouped.set(key, [folder])
  }
  return grouped
}

function canAcceptDrop(
  sourceId: string,
  targetId: string | null,
  grouped: Map<string | null, FolderNode[]>,
): boolean {
  if (sourceId === targetId) return false
  const parentMap = new Map<string, string | null>()
  for (const [pid, kids] of grouped) {
    for (const kid of kids) {
      parentMap.set(kid.id, pid)
    }
  }
  let current: string | null = targetId
  const seen = new Set<string>()
  while (current !== null) {
    if (current === sourceId) return false
    if (seen.has(current)) break
    seen.add(current)
    current = parentMap.get(current) ?? null
  }
  return true
}

// ── Context menu item type ─────────────────────────────────────────────────────

interface ContextMenuItem {
  type: 'item'
  label: string
  danger?: boolean
  shortcut?: string
  onClick: () => void
}

// ── Inline dialog ──────────────────────────────────────────────────────────────

interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer: ReactNode
}

function Dialog({ open, onClose, title, children, footer }: DialogProps) {
  useEffect(() => {
    if (!open) return
    const prev = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    const t = setTimeout(() => {
      const el = document.querySelector('[data-dialog-focus]')
      ;(el as HTMLElement | null)?.focus()
    }, 0)
    return () => {
      document.documentElement.style.overflow = prev
      clearTimeout(t)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="folder-dialog-backdrop"
      onClick={(e) => {
        if ((e.target as HTMLElement).classList.contains('folder-dialog-backdrop')) onClose()
      }}
    >
      <div
        className="folder-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-dialog-title"
        data-dialog-focus
      >
        <h2 id="folder-dialog-title" className="folder-dialog__title">{title}</h2>
        <div className="folder-dialog__body">{children}</div>
        {footer && <div className="folder-dialog__footer">{footer}</div>}
      </div>
    </div>
  )
}

// ── Context menu ───────────────────────────────────────────────────────────────

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

function ContextMenu({ x, y, items, onClose }: ContextMenuProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = x
    let top = y
    if (left + r.width > vw - 8) left = vw - r.width - 8
    if (top + r.height > vh - 8) top = vh - r.height - 8
    if (left < 8) left = 8
    if (top < 8) top = 8
    ref.current.style.left = `${left}px`
    ref.current.style.top = `${top}px`
  }, [x, y])

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    const handler = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  if (items.length === 0) return null

  return (
    <div
      ref={ref}
      className="folder-context-menu"
      role="menu"
      aria-label="Folder actions"
      data-dialog-focus
    >
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          className={[
            'folder-context-menu__item',
            it.danger ? 'folder-context-menu__item--danger' : '',
          ].filter(Boolean).join(' ')}
          role="menuitem"
          onClick={() => { it.onClick(); onClose() }}
        >
          <span className="folder-context-menu__label">{it.label}</span>
          {it.shortcut && <span className="folder-context-menu__shortcut">{it.shortcut}</span>}
        </button>
      ))}
    </div>
  )
}

// ── Drag-drop tree node (from FE-003b / master) ───────────────────────────────

interface TreeNodeProps {
  folder: FolderNode
  depth: number
  expandedIds: Set<string>
  grouped: Map<string | null, FolderNode[]>
  draggedId: string | null
  dropTargetId: string | null
  onToggle: (id: string) => void
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDragOver: (targetId: string | null) => void
  onDrop: (targetId: string | null) => void
  onContextMenu: (folder: FolderNode, e: React.MouseEvent<HTMLLIElement>) => void
}

function TreeNode({
  folder,
  depth,
  expandedIds,
  grouped,
  draggedId,
  dropTargetId,
  onToggle,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onContextMenu,
}: TreeNodeProps) {
  const isExpanded = expandedIds.has(folder.id)
  const children = grouped.get(folder.id) ?? []
  const hasChildren = children.length > 0
  const isDragged = folder.id === draggedId
  const isDropTarget = !isDragged && dropTargetId === folder.id

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      onDragOver(folder.id)
    },
    [folder.id, onDragOver],
  )

  const handleDragLeave = useCallback(() => {
    onDragOver(null)
  }, [onDragOver])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onDrop(folder.id)
    },
    [folder.id, onDrop],
  )

  return (
    <li
      role="treeitem"
      aria-level={depth + 1}
      aria-labelledby={`folder-tree-item-${folder.id}`}
      className="folder-tree__item"
      style={{ paddingLeft: `${depth * 16 + 4}px` }}
      onContextMenu={(e) => { e.stopPropagation(); onContextMenu(folder, e) }}
    >
      <div
        className={`folder-tree__row ${isDragged ? 'folder-tree__row--dragged' : ''} ${isDropTarget ? 'drop-target' : ''}`}
        draggable={true}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', folder.id)
          onDragStart(folder.id)
        }}
        onDragEnd={onDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {hasChildren ? (
          <button
            type="button"
            className="folder-tree__toggle"
            onClick={() => onToggle(folder.id)}
            aria-label={isExpanded ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
            aria-expanded={isExpanded}
            aria-controls={`folder-tree-children-${folder.id}`}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable={false}>
              <path
                d={isExpanded ? 'M2 4L5 7L8 4' : 'M5 2L8 5L5 8'}
                stroke="currentColor"
                strokeWidth="1.5"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : (
          <span className="folder-tree__spacer" aria-hidden="true" />
        )}
        <span className="folder-tree__name" id={`folder-tree-item-${folder.id}`}>
          {folder.name}
        </span>
      </div>
      {isExpanded && hasChildren && (
        <ul className="folder-tree__children" role="group" id={`folder-tree-children-${folder.id}`}>
          {children.map((child) => (
            <TreeNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              grouped={grouped}
              draggedId={draggedId}
              dropTargetId={dropTargetId}
              onToggle={onToggle}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onContextMenu={onContextMenu}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export interface FolderTreeProps {
  folders?: readonly FolderNode[]
  /** Called when a folder is dropped onto another folder (or the root). */
  onMove?: (sourceId: string, newParentId: string | null) => void
  /** Called after any mutation so the parent can re-fetch. */
  onFoldersChanged?: () => void
  /** ApiClient instance for CRUD ops. Provided by the page container. */
  client: ApiClient
  /** Vault id passed to folder CRUD endpoints. */
  vaultId: string
  /** Flat list of all folders for the move-dialog target selector.
   *  Omit to disable the move action. */
  allFolders?: readonly FolderNode[]
}

export default function FolderTree({
  folders = [],
  onMove,
  onFoldersChanged,
  client,
  vaultId,
  allFolders,
}: FolderTreeProps) {
  const grouped = groupFoldersByParent(folders)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const wasDraggedId = useRef<string | null>(null)

  // ── Context menu state ──────────────────────────────────────────────────────

  const [contextMenu, setContextMenu] = useState<{
    folder: FolderNode
    x: number
    y: number
  } | null>(null)

  const [dialog, setDialog] = useState<{
    mode: 'create' | 'rename' | 'move' | 'delete'
    folder?: FolderNode
    parentId?: string | null
  } | null>(null)

  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [targetParentId, setTargetParentId] = useState<string | null | undefined>(undefined)
  const nameRef = useRef<HTMLInputElement>(null)

  // ── Drag-drop handlers ──────────────────────────────────────────────────────

  const toggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleDragStart = useCallback((id: string) => {
    setDraggedId(id)
    wasDraggedId.current = id
  }, [])

  const handleDragEnd = useCallback(() => {
    setDraggedId(null)
    setDropTargetId(null)
    wasDraggedId.current = null
  }, [])

  const handleDragOver = useCallback((targetId: string | null) => {
    setDropTargetId(targetId)
  }, [])

  const handleDrop = useCallback(
    (targetId: string | null) => {
      const sourceId = wasDraggedId.current
      if (sourceId === null) return
      if (targetId === null) {
        onMove?.(sourceId, null)
        return
      }
      if (canAcceptDrop(sourceId, targetId, grouped)) {
        onMove?.(sourceId, targetId)
      }
      setDropTargetId(null)
    },
    [grouped, onMove],
  )

  // ── Context menu handlers ───────────────────────────────────────────────────

  const openContextMenu = useCallback((folder: FolderNode, e: React.MouseEvent<HTMLLIElement>) => {
    e.preventDefault()
    setContextMenu({ folder, x: e.clientX, y: e.clientY })
  }, [])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const buildMenuItems = useCallback((folder: FolderNode): ContextMenuItem[] => {
    const items: ContextMenuItem[] = []
    items.push({
      type: 'item',
      label: 'New subfolder',
      shortcut: 'Ctrl+Shift+N',
      onClick: () => {
        closeContextMenu()
        setDialog({ mode: 'create', parentId: folder.id })
        setName('')
        setError(null)
      },
    })
    items.push({
      type: 'item',
      label: 'Rename…',
      shortcut: 'F2',
      onClick: () => {
        closeContextMenu()
        setDialog({ mode: 'rename', folder })
        setName(folder.name)
        setError(null)
      },
    })
    items.push({
      type: 'item',
      label: 'Move to…',
      shortcut: 'Ctrl+M',
      onClick: () => {
        closeContextMenu()
        setDialog({ mode: 'move', folder, parentId: folder.parentId })
        setName('')
        setError(null)
      },
    })
    items.push({
      type: 'item',
      label: 'Delete…',
      danger: true,
      shortcut: 'Del',
      onClick: () => {
        closeContextMenu()
        setDialog({ mode: 'delete', folder })
        setName('')
        setError(null)
      },
    })
    return items
  }, [closeContextMenu])

  // ── Dialog actions ──────────────────────────────────────────────────────────

  const currentFolder = dialog?.folder
  const submitDialog = useCallback(async () => {
    if (!dialog || !vaultId) return
    const trimmed = name.trim()
    if (!trimmed && (dialog.mode === 'create' || dialog.mode === 'rename')) { setError('Name is required'); return }
    if (trimmed.length > 255) { setError('Name must be 255 characters or fewer'); return }

    try {
      if (dialog.mode === 'create') {
        await createFolder(client, { vaultId, name: trimmed, parentId: dialog.parentId ?? null })
      } else if (dialog.mode === 'rename') {
        await renameFolder(client, dialog.folder!.id, trimmed)
      } else if (dialog.mode === 'move') {
        const target = targetParentId ?? dialog.parentId
        await moveFolder(client, dialog.folder!.id, target ?? null)
      } else if (dialog.mode === 'delete') {
        await deleteFolder(client, dialog.folder!.id)
      }
      setDialog(null)
      onFoldersChanged?.()
    } catch (err: any) {
      setError(err?.message ?? 'Operation failed')
    }
  }, [dialog, name, vaultId, client, onFoldersChanged, targetParentId])

  const handleNameKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); submitDialog() }
    else if (e.key === 'Escape') setDialog(null)
  }, [submitDialog])

  // ── Render ──────────────────────────────────────────────────────────────────

  const rootChildren = grouped.get(null) ?? []
  const menuItems = contextMenu ? buildMenuItems(contextMenu.folder) : []
  const showPlus = contextMenu === null && dialog === null
  const dialogFolderName = currentFolder?.name ?? ''

  return (
    <>
      <ul
        className="folder-tree"
        role="tree"
        aria-label="Folders"
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(e) => {
          e.stopPropagation()
          e.preventDefault()
          handleDrop(null)
        }}
      >
        {rootChildren.map((folder) => (
          <TreeNode
            key={folder.id}
            folder={folder}
            depth={0}
            expandedIds={expandedIds}
            grouped={grouped}
            draggedId={draggedId}
            dropTargetId={dropTargetId}
            onToggle={toggle}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onContextMenu={openContextMenu}
          />
        ))}
      </ul>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={closeContextMenu}
        />
      )}

      {/* Inline dialog */}
      <Dialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={
          dialog ? ({
            create: 'New subfolder',
            rename: 'Rename folder',
            move: 'Move folder',
            delete: 'Delete folder',
          }[dialog.mode]) : ''
        }
        footer={
          <>
            <button type="button" className="folder-dialog__btn folder-dialog__btn--cancel" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="folder-dialog__btn folder-dialog__btn--primary"
              onClick={submitDialog}
              disabled={false}
            >
              {dialog ? ({
                create: 'Create',
                rename: 'Rename',
                move: 'Move',
                delete: 'Delete',
              }[dialog.mode]) : ''}
            </button>
          </>
        }
      >
        {dialog && (
          <>
            {dialog.mode !== 'delete' && (
              <>
                <label htmlFor="folder-dialog-name" className="folder-dialog__label">
                  {dialog.mode === 'create' ? 'Folder name' : dialog.mode === 'rename' ? 'New name' : 'Target folder'}
                </label>
                <input
                  id="folder-dialog-name"
                  ref={nameRef}
                  type="text"
                  className="folder-dialog__input"
                  value={name}
                  onChange={(e) => { setName(e.target.value); setError(null) }}
                  onKeyDown={handleNameKeyDown}
                  autoFocus
                  disabled={dialog.mode === 'move'}
                  aria-describedby={error ? 'folder-dialog-error' : undefined}
                />
              </>
            )}
            {dialog?.mode === 'move' && (
              <div className="folder-dialog__move-hint">
                {dialog.parentId === null
                  ? 'Move to vault root'
                  : `Currently: ${dialogFolderName}`}
              </div>
            )}
            {dialog?.mode === 'move' && (
              <label htmlFor="folder-dialog-target" className="folder-dialog__label">
                Target parent
              </label>
            )}
            {dialog?.mode === 'move' && (
              <select
                id="folder-dialog-target"
                className="folder-dialog__input"
                value={targetParentId ?? ''}
                onChange={(e) => setTargetParentId(e.target.value || null)}
                autoFocus={false}
                aria-describedby={error ? 'folder-dialog-error' : undefined}
              >
                <option value="">— Vault root —</option>
                {(allFolders ?? folders)
                  .filter((f) => f.id !== currentFolder?.id)
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
              </select>
            )}
            {error && (
              <p id="folder-dialog-error" className="folder-dialog__error" role="alert">{error}</p>
            )}
            {dialog?.mode === 'delete' && currentFolder && (
              <p className="folder-dialog__confirm">
                Delete &ldquo;<strong>{currentFolder.name}</strong>&rdquo; and all its subfolders? This cannot be undone.
              </p>
            )}
          </>
        )}
      </Dialog>

      {/* Root-level create button */}
      {showPlus && (
        <button
          type="button"
          className="folder-tree__create-root"
          onClick={() => { setDialog({ mode: 'create', parentId: null }); setName(''); setError(null) }}
          aria-label="Create root-level folder"
        >
          + New folder
        </button>
      )}
    </>
  )
}
