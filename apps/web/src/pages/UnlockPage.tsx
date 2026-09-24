import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MAIN_CONTENT_ID } from '../a11y/RouteFocusManager'

// Mirrors the backend's BE-002e/BE-002f thresholds. The backend returns an
// identical 401 body for "wrong password" and "account locked out", so we track
// consecutive 401s client-side and show a countdown once we cross the threshold.
const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 15 * 60 * 1000 // 15 minutes

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function UnlockPage() {
  const navigate = useNavigate()
  const mainRef = useRef<HTMLElement>(null)
  const masterPasswordRef = useRef<HTMLInputElement>(null)

  const [email, setEmail] = useState('')
  const [masterPassword, setMasterPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Error classification so the UI can show the right affordance.
  const [errorKind, setErrorKind] = useState<'none' | 'auth' | 'rate-limited' | 'network'>('none')

  // Client-side rate-limit tracking.
  const [failedAttempts, setFailedAttempts] = useState(0)
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null)
  const [countdownSeconds, setCountdownSeconds] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Countdown tick.
  useEffect(() => {
    if (lockoutUntil === null) {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      return
    }

    const tick = () => {
      const remaining = Math.max(0, lockoutUntil - Date.now())
      setCountdownSeconds(Math.ceil(remaining / 1000))

      if (remaining <= 0) {
        setLockoutUntil(null)
        setCountdownSeconds(0)
        setError(null)
        setErrorKind('none')
        setFailedAttempts(0)
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
      }
    }

    tick()
    timerRef.current = setInterval(tick, 1000)
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [lockoutUntil])

  // Focus management for keyboard users.
  useEffect(() => {
    if (error && masterPasswordRef.current) {
      if (errorKind === 'rate-limited') {
        mainRef.current?.focus()
      } else {
        masterPasswordRef.current.focus()
      }
    }
  }, [error, errorKind])

  // Plain function — recreated every render, always has fresh closure.
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!masterPassword || !email) return

    setLoading(true)
    setError(null)
    setErrorKind('none')

    try {
      const res = await fetch('/auth/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ masterPassword, email }),
      })

      if (!res.ok) {
        if (res.status === 401) {
          const next = failedAttempts + 1
          setFailedAttempts(next)

          if (next >= MAX_FAILED_ATTEMPTS) {
            setLockoutUntil(Date.now() + LOCKOUT_DURATION_MS)
            setErrorKind('rate-limited')
            setError('Too many failed attempts. Please try again later.')
          } else {
            setErrorKind('auth')
            setError('Invalid email or master password.')
          }
        } else {
          setErrorKind('auth')
          setError('Invalid email or master password.')
        }

        // Security: clear master password after auth failure.
        setMasterPassword('')
        return
      }

      setFailedAttempts(0)
      setEmail('')
      setMasterPassword('')
      navigate('/vault', { replace: true })
    } catch {
      setErrorKind('network')
      setError('Network error — please try again.')
      // Transient network errors are retryable — we intentionally keep the
      // master password in state so the retry affordance (entered below) can
      // re-submit with the same credentials without forcing the user to retype.
      // This diverges from the auth-failure path, which clears on 401 because
      // those credentials are demonstrably wrong.
    } finally {
      setLoading(false)
    }
  }

  // Retry for network errors — reuses the still-in-state master password.
  function handleRetry() {
    handleSubmit({} as React.FormEvent)
  }

  const isRateLimited = lockoutUntil !== null
  // Inputs are only disabled when loading or rate-limited.
  const isInputDisabled = loading || isRateLimited || errorKind === 'network'
  const isSubmitDisabled =
    loading || isRateLimited || errorKind === 'network' || !email || !masterPassword

  return (
    <main
      id={MAIN_CONTENT_ID}
      tabIndex={-1}
      className="unlock-page"
      ref={mainRef}
      aria-live="polite"
    >
      <form onSubmit={handleSubmit} className="unlock-form" noValidate>
        <h1 className="unlock-heading">Unlock</h1>
        <p className="unlock-subtitle">Vault locked — enter master password to unlock</p>

        <label className="unlock-label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="unlock-input"
          placeholder="you@example.com"
          required
          disabled={isInputDisabled}
        />

        <label className="unlock-label" htmlFor="masterPassword">
          Master password
        </label>
        <input
          ref={masterPasswordRef}
          id="masterPassword"
          type="password"
          autoComplete="off"
          value={masterPassword}
          onChange={(e) => setMasterPassword(e.target.value)}
          className="unlock-input"
          placeholder="Enter your master password"
          required
          disabled={isInputDisabled}
          aria-describedby={
            error
              ? errorKind === 'rate-limited'
                ? 'unlock-rate-limit-countdown'
                : 'unlock-error'
              : undefined
          }
        />

        {error ? (
          <div className="unlock-error-container">
            <p className="unlock-error" id="unlock-error" role="alert" aria-live="assertive">
              {error}
            </p>

            {errorKind === 'network' && !isRateLimited && (
              <button
                type="button"
                className="unlock-retry-button"
                onClick={handleRetry}
                disabled={loading}
              >
                Retry
              </button>
            )}

            {isRateLimited && (
              <p
                className="unlock-rate-limit-countdown"
                id="unlock-rate-limit-countdown"
                aria-live="polite"
              >
                Try again in {formatTime(countdownSeconds)}
              </p>
            )}
          </div>
        ) : null}

        <button type="submit" className="unlock-button" disabled={isSubmitDisabled}>
          {loading ? 'Unlocking...' : 'Unlock'}
        </button>
      </form>
    </main>
  )
}
