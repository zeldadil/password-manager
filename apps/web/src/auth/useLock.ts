/** @license
 * Lock flow hook — FE-002c AC1.
 *
 * POSTs /auth/lock with the current Bearer token, discards the in-memory token
 * pair, then navigates to /unlock. On any failure (network, already-locked, etc.)
 * the local session is still cleared and the user is sent to /unlock — a failed
 * lock request is never a reason to keep holding tokens in memory.
 */

import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../auth/SessionProvider'

export function useLock() {
  const navigate = useNavigate()
  const { accessToken, clear } = useSession()

  return useCallback(async () => {
    const token = accessToken
    if (!token) {
      navigate('/unlock', { replace: true })
      return
    }
    try {
      const res = await fetch('/auth/lock', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
      })
      if (!res.ok) {
        // Non-2xx — still clear tokens and move to unlock. The server may
        // have already revoked the session (idempotent lock) or the token may
        // be stale; in either case the client must not keep holding it.
      }
    } catch {
      // Network error — same treatment: discard local tokens, move on.
    } finally {
      clear()
      navigate('/unlock', { replace: true })
    }
  }, [accessToken, navigate, clear])
}
