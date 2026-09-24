/** @fileoverview BE-003k: Security Tests — resource/folder/permission domain.
 *
 * Test type: security (real Fastify server via createServer(), real
 * migrated SQLite DB) — mirrors the structure of `auth/security.test.ts`
 * (BE-002h) for the BE-003 (resource/folder/permission) domain.
 *
 * Covers the AC:
 *   - Tampered ciphertext rejected
 *   - Unauthorized access denied
 *   - Metadata leakage check
 *   - IV/nonce reuse detection
 *
 * IV/nonce reuse detection lives in packages/crypto/tests/crypto.test.ts
 * (BE-003k addition there) — that's the only layer that generates IVs;
 * nothing in this package does. Not duplicated here.
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

const tmpDir = mkdtempSync(join(tmpdir(), 'pm-be003k-'));
const dbPath = join(tmpDir, 'test.db');

const FAKE_SECRET_B64 = Buffer.from('synthetic-secret-payload-not-real').toString('base64');
const FAKE_IV_B64 = Buffer.alloc(12, 0xab).toString('base64');
const FAKE_TAG_B64 = Buffer.alloc(16, 0xcd).toString('base64');

/** Strip the per-request envelope id/timestamp so two otherwise-identical
 *  error responses compare equal (BE-003k enumeration-resistance checks). */
function normalizeEnvelope(payload: string): unknown {
  const parsed = JSON.parse(payload) as { header?: { id?: unknown; servertime?: unknown } };
  if (parsed.header) {
    delete parsed.header.id;
    delete parsed.header.servertime;
  }
  return parsed;
}

