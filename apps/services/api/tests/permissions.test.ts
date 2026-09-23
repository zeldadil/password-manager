/** @fileoverview BE-003f: Permission resolution service — unit tests.
 *
 * Test type: unit (no server — direct DB + service calls).
 * Covers AC1 (permissions table shape, already verified by
 * migration.test.ts) is not re-tested here; this file covers AC2's
 * resolution logic: ownership, direct grants, group grants, the level
 * hierarchy, and — the regression this file exists to guard — that the
 * HIGHEST applicable level wins regardless of how many grant rows exist
 * or what order they were inserted in (a naive `ORDER BY level DESC`
 * sorts the level TEXT column alphabetically, which is not level order:
 * "update" > "read" > "owner" alphabetically, the opposite of the real
 * hierarchy for the owner case).
 *
 * AR-3: Positive + negative tests.
 * AR-4: All data is synthetic, generated at test time.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as schema from '../src/schema';
import {
  resolvePermissionLevel,
  hasPermission,
  requirePermission,
  applyFolderPermissionMask,
  levelMeets,
  PERMISSION_VALUES,
  type PermissionLevel,
} from '../src/services/permissions';

const tmpDir = mkdtempSync(join(tmpdir(), 'pm-be003f-'));
const dbPath = join(tmpDir, 'test.db');

describe('BE-003f: permission resolution service', () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let sql: Database.Database;

  let ownerId: string;
  let vaultId: string;
  let folderId: string;
  let resourceId: string;

  async function makeUser(): Promise<string> {
    const id = randomUUID();
    const now = new Date();
    await db.insert(schema.users).values({
      id,
      email: `${id}@example.test`,
      username: `u${id.slice(0, 8)}`,
      salt: Buffer.alloc(16),
      kdfParams: '{}',
      vaultKeyEncrypted: Buffer.alloc(16),
      vaultKeyIv: Buffer.alloc(12),
      vaultKeyTag: Buffer.alloc(16),
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  async function grant(
    targetType: 'resource' | 'folder',
    targetId: string,
    granteeType: 'user' | 'group',
    granteeId: string,
    level: PermissionLevel,
    grantedBy: string,
  ): Promise<void> {
    const now = new Date();
    await db.insert(schema.permissions).values({
      id: randomUUID(),
      targetType,
      targetId,
      granteeType,
      granteeId,
      level,
      grantedBy,
      createdAt: now,
      updatedAt: now,
    });
  }

  beforeAll(async () => {
    const setupDb = new Database(dbPath);
    setupDb.exec('PRAGMA foreign_keys = ON;');
    const migratedDb = drizzle(setupDb, { schema });
    migrate(migratedDb, { migrationsFolder: `${import.meta.dirname}/../migrations` });
    setupDb.close();

    sql = new Database(dbPath);
    sql.exec('PRAGMA foreign_keys = ON;');
    db = drizzle(sql, { schema });

    ownerId = await makeUser();
    const now = new Date();
    vaultId = randomUUID();
    await db.insert(schema.vaults).values({
      id: vaultId,
      ownerId,
      name: 'Test Vault',
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    folderId = randomUUID();
    await db.insert(schema.folders).values({
      id: folderId,
      vaultId,
      ownerId,
      name: 'Test Folder',
      parentId: null,
      createdAt: now,
      updatedAt: now,
    });

    resourceId = randomUUID();
    await db.insert(schema.resources).values({
      id: resourceId,
      vaultId,
      ownerId,
      name: 'Test Resource',
      type: 'password-and-description',
      secretCiphertext: Buffer.alloc(16),
      secretIv: Buffer.alloc(12),
      secretTag: Buffer.alloc(16),
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(() => {
    sql.close();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  // ── levelMeets (pure function) ────────────────────────────────────────────

  describe('levelMeets', () => {
    it('owner meets every level', () => {
      expect(levelMeets('owner', 'owner')).toBe(true);
      expect(levelMeets('owner', 'update')).toBe(true);
      expect(levelMeets('owner', 'read')).toBe(true);
    });

    it('update meets update and read, not owner', () => {
      expect(levelMeets('update', 'owner')).toBe(false);
      expect(levelMeets('update', 'update')).toBe(true);
      expect(levelMeets('update', 'read')).toBe(true);
    });

    it('read meets only read', () => {
      expect(levelMeets('read', 'owner')).toBe(false);
      expect(levelMeets('read', 'update')).toBe(false);
      expect(levelMeets('read', 'read')).toBe(true);
    });

    it('PERMISSION_VALUES preserves the Passbolt-inspired ordering', () => {
      expect(PERMISSION_VALUES.read).toBeLessThan(PERMISSION_VALUES.update);
      expect(PERMISSION_VALUES.update).toBeLessThan(PERMISSION_VALUES.owner);
    });
  });

  // ── Ownership ────────────────────────────────────────────────────────────

  describe('resolvePermissionLevel — ownership', () => {
    it('the owner resolves to owner level on their own resource', async () => {
      const level = await resolvePermissionLevel({
        db,
        userId: ownerId,
        targetType: 'resource',
        targetId: resourceId,
      });
      expect(level).toBe('owner');
    });

    it('the owner resolves to owner level on their own folder', async () => {
      const level = await resolvePermissionLevel({
        db,
        userId: ownerId,
        targetType: 'folder',
        targetId: folderId,
      });
      expect(level).toBe('owner');
    });

    it('a stranger with no grant resolves to null', async () => {
      const strangerId = await makeUser();
      const level = await resolvePermissionLevel({
        db,
        userId: strangerId,
        targetType: 'resource',
        targetId: resourceId,
      });
      expect(level).toBeNull();
    });
  });

  // ── Direct (user) grants ─────────────────────────────────────────────────

  describe('resolvePermissionLevel — direct user grants', () => {
    it('a user with a read grant resolves to read', async () => {
      const granteeId = await makeUser();
      await grant('resource', resourceId, 'user', granteeId, 'read', ownerId);

      const level = await resolvePermissionLevel({
        db,
        userId: granteeId,
        targetType: 'resource',
        targetId: resourceId,
      });
      expect(level).toBe('read');
    });

    it('a user with an update grant resolves to update', async () => {
      const granteeId = await makeUser();
      await grant('folder', folderId, 'user', granteeId, 'update', ownerId);

      const level = await resolvePermissionLevel({
        db,
        userId: granteeId,
        targetType: 'folder',
        targetId: folderId,
      });
      expect(level).toBe('update');
    });

    it(
      'REGRESSION: with multiple grant rows for the same user+target, the ' +
        'HIGHEST level wins, not the alphabetically-last one ("update" > ' +
        '"read" > "owner" alphabetically — the opposite of level order)',
      async () => {
        const granteeId = await makeUser();
        // Insert read first, then owner — if a buggy implementation used
        // `ORDER BY level DESC LIMIT 1` on the TEXT column, "update" would
        // sort ahead of "owner" and "read" would sort ahead of "owner" too
        // (alphabetically 'r' > 'o'), so a naive query could easily return
        // 'read' here instead of the correct 'owner'.
        await grant('resource', resourceId, 'user', granteeId, 'read', ownerId);
        await grant('resource', resourceId, 'user', granteeId, 'owner', ownerId);

        const level = await resolvePermissionLevel({
          db,
          userId: granteeId,
          targetType: 'resource',
          targetId: resourceId,
        });
        expect(level).toBe('owner');
      },
    );

    it('a soft-deleted grant is not honored', async () => {
      const granteeId = await makeUser();
      const grantId = randomUUID();
      const now = new Date();
      await db.insert(schema.permissions).values({
        id: grantId,
        targetType: 'resource',
        targetId: resourceId,
        granteeType: 'user',
        granteeId,
        level: 'owner',
        grantedBy: ownerId,
        createdAt: now,
        updatedAt: now,
        deletedAt: now,
      });

      const level = await resolvePermissionLevel({
        db,
        userId: granteeId,
        targetType: 'resource',
        targetId: resourceId,
      });
      expect(level).toBeNull();
    });
  });

  // ── Group grants ─────────────────────────────────────────────────────────

  describe('resolvePermissionLevel — group grants', () => {
    async function makeGroup(): Promise<string> {
      const id = randomUUID();
      const now = new Date();
      await db.insert(schema.groups).values({
        id,
        ownerId,
        name: `group-${id.slice(0, 8)}`,
        createdAt: now,
        updatedAt: now,
      });
      return id;
    }

    async function addMember(groupId: string, userId: string): Promise<void> {
      const now = new Date();
      await db.insert(schema.groupMembers).values({
        id: randomUUID(),
        groupId,
        userId,
        isAdmin: false,
        createdAt: now,
        updatedAt: now,
      });
    }

    it('a group member resolves to the level granted to their group', async () => {
      const memberId = await makeUser();
      const groupId = await makeGroup();
      await addMember(groupId, memberId);
      await grant('resource', resourceId, 'group', groupId, 'update', ownerId);

      const level = await resolvePermissionLevel({
        db,
        userId: memberId,
        targetType: 'resource',
        targetId: resourceId,
      });
      expect(level).toBe('update');
    });

    it('REGRESSION: the highest level across multiple group memberships wins', async () => {
      const memberId = await makeUser();
      const groupA = await makeGroup();
      const groupB = await makeGroup();
      await addMember(groupA, memberId);
      await addMember(groupB, memberId);
      await grant('folder', folderId, 'group', groupA, 'read', ownerId);
      await grant('folder', folderId, 'group', groupB, 'owner', ownerId);

      const level = await resolvePermissionLevel({
        db,
        userId: memberId,
        targetType: 'folder',
        targetId: folderId,
      });
      expect(level).toBe('owner');
    });

    it('non-members of the granted group get no access from it', async () => {
      const nonMemberId = await makeUser();
      const groupId = await makeGroup();
      await grant('resource', resourceId, 'group', groupId, 'owner', ownerId);

      const level = await resolvePermissionLevel({
        db,
        userId: nonMemberId,
        targetType: 'resource',
        targetId: resourceId,
      });
      expect(level).toBeNull();
    });

    it('direct grant and group grant combine to the higher of the two', async () => {
      const memberId = await makeUser();
      const groupId = await makeGroup();
      await addMember(groupId, memberId);
      await grant('resource', resourceId, 'user', memberId, 'read', ownerId);
      await grant('resource', resourceId, 'group', groupId, 'update', ownerId);

      const level = await resolvePermissionLevel({
        db,
        userId: memberId,
        targetType: 'resource',
        targetId: resourceId,
      });
      expect(level).toBe('update');
    });
  });

  // ── hasPermission ────────────────────────────────────────────────────────

  describe('hasPermission', () => {
    it('returns true when the level is sufficient', async () => {
      const ok = await hasPermission(
        { db, userId: ownerId, targetType: 'resource', targetId: resourceId },
        'owner',
      );
      expect(ok).toBe(true);
    });

    it('returns false when there is no access at all', async () => {
      const strangerId = await makeUser();
      const ok = await hasPermission(
        { db, userId: strangerId, targetType: 'resource', targetId: resourceId },
        'read',
      );
      expect(ok).toBe(false);
    });

    it('returns false when access exists but is below the required level', async () => {
      const granteeId = await makeUser();
      await grant('resource', resourceId, 'user', granteeId, 'read', ownerId);

      const ok = await hasPermission(
        { db, userId: granteeId, targetType: 'resource', targetId: resourceId },
        'update',
      );
      expect(ok).toBe(false);
    });
  });

  // ── requirePermission (throws) ───────────────────────────────────────────

  describe('requirePermission', () => {
    it('resolves without throwing when access is sufficient', async () => {
      await expect(
        requirePermission(
          { db, userId: ownerId, targetType: 'resource', targetId: resourceId },
          'owner',
        ),
      ).resolves.toBeUndefined();
    });

    it('throws a 404 when the user has no access at all', async () => {
      const strangerId = await makeUser();
      await expect(
        requirePermission(
          { db, userId: strangerId, targetType: 'resource', targetId: resourceId },
          'read',
        ),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('throws a 403 when the user has some access below the required level', async () => {
      const granteeId = await makeUser();
      await grant('folder', folderId, 'user', granteeId, 'read', ownerId);

      await expect(
        requirePermission(
          { db, userId: granteeId, targetType: 'folder', targetId: folderId },
          'update',
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
    });
  });

  // ── applyFolderPermissionMask (BE-003g) ─────────────────────────────────

  describe('applyFolderPermissionMask', () => {
    async function makeResourceFor(owner: string): Promise<string> {
      const id = randomUUID();
      const now = new Date();
      await db.insert(schema.resources).values({
        id,
        vaultId,
        ownerId: owner,
        name: 'Mask Test Resource',
        type: 'password-and-description',
        secretCiphertext: Buffer.alloc(16),
        secretIv: Buffer.alloc(12),
        secretTag: Buffer.alloc(16),
        createdAt: now,
        updatedAt: now,
      });
      return id;
    }

    async function makeFolderWithMask(
      owner: string,
      mask: { level: PermissionLevel; granteeType: 'user' | 'group'; granteeId: string } | null,
    ): Promise<string> {
      const id = randomUUID();
      const now = new Date();
      await db.insert(schema.folders).values({
        id,
        vaultId,
        ownerId: owner,
        name: 'Mask Test Folder',
        parentId: null,
        permissionMaskLevel: mask?.level ?? null,
        permissionMaskGranteeType: mask?.granteeType ?? null,
        permissionMaskGranteeId: mask?.granteeId ?? null,
        createdAt: now,
        updatedAt: now,
      });
      return id;
    }

    it('copies the mask onto the resource when the acting user is Owner', async () => {
      const grantee = await makeUser();
      const maskedFolder = await makeFolderWithMask(ownerId, {
        level: 'read',
        granteeType: 'user',
        granteeId: grantee,
      });
      const resource = await makeResourceFor(ownerId);

      await applyFolderPermissionMask(db, resource, maskedFolder, ownerId);

      const level = await resolvePermissionLevel({
        db,
        userId: grantee,
        targetType: 'resource',
        targetId: resource,
      });
      expect(level).toBe('read');
    });

    it('does nothing when the folder has no mask', async () => {
      const maskless = await makeFolderWithMask(ownerId, null);
      const resource = await makeResourceFor(ownerId);
      const grantee = await makeUser();

      await applyFolderPermissionMask(db, resource, maskless, ownerId);

      const level = await resolvePermissionLevel({
        db,
        userId: grantee,
        targetType: 'resource',
        targetId: resource,
      });
      expect(level).toBeNull();
    });

    it('does nothing when folderId is null (not moved into any folder)', async () => {
      const resource = await makeResourceFor(ownerId);
      await expect(applyFolderPermissionMask(db, resource, null, ownerId)).resolves.toBeUndefined();
    });

    it('does NOT apply the mask when the acting user only has Update on the resource ("where possible")', async () => {
      const updater = await makeUser();
      const grantee = await makeUser();
      const maskedFolder = await makeFolderWithMask(ownerId, {
        level: 'owner',
        granteeType: 'user',
        granteeId: grantee,
      });
      const resource = await makeResourceFor(ownerId);
      await grant('resource', resource, 'user', updater, 'update', ownerId);

      await applyFolderPermissionMask(db, resource, maskedFolder, updater);

      const level = await resolvePermissionLevel({
        db,
        userId: grantee,
        targetType: 'resource',
        targetId: resource,
      });
      expect(level).toBeNull();
    });

    it('is idempotent — applying the same mask twice does not create duplicate grant rows', async () => {
      const grantee = await makeUser();
      const maskedFolder = await makeFolderWithMask(ownerId, {
        level: 'update',
        granteeType: 'user',
        granteeId: grantee,
      });
      const resource = await makeResourceFor(ownerId);

      await applyFolderPermissionMask(db, resource, maskedFolder, ownerId);
      await applyFolderPermissionMask(db, resource, maskedFolder, ownerId);

      const rows = await db.query.permissions.findMany({
        where: (p, { eq: eqOp, and: andOp, isNull: isNullOp }) =>
          andOp(
            eqOp(p.targetType, 'resource'),
            eqOp(p.targetId, resource),
            eqOp(p.granteeType, 'user'),
            eqOp(p.granteeId, grantee),
            isNullOp(p.deletedAt),
          ),
      });
      expect(rows).toHaveLength(1);
    });
  });
});
