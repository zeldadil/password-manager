/** @license
 * In-memory session context — FE-002c.
 *
 * Holds the JWT access token + refresh token in JS heap memory only. Nothing is
 * persisted to localStorage/sessionStorage/IndexedDB (SEC-001).
 *
 * Exposes:
 *  - `session` — current tokens + expiry + active flag
 *  - `login({ accessToken, refreshToken, expiresIn })` — called after POST /auth/unlock
 *  - `lock()` — POST /auth/lock + clear + navigate to /unlock
 *  - `extend()` — POST /auth/refresh + rotate tokens + reset expiry
 */

import { createContext, useContext, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { postLock, postRefresh } from './api'

export interface SessionState {
  accessToken: string | null
  refreshToken: string | null
  expiresAt: number | null // epoch ms, or null when no session
  active: boolean
}

export interface SessionContextValue extends SessionState {
  login: (accessToken: string, refreshToken: string, expiresInSeconds: number) => void
  lock: () => Promise<void>
  extend: () => Promise<void>
  clear: () => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const [state, setState] = useState<SessionState>({
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
    active: false,
  })

  const login = useCallback(
    (accessToken: string, refreshToken: string, expiresInSeconds: number) => {
      setState({
        accessToken,
        refreshToken,
        expiresAt: Date.now() + expiresInSeconds * 1000,
        active: true,
      })
    },
    [],
  )

  const clear = useCallback(() => {
    setState({ accessToken: null, refreshToken: null, expiresAt: null, active: false })
  }, [])

  const lock = useCallback(async () => {
    const { accessToken } = state
    if (!accessToken) {
      navigate('/unlock', { replace: true })
      return
    }
    try {
      await postLock(accessToken)
    } catch {
      // Even if the lock request fails (network, token already invalid), we
      // discard local tokens and send the user to the unlock screen.
    } finally {
      clear()
      navigate('/unlock', { replace: true })
    }
  }, [state.accessToken, navigate, clear])

  const extend = useCallback(async () => {
    const { refreshToken } = state
    if (!refreshToken) throw new Error('No refresh token')
    const res = await postRefresh(refreshToken)
    login(res.accessToken, res.refreshToken, res.expiresIn)
  }, [state.refreshToken, login])

  const value: SessionContextValue = {
    ...state,
    login,
    lock,
    extend,
    clear,
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within SessionProvider')
  return ctx
}
