import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useThemeStore, type ThemeMode } from './themeStore'

/**
 * Theme toggle unit tests (FE-001i).
 *
 * The toggle lives in state, not in a component: `useThemeStore` owns *which*
 * theme is active (FE-001g) and `theme.css` owns how a theme is expressed
 * (FE-001d). These tests pin the contract between the two — every mode the store
 * can hold must be a mode the stylesheet knows how to render — plus the SEC-001
 * rule that the preference is in-memory only.
 *
 * There is no theme toggle *control* in the UI yet (the theme is applied by
 * mounting the CSS; nothing writes `data-theme` from React). That wiring is a
 * finding in the FE-001i handoff, not something these tests fake.
 */

const srcDir = dirname(fileURLToPath(import.meta.url))
const themeCss = readFileSync(join(srcDir, '..', 'theme.css'), 'utf8')

describe('theme store — toggle behaviour', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' })
  })

  it('defaults to dark', () => {
    expect(useThemeStore.getInitialState().theme).toBe('dark')
  })

  it('toggleTheme is an involution: dark → light → dark', () => {
    const { toggleTheme } = useThemeStore.getState()

    toggleTheme()
    expect(useThemeStore.getState().theme).toBe('light')

    toggleTheme()
    expect(useThemeStore.getState().theme).toBe('dark')
  })

  it('setTheme selects an explicit mode regardless of the current one', () => {
    useThemeStore.getState().setTheme('light')
    useThemeStore.getState().setTheme('light')
    expect(useThemeStore.getState().theme).toBe('light')

    useThemeStore.getState().setTheme('dark')
    expect(useThemeStore.getState().theme).toBe('dark')
  })

  it('notifies subscribers on every toggle', () => {
    const listener = vi.fn()
    const unsubscribe = useThemeStore.subscribe(listener)

    useThemeStore.getState().toggleTheme()
    useThemeStore.getState().toggleTheme()

    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })
})

describe('theme store — stylesheet contract', () => {
  const modes: ThemeMode[] = ['dark', 'light']

  it('maps every ThemeMode to a selector the stylesheet defines', () => {
    // dark is the default on :root; light is opted into by an attribute.
    const selectorFor: Record<ThemeMode, string> = {
      dark: ':root {',
      light: "[data-theme='light']",
    }

    for (const mode of modes) {
      expect(themeCss, `theme.css must define ${mode}`).toContain(selectorFor[mode])
    }
  })

  it('pairs each mode with the matching color-scheme', () => {
    const darkBlock = themeCss.slice(themeCss.indexOf(':root {'))
    expect(darkBlock).toContain('color-scheme: dark')

    const lightBlock = themeCss.slice(themeCss.indexOf("[data-theme='light']"))
    expect(lightBlock).toContain('color-scheme: light')
  })
})

describe('theme store — in-memory only (SEC-001)', () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    storage.clear()
    useThemeStore.setState({ theme: 'dark' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('toggling writes nothing to localStorage, sessionStorage, cookies or the network', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
      storage.set(key, value)
    })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    useThemeStore.getState().toggleTheme()
    useThemeStore.getState().toggleTheme()

    expect(setItem).not.toHaveBeenCalled()
    expect(storage.size).toBe(0)
    expect(document.cookie).toBe('')
    expect(fetchSpy).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  it('exposes no persistence surface on the store state', () => {
    const state = useThemeStore.getState()

    expect(Object.keys(state).sort()).toEqual(['setTheme', 'theme', 'toggleTheme'])
  })
})
