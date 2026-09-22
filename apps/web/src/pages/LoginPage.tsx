import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MAIN_CONTENT_ID } from '../a11y/RouteFocusManager'

export default function LoginPage() {
  const navigate = useNavigate()
  const [masterPassword, setMasterPassword] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!masterPassword || !email) return

    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/auth/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ masterPassword, email }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.message ?? 'Authentication failed')
        return
      }
      navigate('/vault', { replace: true })
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main id={MAIN_CONTENT_ID} tabIndex={-1} className="login-page">
      <form onSubmit={handleSubmit} className="login-form" noValidate>
        <h1 className="login-heading">Login</h1>

        <label className="login-label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="login-input"
          placeholder="you@example.com"
          required
        />

        <label className="login-label" htmlFor="masterPassword">
          Master password
        </label>
        <input
          id="masterPassword"
          type="password"
          autoComplete="off"
          value={masterPassword}
          onChange={(e) => setMasterPassword(e.target.value)}
          className="login-input"
          placeholder="Enter your master password"
          required
        />

        {error ? (
          <p className="login-error" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          className="login-button"
          disabled={loading || !masterPassword || !email}
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
