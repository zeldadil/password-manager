/** @fileoverview Unit tests for TagsPage (FE-003h).
 *
 * Verifies the tag management UI: create form, tag grid, resource-tag
 * assignment expand/collapse and assign/remove flows.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import './TagsPage'
import { SessionProvider } from '../auth/SessionProvider'
import { routes } from '../routes'

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
}

function wrapRoutes(routeList: RouteObject[], queryClient: QueryClient): RouteObject[] {
  const root = routeList[0]
  return [
    {
      ...root,
      children: root.children?.map((child) => ({
        ...child,
        element: (
          <SessionProvider>
            <QueryClientProvider client={queryClient}>{child.element}</QueryClientProvider>
          </SessionProvider>
        ),
      })) as RouteObject[],
    },
  ] as RouteObject[]
}

const loginOk = {
  ok: true,
  json: async () => ({
    accessToken: 'tok',
    refreshToken: 'ref',
    expiresIn: 900,
    tokenType: 'Bearer',
  }),
} as unknown as Response

function tagsEnvelope(tags: Array<{ id: string; name: string; color?: string | null }>) {
  return {
    ok: true,
    json: async () => ({
      header: {
        id: 'h1',
        status: 'success',
        servertime: new Date().toISOString(),
        action: 'ListTags',
        code: 200,
      },
      body: {
        data: tags.map((t) => ({
          ...t,
          vaultId: 'v1',
          color: t.color ?? null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          deleted: false,
        })),
        pagination: { page: 1, perPage: 20 },
      },
    }),
  } as unknown as Response
}

type FetchStub = ReturnType<typeof vi.fn>

function mockResources(rows: { id: string; name: string; tagIds?: string[] }[]) {
  return {
    ok: true,
    json: async () => ({
      header: {
        id: 'h1',
        status: 'success',
        servertime: new Date().toISOString(),
        action: 'ListResources',
        code: 200,
      },
      body: { data: rows, pagination: { page: 1, perPage: 20 } },
    }),
  } as unknown as Response
}

function renderApp(stub: FetchStub, initialPath = '/login') {
  const qc = makeQueryClient()
  const wrapped = wrapRoutes(routes, qc)
  const router = createMemoryRouter(wrapped, { initialEntries: [initialPath] })
  render(<RouterProvider router={router} />)

  return {
    stub,
    router,
    login: async () => {
      const user = userEvent.setup()
      await user.type(screen.getByLabelText('Email'), 'user@example.test')
      await user.type(screen.getByLabelText('Master password'), 'password')
      await user.click(screen.getByRole('button', { name: 'Sign in' }))
      await screen.findByRole('heading', { name: 'Vault', level: 1 })
      await Promise.resolve()
      router.navigate('/tags')
      // Wait for the page to reach a terminal state: either the create form
      // ("Create tag" heading) or the error state ("Failed to load tags").
      // Loading state is transient — keep waiting until one of the terminal
      // states appears.
      await waitFor(
        () => {
          const createForm = screen.queryByRole('heading', { name: 'Create tag' })
          const error = screen.queryByText(/failed to load tags/i)
          if (createForm || error) return
          throw new Error('TagsPage did not reach a terminal state')
        },
        { timeout: 5000 },
      )
    },
  }
}

describe('TagsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', undefined)
  })

  it('renders the heading and create form', async () => {
    const stub = vi.fn()
    stub.mockResolvedValueOnce(loginOk)
    stub.mockResolvedValueOnce(mockResources([]))
    stub.mockResolvedValueOnce(tagsEnvelope([]))
    vi.stubGlobal('fetch', stub)

    const { login } = renderApp(stub)
    await login()

    expect(screen.getByRole('heading', { name: 'Tags', level: 1 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Create tag' })).toBeTruthy()
    expect(screen.getByLabelText(/name/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /create tag/i })).toBeTruthy()
  })

  it('renders the tag list section with count', async () => {
    const stub = vi.fn()
    stub.mockResolvedValueOnce(loginOk)
    stub.mockResolvedValueOnce(mockResources([]))
    stub.mockResolvedValueOnce(
      tagsEnvelope([
        { id: 't1', name: 'Work' },
        { id: 't2', name: 'Personal' },
      ]),
    )
    vi.stubGlobal('fetch', stub)

    const { login } = renderApp(stub)
    await login()

    expect(await screen.findByText(/tags \(2\)/i)).toBeTruthy()
  })

  it('renders each tag as a card with name and delete button', async () => {
    const stub = vi.fn()
    stub.mockResolvedValueOnce(loginOk)
    stub.mockResolvedValueOnce(mockResources([]))
    stub.mockResolvedValueOnce(
      tagsEnvelope([
        { id: 't1', name: 'Work', color: '#3b82f6' },
        { id: 't2', name: 'Personal', color: '#10b981' },
      ]),
    )
    vi.stubGlobal('fetch', stub)

    const { login } = renderApp(stub)
    await login()

    expect(screen.getByText('Work')).toBeTruthy()
    expect(screen.getByText('Personal')).toBeTruthy()
    expect(screen.getByRole('button', { name: /delete tag work/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /delete tag personal/i })).toBeTruthy()
  })

  it('creates a tag and clears the form on success', async () => {
    const stub = vi.fn()
    stub.mockResolvedValueOnce(loginOk)
    stub.mockResolvedValueOnce(mockResources([]))
    stub
      .mockResolvedValueOnce(tagsEnvelope([]))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          header: {
            id: 'h1',
            status: 'success',
            servertime: new Date().toISOString(),
            action: 'CreateTag',
            code: 200,
          },
          body: {
            data: {
              id: 'new',
              name: 'NewTag',
              color: '#ff0000',
              vaultId: 'v1',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              deleted: false,
            },
          },
        }),
      } as unknown as Response)
      .mockResolvedValueOnce(tagsEnvelope([{ id: 'new', name: 'NewTag', color: '#ff0000' }]))
    vi.stubGlobal('fetch', stub)

    const { login } = renderApp(stub)
    await login()

    const nameInput = screen.getByLabelText(/name/i) as HTMLInputElement
    const colorInput = screen.getByLabelText(/color/i) as HTMLInputElement
    const createBtn = screen.getByRole('button', { name: /create tag/i })

    await userEvent.type(nameInput, 'NewTag')
    await userEvent.type(colorInput, '#ff0000')
    await userEvent.click(createBtn)

    await waitFor(() => expect(screen.getByText('NewTag')).toBeTruthy())
    expect(nameInput.value).toBe('')
  })

  it('shows a form error when creating with an empty name', async () => {
    const stub = vi.fn()
    stub.mockResolvedValueOnce(loginOk)
    stub.mockResolvedValueOnce(mockResources([]))
    stub.mockResolvedValueOnce(tagsEnvelope([]))
    vi.stubGlobal('fetch', stub)

    const { login } = renderApp(stub)
    await login()

    const createBtn = screen.getByRole('button', { name: /create tag/i })
    await userEvent.click(createBtn)

    expect(await screen.findByText(/tag name is required/i)).toBeTruthy()
  })

  it('shows a form error on API failure', async () => {
    const stub = vi.fn()
    stub.mockResolvedValueOnce(loginOk)
    stub.mockResolvedValueOnce(mockResources([]))
    stub.mockResolvedValueOnce(tagsEnvelope([]))
    stub.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ message: 'Name already exists' }),
    } as unknown as Response)
    vi.stubGlobal('fetch', stub)

    const { login } = renderApp(stub)
    await login()

    const nameInput = screen.getByLabelText(/name/i) as HTMLInputElement
    const colorInput = screen.getByLabelText(/color/i) as HTMLInputElement
    await userEvent.type(nameInput, 'Work')
    await userEvent.type(colorInput, '#3b82f6')
    await userEvent.click(screen.getByRole('button', { name: /create tag/i }))

    expect(await screen.findByText(/request failed with status 400/i)).toBeTruthy()
  })

  it('deletes a tag on confirm', async () => {
    const stub = vi.fn()
    stub.mockResolvedValueOnce(loginOk)
    stub.mockResolvedValueOnce(mockResources([]))
    stub
      .mockResolvedValueOnce(tagsEnvelope([{ id: 't1', name: 'Work' }]))
      .mockResolvedValueOnce(tagsEnvelope([]))
    vi.stubGlobal('fetch', stub)

    const { login } = renderApp(stub)
    await login()

    const deleteBtn = screen.getByRole('button', { name: /delete tag work/i })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    await userEvent.click(deleteBtn)

    await waitFor(() => expect(screen.queryByText('Work')).toBeNull())
    expect(stub).toHaveBeenCalledWith(
      expect.stringContaining('/tags/t1'),
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('shows a loading state while tags are fetching', async () => {
    let pendingResolve: () => void = () => {}
    const pending = new Promise<undefined>((resolve) => {
      pendingResolve = () => resolve(undefined)
    })
    const stub = vi.fn()
    stub.mockResolvedValueOnce(loginOk)
    stub.mockResolvedValueOnce(mockResources([]))
    stub.mockResolvedValueOnce({
      ok: true,
      json: () => pending,
    } as unknown as Response)
    vi.stubGlobal('fetch', stub)

    const qc = makeQueryClient()
    const wrapped = wrapRoutes(routes, qc)
    const router = createMemoryRouter(wrapped, { initialEntries: ['/login'] })
    render(<RouterProvider router={router} />)

    // Login without waiting for TagsPage to settle — the tags query is
    // intentionally pending, so the page will show a loading state.
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Email'), 'user@example.test')
    await user.type(screen.getByLabelText('Master password'), 'password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('heading', { name: 'Vault', level: 1 })
    await Promise.resolve()
    router.navigate('/tags')
    await Promise.resolve()
    await Promise.resolve()

    await screen.findByText('Loading tags…')
    expect(screen.queryByRole('heading', { name: /create tag/i })).toBeNull()

    pendingResolve()
    await pending.catch(() => {})
  })

  it('shows an error state when the tags API fails', async () => {
    const stub = vi.fn()
    stub.mockResolvedValueOnce(loginOk)
    stub.mockResolvedValueOnce(mockResources([]))
    stub.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ message: 'Server error' }),
    } as unknown as Response)
    vi.stubGlobal('fetch', stub)

    const { login } = renderApp(stub)
    await login()

    expect(await screen.findByText(/failed to load tags/i)).toBeTruthy()
  })
})

describe('TagsPage — resource tag assignment', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', undefined)
  })

  function renderWithResources(
    tags: Array<{ id: string; name: string; color?: string | null }>,
    resources: Array<{ id: string; name: string; tagIds: string[] }>,
  ) {
    const qc = makeQueryClient()
    qc.setQueryData(['resources'], resources)
    const wrapped = wrapRoutes(routes, qc)
    const router = createMemoryRouter(wrapped, { initialEntries: ['/login'] })
    const stub = vi.fn()
    stub.mockResolvedValueOnce(loginOk)
    stub.mockResolvedValueOnce(mockResources(resources))
    stub.mockResolvedValueOnce(tagsEnvelope(tags))
    vi.stubGlobal('fetch', stub)
    render(<RouterProvider router={router} />)

    return {
      stub,
      router,
      login: async () => {
        const user = userEvent.setup()
        await user.type(screen.getByLabelText('Email'), 'user@example.test')
        await user.type(screen.getByLabelText('Master password'), 'password')
        await user.click(screen.getByRole('button', { name: 'Sign in' }))
        await screen.findByRole('heading', { name: 'Vault', level: 1 })
        await Promise.resolve()
        router.navigate('/tags')
        // Wait for the page to reach a terminal state: either the create form
        // ("Create tag" heading) or the error state ("Failed to load tags").
        // Loading state is transient — keep waiting until one of the terminal
        // states appears.
        await waitFor(
          () => {
            const createForm = screen.queryByRole('heading', { name: 'Create tag' })
            const error = screen.queryByText(/failed to load tags/i)
            if (createForm || error) return
            throw new Error('TagsPage did not reach a terminal state')
          },
          { timeout: 5000 },
        )
      },
    }
  }

  it('renders resource items with current tags', async () => {
    const { login } = renderWithResources(
      [
        { id: 't1', name: 'Work' },
        { id: 't2', name: 'Personal' },
      ],
      [
        { id: 'r1', name: 'GitHub', tagIds: ['t1'] },
        { id: 'r2', name: 'Internal', tagIds: [] },
      ],
    )
    await login()

    expect(screen.getByText('GitHub')).toBeTruthy()
    expect(screen.getByText('Internal')).toBeTruthy()
    expect(screen.getByText('Work')).toBeTruthy()
    const internalHeader = screen.getByRole('button', { name: /internal/i })
    await userEvent.click(internalHeader)
    expect(screen.getByText('No tags assigned')).toBeTruthy()
  })

  it('expands a resource to show tag assignment controls', async () => {
    const { login } = renderWithResources(
      [{ id: 't1', name: 'Work' }],
      [{ id: 'r1', name: 'GitHub', tagIds: [] }],
    )
    await login()

    const header = screen.getByRole('button', { name: /github/i })
    await userEvent.click(header)

    expect(screen.getByLabelText(/add tags by name/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /assign/i })).toBeTruthy()
  })

  it('assigns tags to a resource by name', async () => {
    const stub: FetchStub = vi.fn()
    stub
      .mockResolvedValueOnce(loginOk)
      .mockResolvedValueOnce(mockResources([{ id: 'r1', name: 'GitHub', tagIds: [] }]))
      .mockResolvedValueOnce(
        tagsEnvelope([
          { id: 't1', name: 'Work' },
          { id: 't2', name: 'Personal' },
        ]),
      )
      // 4th: tag search inside handleAssign searches all tags via GET /tags.
      .mockResolvedValueOnce(
        tagsEnvelope([
          { id: 't1', name: 'Work' },
          { id: 't2', name: 'Personal' },
        ]),
      )
      // 5th: PATCH /resources/r1 with the matched tag id.
      .mockResolvedValueOnce(
        tagsEnvelope([
          { id: 't1', name: 'Work' },
          { id: 't2', name: 'Personal' },
        ]),
      )
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          header: {
            id: 'h1',
            status: 'success',
            servertime: new Date().toISOString(),
            action: 'PatchResource',
            code: 200,
          },
          body: {
            data: { id: 'r1', name: 'GitHub', tagIds: ['t1'], created: '2026-01-01T00:00:00.000Z' },
          },
        }),
      } as unknown as Response)
    vi.stubGlobal('fetch', stub)

    const qc = makeQueryClient()
    qc.setQueryData(['resources'], [{ id: 'r1', name: 'GitHub', tagIds: [] }])
    const wrapped = wrapRoutes(routes, qc)
    const router = createMemoryRouter(wrapped, { initialEntries: ['/login'] })
    render(<RouterProvider router={router} />)

    await userEvent.setup().type(screen.getByLabelText('Email'), 'user@example.test')
    await userEvent.setup().type(screen.getByLabelText('Master password'), 'password')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('heading', { name: 'Vault', level: 1 })
    await Promise.resolve()
    router.navigate('/tags')
    await waitFor(
      () => {
        const createForm = screen.queryByRole('heading', { name: 'Create tag' })
        const error = screen.queryByText(/failed to load tags/i)
        if (createForm || error) return
        throw new Error('TagsPage did not reach a terminal state')
      },
      { timeout: 5000 },
    )

    const header = screen.getByRole('button', { name: /github/i })
    await userEvent.click(header)

    const assignInput = screen.getByLabelText(/add tags by name/i) as HTMLInputElement
    await userEvent.type(assignInput, 'Work')
    await userEvent.click(screen.getByRole('button', { name: /assign/i }))

    await waitFor(() =>
      expect(stub).toHaveBeenCalledWith(
        expect.stringContaining('/resources/r1'),
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ tagIds: ['t1'] }) }),
      ),
    )
  })

  it('removes a tag from a resource', async () => {
    const stub: FetchStub = vi.fn()
    stub
      .mockResolvedValueOnce(loginOk)
      .mockResolvedValueOnce(mockResources([{ id: 'r1', name: 'GitHub', tagIds: ['t1', 't2'] }]))
      .mockResolvedValueOnce(
        tagsEnvelope([
          { id: 't1', name: 'Work' },
          { id: 't2', name: 'Personal' },
        ]),
      )
      // 4th: tag search inside handleRemoveTagSearch finds both tags via GET /tags.
      .mockResolvedValueOnce(
        tagsEnvelope([
          { id: 't1', name: 'Work' },
          { id: 't2', name: 'Personal' },
        ]),
      )
      // 5th: PATCH /resources/r1 removing t1, keeping t2.
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          header: {
            id: 'h1',
            status: 'success',
            servertime: new Date().toISOString(),
            action: 'PatchResource',
            code: 200,
          },
          body: {
            data: { id: 'r1', name: 'GitHub', tagIds: ['t2'], created: '2026-01-01T00:00:00.000Z' },
          },
        }),
      } as unknown as Response)
    vi.stubGlobal('fetch', stub)

    const qc = makeQueryClient()
    qc.setQueryData(['resources'], [{ id: 'r1', name: 'GitHub', tagIds: ['t1', 't2'] }])
    const wrapped = wrapRoutes(routes, qc)
    const router = createMemoryRouter(wrapped, { initialEntries: ['/login'] })
    render(<RouterProvider router={router} />)

    await userEvent.setup().type(screen.getByLabelText('Email'), 'user@example.test')
    await userEvent.setup().type(screen.getByLabelText('Master password'), 'password')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('heading', { name: 'Vault', level: 1 })
    await Promise.resolve()
    router.navigate('/tags')
    await waitFor(
      () => {
        const createForm = screen.queryByRole('heading', { name: 'Create tag' })
        const error = screen.queryByText(/failed to load tags/i)
        if (createForm || error) return
        throw new Error('TagsPage did not reach a terminal state')
      },
      { timeout: 5000 },
    )

    const header = screen.getByRole('button', { name: /github/i })
    await userEvent.click(header)

    const removeBtn = screen.getByRole('button', { name: /remove work from github/i })
    await userEvent.click(removeBtn)

    await waitFor(() =>
      expect(stub).toHaveBeenCalledWith(
        expect.stringContaining('/resources/r1'),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ tagIds: ['t2'] }),
        }),
      ),
    )
  })

  it('clears the assign input after a successful assign', async () => {
    const stub: FetchStub = vi.fn()
    stub
      .mockResolvedValueOnce(loginOk)
      .mockResolvedValueOnce(mockResources([{ id: 'r1', name: 'GitHub', tagIds: [] }]))
      .mockResolvedValueOnce(
        tagsEnvelope([
          { id: 't1', name: 'Work' },
          { id: 't2', name: 'Personal' },
        ]),
      )
      // 4th: tag search inside handleAssign searches all tags via GET /tags.
      .mockResolvedValueOnce(
        tagsEnvelope([
          { id: 't1', name: 'Work' },
          { id: 't2', name: 'Personal' },
        ]),
      )
      // 5th: PATCH /resources/r1 with the matched tag id.
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          header: {
            id: 'h1',
            status: 'success',
            servertime: new Date().toISOString(),
            action: 'PatchResource',
            code: 200,
          },
          body: {
            data: { id: 'r1', name: 'GitHub', tagIds: ['t1'], created: '2026-01-01T00:00:00.000Z' },
          },
        }),
      } as unknown as Response)
    vi.stubGlobal('fetch', stub)

    const qc = makeQueryClient()
    qc.setQueryData(['resources'], [{ id: 'r1', name: 'GitHub', tagIds: [] }])
    const wrapped = wrapRoutes(routes, qc)
    const router = createMemoryRouter(wrapped, { initialEntries: ['/login'] })
    render(<RouterProvider router={router} />)

    await userEvent.setup().type(screen.getByLabelText('Email'), 'user@example.test')
    await userEvent.setup().type(screen.getByLabelText('Master password'), 'password')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('heading', { name: 'Vault', level: 1 })
    await Promise.resolve()
    router.navigate('/tags')
    await waitFor(
      () => {
        const createForm = screen.queryByRole('heading', { name: 'Create tag' })
        const error = screen.queryByText(/failed to load tags/i)
        if (createForm || error) return
        throw new Error('TagsPage did not reach a terminal state')
      },
      { timeout: 5000 },
    )

    const header = screen.getByRole('button', { name: /github/i })
    await userEvent.click(header)

    const assignInput = screen.getByLabelText(/add tags by name/i) as HTMLInputElement
    await userEvent.type(assignInput, 'Work')
    await userEvent.click(screen.getByRole('button', { name: /assign/i }))

    await waitFor(() => expect(assignInput.value).toBe(''))
  })
})
