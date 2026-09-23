/**
 * BE-003f: Permission resolution service.
 *
 * Resolves the effective permission level for a user on a target entity
 * (resource or folder) using the ACO/ARO permission model defined in
 * ADR-003 §3.5 / §6.1-6.2 and ADR-001 §4-5.
 *
 * ACO (Access Control Object): targetType + targetId
 * ARO (Access Request Object): granteeType + granteeId
 * Level: read | update | owner (numeric 1 | 7 | 15, preserved from
 * Passbolt for conceptual continuity — ADR-003 §3.5 — but the schema
 * stores the enum label, not the number; see PERMISSION_VALUES below).
 *
 * Effective level (ADR-003 §6.1 point 6 / §6.2 point 6): the MAXIMUM of
 *   1. Ownership — user is the entity owner (ownerId match) → 'owner'.
 *   2. Direct grant — permissions row(s) where granteeType=user +
 *      granteeId=userId on this target; highest level across all rows.
 *   3. Group grant — permissions row(s) where granteeType=group and the
 *      user is a member of that group (groupMembers); highest level
 *      across all matching rows.
 * "Highest" is a numeric comparison (PERMISSION_VALUES), not a string
 * sort — SQLite would sort the `level` TEXT column alphabetically
 * ("update" > "read" > "owner"), which is not level order, so the level
 * comparison is done in application code after fetching every candidate
 * row, not via `ORDER BY level DESC LIMIT 1`.
 *
 * The `permissions` table already exists in schema.ts (baseline
 * migration, BE-001b). This module is the resolution + enforcement logic
 * on top of it — BE-003f's actual new work.
 */

import { randomUUID } from 'node:crypto';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import type { Db } from '../db';
import { permissions, resources, folders, groupMembers } from '../schema';
import { httpError } from '../middleware/error-handler';

// ─── Permission level constants ─────────────────────────────────────────────

/** Permission level to numeric value mapping (bitmask-inspired, ADR-003 §3.5). */
export const PERMISSION_VALUES = {
  read: 1,
  update: 7,
  owner: 15,
} as const;

export type PermissionLevel = keyof typeof PERMISSION_VALUES;

function isPermissionLevel(value: string): value is PermissionLevel {
  return value in PERMISSION_VALUES;
}

/** Highest of a set of levels, or null if the set is empty. */
function highestLevel(levels: PermissionLevel[]): PermissionLevel | null {
  if (levels.length === 0) return null;
  return levels.reduce((max, l) =>
    PERMISSION_VALUES[l] > PERMISSION_VALUES[max] ? l : max,
  );
}

// ─── Level comparison ───────────────────────────────────────────────────────

/**
 * Check if `actual` level meets or exceeds `required`.
 * Higher values include lower ones (owner > update > read) — ADR-003
 * §6.1 point 4.
 */
export function levelMeets(actual: PermissionLevel, required: PermissionLevel): boolean {
  return PERMISSION_VALUES[actual] >= PERMISSION_VALUES[required];
}

// ─── Permission resolution ──────────────────────────────────────────────────

export interface PermissionContext {
  db: Db;
  userId: string;
  targetType: 'resource' | 'folder';
  targetId: string;
}

/**
 * Resolve the effective permission level for a user on a target entity.
 *
 * Returns the highest applicable permission level (ADR-003 §6.2 point 6),
 * or null if the user has no access at all (not the owner, no direct
 * grant, no group grant).
 */
export async function resolvePermissionLevel(
  ctx: PermissionContext,
): Promise<PermissionLevel | null> {
  const { db, userId, targetType, targetId } = ctx;

  // 1. Ownership check — owner always has owner-level access (§6.1 pt 1).
  if (targetType === 'resource') {
    const row = await db.query.resources.findFirst({
      where: and(eq(resources.id, targetId), eq(resources.ownerId, userId)),
      columns: { id: true },
    });
    if (row) return 'owner';
  } else {
    const row = await db.query.folders.findFirst({
      where: and(eq(folders.id, targetId), eq(folders.ownerId, userId)),
      columns: { id: true },
    });
    if (row) return 'owner';
  }

  // 2. Direct permission grants for this user on this target — every
  // matching row, not just one, so the highest level wins regardless of
  // insertion order (§6.1 pt 2, §6.2 pt 4).
  const directPerms = await db.query.permissions.findMany({
    where: and(
      eq(permissions.targetType, targetType),
      eq(permissions.targetId, targetId),
      eq(permissions.granteeType, 'user'),
      eq(permissions.granteeId, userId),
      isNull(permissions.deletedAt),
    ),
  });
  const directLevels = directPerms
    .map((p) => p.level)
    .filter(isPermissionLevel);
  const directBest = highestLevel(directLevels);

  // 3. Group-based permissions — every group the user belongs to, every
  // matching grant row, highest level across all of them (§6.1 pt 3,
  // §6.2 pt 5).
  const memberships = await db.query.groupMembers.findMany({
    where: and(eq(groupMembers.userId, userId), isNull(groupMembers.deletedAt)),
    columns: { groupId: true },
  });

  let groupBest: PermissionLevel | null = null;
  if (memberships.length > 0) {
    const groupIds = memberships.map((m) => m.groupId);
    const groupPerms = await db.query.permissions.findMany({
      where: and(
        eq(permissions.targetType, targetType),
        eq(permissions.targetId, targetId),
        eq(permissions.granteeType, 'group'),
        inArray(permissions.granteeId, groupIds),
        isNull(permissions.deletedAt),
      ),
    });
    const groupLevels = groupPerms.map((p) => p.level).filter(isPermissionLevel);
    groupBest = highestLevel(groupLevels);
  }

  // Effective level is the max across all three sources (§6.2 pt 6) —
  // ownership already returned above, so here it's direct vs. group.
  const candidates = [directBest, groupBest].filter(
    (l): l is PermissionLevel => l !== null,
  );
  return highestLevel(candidates);
}

