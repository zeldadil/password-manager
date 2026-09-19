import { create } from 'zustand'

export interface UiState {
  /** Whether the left navigation sidebar is expanded. */
  sidebarOpen: boolean
  /** Explicitly expand or collapse the sidebar. */
  setSidebarOpen: (open: boolean) => void
  /** Flip the sidebar between expanded and collapsed. */
  toggleSidebar: () => void
}

/**
 * Ephemeral UI chrome state (FE-001g).
 *
 * Holds transient view state that does not come from the server and must not
 * survive a reload as server data — sidebar open/closed is the canonical
 * example. Held in memory only (Zustand's default store) with no persistence
 * surface.
 */
export const useUiStore = create<UiState>()((set) => ({
  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
}))
