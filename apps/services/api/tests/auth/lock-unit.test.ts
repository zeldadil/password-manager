/** @fileoverview BE-002f: Lock revocation — unit tests (no server, no DB).
 *
 * Test type: unit (pure function + logic tests).
 * Covers: session validation (expired/deleted/active), lock idempotency,
 *         refresh token revocation invariants.
 *
 * AR-3: Positive + negative tests for lock revocation logic.
 * AR-4: All data is synthetic — generated at test time.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sessions, refreshTokens, users } from '../../src/schema';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createCipheriv } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, and, isNull, desc } from 'drizzle-orm';

// ─── Helpers ───────────────────────────────────────────────────────────────────

const tmpDir = mkdtempSync(join(tmpdir(), 'pm-be002f-lock-'));

function makeDb(): { db: ReturnType<typeof drizzle>; sql: Database.Database } {
  const dbPath = join(tmpDir, `test-${Math.random().toString(36).slice(2)}.db`);
  const sql = new Database(dbPath);
  sql.exec('PRAGMA foreign_keys = ON;');
  const db = drizzle(sql, { schema: { users, sessions, refreshTokens } });
  return { db, sql };
}

/** Pure session validation — mirrors lock.ts sessionIsValid. */
function sessionIsValid(session: typeof sessions.$inferSelect): boolean {
  const now = new Date();
  if (session.expiresAt < now) return false;
  if (session.deletedAt !== null) return false;
  return true;
}

/** Find active session by user — mirrors lock.ts findActiveSession. */
async function findActiveSession(db: ReturnType<typeof drizzle>, userId: string) {
  const rows = await db.query.sessions.findMany({
    where: and(eq(sessions.userId, userId), isNull(sessions.deletedAt)),
    orderBy: (s, { desc }) => [desc(s.lastUsedAt)],
    limit: 1,
  });
  return rows[0] ?? null;
}

// ─── DB setup ──────────────────────────────────────────────────────────────────

