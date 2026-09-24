/** @fileoverview Folder CRUD — POST/GET/PATCH/DELETE /api/v1/folders (BE-003d).
 *
 * Tree structure (self-referential `parentId`) + permission mask
 * (ADR-003 §3.4/§3.5, ADR-004 `/folders` paths).
 *
 * Authorization (BE-003f, ADR-003 §6.1-6.2):
 *  - GET (single): requires Read+.
 *  - PATCH, DELETE: require Update+ (Update level already includes
 *    delete rights per the level table in §3.5 — Owner is NOT required
 *    to delete).
 *  - Effective level = max(ownership, direct user grant, group grant).
 *    Ownership on ANY folder still yields Owner; once a grant exists a
 *    caller may act on a folder outside their own vault, so single-item
 *    routes below fetch by id only (no vault filter) and let
 *    `requirePermission` decide 404 (no access at all) vs 403 (access
 *    below the required level) vs allow.
 *  - LIST and CREATE remain scoped to the caller's own vault only
 *    (unchanged from BE-003d) — ADR-004's listFolders description says
 *    "in authenticated user's vault", with no mention of merging in
 *    folders shared from other vaults, and that would be a materially
 *    different feature (cross-vault aggregation) than "enforce access
 *    control on a request that already names a target", which is what
 *    BE-003f's own acceptance criteria describe.
 *
 * `permissionMask` propagation to resources at create/move time (BE-003g)
 * is implemented in routes/resources.ts (POST/PATCH) via
 * `applyFolderPermissionMask` in services/permissions.ts — this module only
 * stores/returns the mask on the folder itself.
 *
 * Explicitly OUT of scope (per ADR-003 §3.4/§6.3 and the BE-003 task
 * breakdown):
 *  - Permission grant/revoke endpoints themselves — no task in the
 *    current backlog creates them yet; this module only *enforces*
 *    grants that already exist in the `permissions` table.
 *
 * AR-2: no secrets pass through this module — folders carry only
 * non-secret metadata (name, description, icon, color).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { folders, resources } from '../schema';
import { httpError } from '../middleware/error-handler';
import { requireActiveSession, requireOwnVault } from '../middleware/auth-guard';
import { queryPreHandler } from '../middleware/query';
import { requirePermission, type PermissionLevel } from '../services/permissions';

// ─── Types ──────────────────────────────────────────────────────────────────

interface PermissionMaskInput {
  level: 'read' | 'update' | 'owner';
  granteeType: 'user' | 'group';
  granteeId: string;
}

export interface CreateFolderBody {
  vaultId?: string;
  name: string;
  parentId?: string | null;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  permissionMask?: PermissionMaskInput | null;
}

export interface UpdateFolderBody {
  name?: string;
  parentId?: string | null;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  permissionMask?: PermissionMaskInput | null;
}

interface FolderDTO {
  id: string;
  vaultId: string;
  ownerId: string;
  name: string;
  parentId: string | null;
  description: string | null;
  icon: string | null;
  color: string | null;
  permissionMask: PermissionMaskInput | null;
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
}

type FolderRow = typeof folders.$inferSelect;

// ─── Serialization ──────────────────────────────────────────────────────────

function toDTO(row: FolderRow): FolderDTO {
  const permissionMask =
    row.permissionMaskLevel && row.permissionMaskGranteeType && row.permissionMaskGranteeId
      ? {
          level: row.permissionMaskLevel as PermissionMaskInput['level'],
          granteeType: row.permissionMaskGranteeType as PermissionMaskInput['granteeType'],
          granteeId: row.permissionMaskGranteeId,
        }
      : null;

  return {
    id: row.id,
    vaultId: row.vaultId,
    ownerId: row.ownerId,
    name: row.name,
    parentId: row.parentId,
    description: row.description,
    icon: row.icon,
    color: row.color,
    permissionMask,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deleted: row.deletedAt !== null,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Fetch a non-deleted folder by id and enforce the required permission
 * level on it (BE-003f, ADR-003 §6.1-6.2). Deliberately NOT scoped to the
 * caller's own vault — a folder shared via the `permissions` table lives
 * in someone else's vault, and `requirePermission` is what decides 404
 * (no access at all) vs 403 (access below the required level) vs allow.
 */
