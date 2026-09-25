import { useCallback, useRef, useState } from 'react'
import type { FolderNode } from './types'

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

function canAcceptDrop(sourceId: string, targetId: string | null, grouped: Map<string | null, FolderNode[]>): boolean {
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
        <span className="folder-tree__name" id={`folder-tree-item-${folder.id}`}>{folder.name}</span>
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
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export default function FolderTree({ folders = [], onMove }: FolderTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
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

  if (folders.length === 0) return null

  return (
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
        />
      ))}
    </ul>
  )
}