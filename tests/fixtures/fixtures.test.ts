import { describe, it, expect } from "vitest";
import {
  FIXTURE_SEED,
  mulberry32,
  seededRandom,
  syntheticMasterPassword,
  syntheticSecret,
  syntheticKey,
  syntheticUser,
  syntheticResource,
  syntheticResourceName,
  syntheticResourceUsername,
  syntheticEmail,
  syntheticTagList,
  syntheticFolderTree,
  RFC_TEST_VECTORS,
} from "./index.ts";

/**
 * tests/fixtures/fixtures.test.ts — Vitest suite for the synthetic factory.
 *
 * This is the CI-resident companion to scripts/qa/validate-fixtures.mjs (which
 * runs dependency-free under `node --experimental-strip-types`). Both assert the
 * same two properties — determinism for structured data, synthetic-only (AR-4)
 * for secret material. Keep the two in sync.
 */

describe("synthetic fixtures — determinism", () => {
  it("mulberry32 is deterministic for a fixed seed", () => {
    const a = [mulberry32(123)(), mulberry32(123)(), mulberry32(123)()];
    const b = [mulberry32(123)(), mulberry32(123)(), mulberry32(123)()];
    expect(a).toEqual(b);
  });

  it("seededRandom(FIXTURE_SEED) reproduces a sequence", () => {
    const rngA = seededRandom(FIXTURE_SEED);
    const rngB = seededRandom(FIXTURE_SEED);
    const a = Array.from({ length: 5 }, () => (rngA() * 1e6) | 0);
    const b = Array.from({ length: 5 }, () => (rngB() * 1e6) | 0);
    expect(a).toEqual(b);
  });
});

describe("synthetic fixtures — AR-4 synthetic-only", () => {
  it("master password is 36 hex chars and generated per run (never a constant)", () => {
    const p1 = syntheticMasterPassword();
    const p2 = syntheticMasterPassword();
    expect(p1).toMatch(/^[0-9a-f]{36}$/);
    expect(p1).not.toBe(p2);
    expect(p1).not.toMatch(/password|123456|qwerty|letmein|admin/i);
  });

  it("secrets and keys are generated per run, not hard-coded", () => {
    const s1 = syntheticSecret();
    expect(s1).toMatch(/^test-secret-[0-9a-f]{32}$/);
    expect(syntheticSecret()).not.toBe(s1);

    const k1 = syntheticKey();
    expect(k1).toMatch(/^[0-9a-f]{64}$/);
    expect(syntheticKey()).not.toBe(k1);
  });

  it("identifiers, emails, and URIs are reserved-TLD only", () => {
    const user = syntheticUser();
    expect(user.email).toMatch(/@example\.test$/);

    const resource = syntheticResource(1);
    expect(resource.name).toBe("test-resource-1");
    expect(resource.uri).toMatch(/\.example\.test/);
    expect(resource.uri).not.toMatch(/\.(com|net|org|io|dev)\b/);

    expect(syntheticResourceName(2)).toBe("test-resource-2");
    expect(syntheticResourceUsername(1)).toBe("login-example");
    expect(syntheticEmail(3)).toBe("user-3@example.test");
  });

  it("bulk generators are deterministic and synthetic", () => {
    const tags = syntheticTagList(5);
    expect(tags).toHaveLength(5);
    for (const t of tags) expect(t.name).toMatch(/^[a-z]+$/);

    const tree = syntheticFolderTree(3);
    expect(tree.children).toHaveLength(3);
    for (const c of tree.children) expect(c.parentId).toBe(tree.root.id);
  });

  it("RFC test vectors are present and cited", () => {
    expect(RFC_TEST_VECTORS.base32.encoded).toBe("JBSWY3DPEHPK3PXP");
    expect(RFC_TEST_VECTORS.base32.rfc).toContain("4648");
  });
});