async function requireFolderAccess(userId: string, folderId: string, required: PermissionLevel) {
  const folder = await db.query.folders.findFirst({
    where: and(eq(folders.id, folderId), isNull(folders.deletedAt)),
  });
  if (!folder) {
    throw httpError(404, 'Folder not found');
  }
  await requirePermission({ db, userId, targetType: 'folder', targetId: folderId }, required);
  return folder;
}

/**
 * Validate a candidate `parentId` for `folderId` (or for a new folder when
 * `folderId` is null): the parent must exist in the same vault, be
 * non-deleted, and must not be `folderId` itself or any of its descendants
 * (which would create a cycle — ADR-003 §3.4: "cycles are prevented by the
 * API, not the DB constraint").
 */
async function validateParent(
  vaultId: string,
  folderId: string | null,
  parentId: string,
): Promise<void> {
  if (parentId === folderId) {
    throw httpError(400, 'A folder cannot be its own parent');
  }

  const parent = await db.query.folders.findFirst({
    where: and(eq(folders.id, parentId), isNull(folders.deletedAt)),
  });
  if (!parent || parent.vaultId !== vaultId) {
    throw httpError(400, 'parentId does not name an existing folder in this vault');
  }

  if (folderId === null) return; // creating — no descendants to check yet.

  // Walk up from the candidate parent; if we reach `folderId`, it's a
  // descendant of the folder being moved, so re-parenting would cycle.
  let cursor: string | null = parent.parentId;
  const seen = new Set<string>([parent.id]);
  while (cursor !== null) {
    if (cursor === folderId) {
      throw httpError(400, 'That would create a cycle in the folder tree');
    }
    if (seen.has(cursor)) break; // defensive: pre-existing cycle, don't loop forever
    seen.add(cursor);
    const row: { parentId: string | null } | undefined = await db.query.folders.findFirst({
      where: eq(folders.id, cursor),
      columns: { parentId: true },
    });
    cursor = row?.parentId ?? null;
  }
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

export function foldersPlugin(server: FastifyInstance): void {
  queryPreHandler(server);

  // ── GET /folders ────────────────────────────────────────────────────────
  server.get(
    '/folders',
    { config: { operationId: 'ListFolders' } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = await requireActiveSession(request);
      const vault = await requireOwnVault(userId);

      const q = request.queryParsed;
      const rows = await db.query.folders.findMany({
        where: and(eq(folders.vaultId, vault.id), isNull(folders.deletedAt)),
        limit: q.pagination.limit,
        offset: q.pagination.offset,
      });

      return reply.code(200).send({
        data: rows.map(toDTO),
        pagination: { page: q.pagination.page, perPage: q.pagination.perPage },
      });
    },
  );

  // ── GET /folders/:id ────────────────────────────────────────────────────
  server.get<{ Params: { id: string } }>(
    '/folders/:id',
    { config: { operationId: 'GetFolder' } },
    async (request, reply) => {
      const { userId } = await requireActiveSession(request);
      const folder = await requireFolderAccess(userId, request.params.id, 'read');
      return reply.code(200).send(toDTO(folder));
    },
  );

  // ── POST /folders ───────────────────────────────────────────────────────
  server.post<{ Body: CreateFolderBody }>(
    '/folders',
    {
      config: { operationId: 'CreateFolder' },
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            vaultId: { type: 'string' },
            name: { type: 'string', minLength: 1 },
            parentId: { type: ['string', 'null'] },
            description: { type: ['string', 'null'] },
            icon: { type: ['string', 'null'] },
            color: { type: ['string', 'null'] },
            permissionMask: {
              type: ['object', 'null'],
              properties: {
                level: { type: 'string', enum: ['read', 'update', 'owner'] },
                granteeType: { type: 'string', enum: ['user', 'group'] },
                granteeId: { type: 'string' },
              },
              required: ['level', 'granteeType', 'granteeId'],
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { userId } = await requireActiveSession(request);
      const vault = await requireOwnVault(userId);

      // vaultId is accepted in the body for ADR-004 contract shape
      // compatibility, but it is NEVER trusted for tenant scoping — a
      // client-supplied vaultId that doesn't match the caller's own vault
      // is rejected rather than silently overridden, so a client can't
      // probe another user's vault id by trial and error.
      if (request.body.vaultId && request.body.vaultId !== vault.id) {
        throw httpError(403, "vaultId does not match the authenticated user's vault");
      }

      const { name, description, icon, color, permissionMask } = request.body;
      const parentId = request.body.parentId ?? null;

      if (parentId !== null) {
        await validateParent(vault.id, null, parentId);
      }

      const now = new Date();
      const id = randomUUID();
      await db.insert(folders).values({
        id,
        vaultId: vault.id,
        ownerId: userId,
        name,
        parentId,
        description: description ?? null,
        icon: icon ?? null,
        color: color ?? null,
        permissionMaskLevel: permissionMask?.level ?? null,
        permissionMaskGranteeType: permissionMask?.granteeType ?? null,
        permissionMaskGranteeId: permissionMask?.granteeId ?? null,
        createdAt: now,
        updatedAt: now,
      });

      const created = await db.query.folders.findFirst({ where: eq(folders.id, id) });
      return reply.code(201).send(toDTO(created!));
    },
  );

  // ── PATCH /folders/:id ──────────────────────────────────────────────────
  server.patch<{ Params: { id: string }; Body: UpdateFolderBody }>(
    '/folders/:id',
    {
      config: { operationId: 'UpdateFolder' },
      schema: {
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1 },
            parentId: { type: ['string', 'null'] },
            description: { type: ['string', 'null'] },
            icon: { type: ['string', 'null'] },
            color: { type: ['string', 'null'] },
            permissionMask: {
              type: ['object', 'null'],
              properties: {
                level: { type: 'string', enum: ['read', 'update', 'owner'] },
                granteeType: { type: 'string', enum: ['user', 'group'] },
                granteeId: { type: 'string' },
              },
              required: ['level', 'granteeType', 'granteeId'],
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { userId } = await requireActiveSession(request);
      const folder = await requireFolderAccess(userId, request.params.id, 'update');

      const body = request.body;
      if (body.parentId !== undefined && body.parentId !== null) {
        // Scoped to the FOLDER's own vault, not the caller's — a grantee
        // acting on a shared folder may have a different (or no) vault of
        // their own; the tree the folder can move within is its own
        // vault's tree.
        await validateParent(folder.vaultId, folder.id, body.parentId);
      }

      const updates: Partial<typeof folders.$inferInsert> = { updatedAt: new Date() };
      if (body.name !== undefined) updates.name = body.name;
      if (body.parentId !== undefined) updates.parentId = body.parentId;
      if (body.description !== undefined) updates.description = body.description;
      if (body.icon !== undefined) updates.icon = body.icon;
      if (body.color !== undefined) updates.color = body.color;
      if (body.permissionMask !== undefined) {
        updates.permissionMaskLevel = body.permissionMask?.level ?? null;
        updates.permissionMaskGranteeType = body.permissionMask?.granteeType ?? null;
        updates.permissionMaskGranteeId = body.permissionMask?.granteeId ?? null;
      }

      await db.update(folders).set(updates).where(eq(folders.id, folder.id));

      const updated = await db.query.folders.findFirst({ where: eq(folders.id, folder.id) });
      return reply.code(200).send(toDTO(updated!));
    },
  );

  // ── DELETE /folders/:id ─────────────────────────────────────────────────
  server.delete<{ Params: { id: string } }>(
    '/folders/:id',
    { config: { operationId: 'DeleteFolder' } },
    async (request, reply) => {
      const { userId } = await requireActiveSession(request);
      // Update+ per ADR-003 §6.2 point 7 ("Update/Delete require Update+")
      // — Owner is not required to delete.
      const folder = await requireFolderAccess(userId, request.params.id, 'update');

      const now = new Date();

      // ADR-004 /folders/{id} DELETE: soft-delete the folder; resources in
      // it are NOT deleted — they become root-level (folderId=null). Child
      // folders get the same treatment for consistency (become root-level
      // rather than being silently cascade-deleted with their own
      // contents) — the contract only specifies the resource case, but
      // cascade-deleting a user's sub-folders on a single DELETE would be
      // a much more destructive default than the documented behavior.
      await db
        .update(folders)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(folders.id, folder.id));

      await db
        .update(folders)
        .set({ parentId: null, updatedAt: now })
        .where(and(eq(folders.parentId, folder.id), isNull(folders.deletedAt)));

      await db
        .update(resources)
        .set({ folderId: null, updatedAt: now })
        .where(and(eq(resources.folderId, folder.id), isNull(resources.deletedAt)));

      const deleted = await db.query.folders.findFirst({ where: eq(folders.id, folder.id) });
      return reply.code(200).send(toDTO(deleted!));
    },
  );
}
