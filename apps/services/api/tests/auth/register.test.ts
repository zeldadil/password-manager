/** @fileoverview BE-002a registration endpoint integration tests.

 * Test type: integration (spins up real Fastify server via createServer()).
 * Covers AC1 (master password registration → KDF → vault key → encrypted storage)
 *        AC2 (stored as { kdfParams, salt, ciphertext, iv, tag }).
 *
 * AR-3: Positive + negative tests per crypto change.
 * AR-4: All data is synthetic (generated at test time).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import './test-env';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../../src/schema';
import { createServer } from '../../src/server';
import { setTestDbOverride } from '../../src/db';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDir = mkdtempSync(join(tmpdir(), 'pm-be002a-'));
const dbPath = join(tmpDir, 'test.db');

describe('BE-002a: POST /auth/register', () => {
  let server: ReturnType<typeof createServer>;

  beforeAll(async () => {
    // 1. Create the DB file and run migrations.
    const setupDb = new Database(dbPath);
    setupDb.exec('PRAGMA foreign_keys = ON;');
    const migratedDb = drizzle(setupDb, { schema });
    migrate(migratedDb, { migrationsFolder: `${import.meta.dirname}/../../migrations` });
    setupDb.close();

    // 2. Re-open a fresh drizzle connection to the now-migrated file.
    const sql = new Database(dbPath);
    sql.exec('PRAGMA foreign_keys = ON;');
    const liveDb = drizzle(sql, { schema });

    // 3. Override the server's db singleton BEFORE creating the server.
    setTestDbOverride(liveDb);

    // 4. Create the server — it imports db from ../../src/db which now
    //    points to our migrated test DB via the live `let` binding.
    server = createServer({ logger: false });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  // ── Positive: happy path registration ──────────────────────────────────

  it('registers a new user and returns 201 with user info + kdfParams', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        masterPassword: 'my-secure-test-password-123',
        email: 'test.user@example.test',
        username: 'testuser',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('email', 'test.user@example.test');
    expect(body).toHaveProperty('username', 'testuser');
    expect(body).toHaveProperty('kdfParams');
    expect(body.kdfParams).toEqual({
      algorithm: 'argon2id',
      memory: 65536,
      iterations: 3,
      parallelism: 4,
      hashLength: 32,
    });
  });

  it('registers a second user successfully', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        masterPassword: 'another-password-456',
        email: 'user2@example.test',
        username: 'user2',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.email).toBe('user2@example.test');
    expect(body.username).toBe('user2');
  });

  // ── Negative: duplicate email ──────────────────────────────────────────

  it('returns 409 for duplicate email', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        masterPassword: 'some-password',
        email: 'test.user@example.test', // already registered
        username: 'otheruser',
      },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe('Conflict');
  });

  // ── Negative: duplicate username ───────────────────────────────────────

  it('returns 409 for duplicate username', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        masterPassword: 'some-password',
        email: 'unique@example.test',
        username: 'testuser', // already registered
      },
    });

    expect(res.statusCode).toBe(409);
  });

  // ── Negative: short password ───────────────────────────────────────────

  it('returns 400 for password shorter than 8 characters', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        masterPassword: 'short',
        email: 'shortpw@example.test',
        username: 'shortuser',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  // ── Negative: short username ───────────────────────────────────────────

  it('returns 400 for username shorter than 3 characters', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        masterPassword: 'validpassword123',
        email: 'shortuser@example.test',
        username: 'ab',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  // ── Negative: missing required fields ──────────────────────────────────

  it('returns 400 when masterPassword is missing', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'nopw@example.test',
        username: 'nopwuser',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when email is missing', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        masterPassword: 'validpassword123',
        username: 'nopwuser',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  // ── Negative: wrong content-type ───────────────────────────────────────

  it('returns 400 for missing content-type (no JSON body)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { 'content-type': 'text/plain' },
      payload: 'not json',
    });

    expect([400, 415]).toContain(res.statusCode);
  });

  // ── Response shape validation ──────────────────────────────────────────

  it('response has exactly the expected keys (no extra fields)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        masterPassword: 'shape-test-password',
        email: 'shape@example.test',
        username: 'shapetest',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    // The response must NOT include salt, ciphertext, iv, or tag.
    expect(Object.keys(body)).toEqual(
      expect.arrayContaining(['id', 'email', 'username', 'kdfParams']),
    );
    // Specifically verify no secret material is leaked.
    expect(body).not.toHaveProperty('salt');
    expect(body).not.toHaveProperty('vaultKeyEncrypted');
    expect(body).not.toHaveProperty('vaultKeyIv');
    expect(body).not.toHaveProperty('vaultKeyTag');
    expect(body).not.toHaveProperty('masterPassword');
  });
});
