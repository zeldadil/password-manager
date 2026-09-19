import axe from 'axe-core'
import { fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { routes } from '../routes'
import { HTML_LANG, INDEX_HTML, JSDOM_UNAVAILABLE_RULES, formatViolations, runAxe } from './axe'

/**
 * FE-001k — axe-core sweep over every route.
 *
 * Acceptance criterion: *axe-core on all routes, zero violations*.
 *
 * What a green run means here, and how it can fail:
 *
 * - Every route the route table owns is rendered through the real router and
 *   graded by axe-core with axe's default rule set (WCAG + best practice). The eight
 *   screens are covered, plus the two fail-closed guards (`/` and the `*` catch-all)
 *   so the redirect targets are graded as they actually resolve.
 * - A route passes on `violations.length === 0` **and** `incomplete.length === 0`.
 *   `incomplete` is axe saying "I could not decide" — counting it as a pass is how a
 *   "zero violations" claim turns vacuous (see the `landmark-one-main` note in
 *   `./axe.ts`: axe skips it under jsdom unless the hit-test stub is installed).
 * - A vacuity guard asserts the run actually graded rules, and that a named set of
 *   rules every route must satisfy shows up in `passes`. A mis-wired harness that
 *   graded nothing cannot report green.
 * - `harness sensitivity` injects known defects into a real route and asserts the
 *   sweep reports them under the expected rule id. The deliverable is a *check*, so
 *   the check has to be shown to be able to fail — otherwise "zero violations" only
 *   proves the harness ran without comparing anything.
 *
 * Boundary (documented, not waived): jsdom has no layout engine and no canvas, so
 * contrast (WCAG 1.4.3) and target size (WCAG 2.5.8) cannot be evaluated here. Those
 * two rules are disabled by name in `./axe.ts` — and `JSDOM_UNAVAILABLE_RULES` is
 * asserted against axe's own rule registry below so the exclusion list can never
 * silently disable a rule that does not exist. Stylesheets are not loaded by the
 * test environment either, so this sweep grades structure, landmarks, names, roles
 * and states — not rendered appearance.
 */

interface RouteCase {
  path: string
  screen: string
  /** Where the guard/redirect lands — asserted so a route sweep can't silently drift. */
  resolved: string
}

const ROUTES: readonly RouteCase[] = [
  { path: '/login', screen: 'Login (pre-auth)', resolved: '/login' },
  { path: '/unlock', screen: 'Unlock (pre-auth)', resolved: '/unlock' },
  { path: '/vault', screen: 'Vault', resolved: '/vault' },
  { path: '/resources/res-123', screen: 'Resource detail', resolved: '/resources/res-123' },
  { path: '/folders', screen: 'Folders', resolved: '/folders' },
  { path: '/tags', screen: 'Tags', resolved: '/tags' },
  { path: '/settings', screen: 'Settings', resolved: '/settings' },
  { path: '/generator', screen: 'Password generator', resolved: '/generator' },
  { path: '/', screen: 'root guard', resolved: '/login' },
  { path: '/no/such/route', screen: 'not-found guard', resolved: '/login' },
]

/**
 * Rules that must be in `passes` on every route. Each one is a rule this app is
 * expected to satisfy by construction: a titled document, a declared language, one
 * `<main>` landmark per page, one `<h1>` per page, all content inside a landmark,
 * a bare HTML shell that cannot be scrolled into a trap, and a skip link.
 */
const REQUIRED_PASSES: readonly string[] = [
  'document-title',
  'html-has-lang',
  'html-lang-valid',
  'landmark-main-is-top-level',
  'landmark-no-duplicate-main',
  'landmark-one-main',
  'landmark-unique',
  'page-has-heading-one',
  'heading-order',
  'bypass',
  'region',
]

/** Minimum graded-rule count, so a run that graded (almost) nothing fails loudly. */
const MIN_GRADED_RULES = 20

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

/** Applies a DOM mutation for a single axe run and always undoes it. */
async function axeWithMutation(mutate: () => () => void) {
  const undo = mutate()
  try {
    return await runAxe()
  } finally {
    undo()
  }
}

describe('axe-core — zero violations on every route', () => {
  it.each(ROUTES)('$path ($screen)', async ({ path, resolved }) => {
    const router = renderAt(path)

    // Guard resolution first: sweeping the wrong screen would make the rest moot.
    expect(router.state.location.pathname).toBe(resolved)

    const results = await runAxe()

    // Formatted so a failure names the rule, the impact and the offending node.
    expect(formatViolations(results)).toBe('')
    expect(results.violations).toEqual([])

    // "axe could not decide" is not a pass.
    expect(results.incomplete.map((result) => result.id)).toEqual([])

    // Vacuity guard: the sweep graded a real rule set, including the rules that
    // define this app's page structure.
    const graded = results.passes.map((result) => result.id)
    expect(graded.length).toBeGreaterThanOrEqual(MIN_GRADED_RULES)
    for (const rule of REQUIRED_PASSES) {
      expect(graded, `${rule} did not pass on ${path}`).toContain(rule)
    }
  })

  it('grades the shell with the user disclosure open as well', async () => {
    renderAt('/vault')
    fireEvent.click(screen.getByRole('button', { name: 'Account' }))
    expect(screen.getByRole('link', { name: 'Settings' })).toBeTruthy()

    const results = await runAxe()

    expect(formatViolations(results)).toBe('')
    expect(results.incomplete.map((result) => result.id)).toEqual([])
  })
})

describe('axe-core harness — the sweep can actually fail', () => {
  // Each case injects one known defect into a real route and asserts the rule that
  // is supposed to catch it. Without these, "zero violations" would also be
  // satisfied by a harness that graded nothing. Mutations are undone in
  // `axeWithMutation`, so the results here cannot leak into another test.
  it.each<{ name: string; rule: string; mutate: () => () => void }>([
    {
      name: 'missing <h1>',
      rule: 'page-has-heading-one',
      mutate: () => {
        const heading = document.querySelector('main h1')
        const parent = heading?.parentNode
        const next = heading?.nextSibling ?? null
        heading?.remove()
        return () => {
          if (heading && parent) parent.insertBefore(heading, next)
        }
      },
    },
    {
      name: 'no <main> landmark',
      rule: 'landmark-one-main',
      mutate: () => {
        const main = document.querySelector('main')
        if (!main) throw new Error('expected a <main> landmark to strip')
        const replacement = document.createElement('div')
        replacement.append(...Array.from(main.childNodes))
        main.replaceWith(replacement)
        return () => replacement.replaceWith(main)
      },
    },
    {
      name: 'image without alt text',
      rule: 'image-alt',
      mutate: () => {
        const image = document.createElement('img')
        image.src = '/logo.png'
        document.querySelector('main')?.append(image)
        return () => image.remove()
      },
    },
    {
      name: 'button without an accessible name',
      rule: 'button-name',
      mutate: () => {
        const button = document.createElement('button')
        button.type = 'button'
        document.querySelector('main')?.append(button)
        return () => button.remove()
      },
    },
  ])('reports $name as $rule', async ({ rule, mutate }) => {
    renderAt('/vault')
    expect(formatViolations(await runAxe())).toBe('')

    const mutated = await axeWithMutation(mutate)

    expect(mutated.violations.map((violation) => violation.id)).toContain(rule)
  })
})

describe('axe-core harness — document and rule-set integrity', () => {
  it('mirrors the production <html lang> from index.html instead of inventing one', async () => {
    // The production document is index.html; the test runner never loads it, so the
    // harness applies its language. That is only honest while index.html declares
    // one — assert the source of truth, not just the copy.
    expect(INDEX_HTML).toMatch(/<html[^>]*\blang="[^"]+"/)
    expect(HTML_LANG).not.toBe('')

    renderAt('/vault')
    await runAxe()

    expect(document.documentElement.getAttribute('lang')).toBe(HTML_LANG)
  })

  it('declares no non-empty <title> in the source document that the app must override', () => {
    // `document-title` is graded against the title the app sets per route
    // (RouteFocusManager), so index.html carries only the app-name fallback.
    expect(INDEX_HTML).toMatch(/<title>\s*\S[\s\S]*?<\/title>/)
  })

  it('only excludes rules that exist in axe, so the exclusion list cannot rot', () => {
    const known = new Set(axe.getRules().map((rule) => rule.ruleId))
    for (const rule of JSDOM_UNAVAILABLE_RULES) {
      expect(known, `${rule} is not an axe rule`).toContain(rule)
    }
  })

  it('does not run the rules that jsdom cannot evaluate', async () => {
    renderAt('/vault')
    const results = await runAxe()
    const graded = [
      ...results.violations,
      ...results.passes,
      ...results.incomplete,
      ...results.inapplicable,
    ].map((result) => result.id)

    for (const rule of JSDOM_UNAVAILABLE_RULES) {
      expect(graded).not.toContain(rule)
    }
  })
})
