import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MAIN_CONTENT_ID } from '../a11y/RouteFocusManager'

export default function UnlockPage() {
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
        setError(data.message ?? 'Unlock failed')
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
    <main id={MAIN_CONTENT_ID} tabIndex={-1} className="unlock-page">
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
        />

        <label className="unlock-label" htmlFor="masterPassword">
          Master password
        </label>
        <input
          id="masterPassword"
          type="password"
          autoComplete="off"
          value={masterPassword}
          onChange={(e) => setMasterPassword(e.target.value)}
          className="unlock-input"
          placeholder="Enter your master password"
          required
        />

        {error ? (
          <p className="unlock-error" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          className="unlock-button"
          disabled={loading || !masterPassword || !email}
        >
          {loading ? 'Unlocking...' : 'Unlock'}
        </button>
      </form>
    </main>
  )
}
