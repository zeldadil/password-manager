/** @fileoverview Folder API client — thin wrappers around the backend folder plugin
 * (BE-003d / BE-003f) consumed by the folder-management UI (FE-003g).
 *
 * Every function accepts an `ApiClient` so the caller controls auth + base URL,
 * matching the pattern used by `tags.ts` (FE-003h).
 *
 * AR-2: no secrets pass through this module — folders carry only non-secret
 * metadata (name, parentId). Safe to log/render freely.
 */

import { ApiClient } from './client'

// ── Types ──────────────────────────────────────────────────────────────────────

/** Shape of the backend `FolderDTO` returned by the folder plugin (BE-003d). */
export interface FolderRecord {
  id: string
  vaultId: string
  ownerId: string
  name: string
  parentId: string | null
  description: string | null
  icon: string | null
  color: string | null
  permissionMask: {
    level: 'read' | 'update' | 'owner'
    granteeType: 'user' | 'group'
    granteeId: string
  } | null
  createdAt: string
  updatedAt: string
  deleted: boolean
}

/** Request body for `POST /api/v1/folders`. */
export interface CreateFolderParams {
  name: string
  parentId?: string | null
}

/** Request body for `PATCH /api/v1/folders/:id`. */
export interface UpdateFolderParams {
  name?: string
  parentId?: string | null
}

/** Backend confirmation returned by `DELETE /api/v1/folders/:id`. */
export interface DeleteFolderResult {
  status: 'deleted'
  id: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Narrow a backend `FolderRecord` to the `FolderNode` shape the sidebar tree consumes. */
export function toFolderNode(
  record: FolderRecord,
): import('../components/layout/types').FolderNode {
  return {
    id: record.id,
    name: record.name,
    parentId: record.parentId,
  }
}

// ── Public API ──────────────────────────────────────────────────────────────────

/** List all folders in the authenticated user's vault.
 *
 * The backend scopes the list to the caller's own vault (BE-003d).
 */
export async function listFolders(client: ApiClient): Promise<FolderRecord[]> {
  return client.get<FolderRecord[]>('/folders')
}

/** Create a new folder. Returns the created folder as a `FolderRecord`.
 *
 * `parentId` is optional — omit or pass `null` for a root-level folder.
 *
 * Throws an `ApiError` on 4xx/5xx — the caller (UI) is responsible for
 * surfacing the error message (e.g. cycle detected → 400/409).
 */
export async function createFolder(
  client: ApiClient,
  params: CreateFolderParams,
): Promise<FolderRecord> {
  return client.post<FolderRecord>('/folders', params)
}

/** Update a folder's name and/or parent.
 *
 * Changing `parentId` moves the folder in the tree — the backend enforces
 * cycle prevention (ADR-003 §3.4) and returns 400/409 if the move would
 * create a cycle or reference a non-existent parent.
 *
 * Throws an `ApiError` on 4xx/5xx.
 */
export async function updateFolder(
  client: ApiClient,
  id: string,
  params: UpdateFolderParams,
): Promise<FolderRecord> {
  return client.patch<FolderRecord>(`/folders/${encodeURIComponent(id)}`, params)
}

/** Soft-delete a folder. Returns the backend confirmation.
 *
 * The backend soft-deletes the folder AND promotes its children and contained
 * resources to root level (folderId = null) rather than cascade-deleting them
 * (BE-003d). Resources are NOT deleted.
 *
 * Throws an `ApiError` on 4xx/5xx (e.g. 404 if already deleted, 403 if
 * caller lacks Update+ permission per BE-003f).
 */
export async function deleteFolder(client: ApiClient, id: string): Promise<DeleteFolderResult> {
  return client.delete<DeleteFolderResult>(`/folders/${encodeURIComponent(id)}`)
}