describe('BE-003k: Security — resource/folder/permission domain', () => {
  let server: ReturnType<typeof createServer>;

  async function registerAndUnlock(label: string) {
    const email = `sec-${label}-${Math.random().toString(36).slice(2)}@example.test`;
    const username = `sec${Math.random().toString(36).slice(2, 12)}`;
    const masterPassword = `security-test-password-${label}-001`;

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

  const basePayload = () => ({
    name: 'Security Test Entry',
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

  // ── Unauthorized access denied — no enumeration signal ──────────────────

  describe('unauthorized access denied — enumeration resistance', () => {
    it('a truly nonexistent resource id and a resource the caller has zero access to return byte-identical 404 envelopes', async () => {
      const owner = await registerAndUnlock('enum-res-owner');
      const stranger = await registerAndUnlock('enum-res-stranger');

      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${owner.accessToken}` },
        payload: basePayload(),
      });
      const realId = (createRes.json() as { body: { id: string } }).body.id;

      const forSomeoneElsesResource = await server.inject({
        method: 'GET',
        url: `/api/v1/resources/${realId}`,
        headers: { authorization: `Bearer ${stranger.accessToken}` },
      });
      const forNonexistentId = await server.inject({
        method: 'GET',
        url: '/api/v1/resources/00000000-0000-0000-0000-000000000000',
        headers: { authorization: `Bearer ${stranger.accessToken}` },
      });

      expect(forSomeoneElsesResource.statusCode).toBe(404);
      expect(forNonexistentId.statusCode).toBe(404);
      // Not just the same status — the exact same response shape, modulo
      // the per-request envelope id/timestamp. If a future change ever
      // made one path more specific ("no permission" vs "not found"),
      // this test would catch the enumeration leak.
      expect(normalizeEnvelope(forSomeoneElsesResource.payload)).toEqual(
        normalizeEnvelope(forNonexistentId.payload),
      );
    });

    it('the same holds for folders', async () => {
      const owner = await registerAndUnlock('enum-folder-owner');
      const stranger = await registerAndUnlock('enum-folder-stranger');

      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/folders',
        headers: { authorization: `Bearer ${owner.accessToken}` },
        payload: { name: 'Private Folder' },
      });
      const realId = (createRes.json() as { body: { id: string } }).body.id;

      const forSomeoneElsesFolder = await server.inject({
        method: 'GET',
        url: `/api/v1/folders/${realId}`,
        headers: { authorization: `Bearer ${stranger.accessToken}` },
      });
      const forNonexistentId = await server.inject({
        method: 'GET',
        url: '/api/v1/folders/00000000-0000-0000-0000-000000000000',
        headers: { authorization: `Bearer ${stranger.accessToken}` },
      });

      expect(forSomeoneElsesFolder.statusCode).toBe(404);
      expect(forNonexistentId.statusCode).toBe(404);
      expect(normalizeEnvelope(forSomeoneElsesFolder.payload)).toEqual(
        normalizeEnvelope(forNonexistentId.payload),
      );
    });

    it('a malformed (non-UUID) resource id produces the same 404 as a well-formed but nonexistent one (no format-based signal)', async () => {
      const { accessToken } = await registerAndUnlock('enum-malformed');

      const malformed = await server.inject({
        method: 'GET',
        url: '/api/v1/resources/not-a-uuid-at-all',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const wellFormedButMissing = await server.inject({
        method: 'GET',
        url: '/api/v1/resources/00000000-0000-0000-0000-000000000000',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(malformed.statusCode).toBe(404);
      expect(wellFormedButMissing.statusCode).toBe(404);
      expect(normalizeEnvelope(malformed.payload)).toEqual(normalizeEnvelope(wellFormedButMissing.payload));
    });

    it('every 404 response body is the fixed generic message, never echoing the internal reason', async () => {
      const { accessToken } = await registerAndUnlock('enum-generic-message');
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/resources/00000000-0000-0000-0000-000000000000',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const body = res.json() as { header: { message: string }; body: { errors: Array<{ message: string }> } };
      expect(body.header.message).toBe('The requested resource could not be found.');
      expect(body.body.errors[0]?.message).toBe('The requested resource could not be found.');
      // Never the literal internal strings a route/service might throw
      // (e.g. "Resource not found", "resource not found") — those exist
      // only in server-side logs, never in the client-facing envelope.
      expect(res.payload).not.toMatch(/Resource not found/);
    });
  });

  // ── Metadata leakage check ───────────────────────────────────────────────

  describe('metadata leakage — metadataEncrypted resources', () => {
    it('plaintext supplied at create time never appears in ANY response body, on any path', async () => {
      const { accessToken } = await registerAndUnlock('leak-check');
      const secretUsername = 'do-not-leak-this-username-zzqx';
      const secretUri = 'https://do-not-leak-this-uri-zzqx.example.test';
      const fakeMetaB64 = Buffer.from('opaque-encrypted-metadata-blob').toString('base64');

      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          ...basePayload(),
          username: secretUsername,
          uri: secretUri,
          metadataEncrypted: true,
          metadataCiphertext: fakeMetaB64,
          metadataIv: FAKE_IV_B64,
          metadataTag: FAKE_TAG_B64,
        },
      });
      expect(createRes.statusCode).toBe(201);
      const id = (createRes.json() as { body: { id: string } }).body.id;

      // The plaintext must not appear ANYWHERE in the create response —
      // checking the whole raw payload (not just specific fields) so a
      // future schema change that adds a new field can't silently
      // reintroduce a leak this test would otherwise miss.
      expect(createRes.payload).not.toContain(secretUsername);
      expect(createRes.payload).not.toContain(secretUri);

      const getRes = await server.inject({
        method: 'GET',
        url: `/api/v1/resources/${id}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(getRes.payload).not.toContain(secretUsername);
      expect(getRes.payload).not.toContain(secretUri);

      const listRes = await server.inject({
        method: 'GET',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(listRes.payload).not.toContain(secretUsername);
      expect(listRes.payload).not.toContain(secretUri);

      const patchRes = await server.inject({
        method: 'PATCH',
        url: `/api/v1/resources/${id}`,
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { favorite: true },
      });
      expect(patchRes.payload).not.toContain(secretUsername);
      expect(patchRes.payload).not.toContain(secretUri);

      const deleteRes = await server.inject({
        method: 'DELETE',
        url: `/api/v1/resources/${id}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(deleteRes.payload).not.toContain(secretUsername);
      expect(deleteRes.payload).not.toContain(secretUri);
    });

    it('an error response for an encrypted-metadata resource never echoes the attempted plaintext value', async () => {
      const { accessToken } = await registerAndUnlock('leak-error-path');
      const secretUsername = 'error-path-should-not-leak-this-qzzx';

      // metadataEncrypted=true without the required ciphertext fields is a
      // 400 — confirm the 400 doesn't echo back the plaintext the caller
      // tried to submit (it shouldn't, since httpError messages are
      // replaced with a fixed generic string, but this pins that down for
      // this specific route/payload shape).
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          ...basePayload(),
          username: secretUsername,
          metadataEncrypted: true,
          // metadataCiphertext/Iv/Tag omitted — triggers the 400.
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.payload).not.toContain(secretUsername);
    });
  });

  // ── Tampered / malformed ciphertext ──────────────────────────────────────

  describe('tampered ciphertext rejected', () => {
    it('AEAD tamper-detection (auth-tag verification) is entirely a client-side, packages/crypto concern — not server-side', () => {
      // Documented, not asserted against a route: the API stores and
      // returns secretCiphertext/secretIv/secretTag as opaque bytes and
      // never runs AES-GCM against them (AR-2 — the server never sees a
      // vault key, so it COULD NOT verify the auth tag even if it wanted
      // to). The actual tamper-rejection guarantee — flipping a byte of
      // ciphertext/iv/tag/AAD causes decrypt() to throw — is exhaustively
      // covered in packages/crypto/tests/crypto.test.ts's "encrypt /
      // decrypt (AES-256-GCM)" describe block ("throws when ciphertext is
      // tampered", "throws when tag is modified", "throws on decrypt with
      // wrong key", "throws when AAD does not match"). This test exists so
      // that boundary is explicit in the BE-003 (API-layer) security suite,
      // not just implicit by omission.
      expect(true).toBe(true);
    });

    it('an empty or non-string secretCiphertext is rejected (400) — the one thing the API DOES validate', async () => {
      const { accessToken } = await registerAndUnlock('tamper-empty');
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { ...basePayload(), secretCiphertext: '' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('the same emptiness check applies on PATCH, not just POST', async () => {
      const { accessToken } = await registerAndUnlock('tamper-patch-empty');
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
        payload: { secretCiphertext: '' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('garbage (non-empty, non-base64-alphabet) content is accepted as an opaque blob — intentional, since the server never interprets it', async () => {
      // Node's Buffer.from(x, 'base64') never throws — it lenient-decodes,
      // silently skipping characters outside the base64 alphabet. The API
      // does not add its own well-formedness check on top, because it has
      // no reason to: it never decrypts secretCiphertext, so a malformed
      // value is functionally identical to a valid one from the server's
      // perspective — both are opaque bytes it stores and returns
      // unchanged. Real corruption is caught client-side, at decrypt time
      // (packages/crypto), which is where it can actually be acted on.
      const { accessToken } = await registerAndUnlock('tamper-garbage-accepted');
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/resources',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { ...basePayload(), secretCiphertext: '!!!not-valid-base64-content!!!' },
      });
      expect(res.statusCode).toBe(201);
    });
  });
});
