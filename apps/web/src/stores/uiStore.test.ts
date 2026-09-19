import { beforeEach, describe, expect, it } from 'vitest'

import { useUiStore } from './uiStore'

describe('useUiStore', () => {
  beforeEach(() => {
    useUiStore.setState({ sidebarOpen: true })
  })

  it('defaults to an expanded sidebar', () => {
    expect(useUiStore.getInitialState().sidebarOpen).toBe(true)
  })

  it('setSidebarOpen sets an explicit open/closed value', () => {
    useUiStore.getState().setSidebarOpen(false)
    expect(useUiStore.getState().sidebarOpen).toBe(false)

    useUiStore.getState().setSidebarOpen(true)
    expect(useUiStore.getState().sidebarOpen).toBe(true)
  })

  it('toggleSidebar flips expanded <-> collapsed', () => {
    expect(useUiStore.getState().sidebarOpen).toBe(true)

    useUiStore.getState().toggleSidebar()
    expect(useUiStore.getState().sidebarOpen).toBe(false)

    useUiStore.getState().toggleSidebar()
    expect(useUiStore.getState().sidebarOpen).toBe(true)
  })
})
