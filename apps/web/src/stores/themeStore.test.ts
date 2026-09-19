import { beforeEach, describe, expect, it } from 'vitest'

import { useThemeStore, type ThemeMode } from './themeStore'

describe('useThemeStore', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' })
  })

  it('defaults to dark mode', () => {
    expect(useThemeStore.getInitialState().theme).toBe('dark')
  })

  it('setTheme replaces the active theme with an explicit value', () => {
    useThemeStore.getState().setTheme('light')
    expect(useThemeStore.getState().theme).toBe('light')

    useThemeStore.getState().setTheme('dark')
    expect(useThemeStore.getState().theme).toBe('dark')
  })

  it('toggleTheme flips dark <-> light', () => {
    expect(useThemeStore.getState().theme).toBe('dark')

    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().theme).toBe('light')

    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().theme).toBe('dark')
  })

  it('only accepts the two supported theme modes', () => {
    // Compile-time guard: ThemeMode is a closed union. Exercise both branches
    // so the reducer can never drift to an unhandled value at runtime.
    const modes: ThemeMode[] = ['dark', 'light']
    for (const mode of modes) {
      useThemeStore.getState().setTheme(mode)
      expect(useThemeStore.getState().theme).toBe(mode)
    }
  })
})
