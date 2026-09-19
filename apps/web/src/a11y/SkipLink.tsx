import { MAIN_CONTENT_ID } from './RouteFocusManager'

/**
 * WCAG 2.4.1 Bypass Blocks. Visually hidden until it receives focus, then shown
 * as the first tab stop so keyboard users can skip the persistent header and
 * sidebar and jump straight to the main content landmark.
 */
export default function SkipLink() {
  return (
    <a className="skip-link" href={`#${MAIN_CONTENT_ID}`}>
      Skip to main content
    </a>
  )
}
