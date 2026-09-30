/** @fileoverview Unit tests for the tag API client (FE-003h).
 *
 * Verifies the typed helpers on top of {@link ApiClient} — list/get/create/update/delete
 * and resource-tag assignment — use the correct paths and body shapes.
 */

import { describe, expect, it, vi } from 'vitest'
import { ApiClient } from '../api/client'
import { tagApi, resourceTagApi, type Tag } from './tags'

const BASE_URL = 'http://localhost:3000/api/v1'

function envelope<T>(body: T, code = 200) {
  return {
    ok: true,
    status: code,
    json: async () => ({
      header: {
        id: 'h1',
        status: code < 400 ? 'success' : 'error',
        servertime: new Date().toISOString(),
        action: 'TestAction',
        code,
      },
      body,
    }),
  } as unknown as Response
}

function makeFetch(handler: (url: string, init?: RequestInit) => Response) {
  return vi.fn().mockImplementation(handler) as unknown as typeof fetch
}

function clientWith(fetchImpl: typeof fetch) {
  return new ApiClient({
    baseUrl: BASE_URL,
    tokenStore: {
      getAccessToken: () => 'jwt',
      getRefreshToken: () => null,
      setTokens: () => {},
      clear: () => {},
    },
    fetchImpl,
  })
}

describe('tagApi', () => {
  const tag: Tag = {
    id: 'tag-1',
    vaultId: 'vault-1',
    name: 'Work',
    color: '#3b82f6',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deleted: false,
  }

  it('lists tags with pagination params', async () => {
    const fetchMock = makeFetch(() =>
      envelope({ data: [tag], pagination: { page: 1, perPage: 20 } }),
    )
    const api = tagApi(clientWith(fetchMock))

    const result = await api.list({ page: 2, perPage: 10 })

    expect(result).toEqual({ data: [tag], pagination: { page: 1, perPage: 20 } })
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/tags?page=2&perPage=10`,
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('lists tags without pagination params', async () => {
    const fetchMock = makeFetch(() =>
      envelope({ data: [tag], pagination: { page: 1, perPage: 20 } }),
    )
    const api = tagApi(clientWith(fetchMock))

    await api.list()

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/tags`,
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('gets a single tag by id', async () => {
    const fetchMock = makeFetch(() => envelope(tag))
    const api = tagApi(clientWith(fetchMock))

    const result = await api.get('tag-1')

    expect(result).toEqual(tag)
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/tags/tag-1`,
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('creates a tag', async () => {
    const fetchMock = makeFetch(() => envelope(tag))
    const api = tagApi(clientWith(fetchMock))

    const result = await api.create({ name: 'Work', color: '#3b82f6' })

    expect(result).toEqual(tag)
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/tags`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Work', color: '#3b82f6' }),
      }),
    )
  })

  it('creates a tag with null color', async () => {
    const fetchMock = makeFetch(() => envelope(tag))
    const api = tagApi(clientWith(fetchMock))

    await api.create({ name: 'Work', color: null })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ name: 'Work', color: null }),
      }),
    )
  })

  it('updates a tag', async () => {
    const fetchMock = makeFetch(() => envelope({ ...tag, name: 'Personal' }))
    const api = tagApi(clientWith(fetchMock))

    const result = await api.update('tag-1', { name: 'Personal' })

    expect(result.name).toBe('Personal')
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/tags/tag-1`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'Personal' }),
      }),
    )
  })

  it('deletes a tag', async () => {
    const fetchMock = makeFetch(() => envelope({ ...tag, deleted: true }))
    const api = tagApi(clientWith(fetchMock))

    const result = await api.delete('tag-1')

    expect(result.deleted).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/tags/tag-1`,
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})

describe('resourceTagApi', () => {
  const tag: Tag = {
    id: 'tag-1',
    vaultId: 'vault-1',
    name: 'Work',
    color: '#3b82f6',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deleted: false,
  }

  it("replaces a resource's tags", async () => {
    const fetchMock = makeFetch(() => envelope(tag))
    const api = resourceTagApi(clientWith(fetchMock))

    const result = await api.setTags('res-1', ['tag-1', 'tag-2'])

    expect(result).toEqual(tag)
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/resources/res-1`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ tagIds: ['tag-1', 'tag-2'] }),
      }),
    )
  })

  it("clears a resource's tags with an empty array", async () => {
    const fetchMock = makeFetch(() => envelope(tag))
    const api = resourceTagApi(clientWith(fetchMock))

    await api.setTags('res-1', [])

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ tagIds: [] }),
      }),
    )
  })
})
