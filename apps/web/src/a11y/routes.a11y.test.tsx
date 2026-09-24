import axe from 'axe-core'
import { fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, matchPath, type RouteObject } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { routes } from '../routes'
import { SessionProvider } from '../auth/SessionProvider'
import { HTML_LANG, INDEX_HTML, JSDOM_UNAVAILABLE_RULES, formatViolations, runAxe } from './axe'

/** Wraps every child route in SessionProvider so components that call useSession()
 *  (AppShell, AutoLockBanner) render without throwing. SessionProvider calls
 *  useNavigate() internally, so it must live inside the router context — the
 *  RouterProvider owns that context, and SessionProvider is its child.
 *
 *  Returns a new route list whose root layout route holds the wrapped children,
 *  so `createMemoryRouter` receives a valid `RouteObject[]`. */
function wrapRoutes(routeList: RouteObject[]): RouteObject[] {
  const root = routeList[0]
  return [
    {
      ...root,
      children: root.children?.map((child) => ({
        ...child,
        element: (
          <SessionProvider>
            {child.element}
          </SessionProvider>
        ),
      })),
    },
  ]
}

/** Routes with SessionProvider injected at the root so every screen renders
 *  without throwing. The wrapped copy is only used to build the router; the
 *  ROUTES case list — derived from the unwrapped `routes` export — stays the
 *  source of truth for which paths exist, and route coverage (below) is checked
 *  against that same unwrapped export. */
const routesWithSession: RouteObject[] = wrapRoutes(routes)

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
 * - `route coverage` ties that list to `src/routes.tsx` instead of trusting it: the
 *   screen paths are *derived* from the exported route table and matched against the
 *   swept set, in both directions (no declared path unswept, no swept path
 *   undeclared — the latter excludes the declared catch-all pattern, which the
 *   designated `isSplatWitness` case in `ROUTES` represents explicitly, since
 *   every path trivially matches a splat pattern). The route table — not this
 *   file — is therefore the source of truth for what "all routes" means: a
 *   route added to the table without a swept case fails this lane instead of
 *   being graded by nobody, and a stale/renamed swept case fails it too.
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
  /**
   * Set ONLY when `path` is the deliberate witness for a declared catch-all
   * (splat) route pattern, e.g. `'*'` — not a real, concrete declared path of
   * its own. Every path trivially "matches" a splat pattern (that's what a
   * catch-all does), so without this explicit marker the converse coverage
   * spec below could not tell a legitimate catch-all witness apart from a
   * genuinely stale/undeclared swept case — see that spec's comment.
   */
  isSplatWitness?: true
}

/**
 * Cases the sweep grades. This list is not the source of truth for which paths
 * exist — the exported route table (`../routes`) is, and the `route coverage` specs
 * below fail if a path the table declares has no case here (and vice versa).
 *
 * Cases are concrete paths: a parameterised route is swept at a real instance of
 * itself (`/resources/:id` → `/resources/res-123`), and `resolved` records where the
 * router actually lands so the two fail-closed guards are graded at their redirect
 * target rather than at the path that was requested.
 */
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
  {
    path: '/no/such/route',
    screen: 'not-found guard',
    resolved: '/login',
    isSplatWitness: true,
  },
]

/**
 * Screen paths declared by the exported route table (`../routes`), in declaration
 * order, nesting included.
 *
 * A pathless route (an `element`/layout route with children — `A11yLayout` and
 * `AppShell` here) is not a screen: it contributes no path of its own, while its
 * children's paths are still collected. An index route resolves to its parent's path.
 */
function declaredScreenPaths(routeList: readonly RouteObject[], parentPath = ''): string[] {
  const paths: string[] = []
  for (const route of routeList) {
    const path = route.index === true ? parentPath || '/' : joinRoutePath(parentPath, route.path)
    if (path !== undefined) paths.push(path)
    if (route.children) paths.push(...declaredScreenPaths(route.children, path ?? parentPath))
  }
  return paths
}

/** Resolves a child route path against its parent, as react-router nests them. */
function joinRoutePath(parentPath: string, childPath: string | undefined): string | undefined {
  if (childPath === undefined) return undefined
  if (childPath.startsWith('/')) return childPath
  const base = parentPath.endsWith('/') ? parentPath.slice(0, -1) : parentPath
  return `${base}/${childPath}`
}

/** Is `pathname` an instance of the route pattern `pattern`? */
function routeMatches(pattern: string, pathname: string): boolean {
  return matchPath({ path: pattern, end: true }, pathname) !== null
}

/**
 * Is `pattern` a catch-all (splat) route pattern — `'*'`, or ending in `/*'`?
 * A splat pattern matches every pathname by definition (`routeMatches('*', x)`
 * is true for any `x`), which makes it useless as evidence that a *specific*
 * swept path corresponds to a *specific* declared route. The converse
 * coverage spec below excludes splat patterns from that direction of the
 * check for exactly this reason.
 */
function isSplatPattern(pattern: string): boolean {
  return pattern === '*' || pattern.endsWith('/*')
}

