/** @fileoverview Resource CRUD — POST/GET/PATCH/DELETE /api/v1/resources (BE-003b).
 *
 * Resource/secret split (ADR-003 §3.3, ADR-001 §1): the API stores and
 * returns `secretCiphertext`/`secretIv`/`secretTag` as opaque base64 blobs
 * — it never decrypts them, never sees the plaintext secret, and performs
 * no crypto of its own here. The client encrypts client-side with the
 * vault key (ADR-002 §4.3) before submitting, and decrypts client-side
 * after fetching.
 *
 * Metadata encryption is opt-in per resource (`metadataEncrypted`): when
 * true, the plaintext `username`/`uri`/`description` fields are never
 * persisted or returned — only the encrypted blob is — same
 * server-blind-to-plaintext guarantee as the secret itself.
 *
 * Authorization: ownership-only (`resource.ownerId === caller`), same
 * documented-baseline scope as BE-003d (folders) — full `permissions`
 * table + grantee enforcement is BE-003f's job (not yet built).
 *
 * Explicitly OUT of scope (per ADR-003 §3.4/§6.3 and the BE-003 task
 * breakdown):
 *  - Applying a folder's `permissionMask` to a resource at create/move
 *    time — BE-003g ("Folder Permission Mask Propagation").
 *  - Tag entity CRUD (creating/renaming/deleting tags) — BE-003e. This
 *    module only attaches/detaches EXISTING tag ids via the
 *    `resource_tags` junction, matching the ADR-004 `tagIds` field on the
 *    resource itself.
 *
 * AR-2: no secret ever reaches a log line or an error message — every
 * ciphertext/iv/tag field is treated as opaque bytes, in one direction
 * only (base64 decode on write, base64 encode on read).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db';
import { folders, permissions, resourceTags, resources, tags } from '../schema';
import { httpError } from '../middleware/error-handler';
import { requireActiveSession, requireOwnVault } from '../middleware/auth-guard';
import { queryPreHandler } from '../middleware/query';

// ─── Types ──────────────────────────────────────────────────────────────────

const RESOURCE_TYPES = ['password-and-description', 'username-password-uri'] as const;
type ResourceType = (typeof RESOURCE_TYPES)[number];

export interface CreateResourceBody {
  vaultId?: string;
  name: string;
  username?: string | null;
  uri?: string | null;
  description?: string | null;
  type: ResourceType;
  secretCiphertext: string; // base64
  secretIv: string; // base64
  secretTag: string; // base64
  metadataEncrypted?: boolean;
  metadataCiphertext?: string | null; // base64
  metadataIv?: string | null; // base64
  metadataTag?: string | null; // base64
  favorite?: boolean;
  folderId?: string | null;
  tagIds?: string[];
}

export interface UpdateResourceBody {
  name?: string;
  username?: string | null;
  uri?: string | null;
  description?: string | null;
  type?: ResourceType;
  secretCiphertext?: string;
  secretIv?: string;
  secretTag?: string;
  metadataEncrypted?: boolean;
  metadataCiphertext?: string | null;
  metadataIv?: string | null;
  metadataTag?: string | null;
  favorite?: boolean;
  folderId?: string | null;
  tagIds?: string[];
}

interface ResourceDTO {
  id: string;
  vaultId: string;
  ownerId: string;
  name: string;
  username: string | null;
  uri: string | null;
  description: string | null;
  type: string;
  secretCiphertext: string;
  secretIv: string;
  secretTag: string;
  metadataEncrypted: boolean;
  metadataCiphertext: string | null;
  metadataIv: string | null;
  metadataTag: string | null;
  favorite: boolean;
  folderId: string | null;
  tagIds: string[];
  permissionIds: string[];
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
}

type ResourceRow = typeof resources.$inferSelect;

// ─── Base64 helpers ─────────────────────────────────────────────────────────
// The API treats every ciphertext/iv/tag field as opaque bytes — it never
// inspects or transforms the plaintext they represent, only the wire
// encoding (base64 string on the wire, Buffer in the DB).

function b64ToBuffer(value: string, field: string): Buffer {
  if (typeof value !== 'string' || value.length === 0) {
    throw httpError(400, `${field} must be a non-empty base64 string`);
  }
  try {
    return Buffer.from(value, 'base64');
  } catch {
    throw httpError(400, `${field} is not valid base64`);
  }
}

function bufferToB64(value: Buffer | null): string | null {
  return value ? value.toString('base64') : null;
}

// ─── Serialization ──────────────────────────────────────────────────────────

async function toDTO(row: ResourceRow): Promise<ResourceDTO> {
  const [tagRows, permissionRows] = await Promise.all([
    db.query.resourceTags.findMany({ where: eq(resourceTags.resourceId, row.id) }),
    db.query.permissions.findMany({
      where: and(
        eq(permissions.targetType, 'resource'),
        eq(permissions.targetId, row.id),
        isNull(permissions.deletedAt),
      ),
    }),
  ]);

  return {
    id: row.id,
    vaultId: row.vaultId,
    ownerId: row.ownerId,
    name: row.name,
    // ADR-004 GET /resources/{id}: when metadataEncrypted, plaintext
    // metadata fields are absent — only the ciphertext is ever returned.
    username: row.metadataEncrypted ? null : row.username,
    uri: row.metadataEncrypted ? null : row.uri,
    description: row.metadataEncrypted ? null : row.description,
    type: row.type,
    secretCiphertext: bufferToB64(row.secretCiphertext)!,
    secretIv: bufferToB64(row.secretIv)!,
    secretTag: bufferToB64(row.secretTag)!,
    metadataEncrypted: row.metadataEncrypted,
    metadataCiphertext: row.metadataEncrypted ? bufferToB64(row.metadataCiphertext) : null,
    metadataIv: row.metadataEncrypted ? bufferToB64(row.metadataIv) : null,
    metadataTag: row.metadataEncrypted ? bufferToB64(row.metadataTag) : null,
    favorite: row.favorite,
    folderId: row.folderId,
    tagIds: tagRows.map((t) => t.tagId),
    permissionIds: permissionRows.map((p) => p.id),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deleted: row.deletedAt !== null,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function findOwnResource(userId: string, vaultId: string, resourceId: string) {
  const resource = await db.query.resources.findFirst({
    where: and(eq(resources.id, resourceId), isNull(resources.deletedAt)),
  });
  if (!resource || resource.vaultId !== vaultId) {
    throw httpError(404, 'Resource not found');
  }
  if (resource.ownerId !== userId) {
    throw httpError(403, 'Not authorized');
  }
  return resource;
}

/** folderId, if provided, must name a non-deleted folder in the caller's vault. */
async function validateFolderId(vaultId: string, folderId: string): Promise<void> {
  const folder = await db.query.folders.findFirst({
    where: and(eq(folders.id, folderId), isNull(folders.deletedAt)),
  });
  if (!folder || folder.vaultId !== vaultId) {
    throw httpError(400, 'folderId does not name an existing folder in this vault');
  }
}

