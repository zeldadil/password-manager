import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
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
  const toggleRef = useRef<HTMLButtonElement>(null)

  const handleLock = () => {
    if (onLock) onLock()
    else navigate('/unlock')
  }

  const handleSignOut = () => {
    setMenuOpen(false)
    if (onSignOut) onSignOut()
    else navigate('/login')
  }

  // Escape closes the menu and returns focus to the toggle so keyboard users are
  // never left with an orphaned open menu (WCAG 2.1.1 Keyboard).
  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape' && menuOpen) {
      event.preventDefault()
      setMenuOpen(false)
      toggleRef.current?.focus()
    }
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
            ref={toggleRef}
            type="button"
            className="app-header__user-toggle"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? 'user-menu' : undefined}
            onClick={() => setMenuOpen((open) => !open)}
            onKeyDown={handleMenuKeyDown}
          >
            {userName ?? 'Account'}
          </button>
          {/*
            Disclosure pattern: a plain list of links/buttons behind a toggle,
            not a WAI-ARIA menu (which would require arrow-key navigation). The
            items are native links/buttons, so Tab + Enter already cover them.
          */}
          {menuOpen && (
            <div id="user-menu" className="app-header__menu">
              <Link
                to="/settings"
                className="app-header__menu-item"
                onClick={() => setMenuOpen(false)}
              >
                Settings
              </Link>
              <button type="button" className="app-header__menu-item" onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
