import axe from 'axe-core'
import type { AxeResults, ElementContext, RuleObject, RunOptions } from 'axe-core'
import indexHtml from '../../index.html?raw'

/**
 * axe-core harness for the Web UI (FE-001k).
 *
 * Why a harness and not a bare `axe.run()` call in each spec:
 *
 * 1. **jsdom is not a browser.** The specs run in jsdom, which has no layout
 *    engine and no canvas. Rules that need geometry or computed colour cannot
 *    produce a verdict there, so they are disabled *explicitly and by name* below
 *    instead of being left to report `incomplete` (an `incomplete` result is not a
 *    pass — leaving it in the results would let a real finding hide behind a
 *    "could not verify" entry).
 * 2. **The rendered DOM is not the production document.** `index.html` is not
 *    loaded by the test runner, so the document-scope rules (`html-has-lang`,
 *    `document-title`, `page-has-heading-one`, `landmark-one-main`, `region`)
 *    would otherwise grade a document the product never ships. The harness mirrors
 *    the real `<html lang>` from `index.html` — it does not invent one: if
 *    `index.html` loses its `lang` attribute the value is empty, the attribute is
 *    never set, and `html-has-lang` fails the way it should.
 *
 * Everything else is axe's default rule set (WCAG + best practice), so a
 * "violation" here means exactly what axe means by one.
 */

/** `index.html` as shipped — the source of truth for document-scope attributes. */
export const INDEX_HTML = indexHtml

/** `<html lang>` of the production document ('' when the attribute is missing). */
export const HTML_LANG = /<html[^>]*\blang="([^"]*)"/.exec(INDEX_HTML)?.[1] ?? ''

/**
 * Rules disabled because jsdom cannot evaluate them. Each is a documented jsdom
 * limitation, not a waiver of the requirement:
 *
 * - `color-contrast` (WCAG 1.4.3 Contrast Minimum) needs rendered pixels — jsdom
 *   has neither layout nor canvas, so any verdict would be fabricated. Contrast is
 *   verified at the browser level (see the FE-001k evidence note / dogfood runs).
 * - `target-size` (WCAG 2.5.8) needs element geometry, which jsdom does not compute.
 */
export const JSDOM_UNAVAILABLE_RULES: readonly string[] = ['color-contrast', 'target-size']

const JSDOM_UNAVAILABLE: RuleObject = Object.fromEntries(
  JSDOM_UNAVAILABLE_RULES.map((id) => [id, { enabled: false }]),
)

/** Mirrors the production document onto the jsdom one before axe inspects it. */
export function prepareDocument(): void {
  if (HTML_LANG) document.documentElement.setAttribute('lang', HTML_LANG)
  installHitTestStub()
}

/**
 * jsdom implements neither `elementFromPoint` nor `elementsFromPoint`. axe-core
 * calls them from `isModalOpen()` (via its own polyfill, installed at import time)
 * while evaluating the two page-level rules `landmark-one-main` and
 * `page-has-heading-one`; the missing API makes axe *skip* those rules and return
 * them as `incomplete` — i.e. "one main landmark / one h1 per page" would be
 * unverified on every route.
 *
 * There is no layout engine in jsdom, so there is no element at any coordinate:
 * returning `null` is the honest answer, and axe's polyfill turns it into an empty
 * hit-test stack. The consequences are on the strict side — the page-level rules
 * then run their real descendant check instead of trusting "a modal must be open":
 * a page that is missing its `<main>` or `<h1>` now fails rather than passing.
 */
function installHitTestStub(): void {
  if (typeof document.elementFromPoint !== 'function') {
    document.elementFromPoint = () => null
  }
}

/**
 * Runs axe over the whole jsdom document (not just the render container) so
 * document-scope rules are evaluated. Callers may narrow the context when a spec
 * wants to grade a subtree.
 */
export async function runAxe(
  options: RunOptions = {},
  context: ElementContext = document,
): Promise<AxeResults> {
  prepareDocument()
  const merged: RunOptions = {
    ...options,
    rules: {
      ...JSDOM_UNAVAILABLE,
      ...(options.rules ?? {}),
    },
  }
  return axe.run(context, merged)
}

/** One line per violation, for expect() messages. */
export function formatViolations(results: AxeResults): string {
  return results.violations
    .map((violation) => {
      const nodes = violation.nodes.map((node) => node.target.join(' ')).join(', ')
      return `- [${violation.impact ?? 'n/a'}] ${violation.id}: ${violation.help} — ${nodes}`
    })
    .join('\n')
}
