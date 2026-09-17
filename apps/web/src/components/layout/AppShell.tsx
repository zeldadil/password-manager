import { Outlet } from 'react-router-dom'
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
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
