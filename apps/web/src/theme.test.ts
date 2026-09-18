/// <reference types="node" />
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Theme contract tests (FE-001d).
 *
 * `theme.css` is the single source of truth for the Web UI palette. These tests
 * pin the contract: dark mode is the default (no attribute required), the values
 * map to the Hermes desktop theme, and no other file hardcodes a color.
 *
 * The file reads use Node's `fs` (via the `/// <reference types="node" />`
 * above) because Vite's `?raw` import returns an empty string for `.css` files.
 */

const srcDir = dirname(fileURLToPath(import.meta.url))

/** The theme tokens the Web UI may reference. `--background` is the page surface
 *  that the required set (--foreground, --muted-foreground, --accent, --border,
 *  --card) sits on. */
const TOKENS = [
  '--foreground',
  '--muted-foreground',
  '--accent',
  '--border',
  '--card',
  '--background',
] as const

/** Hermes desktop "Nous" dark palette — the default (github chrome + Nous blue). */
const DARK: Record<(typeof TOKENS)[number], string> = {
  '--foreground': '#e6edf3',
  '--muted-foreground': '#7d8590',
  '--accent': '#4a84fe',
  '--border': '#30363d',
  '--card': '#161b22',
  '--background': '#0d1117',
}

/** Hermes desktop "Nous" light palette — opt-in via <html data-theme="light">. */
const LIGHT: Record<(typeof TOKENS)[number], string> = {
  '--foreground': '#1f2328',
  '--muted-foreground': '#656d76',
  '--accent': '#0053fd',
  '--border': '#d0d7de',
  '--card': '#f6f8fa',
  '--background': '#ffffff',
}

function readThemeCss(): string {
  return readFileSync(join(srcDir, 'theme.css'), 'utf8')
}

function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
      } else if (/\.(ts|tsx|css)$/.test(entry)) {
        out.push(full)
      }
    }
  }
  walk(srcDir)
  return out
}

/** Any literal color that is not a theme reference. `transparent` and
 *  `currentColor` are allowed (absence of color / inherited color), as is
 *  `var(--token)`. */
const HARDCODED_COLOR =
  /#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])|\b(?:rgba?|hsla?|oklch|oklab)\(|\b(?:white|black|red|blue|green|yellow|gray|grey|orange|purple|pink|brown|cyan|magenta|navy|teal|silver|maroon|olive|lime|aqua|fuchsia|gold|indigo|violet|beige|coral|crimson|khaki|lavender|plum|salmon|tan|tomato|turquoise)\b/i

describe('theme system', () => {
  it('defines every token with the Hermes dark palette as the default', () => {
    const css = readThemeCss()
    expect(css).toContain('color-scheme: dark')
    for (const token of TOKENS) {
      expect(css, `dark default for ${token}`).toContain(`${token}: ${DARK[token]}`)
    }
  })

  it('provides a light variant via <html data-theme="light">', () => {
    const css = readThemeCss()
    expect(css).toContain("[data-theme='light']")
    for (const token of TOKENS) {
      expect(css, `light value for ${token}`).toContain(`${token}: ${LIGHT[token]}`)
    }
  })

  it('keeps every component and stylesheet free of hardcoded colors', () => {
    for (const file of sourceFiles()) {
      const rel = relative(srcDir, file)
      // theme.css is the single source of truth; test files carry expected values.
      if (rel === 'theme.css' || /\.(test|spec)\.(ts|tsx)$/.test(rel)) continue
      const content = readFileSync(file, 'utf8')
      const match = content.match(HARDCODED_COLOR)
      expect(match, `hardcoded color "${match?.[0]}" in ${rel}`).toBeNull()
    }
  })
})
