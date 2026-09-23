/** @fileoverview BE-003e: Tag CRUD — integration tests.
 *
 * Test type: integration (real Fastify server via createServer(), real
 * migrated SQLite DB).
 *
 * Covers the AC: POST/GET/PATCH/DELETE /tags — flat, many-to-many via
 * resource_tags.
 *
 * AR-3: Positive + negative tests.
 * AR-4: All data is synthetic, generated at test time.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import './auth/test-env';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../src/schema';
import { createServer } from '../src/server';
import { setTestDbOverride } from '../src/db';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDir = mkdtempSync(join(tmpdir(), 'pm-be003e-'));
const dbPath = join(tmpDir, 'test.db');

const FAKE_SECRET_B64 = Buffer.from('synthetic-secret-payload-not-real').toString('base64');
const FAKE_IV_B64 = Buffer.alloc(12, 0xab).toString('base64');
const FAKE_TAG_B64 = Buffer.alloc(16, 0xcd).toString('base64');

describe('BE-003e: POST/GET/PATCH/DELETE /api/v1/tags', () => {
  let server: ReturnType<typeof createServer>;

  async function registerAndUnlock(label: string) {
    const email = `tags-${label}-${Math.random().toString(36).slice(2)}@example.test`;
    const username = `tag${Math.random().toString(36).slice(2, 12)}`;
    const masterPassword = `tags-test-password-${label}-001`;

    const registerRes = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { masterPassword, email, username },
    });
    expect(registerRes.statusCode).toBe(201);
    const userId = (registerRes.json() as { id: string }).id;

    const unlockRes = await server.inject({
      method: 'POST',
      url: '/auth/unlock',
      payload: { masterPassword, email },
    });
    expect(unlockRes.statusCode).toBe(200);
    const accessToken = (unlockRes.json() as { accessToken: string }).accessToken;

    return { userId, accessToken };
  }

  beforeAll(async () => {
    const setupDb = new Database(dbPath);
    setupDb.exec('PRAGMA foreign_keys = ON;');
    const migratedDb = drizzle(setupDb, { schema });
    migrate(migratedDb, { migrationsFolder: `${import.meta.dirname}/../migrations` });
    setupDb.close();

    const sql = new Database(dbPath);
    sql.exec('PRAGMA foreign_keys = ON;');
    setTestDbOverride(drizzle(sql, { schema }));

    server = createServer({ logger: false });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  // ── Auth guard ────────────────────────────────────────────────────────────

  it('returns 401 with no Authorization header', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/tags' });
    expect(res.statusCode).toBe(401);
  });

  // ── Create ───────────────────────────────────────────────────────────────

  describe('POST /api/v1/tags', () => {
    it('creates a tag', async () => {
      const { accessToken } = await registerAndUnlock('create-basic');
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/tags',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'work', color: '#336699' },
      });
      expect(res.statusCode).toBe(201);
      const envelope = res.json() as { header: { status: string }; body: Record<string, unknown> };
      expect(envelope.header.status).toBe('success');
      const tag = envelope.body;
      expect(tag.name).toBe('work');
      expect(tag.color).toBe('#336699');
      expect(tag.deleted).toBe(false);
      expect(typeof tag.id).toBe('string');
      expect(typeof tag.vaultId).toBe('string');
    });

    it('returns 400 when name is missing', async () => {
      const { accessToken } = await registerAndUnlock('create-no-name');
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/tags',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for a duplicate tag name in the same vault (case-insensitive)', async () => {
      const { accessToken } = await registerAndUnlock('create-dup');
      await server.inject({
        method: 'POST',
        url: '/api/v1/tags',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'Important' },
      });
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/tags',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'important' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('allows the same tag name in two different vaults', async () => {
      const a = await registerAndUnlock('dup-a');
      const b = await registerAndUnlock('dup-b');

      const resA = await server.inject({
        method: 'POST',
        url: '/api/v1/tags',
        headers: { authorization: `Bearer ${a.accessToken}` },
        payload: { name: 'shared-name' },
      });
      const resB = await server.inject({
        method: 'POST',
        url: '/api/v1/tags',
        headers: { authorization: `Bearer ${b.accessToken}` },
        payload: { name: 'shared-name' },
      });
      expect(resA.statusCode).toBe(201);
      expect(resB.statusCode).toBe(201);
    });

    it("returns 403 when vaultId in the body does not match the caller's own vault", async () => {
      const a = await registerAndUnlock('vault-mismatch-a');
      const b = await registerAndUnlock('vault-mismatch-b');

      const bTagRes = await server.inject({
        method: 'POST',
        url: '/api/v1/tags',
        headers: { authorization: `Bearer ${b.accessToken}` },
        payload: { name: "b's tag" },
      });
      const bVaultId = (bTagRes.json() as { body: { vaultId: string } }).body.vaultId;

      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/tags',
        headers: { authorization: `Bearer ${a.accessToken}` },
        payload: { name: 'should fail', vaultId: bVaultId },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ── Read ─────────────────────────────────────────────────────────────────

  describe('GET /api/v1/tags and /api/v1/tags/:id', () => {
    it("lists only the caller's own tags", async () => {
      const a = await registerAndUnlock('list-a');
      const b = await registerAndUnlock('list-b');

      await server.inject({
        method: 'POST',
        url: '/api/v1/tags',
        headers: { authorization: `Bearer ${a.accessToken}` },
        payload: { name: 'a-tag-1' },
      });
      await server.inject({
        method: 'POST',
        url: '/api/v1/tags',
        headers: { authorization: `Bearer ${a.accessToken}` },
        payload: { name: 'a-tag-2' },
      });
      await server.inject({
        method: 'POST',
        url: '/api/v1/tags',
        headers: { authorization: `Bearer ${b.accessToken}` },
        payload: { name: 'b-tag-1' },
      });

      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/tags',
        headers: { authorization: `Bearer ${a.accessToken}` },
      });
      expect(res.statusCode).toBe(200);
      const names = (res.json() as { body: { data: Array<{ name: string }> } }).body.data
        .map((t) => t.name)
        .sort();
      expect(names).toEqual(['a-tag-1', 'a-tag-2']);
    });

    it('gets a single tag by id', async () => {
      const { accessToken } = await registerAndUnlock('get-one');
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/tags',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'solo-tag' },
      });
      const id = (createRes.json() as { body: { id: string } }).body.id;

      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/tags/${id}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { body: { name: string } }).body.name).toBe('solo-tag');
    });

    it('returns 404 for a nonexistent tag id', async () => {
      const { accessToken } = await registerAndUnlock('get-missing');
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/tags/00000000-0000-0000-0000-000000000000',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for another user's tag", async () => {
      const a = await registerAndUnlock('cross-get-a');
      const b = await registerAndUnlock('cross-get-b');

      const bTagRes = await server.inject({
        method: 'POST',
        url: '/api/v1/tags',
        headers: { authorization: `Bearer ${b.accessToken}` },
        payload: { name: "b's private tag" },
      });
      const bTagId = (bTagRes.json() as { body: { id: string } }).body.id;

      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/tags/${bTagId}`,
        headers: { authorization: `Bearer ${a.accessToken}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Update ───────────────────────────────────────────────────────────────

  describe('PATCH /api/v1/tags/:id', () => {
    it('updates name and color', async () => {
      const { accessToken } = await registerAndUnlock('patch-fields');
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/tags',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'old-name' },
      });
      const id = (createRes.json() as { body: { id: string } }).body.id;

      const res = await server.inject({
        method: 'PATCH',
        url: `/api/v1/tags/${id}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'new-name', color: '#ff0000' },
      });
      expect(res.statusCode).toBe(200);
      const tag = (res.json() as { body: { name: string; color: string } }).body;
      expect(tag.name).toBe('new-name');
      expect(tag.color).toBe('#ff0000');
    });

    it('allows renaming a tag to its own current name (case-unchanged)', async () => {
      const { accessToken } = await registerAndUnlock('patch-same-name');
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/tags',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'stable' },
      });
      const id = (createRes.json() as { body: { id: string } }).body.id;

      const res = await server.inject({
        method: 'PATCH',
        url: `/api/v1/tags/${id}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'stable', color: '#00ff00' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('returns 400 when renaming to a name already used by another tag', async () => {
      const { accessToken } = await registerAndUnlock('patch-dup');
      await server.inject({
        method: 'POST',
        url: '/api/v1/tags',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'taken' },
      });
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/tags',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'available' },
      });
      const id = (createRes.json() as { body: { id: string } }).body.id;

      const res = await server.inject({
        method: 'PATCH',
        url: `/api/v1/tags/${id}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'Taken' },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 404 when patching another user's tag", async () => {
      const a = await registerAndUnlock('patch-cross-a');
      const b = await registerAndUnlock('patch-cross-b');

      const bTagRes = await server.inject({
        method: 'POST',
        url: '/api/v1/tags',
        headers: { authorization: `Bearer ${b.accessToken}` },
        payload: { name: "b's tag" },
      });
      const bTagId = (bTagRes.json() as { body: { id: string } }).body.id;

      const res = await server.inject({
        method: 'PATCH',
        url: `/api/v1/tags/${bTagId}`,
        headers: { authorization: `Bearer ${a.accessToken}` },
        payload: { name: 'hijacked' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Delete ───────────────────────────────────────────────────────────────

  describe('DELETE /api/v1/tags/:id', () => {
    it('soft-deletes a tag; it then 404s on GET', async () => {
      const { accessToken } = await registerAndUnlock('delete-basic');
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/tags',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'to-delete' },
      });
      const id = (createRes.json() as { body: { id: string } }).body.id;

      const delRes = await server.inject({
        method: 'DELETE',
        url: `/api/v1/tags/${id}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(delRes.statusCode).toBe(200);
      expect((delRes.json() as { body: { deleted: boolean } }).body.deleted).toBe(true);

      const getRes = await server.inject({
        method: 'GET',
        url: `/api/v1/tags/${id}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(getRes.statusCode).toBe(404);
    });

    it('detaches the tag from every resource that carried it', async () => {
      const { accessToken } = await registerAndUnlock('delete-detach');
      const tagRes = await server.inject({
        method: 'POST',
        url: '/api/v1/tags',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'to-be-removed' },
      });
      const tagId = (tagRes.json() as { body: { id: string } }).body.id;

      const resourceRes = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          name: 'Tagged Resource',
          type: 'password-and-description',
          secretCiphertext: FAKE_SECRET_B64,
          secretIv: FAKE_IV_B64,
          secretTag: FAKE_TAG_B64,
          tagIds: [tagId],
        },
      });
      const resourceId = (resourceRes.json() as { body: { id: string } }).body.id;
      expect((resourceRes.json() as { body: { tagIds: string[] } }).body.tagIds).toEqual([tagId]);

      await server.inject({
        method: 'DELETE',
        url: `/api/v1/tags/${tagId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const getResourceRes = await server.inject({
        method: 'GET',
        url: `/api/v1/resources/${resourceId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect((getResourceRes.json() as { body: { tagIds: string[] } }).body.tagIds).toEqual([]);
    });

    it("returns 404 when deleting another user's tag, and it is not actually deleted", async () => {
      const a = await registerAndUnlock('delete-cross-a');
      const b = await registerAndUnlock('delete-cross-b');

      const bTagRes = await server.inject({
        method: 'POST',
        url: '/api/v1/tags',
        headers: { authorization: `Bearer ${b.accessToken}` },
        payload: { name: "b's tag" },
      });
      const bTagId = (bTagRes.json() as { body: { id: string } }).body.id;

      const res = await server.inject({
        method: 'DELETE',
        url: `/api/v1/tags/${bTagId}`,
        headers: { authorization: `Bearer ${a.accessToken}` },
      });
      expect(res.statusCode).toBe(404);

      const getRes = await server.inject({
        method: 'GET',
        url: `/api/v1/tags/${bTagId}`,
        headers: { authorization: `Bearer ${b.accessToken}` },
      });
      expect(getRes.statusCode).toBe(200);
    });
  });
});
