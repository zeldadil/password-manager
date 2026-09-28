/** @fileoverview Folder API client — thin wrappers around the backend folder plugin
 * (BE-003d) consumed by the sidebar folder-management UI (FE-003g).
 *
 * Every function accepts an `ApiClient` so the caller controls auth + base URL,
 * matching the pattern used by `getResource` in `client.ts`.
 */

import { ApiClient } from './client'
import type { FolderNode } from '../components/layout/types'

// ── Types ──────────────────────────────────────────────────────────────────────

/** Shape of the backend `FolderResponse` (ADR-003 §3.4) that the folder plugin
 * returns. We keep it local to this module — the shared package will own the
 * canonical type once the backend tasks land. */
export interface FolderRecord {
  id: string
  name: string
  parentId: string | null
  // Other fields (vaultId, ownerId, description, icon, color, …) are
  // available on the backend response but the sidebar tree only needs the
  // three fields above — the full shape is documented in BE-003d.
}

/** Request body for `POST /api/v1/folders`. */
export interface CreateFolderParams {
  /** Vault the folder belongs to. */
  vaultId: string
  /** Human-readable folder name (1–255 chars). */
  name: string
  /** `null` = root level; a folder id = nested under that parent. */
  parentId: string | null
}

/** Request body for `PATCH /api/v1/folders/:id`. */
export interface UpdateFolderParams {
  /** New display name. */
  name?: string
  /** New parent — `null` moves the folder to vault root. */
  parentId?: string | null
}

/** Backend confirmation returned by `DELETE /api/v1/folders/:id`. */
export interface DeleteFolderResult {
  status: 'deleted'
  id: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Narrow a backend `FolderRecord` to the `FolderNode` shape the sidebar tree
 * consumes. Callers that need extra fields (description, icon, …) should
 * use `FolderRecord` directly. */
function toFolderNode(record: FolderRecord): FolderNode {
  return {
    id: record.id,
    name: record.name,
    parentId: record.parentId,
  }
}

// ── Public API ──────────────────────────────────────────────────────────────────

/** Create a new folder. Returns the created folder as a `FolderNode`.
 *
 * Throws an `ApiError` on 4xx/5xx — the caller (UI) is responsible for
 * surfacing the error message.
 */
export async function createFolder(
  client: ApiClient,
  params: CreateFolderParams,
): Promise<FolderNode> {
  const body = await client.post<FolderRecord>('/folders', params)
  return toFolderNode(body)
}

/** Rename an existing folder. Returns the updated folder as a `FolderNode`. */
export async function renameFolder(
  client: ApiClient,
  id: string,
  name: string,
): Promise<FolderNode> {
  const body = await client.patch<FolderRecord>(`/folders/${encodeURIComponent(id)}`, {
    name,
  })
  return toFolderNode(body)
}

/** Move a folder to a new parent (or to vault root when `newParentId` is `null`).
 * Returns the updated folder as a `FolderNode`.
 *
 * The backend performs cycle detection and Vault-mismatch checks — this function
 * surfaces those as `ApiError`s with appropriate codes.
 */
export async function moveFolder(
  client: ApiClient,
  id: string,
  newParentId: string | null,
): Promise<FolderNode> {
  const body = await client.patch<FolderRecord>(`/folders/${encodeURIComponent(id)}`, {
    parentId: newParentId,
  })
  return toFolderNode(body)
}

/** Soft-delete a folder. Returns the backend confirmation.
 *
 * The backend recursively marks the folder and all its descendants deleted;
 * this function just returns the confirmation envelope.
 */
export async function deleteFolder(
  client: ApiClient,
  id: string,
): Promise<DeleteFolderResult> {
  return client.delete<DeleteFolderResult>(`/folders/${encodeURIComponent(id)}`)
}

/** List all folders for a vault. Returns them as `FolderNode[]` suitable for
 * passing directly to `<FolderTree>`.
 *
 * Use `parentId` to fetch a single level; omit it to get the whole vault tree
 * (callers that need incremental loading should pass `parentId` per level).
 */
export async function listFolders(
  client: ApiClient,
  vaultId: string,
  parentId?: string,
): Promise<FolderNode[]> {
  const params = new URLSearchParams({ vaultId })
  if (parentId !== undefined) params.set('parentId', parentId)
  const query = params.toString()
  const body = await client.get<FolderRecord[]>(`/folders?${query}`)
  return body.map(toFolderNode)
}
