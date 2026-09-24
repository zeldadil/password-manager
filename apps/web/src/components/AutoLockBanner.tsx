/** @license
 * Auto-lock banner — FE-002c AC2.
 *
 * Shows a countdown when the active session is ≤60 s from expiry. The
 * "Extend session" button calls POST /auth/refresh and re-arms the countdown.
 *
 * Tokens are held in the AuthContext (in-memory only — SEC-001).
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { useSession } from '../auth/SessionProvider'

export interface AutoLockBannerProps {
  /** Called when the banner first becomes visible. */
  onShow?: () => void
  /** Label for the extend button. */
  extendLabel?: string
}

const WARN_SECONDS = 60

export default function AutoLockBanner({
  onShow,
  extendLabel = 'Extend session',
}: AutoLockBannerProps) {
  const { expiresAt, extend } = useSession()
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [visible, setVisible] = useState(false)
  const [extending, setExtending] = useState(false)
  const [extended, setExtended] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef<number>(0)

  // Visibility: show when a session is active AND ≤60 s remain.
  useEffect(() => {
    if (!expiresAt) {
      setVisible(false)
      return
    }
    const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
    const shouldShow = remaining > 0 && remaining <= WARN_SECONDS
    if (shouldShow && !visible) onShow?.()
    setVisible(shouldShow)
    setSecondsLeft(remaining)
  }, [expiresAt, visible, onShow])

  // Smooth countdown tick.
  useEffect(() => {
    if (!visible || secondsLeft <= 0) return
    lastTsRef.current = performance.now()
    const tick = () => {
      const elapsed = (performance.now() - lastTsRef.current) / 1000
      lastTsRef.current = performance.now()
      setSecondsLeft((prev) => {
        const next = prev - elapsed
        if (next <= 0) {
          if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
          return 0
        }
        return next
      })
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [visible, secondsLeft])

  // Re-sync when the session expiry changes (e.g. after extend) while visible.
  useEffect(() => {
    if (!visible || !expiresAt) return
    const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
    if (remaining > 0 && remaining <= WARN_SECONDS) {
      setSecondsLeft(remaining)
    } else if (remaining <= 0) {
      setSecondsLeft(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt])

  const handleExtend = useCallback(async () => {
    setExtending(true)
    setError(null)
    try {
      await extend()
      setExtended(true)
      // Let the expiresAt-sync effect (lines 68-77) re-derive visibility and
      // secondsLeft from the new expiry. After a successful extend the session
      // may be far enough from the warning window that the banner should hide.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to extend session')
    } finally {
      setExtending(false)
    }
  }, [extend])

  if (!visible || secondsLeft <= 0) return null

  const m = Math.floor(secondsLeft / 60)
  const s = Math.floor(secondsLeft % 60)
  const timeStr = `${m}:${s.toString().padStart(2, '0')}`

  return (
    <div className="auto-lock-banner" role="alert" aria-live="assertive">
      <p className="auto-lock-banner__message">
        Your session will lock in <strong>{timeStr}</strong>
      </p>
      <button
        type="button"
        className="auto-lock-banner__extend"
        onClick={handleExtend}
        disabled={extending}
        aria-busy={extending}
      >
        {extending ? 'Extending…' : extended ? 'Session extended' : extendLabel}
      </button>
      {error ? (
        <p className="auto-lock-banner__error" role="status">
          {error}
        </p>
      ) : null}
    </div>
  )
}
