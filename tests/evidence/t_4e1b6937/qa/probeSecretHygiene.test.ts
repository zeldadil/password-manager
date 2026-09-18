import { writeFileSync } from 'node:fs'
import { describe, it, vi } from 'vitest'
import { ApiClient } from './api/client'
import { ApiError } from './api/errors'
import { InMemoryTokenStore } from './api/tokenStore'
import type { EnvelopeHeader } from './api/types'

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

function shape(error: unknown) {
  return {
    isApiError: error instanceof ApiError,
    message: (error as Error).message,
    kind: (error as { kind?: unknown }).kind,
    httpStatus: (error as { httpStatus?: unknown }).httpStatus,
    details: (error as { details?: unknown }).details,
    ownsDocumentationUrl: Object.prototype.hasOwnProperty.call(error, 'documentationUrl'),
    stringified: JSON.stringify(error),
  }
}

describe('probe 2: reused vs fresh Response in the secret-hygiene scenario', () => {
  it('compares mockResolvedValue (single shared Response) with a fresh Response per call', async () => {
    const envelope401 = () =>
      jsonResponse(
        {
          header: successHeader({ status: 'error', code: 401, message: 'Unauthorized' }),
          body: { errors: [{ code: 'UNAUTHORIZED', field: '', message: 'invalid token' }] },
        },
        401,
      )

    const store1 = new InMemoryTokenStore()
    store1.setTokens({ accessToken: 'super-secret-jwt', refreshToken: 'refresh-1' })
    // Exactly what envelope.test.ts does: ONE Response object resurfaced for every call.
    const shared = vi.fn().mockResolvedValue(envelope401())
    const clientShared = new ApiClient({
      baseUrl: BASE_URL,
      tokenStore: store1,
      fetchImpl: shared as unknown as typeof fetch,
    })
    const sharedError = await clientShared.get('/resources').catch((e: unknown) => e)

    const store2 = new InMemoryTokenStore()
    store2.setTokens({ accessToken: 'super-secret-jwt', refreshToken: 'refresh-1' })
    // A fresh Response per call — the realistic server behaviour.
    const fresh = vi.fn().mockImplementation(() => Promise.resolve(envelope401()))
    const clientFresh = new ApiClient({
      baseUrl: BASE_URL,
      tokenStore: store2,
      fetchImpl: fresh as unknown as typeof fetch,
    })
    const freshError = await clientFresh.get('/resources').catch((e: unknown) => e)

    writeFileSync(
      '/tmp/qa-probe2.json',
      JSON.stringify(
        {
          fetchCallsShared: shared.mock.calls.length,
          sharedResponseError: shape(sharedError),
          fetchCallsFresh: fresh.mock.calls.length,
          freshResponseError: shape(freshError),
        },
        null,
        2,
      ),
    )
  })
})
