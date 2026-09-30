import { useCallback, useRef, useState } from 'react'
import type { FolderNode } from './types'
import FolderContextMenu from './FolderContextMenu'
import FolderNameDialog from './FolderNameDialog'

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
  // Build a parent lookup map: child id -> parent id
  const parentMap = new Map<string, string | null>()
  for (const [pid, kids] of grouped) {
    for (const kid of kids) {
      parentMap.set(kid.id, pid)
    }
  }
  // Walk up from target to see if source is an ancestor (would create a cycle).
  let current: string | null = targetId
  const seen = new Set<string>()
  while (current !== null) {
    if (current === sourceId) return false
    if (seen.has(current)) break // safety net
    seen.add(current)
    current = parentMap.get(current) ?? null
  }
  return true
}

export interface FolderTreeProps {
  folders?: readonly FolderNode[]
  /** Called when a folder is dropped onto another folder (or the root). */
  onMove?: (sourceId: string, newParentId: string | null) => void
  /** Called when user submits a new subfolder name — parentId is the target parent (null = root). */
  onAddSubfolder?: (parentId: string | null, name: string) => void
  /** Called when user confirms a rename with a new name. */
  onRenameConfirm?: (folderId: string, newName: string) => void
  /** Called when user requests deleting a folder. */
  onDelete?: (folderId: string) => void
}

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
  onContextMenu: (folder: FolderNode, e: React.MouseEvent) => void
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
      className="folder-tree__row folder-tree__item"
      style={{ paddingLeft: `${depth * 16 + 4}px` }}
      onContextMenu={(e) => { e.stopPropagation(); onContextMenu(folder, e) }}
    >
      <div
        className={`folder-tree__row ${isDragged ? 'folder-tree__row--dragged' : ''} ${isDropTarget ? 'drop-target' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
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
        onContextMenu={(e) => {
          e.preventDefault()
          onContextMenu(folder, e)
        }}
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

export default function FolderTree({
  folders = [],
  onMove,
  onAddSubfolder,
  onRenameConfirm,
  onDelete,
}: FolderTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    folder: FolderNode
    x: number
    y: number
  } | null>(null)
  const [createDialog, setCreateDialog] = useState<{ parentId: string | null } | null>(null)
  const [renameDialog, setRenameDialog] = useState<{ folderId: string; currentName: string } | null>(null)
  const [createName, setCreateName] = useState('New folder')
  const [renameName, setRenameName] = useState('')
  const grouped = groupFoldersByParent(folders)
  const wasDraggedId = useRef<string | null>(null)

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
    // Drag end fires mouse events that should close any open context menu.
    setContextMenu(null)
  }, [])

  const handleDragOver = useCallback((targetId: string | null) => {
    setDropTargetId(targetId)
  }, [])

  const handleDrop = useCallback(
    (targetId: string | null) => {
      const sourceId = wasDraggedId.current
      if (sourceId === null) return
      // Dropping on the root (targetId = null) means making it a root folder.
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

  // Close context menu on Escape.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && contextMenu) {
        setContextMenu(null)
        e.preventDefault()
      }
    },
    [contextMenu],
  )

  // Close rename inline input when clicking elsewhere in the tree.
  const handleTreeClick = useCallback(() => {
    // Rename is handled via dialog now; no inline rename state to clear.
  }, [])

  const handleContextMenu = useCallback(
    (folder: FolderNode, e: React.MouseEvent) => {
      // Position menu below and to the right of the cursor, clamped to viewport.
      const menuWidth = 180
      const menuHeight = 120
      const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8)
      const y = Math.min(e.clientY, window.innerHeight - menuHeight - 8)
      setContextMenu({ folder, x: Math.max(8, x), y: Math.max(8, y) })
    },
    [],
  )

  const handleAddSubfolder = useCallback(() => {
    if (!contextMenu) return
    setCreateDialog({ parentId: contextMenu.folder.parentId })
    setCreateName('New folder')
    setContextMenu(null)
  }, [contextMenu])

  const handleRename = useCallback(() => {
    if (!contextMenu) return
    setRenameDialog({
      folderId: contextMenu.folder.id,
      currentName: contextMenu.folder.name,
    })
    setRenameName(contextMenu.folder.name)
    setContextMenu(null)
  }, [contextMenu])

  const handleCreateConfirm = useCallback(() => {
    const trimmed = createName.trim()
    if (trimmed && createDialog) {
      onAddSubfolder?.(createDialog.parentId, trimmed)
    }
    setCreateDialog(null)
    setCreateName('New folder')
  }, [createDialog, createName, onAddSubfolder])

  const handleRenameConfirm = useCallback(() => {
    const trimmed = renameName.trim()
    if (trimmed && renameDialog) {
      onRenameConfirm?.(renameDialog.folderId, trimmed)
    }
    setRenameDialog(null)
    setRenameName('')
  }, [renameDialog, renameName, onRenameConfirm])

  if (folders.length === 0) return null

  return (
    <ul
      className="folder-tree"
      role="tree"
      aria-label="Folders"
      onKeyDown={handleKeyDown}
      onClick={handleTreeClick}
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
          onToggle={toggle}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onContextMenu={handleContextMenu}
        />
      ))}

      {/* Context menu floating popup */}
      {contextMenu && (
        <FolderContextMenu
          folder={contextMenu.folder}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onAddSubfolder={handleAddSubfolder}
          onRename={handleRename}
          onMove={() => onMove?.(contextMenu.folder.id, null)}
          onDelete={() => onDelete?.(contextMenu.folder.id)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Create subfolder dialog */}
      {createDialog && (
        <FolderNameDialog
          title="Create subfolder"
          initialName={createName}
          onChange={setCreateName}
          onConfirm={handleCreateConfirm}
          onClose={() => {
            setCreateDialog(null)
            setCreateName('New folder')
          }}
        />
      )}

      {/* Rename folder dialog */}
      {renameDialog && (
        <FolderNameDialog
          title="Rename folder"
          initialName={renameName}
          onChange={setRenameName}
          onConfirm={handleRenameConfirm}
          onClose={() => {
            setRenameDialog(null)
            setRenameName('')
          }}
        />
      )}
    </ul>
  )
}
