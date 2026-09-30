/** Tag API client — typed helpers over the shared {@link ApiClient}. */

import { ApiClient } from './client'
import type { ApiClientOptions } from './client'

export interface TagInput {
  name: string
  color?: string | null
}

export interface Tag {
  id: string
  vaultId: string
  name: string
  color: string | null
  createdAt: string
  updatedAt: string
  deleted: boolean
}

export interface TagsEnvelope {
  data: Tag[]
  pagination: { page: number; perPage: number }
}

export interface TagEnvelope {
  id: string
  vaultId: string
  name: string
  color: string | null
  createdAt: string
  updatedAt: string
  deleted: boolean
}

export interface ResourceTagPatch {
  tagIds?: string[]
}

/**
 * Tagged methods on top of a shared {@link ApiClient}.
 *
 * Keeps tag concerns out of the generic client while reusing its
 * envelope parsing, JWT interceptor, and refresh logic.
 */
export function tagApi(client: ApiClient) {
  return {
    /** List tags in the authenticated vault. */
    list: (params?: { page?: number; perPage?: number }) => {
      const searchParams =
        params && (params.page !== undefined || params.perPage !== undefined)
          ? `?page=${params.page ?? 1}&perPage=${params.perPage ?? 20}`
          : ''
      return client.get<TagsEnvelope>(`/tags${searchParams}`)
    },

    /** Get a single tag by id. */
    get: (id: string) => client.get<TagEnvelope>(`/tags/${id}`),

    /** Create a tag in the authenticated vault. */
    create: (input: TagInput) =>
      client.post<TagEnvelope>('/tags', {
        name: input.name,
        color: input.color ?? null,
      }),

    /** Update a tag's name and/or color. */
    update: (id: string, input: Partial<TagInput>) =>
      client.patch<TagEnvelope>(`/tags/${id}`, input),

    /** Soft-delete a tag (detaches it from all resources first). */
    delete: (id: string) => client.delete<TagEnvelope>(`/tags/${id}`),
  }
}

/**
 * Resource↔tag assignment helpers.
 *
 * The backend resource endpoints already accept `tagIds` on create and
 * PATCH — these helpers just pin the shape so callers don't hand-craft
 * the partial body.
 */
export function resourceTagApi(client: ApiClient) {
  /** Replace the tags on a resource with exactly `tagIds`. */
  const setTags = (resourceId: string, tagIds: string[]) =>
    client.patch<TagEnvelope>(`/resources/${resourceId}`, { tagIds })

  return { setTags }
}
