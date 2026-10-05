import { useCallback, useState } from 'react'
import type { FolderNode } from './types'
import ContextMenu, { type ContextMenuItem } from './ContextMenu'

/** Groups folders by `parentId` (`null` = vault root) so the tree can render level by level. */
function groupFoldersByParent(folders: readonly FolderNode[]): Map<string | null, FolderNode[]> {
  const grouped = new Map<string | null, FolderNode[]>()
  for (const folder of folders) {
    const key = folder.parentId ?? null
    const siblings = grouped.get(key)
    if (siblings) {
      siblings.push(folder)
    } else {
      grouped.set(key, [folder])
    }
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

export interface FolderTreeProps {
  folders?: readonly FolderNode[]
  /** Called when a folder is dropped onto another folder (or the root). */
  onMove?: (sourceId: string, newParentId: string | null) => void
  /** Called when the user requests creating a new folder (parentId is the context folder, or null for root). */
  onCreate?: (parentId: string | null) => void
  /** Called when the user renames a folder. `newName` must be non-empty. */
  onRename?: (folderId: string, newName: string) => void
  /** Called when the user deletes a folder. */
  onDelete?: (folderId: string) => void
}

/** Build the context menu items for a given target folder id (or null for root). */
function buildContextMenuItems(
  targetId: string | null,
  folders: readonly FolderNode[],
): ContextMenuItem[] {
  const items: ContextMenuItem[] = []
  if (targetId === null) {
    items.push({ label: 'New folder', shortcut: 'Ins', action: 'create' })
  } else {
    items.push({ label: 'Rename', shortcut: 'F2', action: 'rename' })
    items.push({ label: 'Delete', danger: true, action: 'delete' })
    items.push({ label: 'Move to root', action: 'move' })
    items.push({ label: 'New subfolder', shortcut: 'Ins', action: 'create' })
  }
  return items
}

function TreeNode({
  folder,
  depth,
  expandedIds,
  grouped,
  draggedId,
  dropTargetId,
  focusedId,
  contextMenuTargetId,
  renamingId,
  renameValue,
  onToggle,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onFocus,
  setContextMenuPosition,
  setContextMenuTargetId,
  setRenamingId,
  setRenameValue,
  onRenameCommit,
}: {
  folder: FolderNode
  depth: number
  expandedIds: Set<string>
  grouped: Map<string | null, FolderNode[]>
  draggedId: string | null
  dropTargetId: string | null
  focusedId: string | null
  contextMenuTargetId: string | null
  renamingId: string | null
  renameValue: string
  onToggle: (id: string) => void
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDragOver: (targetId: string | null) => void
  onDrop: (targetId: string | null) => void
  onFocus: (id: string) => void
  setContextMenuPosition: (p: { x: number; y: number } | null) => void
  setContextMenuTargetId: (id: string | null) => void
  setRenamingId: (id: string | null) => void
  setRenameValue: (v: string) => void
  onRenameCommit: () => void
}) {
  const isExpanded = expandedIds.has(folder.id)
  const children = grouped.get(folder.id) ?? []
  const hasChildren = children.length > 0
  const isDragged = folder.id === draggedId
  const isDropTarget = !isDragged && dropTargetId === folder.id
  const isFocused = focusedId === folder.id
  const isRenaming = renamingId === folder.id
  const isContextTarget = contextMenuTargetId === folder.id

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const x = Math.min(e.clientX, window.innerWidth - 220)
      const y = Math.min(e.clientY, window.innerHeight - 100)
      setContextMenuPosition({ x, y })
      setContextMenuTargetId(folder.id)
      onFocus(folder.id)
    },
    [folder.id, onFocus, setContextMenuPosition, setContextMenuTargetId],
  )

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onFocus(folder.id)
      setRenamingId(folder.id)
      setRenameValue(folder.name)
    },
    [folder.id, folder.name, onFocus, setRenamingId, setRenameValue],
  )

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        onRenameCommit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setRenamingId(null)
      }
    },
    [onRenameCommit, setRenamingId],
  )

  return (
    <li role="treeitem" aria-level={depth + 1} aria-labelledby={`folder-tree-item-${folder.id}`}>
      <div
        className={`folder-tree__row ${isDragged ? 'folder-tree__row--dragged' : ''} ${isDropTarget ? 'drop-target' : ''} ${isFocused ? 'folder-tree__row--focused' : ''} ${isContextTarget ? 'folder-tree__row--context-target' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        data-folder-id={folder.id}
        draggable={true}
        onClick={() => onFocus(folder.id)}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', folder.id)
          onDragStart(folder.id)
        }}
        onDragEnd={onDragEnd}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          onDragOver(folder.id)
        }}
        onDragLeave={() => onDragOver(null)}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onDrop(folder.id)
        }}
        tabIndex={-1}
      >
        {hasChildren ? (
          <button
            type="button"
            className="folder-tree__toggle"
            onClick={(e) => {
              e.stopPropagation()
              onToggle(folder.id)
            }}
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
        {isRenaming ? (
          <input
            type="text"
            className="folder-tree__rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={onRenameCommit}
            onKeyDown={handleRenameKeyDown}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
            aria-label={`Rename ${folder.name}`}
          />
        ) : (
          <span className="folder-tree__name" id={`folder-tree-item-${folder.id}`}>
            {folder.name}
          </span>
        )}
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
              focusedId={focusedId}
              renamingId={renamingId}
              renameValue={renameValue}
              onToggle={onToggle}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onFocus={onFocus}
              setContextMenuPosition={setContextMenuPosition}
              setContextMenuTargetId={setContextMenuTargetId}
              setRenamingId={setRenamingId}
              setRenameValue={setRenameValue}
              onRenameCommit={onRenameCommit}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export default function FolderTree({
  folders = [],
  onMove,
  onCreate,
  onRename,
  onDelete,
}: FolderTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [contextMenuTargetId, setContextMenuTargetId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const grouped = groupFoldersByParent(folders)

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
  }, [])

  const handleDragEnd = useCallback(() => {
    setDraggedId(null)
    setDropTargetId(null)
  }, [])

  const handleDragOver = useCallback((targetId: string | null) => {
    setDropTargetId(targetId)
  }, [])

  const handleDrop = useCallback(
    (targetId: string | null) => {
      const sourceId = draggedId
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
    [draggedId, grouped, onMove],
  )

  const handleFocus = useCallback((id: string) => {
    setFocusedId(id)
  }, [])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const target = e.target as HTMLElement
      const row = target.closest('.folder-tree__row')
      if (row) {
        const id = row.getAttribute(`data-folder-id`)
        if (id !== contextMenuTargetId) {
          setContextMenuTargetId(id)
        }
      } else {
        setContextMenuTargetId(null)
      }
      const x = Math.min(e.clientX, window.innerWidth - 220)
      const y = Math.min(e.clientY, window.innerHeight - 100)
      setContextMenuPosition({ x, y })
    },
    [contextMenuTargetId, setContextMenuPosition, setContextMenuTargetId],
  )

  const closeContextMenu = useCallback(() => {
    setContextMenuPosition(null)
    setContextMenuTargetId(null)
  }, [])

  const handleRenameCommit = useCallback(() => {
    if (renamingId && renameValue.trim()) {
      onRename?.(renamingId, renameValue.trim())
    }
    setRenamingId(null)
    setRenameValue('')
  }, [renamingId, renameValue, onRename])

  const handleContextMenuSelect = useCallback(
    (index: number) => {
      const targetId = contextMenuTargetId
      const items = buildContextMenuItems(targetId, folders)
      const item = items[index]
      if (!item) return
      if (item.action === 'rename' && targetId) {
        setRenamingId(targetId)
        setRenameValue(folders.find((f) => f.id === targetId)?.name ?? '')
      } else if (item.action === 'move' && targetId) {
        onMove?.(targetId, null)
      } else if (item.action === 'delete' && targetId) {
        onDelete?.(targetId)
      } else if (item.action === 'create') {
        onCreate?.(targetId)
      }
      closeContextMenu()
    },
    [contextMenuTargetId, folders, onCreate, onMove, onDelete, closeContextMenu, setRenamingId, setRenameValue],
  )

  if (folders.length === 0) return null

  const contextItems = buildContextMenuItems(contextMenuTargetId, folders)

  return (
    <ul
      className="folder-tree"
      role="tree"
      aria-label="Folders"
      onContextMenu={handleContextMenu}
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
      {grouped.get(null)?.map((folder) => (
        <TreeNode
          key={folder.id}
          folder={folder}
          depth={0}
          expandedIds={expandedIds}
          grouped={grouped}
          draggedId={draggedId}
          dropTargetId={dropTargetId}
          contextMenuTargetId={contextMenuTargetId}
          focusedId={focusedId}
          renamingId={renamingId}
          renameValue={renameValue}
          onToggle={toggle}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onFocus={handleFocus}
          setContextMenuPosition={setContextMenuPosition}
          setContextMenuTargetId={setContextMenuTargetId}
          setRenamingId={setRenamingId}
          setRenameValue={setRenameValue}
          onRenameCommit={handleRenameCommit}
        />
      ))}
      {contextMenuPosition !== null && contextItems.length > 0 && (
        <ContextMenu
          items={contextItems}
          position={contextMenuPosition}
          onSelect={handleContextMenuSelect}
          onClose={closeContextMenu}
        />
      )}
    </ul>
  )
}
