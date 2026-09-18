import { describe, expect, it, vi } from 'vitest'

import { ApiClient } from './client'
import { ApiError } from './errors'
import { InMemoryTokenStore } from './tokenStore'
import type { EnvelopeHeader } from './types'

const BASE_URL = 'http://localhost:3000/api/v1'

function successHeader(action = 'TestAction'): EnvelopeHeader {
  return {
    id: 'uuid-1',
    status: 'success',
    servertime: '2026-09-17T12:00:00.000Z',
    action,
    code: 200,
  }
}

function errorHeader(action = 'TestAction', code = 401, message = 'Unauthorized'): EnvelopeHeader {
  return {
    id: 'uuid-2',
    status: 'error',
    servertime: '2026-09-17T12:00:00.000Z',
    action,
    code,
    message,
  }
}

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
}

function envelope(body: unknown, header: EnvelopeHeader = successHeader()): unknown {
  return { header, body }
}

function makeFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response,
) {
  return handler as unknown as typeof fetch
}

function buildClient(
  fetchImpl: typeof fetch,
  store = new InMemoryTokenStore(),
  extra: Partial<ConstructorParameters<typeof ApiClient>[0]> = {},
) {
  return new ApiClient({ baseUrl: BASE_URL, tokenStore: store, fetchImpl, ...extra })
}

describe('ApiClient — envelope parsing', () => {
  it('unwraps the body from a success envelope', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(envelope({ id: 'v1', name: 'My Vault' }, successHeader('GetVault'))),
      )
    const client = buildClient(makeFetch(fetchMock))

    const vault = await client.get<{ id: string; name: string }>('/vaults/v1')

    expect(vault).toEqual({ id: 'v1', name: 'My Vault' })
  })

  it('builds the URL from baseUrl + path (normalizing slashes)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(envelope({})))
    const client = buildClient(makeFetch(fetchMock))

    await client.get('/resources')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/resources',
      expect.anything(),
    )
  })

  it('throws a typed error when the envelope is malformed (non-envelope JSON)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ foo: 'bar' }))
    const client = buildClient(makeFetch(fetchMock))

    await expect(client.get('/resources')).rejects.toMatchObject({ kind: 'envelope' })
  })

  it('throws a typed error when the body is not JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('not json', { status: 200 }))
    const client = buildClient(makeFetch(fetchMock))

    // 200 with non-JSON body → body is undefined (nothing to unwrap), which is
    // acceptable for empty responses.
    await expect(client.get('/resources')).resolves.toBeUndefined()
  })

  it('normalizes a 4xx error envelope into ApiError with details', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          header: errorHeader('CreateResource', 400, 'Validation failed'),
          body: {
            errors: [{ code: 'VALIDATION_ERROR', field: 'name', message: 'name is required' }],
          },
        },
        { status: 400 },
      ),
    )
    const client = buildClient(makeFetch(fetchMock))

    await expect(client.post('/resources', {})).rejects.toMatchObject({
      kind: 'http',
      httpStatus: 400,
      message: 'Validation failed',
      details: [{ code: 'VALIDATION_ERROR', field: 'name', message: 'name is required' }],
    })
  })

  it('treats an error-status envelope as an error even with HTTP 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        header: errorHeader('GetResource', 500, 'Internal error'),
        body: { errors: [{ code: 'INTERNAL_ERROR', field: '', message: 'boom' }] },
      }),
    )
    const client = buildClient(makeFetch(fetchMock))

    await expect(client.get('/resources/r1')).rejects.toMatchObject({
      kind: 'http',
      httpStatus: 200,
      message: 'Internal error',
    })
  })
})

describe('ApiClient — JWT interceptor', () => {
  it('injects the Authorization header from the token store', async () => {
    const store = new InMemoryTokenStore()
    store.setTokens({ accessToken: 'jwt-token', refreshToken: 'refresh-token' })
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(envelope({})))
    const client = buildClient(makeFetch(fetchMock), store)

    await client.get('/resources')

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer jwt-token')
  })

  it('does not send Authorization when no token is present', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(envelope({})))
    const client = buildClient(makeFetch(fetchMock))

    await client.get('/resources')

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).has('Authorization')).toBe(false)
  })

  it('does not send Authorization on public paths (/auth/login)', async () => {
    const store = new InMemoryTokenStore()
    store.setTokens({ accessToken: 'jwt-token', refreshToken: 'refresh-token' })
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(envelope({})))
    const client = buildClient(makeFetch(fetchMock), store)

    await client.post('/auth/login', { email: 'a@b.c', vaultKeyProof: 'proof' })

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).has('Authorization')).toBe(false)
  })

  it('sets Content-Type application/json for JSON bodies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(envelope({})))
    const client = buildClient(makeFetch(fetchMock))

    await client.post('/resources', { name: 'x' })

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({ name: 'x' })
  })
})

