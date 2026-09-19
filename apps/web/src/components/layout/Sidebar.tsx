import FolderTree from './FolderTree'
import TagsList from './TagsList'
import type { FolderNode, TagNode } from './types'

export interface SidebarProps {
  folders?: readonly FolderNode[]
  tags?: readonly TagNode[]
}

export default function Sidebar({ folders = [], tags = [] }: SidebarProps) {
  return (
    <aside className="app-sidebar" aria-label="Vault navigation">
      <nav className="app-sidebar__section" aria-labelledby="app-sidebar__folders-heading">
        <h2 id="app-sidebar__folders-heading" className="app-sidebar__heading">
          Folders
        </h2>
        <FolderTree folders={folders} />
      </nav>

      <nav className="app-sidebar__section" aria-labelledby="app-sidebar__tags-heading">
        <h2 id="app-sidebar__tags-heading" className="app-sidebar__heading">
          Tags
        </h2>
        <TagsList tags={tags} />
      </nav>
    </aside>
  )
}
