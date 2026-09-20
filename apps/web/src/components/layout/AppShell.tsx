import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { useThemeStore } from '../../stores/themeStore'
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
 *
 * On mount and whenever the theme changes, syncs `useThemeStore.theme` to
 * `document.documentElement.dataset.theme` and `meta[name=color-scheme]` so the
 * CSS theme variables and the OS-level color-scheme hint both track the store
 * (FE-001d / FE-001l).
 */
export default function AppShell({
  appName,
  userName,
  folders,
  tags,
  onLock,
  onSignOut,
}: AppShellProps) {
  const theme = useThemeStore((s) => s.theme)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme

    let meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'color-scheme'
      document.head.appendChild(meta)
    }
    meta.content = theme === 'dark' ? 'dark' : 'light'
  }, [theme])

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
