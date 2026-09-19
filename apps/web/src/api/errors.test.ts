import { describe, expect, it } from 'vitest'

import { ApiError, apiErrorFromEnvelope, toApiError } from './errors'
import type { EnvelopeErrorBody, EnvelopeHeader } from './types'

const successHeader: EnvelopeHeader = {
  id: 'uuid-1',
  status: 'success',
  servertime: '2026-09-17T12:00:00.000Z',
  action: 'ListResources',
  code: 200,
}

describe('ApiError', () => {
  it('has name ApiError and exposes kind/status/details', () => {
    const err = new ApiError({
      message: 'boom',
      kind: 'http',
      httpStatus: 404,
      action: 'GetResource',
      details: [{ code: 'NOT_FOUND', field: 'id', message: 'resource missing' }],
    })

    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ApiError')
    expect(err.message).toBe('boom')
    expect(err.kind).toBe('http')
    expect(err.httpStatus).toBe(404)
    expect(err.action).toBe('GetResource')
    expect(err.details).toHaveLength(1)
    expect(err.code).toBe('NOT_FOUND')
    expect(err.isUnauthorized).toBe(false)
  })

  it('isUnauthorized is true for 401', () => {
    expect(new ApiError({ message: 'nope', kind: 'http', httpStatus: 401 }).isUnauthorized).toBe(
      true,
    )
    expect(new ApiError({ message: 'nope', kind: 'unauthorized' }).isUnauthorized).toBe(true)
    expect(new ApiError({ message: 'nope', kind: 'http', httpStatus: 403 }).isUnauthorized).toBe(
      false,
    )
  })

  it('code is null when there are no details', () => {
    expect(new ApiError({ message: 'nope', kind: 'network' }).code).toBeNull()
  })
})

describe('apiErrorFromEnvelope', () => {
  const errorHeader: EnvelopeHeader = {
    id: 'uuid-2',
    status: 'error',
    servertime: '2026-09-17T12:00:00.000Z',
    action: 'CreateResource',
    message: 'Validation failed',
    code: 400,
  }

  it('maps header + error details into a typed ApiError', () => {
    const body: EnvelopeErrorBody = {
      errors: [{ code: 'VALIDATION_ERROR', field: 'name', message: 'name is required' }],
      documentationUrl: 'https://example.com/docs',
    }

    const err = apiErrorFromEnvelope(400, errorHeader, body)

    expect(err.kind).toBe('http')
    expect(err.httpStatus).toBe(400)
    expect(err.message).toBe('Validation failed')
    expect(err.action).toBe('CreateResource')
    expect(err.details).toEqual(body.errors)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.documentationUrl).toBe('https://example.com/docs')
  })

  it('falls back to the first detail message when header.message is empty', () => {
    const header: EnvelopeHeader = { ...errorHeader, message: undefined }
    const body: EnvelopeErrorBody = {
      errors: [{ code: 'NOT_FOUND', field: 'id', message: 'no such resource' }],
    }

    expect(apiErrorFromEnvelope(404, header, body).message).toBe('no such resource')
  })

  it('falls back to a generic status message when nothing else is available', () => {
    expect(apiErrorFromEnvelope(500, undefined, undefined).message).toBe(
      'Request failed with status 500',
    )
    expect(apiErrorFromEnvelope(500, successHeader, undefined).message).toBe(
      'Request failed with status 500',
    )
  })
})

describe('toApiError', () => {
  it('passes through an existing ApiError unchanged', () => {
    const original = new ApiError({ message: 'keep', kind: 'http', httpStatus: 403 })
    expect(toApiError(original)).toBe(original)
  })

  it('wraps a thrown Error as a network ApiError', () => {
    const cause = new TypeError('Failed to fetch')
    const err = toApiError(cause)

    expect(err.kind).toBe('network')
    expect(err.message).toBe('Failed to fetch')
    expect(err.httpStatus).toBe(0)
  })

  it('wraps an unknown value with the fallback message', () => {
    expect(toApiError('something odd', 'custom fallback').message).toBe('custom fallback')
    expect(toApiError(undefined, 'custom fallback').kind).toBe('network')
  })
})
