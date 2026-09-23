/** @fileoverview BE-003i: dedicated unit coverage for resources.ts's pure
 * helper functions.
 *
 * Test type: unit (no server, no DB — pure functions only).
 *
 * These two helpers are covered indirectly, end-to-end, by
 * resources.test.ts's integration suite already (BE-003b/h). This file
 * adds direct, isolated coverage of their logic — the wire-encoding
 * roundtrip (base64 <-> Buffer) that underpins "encryption/decryption
 * roundtrip... covered" (BE-003i AC1), and the LIKE-escaping that
 * underpins "search filtering... covered" (BE-003i AC1) — without needing
 * a live server or database to exercise them.
 *
 * AR-3: Positive + negative tests.
 * AR-4: All data is synthetic, generated at test time.
 */

import { describe, it, expect } from 'vitest';
import { b64ToBuffer, bufferToB64, escapeLikeTerm } from '../src/routes/resources';

describe('BE-003i: resources.ts helpers — unit coverage', () => {
  // ── b64ToBuffer / bufferToB64 (wire-encoding roundtrip) ───────────────────

  describe('b64ToBuffer / bufferToB64 — base64 <-> Buffer roundtrip', () => {
    it('decodes a base64 string to the exact original bytes', () => {
      const original = Buffer.from('synthetic-ciphertext-not-real', 'utf8');
      const b64 = original.toString('base64');
      expect(b64ToBuffer(b64, 'secretCiphertext')).toEqual(original);
    });

    it('round-trips arbitrary binary data (not just text) byte-for-byte', () => {
      const original = Buffer.from([0x00, 0x01, 0xff, 0xab, 0xcd, 0x7f, 0x80]);
      const roundTripped = b64ToBuffer(original.toString('base64'), 'field');
      expect(roundTripped).toEqual(original);
    });

    it('bufferToB64(b64ToBuffer(x)) is the identity for any base64 input', () => {
      const original = Buffer.from('AES-256-GCM opaque blob, never decrypted here', 'utf8');
      const b64In = original.toString('base64');
      const buf = b64ToBuffer(b64In, 'field');
      const b64Out = bufferToB64(buf);
      expect(b64Out).toBe(b64In);
    });

    it('bufferToB64 returns null for a null buffer (optional metadata fields)', () => {
      expect(bufferToB64(null)).toBeNull();
    });

    it('b64ToBuffer throws a 400 httpError for an empty string', () => {
      expect(() => b64ToBuffer('', 'secretCiphertext')).toThrow(
        expect.objectContaining({ statusCode: 400 }),
      );
    });

    it('b64ToBuffer throws a 400 httpError for a non-string value', () => {
      expect(() => b64ToBuffer(null as unknown as string, 'secretIv')).toThrow(
        expect.objectContaining({ statusCode: 400 }),
      );
    });

    it('the 400 error message names the offending field', () => {
      expect(() => b64ToBuffer('', 'secretTag')).toThrow(/secretTag/);
    });
  });

  // ── escapeLikeTerm (search-filter LIKE escaping) ──────────────────────────

  describe('escapeLikeTerm — SQL LIKE wildcard escaping for search terms', () => {
    it('leaves an ordinary term unchanged', () => {
      expect(escapeLikeTerm('github')).toBe('github');
    });

    it('escapes a literal percent sign', () => {
      expect(escapeLikeTerm('100%')).toBe('100\\%');
    });

    it('escapes a literal underscore', () => {
      expect(escapeLikeTerm('foo_bar')).toBe('foo\\_bar');
    });

    it('escapes a literal backslash', () => {
      expect(escapeLikeTerm('C:\\Users')).toBe('C:\\\\Users');
    });

    it('escapes multiple wildcard characters in one term', () => {
      expect(escapeLikeTerm('50%_off\\sale')).toBe('50\\%\\_off\\\\sale');
    });

    it('is idempotent-safe: escaping does not introduce new unescaped wildcards', () => {
      const escaped = escapeLikeTerm('100%_test');
      // Every remaining literal % or _ in the escaped string is immediately
      // preceded by a backslash.
      expect(/(?<!\\)[%_]/.test(escaped)).toBe(false);
    });

    it('handles an empty string', () => {
      expect(escapeLikeTerm('')).toBe('');
    });

    it('leaves non-wildcard special regex characters untouched (only %, _, \\ are LIKE-special)', () => {
      expect(escapeLikeTerm('a.b*c?d')).toBe('a.b*c?d');
    });
  });
});
