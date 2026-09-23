/** @fileoverview BE-003d: Folder CRUD + Tree + Permission Mask — integration tests.
 *
 * Test type: integration (real Fastify server via createServer(), real
 * migrated SQLite DB).
 *
 * Covers the AC: POST/GET/PATCH/DELETE /folders — tree structure
 * (parentId), permission mask (owner/update/read).
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

const tmpDir = mkdtempSync(join(tmpdir(), 'pm-be003d-'));
const dbPath = join(tmpDir, 'test.db');

describe('BE-003d: POST/GET/PATCH/DELETE /api/v1/folders', () => {
  let server: ReturnType<typeof createServer>;

  async function registerAndUnlock(label: string) {
    const email = `folders-${label}-${Math.random().toString(36).slice(2)}@example.test`;
    // Kept short and label-independent (username has a 32-char max) —
    // uniqueness comes from the random suffix, not the test label.
    const username = `fld${Math.random().toString(36).slice(2, 12)}`;
    const masterPassword = `folders-test-password-${label}-001`;

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
    const liveDb = drizzle(sql, { schema });
    setTestDbOverride(liveDb);

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
    const res = await server.inject({ method: 'GET', url: '/api/v1/folders' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with a garbage Bearer token', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/folders',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  // ── Registration creates a vault (prerequisite for folders) ────────────────

  it('registration auto-creates a vault so folders can be created immediately', async () => {
    const { accessToken } = await registerAndUnlock('vault-prereq');
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/folders',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { name: 'Root Folder' },
    });
    expect(res.statusCode).toBe(201);
  });

  // ── Create ───────────────────────────────────────────────────────────────

  describe('POST /api/v1/folders', () => {
    it('creates a root-level folder (parentId omitted) and returns it enveloped', async () => {
      const { accessToken } = await registerAndUnlock('create-root');
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'Work', description: 'Work stuff', icon: 'briefcase', color: '#336699' },
      });
      expect(res.statusCode).toBe(201);
      const envelope = res.json() as { header: { status: string }; body: Record<string, unknown> };
      expect(envelope.header.status).toBe('success');
      const folder = envelope.body;
      expect(folder.name).toBe('Work');
      expect(folder.parentId).toBeNull();
      expect(folder.description).toBe('Work stuff');
      expect(folder.icon).toBe('briefcase');
      expect(folder.color).toBe('#336699');
      expect(folder.deleted).toBe(false);
      expect(folder.permissionMask).toBeNull();
      expect(typeof folder.id).toBe('string');
      expect(typeof folder.vaultId).toBe('string');
      expect(typeof folder.ownerId).toBe('string');
    });

    it('creates a child folder via parentId, forming a tree', async () => {
      const { accessToken } = await registerAndUnlock('create-child');
      const parentRes = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'Work' },
      });
      const parentId = (parentRes.json() as { body: { id: string } }).body.id;

      const childRes = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'Engineering', parentId },
      });
      expect(childRes.statusCode).toBe(201);
      const child = (childRes.json() as { body: { parentId: string } }).body;
      expect(child.parentId).toBe(parentId);
    });

    it('sets permissionMask (level/granteeType/granteeId) on create', async () => {
      const { accessToken, userId } = await registerAndUnlock('create-mask');
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          name: 'Shared',
          permissionMask: { level: 'update', granteeType: 'user', granteeId: userId },
        },
      });
      expect(res.statusCode).toBe(201);
      const folder = (res.json() as { body: { permissionMask: unknown } }).body;
      expect(folder.permissionMask).toEqual({
        level: 'update',
        granteeType: 'user',
        granteeId: userId,
      });
    });

    it('returns 400 when name is missing', async () => {
      const { accessToken } = await registerAndUnlock('create-no-name');
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when parentId names a folder that does not exist', async () => {
      const { accessToken } = await registerAndUnlock('create-bad-parent');
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'Orphan', parentId: '00000000-0000-0000-0000-000000000000' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when parentId names a folder in a different vault', async () => {
      const a = await registerAndUnlock('cross-vault-a');
      const b = await registerAndUnlock('cross-vault-b');

      const otherFolderRes = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${b.accessToken}` },
        payload: { name: "B's folder" },
      });
      const otherFolderId = (otherFolderRes.json() as { body: { id: string } }).body.id;

      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${a.accessToken}` },
        payload: { name: "A's folder", parentId: otherFolderId },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 403 when vaultId in the body does not match the caller's own vault", async () => {
      const a = await registerAndUnlock('vault-mismatch-a');
      const b = await registerAndUnlock('vault-mismatch-b');

      // Discover b's vaultId via one of their folders.
      const bFolderRes = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${b.accessToken}` },
        payload: { name: "B's folder" },
      });
      const bVaultId = (bFolderRes.json() as { body: { vaultId: string } }).body.vaultId;

      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${a.accessToken}` },
        payload: { name: 'Should fail', vaultId: bVaultId },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ── Read ─────────────────────────────────────────────────────────────────

  describe('GET /api/v1/folders and /api/v1/folders/:id', () => {
    it("lists only the caller's own folders", async () => {
      const a = await registerAndUnlock('list-a');
      const b = await registerAndUnlock('list-b');

      await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${a.accessToken}` },
        payload: { name: 'A1' },
      });
      await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${a.accessToken}` },
        payload: { name: 'A2' },
      });
      await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${b.accessToken}` },
        payload: { name: 'B1' },
      });

      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${a.accessToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = (res.json() as { body: { data: Array<{ name: string }> } }).body;
      const names = body.data.map((f) => f.name).sort();
      expect(names).toEqual(['A1', 'A2']);
    });

    it('gets a single folder by id', async () => {
      const { accessToken } = await registerAndUnlock('get-one');
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'Solo' },
      });
      const id = (createRes.json() as { body: { id: string } }).body.id;

      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/folders/${id}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { body: { name: string } }).body.name).toBe('Solo');
    });

    it('returns 404 for a nonexistent folder id', async () => {
      const { accessToken } = await registerAndUnlock('get-missing');
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/folders/00000000-0000-0000-0000-000000000000',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 (not 403) for another user's folder — no cross-vault existence leak", async () => {
      const a = await registerAndUnlock('cross-get-a');
      const b = await registerAndUnlock('cross-get-b');

      const bFolderRes = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${b.accessToken}` },
        payload: { name: "B's private folder" },
      });
      const bFolderId = (bFolderRes.json() as { body: { id: string } }).body.id;

      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/folders/${bFolderId}`,
        headers: { authorization: `Bearer ${a.accessToken}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Update ───────────────────────────────────────────────────────────────

  describe('PATCH /api/v1/folders/:id', () => {
    it('updates name/description/icon/color', async () => {
      const { accessToken } = await registerAndUnlock('patch-fields');
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'Old Name' },
      });
      const id = (createRes.json() as { body: { id: string } }).body.id;

      const res = await server.inject({
        method: 'PATCH',
        url: `/api/v1/folders/${id}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'New Name', color: '#ff0000' },
      });
      expect(res.statusCode).toBe(200);
      const folder = (res.json() as { body: { name: string; color: string } }).body;
      expect(folder.name).toBe('New Name');
      expect(folder.color).toBe('#ff0000');
    });

    it('moves a folder to a new parent (re-parenting)', async () => {
      const { accessToken } = await registerAndUnlock('patch-move');
      const p1 = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'Parent 1' },
      });
      const p2 = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'Parent 2' },
      });
      const p1Id = (p1.json() as { body: { id: string } }).body.id;
      const p2Id = (p2.json() as { body: { id: string } }).body.id;

      const child = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'Child', parentId: p1Id },
      });
      const childId = (child.json() as { body: { id: string } }).body.id;

      const res = await server.inject({
        method: 'PATCH',
        url: `/api/v1/folders/${childId}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { parentId: p2Id },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { body: { parentId: string } }).body.parentId).toBe(p2Id);
    });

    it('returns 400 when parentId would set a folder as its own parent', async () => {
      const { accessToken } = await registerAndUnlock('patch-self-parent');
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'Self' },
      });
      const id = (createRes.json() as { body: { id: string } }).body.id;

      const res = await server.inject({
        method: 'PATCH',
        url: `/api/v1/folders/${id}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { parentId: id },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when parentId would create a cycle (moving a folder under its own descendant)', async () => {
      const { accessToken } = await registerAndUnlock('patch-cycle');
      const root = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'Root' },
      });
      const rootId = (root.json() as { body: { id: string } }).body.id;

      const child = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'Child', parentId: rootId },
      });
      const childId = (child.json() as { body: { id: string } }).body.id;

      const grandchild = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'Grandchild', parentId: childId },
      });
      const grandchildId = (grandchild.json() as { body: { id: string } }).body.id;

      // Try to move Root under its own grandchild — must be rejected.
      const res = await server.inject({
        method: 'PATCH',
        url: `/api/v1/folders/${rootId}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { parentId: grandchildId },
      });
      expect(res.statusCode).toBe(400);
    });

    it('updates permissionMask, and can clear it back to null', async () => {
      const { accessToken, userId } = await registerAndUnlock('patch-mask');
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'Masked' },
      });
      const id = (createRes.json() as { body: { id: string } }).body.id;

      const setRes = await server.inject({
        method: 'PATCH',
        url: `/api/v1/folders/${id}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          permissionMask: { level: 'read', granteeType: 'user', granteeId: userId },
        },
      });
      expect(setRes.statusCode).toBe(200);
      expect((setRes.json() as { body: { permissionMask: unknown } }).body.permissionMask).toEqual(
        { level: 'read', granteeType: 'user', granteeId: userId },
      );

      const clearRes = await server.inject({
        method: 'PATCH',
        url: `/api/v1/folders/${id}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { permissionMask: null },
      });
      expect(clearRes.statusCode).toBe(200);
      expect(
        (clearRes.json() as { body: { permissionMask: unknown } }).body.permissionMask,
      ).toBeNull();
    });

    it("returns 404 when patching another user's folder", async () => {
      const a = await registerAndUnlock('patch-cross-a');
      const b = await registerAndUnlock('patch-cross-b');

      const bFolderRes = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${b.accessToken}` },
        payload: { name: "B's folder" },
      });
      const bFolderId = (bFolderRes.json() as { body: { id: string } }).body.id;

      const res = await server.inject({
        method: 'PATCH',
        url: `/api/v1/folders/${bFolderId}`,
        headers: { authorization: `Bearer ${a.accessToken}` },
        payload: { name: 'Hijacked' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Delete ───────────────────────────────────────────────────────────────

  describe('DELETE /api/v1/folders/:id', () => {
    it('soft-deletes a folder; it then 404s on GET', async () => {
      const { accessToken } = await registerAndUnlock('delete-basic');
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'ToDelete' },
      });
      const id = (createRes.json() as { body: { id: string } }).body.id;

      const delRes = await server.inject({
        method: 'DELETE',
        url: `/api/v1/folders/${id}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(delRes.statusCode).toBe(200);
      expect((delRes.json() as { body: { deleted: boolean } }).body.deleted).toBe(true);

      const getRes = await server.inject({
        method: 'GET',
        url: `/api/v1/folders/${id}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(getRes.statusCode).toBe(404);
    });

    it('re-parents child folders to root (parentId=null) instead of cascading', async () => {
      const { accessToken } = await registerAndUnlock('delete-reparent');
      const parentRes = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'Parent' },
      });
      const parentId = (parentRes.json() as { body: { id: string } }).body.id;

      const childRes = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'Child', parentId },
      });
      const childId = (childRes.json() as { body: { id: string } }).body.id;

      await server.inject({
        method: 'DELETE',
        url: `/api/v1/folders/${parentId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const getChildRes = await server.inject({
        method: 'GET',
        url: `/api/v1/folders/${childId}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(getChildRes.statusCode).toBe(200);
      expect(
        (getChildRes.json() as { body: { parentId: string | null } }).body.parentId,
      ).toBeNull();
    });

    it("returns 404 when deleting another user's folder", async () => {
      const a = await registerAndUnlock('delete-cross-a');
      const b = await registerAndUnlock('delete-cross-b');

      const bFolderRes = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${b.accessToken}` },
        payload: { name: "B's folder" },
      });
      const bFolderId = (bFolderRes.json() as { body: { id: string } }).body.id;

      const res = await server.inject({
        method: 'DELETE',
        url: `/api/v1/folders/${bFolderId}`,
        headers: { authorization: `Bearer ${a.accessToken}` },
      });
      expect(res.statusCode).toBe(404);

      // Confirm it wasn't actually deleted.
      const getRes = await server.inject({
        method: 'GET',
        url: `/api/v1/folders/${bFolderId}`,
        headers: { authorization: `Bearer ${b.accessToken}` },
      });
      expect(getRes.statusCode).toBe(200);
    });
  });
});
