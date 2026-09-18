import { describe, expect, it, vi } from 'vitest'
import { ApiClient } from './client'
import { ApiError } from './errors'
import { InMemoryTokenStore } from './tokenStore'
import type { EnvelopeHeader } from './types'

/**
 * API client envelope-parsing edge cases (FE-001i).
 *
 * The happy path (unwrap `body`, typed errors, refresh/single-flight) is covered
 * by `client.test.ts` (FE-001f). These tests pin the parsing branches that were
 * not exercised: URL normalization, empty/partial envelopes, an error envelope
 * that contradicts its HTTP status, non-envelope error payloads, and the
 * malformed-refresh path that clears the session.
 */

const BASE_URL = 'http://localhost:3000/api/v1'

function successHeader(overrides: Partial<EnvelopeHeader> = {}): EnvelopeHeader {
  return {
    id: 'uuid-1',
    status: 'success',
    servertime: '2026-09-18T12:00:00.000Z',
    action: 'TestAction',
    code: 200,
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
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

describe('ApiClient — URL normalization', () => {
  it('strips trailing slashes from the base URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ header: successHeader(), body: {} }))
    const client = new ApiClient({
      baseUrl: 'http://localhost:3000/api/v1///',
      tokenStore: new InMemoryTokenStore(),
      fetchImpl: makeFetch(fetchMock),
    })

    await client.get('/resources')

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3000/api/v1/resources')
  })

  it('adds the leading slash when the path omits it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ header: successHeader(), body: {} }))
    const client = buildClient(makeFetch(fetchMock))

    await client.get('resources')

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3000/api/v1/resources')
  })
})

describe('ApiClient — envelope edge cases', () => {
  it('resolves undefined for an empty (204) response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const client = buildClient(makeFetch(fetchMock))

    await expect(client.delete('/resources/r1')).resolves.toBeUndefined()
  })

  it('resolves undefined when the envelope carries no body key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ header: successHeader() }))
    const client = buildClient(makeFetch(fetchMock))

    await expect(client.get('/resources')).resolves.toBeUndefined()
  })

  it('treats a success-status envelope with code >= 400 as an error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ header: successHeader({ code: 500 }), body: {} }))
    const client = buildClient(makeFetch(fetchMock))

    await expect(client.get('/resources')).rejects.toMatchObject({
      kind: 'http',
      httpStatus: 200,
    })
  })

  it('normalizes a non-envelope JSON error payload into a generic ApiError', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: 'boom' }, 500))
    const client = buildClient(makeFetch(fetchMock))

    await expect(client.get('/resources')).rejects.toMatchObject({
      kind: 'http',
      httpStatus: 500,
      message: 'Request failed with status 500',
      details: [],
    })
  })

  it('normalizes a non-JSON error payload into a generic ApiError', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502 }))
    const client = buildClient(makeFetch(fetchMock))

    await expect(client.get('/resources')).rejects.toMatchObject({
      kind: 'http',
      httpStatus: 502,
      message: 'Request failed with status 502',
    })
  })
})

describe('ApiClient — malformed refresh', () => {
  it('clears the session and reports an envelope error when the refresh body is malformed', async () => {
    const store = new InMemoryTokenStore()
    store.setTokens({ accessToken: 'expired', refreshToken: 'refresh-1' })
    const onUnauthorized = vi.fn()

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            header: successHeader({ status: 'error', code: 401, message: 'Expired token' }),
            body: { errors: [{ code: 'UNAUTHORIZED', field: '', message: 'expired' }] },
          },
          401,
        ),
      )
      // 200, but the body is not a `{ jwt, refreshToken }` pair.
      .mockResolvedValueOnce(jsonResponse({ header: successHeader(), body: { jwt: 42 } }))

    const client = buildClient(makeFetch(fetchMock), store, { onUnauthorized })

    await expect(client.get('/resources/r1')).rejects.toMatchObject({
      kind: 'envelope',
      message: 'Malformed refresh response',
    })

    expect(store.getAccessToken()).toBeNull()
    expect(store.getRefreshToken()).toBeNull()
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('refuses to refresh when the store holds no refresh token', async () => {
    const fetchMock = vi.fn()
    const client = buildClient(makeFetch(fetchMock))

    await expect(client.refresh()).rejects.toMatchObject({
      kind: 'unauthorized',
      httpStatus: 401,
      message: 'No refresh token available',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('ApiClient — secret hygiene in errors', () => {
  it('never echoes the bearer token into the thrown error', async () => {
    const store = new InMemoryTokenStore()
    store.setTokens({ accessToken: 'super-secret-jwt', refreshToken: 'refresh-1' })

    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          header: successHeader({ status: 'error', code: 401, message: 'Unauthorized' }),
          body: { errors: [{ code: 'UNAUTHORIZED', field: '', message: 'invalid token' }] },
        },
        401,
      ),
    )
    const client = buildClient(makeFetch(fetchMock), store)

    const error = await client.get('/resources').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(JSON.stringify(error)).not.toContain('super-secret-jwt')
    expect((error as ApiError).message).not.toContain('super-secret-jwt')
  })
})
