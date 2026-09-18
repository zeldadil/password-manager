/**
 * QA reviewer probe (FE-001k / t_cdd23d35) — scratch, NOT part of the deliverable.
 *
 * Independently verifies the two claims the delivered a11y sweep rests on, using
 * my own code path (axe.run directly) rather than the implementer's harness/script:
 *
 *  A. With the hit-test stub the harness installs, the two page-level rules really
 *     evaluate their descendants (status `passes`, node count > 0, no `incomplete`).
 *  B. With that stub removed, axe *skips* those rules and reports the
 *     `elementFromPoint` TypeError — i.e. a violations-only sweep would be green
 *     over pages whose <main>/<h1> were never checked.
 *  C. Whether `bypass` (a REQUIRED_PASSES entry) actually pins the skip link.
 */
import axe, { type AxeResults, type Result } from 'axe-core'
import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { routes } from '../src/routes'
import { JSDOM_UNAVAILABLE_RULES } from '../src/a11y/axe'

const PAGE_LEVEL = ['landmark-one-main', 'page-has-heading-one'] as const

const RULES = Object.fromEntries(
  JSDOM_UNAVAILABLE_RULES.map((id) => [id, { enabled: false }]),
)

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

const countIn = (bucket: Result[], id: string): number | null => {
  const hit = bucket.find((result) => result.id === id)
  return hit ? hit.nodes.length : null
}

const statusOf = (results: AxeResults, id: string) => ({
  passes: countIn(results.passes, id),
  incomplete: countIn(results.incomplete, id),
  violations: countIn(results.violations, id),
  inapplicable: countIn(results.inapplicable, id),
})

describe('QA probe — the sweep harness is a real sensor', () => {
  it('A: stub installed -> page-level rules evaluate for real', async () => {
    renderAt('/vault')
    document.documentElement.setAttribute('lang', 'en')
    // same stub the delivered harness installs (jsdom has no layout)
    document.elementFromPoint = () => null

    const results = await axe.run(document, { rules: RULES })
    const report = Object.fromEntries(PAGE_LEVEL.map((id) => [id, statusOf(results, id)]))

    console.log(
      `QA-PROBE-A ${JSON.stringify({
        report,
        incompleteIds: results.incomplete.map((r) => r.id),
        gradedRules: results.passes.length + results.violations.length,
      })}`,
    )

    for (const id of PAGE_LEVEL) {
      expect(statusOf(results, id).passes, `${id} nodes graded`).toBeGreaterThan(0)
      expect(statusOf(results, id).incomplete, `${id} not skipped`).toBeNull()
    }
  })

  it('B: stub removed -> axe skips those rules (the finding reproduces)', async () => {
    renderAt('/vault')
    document.documentElement.setAttribute('lang', 'en')
    // deliberately uninstall an API jsdom does not implement
    delete (document as { elementFromPoint?: unknown }).elementFromPoint

    // Direct proof of the mechanism: axe's elementsFromPoint polyfill calls
    // document.elementFromPoint, which jsdom does not implement.
    let polyfillError: string | null = null
    try {
      ;(document as unknown as { elementsFromPoint(x: number, y: number): unknown }).elementsFromPoint(5, 5)
    } catch (error) {
      polyfillError = `${(error as Error).name}: ${(error as Error).message}`
    }

    const results = await axe.run(document, { rules: RULES })
    const incompleteIds = results.incomplete.map((result) => result.id)

    console.log(
      `QA-PROBE-B ${JSON.stringify({
        polyfillError,
        incompleteIds,
        violations: results.violations.map((r) => r.id),
        pageLevelInPasses: PAGE_LEVEL.filter((id) => countIn(results.passes, id) !== null),
      })}`,
    )

    expect(polyfillError).toMatch(/elementFromPoint/)
    expect(incompleteIds).toContain('landmark-one-main')
    expect(incompleteIds).toContain('page-has-heading-one')
  })

  it('C: does `bypass` still pass without the skip link?', async () => {
    renderAt('/vault')
    const firstLook = document.querySelector('a.skip-link')
    expect(firstLook, 'baseline: the skip link is rendered').not.toBeNull()

    const withLink = await axe.run(document, { rules: RULES })

    // Re-query after the run (React may have swapped the node while axe worked),
    // detach it for the second run, then restore it so React's teardown still
    // finds a consistent tree.
    const liveSkipLink = document.querySelector('a.skip-link')
    const parent = liveSkipLink?.parentNode ?? null
    const nextSibling = liveSkipLink?.nextSibling ?? null
    if (parent && liveSkipLink) parent.removeChild(liveSkipLink)
    expect(document.querySelector('a.skip-link'), 'skip link detached').toBeNull()

    try {
      const withoutLink = await axe.run(document, { rules: RULES })
      console.log(
        `QA-PROBE-C ${JSON.stringify({
          bypassWithSkipLink: statusOf(withLink, 'bypass'),
          bypassWithoutSkipLink: statusOf(withoutLink, 'bypass'),
          regionWithoutSkipLink: statusOf(withoutLink, 'region'),
          violationsWithoutSkipLink: withoutLink.violations.map((r) => r.id),
        })}`,
      )
    } finally {
      if (parent && liveSkipLink) parent.insertBefore(liveSkipLink, nextSibling)
    }

    expect(document.querySelector('a.skip-link'), 'skip link restored').not.toBeNull()
  })
})
