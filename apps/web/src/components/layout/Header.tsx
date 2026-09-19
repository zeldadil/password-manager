import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

export interface HeaderProps {
  appName?: string
  userName?: string
  /** Called when the user locks the vault. Defaults to navigating to /unlock. */
  onLock?: () => void
  /** Called when the user signs out. Defaults to navigating to /login. */
  onSignOut?: () => void
}

export default function Header({
  appName = 'Password Manager',
  userName,
  onLock,
  onSignOut,
}: HeaderProps) {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  const handleLock = () => {
    if (onLock) onLock()
    else navigate('/unlock')
  }

  const handleSignOut = () => {
    setMenuOpen(false)
    if (onSignOut) onSignOut()
    else navigate('/login')
  }

  return (
    <header className="app-header">
      <Link to="/vault" className="app-header__brand">
        {appName}
      </Link>

      <div className="app-header__actions">
        <button
          type="button"
          className="app-header__lock"
          onClick={handleLock}
          aria-label="Lock vault"
          title="Lock vault"
        >
          Lock
        </button>

        <div className="app-header__user">
          <button
            type="button"
            className="app-header__user-toggle"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {userName ?? 'Account'}
          </button>
          {menuOpen && (
            <div className="app-header__menu" role="menu" aria-label="User menu">
              <Link
                to="/settings"
                role="menuitem"
                className="app-header__menu-item"
                onClick={() => setMenuOpen(false)}
              >
                Settings
              </Link>
              <button
                type="button"
                role="menuitem"
                className="app-header__menu-item"
                onClick={handleSignOut}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
