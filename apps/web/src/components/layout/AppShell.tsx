import { Outlet } from 'react-router-dom'
import { MAIN_CONTENT_ID } from '../../a11y/RouteFocusManager'
import Header from './Header'
import Sidebar from './Sidebar'
import type { FolderNode, TagNode } from './types'
import './layout.css'

export interface AppShellProps {
  appName?: string
  userName?: string
  folders?: readonly FolderNode[]
  tags?: readonly TagNode[]
  onLock?: () => void
  onSignOut?: () => void
}

/**
 * Persistent application shell: header on top, sidebar on the left, and the routed
 * page in the main content area. Used as a React Router layout route so login/unlock
 * can stay outside the shell (they are standalone, pre-auth screens).
 *
 * The main landmark carries the skip-link target id and tabIndex -1 so route-change
 * focus management and the skip link both land on it (see src/a11y/).
 */
export default function AppShell({
  appName,
  userName,
  folders,
  tags,
  onLock,
  onSignOut,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <Header appName={appName} userName={userName} onLock={onLock} onSignOut={onSignOut} />
      <Sidebar folders={folders} tags={tags} />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
