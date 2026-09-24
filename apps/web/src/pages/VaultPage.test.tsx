/** @license
 * Unit tests for VaultPage (FE-003a).
 *
 * Verifies the vault resource list renders the six required columns
 * (Name, Username, URI, Folder, Tags, Actions), loads rows from the API
 * via TanStack Query, and handles loading / error / empty states.
 */

import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { vaultColumns } from './VaultPage'
import { SessionProvider } from '../auth/SessionProvider'
import { routes } from '../routes'

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  })
}

/** Wrap every child route element in SessionProvider + QueryClientProvider. */
function wrapRoutes(
  routeList: RouteObject[],
  queryClient: QueryClient,
): RouteObject[] {
  const root = routeList[0]
  return [
    {
      ...root,
      children: root.children?.map((child) => ({
        ...child,
        element: (
          <SessionProvider>
            <QueryClientProvider client={queryClient}>
              {child.element}
            </QueryClientProvider>
          </SessionProvider>
        ),
      })) as RouteObject[],
    },
  ] as RouteObject[]
}

type FetchStub = ReturnType<typeof vi.fn>

const loginOk = {
  ok: true,
  json: async () => ({
    accessToken: 'tok',
    refreshToken: 'ref',
    expiresIn: 900,
    tokenType: 'Bearer',
  }),
} as unknown as Response

/** Render the app (initially at /login) with a global fetch stub wired to
 *  serve the login POST first and then the vault GET.  Returns the stub so
 *  callers can chain additional `.mockResolvedValueOnce` / `.mockRejectedValueOnce`
 *  for refresh / retry flows, plus a `login` helper that types credentials,
 *  submits, and waits for navigation to /vault. */
