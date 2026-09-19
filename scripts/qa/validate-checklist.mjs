#!/usr/bin/env node
/**
 * validate-checklist.mjs — QA-001f self-validation for tests/security/NEGATIVE_TEST_CHECKLIST.md
 *
 * Asserts (exit 0 = pass, exit 1 = fail):
 *   1. The five acceptance-criteria themes are present as their own §4.x sections.
 *   2. Every TEST_STRATEGY §6.2 category (A–F) is covered by at least one case ID.
 *   3. Every case ID (THEME-nn) appears on a row that also carries an owning test path.
 *   4. No forbidden real-looking secret / real domain appears in the document (AR-4 self-check).
 *   5. SEC-001 vectors V1–V7 and rules AR-1…AR-6 are referenced.
 *
 * Usage: node scripts/qa/validate-checklist.mjs [path]
 */
import { readFileSync } from "node:fs";

const path = process.argv[2] || "tests/security/NEGATIVE_TEST_CHECKLIST.md";
let text;
try {
  text = readFileSync(path, "utf8");
} catch (e) {
  console.error(`FAIL: cannot read ${path}: ${e.message}`);
  process.exit(1);
}

const failures = [];
const ok = (name) => console.log(`  ok - ${name}`);
const fail = (name, detail = "") => failures.push(`${name}${detail ? " — " + detail : ""}`);

// 1. Five mandated themes as §4.x sections
const themes = {
  "Tampered ciphertext": /### 4\.1\s+.*Tampered Ciphertext/i,
  "Auth abuse": /### 4\.2\s+.*Auth Abuse/i,
  "Leakage vectors": /### 4\.3\s+.*Leakage Vectors/i,
  "Permission bypass": /### 4\.4\s+.*Permission Bypass/i,
  "Origin spoofing": /### 4\.5\s+.*Origin Spoofing/i,
};
console.log("1. Acceptance-criteria theme coverage:");
for (const [name, re] of Object.entries(themes)) {
  re.test(text) ? ok(name) : fail(name, "missing §4 section");
}

// 2. §6.2 A–F category coverage via case-ID prefixes
const categoryMap = {
  "A. Crypto (AR-3)": /\bCRY-\d{2}\b/,
  "B. API (auth/authz/leakage)": /\b(AUTH|PERM|LEAK)-\d{2}\b/,
  "C. Bridge": /\bORG-\d{2}\b/,
  "D. Extension runtime": /\b(EXT)-\d{2}\b/,
  "E. Web UI": /\bWEB-\d{2}\b/,
  "F. Migration/backup": /\bMIG-\d{2}\b/,
};
console.log("2. TEST_STRATEGY §6.2 A–F category coverage:");
for (const [name, re] of Object.entries(categoryMap)) {
  re.test(text) ? ok(name) : fail(name, "no case ID found");
}

// 3. Every case ID lives on a row that also carries an owning test path
const caseIds = [...text.matchAll(/\b(CRY|AUTH|LEAK|PERM|ORG|WEB|EXT|MIG)-\d{2}\b/g)].map((m) => m[0]);
const uniqueIds = [...new Set(caseIds)];
const pathMarker = /(\.test\.ts|\.spec\.ts|\.test\.tsx|pnpm (lint|scan:secrets|test:security)|tests\/|packages\/|apps\/)/;
console.log(`3. Owning test path per case (${uniqueIds.length} unique case IDs):`);
const missingPath = [];
for (const id of uniqueIds) {
  // find the line(s) containing the ID; the table row contains the ID and the path on one line
  const lines = text.split("\n").filter((l) => l.includes(`| ${id} |`));
  const hasPath = lines.some((l) => pathMarker.test(l));
  if (!hasPath) missingPath.push(id);
}
missingPath.length === 0
  ? ok(`all ${uniqueIds.length} cases reference an owning test path`)
  : fail("cases missing a test path", missingPath.join(", "));

// 4. AR-4 hygiene — no real-looking secrets or real domains
console.log("4. Synthetic-data / no-real-secret hygiene (AR-4 self-check):");
const forbidden = [
  [/github\.com/i, "real domain github.com"],
  [/amazonaws\.com/i, "real domain amazonaws.com"],
  [/password123/i, "dictionary password"],
  [/correct-horse-battery-staple/i, "memorized passphrase"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access-key shape"],
  [/\b[A-Za-z0-9+/]{40,}={0,2}\b/, "long base64 blob (possible key material)"],
];
let clean = true;
for (const [re, label] of forbidden) {
  if (re.test(text)) {
    fail(`forbidden pattern present`, label);
    clean = false;
  }
}
clean && ok("no forbidden secret/domain patterns detected");

// 5. SEC-001 vector + rule references
console.log("5. SEC-001 traceability:");
const missingVec = ["V1", "V2", "V3", "V4", "V5", "V6", "V7"].filter((v) => !new RegExp(`\\b${v}\\b`).test(text));
const missingAr = ["AR-1", "AR-2", "AR-3", "AR-4", "AR-5", "AR-6"].filter((r) => !text.includes(r));
missingVec.length === 0 ? ok("V1–V7 all referenced") : fail("missing vector refs", missingVec.join(", "));
missingAr.length === 0 ? ok("AR-1…AR-6 all referenced") : fail("missing rule refs", missingAr.join(", "));

console.log();
if (failures.length > 0) {
  console.error(`FAIL (${failures.length} check group(s) failed):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`PASS — ${path} validates (5 themes, §6.2 A–F covered, ${uniqueIds.length} cases with owning paths, hygiene clean, SEC-001 referenced).`);
process.exit(0);
