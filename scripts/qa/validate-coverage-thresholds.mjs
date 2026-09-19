#!/usr/bin/env node
/**
 * validate-coverage-thresholds.mjs — QA-001e self-validation for the coverage gate.
 *
 * Asserts the mandated Tier A minima are actually encoded in
 * `tests/coverage-gates/thresholds.ts` (exit 0 = pass, 1 = fail):
 *
 *   unit          line >= 80,  branch >= 70
 *   integration   line >= 70,  branch >= 60
 *   critical      line >= 90,  branch >= 85
 *
 * This is a mechanical guard so the QA-001e acceptance criterion
 * "unit ≥ 80%, integration ≥ 70%, critical paths ≥ 90%" cannot silently drift
 * below the backlog minimums.
 *
 * Usage: node scripts/qa/validate-coverage-thresholds.mjs [path]
 */

import { readFileSync } from "node:fs";

const target = process.argv[2] || "tests/coverage-gates/thresholds.ts";
let text;
try {
  text = readFileSync(target, "utf8");
} catch (e) {
  console.error(`FAIL: cannot read ${target}: ${e.message}`);
  process.exit(1);
}

const failures = [];
const ok = (name) => console.log(`  ok - ${name}`);
const fail = (name, detail = "") => failures.push(`${name}${detail ? " — " + detail : ""}`);

// Extract a { lines, branches } literal from a named export block.
function readThreshold(name) {
  const block = text.match(new RegExp(`export const ${name}[\\s\\S]*?\\{([\\s\\S]*?)\\n\\};`));
  if (!block) return null;
  const lines = block[1].match(/lines:\s*(\d+)/);
  const branches = block[1].match(/branches:\s*(\d+)/);
  if (!lines || !branches) return null;
  return { lines: Number(lines[1]), branches: Number(branches[1]) };
}

const MANDATE = {
  UNIT: { lines: 80, branches: 70 },
  INTEGRATION: { lines: 70, branches: 60 },
  CRITICAL_PATHS: { lines: 90, branches: 85 },
};

console.log(`coverage-threshold validation — ${target}`);
for (const [name, min] of Object.entries(MANDATE)) {
  const got = readThreshold(name);
  if (!got) {
    fail(name, "not found or malformed");
    continue;
  }
  if (got.lines < min.lines) fail(name, `lines ${got.lines} < ${min.lines}`);
  if (got.branches < min.branches) fail(name, `branches ${got.branches} < ${min.branches}`);
  if (got.lines >= min.lines && got.branches >= min.branches) {
    ok(`${name} (line ${got.lines} ≥ ${min.lines}, branch ${got.branches} ≥ ${min.branches})`);
  }
}

// critical-path globs must name the mandated domains
const globs = text.match(/CRITICAL_PATH_GLOBS\s*=\s*\[([\s\S]*?)\]\s*as const/);
if (!globs) {
  fail("CRITICAL_PATH_GLOBS", "missing");
} else {
  for (const needle of ["auth", "vault", "crypto"]) {
    if (!globs[1].includes(needle)) fail("CRITICAL_PATH_GLOBS", `missing "${needle}" glob`);
  }
  if (!failures.some((f) => f.includes("CRITICAL_PATH_GLOBS"))) {
    ok("CRITICAL_PATH_GLOBS covers auth/vault/crypto");
  }
}

console.log();
if (failures.length) {
  console.error(`FAIL (${failures.length} issue(s)):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("PASS — Tier A thresholds meet the QA-001e mandate (80/70, 70/60, 90/85).");
process.exit(0);
