import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { titleFor } from './routeTitles'

/** Shared id: the skip link targets it and every <main> landmark carries it. */
export const MAIN_CONTENT_ID = 'main-content'

/**
 * Single-page navigation accessibility baseline:
 *
 * - WCAG 2.4.2 Page Titled — sets `document.title` per route.
 * - WCAG 2.4.3 Focus Order — on route change, moves focus to the main content
 *   landmark (tabIndex -1) so keyboard and screen-reader users start from the new
 *   page's content instead of staying on the link they just activated.
 * - WCAG 4.1.3 Status Messages — announces the new page through a polite live
 *   region. The announcement text is derived during render (not set in an effect),
 *   so it changes on the same render that swaps the page and screen readers pick it
 *   up without an extra render pass.
 *
 * The initial render is deliberately skipped for focus: on first page load the
 * browser's natural focus (the document/address bar) is correct and should not move.
 */
export default function RouteFocusManager() {
  const { pathname } = useLocation()
  const initialPath = useRef(pathname)
  const title = titleFor(pathname)

  useEffect(() => {
    document.title = title

    if (pathname !== initialPath.current) {
      const target = document.getElementById(MAIN_CONTENT_ID)
      target?.focus()
    }
  }, [pathname, title])

  return (
    <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
      {title}
    </div>
  )
}
