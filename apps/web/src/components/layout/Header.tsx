import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useThemeStore } from '../../stores/themeStore'
import { useSession } from '../../auth/SessionProvider'

export interface HeaderProps {
  appName?: string
  userName?: string
}

export default function Header({ appName = 'Password Manager', userName }: HeaderProps) {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const { theme, toggleTheme } = useThemeStore()
  const { lock } = useSession()

  const handleLock = async () => {
    await lock()
  }

  const handleSignOut = () => {
    setMenuOpen(false)
    navigate('/login', { replace: true })
  }

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

        <button
          type="button"
          className="app-header__theme-toggle"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          aria-pressed={theme === 'dark'}
        >
          {theme === 'dark' ? 'Light' : 'Dark'}
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
