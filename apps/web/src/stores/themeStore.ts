import { create } from 'zustand'

/** Supported UI themes. Dark mode is the default (FE-001d). */
export type ThemeMode = 'dark' | 'light'

export interface ThemeState {
  /** The currently active theme. */
  theme: ThemeMode
  /** Replace the active theme with an explicit value. */
  setTheme: (theme: ThemeMode) => void
  /** Flip between `dark` and `light`. */
  toggleTheme: () => void
}

/**
 * UI theme state (FE-001g).
 *
 * Theme is a non-secret user preference held in memory. Actual application of
 * the theme (CSS variables, `color-scheme`, mapping to the Hermes desktop
 * theme) belongs to the FE-001d theme system; this store only owns the source
 * of truth for *which* theme is active. No persistence surface is wired here —
 * if theme persistence across reloads is ever desired, it is added by FE-001d
 * via a `persist` middleware, not by spreading `localStorage` access into
 * other layers.
 */
export const useThemeStore = create<ThemeState>()((set) => ({
  theme: 'dark',
  setTheme: (theme) => set({ theme }),
  toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
}))