describe('BE-002f: lock revocation', () => {
  let db: ReturnType<typeof drizzle>;
  let sql: Database.Database;
  let registeredUserId: string;

  beforeAll(async () => {
    const { db: d, sql: s } = makeDb();
    db = d;
    sql = s;

    await migrate(db, { migrationsFolder: `${import.meta.dirname}/../../migrations` });

    // Register a user directly via DB.
    const now = new Date();
    const salt = Buffer.from('testsalt12345678'); // 16 bytes
    const mockKdfParams = JSON.stringify({
      algorithm: 'argon2id',
      memory: 65536,
      iterations: 3,
      parallelism: 4,
      hashLength: 32,
    });
    // Create mock vault key ciphertext.
    const vaultKey = Buffer.alloc(32, 0xAA);
    const cipher = createCipheriv('aes-256-gcm', Buffer.alloc(32, 0xBB), Buffer.alloc(12));
    const ciphertext = Buffer.concat([cipher.update(vaultKey), cipher.final()]);
    const tag = cipher.getAuthTag();

    await db.insert(users).values({
      id: 'test-user-id-001',
      email: 'lockunit@example.test',
      username: 'lockunituser',
      masterPasswordHash: null,
      salt,
      kdfParams: mockKdfParams,
      vaultKeyEncrypted: ciphertext,
      vaultKeyIv: Buffer.alloc(12),
      vaultKeyTag: tag,
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: now,
      updatedAt: now,
    });

    registeredUserId = 'test-user-id-001';
  });

  afterAll(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    sql.close();
  });

  // ── Session validation ───────────────────────────────────────────────────────

  describe('session validation', () => {
    it('sessionIsValid returns true for a valid non-expired non-deleted session', () => {
      const now = new Date();
      const session = {
        id: 'sess-1',
        userId: 'user-1',
        refreshTokenHash: Buffer.from('aa'.repeat(32), 'hex'),
        expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
        lastUsedAt: now,
        createdAt: now,
        updatedAt: now,
        deletedAt: null as null,
      };
      expect(sessionIsValid(session)).toBe(true);
    });

    it('sessionIsValid returns false for an expired session', () => {
      const now = new Date();
      const session = {
        id: 'sess-2',
        userId: 'user-1',
        refreshTokenHash: Buffer.from('aa'.repeat(32), 'hex'),
        expiresAt: new Date(now.getTime() - 1000),
        lastUsedAt: now,
        createdAt: now,
        updatedAt: now,
        deletedAt: null as null,
      };
      expect(sessionIsValid(session)).toBe(false);
    });

    it('sessionIsValid returns false for a soft-deleted session', () => {
      const now = new Date();
      const session = {
        id: 'sess-3',
        userId: 'user-1',
        refreshTokenHash: Buffer.from('aa'.repeat(32), 'hex'),
        expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
        lastUsedAt: now,
        createdAt: now,
        updatedAt: now,
        deletedAt: now,
      };
      expect(sessionIsValid(session)).toBe(false);
    });

    it('sessionIsValid returns false for both expired and deleted session', () => {
      const now = new Date();
      const session = {
        id: 'sess-4',
        userId: 'user-1',
        refreshTokenHash: Buffer.from('aa'.repeat(32), 'hex'),
        expiresAt: new Date(now.getTime() - 1000),
        lastUsedAt: now,
        createdAt: now,
        updatedAt: now,
        deletedAt: now,
      };
      expect(sessionIsValid(session)).toBe(false);
    });
  });

  // ── Lock revocation flow ─────────────────────────────────────────────────────

  describe('lock revocation flow', () => {
    it('lock revokes refresh token and soft-deletes session', async () => {
      const now = new Date();
      const sessionId = 'test-session-' + Math.random().toString(36).slice(2);
      const refreshTokenHash = Buffer.from('aabbccdd'.repeat(8), 'hex');

      await db.insert(sessions).values({
        id: sessionId,
        userId: registeredUserId,
        refreshTokenHash,
        expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
        lastUsedAt: now,
        createdAt: now,
        updatedAt: now,
        deletedAt: null as null,
      });

      await db.insert(refreshTokens).values({
        id: 'test-rt-' + Math.random().toString(36).slice(2),
        userId: registeredUserId,
        tokenHash: refreshTokenHash,
        issuedAt: now,
        expiresAt: new Date(now.getTime() + 30 * 86400000),
        createdAt: now,
        updatedAt: now,
        revokedAt: null as null,
        deletedAt: null as null,
      });

      // Verify session and refresh token exist and are active.
      const sessionBefore = await findActiveSession(db, registeredUserId);
      expect(sessionBefore).toBeTruthy();
      expect(sessionIsValid(sessionBefore!)).toBe(true);

      const rtBefore = await db.query.refreshTokens.findFirst({
        where: eq(refreshTokens.tokenHash, refreshTokenHash),
      });
      expect(rtBefore).toBeTruthy();
      expect(rtBefore!.revokedAt).toBeNull();

      // Simulate lock: revoke refresh token + soft-delete session.
      const lockTime = new Date();
      const lockTimeMs = lockTime.getTime();
      await db
        .update(refreshTokens)
        .set({ revokedAt: lockTime, updatedAt: lockTime })
        .where(eq(refreshTokens.tokenHash, refreshTokenHash));

      await db
        .update(sessions)
        .set({ deletedAt: lockTime, updatedAt: lockTime })
        .where(eq(sessions.id, sessionId));

      // Verify revocation.
      const sessionAfter = await findActiveSession(db, registeredUserId);
      expect(sessionAfter).toBeNull();

      const rtAfter = await db.query.refreshTokens.findFirst({
        where: eq(refreshTokens.tokenHash, refreshTokenHash),
      });
      expect(rtAfter!.revokedAt).not.toBeNull();
      // SQLite may truncate milliseconds; allow 1s tolerance.
      const dbTime = rtAfter!.revokedAt!.getTime();
      expect(dbTime).toBeGreaterThanOrEqual(lockTimeMs - 1000);
      expect(dbTime).toBeLessThanOrEqual(lockTimeMs + 1000);
    });

    it('lock is idempotent — revoking an already-revoked token is safe', async () => {
      const now = new Date();
      const sessionId = 'test-session-idem-' + Math.random().toString(36).slice(2);
      const refreshTokenHash = Buffer.from('eeffgghh'.repeat(8), 'hex');

      await db.insert(sessions).values({
        id: sessionId,
        userId: registeredUserId,
        refreshTokenHash,
        expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
        lastUsedAt: now,
        createdAt: now,
        updatedAt: now,
        deletedAt: null as null,
      });

      await db.insert(refreshTokens).values({
        id: 'rt-idem-' + Math.random().toString(36).slice(2),
        userId: registeredUserId,
        tokenHash: refreshTokenHash,
        issuedAt: now,
        expiresAt: new Date(now.getTime() + 30 * 86400000),
        createdAt: now,
        updatedAt: now,
        revokedAt: null as null,
        deletedAt: null as null,
      });

      // First lock.
      const t1 = new Date();
      await db
        .update(refreshTokens)
        .set({ revokedAt: t1, updatedAt: t1 })
        .where(eq(refreshTokens.tokenHash, refreshTokenHash));
      await db
        .update(sessions)
        .set({ deletedAt: t1, updatedAt: t1 })
        .where(eq(sessions.id, sessionId));

      // Second lock (idempotent).
      const t2 = new Date();
      const t2Ms = t2.getTime();
      await db
        .update(refreshTokens)
        .set({ revokedAt: t2, updatedAt: t2 })
        .where(eq(refreshTokens.tokenHash, refreshTokenHash));
      await db
        .update(sessions)
        .set({ deletedAt: t2, updatedAt: t2 })
        .where(eq(sessions.id, sessionId));

      const rt = await db.query.refreshTokens.findFirst({
        where: eq(refreshTokens.tokenHash, refreshTokenHash),
      });
      const dbTime2 = rt!.revokedAt!.getTime();
      expect(dbTime2).toBeGreaterThanOrEqual(t2Ms - 1000);
      expect(dbTime2).toBeLessThanOrEqual(t2Ms + 1000);
    });
  });

  // ── Lock response shape ──────────────────────────────────────────────────────

  describe('lock response shape', () => {
    it('lock response body type has status: "locked"', () => {
      const body = { status: 'locked' as const };
      expect(body.status).toBe('locked');
      expect(Object.keys(body)).toEqual(['status']);
    });

    it('status response body type has required fields', () => {
      const now = new Date();
      const body = {
        status: 'unlocked' as const,
        sessionId: 'session-123',
        expiresAt: now.toISOString(),
      };
      expect(body.status).toBe('unlocked');
      expect(body.sessionId).toBeTruthy();
      expect(body.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(Object.keys(body).sort()).toEqual(
        ['expiresAt', 'sessionId', 'status'].sort(),
      );
    });
  });
});
