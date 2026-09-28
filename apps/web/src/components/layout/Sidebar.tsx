import FolderTree from './FolderTree'
import TagsList from './TagsList'
import type { FolderNode, TagNode } from './types'
import type { ApiClient } from '../../api/client'

export interface SidebarProps {
  folders?: readonly FolderNode[]
  tags?: readonly TagNode[]
  vaultId?: string
  client?: ApiClient
}

export default function Sidebar({
  folders = [],
  tags = [],
  vaultId,
  client,
}: SidebarProps) {
  return (
    <aside className="app-sidebar" aria-label="Vault navigation">
      <nav className="app-sidebar__section" aria-labelledby="app-sidebar__folders-heading">
        <h2 id="app-sidebar__folders-heading" className="app-sidebar__heading">
          Folders
        </h2>
        <FolderTree
          folders={folders}
          vaultId={vaultId ?? ''}
          client={client ?? (undefined as any)}
          onFoldersChanged={() => {}}
        />
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
