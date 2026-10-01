/// <reference types="node" />
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Theme contract tests (FE-001d). */

const srcDir = dirname(fileURLToPath(import.meta.url))

const TOKENS = [
  '--foreground',
  '--muted-foreground',
  '--accent',
  '--border',
  '--card',
  '--background',
] as const

const DARK: Record<(typeof TOKENS)[number], string> = {
  '--foreground': '#e6edf3',
  '--muted-foreground': '#7d8590',
  '--accent': '#4a84fe',
  '--border': '#30363d',
  '--card': '#161b22',
  '--background': '#0d1117',
}

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

/** Match full rgba/hsla/oklch/oklab function calls (with args up to `)`)
 *  and hex literals. Color keywords deliberately excluded in .ts/.tsx
 *  (false positives on prose like "unrecoverable"/"redirect"/"required"). */
const HARDCODED_COLOR = /#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])|\b(?:rgba?|hsla?|oklch|oklab)\([^)]*\)/i

/** CSS box-shadow / overlay definitions legitimately use translucent black.
 * Allow rgba(0, 0, 0, <alpha>) when it is the only offending token. */
function isShadowOverlay(s: string): boolean {
  return /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*[\d.]+\s*\)/.test(s)
}

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
      if (rel === 'theme.css' || /\.(test|spec)\.(ts|tsx)$/.test(rel)) continue
      const content = readFileSync(file, 'utf8')
      const match = content.match(HARDCODED_COLOR)
      if (match) {
        const offending = match[0]
        const ok = isShadowOverlay(offending)
        expect(ok, `hardcoded color "${offending}" in ${rel} — use a theme token instead`).toBe(
          true,
        )
      } else {
        expect(match).toBeNull()
      }
    }
  })
})
