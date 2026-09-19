import { matchPath } from 'react-router-dom'

const APP_NAME = 'Password Manager'

interface RouteTitle {
  pattern: string
  title: string
}

// Ordered so the more specific dynamic pattern is tried before generic fallbacks.
// matchPath matches the whole pathname by default, so each entry is exact.
const ROUTE_TITLES: readonly RouteTitle[] = [
  { pattern: '/login', title: 'Sign in' },
  { pattern: '/unlock', title: 'Unlock vault' },
  { pattern: '/vault', title: 'Vault' },
  { pattern: '/resources/:id', title: 'Resource' },
  { pattern: '/folders', title: 'Folders' },
  { pattern: '/tags', title: 'Tags' },
  { pattern: '/settings', title: 'Settings' },
  { pattern: '/generator', title: 'Password generator' },
]

/**
 * Maps a route pathname to a document title (WCAG 2.4.2 Page Titled). Unknown
 * paths fall back to the app name so the title is never empty.
 */
export function titleFor(pathname: string): string {
  for (const { pattern, title } of ROUTE_TITLES) {
    if (matchPath(pattern, pathname)) return `${title} · ${APP_NAME}`
  }
  return APP_NAME
}