/**
 * Check whether a user has at least the required permission level on a target.
 */
export async function hasPermission(
  ctx: PermissionContext,
  required: PermissionLevel,
): Promise<boolean> {
  const actual = await resolvePermissionLevel(ctx);
  if (!actual) return false;
  return levelMeets(actual, required);
}

/**
 * Require a specific permission level, throwing a typed HTTP error
 * otherwise:
 *   - 404 when the user has NO access at all (not the owner, no grant of
 *     any level) — consistent with this codebase's established "don't
 *     confirm another user's entity exists" behavior (BE-003b/d).
 *   - 403 when the user has SOME access but below the required level —
 *     existence is already implied by the grant they do hold, so there's
 *     nothing to hide by returning 403 instead of 404 here.
 */
export async function requirePermission(
  ctx: PermissionContext,
  required: PermissionLevel,
): Promise<void> {
  const actual = await resolvePermissionLevel(ctx);
  if (!actual) {
    throw httpError(404, `${ctx.targetType} not found`);
  }
  if (!levelMeets(actual, required)) {
    throw httpError(403, 'Not authorized');
  }
}

// ─── Folder permission mask propagation (BE-003g) ───────────────────────────

/**
 * Apply a folder's `permissionMask` (ADR-003 §3.4/§3.5) to a resource at
 * create/move time. "Where possible" propagation (ADR-001 §2, ADR-003 §3.4
 * note, ADR-002 §8.1 item 4): only affects resources the acting user has
 * OWNER permission on — a lesser-privileged move (Update-only) does not
 * grant away access the mover doesn't themselves have Owner control over.
 *
 * No-ops when: the folder doesn't exist, carries no mask, or the acting
 * user is not an Owner of the resource. Idempotent: does not insert a
 * duplicate grant row if an identical (target, grantee, level) permission
 * already exists — repeated moves into the same folder don't pile up
 * redundant rows.
 *
 * Per ADR-003 §3.4: "Folders do not continuously enforce permissions... the
 * mask is applied at create/move time only." This function is the entire
 * implementation of that propagation — callers invoke it once, right after
 * the resource's `folderId` is set, and never re-check it later.
 */
export async function applyFolderPermissionMask(
  db: Db,
  resourceId: string,
  folderId: string | null,
  userId: string,
): Promise<void> {
  if (folderId === null) return;

  const folder = await db.query.folders.findFirst({
    where: and(eq(folders.id, folderId), isNull(folders.deletedAt)),
  });
  if (
    !folder ||
    !folder.permissionMaskLevel ||
    !folder.permissionMaskGranteeType ||
    !folder.permissionMaskGranteeId ||
    !isPermissionLevel(folder.permissionMaskLevel)
  ) {
    return;
  }

  const actual = await resolvePermissionLevel({
    db,
    userId,
    targetType: 'resource',
    targetId: resourceId,
  });
  if (actual !== 'owner') return;

  const granteeType = folder.permissionMaskGranteeType as 'user' | 'group';
  const granteeId = folder.permissionMaskGranteeId;
  const level = folder.permissionMaskLevel;

  const existing = await db.query.permissions.findFirst({
    where: and(
      eq(permissions.targetType, 'resource'),
      eq(permissions.targetId, resourceId),
      eq(permissions.granteeType, granteeType),
      eq(permissions.granteeId, granteeId),
      eq(permissions.level, level),
      isNull(permissions.deletedAt),
    ),
  });
  if (existing) return;

  const now = new Date();
  await db.insert(permissions).values({
    id: randomUUID(),
    targetType: 'resource',
    targetId: resourceId,
    granteeType,
    granteeId,
    level,
    grantedBy: userId,
    createdAt: now,
    updatedAt: now,
  });
}
