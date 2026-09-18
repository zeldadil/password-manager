import { writeFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { ApiClient } from './api/client'
import { ApiError } from './api/errors'
import { InMemoryTokenStore } from './api/tokenStore'
import type { EnvelopeHeader } from './api/types'

function header(overrides: Partial<EnvelopeHeader> = {}): EnvelopeHeader {
  return {
    id: 'uuid-1',
    status: 'success',
    servertime: '2026-09-18T12:00:00.000Z',
    action: 'TestAction',
    code: 200,
    ...overrides,
  }
}

describe('probe: what error does the secret-hygiene test actually observe', () => {
  it('dumps the caught error shape to /tmp/qa-probe-error.json', async () => {
    const store = new InMemoryTokenStore()
    store.setTokens({ accessToken: 'super-secret-jwt', refreshToken: 'refresh-1' })

    const calls: string[] = []
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(
        `${init?.method ?? 'GET'} ${String(input)} auth=${new Headers(init?.headers).get('Authorization')}`,
      )
      return new Response(
        JSON.stringify({
          header: header({ status: 'error', code: 401, message: 'Unauthorized' }),
          body: { errors: [{ code: 'UNAUTHORIZED', field: '', message: 'invalid token' }] },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const client = new ApiClient({
      baseUrl: 'http://localhost:3000/api/v1',
      tokenStore: store,
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    const error = await client.get('/resources').catch((e: unknown) => e)
    const direct = new ApiError({
      message: 'm',
      kind: 'http',
      httpStatus: 401,
      documentationUrl: 'Bearer super-secret-jwt',
    })

    writeFileSync(
      '/tmp/qa-probe-error.json',
      JSON.stringify(
        {
          calls,
          isApiError: error instanceof ApiError,
          message: (error as Error).message,
          ownKeys: Object.keys(error as object),
          stringified: JSON.stringify(error),
          directStringified: JSON.stringify(direct),
          directKeys: Object.keys(direct),
        },
        null,
        2,
      ),
    )
  })
})
