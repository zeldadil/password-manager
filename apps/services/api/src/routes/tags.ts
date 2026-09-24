/** @fileoverview Tag CRUD — POST/GET/PATCH/DELETE /api/v1/tags (BE-003e).
 *
 * Flat, non-hierarchical, many-to-many with resources via the
 * `resource_tags` junction (ADR-003 §3.6, ADR-001 §3). Tags are scoped to
 * a vault, not owned individually — unlike Folder/Resource, the `tags`
 * table has no `ownerId` column (ADR-004: "vault owner owns all tags").
 * Authorization is therefore vault-scoping only: the caller must own the
 * vault the tag belongs to.
 *
 * AR-2: no secrets pass through this module — tags carry only non-secret
 * metadata (name, color).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { resourceTags, tags } from '../schema';
import { httpError } from '../middleware/error-handler';
import { requireActiveSession, requireOwnVault } from '../middleware/auth-guard';
import { queryPreHandler } from '../middleware/query';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CreateTagBody {
  vaultId?: string;
  name: string;
  color?: string | null;
}

export interface UpdateTagBody {
  name?: string;
  color?: string | null;
}

interface TagDTO {
  id: string;
  vaultId: string;
  name: string;
  color: string | null;
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
}

type TagRow = typeof tags.$inferSelect;

// ─── Serialization ──────────────────────────────────────────────────────────

function toDTO(row: TagRow): TagDTO {
  return {
    id: row.id,
    vaultId: row.vaultId,
    name: row.name,
    color: row.color,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deleted: row.deletedAt !== null,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function findOwnTag(vaultId: string, tagId: string) {
  const tag = await db.query.tags.findFirst({
    where: and(eq(tags.id, tagId), isNull(tags.deletedAt)),
  });
  if (!tag || tag.vaultId !== vaultId) {
    throw httpError(404, 'Tag not found');
  }
  return tag;
}

/**
 * Tag names are unique within a vault, case-insensitive (ADR-004).
 * `excludeTagId` lets an update check uniqueness against every OTHER tag
 * in the vault without tripping on the tag's own current name.
 */
async function assertNameAvailable(
  vaultId: string,
  name: string,
  excludeTagId?: string,
): Promise<void> {
  const rows = await db.query.tags.findMany({
    where: and(eq(tags.vaultId, vaultId), isNull(tags.deletedAt)),
  });
  const lower = name.toLowerCase();
  const clash = rows.find(
    (t) => t.name.toLowerCase() === lower && (excludeTagId === undefined || t.id !== excludeTagId),
  );
  if (clash) {
    throw httpError(400, 'A tag with this name already exists in this vault');
  }
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

export function tagsPlugin(server: FastifyInstance): void {
  queryPreHandler(server);

  // ── GET /tags ───────────────────────────────────────────────────────────
  server.get(
    '/tags',
    { config: { operationId: 'ListTags' } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = await requireActiveSession(request);
      const vault = await requireOwnVault(userId);

      const q = request.queryParsed;
      const includeDeleted =
        (request.query as { include_deleted?: string } | undefined)?.include_deleted === 'true';

      const rows = await db.query.tags.findMany({
        where: includeDeleted
          ? eq(tags.vaultId, vault.id)
          : and(eq(tags.vaultId, vault.id), isNull(tags.deletedAt)),
        limit: q.pagination.limit,
        offset: q.pagination.offset,
      });

      return reply.code(200).send({
        data: rows.map(toDTO),
        pagination: { page: q.pagination.page, perPage: q.pagination.perPage },
      });
    },
  );

  // ── GET /tags/:id ───────────────────────────────────────────────────────
  server.get<{ Params: { id: string } }>(
    '/tags/:id',
    { config: { operationId: 'GetTag' } },
    async (request, reply) => {
      const { userId } = await requireActiveSession(request);
      const vault = await requireOwnVault(userId);
      const tag = await findOwnTag(vault.id, request.params.id);
      return reply.code(200).send(toDTO(tag));
    },
  );

  // ── POST /tags ──────────────────────────────────────────────────────────
  server.post<{ Body: CreateTagBody }>(
    '/tags',
    {
      config: { operationId: 'CreateTag' },
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            vaultId: { type: 'string' },
            name: { type: 'string', minLength: 1 },
            color: { type: ['string', 'null'] },
          },
        },
      },
    },
    async (request, reply) => {
      const { userId } = await requireActiveSession(request);
      const vault = await requireOwnVault(userId);

      // Never trust a client-supplied vaultId for tenant scoping — same
      // rule as BE-003b/d.
      if (request.body.vaultId && request.body.vaultId !== vault.id) {
        throw httpError(403, "vaultId does not match the authenticated user's vault");
      }

      await assertNameAvailable(vault.id, request.body.name);

      const now = new Date();
      const id = randomUUID();
      await db.insert(tags).values({
        id,
        vaultId: vault.id,
        name: request.body.name,
        color: request.body.color ?? null,
        createdAt: now,
        updatedAt: now,
      });

      const created = await db.query.tags.findFirst({ where: eq(tags.id, id) });
      return reply.code(201).send(toDTO(created!));
    },
  );

  // ── PATCH /tags/:id ─────────────────────────────────────────────────────
  server.patch<{ Params: { id: string }; Body: UpdateTagBody }>(
    '/tags/:id',
    {
      config: { operationId: 'UpdateTag' },
      schema: {
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1 },
            color: { type: ['string', 'null'] },
          },
        },
      },
    },
    async (request, reply) => {
      const { userId } = await requireActiveSession(request);
      const vault = await requireOwnVault(userId);
      const tag = await findOwnTag(vault.id, request.params.id);

      const body = request.body;
      if (body.name !== undefined) {
        await assertNameAvailable(vault.id, body.name, tag.id);
      }

      const updates: Partial<typeof tags.$inferInsert> = { updatedAt: new Date() };
      if (body.name !== undefined) updates.name = body.name;
      if (body.color !== undefined) updates.color = body.color;

      await db.update(tags).set(updates).where(eq(tags.id, tag.id));

      const updated = await db.query.tags.findFirst({ where: eq(tags.id, tag.id) });
      return reply.code(200).send(toDTO(updated!));
    },
  );

  // ── DELETE /tags/:id ────────────────────────────────────────────────────
  server.delete<{ Params: { id: string } }>(
    '/tags/:id',
    { config: { operationId: 'DeleteTag' } },
    async (request, reply) => {
      const { userId } = await requireActiveSession(request);
      const vault = await requireOwnVault(userId);
      const tag = await findOwnTag(vault.id, request.params.id);

      const now = new Date();
      // ADR-004 DELETE /tags/{id}: "decrements tag reference count on
      // resources" — detach the tag from every resource that carries it,
      // rather than leaving resource_tags rows pointing at a deleted tag.
      await db.delete(resourceTags).where(eq(resourceTags.tagId, tag.id));
      await db.update(tags).set({ deletedAt: now, updatedAt: now }).where(eq(tags.id, tag.id));

      const deleted = await db.query.tags.findFirst({ where: eq(tags.id, tag.id) });
      return reply.code(200).send(toDTO(deleted!));
    },
  );
}