/**
 * Rules that must be in `passes` on every route. Each one is a rule this app is
 * expected to satisfy by construction: a titled document, a declared language, one
 * `<main>` landmark per page, one `<h1>` per page, all content inside a landmark
 * (`region`), and no duplicate/nested main landmarks.
 *
 * `bypass` is in the list, but it is not a synonym for "has a skip link": axe grades
 * `bypass` as `any: [internal-link-present, header-present, landmark]`, so the header
 * and sidebar landmarks alone satisfy it on the shell routes. What this lane does and
 * does not catch about the skip link is measured, not assumed
 * (`tests/evidence/t_782802ac/mutations.txt`, probes P1/P2 — both re-runnable):
 *
 * - **P1 — skip link removed from `A11yLayout`**: the six shell routes still pass
 *   (their header/landmarks satisfy `bypass`), but `bypass` drops out of `passes` on the
 *   four pre-auth resolutions (`/login`, `/unlock`, and the two guards that land on
 *   `/login`) — there the skip link is the only bypass mechanism — and the lane fails
 *   there. A missing skip link *is* caught, on the screens that have nothing else to
 *   bypass with.
 * - **P2 — the skip link's target (`<main id>`) dropped**: `bypass` still passes; the
 *   failure is `region`, on the shell routes. The target loss is not this rule's
 *   business.
 *
 * The skip link's own contract (it exists, precedes the header, targets a focusable
 * `<main>`) is asserted directly in the unit lane (`a11y.test.tsx`), where it does not
 * depend on which rule happens to fire.
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
  // SessionProvider must be inside the router context (it calls useNavigate),
  // so we wrap the matched route element rather than the RouterProvider.
  const router = createMemoryRouter(routesWithSession, { initialEntries: [path] })
  const utils = render(<RouterProvider router={router} />)
  return { router, ...utils }
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
    const { router } = renderAt(path)

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

describe('route coverage — the sweep is tied to the route table', () => {
  // The sweep above grades `ROUTES`; the route table in `../routes` decides which
  // routes exist. These two specs are the link between them, so "axe-core on all
  // routes" cannot quietly become "on the routes someone remembered to list".
  const declared = declaredScreenPaths(routes)
  // Splat (catch-all) patterns are excluded from `concreteDeclared` — see
  // `isSplatPattern`'s docstring for why: every path trivially matches one, so
  // treating them as ordinary declared patterns would make the converse spec
  // below (direction 2) unable to ever fail.
  const concreteDeclared = declared.filter((pattern) => !isSplatPattern(pattern))
  const splatDeclared = declared.filter(isSplatPattern)
  const swept = ROUTES.map((route) => route.path)

  it('grades every screen path the route table declares', () => {
    // Without this, adding `{ path: '/audit', element: <div>audit log</div> }` to the
    // table left this lane 19/19 green (QA probe Q4) — the new route was graded by
    // nobody, and would have violated `page-has-heading-one` had it been swept.
    //
    // Checked against ALL declared patterns (concrete + splat), not just
    // `concreteDeclared` — unlike direction 2 below, a splat pattern here is
    // fine: any swept path at all would trivially satisfy "the catch-all has
    // a witness", so this direction doesn't need the concrete/splat split.
    const unswept = declared.filter((pattern) => !swept.some((path) => routeMatches(pattern, path)))

    expect(
      unswept,
      `route table declares screen paths this sweep does not grade: ${unswept.join(', ')}`,
    ).toEqual([])
  })

  it('grades no path the route table does not declare', () => {
    // The converse, so a stale case cannot masquerade as coverage: a swept path
    // that matches no CONCRETE declared route (renamed, removed, or simply never
    // declared) is not grading a real screen — UNLESS it's the route table's
    // explicit, declared witness for a splat route (`isSplatWitness`).
    //
    // This direction deliberately does NOT match against splat patterns the way
    // direction 1 does: `matchPath('*', anyPath)` is non-null for every possible
    // path, so if a splat pattern counted as "declared" here, no swept path
    // could ever be undeclared — the spec would be unable to fail. Requiring an
    // explicit `isSplatWitness` marker instead means only the route case(s) that
    // deliberately represent the catch-all are exempted; every other
    // stray/stale swept path is still caught.
    const undeclared = ROUTES.filter((route) => {
      if (concreteDeclared.some((pattern) => routeMatches(pattern, route.path))) return false
      if (route.isSplatWitness && splatDeclared.length > 0) return false
      return true
    }).map((route) => route.path)

    expect(
      undeclared,
      `swept paths the route table does not declare: ${undeclared.join(', ')}`,
    ).toEqual([])
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

  it('ships a non-empty <title> fallback in index.html that the app overrides per route', () => {
    // `document-title` is graded against the title the app sets per route
    // (RouteFocusManager), so index.html carries only the app-name fallback — but it
    // must carry one: an empty `<title>` in the shipped document is a real
    // `document-title` failure for any route the app has not titled yet.
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
