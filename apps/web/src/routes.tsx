import { Navigate, type RouteObject } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import FoldersPage from './pages/FoldersPage'
import GeneratorPage from './pages/GeneratorPage'
import LoginPage from './pages/LoginPage'
import ResourcePage from './pages/ResourcePage'
import SettingsPage from './pages/SettingsPage'
import TagsPage from './pages/TagsPage'
import UnlockPage from './pages/UnlockPage'
import VaultPage from './pages/VaultPage'

// Single source of truth for the app's route table. Auxiliary routes (`/` and the
// `*` catch-all) redirect to /login so unknown paths fail closed — the app never
// renders a screen for a route it does not own.
//
// Authenticated screens render inside the AppShell layout route (header + sidebar +
// main). Login and Unlock are standalone pre-auth screens and stay outside the shell.
export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/login" replace /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/unlock', element: <UnlockPage /> },
  {
    element: <AppShell />,
    children: [
      { path: '/vault', element: <VaultPage /> },
      { path: '/resources/:id', element: <ResourcePage /> },
      { path: '/folders', element: <FoldersPage /> },
      { path: '/tags', element: <TagsPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/generator', element: <GeneratorPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/login" replace /> },
]