/** Every tagId, if any, must name a non-deleted tag in the caller's vault. */
async function validateTagIds(vaultId: string, tagIds: string[]): Promise<void> {
  if (tagIds.length === 0) return;
  const rows = await db.query.tags.findMany({
    where: and(inArray(tags.id, tagIds), isNull(tags.deletedAt)),
  });
  const found = new Set(rows.filter((t) => t.vaultId === vaultId).map((t) => t.id));
  const missing = tagIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw httpError(400, `tagIds do not all name existing tags in this vault: ${missing.join(', ')}`);
  }
}

/** Replace a resource's tag associations with exactly `tagIds`. */
async function setResourceTags(resourceId: string, tagIds: string[]): Promise<void> {
  await db.delete(resourceTags).where(eq(resourceTags.resourceId, resourceId));
  if (tagIds.length > 0) {
    await db.insert(resourceTags).values(tagIds.map((tagId) => ({ resourceId, tagId })));
  }
}

const METADATA_SCHEMA_PROPS = {
  name: { type: 'string', minLength: 1 },
  username: { type: ['string', 'null'] },
  uri: { type: ['string', 'null'] },
  description: { type: ['string', 'null'] },
  type: { type: 'string', enum: RESOURCE_TYPES as unknown as string[] },
  secretCiphertext: { type: 'string' },
  secretIv: { type: 'string' },
  secretTag: { type: 'string' },
  metadataEncrypted: { type: 'boolean' },
  metadataCiphertext: { type: ['string', 'null'] },
  metadataIv: { type: ['string', 'null'] },
  metadataTag: { type: ['string', 'null'] },
  favorite: { type: 'boolean' },
  folderId: { type: ['string', 'null'] },
  tagIds: { type: 'array', items: { type: 'string' } },
} as const;

