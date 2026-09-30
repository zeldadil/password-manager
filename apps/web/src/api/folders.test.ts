import { describe, expect, it } from 'vitest'
import {
  listFolders,
  createFolder,
  updateFolder,
  deleteFolder,
  toFolderNode,
  type FolderRecord,
  type CreateFolderParams,
  type UpdateFolderParams,
} from './folders'
import { ApiClient } from './client'
import { ApiError } from './errors'
import type { EnvelopeHeader } from './types'

const BASE_URL = 'http://localhost:3000/api/v1'

function successHeader(action = 'FolderAction', code = 200): EnvelopeHeader {
  return {
    id: 'uuid-folders-1',
    status: 'success',
    servertime: '2026-09-28T12:00:00.000Z',
    action,
    code,
  }
}

function errorHeader(action = 'FolderAction', code = 400, message = 'Error'): EnvelopeHeader {
  return {
    id: 'uuid-folders-2',
    status: 'error',
    servertime: '2026-09-28T12:00:00.000Z',
    action,
    code,
    message,
  }
}

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
}

function envelope(body: unknown, header: EnvelopeHeader = successHeader()): unknown {
  return { header, body }
}

function makeFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response) {
  return handler as unknown as typeof fetch
}

function buildClient(fetchImpl: typeof fetch) {
  return new ApiClient({ baseUrl: BASE_URL, tokenStore: { getAccessToken: () => null, getRefreshToken: () => null, setTokens: () => {}, clear: () => {} }, fetchImpl })
}

function sampleFolder(overrides: Partial<FolderRecord> = {}): FolderRecord {
  return {
    id: 'folder-1',
    vaultId: 'vault-1',
    ownerId: 'user-1',
    name: 'Work',
    parentId: null,
    description: null,
    icon: null,
    color: null,
    permissionMask: null,
    createdAt: '2026-09-28T12:00:00.000Z',
    updatedAt: '2026-09-28T12:00:00.000Z',
    deleted: false,
    ...overrides,
  }
}

describe('folders.ts — toFolderNode', () => {
  it('narrows a FolderRecord to a FolderNode (id, name, parentId only)', () => {
    const record = sampleFolder({ name: 'Engineering', parentId: 'folder-1' })
    expect(toFolderNode(record)).toEqual({
      id: 'folder-1',
      name: 'Engineering',
      parentId: 'folder-1',
    })
  })

  it('preserves null parentId for root-level folders', () => {
    const record = sampleFolder({ name: 'Root', parentId: null })
    expect(toFolderNode(record)).toEqual({
      id: 'folder-1',
      name: 'Root',
      parentId: null,
    })
  })
})

describe('folders.ts — listFolders', () => {
  it('fetches /folders and returns the unwrapped body', async () => {
    const client = buildClient(makeFetch((_url, init) => {
      expect(init?.method).toBe('GET')
      return jsonResponse(envelope([sampleFolder(), sampleFolder({ id: 'folder-2', name: 'Personal' })]))
    }))
    const result = await listFolders(client)
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('Work')
    expect(result[1].name).toBe('Personal')
  })

  it('propagates a backend error as ApiError', async () => {
    const client = buildClient(makeFetch(() =>
      jsonResponse(
        { header: errorHeader('ListFolders', 403, 'Forbidden'), body: { errors: [{ code: 'FORBIDDEN', field: ':global', message: 'Access denied' }] } },
        { status: 403 },
      ),
    ))
    await expect(listFolders(client)).rejects.toBeInstanceOf(ApiError)
  })
})

describe('folders.ts — createFolder', () => {
  const params: CreateFolderParams = { name: 'New Folder', parentId: 'folder-1' }

  it('POSTs to /folders with the params and returns the created folder', async () => {
    const client = buildClient(makeFetch((_url, init) => {
      expect(init?.method).toBe('POST')
      const body = JSON.parse(init?.body as string)
      expect(body).toEqual(params)
      return jsonResponse(envelope(sampleFolder({ id: 'new-id', name: 'New Folder', parentId: 'folder-1' })), { status: 201 })
    }))
    const result = await createFolder(client, params)
    expect(result.id).toBe('new-id')
    expect(result.name).toBe('New Folder')
  })

  it('omits parentId when creating a root-level folder', async () => {
    const params: CreateFolderParams = { name: 'Root Folder' }
    const client = buildClient(makeFetch((_url, init) => {
      const body = JSON.parse(init?.body as string)
      expect(body.parentId).toBeUndefined()
      expect(body.name).toBe('Root Folder')
      return jsonResponse(envelope(sampleFolder({ id: 'root-id', name: 'Root Folder', parentId: null })), { status: 201 })
    }))
    const result = await createFolder(client, params)
    expect(result.parentId).toBeNull()
  })
})

describe('folders.ts — updateFolder', () => {
  const params: UpdateFolderParams = { name: 'Renamed' }

  it('PATCHes /folders/:id with the params and returns the updated folder', async () => {
    const client = buildClient(makeFetch((url, init) => {
      expect(url.toString()).toBe('http://localhost:3000/api/v1/folders/folder-1')
      expect(init?.method).toBe('PATCH')
      const body = JSON.parse(init?.body as string)
      expect(body).toEqual(params)
      return jsonResponse(envelope(sampleFolder({ id: 'folder-1', name: 'Renamed' })), { status: 200 })
    }))
    const result = await updateFolder(client, 'folder-1', params)
    expect(result.name).toBe('Renamed')
  })

  it('URL-encodes the folder id in the path', async () => {
    const client = buildClient(makeFetch((url) => {
      expect(url.toString()).toBe('http://localhost:3000/api/v1/folders/folder%2F1')
      return jsonResponse(envelope(sampleFolder()))
    }))
    await updateFolder(client, 'folder/1', {})
  })

  it('propagates a 409 cycle-detected error', async () => {
    const client = buildClient(makeFetch(() =>
      jsonResponse(
        { header: errorHeader('UpdateFolder', 409, 'Cycle'), body: { errors: [{ code: 'CYCLE_DETECTED', field: 'parentId', message: 'would create a cycle' }] } },
        { status: 409 },
      ),
    ))
    await expect(updateFolder(client, 'f1', { parentId: 'f2' })).rejects.toBeInstanceOf(ApiError)
  })
})

describe('folders.ts — deleteFolder', () => {
  it('DELETEs /folders/:id and returns the confirmation', async () => {
    const client = buildClient(makeFetch((url, init) => {
      expect(url.toString()).toBe('http://localhost:3000/api/v1/folders/folder-1')
      expect(init?.method).toBe('DELETE')
      return jsonResponse(envelope({ status: 'deleted', id: 'folder-1' }), { status: 200 })
    }))
    const result = await deleteFolder(client, 'folder-1')
    expect(result).toEqual({ status: 'deleted', id: 'folder-1' })
  })

  it('propagates a 404 not-found error', async () => {
    const client = buildClient(makeFetch(() =>
      jsonResponse(
        { header: errorHeader('DeleteFolder', 404, 'Not found'), body: { errors: [{ code: 'NOT_FOUND', field: ':global', message: 'Folder not found' }] } },
        { status: 404 },
      ),
    ))
    await expect(deleteFolder(client, 'missing')).rejects.toBeInstanceOf(ApiError)
  })
})