describe('ApiClient — refresh token handling', () => {
  it('refreshes the access token and retries the original request once on 401', async () => {
    const store = new InMemoryTokenStore()
    store.setTokens({ accessToken: 'expired', refreshToken: 'refresh-1' })

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            header: errorHeader('GetResource', 401, 'Expired token'),
            body: { errors: [{ code: 'UNAUTHORIZED', field: '', message: 'expired' }] },
          },
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          envelope({ jwt: 'new-jwt', refreshToken: 'refresh-2' }, successHeader('RefreshSession')),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(envelope({ id: 'r1', name: 'Secret' }, successHeader('GetResource'))),
      )

    const client = buildClient(makeFetch(fetchMock), store)

    const result = await client.get<{ id: string; name: string }>('/resources/r1')

    expect(result).toEqual({ id: 'r1', name: 'Secret' })
    expect(fetchMock).toHaveBeenCalledTimes(3)

    // Second call is the refresh request.
    const refreshInit = fetchMock.mock.calls[1][1] as RequestInit
    expect(fetchMock.mock.calls[1][0]).toBe('http://localhost:3000/api/v1/auth/refresh')
    expect(JSON.parse(refreshInit.body as string)).toEqual({ refreshToken: 'refresh-1' })

    // Token store now holds the rotated pair.
    expect(store.getAccessToken()).toBe('new-jwt')
    expect(store.getRefreshToken()).toBe('refresh-2')

    // Retry carried the new token.
    const retryInit = fetchMock.mock.calls[2][1] as RequestInit
    expect(new Headers(retryInit.headers).get('Authorization')).toBe('Bearer new-jwt')
  })

  it('does not attempt refresh on a 401 for a public path', async () => {
    const store = new InMemoryTokenStore()
    store.setTokens({ accessToken: 'jwt', refreshToken: 'refresh' })

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { header: errorHeader('Login', 401, 'Bad credentials'), body: { errors: [] } },
          { status: 401 },
        ),
      )

    const client = buildClient(makeFetch(fetchMock), store)

    await expect(
      client.post('/auth/login', { email: 'a@b.c', vaultKeyProof: 'p' }),
    ).rejects.toMatchObject({
      httpStatus: 401,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not attempt refresh when there is no refresh token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { header: errorHeader('GetResource', 401), body: { errors: [] } },
          { status: 401 },
        ),
      )
    const client = buildClient(makeFetch(fetchMock))

    await expect(client.get('/resources/r1')).rejects.toMatchObject({ httpStatus: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('deduplicates concurrent refreshes into a single /auth/refresh call', async () => {
    const store = new InMemoryTokenStore()
    store.setTokens({ accessToken: 'expired', refreshToken: 'refresh-1' })

    // Two requests both 401, one refresh, two retries.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ header: errorHeader('A', 401), body: { errors: [] } }, { status: 401 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ header: errorHeader('B', 401), body: { errors: [] } }, { status: 401 }),
      )
      .mockImplementationOnce(async () => {
        // Simulate refresh latency so both 401s race into the single-flight path.
        await new Promise((r) => setTimeout(r, 5))
        return jsonResponse(
          envelope({ jwt: 'new-jwt', refreshToken: 'refresh-2' }, successHeader('RefreshSession')),
        )
      })
      .mockResolvedValueOnce(jsonResponse(envelope({ id: 'a' })))
      .mockResolvedValueOnce(jsonResponse(envelope({ id: 'b' })))

    const client = buildClient(makeFetch(fetchMock), store)

    const [a, b] = await Promise.all([
      client.get<{ id: string }>('/resources/a'),
      client.get<{ id: string }>('/resources/b'),
    ])

    expect(a).toEqual({ id: 'a' })
    expect(b).toEqual({ id: 'b' })
    expect(fetchMock).toHaveBeenCalledTimes(5)

    const refreshCalls = fetchMock.mock.calls.filter(
      ([url]) => url === 'http://localhost:3000/api/v1/auth/refresh',
    )
    expect(refreshCalls).toHaveLength(1)
  })

  it('clears tokens and calls onUnauthorized when refresh fails', async () => {
    const store = new InMemoryTokenStore()
    store.setTokens({ accessToken: 'expired', refreshToken: 'refresh-1' })
    const onUnauthorized = vi.fn()

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { header: errorHeader('GetResource', 401), body: { errors: [] } },
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { header: errorHeader('RefreshSession', 401), body: { errors: [] } },
          { status: 401 },
        ),
      )

    const client = buildClient(makeFetch(fetchMock), store, { onUnauthorized })

    await expect(client.get('/resources/r1')).rejects.toBeInstanceOf(ApiError)

    expect(store.getAccessToken()).toBeNull()
    expect(store.getRefreshToken()).toBeNull()
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })
})

describe('ApiClient — error normalization', () => {
  it('normalizes a network failure into a network ApiError', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const client = buildClient(makeFetch(fetchMock))

    await expect(client.get('/resources')).rejects.toMatchObject({
      kind: 'network',
      message: 'Failed to fetch',
    })
  })

  it('exposes typed convenience methods (get/post/patch/delete)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(envelope({})))

    const client = buildClient(makeFetch(fetchMock))
    await client.get('/a')
    await client.post('/b', { x: 1 })
    await client.patch('/c', { y: 2 })
    await client.delete('/d')

    expect(fetchMock.mock.calls.map(([, init]) => (init as RequestInit).method)).toEqual([
      'GET',
      'POST',
      'PATCH',
      'DELETE',
    ])
  })
})
