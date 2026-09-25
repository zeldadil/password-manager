import FolderTree from './FolderTree'
import TagsList from './TagsList'
import type { FolderNode, TagNode } from './types'

export interface SidebarProps {
  folders?: readonly FolderNode[]
  tags?: readonly TagNode[]
  activeTagId?: string | null
  onMoveFolder?: (sourceId: string, newParentId: string | null) => void
  onFilterTag?: (tagId: string | null) => void
}

export default function Sidebar({
  folders = [],
  tags = [],
  activeTagId,
  onMoveFolder,
  onFilterTag,
}: SidebarProps) {
  return (
    <aside className="app-sidebar" aria-label="Vault navigation">
      <nav className="app-sidebar__section" aria-labelledby="app-sidebar__folders-heading">
        <h2 id="app-sidebar__folders-heading" className="app-sidebar__heading">
          Folders
        </h2>
        <FolderTree folders={folders} onMove={onMoveFolder} />
      </nav>

      <nav className="app-sidebar__section" aria-labelledby="app-sidebar__tags-heading">
        <h2 id="app-sidebar__tags-heading" className="app-sidebar__heading">
          Tags
        </h2>
        <TagsList tags={tags} activeTagId={activeTagId} onFilter={onFilterTag} />
      </nav>
    </aside>
  )
}