import type { ReactNode } from 'react'
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

export interface FolderTreeProps {
  folders?: readonly FolderNode[]
}

/**
 * Renders the vault's folder hierarchy as a nested list. Folder selection (and the
 * vault filtering it drives) is out of scope for the layout task — items render as
 * text so the tree structure is the only thing this component owns.
 */
export default function FolderTree({ folders = [] }: FolderTreeProps) {
  const grouped = groupFoldersByParent(folders)

  const renderLevel = (parentId: string | null): ReactNode => {
    const children = grouped.get(parentId) ?? []
    if (children.length === 0) return null
    return (
      <ul>
        {children.map((folder) => (
          <li key={folder.id}>
            <span>{folder.name}</span>
            {renderLevel(folder.id)}
          </li>
        ))}
      </ul>
    )
  }

  return <>{renderLevel(null)}</>
}
