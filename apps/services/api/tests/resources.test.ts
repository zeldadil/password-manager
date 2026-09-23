/** @fileoverview BE-003b: Resource CRUD API + Schema — integration tests.
 *
 * Test type: integration (real Fastify server via createServer(), real
 * migrated SQLite DB).
 *
 * Covers the AC: POST/GET/PATCH/DELETE /resources — metadata in
 * request/response, API never sees plaintext secret; resource schema per
 * ADR-003.
 *
 * AR-3: Positive + negative tests.
 * AR-4: All data is synthetic, generated at test time. "Secrets" here are
 * opaque base64 blobs the API never decrypts — not real credentials.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import './auth/test-env';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { randomUUID } from 'node:crypto';
import * as schema from '../src/schema';
import { createServer } from '../src/server';
import { setTestDbOverride } from '../src/db';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDir = mkdtempSync(join(tmpdir(), 'pm-be003b-'));
const dbPath = join(tmpDir, 'test.db');

// A synthetic, opaque "ciphertext" the API never inspects — this test
// suite never runs real AEAD; only the wire encoding (base64) matters.
const FAKE_SECRET_B64 = Buffer.from('synthetic-secret-payload-not-real').toString('base64');
const FAKE_IV_B64 = Buffer.alloc(12, 0xab).toString('base64');
const FAKE_TAG_B64 = Buffer.alloc(16, 0xcd).toString('base64');

describe('BE-003b: POST/GET/PATCH/DELETE /api/v1/resources', () => {
  let server: ReturnType<typeof createServer>;
  let liveDb: ReturnType<typeof drizzle<typeof schema>>;

  async function registerAndUnlock(label: string) {
    const email = `resources-${label}-${Math.random().toString(36).slice(2)}@example.test`;
    const username = `res${Math.random().toString(36).slice(2, 12)}`;
    const masterPassword = `resources-test-password-${label}-001`;

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

  /** Insert a tag row directly — no Tag CRUD endpoint exists yet (BE-003e). */
  async function insertTag(vaultId: string, name: string): Promise<string> {
    const id = randomUUID();
    const now = new Date();
    await liveDb.insert(schema.tags).values({ id, vaultId, name, createdAt: now, updatedAt: now });
    return id;
  }

  /** Insert a permission grant directly — no grant/revoke endpoint exists
   *  yet (BE-003f only enforces grants that already exist). */
  async function grantPermission(
    targetType: 'folder' | 'resource',
    targetId: string,
    granteeId: string,
    level: 'read' | 'update' | 'owner',
    grantedBy: string,
  ): Promise<void> {
    const now = new Date();
    await liveDb.insert(schema.permissions).values({
      id: randomUUID(),
      targetType,
      targetId,
      granteeType: 'user',
      granteeId,
      level,
      grantedBy,
      createdAt: now,
      updatedAt: now,
    });
  }

  async function vaultIdFor(accessToken: string): Promise<string> {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/folders',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { name: `probe-${Math.random().toString(36).slice(2)}` },
    });
    return (res.json() as { body: { vaultId: string } }).body.vaultId;
  }

  const basePayload = () => ({
    name: 'Work Login',
    type: 'username-password-uri' as const,
    username: 'octocat',
    uri: 'https://example.test',
    secretCiphertext: FAKE_SECRET_B64,
    secretIv: FAKE_IV_B64,
    secretTag: FAKE_TAG_B64,
  });

  beforeAll(async () => {
    const setupDb = new Database(dbPath);
    setupDb.exec('PRAGMA foreign_keys = ON;');
    const migratedDb = drizzle(setupDb, { schema });
    migrate(migratedDb, { migrationsFolder: `${import.meta.dirname}/../migrations` });
    setupDb.close();

    const sql = new Database(dbPath);
    sql.exec('PRAGMA foreign_keys = ON;');
    liveDb = drizzle(sql, { schema });
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
    const res = await server.inject({ method: 'GET', url: '/api/v1/resources' });
    expect(res.statusCode).toBe(401);
  });

  // ── Create ───────────────────────────────────────────────────────────────

  describe('POST /api/v1/resources', () => {
    it('creates a resource with plaintext metadata (metadataEncrypted=false, the default)', async () => {
      const { accessToken } = await registerAndUnlock('create-plain');
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: basePayload(),
      });
      expect(res.statusCode).toBe(201);
      const envelope = res.json() as { header: { status: string }; body: Record<string, unknown> };
      expect(envelope.header.status).toBe('success');
      const resource = envelope.body;
      expect(resource.name).toBe('Work Login');
      expect(resource.type).toBe('username-password-uri');
      expect(resource.username).toBe('octocat');
      expect(resource.uri).toBe('https://example.test');
      expect(resource.metadataEncrypted).toBe(false);
      expect(resource.metadataCiphertext).toBeNull();
      expect(resource.secretCiphertext).toBe(FAKE_SECRET_B64);
      expect(resource.secretIv).toBe(FAKE_IV_B64);
      expect(resource.secretTag).toBe(FAKE_TAG_B64);
      expect(resource.favorite).toBe(false);
      expect(resource.folderId).toBeNull();
      expect(resource.tagIds).toEqual([]);
      expect(resource.permissionIds).toEqual([]);
      expect(resource.deleted).toBe(false);
    });

    it('creates a resource with encrypted metadata (metadataEncrypted=true) — plaintext never returned', async () => {
      const { accessToken } = await registerAndUnlock('create-encmeta');
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          name: 'Encrypted Entry',
          type: 'password-and-description',
          username: 'this-should-be-ignored',
          secretCiphertext: FAKE_SECRET_B64,
          secretIv: FAKE_IV_B64,
          secretTag: FAKE_TAG_B64,
          metadataEncrypted: true,
          metadataCiphertext: FAKE_SECRET_B64,
          metadataIv: FAKE_IV_B64,
          metadataTag: FAKE_TAG_B64,
        },
      });
      expect(res.statusCode).toBe(201);
      const resource = (res.json() as { body: Record<string, unknown> }).body;
      expect(resource.metadataEncrypted).toBe(true);
      // Plaintext must never be persisted or returned once encrypted.
      expect(resource.username).toBeNull();
      expect(resource.uri).toBeNull();
      expect(resource.description).toBeNull();
      expect(resource.metadataCiphertext).toBe(FAKE_SECRET_B64);
      expect(resource.metadataIv).toBe(FAKE_IV_B64);
      expect(resource.metadataTag).toBe(FAKE_TAG_B64);
    });

    it('returns 400 when metadataEncrypted=true but metadataCiphertext/Iv/Tag are missing', async () => {
      const { accessToken } = await registerAndUnlock('create-encmeta-missing');
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          name: 'Bad',
          type: 'password-and-description',
          secretCiphertext: FAKE_SECRET_B64,
          secretIv: FAKE_IV_B64,
          secretTag: FAKE_TAG_B64,
          metadataEncrypted: true,
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when a required field is missing (no secretCiphertext)', async () => {
      const { accessToken } = await registerAndUnlock('create-no-secret');
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'No Secret', type: 'password-and-description' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for an invalid resource type', async () => {
      const { accessToken } = await registerAndUnlock('create-bad-type');
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { ...basePayload(), type: 'not-a-real-type' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('creates a resource inside a folder (folderId)', async () => {
      const { accessToken } = await registerAndUnlock('create-in-folder');
      const folderRes = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'Work' },
      });
      const folderId = (folderRes.json() as { body: { id: string } }).body.id;

      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { ...basePayload(), folderId },
      });
      expect(res.statusCode).toBe(201);
      expect((res.json() as { body: { folderId: string } }).body.folderId).toBe(folderId);
    });

    it('returns 400 when folderId does not exist', async () => {
      const { accessToken } = await registerAndUnlock('create-bad-folder');
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { ...basePayload(), folderId: '00000000-0000-0000-0000-000000000000' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('attaches tagIds to a resource', async () => {
      const { accessToken } = await registerAndUnlock('create-tags');
      const vaultId = await vaultIdFor(accessToken);
      const tag1 = await insertTag(vaultId, 'work');
      const tag2 = await insertTag(vaultId, 'important');

      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { ...basePayload(), tagIds: [tag1, tag2] },
      });
      expect(res.statusCode).toBe(201);
      const tagIds = (res.json() as { body: { tagIds: string[] } }).body.tagIds.sort();
      expect(tagIds).toEqual([tag1, tag2].sort());
    });

    it('returns 400 when a tagId does not exist', async () => {
      const { accessToken } = await registerAndUnlock('create-bad-tag');
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { ...basePayload(), tagIds: ['00000000-0000-0000-0000-000000000000'] },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for non-base64 secretCiphertext', async () => {
      const { accessToken } = await registerAndUnlock('create-bad-b64');
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { ...basePayload(), secretCiphertext: '' },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 403 when vaultId in the body does not match the caller's own vault", async () => {
      const a = await registerAndUnlock('vault-mismatch-a');
      const b = await registerAndUnlock('vault-mismatch-b');
      const bVaultId = await vaultIdFor(b.accessToken);

      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${a.accessToken}` },
        payload: { ...basePayload(), vaultId: bVaultId },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ── Read ─────────────────────────────────────────────────────────────────

  describe('GET /api/v1/resources and /api/v1/resources/:id', () => {
    it("lists only the caller's own resources", async () => {
      const a = await registerAndUnlock('list-a');
      const b = await registerAndUnlock('list-b');

      await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${a.accessToken}` },
        payload: { ...basePayload(), name: 'A1' },
      });
      await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${b.accessToken}` },
        payload: { ...basePayload(), name: 'B1' },
      });

      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${a.accessToken}` },
      });
      expect(res.statusCode).toBe(200);
      const names = (res.json() as { body: { data: Array<{ name: string }> } }).body.data.map(
        (r) => r.name,
      );
      expect(names).toEqual(['A1']);
    });

    it('excludes soft-deleted resources by default, includes with include_deleted=true', async () => {
      const { accessToken } = await registerAndUnlock('list-deleted');
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { ...basePayload(), name: 'ToDelete' },
      });
      const id = (createRes.json() as { body: { id: string } }).body.id;
      await server.inject({
        method: 'DELETE',
        url: `/api/v1/resources/${id}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const withoutDeleted = await server.inject({
        method: 'GET',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const namesWithout = (
        withoutDeleted.json() as { body: { data: Array<{ name: string }> } }
      ).body.data.map((r) => r.name);
      expect(namesWithout).not.toContain('ToDelete');

      const withDeleted = await server.inject({
        method: 'GET',
        url: '/api/v1/resources?include_deleted=true',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const namesWith = (
        withDeleted.json() as { body: { data: Array<{ name: string }> } }
      ).body.data.map((r) => r.name);
      expect(namesWith).toContain('ToDelete');
    });

    it('gets a single resource by id', async () => {
      const { accessToken } = await registerAndUnlock('get-one');
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: basePayload(),
      });
      const id = (createRes.json() as { body: { id: string } }).body.id;

      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/resources/${id}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { body: { name: string } }).body.name).toBe('Work Login');
    });

    it('returns 404 for a nonexistent resource id', async () => {
      const { accessToken } = await registerAndUnlock('get-missing');
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/resources/00000000-0000-0000-0000-000000000000',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for another user's resource", async () => {
      const a = await registerAndUnlock('cross-get-a');
      const b = await registerAndUnlock('cross-get-b');

      const bRes = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${b.accessToken}` },
        payload: basePayload(),
      });
      const bId = (bRes.json() as { body: { id: string } }).body.id;

      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/resources/${bId}`,
        headers: { authorization: `Bearer ${a.accessToken}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Update ───────────────────────────────────────────────────────────────

  describe('PATCH /api/v1/resources/:id', () => {
    it('updates plaintext metadata fields', async () => {
      const { accessToken } = await registerAndUnlock('patch-fields');
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: basePayload(),
      });
      const id = (createRes.json() as { body: { id: string } }).body.id;

      const res = await server.inject({
        method: 'PATCH',
        url: `/api/v1/resources/${id}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'GitHub (renamed)', favorite: true },
      });
      expect(res.statusCode).toBe(200);
      const resource = (res.json() as { body: { name: string; favorite: boolean } }).body;
      expect(resource.name).toBe('GitHub (renamed)');
      expect(resource.favorite).toBe(true);
    });

    it('rotates the secret (new ciphertext/iv/tag)', async () => {
      const { accessToken } = await registerAndUnlock('patch-secret');
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: basePayload(),
      });
      const id = (createRes.json() as { body: { id: string } }).body.id;

      const newSecret = Buffer.from('rotated-secret').toString('base64');
      const res = await server.inject({
        method: 'PATCH',
        url: `/api/v1/resources/${id}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { secretCiphertext: newSecret, secretIv: FAKE_IV_B64, secretTag: FAKE_TAG_B64 },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { body: { secretCiphertext: string } }).body.secretCiphertext).toBe(
        newSecret,
      );
    });

    it('turning metadataEncrypted on clears plaintext and requires ciphertext', async () => {
      const { accessToken } = await registerAndUnlock('patch-enc-on');
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: basePayload(),
      });
      const id = (createRes.json() as { body: { id: string } }).body.id;

      const failRes = await server.inject({
        method: 'PATCH',
        url: `/api/v1/resources/${id}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { metadataEncrypted: true },
      });
      expect(failRes.statusCode).toBe(400);

      const okRes = await server.inject({
        method: 'PATCH',
        url: `/api/v1/resources/${id}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          metadataEncrypted: true,
          metadataCiphertext: FAKE_SECRET_B64,
          metadataIv: FAKE_IV_B64,
          metadataTag: FAKE_TAG_B64,
        },
      });
      expect(okRes.statusCode).toBe(200);
      const resource = (okRes.json() as { body: Record<string, unknown> }).body;
      expect(resource.metadataEncrypted).toBe(true);
      expect(resource.username).toBeNull();
      expect(resource.uri).toBeNull();
    });

    it('turning metadataEncrypted off clears the stale ciphertext', async () => {
      const { accessToken } = await registerAndUnlock('patch-enc-off');
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          ...basePayload(),
          metadataEncrypted: true,
          metadataCiphertext: FAKE_SECRET_B64,
          metadataIv: FAKE_IV_B64,
          metadataTag: FAKE_TAG_B64,
        },
      });
      const id = (createRes.json() as { body: { id: string } }).body.id;

      const res = await server.inject({
        method: 'PATCH',
        url: `/api/v1/resources/${id}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { metadataEncrypted: false, username: 'now-plaintext' },
      });
      expect(res.statusCode).toBe(200);
      const resource = (res.json() as { body: Record<string, unknown> }).body;
      expect(resource.metadataEncrypted).toBe(false);
      expect(resource.username).toBe('now-plaintext');
      expect(resource.metadataCiphertext).toBeNull();
    });

    it('replaces tagIds wholesale', async () => {
      const { accessToken } = await registerAndUnlock('patch-tags');
      const vaultId = await vaultIdFor(accessToken);
      const tag1 = await insertTag(vaultId, 'one');
      const tag2 = await insertTag(vaultId, 'two');

      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { ...basePayload(), tagIds: [tag1] },
      });
      const id = (createRes.json() as { body: { id: string } }).body.id;

      const res = await server.inject({
        method: 'PATCH',
        url: `/api/v1/resources/${id}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { tagIds: [tag2] },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { body: { tagIds: string[] } }).body.tagIds).toEqual([tag2]);
    });

    it('moves a resource into a folder', async () => {
      const { accessToken } = await registerAndUnlock('patch-move');
      const folderRes = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: 'Target' },
      });
      const folderId = (folderRes.json() as { body: { id: string } }).body.id;

      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: basePayload(),
      });
      const id = (createRes.json() as { body: { id: string } }).body.id;

      const res = await server.inject({
        method: 'PATCH',
        url: `/api/v1/resources/${id}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { folderId },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { body: { folderId: string } }).body.folderId).toBe(folderId);
    });

    it("returns 404 when patching another user's resource", async () => {
      const a = await registerAndUnlock('patch-cross-a');
      const b = await registerAndUnlock('patch-cross-b');

      const bRes = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${b.accessToken}` },
        payload: basePayload(),
      });
      const bId = (bRes.json() as { body: { id: string } }).body.id;

      const res = await server.inject({
        method: 'PATCH',
        url: `/api/v1/resources/${bId}`,
        headers: { authorization: `Bearer ${a.accessToken}` },
        payload: { name: 'Hijacked' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Delete ───────────────────────────────────────────────────────────────

  describe('DELETE /api/v1/resources/:id', () => {
    it('soft-deletes a resource; it then 404s on GET', async () => {
      const { accessToken } = await registerAndUnlock('delete-basic');
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: basePayload(),
      });
      const id = (createRes.json() as { body: { id: string } }).body.id;

      const delRes = await server.inject({
        method: 'DELETE',
        url: `/api/v1/resources/${id}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(delRes.statusCode).toBe(200);
      expect((delRes.json() as { body: { deleted: boolean } }).body.deleted).toBe(true);

      const getRes = await server.inject({
        method: 'GET',
        url: `/api/v1/resources/${id}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(getRes.statusCode).toBe(404);
    });

    it("returns 404 when deleting another user's resource, and it is not actually deleted", async () => {
      const a = await registerAndUnlock('delete-cross-a');
      const b = await registerAndUnlock('delete-cross-b');

      const bRes = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${b.accessToken}` },
        payload: basePayload(),
      });
      const bId = (bRes.json() as { body: { id: string } }).body.id;

      const res = await server.inject({
        method: 'DELETE',
        url: `/api/v1/resources/${bId}`,
        headers: { authorization: `Bearer ${a.accessToken}` },
      });
      expect(res.statusCode).toBe(404);

      const getRes = await server.inject({
        method: 'GET',
        url: `/api/v1/resources/${bId}`,
        headers: { authorization: `Bearer ${b.accessToken}` },
      });
      expect(getRes.statusCode).toBe(200);
    });
  });

  // ── Sharing (BE-003f: permission-based cross-vault access) ─────────────────

  describe('permission grants (BE-003f)', () => {
    it('a read grant allows GET but not PATCH (403, not 404)', async () => {
      const owner = await registerAndUnlock('grant-read-owner');
      const grantee = await registerAndUnlock('grant-read-grantee');

      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${owner.accessToken}` },
        payload: basePayload(),
      });
      const id = (createRes.json() as { body: { id: string } }).body.id;

      const before = await server.inject({
        method: 'GET',
        url: `/api/v1/resources/${id}`,
        headers: { authorization: `Bearer ${grantee.accessToken}` },
      });
      expect(before.statusCode).toBe(404);

      await grantPermission('resource', id, grantee.userId, 'read', owner.userId);

      const getRes = await server.inject({
        method: 'GET',
        url: `/api/v1/resources/${id}`,
        headers: { authorization: `Bearer ${grantee.accessToken}` },
      });
      expect(getRes.statusCode).toBe(200);

      const patchRes = await server.inject({
        method: 'PATCH',
        url: `/api/v1/resources/${id}`,
        headers: { authorization: `Bearer ${grantee.accessToken}` },
        payload: { name: 'Should not be allowed' },
      });
      expect(patchRes.statusCode).toBe(403);
    });

    it('an update grant allows PATCH and DELETE (Update includes delete rights)', async () => {
      const owner = await registerAndUnlock('grant-update-owner');
      const grantee = await registerAndUnlock('grant-update-grantee');

      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${owner.accessToken}` },
        payload: basePayload(),
      });
      const id = (createRes.json() as { body: { id: string } }).body.id;
      await grantPermission('resource', id, grantee.userId, 'update', owner.userId);

      const patchRes = await server.inject({
        method: 'PATCH',
        url: `/api/v1/resources/${id}`,
        headers: { authorization: `Bearer ${grantee.accessToken}` },
        payload: { name: 'Renamed by grantee' },
      });
      expect(patchRes.statusCode).toBe(200);

      const deleteRes = await server.inject({
        method: 'DELETE',
        url: `/api/v1/resources/${id}`,
        headers: { authorization: `Bearer ${grantee.accessToken}` },
      });
      expect(deleteRes.statusCode).toBe(200);
    });

    it("a shared resource does NOT appear in the grantee's own LIST (own-vault scoping, unchanged)", async () => {
      const owner = await registerAndUnlock('grant-list-owner');
      const grantee = await registerAndUnlock('grant-list-grantee');

      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${owner.accessToken}` },
        payload: basePayload(),
      });
      const id = (createRes.json() as { body: { id: string } }).body.id;
      await grantPermission('resource', id, grantee.userId, 'owner', owner.userId);

      const getRes = await server.inject({
        method: 'GET',
        url: `/api/v1/resources/${id}`,
        headers: { authorization: `Bearer ${grantee.accessToken}` },
      });
      expect(getRes.statusCode).toBe(200);

      const listRes = await server.inject({
        method: 'GET',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${grantee.accessToken}` },
      });
      const ids = (listRes.json() as { body: { data: Array<{ id: string }> } }).body.data.map(
        (r) => r.id,
      );
      expect(ids).not.toContain(id);
    });
  });

  // ── Folder permission mask propagation (BE-003g) ──────────────────────────

  describe('folder permissionMask propagation (BE-003g)', () => {
    async function makeMaskedFolder(accessToken: string, mask: {
      level: 'read' | 'update' | 'owner';
      granteeType: 'user' | 'group';
      granteeId: string;
    }): Promise<string> {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { name: `masked-${Math.random().toString(36).slice(2)}`, permissionMask: mask },
      });
      expect(res.statusCode).toBe(201);
      return (res.json() as { body: { id: string } }).body.id;
    }

    it('creating a resource inside a masked folder grants the mask to the grantee', async () => {
      const owner = await registerAndUnlock('mask-create-owner');
      const grantee = await registerAndUnlock('mask-create-grantee');
      const folderId = await makeMaskedFolder(owner.accessToken, {
        level: 'read',
        granteeType: 'user',
        granteeId: grantee.userId,
      });

      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${owner.accessToken}` },
        payload: { ...basePayload(), folderId },
      });
      expect(createRes.statusCode).toBe(201);
      const id = (createRes.json() as { body: { id: string } }).body.id;

      const getRes = await server.inject({
        method: 'GET',
        url: `/api/v1/resources/${id}`,
        headers: { authorization: `Bearer ${grantee.accessToken}` },
      });
      expect(getRes.statusCode).toBe(200);

      // Read-level mask: grantee cannot PATCH.
      const patchRes = await server.inject({
        method: 'PATCH',
        url: `/api/v1/resources/${id}`,
        headers: { authorization: `Bearer ${grantee.accessToken}` },
        payload: { name: 'nope' },
      });
      expect(patchRes.statusCode).toBe(403);
    });

    it('moving a resource into a masked folder (PATCH folderId) grants the mask to the grantee', async () => {
      const owner = await registerAndUnlock('mask-move-owner');
      const grantee = await registerAndUnlock('mask-move-grantee');
      const folderId = await makeMaskedFolder(owner.accessToken, {
        level: 'update',
        granteeType: 'user',
        granteeId: grantee.userId,
      });

      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${owner.accessToken}` },
        payload: basePayload(),
      });
      const id = (createRes.json() as { body: { id: string } }).body.id;

      const before = await server.inject({
        method: 'GET',
        url: `/api/v1/resources/${id}`,
        headers: { authorization: `Bearer ${grantee.accessToken}` },
      });
      expect(before.statusCode).toBe(404);

      const moveRes = await server.inject({
        method: 'PATCH',
        url: `/api/v1/resources/${id}`,
        headers: { authorization: `Bearer ${owner.accessToken}` },
        payload: { folderId },
      });
      expect(moveRes.statusCode).toBe(200);

      const after = await server.inject({
        method: 'PATCH',
        url: `/api/v1/resources/${id}`,
        headers: { authorization: `Bearer ${grantee.accessToken}` },
        payload: { name: 'grantee can update now' },
      });
      expect(after.statusCode).toBe(200);
    });

    it('does not propagate the mask when the mover only has Update (not Owner) on the resource', async () => {
      const owner = await registerAndUnlock('mask-nonowner-owner');
      const mover = await registerAndUnlock('mask-nonowner-mover');
      const grantee = await registerAndUnlock('mask-nonowner-grantee');
      const folderId = await makeMaskedFolder(owner.accessToken, {
        level: 'owner',
        granteeType: 'user',
        granteeId: grantee.userId,
      });

      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${owner.accessToken}` },
        payload: basePayload(),
      });
      const id = (createRes.json() as { body: { id: string } }).body.id;
      await grantPermission('resource', id, mover.userId, 'update', owner.userId);

      const moveRes = await server.inject({
        method: 'PATCH',
        url: `/api/v1/resources/${id}`,
        headers: { authorization: `Bearer ${mover.accessToken}` },
        payload: { folderId },
      });
      expect(moveRes.statusCode).toBe(200);

      const granteeGet = await server.inject({
        method: 'GET',
        url: `/api/v1/resources/${id}`,
        headers: { authorization: `Bearer ${grantee.accessToken}` },
      });
      expect(granteeGet.statusCode).toBe(404);
    });

    it('a folder with no mask does not grant anything on create', async () => {
      const owner = await registerAndUnlock('mask-none-owner');
      const stranger = await registerAndUnlock('mask-none-stranger');

      const folderRes = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${owner.accessToken}` },
        payload: { name: `unmasked-${Math.random().toString(36).slice(2)}` },
      });
      const folderId = (folderRes.json() as { body: { id: string } }).body.id;

      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${owner.accessToken}` },
        payload: { ...basePayload(), folderId },
      });
      const id = (createRes.json() as { body: { id: string } }).body.id;

      const strangerGet = await server.inject({
        method: 'GET',
        url: `/api/v1/resources/${id}`,
        headers: { authorization: `Bearer ${stranger.accessToken}` },
      });
      expect(strangerGet.statusCode).toBe(404);
    });
  });

  // ── Search (BE-003h) ───────────────────────────────────────────────────────

  describe('GET /api/v1/resources?filter[search]=... (BE-003h)', () => {
    it('matches a substring of name, case-insensitively, via the bracket-style filter[search] param', async () => {
      const { accessToken } = await registerAndUnlock('search-name');
      await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { ...basePayload(), name: 'My GitHub Login' },
      });
      await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { ...basePayload(), name: 'Bank Account' },
      });

      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/resources?filter[search]=github',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(200);
      const names = (res.json() as { body: { data: Array<{ name: string }> } }).body.data.map(
        (r) => r.name,
      );
      expect(names).toEqual(['My GitHub Login']);
    });

    it('matches a substring of username or uri', async () => {
      const { accessToken } = await registerAndUnlock('search-metadata');
      await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { ...basePayload(), name: 'Entry A', username: 'octocat', uri: 'https://a.example.test' },
      });
      await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { ...basePayload(), name: 'Entry B', username: 'someone-else', uri: 'https://b.example.test' },
      });

      const byUsername = await server.inject({
        method: 'GET',
        url: '/api/v1/resources?filter[search]=octocat',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(
        (byUsername.json() as { body: { data: Array<{ name: string }> } }).body.data.map((r) => r.name),
      ).toEqual(['Entry A']);

      const byUri = await server.inject({
        method: 'GET',
        url: `/api/v1/resources?${encodeURIComponent('filter[search]')}=${encodeURIComponent('b.example.test')}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(
        (byUri.json() as { body: { data: Array<{ name: string }> } }).body.data.map((r) => r.name),
      ).toEqual(['Entry B']);
    });

    it('also works via the array-style filter[]=search:<term> form', async () => {
      const { accessToken } = await registerAndUnlock('search-array-form');
      await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { ...basePayload(), name: 'Unique Marker Xyzzy' },
      });

      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/resources?${encodeURIComponent('filter[]')}=${encodeURIComponent('search:Xyzzy')}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const names = (res.json() as { body: { data: Array<{ name: string }> } }).body.data.map(
        (r) => r.name,
      );
      expect(names).toEqual(['Unique Marker Xyzzy']);
    });

    it('does not match resources outside the search term, and returns empty (not an error) for no matches', async () => {
      const { accessToken } = await registerAndUnlock('search-no-match');
      await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { ...basePayload(), name: 'Something' },
      });

      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/resources?filter[search]=nonexistent-term-zzz',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { body: { data: unknown[] } }).body.data).toEqual([]);
    });

    it('treats a literal "%" in the search term as literal text, not a SQL LIKE wildcard', async () => {
      const { accessToken } = await registerAndUnlock('search-escape');
      await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { ...basePayload(), name: '100% Uptime' },
      });
      await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { ...basePayload(), name: 'Something Else Entirely' },
      });

      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/resources?${encodeURIComponent('filter[search]')}=${encodeURIComponent('100%')}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const names = (res.json() as { body: { data: Array<{ name: string }> } }).body.data.map(
        (r) => r.name,
      );
      expect(names).toEqual(['100% Uptime']);
    });

    it('does not search plaintext metadata for a metadataEncrypted resource (only name is searchable)', async () => {
      const { accessToken } = await registerAndUnlock('search-encrypted');
      const fakeMetaB64 = Buffer.from('opaque-encrypted-metadata').toString('base64');
      await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          ...basePayload(),
          name: 'Encrypted Entry',
          metadataEncrypted: true,
          metadataCiphertext: fakeMetaB64,
          metadataIv: FAKE_IV_B64,
          metadataTag: FAKE_TAG_B64,
          username: 'plaintext-was-never-persisted',
        },
      });

      // Searching for the plaintext username that was supplied at create
      // time finds nothing — it was never persisted (metadataEncrypted).
      const byUsername = await server.inject({
        method: 'GET',
        url: '/api/v1/resources?filter[search]=plaintext-was-never-persisted',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect((byUsername.json() as { body: { data: unknown[] } }).body.data).toEqual([]);

      // The name is always plaintext, so it's still searchable.
      const byName = await server.inject({
        method: 'GET',
        url: '/api/v1/resources?filter[search]=Encrypted Entry',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const names = (byName.json() as { body: { data: Array<{ name: string }> } }).body.data.map(
        (r) => r.name,
      );
      expect(names).toEqual(['Encrypted Entry']);
    });

    it("only searches the caller's own vault (LIST scoping unchanged)", async () => {
      const a = await registerAndUnlock('search-scope-a');
      const b = await registerAndUnlock('search-scope-b');
      await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${a.accessToken}` },
        payload: { ...basePayload(), name: 'Shared Term Marker' },
      });
      await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${b.accessToken}` },
        payload: { ...basePayload(), name: 'Shared Term Marker' },
      });

      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/resources?filter[search]=Shared Term Marker',
        headers: { authorization: `Bearer ${a.accessToken}` },
      });
      expect((res.json() as { body: { data: unknown[] } }).body.data).toHaveLength(1);
    });
  });
});