function renderAppWithLogin(
  stub: FetchStub,
): { stub: FetchStub; login: () => Promise<void> } {
  const qc = makeQueryClient()
  const wrapped = wrapRoutes(routes, qc)
  const router = createMemoryRouter(wrapped, { initialEntries: ['/login'] })
  render(<RouterProvider router={router} />)

  const login = async () => {
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Email'), 'user@example.test')
    await user.type(screen.getByLabelText('Master password'), 'password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    // Wait for the vault heading — this means LoginPage navigated and called
    // session.login(), so the session is active and VaultPage rendered.
    await screen.findByRole('heading', { name: 'Vault', level: 1 })
    // Give TanStack Query a tick to kick off the vault query after the
    // session flipped to active.
    await Promise.resolve()
  }

  return { stub, login }
}

describe('vaultColumns', () => {
  it('returns the six columns the task specifies', () => {
    const cols = vaultColumns()
    expect(cols).toHaveLength(6)
    expect(cols.map((c) => c.key)).toEqual([
      'name',
      'username',
      'uri',
      'folder',
      'tags',
      'actions',
    ])
    expect(cols.map((c) => c.label)).toEqual([
      'Name',
      'Username',
      'URI',
      'Folder',
      'Tags',
      'Actions',
    ])
  })
})

function mockResources(body: unknown): Response {
  return {
    ok: true,
    json: async () => ({
      header: { id: 'h1', status: 'success', servertime: new Date().toISOString(), action: 'ListResources', code: 200 },
      body,
    }),
  } as unknown as Response
}

function mockError(status = 500): Response {
  return {
    ok: false,
    status,
    json: async () => ({ message: 'boom' }),
  } as unknown as Response
}

describe('VaultPage — authenticated', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', undefined)
  })

  it('renders the heading and the six column headers', async () => {
    const stub = vi.fn()
    stub.mockResolvedValueOnce(loginOk)
    stub.mockResolvedValueOnce(mockResources([{ id: 'r1', name: 'A', username: '', uri: '', folderId: null, folderName: null, tags: [] }]))
    vi.stubGlobal('fetch', stub)

    const { login } = renderAppWithLogin(stub)
    await login()

    const table = await screen.findByRole('table')
    const headers = within(table).getAllByRole('columnheader')
    expect(headers).toHaveLength(6)
    expect(headers.map((h) => h.textContent)).toEqual([
      'Name',
      'Username',
      'URI',
      'Folder',
      'Tags',
      'Actions',
    ])
  })

  it('shows a loading state while the vault query is in flight', async () => {
    let resolvePending: () => void = () => {}
    const pendingJson = new Promise<undefined>((resolve) => {
      resolvePending = () => resolve(undefined)
    })
    const stub = vi.fn()
    stub.mockResolvedValueOnce(loginOk)
    stub.mockResolvedValueOnce({
      ok: true,
      json: () => pendingJson,
    } as unknown as Response)
    vi.stubGlobal('fetch', stub)

    const { login } = renderAppWithLogin(stub)
    await login()

    // Wait specifically for the vault loading text — the route-focus-manager
    // live region also has role="status", so getByRole('status') is ambiguous.
    await screen.findByText('Loading resources…')
    expect(screen.queryByRole('table')).toBeNull()

    resolvePending()
    await pendingJson.catch(() => {})
  })

  it('renders an empty row list when the API returns no resources', async () => {
    const stub = vi.fn()
    stub.mockResolvedValueOnce(loginOk)
    stub.mockResolvedValueOnce(mockResources([]))
    vi.stubGlobal('fetch', stub)

    const { login } = renderAppWithLogin(stub)
    await login()

    expect(await screen.findByText('No resources yet.')).not.toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText(/0 resources/i)).not.toBeNull()
  })

  it('renders a row per resource with the six columns', async () => {
    const stub = vi.fn()
    stub.mockResolvedValueOnce(loginOk)
    stub.mockResolvedValueOnce(mockResources([
      {
        id: 'res-1',
        name: 'GitHub',
        username: 'adil',
        uri: 'https://github.example.test',
        folderId: null,
        folderName: null,
        tags: ['work', 'production'],
      },
      {
        id: 'res-2',
        name: 'Internal admin',
        username: '',
        uri: '',
        folderId: 'f-1',
        folderName: 'Admin',
        tags: [],
      },
    ]))
    vi.stubGlobal('fetch', stub)

    const { login } = renderAppWithLogin(stub)
    await login()

    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(3)

    const dataRows = rows.slice(1)
    expect(dataRows[0]).toHaveTextContent('GitHub')
    expect(dataRows[0]).toHaveTextContent('adil')
    expect(dataRows[0]).toHaveTextContent('https://github.example.test')
    expect(dataRows[0]).toHaveTextContent('—')
    expect(dataRows[0]).toHaveTextContent('work')
    expect(dataRows[0]).toHaveTextContent('production')
    expect(within(dataRows[0]).getByRole('link', { name: 'Open GitHub' })).not.toBeNull()
    expect(within(dataRows[0]).getByRole('link', { name: 'Edit GitHub' })).not.toBeNull()

    expect(dataRows[1]).toHaveTextContent('Internal admin')
    expect(dataRows[1]).toHaveTextContent('—')
    expect(dataRows[1]).toHaveTextContent('Admin')
    expect(within(dataRows[1]).getByRole('link', { name: 'Open Internal admin' })).not.toBeNull()
  })

  it('links each name to /resources/:id and each Edit action to /resources/:id', async () => {
    const stub = vi.fn()
    stub.mockResolvedValueOnce(loginOk)
    stub.mockResolvedValueOnce(mockResources([
      { id: 'abc-123', name: 'MyService', username: 'svc', uri: '', folderId: null, folderName: null, tags: [] },
    ]))
    vi.stubGlobal('fetch', stub)

    const { login } = renderAppWithLogin(stub)
    await login()

    const table = await screen.findByRole('table')
    const nameLink = within(table).getByRole('link', { name: 'Open MyService' })
    expect(nameLink).toHaveAttribute('href', '/resources/abc-123')

    const editLink = within(table).getByRole('link', { name: 'Edit MyService' })
    expect(editLink).toHaveAttribute('href', '/resources/abc-123')
  })

  it('shows a retry affordance on API error', async () => {
    const stub = vi.fn()
    stub.mockResolvedValueOnce(loginOk)
    stub.mockResolvedValueOnce(mockError())
    vi.stubGlobal('fetch', stub)

    const { login } = renderAppWithLogin(stub)
    await login()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Failed to load resources.')

    const retryButton = await screen.findByRole('button', { name: 'Retry' })
    expect(retryButton).not.toBeDisabled()
  })

  it('shows the resource count in the toolbar', async () => {
    const stub = vi.fn()
    stub.mockResolvedValueOnce(loginOk)
    stub.mockResolvedValueOnce(mockResources([
      { id: 'r1', name: 'A', username: '', uri: '', folderId: null, folderName: null, tags: [] },
      { id: 'r2', name: 'B', username: '', uri: '', folderId: null, folderName: null, tags: [] },
      { id: 'r3', name: 'C', username: '', uri: '', folderId: null, folderName: null, tags: [] },
    ]))
    vi.stubGlobal('fetch', stub)

    const { login } = renderAppWithLogin(stub)
    await login()

    expect(await screen.findByText('3 resources')).not.toBeNull()
  })

  it('renders a Refresh button that re-triggers the query', async () => {
    const stub = vi.fn()
    stub.mockResolvedValueOnce(loginOk)
    stub.mockResolvedValueOnce(mockResources([{ id: 'r1', name: 'Old', username: '', uri: '', folderId: null, folderName: null, tags: [] }]))
    stub.mockResolvedValueOnce(mockResources([{ id: 'r2', name: 'New', username: '', uri: '', folderId: null, folderName: null, tags: [] }]))
    vi.stubGlobal('fetch', stub)

    const { login } = renderAppWithLogin(stub)
    await login()

    const table = await screen.findByRole('table')
    expect(within(table).getByText('Old')).not.toBeNull()
    const refreshButton = await screen.findByRole('button', { name: 'Refresh resource list' })
    await userEvent.click(refreshButton)

    await waitFor(() => expect(within(screen.getByRole('table')).getByText('New')).not.toBeNull())
    expect(stub).toHaveBeenCalledTimes(3)
  })
})
