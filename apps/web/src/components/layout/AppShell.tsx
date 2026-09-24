import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { useThemeStore } from '../../stores/themeStore'
import { MAIN_CONTENT_ID } from '../../a11y/RouteFocusManager'
import Header from './Header'
import Sidebar from './Sidebar'
import AutoLockBanner from '../AutoLockBanner'
import { useSession } from '../../auth/SessionProvider'
import type { FolderNode, TagNode } from './types'
import './layout.css'

export interface AppShellProps {
  appName?: string
  userName?: string
  folders?: readonly FolderNode[]
  tags?: readonly TagNode[]
}

export default function AppShell({ appName, userName, folders, tags }: AppShellProps) {
  const theme = useThemeStore((s) => s.theme)
  const { active } = useSession()

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
      <Header appName={appName} userName={userName} />
      <Sidebar folders={folders} tags={tags} />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="app-main">
        {active && <AutoLockBanner />}
        <Outlet />
      </main>
    </div>
  )
}
