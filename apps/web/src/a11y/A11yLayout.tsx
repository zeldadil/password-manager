import { Outlet } from 'react-router-dom'
import RouteFocusManager from './RouteFocusManager'
import SkipLink from './SkipLink'
import { SessionProvider } from '../auth/SessionProvider'

/**
 * Root layout route. Mounts the accessibility baseline once for every screen —
 * both the authenticated shell and the standalone pre-auth pages — and renders
 * the matched route below it. Keeps the skip link and focus/announcement logic
 * out of the feature components it serves.
 *
 * Also mounts SessionProvider (FE-002c) here, once, for the whole app: every
 * screen — including the pre-auth Login/Unlock pages, which set the session
 * on success — and the authenticated shell (Header, AppShell, AutoLockBanner,
 * all of which call useSession()) live under this single root layout route.
 * SessionProvider calls useNavigate() internally, so it must render inside
 * the router context — this is the outermost point in the tree that already
 * is one, since A11yLayout is itself a layout route under RouterProvider.
 */
export default function A11yLayout() {
  return (
    <SessionProvider>
      <SkipLink />
      <RouteFocusManager />
      <Outlet />
    </SessionProvider>
  )
}
