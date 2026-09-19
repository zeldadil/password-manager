import { Outlet } from 'react-router-dom'
import RouteFocusManager from './RouteFocusManager'
import SkipLink from './SkipLink'

/**
 * Root layout route. Mounts the accessibility baseline once for every screen —
 * both the authenticated shell and the standalone pre-auth pages — and renders
 * the matched route below it. Keeps the skip link and focus/announcement logic
 * out of the feature components it serves.
 */
export default function A11yLayout() {
  return (
    <>
      <SkipLink />
      <RouteFocusManager />
      <Outlet />
    </>
  )
}