// ─── Plugin ─────────────────────────────────────────────────────────────────

export function resourcesPlugin(server: FastifyInstance): void {
  queryPreHandler(server);

  // ── GET /resources ──────────────────────────────────────────────────────
  server.get(
    '/resources',
    { config: { operationId: 'ListResources' } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = await requireActiveSession(request);
      const vault = await requireOwnVault(userId);

      const q = request.queryParsed;
      const includeDeleted = (request.query as { include_deleted?: string } | undefined)
        ?.include_deleted === 'true';

      const rows = await db.query.resources.findMany({
        where: includeDeleted
          ? eq(resources.vaultId, vault.id)
          : and(eq(resources.vaultId, vault.id), isNull(resources.deletedAt)),
        limit: q.pagination.limit,
        offset: q.pagination.offset,
      });

      return reply.code(200).send({
        data: await Promise.all(rows.map(toDTO)),
        pagination: { page: q.pagination.page, perPage: q.pagination.perPage },
      });
    },
  );

  // ── GET /resources/:id ──────────────────────────────────────────────────
  server.get<{ Params: { id: string } }>(
    '/resources/:id',
    { config: { operationId: 'GetResource' } },
    async (request, reply) => {
      const { userId } = await requireActiveSession(request);
      const vault = await requireOwnVault(userId);
      const resource = await findOwnResource(userId, vault.id, request.params.id);
      return reply.code(200).send(await toDTO(resource));
    },
  );

  // ── POST /resources ─────────────────────────────────────────────────────
  server.post<{ Body: CreateResourceBody }>(
    '/resources',
    {
      config: { operationId: 'CreateResource' },
      schema: {
        body: {
          type: 'object',
          required: ['name', 'type', 'secretCiphertext', 'secretIv', 'secretTag'],
          properties: { vaultId: { type: 'string' }, ...METADATA_SCHEMA_PROPS },
        },
      },
    },
    async (request, reply) => {
      const { userId } = await requireActiveSession(request);
      const vault = await requireOwnVault(userId);

      // Never trust a client-supplied vaultId for tenant scoping — same
      // rule as BE-003d (folders).
      if (request.body.vaultId && request.body.vaultId !== vault.id) {
        throw httpError(403, "vaultId does not match the authenticated user's vault");
      }

      const body = request.body;
      const metadataEncrypted = body.metadataEncrypted ?? false;
      if (metadataEncrypted && (!body.metadataCiphertext || !body.metadataIv || !body.metadataTag)) {
        throw httpError(
          400,
          'metadataCiphertext, metadataIv, and metadataTag are required when metadataEncrypted is true',
        );
      }

      const folderId = body.folderId ?? null;
      if (folderId !== null) {
        await validateFolderId(vault.id, folderId);
      }
      const tagIds = body.tagIds ?? [];
      await validateTagIds(vault.id, tagIds);

      const now = new Date();
      const id = randomUUID();
      await db.insert(resources).values({
        id,
        vaultId: vault.id,
        ownerId: userId,
        name: body.name,
        // Plaintext metadata is only ever stored when NOT opting into
        // per-resource metadata encryption (ADR-003 §3.3 note).
        username: metadataEncrypted ? null : (body.username ?? null),
        uri: metadataEncrypted ? null : (body.uri ?? null),
        description: metadataEncrypted ? null : (body.description ?? null),
        type: body.type,
        secretCiphertext: b64ToBuffer(body.secretCiphertext, 'secretCiphertext'),
        secretIv: b64ToBuffer(body.secretIv, 'secretIv'),
        secretTag: b64ToBuffer(body.secretTag, 'secretTag'),
        metadataEncrypted,
        metadataCiphertext: metadataEncrypted
          ? b64ToBuffer(body.metadataCiphertext!, 'metadataCiphertext')
          : null,
        metadataIv: metadataEncrypted ? b64ToBuffer(body.metadataIv!, 'metadataIv') : null,
        metadataTag: metadataEncrypted ? b64ToBuffer(body.metadataTag!, 'metadataTag') : null,
        favorite: body.favorite ?? false,
        folderId,
        createdAt: now,
        updatedAt: now,
      });

      if (tagIds.length > 0) {
        await setResourceTags(id, tagIds);
      }

      const created = await db.query.resources.findFirst({ where: eq(resources.id, id) });
      return reply.code(201).send(await toDTO(created!));
    },
  );

  // ── PATCH /resources/:id ────────────────────────────────────────────────
  server.patch<{ Params: { id: string }; Body: UpdateResourceBody }>(
    '/resources/:id',
    {
      config: { operationId: 'UpdateResource' },
      schema: {
        body: { type: 'object', properties: { ...METADATA_SCHEMA_PROPS } },
      },
    },
    async (request, reply) => {
      const { userId } = await requireActiveSession(request);
      const vault = await requireOwnVault(userId);
      const resource = await findOwnResource(userId, vault.id, request.params.id);

      const body = request.body;
      if (body.folderId !== undefined && body.folderId !== null) {
        await validateFolderId(vault.id, body.folderId);
      }
      if (body.tagIds !== undefined) {
        await validateTagIds(vault.id, body.tagIds);
      }

      // Effective metadataEncrypted after this update (may be unchanged).
      const metadataEncrypted = body.metadataEncrypted ?? resource.metadataEncrypted;
      if (body.metadataEncrypted === true) {
        const hasCiphertext = body.metadataCiphertext ?? bufferToB64(resource.metadataCiphertext);
        const hasIv = body.metadataIv ?? bufferToB64(resource.metadataIv);
        const hasTag = body.metadataTag ?? bufferToB64(resource.metadataTag);
        if (!hasCiphertext || !hasIv || !hasTag) {
          throw httpError(
            400,
            'metadataCiphertext, metadataIv, and metadataTag are required when metadataEncrypted is true',
          );
        }
      }

      const updates: Partial<typeof resources.$inferInsert> = { updatedAt: new Date() };
      if (body.name !== undefined) updates.name = body.name;
      if (body.type !== undefined) updates.type = body.type;
      if (body.favorite !== undefined) updates.favorite = body.favorite;
      if (body.folderId !== undefined) updates.folderId = body.folderId;
      if (body.secretCiphertext !== undefined) {
        updates.secretCiphertext = b64ToBuffer(body.secretCiphertext, 'secretCiphertext');
      }
      if (body.secretIv !== undefined) updates.secretIv = b64ToBuffer(body.secretIv, 'secretIv');
      if (body.secretTag !== undefined) updates.secretTag = b64ToBuffer(body.secretTag, 'secretTag');

      if (body.metadataEncrypted !== undefined) updates.metadataEncrypted = metadataEncrypted;
      if (metadataEncrypted) {
        if (body.metadataCiphertext !== undefined) {
          updates.metadataCiphertext = b64ToBuffer(body.metadataCiphertext!, 'metadataCiphertext');
        }
        if (body.metadataIv !== undefined) {
          updates.metadataIv = b64ToBuffer(body.metadataIv!, 'metadataIv');
        }
        if (body.metadataTag !== undefined) {
          updates.metadataTag = b64ToBuffer(body.metadataTag!, 'metadataTag');
        }
        // Encryption is on — plaintext fields are never persisted.
        if (body.username !== undefined) updates.username = null;
        if (body.uri !== undefined) updates.uri = null;
        if (body.description !== undefined) updates.description = null;
      } else {
        if (body.username !== undefined) updates.username = body.username;
        if (body.uri !== undefined) updates.uri = body.uri;
        if (body.description !== undefined) updates.description = body.description;
        // Turning encryption off clears the now-stale ciphertext.
        if (body.metadataEncrypted === false) {
          updates.metadataCiphertext = null;
          updates.metadataIv = null;
          updates.metadataTag = null;
        }
      }

      await db.update(resources).set(updates).where(eq(resources.id, resource.id));

      if (body.tagIds !== undefined) {
        await setResourceTags(resource.id, body.tagIds);
      }

      const updated = await db.query.resources.findFirst({ where: eq(resources.id, resource.id) });
      return reply.code(200).send(await toDTO(updated!));
    },
  );

  // ── DELETE /resources/:id ───────────────────────────────────────────────
  server.delete<{ Params: { id: string } }>(
    '/resources/:id',
    { config: { operationId: 'DeleteResource' } },
    async (request, reply) => {
      const { userId } = await requireActiveSession(request);
      const vault = await requireOwnVault(userId);
      const resource = await findOwnResource(userId, vault.id, request.params.id);

      const now = new Date();
      await db
        .update(resources)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(resources.id, resource.id));

      const deleted = await db.query.resources.findFirst({ where: eq(resources.id, resource.id) });
      return reply.code(200).send(await toDTO(deleted!));
    },
  );
}
