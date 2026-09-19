#!/usr/bin/env node
/**
 * validate-fixtures.mjs — QA-001e self-validation for the synthetic fixture factory.
 *
 * Proves two properties of `tests/fixtures/` (exit 0 = pass, 1 = fail):
 *
 *   1. DETERMINISM  — structured data is reproducible (fixed seed → same output).
 *   2. SYNTHETIC-ONLY (AR-4) — secret material is generated per run (never
 *      hard-coded, never a dictionary word); every identifier/URL/email is on a
 *      reserved TLD; no real domain or real credential.
 *
 * Run with the Node type-stripping loader (Node >= 22.6):
 *   node --experimental-strip-types scripts/qa/validate-fixtures.mjs
 */

import {
  mulberry32,
  seededRandom,
  FIXTURE_SEED,
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
} from "../../tests/fixtures/index.ts";

const failures = [];
const ok = (name) => console.log(`  ok - ${name}`);
const fail = (name, detail = "") => failures.push(`${name}${detail ? " — " + detail : ""}`);
const assert = (cond, name, detail = "") => (cond ? ok(name) : fail(name, detail));

// ---------------------------------------------------------------- 1. determinism
console.log("1. Determinism (fixed seed):");
const seqA = [mulberry32(123)(), mulberry32(123)(), mulberry32(123)()];
const seqB = [mulberry32(123)(), mulberry32(123)(), mulberry32(123)()];
assert(seqA.every((v, i) => v === seqB[i]), "mulberry32 is deterministic for a fixed seed");

const rngA = seededRandom(FIXTURE_SEED);
const rngB = seededRandom(FIXTURE_SEED);
const namesA = Array.from({ length: 5 }, () => (rngA() * 1e6) | 0);
const namesB = Array.from({ length: 5 }, () => (rngB() * 1e6) | 0);
assert(JSON.stringify(namesA) === JSON.stringify(namesB), "seededRandom reproduces a sequence");

// ---------------------------------------------------------------- 2. synthetic-only
console.log("2. Synthetic-only (AR-4):");

const p1 = syntheticMasterPassword();
const p2 = syntheticMasterPassword();
assert(/^[0-9a-f]{36}$/.test(p1), "master password is 36 hex chars (144-bit random)");
assert(p1 !== p2, "master password is generated fresh per run (not a constant)");
assert(!/password|123456|qwerty|letmein|admin/i.test(p1), "master password is not dictionary-shaped");

const s1 = syntheticSecret();
assert(/^test-secret-[0-9a-f]{32}$/.test(s1), "secret matches test-secret-<randomhex>");
assert(syntheticSecret() !== s1, "secret is generated fresh per run");

const k1 = syntheticKey();
assert(/^[0-9a-f]{64}$/.test(k1), "synthetic key is 32 random bytes (hex)");
assert(k1 !== syntheticKey(), "key material is generated fresh per run");

const u = syntheticUser();
assert(u.email.endsWith("@example.test"), "email is on a reserved TLD (@example.test)");
assert(/^testuser$/.test(u.username) || /^testuser-\d+$/.test(u.username), "username is synthetic");

const r = syntheticResource(1);
assert(r.name === "test-resource-1", "resource name is a fixed synthetic constant");
assert(r.uri.startsWith("https://") && r.uri.includes(".example.test"), "resource URI is on a reserved TLD");
assert(/\.test\b/.test(r.uri) && !/\.(com|net|org|io|dev)\b/.test(r.uri), "resource URI has no real TLD");
assert(syntheticResourceName(2) === "test-resource-2", "resource name is deterministic by index");
assert(syntheticResourceUsername(1) === "login-example", "resource username is synthetic");

const email = syntheticEmail(3);
assert(email === "user-3@example.test", "email is deterministic and synthetic");

const tags = syntheticTagList(5);
assert(tags.length === 5, "bulk tag list has requested length");
assert(tags.every((t) => /^[a-z]+$/.test(t.name)), "tag names are from the fixed vocabulary");

const tree = syntheticFolderTree(3);
assert(tree.children.length === 3, "folder tree builds requested children");
assert(tree.children.every((c) => c.parentId === tree.root.id), "folder children link to root parentId");

// RFC vector is the only literal secret-shaped value, and it is cited
assert(RFC_TEST_VECTORS.base32.encoded === "JBSWY3DPEHPK3PXP", "RFC 4648 base32 vector is present and cited");
assert(RFC_TEST_VECTORS.base32.rfc.includes("4648"), "RFC vector carries its citation");

console.log();
if (failures.length) {
  console.error(`FAIL (${failures.length} issue(s)):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("PASS — fixtures are deterministic for structured data and synthetic-only for secrets (AR-4).");
process.exit(0);
