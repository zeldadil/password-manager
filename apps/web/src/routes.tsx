import { Navigate, type RouteObject } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import UnlockPage from './pages/UnlockPage'
import VaultPage from './pages/VaultPage'
import FoldersPage from './pages/FoldersPage'
import TagsPage from './pages/TagsPage'
import SettingsPage from './pages/SettingsPage'
import GeneratorPage from './pages/GeneratorPage'
import ResourcePage from './pages/ResourcePage'

// Single source of truth for the app's route table. Auxiliary routes (`/` and the
// `*` catch-all) redirect to /login so unknown paths fail closed — the app never
// renders a screen for a route it does not own.
export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/login" replace /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/unlock', element: <UnlockPage /> },
  { path: '/vault', element: <VaultPage /> },
  { path: '/resources/:id', element: <ResourcePage /> },
  { path: '/folders', element: <FoldersPage /> },
  { path: '/tags', element: <TagsPage /> },
  { path: '/settings', element: <SettingsPage /> },
  { path: '/generator', element: <GeneratorPage /> },
  { path: '*', element: <Navigate to="/login" replace /> },
]
