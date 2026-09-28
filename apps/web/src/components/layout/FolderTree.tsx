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

// ── Context menu item type ─────────────────────────────────────────────────────

interface ContextMenuItem {
  type: 'item'
  label: string
  danger?: boolean
  shortcut?: string
  onClick: () => void
}

// ── Inline dialog (no external dependency) ─────────────────────────────────────

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

// ── Folder row (recursive) ─────────────────────────────────────────────────────

interface FolderRowProps {
  folder: FolderNode
  depth: number
  isExpanded: boolean
  onToggle: (id: string) => void
  hasChildren: boolean
  grouped: Map<string | null, FolderNode[]>
  onContextMenu: (folder: FolderNode, e: React.MouseEvent<HTMLLIElement>) => void
}

function FolderRow({ folder, depth, isExpanded, onToggle, hasChildren, grouped, onContextMenu }: FolderRowProps) {
  const children = grouped.get(folder.id) ?? []
  const childList = children.length > 0 && isExpanded ? (
    <ul aria-label="Subfolders">
      {children.map((child) => (
        <FolderRow
          key={child.id}
          folder={child}
          depth={depth + 1}
          isExpanded={isExpanded}
          onToggle={onToggle}
          hasChildren={(grouped.get(child.id)?.length ?? 0) > 0}
          grouped={grouped}
          onContextMenu={onContextMenu}
        />
      ))}
    </ul>
  ) : null

  return (
    <li
      className="folder-tree__item"
      style={{ paddingLeft: `${12 + depth * 16}px` }}
      onContextMenu={(e) => { e.stopPropagation(); onContextMenu(folder, e) }}
    >
      <button
        type="button"
        className="folder-tree__toggle"
        aria-expanded={isExpanded}
        aria-controls={`folder-node-${folder.id}`}
        onClick={() => onToggle(folder.id)}
        tabIndex={0}
      >
        <span className="folder-tree__chevron" aria-hidden="true">
          {isExpanded ? '▾' : hasChildren ? '▸' : '·'}
        </span>
      </button>
      <span className="folder-tree__name">{folder.name}</span>
      {childList}
    </li>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export interface FolderTreeProps {
  folders?: readonly FolderNode[]
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

export default function FolderTree({ folders = [], onFoldersChanged, client, vaultId, allFolders }: FolderTreeProps) {
  const grouped = groupFoldersByParent(folders)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
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

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const hasChildren = useCallback(
    (parentId: string | null): boolean => (grouped.get(parentId)?.length ?? 0) > 0,
    [grouped],
  )

  // ── Context menu ────────────────────────────────────────────────────────────

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

  // ── Root-level render ───────────────────────────────────────────────────────

  const rootChildren = grouped.get(null) ?? []

  const menuItems = contextMenu ? buildMenuItems(contextMenu.folder) : []
  const showPlus = contextMenu === null && dialog === null
  const dialogFolderName = currentFolder?.name ?? ''

  return (
    <>
      <div className="folder-tree" role="tree" aria-label="Folders">
        <ul aria-label="Root-level folders">
          {rootChildren.map((folder) => (
            <FolderRow
              key={folder.id}
              folder={folder}
              depth={0}
              isExpanded={expanded.has(folder.id)}
              onToggle={toggle}
              hasChildren={hasChildren(folder.id)}
              grouped={grouped}
              onContextMenu={openContextMenu}
            />
          ))}
        </ul>
      </div>

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
